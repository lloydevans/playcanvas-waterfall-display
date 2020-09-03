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
export class WaterfallDisplay extends pc.ScriptType {
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
   * Mesh.
   */
  protected mesh: pc.Mesh;

  /**
   * Mesh instance reference.
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
   * TODO: optimize normal calculations.
   */
  protected normals: Float32Array[];

  /**
   * Reused vector object for calculating new bin positions.
   */
  protected binVector: pc.Vec3 = new pc.Vec3();

  /**
   * Reused quaternion object for calculating new bin positions.
   */
  protected quat: pc.Quat = new pc.Quat();

  /**
   * Called when script is about to run for the first time.
   */
  public initialize() {
    this.on("attr:fftSize", () => {
      this.analyzerNode.fftSize = this.fftSize;
      this.binCount = this.analyzerNode.frequencyBinCount;
      this.reset();
    });

    this.on("attr:smoothingTimeConstant", () => {
      this.analyzerNode.smoothingTimeConstant = this.smoothingTimeConstant;
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

      // Simple fade decay effect.
      if (this.fadeDecay !== 1) {
        for (let i = 0; i < this.colors.length / 4; i++) {
          this.colors[i * 4 + 3] *= this.fadeDecay;
        }
      }

      // Add fixed velocity.
      for (let i = this.binCount; i < this.vertices.length / 3; i++) {
        this.vertices[3 * i + 0] += this.velocity.x;
        this.vertices[3 * i + 1] += this.velocity.y;
        this.vertices[3 * i + 2] += this.velocity.z;
      }

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
    this.playbackInstance?._connectorNode?.connect(this.analyzerNode);
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
    this.colors = new Float32Array(4 * area).fill(1, 0, 4 * area);
    this.calculateUvs();
    this.calculateTriangles();
    this.createMeshInstance();
  }

  /**
   * Add an FFT window to the bins array and update the geometry height.
   */
  private addWindow() {
    this.analyzerNode.getFloatFrequencyData(this.fftWindowData);

    let len = this.fftWindowData.length;

    for (let i = 0; i < this.fftWindowData.length; i++) {
      this.fftWindowData[i] = (this.fftWindowData[i] + NOISE_FLOOR + this.gain) / NOISE_FLOOR;
      this.fftWindowData[i] *= this.amp;
    }

    // Shift arrays.
    for (let i = this.bins.length - 1 - len; i >= 0; i--) {
      this.bins[i + len] = this.bins[i];
    }
    for (let i = this.colors.length - 1 - len * 4; i >= 0; i--) {
      this.colors[i + len * 4] = this.colors[i];
    }
    for (let i = this.vertices.length - 1 - len * 3; i >= 0; i--) {
      this.vertices[i + len * 3] = this.vertices[i];
    }

    // Add new bins.
    for (let i = 0; i < len; i++) {
      this.bins[i] = this.fftWindowData[i];
    }

    // Add new colors.
    for (let i = 0; i < len; i++) {
      color.set(0, 0, 0, 0);

      switch (this.colorMode) {
        case "amp":
          color.lerp(
            this.colorMin,
            this.colorMax,
            Math.max(0, Math.min(1, this.fftWindowData[i] / this.amp)),
          );
          break;

        case "freq":
          color.lerp(this.colorMin, this.colorMax, Math.max(0, i / len));
          break;
      }

      this.colors[i * 4 + 0] = color.r;
      this.colors[i * 4 + 1] = color.g;
      this.colors[i * 4 + 2] = color.b;
      this.colors[i * 4 + 3] = color.a;
    }

    // Update rotation quaternion.
    this.quat.setFromEulerAngles(this.rotation.x, this.rotation.y, this.rotation.z);

    // Add new vertices.
    for (let i = 0; i < len; i++) {
      let scale = this.width / len;

      // Calculated unrotated position.
      this.binVector.x = i * scale - this.width / 2;
      this.binVector.y = Math.max(0, this.fftWindowData[i]);
      this.binVector.z = 0;

      // Rotate by rotation attribute.
      this.quat.transformVector(this.binVector, this.binVector);

      // Update vertices.
      this.vertices[i * 3 + 0] = this.binVector.x + this.position.x;
      this.vertices[i * 3 + 1] = this.binVector.y + this.position.y;
      this.vertices[i * 3 + 2] = this.binVector.z + this.position.z;
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

    this.meshInstance = new pc.MeshInstance(this.graphNode, this.mesh, this.material);
    this.meshInstance.renderStyle = pc.RENDERSTYLE_SOLID;

    if (!this.entity.model) {
      this.entity.addComponent("model");
    }

    let model = new pc.Model();
    model.graph = this.graphNode;
    model.meshInstances = [this.meshInstance];
    this.entity.model.model = model;
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

    for (let x = 0; x < this.binCount - 1; x++) {
      for (let y = 0; y < this.length - 1; y++) {
        this.triangles.push(
          x + 1 + y * this.binCount,
          x + (y + 1) * this.binCount,
          x + y * this.binCount,
          x + (y + 1) * this.binCount,
          x + 1 + y * this.binCount,
          x + 1 + (y + 1) * this.binCount,
        );
      }
    }
  }
}

/**
 * Register class.
 */
pc.registerScript(WaterfallDisplay, "waterfallDisplay");

export interface WaterfallDisplay {
  /**
   * Currently recording FFT windows.
   */
  active?: boolean;
}
WaterfallDisplay.attributes.add("active", {
  description: "Curently recording FFT windows.",
  title: "Active",
  default: true,
  type: "boolean",
});

export interface WaterfallDisplay {
  /**
   * The fftSize property of the AnalyserNode interface is an unsigned long value and represents the window size in samples that is used when performing a Fast Fourier Transform (FFT) to get frequency domain data.
   */
  fftSize: 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096;
}
WaterfallDisplay.attributes.add("fftSize", {
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

export interface WaterfallDisplay {
  /**
   * Offset the point vectors are generated from.
   */
  position: pc.Vec3;
}
WaterfallDisplay.attributes.add("position", {
  description: "Spawn point for new windows.",
  title: "Position",
  type: "vec3",
  default: [0, 0, 0],
});

export interface WaterfallDisplay {
  /**
   * Spawn rotation.
   */
  rotation: pc.Vec3;
}
WaterfallDisplay.attributes.add("rotation", {
  description: "Spawn rotation.",
  title: "Rotation",
  type: "vec3",
  default: [0, 0, 0],
});

export interface WaterfallDisplay {
  /**
   * Static velocity.
   */
  velocity: pc.Vec3;
}
WaterfallDisplay.attributes.add("velocity", {
  description: "Static velocity.",
  title: "Velocity",
  type: "vec3",
  default: [0, 0, 0],
});

export interface WaterfallDisplay {
  /**
   * The smoothingTimeConstant property of the AnalyserNode interface is a double value representing the averaging constant with the last analysis frame.
   */
  smoothingTimeConstant: number;
}
WaterfallDisplay.attributes.add("smoothingTimeConstant", {
  description:
    "The smoothingTimeConstant property of the AnalyserNode interface is a double value representing the averaging constant with the last analysis frame.",
  title: "Smoothing",
  type: "number",
  default: 0.7,
  min: 0,
  max: 1,
});

export interface WaterfallDisplay {
  /**
   * Trail width extent.
   */
  width: number;
}
WaterfallDisplay.attributes.add("width", {
  description: "Trail width extent.",
  title: "Width",
  type: "number",
  default: 1,
  min: 0,
  max: 64,
});

export interface WaterfallDisplay {
  /**
   * Mesh Z axis extent.
   */
  amp: number;
}
WaterfallDisplay.attributes.add("amp", {
  description: "Mesh Z axis extent.",
  title: "Amp",
  type: "number",
  default: 1,
  min: 0.01,
  max: 10,
});

export interface WaterfallDisplay {
  /**
   * The rate of Z axis movement over time.
   */
  speed: number;
}
WaterfallDisplay.attributes.add("speed", {
  description: "The rate of Z axis movement over time.",
  title: "Speed",
  type: "number",
  default: 0.5,
  min: 0.001,
  max: 1,
});

export interface WaterfallDisplay {
  /**
   * Gain applid to visualization.
   */
  gain: number;
}
WaterfallDisplay.attributes.add("gain", {
  description: "Gain gain applid to visualization.",
  title: "Gain",
  type: "number",
  default: 0,
  min: -48,
  max: 48,
});

export interface WaterfallDisplay {
  /**
   * The number of FFT windows stored from previous updates.
   */
  length: number;
}
WaterfallDisplay.attributes.add("length", {
  description: "The number of FFT windows stored from previous updates.",
  title: "Length",
  type: "number",
  default: 128,
  min: 1,
  max: 256,
  precision: 0.1,
});

export interface WaterfallDisplay {
  /**
   * Animate fade.
   */
  fadeDecay: number;
}
WaterfallDisplay.attributes.add("fadeDecay", {
  description: "Animate fade.",
  title: "Fade Decay",
  type: "number",
  default: 0.97,
  min: 0.9,
  max: 1,
});

export interface WaterfallDisplay {
  /**
   * Vertice color lerp value B.
   */
  colorMax: pc.Color;
}
WaterfallDisplay.attributes.add("colorMax", {
  description: "Vertice color (max).",
  title: "Color Max",
  type: "rgba",
  default: [1, 0, 0, 1],
});

export interface WaterfallDisplay {
  /**
   * Vertice color lerp value A.
   */
  colorMin: pc.Color;
}
WaterfallDisplay.attributes.add("colorMin", {
  description: "Vertice color (min).",
  title: "Color Min",
  type: "rgba",
  default: [0, 1, 0, 1],
});

export interface WaterfallDisplay {
  /**
   * Easter egg.
   */
  cycleColors: boolean;
}
WaterfallDisplay.attributes.add("cycleColors", {
  description: "Easter egg.",
  title: "Cycle Color",
  type: "boolean",
  default: false,
});

export interface WaterfallDisplay {
  /**
   *
   */
  colorMode: "amp" | "freq";
}
WaterfallDisplay.attributes.add("colorMode", {
  description: "",
  title: "Color Mode",
  type: "string",
  enum: [{ Amp: "amp" }, { Frequency: "freq" }],
  default: "amp",
});

export interface WaterfallDisplay {
  /**
   * Material.
   */
  materialAsset?: pc.Asset;
}
WaterfallDisplay.attributes.add("materialAsset", {
  description: "Material asset.",
  title: "Material",
  type: "asset",
});
