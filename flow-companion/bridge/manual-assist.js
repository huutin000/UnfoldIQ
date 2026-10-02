"use strict";

/**
 * Flow Companion manual-assist packet builder (STEP 10B).
 * When UI automation cannot proceed, the user gets everything needed
 * to complete generation manually — no context reconstruction required.
 */

function buildManualAssistPacket(job) {
  if (!job) throw new Error("JOB_REQUIRED");
  const cc = job.continuityContext || {};
  return {
    version: "1.0.0",
    jobId: job.jobId,
    requestId: job.requestId,
    projectId: job.projectId,
    sceneId: job.sceneId,
    capability: job.capability,
    prompt: job.prompt,
    modelPreference: job.modelPreference || null,
    aspectRatio: job.aspectRatio || null,
    generationLength: job.generationLength || null,
    outputCount: job.outputCount || 1,
    references: (job.referenceAssets || []).concat(job.ingredients || []).map((r) => ({ assetId: r.assetId, path: r.path })),
    startFrame: job.startFrame || null,
    endFrame: job.endFrame || null,
    continuity: {
      strictness: cc.strictness || "NOT_APPLICABLE",
      requiredEntities: cc.requiredEntities || [],
      referenceAssetIds: cc.referenceAssetIds || [],
    },
    expectedFilename: `${job.sceneId}_attempt-${String(job.attempt).padStart(2, "0")}.${job.capability === "video" ? "mp4" : "png"}`,
    expectedDestination: job.expectedOutputPath,
    flowProject: job.flowProject || null,
    // STEP 10B-FIX: refusal context rides along when present. Never bypass guidance.
    refusal: job.refusal || null,
    adaptationStatus: job.adaptationStatus || null,
    nextAction: job.nextAction || "Complete generation manually, then import the result.",
    returnInstructions: "Download the result, then import it through the bridge result endpoint or the existing adapter.",
  };
}

module.exports = { buildManualAssistPacket };
