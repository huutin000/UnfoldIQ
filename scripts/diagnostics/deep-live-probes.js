"use strict";

/**
 * UNFOLDIQ deep live probes (PHASE 1G.1 Prompt 05 Fix 2, §14-16/18).
 * Three tiny live sanity calls through the SAME provider abstraction the DEEP
 * run uses — Gemini LLM, Gemini embedding, DuckDuckGo retriever — before any
 * full DEEP retry. Requires explicit opt-in UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1
 * AND configured providers; otherwise refuses and spends nothing.
 * Each result is schema-validated (E7); the embedding probe additionally fails
 * if the adapter class is an OpenAI one (no silent provider fallback, §17/28).
 * Usage: npm run research:deep:live-probes
 */

const bridge = require("../../lib/research-deep/gpt-researcher-bridge.js");
const { isLiveApproved, validateProbeResult } = require("../../lib/research-deep/provider-interface.js");

const PROBES = ["embedding", "llm", "retriever"];

async function main() {
  console.log("=== UNFOLDIQ DEEP LIVE PROBES (tiny, explicit opt-in only) ===");
  if (!isLiveApproved()) {
    console.log("REFUSED: DEEP_LIVE_NOT_APPROVED — set UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1 explicitly to authorize spend. Nothing executed.");
    process.exit(2);
  }
  let failed = 0;
  for (const kind of PROBES) {
    const res = await bridge.runWorker(
      { protocolVersion: 1, operation: "probe", request: { kind } },
      { processTimeoutMs: 120 * 1000 }
    );
    const body = res.ok ? res.response : { ok: false, errorCode: res.code, errorMessage: res.error };
    if (!body.ok) {
      failed++;
      console.log(`PROBE ${kind}: FAIL ${body.errorCode || "DEEP_PROVIDER_ERROR"}: ${body.errorMessage}`);
      continue;
    }
    const errors = validateProbeResult(body.probe || {});
    if (errors.length > 0) {
      failed++;
      console.log(`PROBE ${kind}: INVALID_RESULT ${errors.join("; ")}`);
      continue;
    }
    const p = body.probe;
    if (p.kind === "embedding") {
      console.log(`PROBE embedding: PASS provider=${p.provider} model=${p.model} dimension=${p.dimension} adapter=${p.className}${p.explicit ? " (explicit EMBEDDING)" : " (derived)"}`);
    } else if (p.kind === "llm") {
      console.log(`PROBE llm: PASS provider=${p.provider} model=${p.model} response="${p.responseHead}"`);
    } else {
      console.log(`PROBE retriever: PASS provider=${p.provider} results=${p.resultCount} first=${p.urls[0] || "(none)"}`);
    }
  }
  if (failed > 0) {
    console.log(`LIVE_PROBES_DONE: ${PROBES.length - failed}/${PROBES.length} PASS (see failures above)`);
    process.exit(1);
  }
  console.log(`LIVE_PROBES_DONE: ${PROBES.length}/${PROBES.length} PASS — safe to run npm run research:deep:live-smoke`);
}

main().catch((e) => { console.error(`LIVE_PROBES_ERROR: ${e.message}`); process.exit(1); });
