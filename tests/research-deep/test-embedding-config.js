"use strict";

/**
 * PHASE 1G.1 Prompt 05 Fix 2 — embedding/provider-fallback regression (E1-E7).
 * Proves a Gemini-only DEEP configuration can never require OpenAI credentials:
 * the installed gpt-researcher default (EMBEDDING=openai:text-embedding-3-small)
 * is overridden by explicit EMBEDDING or derived from the selected LLM provider,
 * and an unconfigured embedding refuses BEFORE any spend, never silently
 * falling back. Live spend requires opt-in; these tests are all no-cost.
 */

const assert = require("assert");
const { credentialState, selectedEmbedding, validateProbeResult } = require("../../lib/research-deep/provider-interface.js");
const bridge = require("../../lib/research-deep/gpt-researcher-bridge.js");

const DUMMY = "DUMMY-NOT-A-SECRET-0123456789";
// Neutralize inherited provider env so tests are hermetic on any machine.
const CLEAN = {
  OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "",
  OPENAI_BASE_URL: "", FAST_LLM: "", SMART_LLM: "", STRATEGIC_LLM: "",
  RETRIEVER: "", EMBEDDING: "", TAVILY_API_KEY: "", SERPER_API_KEY: "",
  UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED: "",
};
let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log(`ok ${passed} - ${label}`);
}

// E1 — Gemini LLM selected + no OPENAI_API_KEY + GOOGLE_API_KEY present:
// readiness resolves through google_genai for BOTH llm and embedding.
{
  const env = { ...CLEAN, FAST_LLM: "google_genai:gemini-3.5-flash-lite", SMART_LLM: "google_genai:gemini-3.8-flash", STRATEGIC_LLM: "google_genai:gemini-3.8-flash", GOOGLE_API_KEY: DUMMY, RETRIEVER: "duckduckgo" };
  const cs = credentialState(env);
  ok(cs.llmConfigured === true, "E1: llmConfigured via GOOGLE_API_KEY");
  ok(cs.llmSelected === "google_genai", "E1: llm provider google_genai");
  ok(cs.embedding.provider === "google_genai", "E1: embedding provider derived google_genai (not openai)");
  ok(cs.embedding.model === "gemini-embedding-001", "E1: derived embedding model gemini-embedding-001");
  ok(cs.embeddingConfigured === true, "E1: embeddingConfigured via GOOGLE_API_KEY");
  ok(!(cs.embedding.keyNames || []).includes("OPENAI_API_KEY"), "E1: no OPENAI_API_KEY in embedding key list");
}

// E2 — explicit Gemini embedding selected: config READY with no OpenAI key.
{
  const env = { ...CLEAN, EMBEDDING: "google_genai:gemini-embedding-001", GOOGLE_API_KEY: DUMMY };
  const cs = credentialState(env);
  ok(cs.embedding.provider === "google_genai" && cs.embedding.explicit === true, "E2: explicit EMBEDDING parsed google_genai");
  ok(cs.embeddingConfigured === true, "E2: explicit gemini embedding READY with GOOGLE_API_KEY only");
}

// E3 — default/implicit OpenAI embedding while OpenAI key missing:
// NOT configured, with a diagnostic pointing at EMBEDDING.
{
  const env = { ...CLEAN }; // nothing selected: library would default openai
  const cs = credentialState(env);
  ok(cs.embedding.provider === "openai", "E3: implicit embedding provider is openai (library default surfaced)");
  ok(cs.embeddingConfigured === false, "E3: implicit openai embedding + missing key = NOT configured");
  ok((cs.embedding.error || "") === "", "E3: implicit default itself parses cleanly");
  const emb = selectedEmbedding({ ...CLEAN, EMBEDDING: "not-a-provider-model" });
  ok(!!emb.error && /<provider>:<model>/.test(emb.error), "E3: malformed EMBEDDING produces explicit diagnostic");
}

// E4 — DuckDuckGo selected: no Tavily/Serper key required.
{
  const env = { ...CLEAN, RETRIEVER: "duckduckgo" };
  const cs = credentialState(env);
  ok(cs.searchConfigured === true, "E4: duckduckgo keyless = searchConfigured");
  ok((cs.searchKeyNames || []).length === 0, "E4: no search keys required for duckduckgo");
}

