"use strict";

/**
 * ComfyUI parameter mapper (STEP-10C Branch A).
 * Deterministic: same request → deep-equal output. No randomness.
 */

const crypto = require("crypto");

function deterministicSeed(requestId) {
  const id = String(requestId || "unknown");
  const hex = crypto.createHash("sha256").update(id, "utf8").digest("hex").slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

function parseBinding(binding) {
  const s = String(binding);
  const parts = s.split(".");
  if (parts[0] === "nodes") parts.shift();
  if (parts.length < 3) return null;
  if (parts[1] !== "inputs") return null;
  const nodeId = parts[0];
  const field = parts.slice(2).join(".");
  if (!nodeId || !field) return null;
  return { nodeId, field };
}

function applyBinding(patch, binding, value) {
  const parsed = parseBinding(binding);
  if (!parsed) return;
  if (!patch[parsed.nodeId]) patch[parsed.nodeId] = { inputs: {} };
  if (!patch[parsed.nodeId].inputs) patch[parsed.nodeId].inputs = {};
  patch[parsed.nodeId].inputs[parsed.field] = value;
}

function outputSize(request, kind) {
  const out = (request && request.outputRequirements) || {};
  let width = out.width;
  let height = out.height;
  if (typeof width !== "number" && typeof height !== "number" && typeof out.aspectRatio === "string") {
    const ar = out.aspectRatio;
    if (kind === "image") {
      if (ar === "16:9") { width = 1344; height = 768; }
      else if (ar === "9:16") { width = 768; height = 1344; }
      else { width = 1024; height = 1024; }
    } else {
      if (ar === "9:16") { width = 720; height = 1280; }
      else if (ar === "1:1") { width = 720; height = 720; }
      else { width = 1280; height = 720; }
    }
  }
  if (typeof width !== "number") width = kind === "image" ? 1024 : 1280;
  if (typeof height !== "number") height = kind === "image" ? 1024 : 720;
  return { width, height };
}

function continuityRefs(request) {
  const cc = (request && request.continuityContext) || {};
  if (Array.isArray(cc.requiredReferences)) return cc.requiredReferences.slice();
  return [];
}

function mapParams(kind, request, workflowEntry) {
  const req = request || {};
  const entry = workflowEntry || {};
  const bindings = entry.parameterBindings || {};
  const patch = {};
  const input = req.input || {};

  const prompt = input.prompt !== undefined ? input.prompt : input.text !== undefined ? input.text : "";
  if (bindings.prompt) applyBinding(patch, bindings.prompt, prompt);
  if (bindings.text && bindings.text !== bindings.prompt) applyBinding(patch, bindings.text, prompt);

  const size = outputSize(req, kind);
  if (bindings.width) applyBinding(patch, bindings.width, size.width);
  if (bindings.height) applyBinding(patch, bindings.height, size.height);

  const seed = deterministicSeed(req.requestId);
  if (bindings.seed) applyBinding(patch, bindings.seed, seed);

  if (typeof input.steps === "number" && bindings.steps) {
    applyBinding(patch, bindings.steps, input.steps);
  }

  const out = req.outputRequirements || {};
  if (bindings.frames && typeof out.generationLength === "string") {
    const supported = Array.isArray(entry.supportedDurations) ? entry.supportedDurations : null;
    if (!supported || supported.includes(out.generationLength)) {
      const m = String(out.generationLength).match(/^(\d+)\s*s$/i);
      if (m) applyBinding(patch, bindings.frames, parseInt(m[1], 10) * 24);
    }
  } else if (bindings.frames && typeof input.frames === "number") {
    applyBinding(patch, bindings.frames, input.frames);
  }
  if (bindings.duration && typeof out.generationLength === "string") {
    applyBinding(patch, bindings.duration, out.generationLength);
  }

  const refs = continuityRefs(req);
  if (refs.length > 0) {
    if (entry.continuityReferenceBinding && typeof entry.continuityReferenceBinding === "string") {
      applyBinding(patch, entry.continuityReferenceBinding, refs);
    } else if (bindings.continuityReferenceSlot && typeof bindings.continuityReferenceSlot === "string") {
      applyBinding(patch, bindings.continuityReferenceSlot, refs);
    } else {
      patch._unboundContinuityRefs = refs.slice();
    }
  }

  return patch;
}

function mapImageParams(request, workflowEntry) {
  return mapParams("image", request, workflowEntry);
}

function mapVideoParams(request, workflowEntry) {
  return mapParams("video", request, workflowEntry);
}

module.exports = { mapImageParams, mapVideoParams, deterministicSeed };
