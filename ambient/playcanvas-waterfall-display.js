(function (exports, pc) {
    'use strict';

    /*! *****************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */
    /* global Reflect, Promise */

    var extendStatics = function(d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };

    function __extends(d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    }

    function rotateHue(color, amount) {
        var cos = Math.cos((amount * Math.PI) / 180);
        var sin = Math.sin((amount * Math.PI) / 180);
        var mR = cos + (1 - cos) / 3;
        var mG = (1 - cos) / 3 - Math.sqrt(1 / 3) * sin;
        var mB = (1 - cos) / 3 + Math.sqrt(1 / 3) * sin;
        color.r = color.r * mR + color.g * mG + color.b * mB;
        color.g = color.r * mB + color.g * mR + color.b * mG;
        color.b = color.r * mG + color.g * mB + color.b * mR;
    }

    var NOISE_FLOOR = 148;
    var color = new pc.Color();
    var SpectrumWaterfall = (function (_super) {
        __extends(SpectrumWaterfall, _super);
        function SpectrumWaterfall() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.material = new pc.StandardMaterial();
            _this.graphNode = new pc.GraphNode();
            return _this;
        }
        SpectrumWaterfall.prototype.initialize = function () {
            var _this = this;
            this.on("attr:fftSize", function () {
                _this.analyzerNode.fftSize = _this.fftSize;
                _this.reset();
            });
            this.on("attr:smoothingTimeConstant", function () {
                _this.analyzerNode.smoothingTimeConstant = _this.smoothingTimeConstant;
            });
            this.on("attr:scaleX", function () {
                _this.calculateExtents();
            });
            this.on("attr:speed", function () {
                _this.calculateExtents();
            });
            this.on("attr:startOffset", function () {
                _this.calculateExtents();
            });
            this.on("attr:length", function () {
                _this.reset();
            });
            this.ctx = this.app.systems.sound.context;
            this.analyzerNode = this.ctx.createAnalyser();
            this.analyzerNode.fftSize = this.fftSize;
            this.analyzerNode.smoothingTimeConstant = this.smoothingTimeConstant;
            if (this.materialAsset) {
                this.material = this.materialAsset.resource;
            }
            this.reset();
        };
        SpectrumWaterfall.prototype.update = function (dt) {
            if (this.cycleColors) {
                rotateHue(this.colorMax, -50 * dt);
                rotateHue(this.colorMin, -50 * dt);
            }
            if (this.active) {
                this.addWindow();
                this.calculateColors();
                this.updateMesh();
            }
        };
        SpectrumWaterfall.prototype.play = function (slotName) {
            if (!this.active) {
                this.active = true;
            }
            this.entity.sound.stop();
            this.playbackInstance = this.entity.sound.play(slotName);
            this.playbackInstance._connectorNode.connect(this.analyzerNode);
        };
        SpectrumWaterfall.prototype.stop = function () {
            this.entity.sound.stop();
        };
        SpectrumWaterfall.prototype.reset = function () {
            var _a, _b;
            this.binCount = this.analyzerNode.frequencyBinCount;
            (_b = (_a = this.playbackInstance) === null || _a === void 0 ? void 0 : _a._connectorNode) === null || _b === void 0 ? void 0 : _b.connect(this.analyzerNode);
            var area = this.binCount * this.length;
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
        };
        SpectrumWaterfall.prototype.addWindow = function () {
            this.analyzerNode.getFloatFrequencyData(this.fftWindowData);
            for (var i = 0; i < this.fftWindowData.length; i++) {
                this.fftWindowData[i] =
                    (this.fftWindowData[i] + NOISE_FLOOR + this.gain) / NOISE_FLOOR;
                this.fftWindowData[i] *= this.amp;
            }
            var len = this.fftWindowData.length;
            for (var i = this.bins.length - 1 - len; i > 0; i--) {
                this.bins[i + len] = this.bins[i];
            }
            for (var i = 0; i < len; i++) {
                this.bins[i] = this.fftWindowData[i];
            }
            for (var i = this.vertices.length / 3 - len; i < this.vertices.length / 3; i++) {
                this.vertices[i * 3 + 1] = 0;
            }
            for (var i = 0; i < len; i++) {
                this.vertices[i * 3 + 1] = 0;
            }
            for (var i = len; i < this.vertices.length / 3 - len; i++) {
                this.vertices[i * 3 + 1] = Math.max(0, this.bins[i]);
            }
        };
        SpectrumWaterfall.prototype.updateMesh = function (firstUpdate) {
            if (firstUpdate === void 0) { firstUpdate = false; }
            this.mesh.setPositions(this.vertices);
            this.mesh.setColors(this.colors);
            this.mesh.setNormals(pc.calculateNormals(this.vertices, this.triangles));
            if (firstUpdate) {
                this.mesh.setUvs(0, this.uvs);
                this.mesh.setIndices(this.triangles);
            }
            this.mesh.update(pc.PRIMITIVE_TRIANGLES);
        };
        SpectrumWaterfall.prototype.createMeshInstance = function () {
            this.mesh = new pc.Mesh(this.app.graphicsDevice);
            this.mesh.clear(true, true);
            this.updateMesh(true);
            this.graphNode = new pc.GraphNode();
            this.meshInstance = new pc.MeshInstance(this.graphNode, this.mesh, this.material);
            if (!this.entity.model) {
                this.entity.addComponent("model");
            }
            var model = new pc.Model();
            model.graph = this.graphNode;
            model.meshInstances = [this.meshInstance];
            this.entity.model.model = model;
        };
        SpectrumWaterfall.prototype.calculateColors = function () {
            var wL = this.fftWindowData.length;
            for (var i = this.colors.length - 1 - wL * 4; i > 0; i--) {
                this.colors[i + wL * 4] = this.colors[i];
            }
            for (var i = 0; i < wL; i++) {
                color.set(0, 0, 0, 0);
                color.lerp(this.colorMin, this.colorMax, Math.max(0, Math.min(1, this.bins[i] / this.amp)));
                this.colors[i * 4 + 0] = color.r;
                this.colors[i * 4 + 1] = color.g;
                this.colors[i * 4 + 2] = color.b;
                this.colors[i * 4 + 3] = i === 0 || i === this.binCount - 1 ? 0 : color.a;
            }
            if (this.fadeDecay !== 1) {
                for (var x = 0; x < this.binCount; x++) {
                    for (var y = 0; y < this.length; y++) {
                        var i = x + y * this.binCount;
                        this.colors[i * 4 + 3] *= this.fadeDecay;
                    }
                }
            }
        };
        SpectrumWaterfall.prototype.calculateExtents = function () {
            var scaleX = this.scaleX / this.binCount;
            for (var z = 0; z < this.length; z++) {
                for (var x = 0; x < this.binCount; x++) {
                    var i = x + z * this.binCount;
                    this.vertices[3 * i] = (-x + this.binCount / 2) * scaleX;
                    if (z === 0) {
                        this.vertices[3 * i + 2] = 0;
                    }
                    else if (z === 1) {
                        this.vertices[3 * i + 2] = this.startOffset * 2;
                    }
                    else {
                        var referenceSpeed = 256 / this.analyzerNode.frequencyBinCount;
                        this.vertices[3 * i + 2] =
                            this.startOffset * 2 + z * this.speed * referenceSpeed;
                    }
                }
            }
        };
        SpectrumWaterfall.prototype.calculateUvs = function () {
            for (var z = 0; z < this.length; z++) {
                for (var x = 0; x < this.binCount; x++) {
                    var i = x + z * this.binCount;
                    this.uvs[2 * i] = x / this.binCount;
                    this.uvs[2 * i + 1] = 1 - z / this.length;
                }
            }
        };
        SpectrumWaterfall.prototype.calculateTriangles = function () {
            this.triangles = [];
            for (var x = 0; x < this.length - 1; x++) {
                for (var y = 0; y < this.binCount - 1; y++) {
                    this.triangles.push(x * this.binCount + y + 1, (x + 1) * this.binCount + y, x * this.binCount + y, (x + 1) * this.binCount + y, x * this.binCount + y + 1, (x + 1) * this.binCount + y + 1);
                }
            }
        };
        return SpectrumWaterfall;
    }(pc.ScriptType));
    pc.registerScript(SpectrumWaterfall, "spectrumWaterfall");
    SpectrumWaterfall.attributes.add("active", {
        description: "Curently recording FFT windows.",
        title: "Active",
        default: true,
        type: "boolean",
    });
    SpectrumWaterfall.attributes.add("fftSize", {
        description: "The fftSize property of the AnalyserNode interface is an unsigned long value and represents the window size in samples that is used when performing a Fast Fourier Transform (FFT) to get frequency domain data.",
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
    SpectrumWaterfall.attributes.add("smoothingTimeConstant", {
        description: "The smoothingTimeConstant property of the AnalyserNode interface is a double value representing the averaging constant with the last analysis frame.",
        title: "Smoothing",
        type: "number",
        default: 0.7,
        min: 0,
        max: 1,
    });
    SpectrumWaterfall.attributes.add("scaleX", {
        description: "Mesh X axis extent.",
        title: "Scale X",
        type: "number",
        default: 16,
        min: 1,
        max: 32,
        precision: 0.1,
    });
    SpectrumWaterfall.attributes.add("amp", {
        description: "Mesh Z axis extent.",
        title: "Amp",
        type: "number",
        default: 1,
        min: 0.01,
        max: 4,
    });
    SpectrumWaterfall.attributes.add("speed", {
        description: "The rate of Z axis movement over time.",
        title: "Speed",
        type: "number",
        default: 1,
        min: 0.001,
        max: 1,
    });
    SpectrumWaterfall.attributes.add("gain", {
        description: "Gain gain applid to visualization.",
        title: "Gain",
        type: "number",
        default: 0,
        min: -48,
        max: 48,
    });
    SpectrumWaterfall.attributes.add("length", {
        description: "The number of FFT windows stored from previous updates.",
        title: "Length",
        type: "number",
        default: 128,
        min: 4,
        max: 256,
        precision: 0.1,
    });
    SpectrumWaterfall.attributes.add("fadeDecay", {
        description: "Animate fade.",
        title: "Fade Decay",
        type: "number",
        default: 0.97,
        min: 0.9,
        max: 1,
    });
    SpectrumWaterfall.attributes.add("startOffset", {
        description: "Amount of gain between start vertices and first fft window.",
        title: "Start Offset",
        type: "number",
        default: 0.5,
        min: 0,
        max: 1,
    });
    SpectrumWaterfall.attributes.add("colorMin", {
        description: "Vertice color (min).",
        title: "Color Low",
        type: "rgba",
        default: [0, 255, 0, 1],
    });
    SpectrumWaterfall.attributes.add("colorMax", {
        description: "Vertice color (max).",
        title: "Color Min",
        type: "rgba",
        default: [255, 0, 0, 1],
    });
    SpectrumWaterfall.attributes.add("cycleColors", {
        description: "Easter egg.",
        title: "Cycle Color",
        type: "boolean",
        default: true,
    });
    SpectrumWaterfall.attributes.add("materialAsset", {
        description: "Material asset.",
        title: "Material",
        type: "asset",
    });

    exports.SpectrumWaterfall = SpectrumWaterfall;

}(this.pc = this.pc || {}, pc));