// E5 — Node -> Python env propagation preserves provider + EMBEDDING config.
// The spawned worker must report the injected Gemini-only env (names only).
async function e5e6() {
  const env = {
    ...CLEAN,
    FAST_LLM: "google_genai:gemini-3.5-flash-lite",
    SMART_LLM: "google_genai:gemini-3.8-flash",
    STRATEGIC_LLM: "google_genai:gemini-3.8-flash",
    GOOGLE_API_KEY: DUMMY,
    RETRIEVER: "duckduckgo",
  };
  const res = await bridge.runWorker({ protocolVersion: 1, operation: "config" }, { env, processTimeoutMs: 120000 });
  ok(res.ok && res.response, "E5: worker config op responds");
  const cfg = res.response;
  ok(cfg.llm && cfg.llm.selected === "google_genai", "E5: FAST/SMART/STRATEGIC selection survives Node -> Python");
  ok(cfg.search && cfg.search.retriever === "duckduckgo", "E5: RETRIEVER selection survives Node -> Python");
  ok(cfg.embedding && cfg.embedding.provider === "google_genai" && cfg.embedding.model === "gemini-embedding-001", "E5: derived EMBEDDING resolution survives Node -> Python");
  ok(cfg.embeddingConfigured === true, "E5: embedding configured in the Python child (E2 path)");

  // E6 — no provider fallback: google_genai selection never becomes OpenAI,
  // in either the explicit-EMBEDDING or the derived path.
  const envExplicit = { ...env, EMBEDDING: "google_genai:gemini-embedding-001" };
  const res2 = await bridge.runWorker({ protocolVersion: 1, operation: "config" }, { env: envExplicit, processTimeoutMs: 120000 });
  ok(res2.ok && res2.response.embedding.provider === "google_genai", "E6: explicit EMBEDDING stays google_genai in worker");
  ok(cfg.embedding.provider !== "openai", "E6: derived embedding never silently becomes openai while google_genai selected");
  ok(cfg.embedding.inInstalledProviders === true, "E6: google_genai is in installed 0.15.1 _SUPPORTED_PROVIDERS");

  // E7 — probe schema/result validation + spend gates.
  const noApproval = await bridge.runWorker(
    { protocolVersion: 1, operation: "probe", request: { kind: "embedding" } },
    { env, processTimeoutMs: 120000 } // liveApproved neutralized via CLEAN ""
  );
  ok(noApproval.ok && noApproval.response && noApproval.response.ok === false &&
     noApproval.response.errorCode === "DEEP_LIVE_NOT_APPROVED", "E7: embedding probe refuses without explicit opt-in (no spend)");
  const badKind = await bridge.runWorker(
    { protocolVersion: 1, operation: "probe", request: { kind: "wat" } },
    { env: { ...env, UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED: "1" }, processTimeoutMs: 120000 }
  );
  ok(badKind.ok && badKind.response && badKind.response.ok === false &&
     badKind.response.errorCode === "BRIDGE_PROTOCOL_ERROR", "E7: unknown probe kind refused (protocol error, no spend)");
  ok(validateProbeResult({ kind: "embedding", provider: "google_genai", model: "gemini-embedding-001", dimension: 3072, numeric: true, className: "GoogleGenerativeAIEmbeddings" }).length === 0,
    "E7: valid embedding probe result accepted");
  ok(validateProbeResult({ kind: "embedding", provider: "google_genai", model: "gemini-embedding-001", dimension: 3072, numeric: true, className: "OpenAIEmbeddings" }).length > 0,
    "E7: OpenAI adapter class in an embedding probe result is rejected (no silent fallback)");
  ok(validateProbeResult({ kind: "embedding", provider: "google_genai", model: "m", dimension: 0, numeric: true, className: "GoogleGenerativeAIEmbeddings" }).length > 0,
    "E7: non-positive dimension rejected");
  ok(validateProbeResult({ kind: "llm", provider: "google_genai", model: "gemini-3.5-flash-lite", responseHead: "UNFOLDIQ-LLM-PROBE-OK" }).length === 0,
    "E7: valid llm probe result accepted");
  ok(validateProbeResult({ kind: "retriever", provider: "duckduckgo", resultCount: 2, urls: ["https://packaging.python.org"] }).length === 0,
    "E7: valid retriever probe result accepted");
}

// No-cost bridge status check under the E1 env: READY/READY_NO_LIVE_APPROVAL
// (never MISSING_CREDENTIALS for a complete Gemini-only config).
async function e1Status() {
  const env = {
    ...CLEAN,
    FAST_LLM: "google_genai:gemini-3.5-flash-lite",
    SMART_LLM: "google_genai:gemini-3.8-flash",
    STRATEGIC_LLM: "google_genai:gemini-3.8-flash",
    GOOGLE_API_KEY: DUMMY,
    RETRIEVER: "duckduckgo",
    UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED: "1",
  };
  const ready = await bridge.checkReady({ env, processTimeoutMs: 120000 });
  ok(ready.status === "READY", `E1: bridge checkReady READY under Gemini-only config (got ${ready.status})`);
  ok(ready.embeddingConfigured === true, "E1: bridge reports embeddingConfigured");
  const missing = await bridge.checkReady({ env: CLEAN, processTimeoutMs: 120000 });
  ok(missing.status === "READY_NO_LIVE_APPROVAL" || missing.status === "MISSING_CREDENTIALS",
    `E3: bridge checkReady not READY with implicit openai embedding + no key (got ${missing.status})`);
  ok(/EMBEDDING/.test(missing.diagnostic || ""), "E3: readiness diagnostic names EMBEDDING");
}

(async () => {
  e5e6().then(e1Status).then(() => {
    console.log(`\nALL PASS - test-embedding-config.js (${passed} assertions)`);
  }).catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });
})();
