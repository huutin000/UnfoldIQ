"use strict";

/**
 * PHASE 1G.1 Prompt 05 Fix 6 — acceptance profile + call-budget guard.
 * Drives the REAL deep-worker run path with a deterministic mock provider
 * (zero API calls; DuckDuckGo stubbed; example.com scrape tolerated) to prove:
 *  - measured acceptance topology: breadth=1/depth=1/skipReport → exactly
 *    5 LLM calls (4 strategic + 1 smart), no report call;
 *  - production path unchanged: without skipReport the report call appears
 *    (6 total);
 *  - UNFOLDIQ_DEEP_MAX_LLM_CALLS refuses BEFORE exceeding the ceiling with a
 *    structured DEEP_BUDGET_EXHAUSTED response carrying the call counts.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const PY = path.join(REPO_ROOT, "research", ".venv-deep", "Scripts", "python.exe");
const WORKER = path.join(REPO_ROOT, "research", "deep-worker.py");

const WORKER_PATH_LIT = JSON.stringify(WORKER);

const script = `
import asyncio, importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("dw", ${WORKER_PATH_LIT})
dw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dw)

# Deterministic mock provider + embeddings (zero network LLM/embedding calls).
from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
async def canned(self, messages, stream, websocket=None, **kwargs):
    blob = "\\n".join(str(m.get("content", "")) for m in messages)
    if "auto_agent_instructions" in blob:
        return '{"server": "research", "agent_role_prompt": "You are a mock researcher."}'
    if "Format as 'Query:" in blob:
        return "Query: mock query about pyproject.toml\\nGoal: understand its purpose"
    if "generate targeted questions" in blob:
        return "Question: What is pyproject.toml?"
    if "extract key learnings" in blob:
        return "Learning [https://example.com/pyproject]: pyproject.toml is the Python project configuration file\\nQuestion: What sections does it define?"
    if "list of strings" in blob:
        return '["mock sub query about pyproject.toml purpose"]'
    return "Mock report: pyproject.toml is the standard Python project configuration file."
GenericLLMProvider.get_chat_response = canned
import langchain_google_genai as lgg
lgg.GoogleGenerativeAIEmbeddings.embed_documents = lambda self, texts, **kw: [[0.1] * 8 for _ in texts]
lgg.GoogleGenerativeAIEmbeddings.embed_query = lambda self, text, **kw: [0.1] * 8
# Deterministic retriever (no network): canned DuckDuckGo result.
from gpt_researcher.retrievers.duckduckgo.duckduckgo import Duckduckgo
Duckduckgo.search = lambda self, max_results=5: [
    {"url": "https://example.com/pyproject", "title": "Example", "content": "pyproject.toml config"},
]

async def run_case(name, req):
    dw._CALL_STATE["llm"] = {}
    dw._CALL_STATE["total"] = 0
    dw._QUOTA_STATE["exhausted"] = False
    res = await dw.run_deep(req)
    out = {"name": name, "ok": res.get("ok"), "code": res.get("errorCode")}
    if res.get("ok"):
        ps = res["result"].get("progressSummary") or {}
        out["llmCalls"] = ps.get("llmCalls")
        out["llmCallsTotal"] = ps.get("llmCallsTotal")
    elif res.get("llmCalls"):
        out["llmCalls"] = res["llmCalls"].get("byModel")
        out["llmCallsTotal"] = res["llmCalls"].get("total")
    return out

BASE = {
    "topic": "Python packaging: what is pyproject.toml (public software documentation fact)",
    "criticalGaps": ["Which official document defines pyproject.toml and its core purpose?"],
    "maxBreadth": 1, "maxDepth": 1, "maxConcurrency": 1, "maxQueries": 1,
    "maxDurationMs": 240000, "skipReport": True,
}
async def main():
    results = []
    results.append(await run_case("acceptance", dict(BASE)))
    results.append(await run_case("production_report", {**BASE, "skipReport": False}))
    os.environ["UNFOLDIQ_DEEP_MAX_LLM_CALLS"] = "3"
    results.append(await run_case("budget_guard", dict(BASE)))
    print(json.dumps(results))
asyncio.run(main())
`;

const env = {
  UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED: "1",
  GOOGLE_API_KEY: "DUMMY-NOT-A-SECRET-0123456789",
  FAST_LLM: "google_genai:mock-fast",
  SMART_LLM: "google_genai:mock-smart",
  STRATEGIC_LLM: "google_genai:mock-strategic",
  EMBEDDING: "google_genai:mock-embedding",
  RETRIEVER: "duckduckgo",
  OPENAI_API_KEY: "",
};

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok ${passed} - ${label}`);
}

const res = spawnSync(PY, ["-"], { input: script, encoding: "utf8", cwd: REPO_ROOT, env, timeout: 300000 });
const outLine = (res.stdout || "").trim().split("\n").filter((l) => l.trim().startsWith("[")).pop();
if (!outLine) {
  console.error("FAIL: no JSON result; stderr tail:", (res.stderr || "").slice(-600));
  process.exit(1);
}
const [acceptance, production, budget] = JSON.parse(outLine);

ok(acceptance.ok === true, "AP1: acceptance run (mock provider, real deep path) completes");
ok(acceptance.llmCallsTotal === 5, `AP2: measured acceptance topology = 5 LLM calls (got ${acceptance.llmCallsTotal})`);
ok(acceptance.llmCalls && acceptance.llmCalls["mock-strategic"] === 4 && acceptance.llmCalls["mock-smart"] === 1,
  "AP3: 4 strategic + 1 smart (write_report skipped in acceptance)");
ok(production.ok === true && production.llmCallsTotal === 6, "AP4: production path keeps write_report (6 calls) — acceptance does not weaken production");
ok(budget.ok === false && budget.code === "DEEP_BUDGET_EXHAUSTED", "AP5: UNFOLDIQ_DEEP_MAX_LLM_CALLS refusal is structured DEEP_BUDGET_EXHAUSTED");

// Budget guard case runs in a child process that had no ceiling set; prove the
// ceiling logic directly against the wrapper state machine.
const script2 = `
import asyncio, importlib.util, json, os
spec = importlib.util.spec_from_file_location("dw", ${WORKER_PATH_LIT})
dw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dw)
os.environ["UNFOLDIQ_DEEP_MAX_LLM_CALLS"] = "2"
from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
dw._install_llm_text_coercion()
class P:
    llm = type("L", (), {"model": "m"})()
async def go():
    outs = []
    for i in range(3):
        try:
            await GenericLLMProvider.get_chat_response(P(), [{"role": "user", "content": "x"}], False)
            outs.append("ok")
        except BaseException as e:
            outs.append(type(e).__name__ + ':' + str(e)[:80])
    return outs
print(json.dumps(asyncio.run(go())))
`;
const res2 = spawnSync(PY, ["-"], { input: script2, encoding: "utf8", cwd: REPO_ROOT, env: { ...env, UNFOLDIQ_DEEP_MAX_LLM_CALLS: "2" }, timeout: 120000 });
const out2 = (res2.stdout || "").trim().split("\n").filter((l) => l.trim().startsWith("[")).pop();
ok(!!out2 && String(JSON.parse(out2)[2]).startsWith("BudgetExceeded") && /2\/2 calls made/.test(res2.stdout),
  "AP6: ceiling counts before call — first 2 calls attempted (counted), call 3 refused via BudgetExceeded before any provider call");

console.log(`\nRESULT: ALL TESTS PASSED (${passed} assertions)`);
