import typescript from "@rollup/plugin-typescript";
import { string } from "rollup-plugin-string";

export default {
  input: "src/index.ts",

  external: ["playcanvas"],

  plugins: [
    string({
      include: [
        //
        "src/**/*.glsl",
        "src/**/*.vert",
        "src/**/*.frag",
      ],
    }),
    typescript(),
  ],

  output: {
    sourcemap: false,
    file: "ambient/playcanvas-waterfall-display.js",
    format: "iife",
    name: "pc",
    extend: true,
    globals: {
      playcanvas: "pc",
    },
  },
};
