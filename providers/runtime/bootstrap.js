"use strict";

/**
 * UNFOLDIQ provider runtime bootstrap (STEP 10A).
 * Registers the 4 foundation adapters. Vendor adapters (10B/10C)
 * register themselves the same way without touching the resolver.
 */

const { registerProvider, clearRegistry } = require("./registry");

function registerCoreProviders() {
  clearRegistry();
  registerProvider({
    providerId: "existing",
    capabilities: ["image", "video", "tts", "stt", "music", "sfx"],
    costClass: "ZERO_LOCAL",
    adapter: require("./adapters/existing"),
  });
  registerProvider({
    providerId: "approved-local",
    capabilities: ["image", "video", "voice", "music", "sfx"],
    costClass: "ZERO_LOCAL",
    adapter: require("./adapters/approved-local"),
  });
  registerProvider({
    providerId: "agent-native",
    capabilities: ["image", "video", "tts", "stt", "music", "sfx"],
    costClass: "ZERO_LOCAL",
    adapter: require("./adapters/agent-native"),
  });
  registerProvider({
    providerId: "external-handoff",
    capabilities: ["image", "video", "tts", "stt", "music", "sfx"],
    costClass: "UNKNOWN",
    adapter: require("./adapters/external-handoff"),
  });
}

function registerAllProviders() {
  registerCoreProviders();
  const steps = [
    ["./adapters/flow-web", "registerFlowWeb"],
    ["./adapters/local-comfyui-image", "registerLocalComfyuiImage"],
    ["./adapters/local-comfyui-video", "registerLocalComfyuiVideo"],
    ["./adapters/local-kokoro", "registerLocalKokoro"],
    ["./adapters/local-whisper", "registerLocalWhisper"],
    ["./adapters/cloud-openai-image", "registerOpenaiImage"],
    ["./adapters/cloud-google-veo", "registerGoogleVeo"],
    ["./adapters/cloud-elevenlabs-tts", "registerElevenlabsTts"],
    ["./adapters/cloud-elevenlabs-stt", "registerElevenlabsStt"],
    ["./adapters/configured-cloud", "registerConfiguredCloud"],
  ];
  const registered = [];
  for (const [modPath, fnName] of steps) {
    try {
      const mod = require(modPath);
      if (mod && typeof mod[fnName] === "function") {
        registered.push(mod[fnName]());
      }
    } catch {
      // adapter absent or registration failed → resolver skips safely
    }
  }
  return registered;
}

module.exports = { registerCoreProviders, registerAllProviders };
