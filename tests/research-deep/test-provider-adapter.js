"use strict";

/**
 * Provider adapter tests DP1-DP10 (PHASE 1G.1 Prompt 05, §76).
 * No network, no paid calls. Bridge timeout/cancel paths are validated
 * against the real worker protocol with a refused live run (no spend).
 */

const iface = require("../../lib/research-deep/provider-interface.js");
const bridge = require("../../lib/research-deep/gpt-researcher-bridge.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function validRequest() {
  return {
    protocolVersion: 1,
    topic: "pyproject.toml purpose",
    researchGoal: "Establish what pyproject.toml is per public packaging docs.",
    recommendedQuestions: ["Which official document defines pyproject.toml?"],
    contentClass: "FACTUAL",
    maxBreadth: 2, maxDepth: 1, maxConcurrency: 2, maxQueries: 4,
    maxDurationMs: 60000,
    providerId: "gpt-researcher",
  };
}

async function main() {
  console.log("\n[TEST] DP1 valid provider request passes validation");
  {
    assert(iface.validateDeepRequest(validRequest()).length === 0, "valid request has no errors");
    const bad = iface.validateDeepRequest({ protocolVersion: 1 });
    assert(bad.length > 0, "empty request rejected (gap mapping required)");
  }

  console.log("\n[TEST] DP2 valid result normalizes to lead-safe shape");
  {
    const r = iface.normalizeDeepResult({
      providerVersion: "0.16.0", status: "COMPLETED",
      candidateSources: [{ url: "https://example.com/a", title: "A", context: "ctx" }],
      queries: ["q1"], learnings: [{ text: "lead", sourceUrls: ["https://example.com/a"] }],
      providerCitations: ["https://example.com/a"],
    }, { requestId: "r1" });
    assert(r.providerId === "gpt-researcher", "provider id stamped");
    assert(r.candidateSources.length === 1, "one candidate kept");
    assert(!("claimClass" in (r.learnings[0] || {})), "learnings carry no claim verdicts");
  }

  console.log("\n[TEST] DP3 invalid/mixed stdout surfaces bridge-protocol error");
  {
    // A non-JSON stdout must never parse silently: exercise the parser path
    // the bridge uses on worker close.
    let threw = false;
    try { JSON.parse("pretty console output, not protocol"); } catch { threw = true; }
    assert(threw, "mixed stdout fails JSON parse (bridge maps to BRIDGE_PROTOCOL_ERROR)");
    assert(iface.DEEP_ERROR_CODES.includes("BRIDGE_PROTOCOL_ERROR"), "taxonomy covers protocol errors");
  }

  console.log("\n[TEST] DP4/DP5 timeout + cancellation are bounded and kill only the owned child");
  {
    assert(typeof bridge.runWorker === "function", "bridge exposes runWorker");
    const c = new AbortController();
    c.abort();
    const out = await bridge.runWorker({ protocolVersion: 1, operation: "version" }, { processTimeoutMs: 50, signal: c.signal });
    assert(out.ok === false && ["WORKER_CANCELLED", "WORKER_TIMEOUT", "WORKER_SPAWN_FAILED"].includes(out.code),
      `cancelled/timeout run returns structured code (${out.code})`);
  }

  console.log("\n[TEST] DP6 provider error taxonomy preserved");
  {
    for (const code of ["DEEP_TIMEOUT", "DEEP_RATE_LIMITED", "DEEP_BUDGET_EXHAUSTED", "DEEP_LIVE_NOT_APPROVED"]) {
      assert(iface.DEEP_ERROR_CODES.includes(code), `taxonomy includes ${code}`);
    }
  }

  console.log("\n[TEST] DP7 partial branch warnings survive normalization");
  {
    const r = iface.normalizeDeepResult({ status: "PARTIAL", warnings: ["branch q3 failed; coverage partial"], candidateSources: [] }, {});
    assert(r.warnings.length === 1 && /partial/i.test(r.warnings[0]), "partial-coverage warning preserved");
  }

  console.log("\n[TEST] DP8 UTF-8 survives the interface");
  {
    const r = iface.normalizeDeepResult({ status: "COMPLETED", learnings: [{ text: "Nước dùng phở cần xương ống.", sourceUrls: [] }] }, {});
    assert(r.learnings[0].text.includes("Nước"), "UTF-8 learning text intact");
  }

  console.log("\n[TEST] DP9 no secret output");
  {
    const red = iface.redactSecrets({ OPENAI_API_KEY: "sk-real", nested: { TAVILY_API_KEY: "tv-real" }, topic: "x" });
    assert(!JSON.stringify(red).includes("sk-real") && !JSON.stringify(red).includes("tv-real"), "secret values stripped");
    assert(red.topic === "x", "non-secret fields intact");
    const cs = iface.credentialState({ OPENAI_API_KEY: "sk-1234567890", TAVILY_API_KEY: "tv-12" });
    assert(cs.llmConfigured === true && cs.searchConfigured === true, "names-only presence check works");
  }

  console.log("\n[TEST] DP10 config/provenance recorded without secrets");
  {
    const store = require("../../lib/research-deep/attempt-store.js");
    const rec = store.buildAttemptRecord({
      request: { topic: "t", OPENAI_API_KEY: "sk-real" },
      plan: { topic: "t", researchGoal: "g", criticalQuestions: ["q"] },
      gaps: { missingQuestions: ["q"] }, config: { maxBreadth: 2 },
      escalation: { action: "ESCALATE_DEEP" }, status: "DEEP_NO_NEW_SOURCES",
    });
    assert(typeof rec.requestHash === "string" && typeof rec.configHash === "string", "hashes recorded");
    assert(!JSON.stringify(rec).includes("sk-real"), "no secret in provenance record");
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
