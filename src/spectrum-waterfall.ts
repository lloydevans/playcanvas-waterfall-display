import * as pc from "playcanvas";
import { rotateHue } from "./rotate-hue";

// Absolute noise floor level in dB.
const NOISE_FLOOR = 148;

// Reused color instance for lerp method.
let color = new pc.Color();

/**
 * Creating a raining spectogram effect with WebAudio analyzer node and
 * modifying 3D mesh vertices in realtime.
 *
 */
export class SpectrumWaterfall extends pc.ScriptType {
  /**
   * Frequency bins per FFT window.
   */
  protected binCount: number;

  /**
   * A 2D array containing multiple FFT windows going back in time.
   */
  protected bins: Float32Array;

  /**
   * Mesh vertices.
   */
  protected vertices: Float32Array;

  /**
   * Mesh instance.
   */
  protected mesh: pc.Mesh;

  /**
   * UVs vertice index array.
   */
  protected uvs: Float32Array;

  /**
   * Triangle index list.
   */
  protected triangles: number[];

  /**
   * Mesh vertice colors.
   */
  protected colors: Float32Array;

  /**
   * Current FFT window data. Values populated by `analyzerNode.getFloatFrequencyData`.
   */
  protected fftWindowData: Float32Array;

  /**
   * Material reference.
   */
  protected material: pc.Material = new pc.StandardMaterial();

  /**
   * Pc mesh instance reference.
   */
  protected meshInstance: pc.MeshInstance;

  /**
   * Mesh graph node.
   */
  protected graphNode: pc.GraphNode = new pc.GraphNode();

  /**
   * PC sound playback instance reference. Needed for connecting analyzer node.
   */
  protected playbackInstance: pc.SoundInstance;

  /**
   * WebAudio analyzer node provides low-level FFT analysis.
   */
  protected analyzerNode: AnalyserNode;

  /**
   * Audio context reference.
   */
  protected ctx: AudioContext;

  /**
   * Called when script is about to run for the first time.
   */
  public initialize() {
    this.on("attr:fftSize", () => {
      this.analyzerNode.fftSize = this.fftSize;
      this.reset();
    });

    this.on("attr:smoothingTimeConstant", () => {
      this.analyzerNode.smoothingTimeConstant = this.smoothingTimeConstant;
    });

    this.on("attr:scaleX", () => {
      this.calculateExtents();
    });

    this.on("attr:speed", () => {
      this.calculateExtents();
    });

    this.on("attr:startOffset", () => {
      this.calculateExtents();
    });

    this.on("attr:length", () => {
      this.reset();
    });

    this.ctx = this.app.systems.sound.context;

    // Setup Web Audio analyzer node.
    this.analyzerNode = this.ctx.createAnalyser();
    this.analyzerNode.fftSize = this.fftSize;
    this.analyzerNode.smoothingTimeConstant = this.smoothingTimeConstant;

    if (this.materialAsset) {
      this.material = this.materialAsset.resource;
    }

    this.reset();
  }

  /**
   * Called for enabled (running state) scripts on each tick.
   *
   * @param dt - The delta time in seconds since the last frame.
   */
  public update(dt: number) {
    if (this.cycleColors) {
      rotateHue(this.colorMax, -50 * dt);
      rotateHue(this.colorMin, -50 * dt);
    }

    if (this.active) {
      this.addWindow();
      this.calculateColors();
      this.updateMesh();
    }
  }

  /**
   * Play a sound.
   *
   * @param slotName - Slot name must exist on the sound component.
   */
  public play(slotName: string) {
    if (!this.active) {
      this.active = true;
    }

    this.entity.sound.stop();

    this.playbackInstance = this.entity.sound.play(slotName);

    // @ts-expect-error // Get access to audio node via provate property.
    this.playbackInstance._connectorNode.connect(this.analyzerNode);
  }

  /**
   * Stop sound.
   */
  public stop() {
    this.entity.sound.stop();
  }

  /**
   * Main reset.
   */
  public reset() {
    this.binCount = this.analyzerNode.frequencyBinCount;

    // @ts-expect-error // Get access to audio node via provate property.
    this.playbackInstance?._connectorNode?.connect(this.analyzerNode);

    let area = this.binCount * this.length;
    this.fftWindowData = new Float32Array(this.binCount);
    this.bins = new Float32Array(area);
    this.vertices = new Float32Array(3 * area);
    this.uvs = new Float32Array(2 * area);
    this.colors = new Float32Array(4 * area);
    this.calculateExtents();
    this.calculateTriangles();
    this.calculateUvs();
    this.calculateColors();
    this.createMeshInstance();
  }

