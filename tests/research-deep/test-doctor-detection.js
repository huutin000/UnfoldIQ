"use strict";

/**
 * Doctor detection tests (§6A FIX).
 * Proves readiness is detected from the ACTUAL selected LLM/retriever:
 *   google_genai + GOOGLE_API_KEY -> llmConfigured = yes
 *   google_genai + no key          -> llmConfigured = no
 *   RETRIEVER=duckduckgo           -> searchConfigured = yes (no key needed)
 *   RETRIEVER=tavily + no key      -> searchConfigured = no
 *   live opt-in = 1                -> liveApproved = yes
 * Plus CONFIGURED vs SUPPORTED_BY_INSTALLED_VERSION distinction via the real
 * worker config op (no network, no spend, no secret values in output).
 */

const iface = require("../../lib/research-deep/provider-interface.js");
const bridge = require("../../lib/research-deep/gpt-researcher-bridge.js");

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

const DUMMY = "DUMMY-NOT-A-SECRET-0123456789abcdef";

async function main() {
  console.log("\n[TEST] D1 google_genai + GOOGLE_API_KEY -> llmConfigured yes");
  {
    const cs = iface.credentialState({ FAST_LLM: "google_genai:gemini-2.0-flash", GOOGLE_API_KEY: DUMMY });
    assert(cs.llmSelected === "google_genai", "selected provider detected");
    assert(cs.llmConfigured === true, "Gemini credential requirement satisfied by GOOGLE_API_KEY");
    assert(!JSON.stringify(iface.redactSecrets({ GOOGLE_API_KEY: DUMMY })).includes(DUMMY), "no secret value survives redaction");
  }

  console.log("\n[TEST] D2 google_genai + no key -> llmConfigured no");
  {
    const cs = iface.credentialState({ FAST_LLM: "google_genai:gemini-2.0-flash" });
    assert(cs.llmConfigured === false, "missing GOOGLE_API_KEY detected");
  }

  console.log("\n[TEST] D3 RETRIEVER=duckduckgo -> searchConfigured yes without search key");
  {
    const cs = iface.credentialState({ RETRIEVER: "duckduckgo" });
    assert(cs.retriever === "duckduckgo", "retriever selection detected");
    assert(cs.searchConfigured === true, "no Tavily/Serper key demanded for DuckDuckGo");
  }

  console.log("\n[TEST] D4 RETRIEVER=tavily + no key -> searchConfigured no");
  {
    const cs = iface.credentialState({ RETRIEVER: "tavily" });
    assert(cs.searchConfigured === false, "missing TAVILY_API_KEY detected for tavily");
  }

  console.log("\n[TEST] D5 live opt-in -> liveApproved yes (names only, no spend)");
  {
    const cs = iface.credentialState({ UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED: "1" });
    assert(cs.liveApproved === true, "explicit opt-in recognized");
    const cs2 = iface.credentialState({});
    assert(cs2.liveApproved === false, "absent opt-in is not approval");
  }

  console.log("\n[TEST] D6 legacy behaviour preserved when nothing selected");
  {
    const cs = iface.credentialState({});
    assert(cs.llmConfigured === false && cs.searchConfigured === false, "empty env configures nothing");
    const cs2 = iface.credentialState({ OPENAI_API_KEY: "sk-1234567890", TAVILY_API_KEY: "tv-1234" });
    assert(cs2.llmConfigured === true && cs2.searchConfigured === true, "legacy OpenAI+Tavily keys still recognized");
    const cs3 = iface.credentialState({ FAST_LLM: "ollama:llama3" });
    assert(cs3.llmConfigured === true, "local ollama needs no key by design");
  }

  console.log("\n[TEST] D7 real worker config op distinguishes CONFIGURED vs SUPPORTED");
  {
    const saved = {};
    for (const n of ["FAST_LLM", "SMART_LLM", "STRATEGIC_LLM", "RETRIEVER", "GOOGLE_API_KEY", "GEMINI_API_KEY", "UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED"]) {
      saved[n] = process.env[n];
    }
    try {
      delete process.env.FAST_LLM; delete process.env.SMART_LLM; delete process.env.STRATEGIC_LLM;
      delete process.env.RETRIEVER; delete process.env.GOOGLE_API_KEY; delete process.env.GEMINI_API_KEY;
      delete process.env.UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED;
      process.env.FAST_LLM = "google_genai:gemini-2.0-flash";
      process.env.GOOGLE_API_KEY = DUMMY;
      process.env.RETRIEVER = "duckduckgo";
      process.env.UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED = "1";
      const out = await bridge.runWorker({ protocolVersion: 1, operation: "config" }, { processTimeoutMs: 120000 });
      assert(out.ok === true, "worker config op executes (no spend)");
      const body = out.response || {};
      const dump = JSON.stringify(body);
      assert(!dump.includes(DUMMY), "worker prints names only, never secret values");
      assert(body.llm && body.llm.selected === "google_genai", "worker sees selected google_genai");
      assert(body.llm.configured === true, "worker: GOOGLE_API_KEY satisfies google_genai");
      assert(body.llm.supported === true, "worker: langchain_google_genai installed -> SUPPORTED=true");
      assert(body.search && body.search.retriever === "duckduckgo", "worker sees selected duckduckgo");
      assert(body.search.configured === true, "worker: duckduckgo needs no search key");
      assert(body.search.supported === true, "worker: ddgs installed -> duckduckgo SUPPORTED=true");
      assert(body.liveApproved === true, "worker: explicit opt-in visible");
      const ready = await bridge.checkReady({ processTimeoutMs: 120000 });
      assert(ready.status === "READY", `simulated selected env is fully READY (${ready.status})`);
    } finally {
      for (const n of Object.keys(saved)) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
    }
  }

  console.log("\n[TEST] D8 unsupported selection still reports NOT_SUPPORTED, never fake READY");
  {
    const saved = {};
    for (const n of ["FAST_LLM", "SMART_LLM", "STRATEGIC_LLM", "RETRIEVER", "ANTHROPIC_API_KEY", "UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED"]) {
      saved[n] = process.env[n];
    }
    try {
      delete process.env.SMART_LLM; delete process.env.STRATEGIC_LLM; delete process.env.RETRIEVER;
      delete process.env.UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED;
      process.env.FAST_LLM = "anthropic:claude-sonnet-4-5";
      process.env.ANTHROPIC_API_KEY = DUMMY;
      const out = await bridge.runWorker({ protocolVersion: 1, operation: "config" }, { processTimeoutMs: 120000 });
      assert(out.ok === true, "worker config op executes (no spend)");
      assert(!JSON.stringify(out.response || {}).includes(DUMMY), "names only, never secret values");
      assert(out.response.llm.configured === true, "anthropic key satisfies configured");
      assert(out.response.llm.supported === false, "langchain_anthropic absent -> SUPPORTED=false");
      const ready = await bridge.checkReady({ processTimeoutMs: 120000 });
      assert(ready.status === "NOT_SUPPORTED", `doctor reports NOT_SUPPORTED, not fake READY (${ready.status})`);
    } finally {
      for (const n of Object.keys(saved)) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
    }
  }
  console.log(`Passed assertions: ${passed}, Failed tests: 0`);
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
