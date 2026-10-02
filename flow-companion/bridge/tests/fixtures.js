"use strict";

/**
 * Shared TEST-ONLY fixtures for Flow Companion bridge tests (STEP 10B).
 * No real credentials, no production paths.
 */

const TEST_TOKEN = "TEST-ONLY-BRIDGE-TOKEN";

function baseJob(overrides = {}) {
  return {
    projectId: "__flow10b_fx__",
    jobId: "FX-JOB-1",
    requestId: "FX-REQ-1",
    sceneId: "S01",
    capability: "image",
    mode: "ASSISTED_APPROVAL",
    prompt: "TEST-ONLY fixture prompt",
    platform: "youtube",
    flowProject: { mode: "REUSE", displayName: "UNFOLDIQ — fixture" },
    outputRequirements: { aspectRatio: "16:9" },
    creativeContext: { contentModeSummary: "test-mode" },
    expectedOutputPath: "assets/image/S01/S01_attempt-01.png",
    attempt: 1,
    ...overrides,
  };
}

module.exports = { TEST_TOKEN, baseJob };
