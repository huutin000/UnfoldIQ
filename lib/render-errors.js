"use strict";
// lib/render-errors.js — STEP-12 Branch A (Node side).
// Canonical render-pipeline error type. Plain Node.js CommonJS, no deps.

var CODES = {
  RENDER_INPUT_BLOCKED: "RENDER_INPUT_BLOCKED",
  RENDER_PROP_INVALID: "RENDER_PROP_INVALID",
  ASSET_STAGE_FAILED: "ASSET_STAGE_FAILED",
  ASSET_NOT_STAGED: "ASSET_NOT_STAGED",
  INVALID_FRAME_RANGE: "INVALID_FRAME_RANGE",
  VISUAL_GAP: "VISUAL_GAP",
  AUDIO_PLAN_INVALID: "AUDIO_PLAN_INVALID",
  CAPTION_PLAN_INVALID: "CAPTION_PLAN_INVALID",
  COMPOSITION_METADATA_INVALID: "COMPOSITION_METADATA_INVALID",
  RENDER_FAILED: "RENDER_FAILED"
};

function RenderError(code, message, ctx) {
  if (!(this instanceof RenderError)) {
    return new RenderError(code, message, ctx);
  }
  if (!Object.prototype.hasOwnProperty.call(CODES, code)) {
    throw new Error("RenderError: unknown code " + String(code));
  }
  this.name = "RenderError";
  this.code = code;
  this.message = String(message);
  ctx = ctx && typeof ctx === "object" ? ctx : {};
  if (ctx.projectId !== undefined) this.projectId = ctx.projectId;
  if (ctx.sceneId !== undefined) this.sceneId = ctx.sceneId;
  if (ctx.layerId !== undefined) this.layerId = ctx.layerId;
  if (ctx.assetId !== undefined) this.assetId = ctx.assetId;
  if (ctx.reasons !== undefined) this.reasons = ctx.reasons;
  if (ctx.reason !== undefined) this.reason = ctx.reason;
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, RenderError);
  }
}
RenderError.prototype = Object.create(Error.prototype);
RenderError.prototype.constructor = RenderError;

function make(code, msg, ctx) {
  return new RenderError(code, msg, ctx);
}

function isRenderError(err) {
  return err instanceof RenderError || (!!err && err.name === "RenderError" && typeof err.code === "string");
}

module.exports = {
  RenderError: RenderError,
  Codes: CODES,
  make: make,
  isRenderError: isRenderError
};
