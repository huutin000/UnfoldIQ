"use strict";

/**
 * UNFOLDIQ provider registry (STEP 10A).
 * Dynamic registration only — no vendor logic lives in the resolver.
 * Future 10B/10C providers (flow-web, local-comfyui-*, local-kokoro,
 * local-whisper, openai-image, google-veo, elevenlabs-*) register here
 * without changing core resolver architecture.
 *
 * Provider metadata: { providerId, capabilities[], costClass, adapter, availabilityCheck }
 */

const registry = new Map();

const VALID_COST_CLASSES = ["ZERO_LOCAL", "INCLUDED_SUBSCRIPTION", "FREE_TIER", "PAID", "UNKNOWN"];

function registerProvider(meta) {
  if (!meta || typeof meta !== "object") throw new Error("INVALID_PROVIDER_META");
  const { providerId, capabilities, costClass, adapter } = meta;
  if (!providerId || typeof providerId !== "string") throw new Error("PROVIDER_ID_REQUIRED");
  if (!Array.isArray(capabilities) || capabilities.length === 0) throw new Error("PROVIDER_CAPABILITIES_REQUIRED");
  if (!VALID_COST_CLASSES.includes(costClass)) throw new Error(`INVALID_COST_CLASS: ${costClass}`);
  if (!adapter || typeof adapter.execute !== "function") throw new Error("PROVIDER_ADAPTER_EXECUTE_REQUIRED");
  registry.set(providerId, {
    providerId,
    capabilities: [...capabilities],
    costClass,
    adapter,
    availabilityCheck: typeof meta.availabilityCheck === "function" ? meta.availabilityCheck : null,
    planned: meta.planned || null,
  });
  return providerId;
}

function getProvider(providerId) {
  return registry.get(providerId) || null;
}

function listProviders() {
  return [...registry.values()].map((p) => ({
    providerId: p.providerId,
    capabilities: p.capabilities,
    costClass: p.costClass,
    planned: p.planned,
  }));
}

function clearRegistry() {
  registry.clear();
}

module.exports = { registerProvider, getProvider, listProviders, clearRegistry, VALID_COST_CLASSES };