  /**
   * Add an FFT window to the bins array and update the geometry height.
   */
  private addWindow() {
    this.analyzerNode.getFloatFrequencyData(this.fftWindowData);

    for (let i = 0; i < this.fftWindowData.length; i++) {
      this.fftWindowData[i] =
        (this.fftWindowData[i] + NOISE_FLOOR + this.gain) / NOISE_FLOOR;
      this.fftWindowData[i] *= this.amp;
    }

    let len = this.fftWindowData.length;

    // Shift the whole bins array forard.
    for (let i = this.bins.length - 1 - len; i > 0; i--) {
      this.bins[i + len] = this.bins[i];
    }

    // Add in the new window.
    for (let i = 0; i < len; i++) {
      this.bins[i] = this.fftWindowData[i];
    }

    for (
      let i = this.vertices.length / 3 - len;
      i < this.vertices.length / 3;
      i++
    ) {
      this.vertices[i * 3 + 1] = 0;
    }

    for (let i = 0; i < len; i++) {
      this.vertices[i * 3 + 1] = 0;
    }

    for (let i = len; i < this.vertices.length / 3 - len; i++) {
      this.vertices[i * 3 + 1] = Math.max(0, this.bins[i]);
    }
  }

  /**
   * Update the mesh.
   *
   * @param firstUpdate - If true, additional calculations are made.
   */
  private updateMesh(firstUpdate = false) {
    this.mesh.setPositions(this.vertices);
    this.mesh.setColors(this.colors);

    // @ts-ignore // Type only allows number[] but can take Float32Array.
    this.mesh.setNormals(pc.calculateNormals(this.vertices, this.triangles));

    if (firstUpdate) {
      this.mesh.setUvs(0, this.uvs);
      this.mesh.setIndices(this.triangles);
    }

    this.mesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /**
   * Create the mesh instace.
   */
  protected createMeshInstance() {
    this.mesh = new pc.Mesh(this.app.graphicsDevice);
    this.mesh.clear(true, true);
    this.updateMesh(true);
    this.graphNode = new pc.GraphNode();
    this.meshInstance = new pc.MeshInstance(
      this.graphNode,
      this.mesh,
      this.material
    );

    if (!this.entity.model) {
      this.entity.addComponent("model");
    }

    let model = new pc.Model();
    model.graph = this.graphNode;
    model.meshInstances = [this.meshInstance];
    this.entity.model.model = model;
  }

  /**
   * Calculate vertex colors by interpolating between the min and max colors.
   */
  protected calculateColors() {
    let wL = this.fftWindowData.length;

    for (let i = this.colors.length - 1 - wL * 4; i > 0; i--) {
      this.colors[i + wL * 4] = this.colors[i];
    }

    for (let i = 0; i < wL; i++) {
      color.set(0, 0, 0, 0);
      color.lerp(
        this.colorMin,
        this.colorMax,
        Math.max(0, Math.min(1, this.bins[i] / this.amp))
      );

      this.colors[i * 4 + 0] = color.r;
      this.colors[i * 4 + 1] = color.g;
      this.colors[i * 4 + 2] = color.b;

      // Force left and right most to be transparent.
      this.colors[i * 4 + 3] = i === 0 || i === this.binCount - 1 ? 0 : color.a;
    }

    if (this.fadeDecay !== 1) {
      for (let x = 0; x < this.binCount; x++) {
        for (let y = 0; y < this.length; y++) {
          let i = x + y * this.binCount;
          this.colors[i * 4 + 3] *= this.fadeDecay;
        }
      }
    }
  }

  /**
   * Calculate all mesh geometry appart from Y axis height.
   */
  protected calculateExtents() {
    let scaleX = this.scaleX / this.binCount;

    for (let z = 0; z < this.length; z++) {
      for (let x = 0; x < this.binCount; x++) {
        let i = x + z * this.binCount;

        // Frequency / X
        this.vertices[3 * i] = (-x + this.binCount / 2) * scaleX;

        // Depth / Time
        if (z === 0) {
          this.vertices[3 * i + 2] = 0;
        } //
        else if (z === 1) {
          this.vertices[3 * i + 2] = this.startOffset * 2;
        } //
        else {
          let referenceSpeed = 256 / this.analyzerNode.frequencyBinCount;
          this.vertices[3 * i + 2] =
            this.startOffset * 2 + z * this.speed * referenceSpeed;
        }
      }
    }
  }

  /**
   * Create a 2D UV coordinate for each vertice and store them in an array.`
   */
  protected calculateUvs() {
    for (let z = 0; z < this.length; z++) {
      for (let x = 0; x < this.binCount; x++) {
        let i = x + z * this.binCount;
        this.uvs[2 * i] = x / this.binCount;
        this.uvs[2 * i + 1] = 1 - z / this.length;
      }
    }
  }

  /**
   * Create an array of vertice indexes which form the mesh triangles.
   */
  protected calculateTriangles() {
    this.triangles = [];

    for (let x = 0; x < this.length - 1; x++) {
      for (let y = 0; y < this.binCount - 1; y++) {
        this.triangles.push(
          x * this.binCount + y + 1,
          (x + 1) * this.binCount + y,
          x * this.binCount + y,
          (x + 1) * this.binCount + y,
          x * this.binCount + y + 1,
          (x + 1) * this.binCount + y + 1
        );
      }
    }
  }
}

/**
 * Register class.
 */
pc.registerScript(SpectrumWaterfall, "spectrumWaterfall");

export interface SpectrumWaterfall {
  /**
   * Currently recording FFT windows.
   */
  active?: boolean;
}
SpectrumWaterfall.attributes.add("active", {
  description: "Curently recording FFT windows.",
  title: "Active",
  default: true,
  type: "boolean",
});

export interface SpectrumWaterfall {
  /**
   * The fftSize property of the AnalyserNode interface is an unsigned long value and represents the window size in samples that is used when performing a Fast Fourier Transform (FFT) to get frequency domain data.
   */
  fftSize: 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096;
}
SpectrumWaterfall.attributes.add("fftSize", {
  description:
    "The fftSize property of the AnalyserNode interface is an unsigned long value and represents the window size in samples that is used when performing a Fast Fourier Transform (FFT) to get frequency domain data.",
  title: "FFT Size",
  type: "number",
  enum: [
    { "32": 32 },
    { "64": 64 },
    { "128": 128 },
    { "256": 256 },
    { "512": 512 },
    { "1024": 1024 },
    { "2048": 2048 },
    { "4096": 4096 },
  ],
  default: 256,
});

export interface SpectrumWaterfall {
  /**
   * The smoothingTimeConstant property of the AnalyserNode interface is a double value representing the averaging constant with the last analysis frame.
   */
  smoothingTimeConstant?: number;
}
SpectrumWaterfall.attributes.add("smoothingTimeConstant", {
  description:
    "The smoothingTimeConstant property of the AnalyserNode interface is a double value representing the averaging constant with the last analysis frame.",
  title: "Smoothing",
  type: "number",
  default: 0.7,
  min: 0,
  max: 1,
});

export interface SpectrumWaterfall {
  /**
   * Mesh X axis extent.
   */
  scaleX: number;
}
SpectrumWaterfall.attributes.add("scaleX", {
  description: "Mesh X axis extent.",
  title: "Scale X",
  type: "number",
  default: 16,
  min: 1,
  max: 32,
  precision: 0.1,
});

export interface SpectrumWaterfall {
  /**
   * Mesh Z axis extent.
   */
  amp: number;
}
SpectrumWaterfall.attributes.add("amp", {
  description: "Mesh Z axis extent.",
  title: "Amp",
  type: "number",
  default: 1,
  min: 0.01,
  max: 4,
});

export interface SpectrumWaterfall {
  /**
   * The rate of Z axis movement over time.
   */
  speed: number;
}
SpectrumWaterfall.attributes.add("speed", {
  description: "The rate of Z axis movement over time.",
  title: "Speed",
  type: "number",
  default: 1,
  min: 0.001,
  max: 1,
});

export interface SpectrumWaterfall {
  /**
   * Gain applid to visualization.
   */
  gain: number;
}
SpectrumWaterfall.attributes.add("gain", {
  description: "Gain gain applid to visualization.",
  title: "Gain",
  type: "number",
  default: 0,
  min: -48,
  max: 48,
});

export interface SpectrumWaterfall {
  /**
   * The number of FFT windows stored from previous updates.
   */
  length: number;
}
SpectrumWaterfall.attributes.add("length", {
  description: "The number of FFT windows stored from previous updates.",
  title: "Length",
  type: "number",
  default: 128,
  min: 4,
  max: 256,
  precision: 0.1,
});

export interface SpectrumWaterfall {
  /**
   * Animate fade.
   */
  fadeDecay: number;
}
SpectrumWaterfall.attributes.add("fadeDecay", {
  description: "Animate fade.",
  title: "Fade Decay",
  type: "number",
  default: 0.97,
  min: 0.9,
  max: 1,
});

export interface SpectrumWaterfall {
  /**
   * Amount of gain between start vertices and first fft window.
   */
  startOffset: number;
}
SpectrumWaterfall.attributes.add("startOffset", {
  description: "Amount of gain between start vertices and first fft window.",
  title: "Start Offset",
  type: "number",
  default: 0.5,
  min: 0,
  max: 1,
});

export interface SpectrumWaterfall {
  /**
   * Vertice color lerp value A.
   */
  colorMin?: pc.Color;
}
SpectrumWaterfall.attributes.add("colorMin", {
  description: "Vertice color (min).",
  title: "Color Low",
  type: "rgba",
  default: [0, 255, 0, 1],
});

export interface SpectrumWaterfall {
  /**
   * Vertice color lerp value B.
   */
  colorMax?: pc.Color;
}
SpectrumWaterfall.attributes.add("colorMax", {
  description: "Vertice color (max).",
  title: "Color Min",
  type: "rgba",
  default: [255, 0, 0, 1],
});

export interface SpectrumWaterfall {
  /**
   * Easter egg.
   */
  cycleColors: boolean;
}
SpectrumWaterfall.attributes.add("cycleColors", {
  description: "Easter egg.",
  title: "Cycle Color",
  type: "boolean",
  default: true,
});

export interface SpectrumWaterfall {
  /**
   * Material.
   */
  materialAsset?: pc.Asset;
}
SpectrumWaterfall.attributes.add("materialAsset", {
  description: "Material asset.",
  title: "Material",
  type: "asset",
});
