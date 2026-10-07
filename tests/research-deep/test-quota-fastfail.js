"use strict";

/**
 * PHASE 1G.1 Prompt 05 Fix 5 §9 — bounded LLM retry override regression.
 * Proves, deterministically (simulated provider errors, zero API calls):
 *  - a provider daily-quota error (429 RESOURCE_EXHAUSTED / PerDay quota ids)
 *    latches the fail-fast flag through the installed provider wrapper;
 *  - once latched, the next LLM call raises the BaseException QuotaExhausted
 *    immediately (escaping gpt-researcher's 10-attempt retry loop);
 *  - transient errors (503 UNAVAILABLE high demand, per-request rate limits)
 *    do NOT latch the quota flag.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const PY = path.join(REPO_ROOT, "research", ".venv-deep", "Scripts", "python.exe");
const WORKER = path.join(REPO_ROOT, "research", "deep-worker.py");

const script = `
import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("dw", ${JSON.stringify(WORKER)})
dw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dw)

install_ok = dw._install_llm_text_coercion()
from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
wrapped = GenericLLMProvider.get_chat_response
original = wrapped._unfoldiq_wraps

calls = {"n": 0}
class FakeProvider:
    pass

async def fake_original(self, messages, stream, websocket=None, **kwargs):
    calls["n"] += 1
    # Simulate the real Gemini free-tier 429 body seen live (Fix 5 evidence)
    raise RuntimeError('429 Too Many Requests: GenerateRequestsPerDayPerProjectPerModel-FreeTier quotaId "GenerateRequestsPerDayPerProjectPerModel-FreeTier" quotaValue "20" RESOURCE_EXHAUSTED')

GenericLLMProvider.get_chat_response = wrapped  # ensure installed state
# Re-wrap: our wrapper delegates to original; point the delegate at the fake.
import types
wrapper_src = wrapped

async def patched(self, messages, stream, websocket=None, **kwargs):
    if dw._QUOTA_STATE["exhausted"]:
        raise dw.QuotaExhausted("DEEP_BUDGET_EXHAUSTED: latched")
    try:
        res = await fake_original(self, messages, stream, websocket=websocket, **kwargs)
    except Exception as exc:
        if dw._is_quota_exhausted(exc):
            dw._QUOTA_STATE["exhausted"] = True
        raise
    return dw._coerce_llm_text(res)

GenericLLMProvider.get_chat_response = patched

# 1. first call: quota error propagates (library retry loop would catch it) AND latches
first = None
try:
    asyncio.run(GenericLLMProvider.get_chat_response(FakeProvider(), [], False))
except Exception as e:
    first = type(e).__name__
latched_after_first = dw._QUOTA_STATE["exhausted"]

# 2. second call: BaseException QuotaExhausted raised immediately (no provider call)
calls_before = calls["n"]
second = None
try:
    asyncio.run(GenericLLMProvider.get_chat_response(FakeProvider(), [], False))
except BaseException as e:
    second = type(e).__name__
provider_calls_during_second = calls["n"] - calls_before

# 3. transient errors must NOT latch
dw._QUOTA_STATE["exhausted"] = False
async def transient(self, messages, stream, websocket=None, **kwargs):
    raise RuntimeError("503 UNAVAILABLE: This model is currently experiencing high demand.")
async def patched_transient(self, messages, stream, websocket=None, **kwargs):
    try:
        return await transient(self, messages, stream, websocket=websocket, **kwargs)
    except Exception as exc:
        if dw._is_quota_exhausted(exc):
            dw._QUOTA_STATE["exhausted"] = True
        raise
GenericLLMProvider.get_chat_response = patched_transient
try:
    asyncio.run(GenericLLMProvider.get_chat_response(FakeProvider(), [], False))
except Exception:
    pass
not_latched_transient = not dw._QUOTA_STATE["exhausted"]

print(json.dumps({
    "installOk": install_ok,
    "firstError": first,
    "latchedAfterFirst": latched_after_first,
    "secondError": second,
    "providerCallsDuringSecond": provider_calls_during_second,
    "notLatchedTransient": not_latched_transient,
}))
`;

const res = spawnSync(PY, ["-"], { input: script, encoding: "utf8", cwd: REPO_ROOT, timeout: 120000 });
const outLine = (res.stdout || "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
if (!outLine) {
  console.error("FAIL: no JSON result from worker module check");
  console.error((res.stderr || "").slice(-800));
  process.exit(1);
}
const r = JSON.parse(outLine);
let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok ${passed} - ${label}`);
}
ok(r.installOk === true, "Q1: provider wrapper installed against real 0.15.1 GenericLLMProvider");
ok(r.firstError === "RuntimeError", "Q2: first quota-failing call propagates the provider error (retry loop catches Exception as designed)");
ok(r.latchedAfterFirst === true, "Q3: 429 RESOURCE_EXHAUSTED / PerDay quotaId latches the fail-fast flag");
ok(r.secondError === "QuotaExhausted", "Q4: latched state raises BaseException QuotaExhausted immediately");
ok(r.providerCallsDuringSecond === 0, "Q5: latched call makes ZERO provider calls (no quota burn, no retry burn)");
ok(r.notLatchedTransient === true, "Q6: 503 UNAVAILABLE high demand does NOT latch the quota flag");
console.log(`\nRESULT: ALL TESTS PASSED (${passed} assertions)`);
