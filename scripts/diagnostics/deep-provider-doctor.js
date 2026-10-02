"use strict";

/**
 * UNFOLDIQ deep-provider doctor (PHASE 1G.1 Prompt 05, §18/61).
 * No-cost diagnostic: venv, import/version, config names, live opt-in.
 * Never prints secret values. Exit 0 always (doctor reports, never fails builds).
 * Usage: npm run research:deep:doctor
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const bridge = require("../../lib/research-deep/gpt-researcher-bridge.js");
const { credentialState } = require("../../lib/research-deep/provider-interface.js");

function section(t) { console.log(`\n## ${t}`); }
function line(s) { console.log(s); }

async function main() {
  console.log("=== UNFOLDIQ DEEP-PROVIDER DOCTOR (no-cost, no secrets printed) ===");
  section("Runtime");
  line(`node: ${process.version} (need >=18)`);
  line(`platform: ${process.platform}`);

  section("Isolated environment");
  line(`deep venv python: ${bridge.venvPythonPath()} ${fs.existsSync(bridge.venvPythonPath()) ? "PRESENT" : "MISSING"}`);
  line(`deep worker: ${bridge.DEEP_WORKER_PATH} ${fs.existsSync(bridge.DEEP_WORKER_PATH) ? "PRESENT" : "MISSING"}`);
  try {
    const req = fs.readFileSync(path.join(PROJECT_ROOT, "research", "deep-requirements.txt"), "utf8").trim();
    line(`pinned requirements: ${req.split("\n").filter((l) => l && !l.startsWith("#")).join(", ")}`);
  } catch { line("pinned requirements: MISSING research/deep-requirements.txt"); }
  line(`crawl4ai venv untouched: ${fs.existsSync(path.join(PROJECT_ROOT, "research", ".venv", "Scripts", "python.exe")) ? "PRESENT" : "MISSING"}`);

  section("Provider readiness");
  const ready = await bridge.checkReady();
  line(`status: ${ready.status}${ready.providerVersion ? ` providerVersion=${ready.providerVersion}` : ""}`);
  line(`llmConfigured: ${ready.llmConfigured === true ? "yes (name only)" : "no"}`);
  line(`searchConfigured: ${ready.searchConfigured === true ? "yes (name only)" : "no"}`);
  line(`embeddingConfigured: ${ready.embeddingConfigured === true ? "yes (name only)" : "no"}`);
  line(`liveApproved (UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1): ${ready.liveApproved ? "yes" : "no"}`);
  if (ready.llm && ready.llm.selected) {
    line(`llm selected: ${ready.llm.selected} (via ${ready.llm.via}) configured=${ready.llm.configured ? "yes" : "no"} supported=${ready.llm.supported ? "yes" : "no"} keys: ${(ready.llm.keyNames || []).join(", ") || "(none required)"}`);
  }
  if (ready.search && ready.search.retriever) {
    line(`retriever selected: ${ready.search.retriever} configured=${ready.search.configured ? "yes" : "no"} supported=${ready.search.supported ? "yes" : "no"}`);
  }
  if (ready.embedding && ready.embedding.provider) {
    line(`embedding selected: ${ready.embedding.provider}:${ready.embedding.model}${ready.embedding.explicit ? " (explicit EMBEDDING)" : " (derived from selected LLM provider)"} configured=${ready.embedding.configured ? "yes" : "no"} supported=${ready.embedding.supported ? "yes" : "no"} inInstalledProviders=${ready.embedding.inInstalledProviders} keys: ${(ready.embedding.keyNames || []).join(", ") || "(none required)"}`);
  }
  if (ready.embedding && ready.embedding.error) line(`embedding diagnostic: ${ready.embedding.error}`);
  if (ready.diagnostic) line(`diagnostic: ${ready.diagnostic}`);

  section("Local credential names (values never shown)");
  const cs = credentialState();
  line(`llm selected: ${cs.llmSelected || "(none)"}${cs.llmSelectedVia ? ` via ${cs.llmSelectedVia}` : ""}; keys checked: ${cs.llmKeyNames.join(", ") || "(none required)"} -> ${cs.llmConfigured ? "at least one present" : "none present"}`);
  line(`retriever selected: ${cs.retriever || "(none)"}; keys checked: ${cs.searchKeyNames.join(", ") || "(none required)"} -> ${cs.searchConfigured ? "at least one present" : "none present"}`);
  line(`embedding selected: ${cs.embedding && cs.embedding.provider ? `${cs.embedding.provider}:${cs.embedding.model}` : "(unresolved)"}${cs.embedding && cs.embedding.explicit ? " (explicit EMBEDDING)" : ""}; keys checked: ${(cs.embedding && cs.embedding.keyNames || []).join(", ") || "(none required)"} -> ${cs.embeddingConfigured ? "at least one present" : "none present"}`);

  section("Policy");
  line("STANDARD remains default; DEEP only on NEEDS_MORE_RESEARCH eligibility.");
  line("Real deep runs require explicit opt-in; keys alone are not consent.");
  console.log("\nDOCTOR_DONE");
}

main().catch((e) => { console.error(`DOCTOR_ERROR: ${e.message}`); });
