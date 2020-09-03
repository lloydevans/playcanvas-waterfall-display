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
        var r = color.r * mR + color.g * mG + color.b * mB;
        var g = color.r * mB + color.g * mR + color.b * mG;
        var b = color.r * mG + color.g * mB + color.b * mR;
        color.r = r;
        color.g = g;
        color.b = b;
    }

    var NOISE_FLOOR = 148;
    var color = new pc.Color();
    var WaterfallDisplay = (function (_super) {
        __extends(WaterfallDisplay, _super);
        function WaterfallDisplay() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.material = new pc.StandardMaterial();
            _this.graphNode = new pc.GraphNode();
            _this.binVector = new pc.Vec3();
            _this.quat = new pc.Quat();
            return _this;
        }
        WaterfallDisplay.prototype.initialize = function () {
            var _this = this;
            this.on("attr:fftSize", function () {
                _this.analyzerNode.fftSize = _this.fftSize;
                _this.binCount = _this.analyzerNode.frequencyBinCount;
                _this.reset();
            });
            this.on("attr:smoothingTimeConstant", function () {
                _this.analyzerNode.smoothingTimeConstant = _this.smoothingTimeConstant;
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
        WaterfallDisplay.prototype.update = function (dt) {
            if (this.cycleColors) {
                rotateHue(this.colorMax, -50 * dt);
                rotateHue(this.colorMin, -50 * dt);
            }
            if (this.active) {
                this.addWindow();
                if (this.fadeDecay !== 1) {
                    for (var i = 0; i < this.colors.length / 4; i++) {
                        this.colors[i * 4 + 3] *= this.fadeDecay;
                    }
                }
                for (var i = this.binCount; i < this.vertices.length / 3; i++) {
                    this.vertices[3 * i + 0] += this.velocity.x;
                    this.vertices[3 * i + 1] += this.velocity.y;
                    this.vertices[3 * i + 2] += this.velocity.z;
                }
                this.updateMesh();
            }
        };
        WaterfallDisplay.prototype.play = function (slotName) {
            var _a, _b;
            if (!this.active) {
                this.active = true;
            }
            this.entity.sound.stop();
            this.playbackInstance = this.entity.sound.play(slotName);
            (_b = (_a = this.playbackInstance) === null || _a === void 0 ? void 0 : _a._connectorNode) === null || _b === void 0 ? void 0 : _b.connect(this.analyzerNode);
        };
        WaterfallDisplay.prototype.stop = function () {
            this.entity.sound.stop();
        };
        WaterfallDisplay.prototype.reset = function () {
            var _a, _b;
            this.binCount = this.analyzerNode.frequencyBinCount;
            (_b = (_a = this.playbackInstance) === null || _a === void 0 ? void 0 : _a._connectorNode) === null || _b === void 0 ? void 0 : _b.connect(this.analyzerNode);
            var area = this.binCount * this.length;
            this.fftWindowData = new Float32Array(this.binCount);
            this.bins = new Float32Array(area);
            this.vertices = new Float32Array(3 * area);
            this.uvs = new Float32Array(2 * area);
            this.colors = new Float32Array(4 * area).fill(1, 0, 4 * area);
            this.calculateUvs();
            this.calculateTriangles();
            this.createMeshInstance();
        };
        WaterfallDisplay.prototype.addWindow = function () {
            this.analyzerNode.getFloatFrequencyData(this.fftWindowData);
            var len = this.fftWindowData.length;
            for (var i = 0; i < this.fftWindowData.length; i++) {
                this.fftWindowData[i] = (this.fftWindowData[i] + NOISE_FLOOR + this.gain) / NOISE_FLOOR;
                this.fftWindowData[i] *= this.amp;
            }
            for (var i = this.bins.length - 1 - len; i >= 0; i--) {
                this.bins[i + len] = this.bins[i];
            }
            for (var i = this.colors.length - 1 - len * 4; i >= 0; i--) {
                this.colors[i + len * 4] = this.colors[i];
            }
            for (var i = this.vertices.length - 1 - len * 3; i >= 0; i--) {
                this.vertices[i + len * 3] = this.vertices[i];
            }
            for (var i = 0; i < len; i++) {
                this.bins[i] = this.fftWindowData[i];
            }
            for (var i = 0; i < len; i++) {
                color.set(0, 0, 0, 0);
                switch (this.colorMode) {
                    case "amp":
                        color.lerp(this.colorMin, this.colorMax, Math.max(0, Math.min(1, this.fftWindowData[i] / this.amp)));
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
            for (var i = 0; i < len; i++) {
                var scale = this.width / len;
                this.binVector.x = i * scale - this.width / 2;
                this.binVector.y = Math.max(0, this.fftWindowData[i]);
                this.binVector.z = 0;
                this.quat.setFromEulerAngles(this.rotation.x, this.rotation.y, this.rotation.z);
                this.quat.transformVector(this.binVector, this.binVector);
                this.vertices[i * 3 + 0] = this.binVector.x + this.position.x;
                this.vertices[i * 3 + 1] = this.binVector.y + this.position.y;
                this.vertices[i * 3 + 2] = this.binVector.z + this.position.z;
            }
        };
        WaterfallDisplay.prototype.updateMesh = function (firstUpdate) {
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
        WaterfallDisplay.prototype.createMeshInstance = function () {
            this.mesh = new pc.Mesh(this.app.graphicsDevice);
            this.mesh.clear(true, true);
            this.updateMesh(true);
            this.graphNode = new pc.GraphNode();
            this.meshInstance = new pc.MeshInstance(this.graphNode, this.mesh, this.material);
            this.meshInstance.renderStyle = pc.RENDERSTYLE_SOLID;
            if (!this.entity.model) {
                this.entity.addComponent("model");
            }
            var model = new pc.Model();
            model.graph = this.graphNode;
            model.meshInstances = [this.meshInstance];
            this.entity.model.model = model;
        };
        WaterfallDisplay.prototype.calculateUvs = function () {
            for (var z = 0; z < this.length; z++) {
                for (var x = 0; x < this.binCount; x++) {
                    var i = x + z * this.binCount;
                    this.uvs[2 * i] = x / this.binCount;
                    this.uvs[2 * i + 1] = 1 - z / this.length;
                }
            }
        };
        WaterfallDisplay.prototype.calculateTriangles = function () {
            this.triangles = [];
            for (var x = 0; x < this.binCount - 1; x++) {
                for (var y = 0; y < this.length - 1; y++) {
                    this.triangles.push(x + 1 + y * this.binCount, x + (y + 1) * this.binCount, x + y * this.binCount, x + (y + 1) * this.binCount, x + 1 + y * this.binCount, x + 1 + (y + 1) * this.binCount);
                }
            }
        };
        return WaterfallDisplay;
    }(pc.ScriptType));
    pc.registerScript(WaterfallDisplay, "waterfallDisplay");
    WaterfallDisplay.attributes.add("active", {
        description: "Curently recording FFT windows.",
        title: "Active",
        default: true,
        type: "boolean",
    });
    WaterfallDisplay.attributes.add("fftSize", {
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
    WaterfallDisplay.attributes.add("position", {
        description: "Spawn point for new windows.",
        title: "Position",
        type: "vec3",
        default: [0, 0, 0],
    });
    WaterfallDisplay.attributes.add("rotation", {
        description: "Spawn rotation.",
        title: "Rotation",
        type: "vec3",
        default: [0, 0, 0],
    });
    WaterfallDisplay.attributes.add("velocity", {
        description: "Static velocity.",
        title: "Velocity",
        type: "vec3",
        default: [0, 0, 0],
    });
    WaterfallDisplay.attributes.add("smoothingTimeConstant", {
        description: "The smoothingTimeConstant property of the AnalyserNode interface is a double value representing the averaging constant with the last analysis frame.",
        title: "Smoothing",
        type: "number",
        default: 0.7,
        min: 0,
        max: 1,
    });
    WaterfallDisplay.attributes.add("width", {
        description: "Trail width extent.",
        title: "Width",
        type: "number",
        default: 1,
        min: 0,
        max: 64,
    });
    WaterfallDisplay.attributes.add("amp", {
        description: "Mesh Z axis extent.",
        title: "Amp",
        type: "number",
        default: 1,
        min: 0.01,
        max: 10,
    });
    WaterfallDisplay.attributes.add("speed", {
        description: "The rate of Z axis movement over time.",
        title: "Speed",
        type: "number",
        default: 0.5,
        min: 0.001,
        max: 1,
    });
    WaterfallDisplay.attributes.add("gain", {
        description: "Gain gain applid to visualization.",
        title: "Gain",
        type: "number",
        default: 0,
        min: -48,
        max: 48,
    });
    WaterfallDisplay.attributes.add("length", {
        description: "The number of FFT windows stored from previous updates.",
        title: "Length",
        type: "number",
        default: 128,
        min: 1,
        max: 256,
        precision: 0.1,
    });
    WaterfallDisplay.attributes.add("fadeDecay", {
        description: "Animate fade.",
        title: "Fade Decay",
        type: "number",
        default: 0.97,
        min: 0.9,
        max: 1,
    });
    WaterfallDisplay.attributes.add("colorMax", {
        description: "Vertice color (max).",
        title: "Color Max",
        type: "rgba",
        default: [1, 0, 0, 1],
    });
    WaterfallDisplay.attributes.add("colorMin", {
        description: "Vertice color (min).",
        title: "Color Min",
        type: "rgba",
        default: [0, 1, 0, 1],
    });
    WaterfallDisplay.attributes.add("cycleColors", {
        description: "Easter egg.",
        title: "Cycle Color",
        type: "boolean",
        default: false,
    });
    WaterfallDisplay.attributes.add("colorMode", {
        description: "",
        title: "Color Mode",
        type: "string",
        enum: [{ Amp: "amp" }, { Frequency: "freq" }],
        default: "amp",
    });
    WaterfallDisplay.attributes.add("materialAsset", {
        description: "Material asset.",
        title: "Material",
        type: "asset",
    });

    exports.WaterfallDisplay = WaterfallDisplay;

}(this.pc = this.pc || {}, pc));
