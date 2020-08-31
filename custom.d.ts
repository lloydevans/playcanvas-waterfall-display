declare module "*.glsl";
declare module "*.vert";
declare module "*.frag";

// Project type mixins.
declare namespace pc {
  interface ComponentSystemRegistry {
    sound: SoundComponentSystem;
  }

  interface ScriptComponent {
    waterfallDisplay?: import("./src/waterfall-display").WaterfallDisplay;
  }
}
