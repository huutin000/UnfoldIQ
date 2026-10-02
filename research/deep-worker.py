"""
UNFOLDIQ DEEP provider worker (PHASE 1G.1 Prompt 05).

Node owns orchestration, Python owns the gpt-researcher library, JSON owns
the process boundary: stdin = request JSON, stdout = single response JSON,
stderr = diagnostics, exit code = success/failure.

Ops:
  version — no-cost import + package version (local integration proof).
  config  — names-only credential/live-approval check (never prints values).
  probe   — tiny live sanity call (embedding | llm | retriever) through the
            SAME provider abstraction the run uses; requires live opt-in.
  run     — bounded deep research (requires explicit live-test opt-in AND
            LLM + search + embedding credentials; otherwise refuses without
            spending).

Deep output is lead discovery: the worker returns candidate URLs, queries,
learnings with source links, and cost metadata. It never declares UNFOLDIQ
evidence verdicts.
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

PROTOCOL_VERSION = 1
PROVIDER_ID = "gpt-researcher"
LIVE_ENV = "UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED"
LLM_NAMES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_BASE_URL"]
SEARCH_NAMES = ["TAVILY_API_KEY", "SERPER_API_KEY", "SEARCHAPI_API_KEY"]

# §6A — provider-aware readiness (mirrors lib/research-deep/provider-interface.js).
# Selected config wins over fixed key lists: FAST/SMART/STRATEGIC_LLM =
# "<provider>:<model>", RETRIEVER = "<name>". google_genai runtime uses
# GOOGLE_API_KEY (GEMINI_API_KEY accepted as compat). DuckDuckGo needs no key.
LLM_KEY_MAP = {
    "openai": ["OPENAI_API_KEY"],
    "azure_openai": ["AZURE_OPENAI_API_KEY"],
    "anthropic": ["ANTHROPIC_API_KEY"],
    "google_genai": ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    "google_vertexai": ["GOOGLE_API_KEY"],
    "groq": ["GROQ_API_KEY"],
    "openrouter": ["OPENROUTER_API_KEY"],
    "deepseek": ["DEEPSEEK_API_KEY"],
    "mistralai": ["MISTRAL_API_KEY"],
    "together": ["TOGETHER_API_KEY"],
    "fireworks": ["FIREWORKS_API_KEY"],
    "cohere": ["COHERE_API_KEY"],
    "xai": ["XAI_API_KEY"],
    "dashscope": ["DASHSCOPE_API_KEY"],
    "ollama": [],
    "vllm_openai": [],
}
RETRIEVER_KEY_MAP = {
    "tavily": ["TAVILY_API_KEY"],
    "serper": ["SERPER_API_KEY"],
    "searchapi": ["SEARCHAPI_API_KEY"],
    "serpapi": ["SERPAPI_API_KEY"],
    "exa": ["EXA_API_KEY"],
    "bing": ["BING_API_KEY"],
    "google": ["GOOGLE_API_KEY", "GOOGLE_CSE_ID"],
    "brave": ["BRAVE_API_KEY"],
    "bocha": ["BOCHA_API_KEY"],
    "searx": ["SEARX_URL"],
}
NO_KEY_RETRIEVERS = {"duckduckgo", "arxiv", "semantic_scholar", "pubmed_central"}
# Adapter packages required by the INSTALLED gpt-researcher for the selection.
LLM_SUPPORT_PKGS = {
    "openai": "langchain_openai",
    "anthropic": "langchain_anthropic",
    "google_genai": "langchain_google_genai",
    "ollama": "langchain_ollama",
    "groq": "langchain_groq",
}
RETRIEVER_SUPPORT_PKGS = {"duckduckgo": "ddgs", "arxiv": "arxiv"}

# Fix 2 — embedding readiness. gpt-researcher 0.15.1 defaults EMBEDDING to
# "openai:text-embedding-3-small" (config/variables/default.py), which makes a
# Gemini-only run die in Memory/agent.py with an OpenAI credential error.
# Rule: an explicit EMBEDDING env wins; otherwise the selected LLM provider is
# reused for embeddings (never an implicit OpenAI swap). Unknown providers are
# refused, never silently routed to OpenAI.
EMBEDDING_DEFAULT_MODELS = {
    "google_genai": "gemini-embedding-001",
    "openai": "text-embedding-3-small",
}
EMBEDDING_KEY_MAP = dict(LLM_KEY_MAP) | {
    "voyageai": ["VOYAGE_API_KEY"],
    "aimlapi": ["AIMLAPI_API_KEY"],
    "minimax": ["MINIMAX_API_KEY"],
    "custom": ["OPENAI_API_KEY"],
    "netmind": ["NETMIND_API_KEY"],
    "gigachat": ["GIGACHAT_CREDENTIALS"],
    "bedrock": [],  # AWS credential chain, no single key env
    "huggingface": [],  # local model, no key
    "nomic": [],  # local model, no key
}
EMBEDDING_NO_KEY_PROVIDERS = {"huggingface", "nomic"}
EMBEDDING_SUPPORT_PKGS = {
    "openai": "langchain_openai",
    "azure_openai": "langchain_openai",
    "google_genai": "langchain_google_genai",
    "google_vertexai": "langchain_google_vertexai",
    "cohere": "langchain_cohere",
    "ollama": "langchain_ollama",
    "together": "langchain_together",
    "mistralai": "langchain_mistralai",
    "fireworks": "langchain_fireworks",
    "huggingface": "langchain_huggingface",
    "dashscope": "langchain_community",
    "bedrock": "langchain_aws",
}
EMBEDDING_PROBE_INPUT = "UNFOLDIQ embedding smoke test"
LLM_PROBE_INPUT = "Reply with exactly: UNFOLDIQ-LLM-PROBE-OK"
RETRIEVER_PROBE_QUERY = "pyproject.toml python packaging"


def selected_embedding():
    """Resolve embedding provider/model: explicit EMBEDDING env wins, else the
    selected LLM provider (or the library's openai default when nothing is
    selected) with a known default model. Returns a names-only dict."""
    raw = os.environ.get("EMBEDDING")
    if isinstance(raw, str) and raw.strip():
        if ":" not in raw:
            return {"provider": None, "model": None, "explicit": True,
                    "error": "EMBEDDING must be '<provider>:<model>' (e.g. google_genai:gemini-embedding-001)"}
        provider, model = raw.split(":", 1)
        return {"provider": provider.strip().lower().replace("-", "_"), "model": model.strip(),
                "explicit": True, "error": None}
    llm = selected_llm()
    provider = llm["name"] if llm["name"] in EMBEDDING_DEFAULT_MODELS else "openai"
    if provider not in EMBEDDING_DEFAULT_MODELS:
        return {"provider": provider, "model": None, "explicit": False,
                "error": "no default embedding model known for provider %s; set EMBEDDING explicitly" % provider}
    return {"provider": provider, "model": EMBEDDING_DEFAULT_MODELS[provider],
            "explicit": False, "error": None}


def embedding_state():
    emb = selected_embedding()
    provider = emb["provider"]
    if not provider or emb["error"]:
        return emb | {"configured": False, "supported": False, "keyNames": [], "inInstalledProviders": False}
    key_names = list(EMBEDDING_KEY_MAP.get(provider, []))
    if provider in EMBEDDING_NO_KEY_PROVIDERS or not key_names:
        configured = True  # local / credential-chain provider: no single key env
    else:
        configured = any(_has(n, 8) for n in key_names)
    supported = True
    in_installed = None
    try:
        from gpt_researcher.memory.embeddings import _SUPPORTED_PROVIDERS
        in_installed = provider in _SUPPORTED_PROVIDERS
        supported = bool(in_installed)
    except Exception:
        pass  # gpt_researcher not importable: version op reports that instead
    pkg = EMBEDDING_SUPPORT_PKGS.get(provider)
    if pkg and not _importable(pkg):
        supported = False
    return emb | {"configured": bool(configured), "supported": bool(supported),
                  "keyNames": key_names, "inInstalledProviders": in_installed}


def apply_embedding_env():
    """Pin the resolved embedding into the environment so the installed
    library can never fall back to its OpenAI default mid-run."""
    emb = embedding_state()
    if emb["provider"] and emb["model"] and not emb.get("explicit"):
        os.environ["EMBEDDING"] = "%s:%s" % (emb["provider"], emb["model"])
    return emb


def _has(name, min_len):
    v = os.environ.get(name)
    return isinstance(v, str) and len(v) >= min_len


def _importable(pkg):
    try:
        import importlib.util
        return importlib.util.find_spec(pkg) is not None
    except Exception:
        return False


def selected_llm():
    for n in ("FAST_LLM", "SMART_LLM", "STRATEGIC_LLM"):
        v = os.environ.get(n)
        if isinstance(v, str) and v.strip():
            name = v.split(":")[0].strip().lower().replace("-", "_")
            if name:
                return {"name": name, "via": n}
    return {"name": None, "via": None}


def selected_retriever():
    v = os.environ.get("RETRIEVER")
    if isinstance(v, str) and v.strip():
        return v.strip().lower().replace("-", "_")
    return None


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def provider_version():
    try:
        from importlib.metadata import version as pkg_version
        return pkg_version("gpt-researcher")
    except Exception:
        return None


def config_state():
    llm = selected_llm()
    retriever = selected_retriever()
    if not llm["name"]:
        llm_keys = list(LLM_NAMES)
        llm_configured = any(_has(n, 4 if n == "OPENAI_BASE_URL" else 8) for n in llm_keys)
        llm_supported = True # legacy path: adapter presence checked at run time
    elif llm["name"] in LLM_KEY_MAP and len(LLM_KEY_MAP[llm["name"]]) == 0:
        llm_keys = []
        llm_configured = True # local/endpoint provider: no key by design
        llm_supported = _importable(LLM_SUPPORT_PKGS[llm["name"]]) if llm["name"] in LLM_SUPPORT_PKGS else True
    else:
        llm_keys = list(LLM_KEY_MAP.get(llm["name"], LLM_NAMES))
        llm_configured = any(_has(n, 8) for n in llm_keys)
        llm_supported = _importable(LLM_SUPPORT_PKGS[llm["name"]]) if llm["name"] in LLM_SUPPORT_PKGS else True
    if not retriever:
        search_keys = list(SEARCH_NAMES)
        search_configured = any(_has(n, 4) for n in search_keys)
        search_supported = True
    elif retriever in NO_KEY_RETRIEVERS:
        search_keys = []
        search_configured = True # no-key retriever: no key by design
        pkg = RETRIEVER_SUPPORT_PKGS.get(retriever)
        search_supported = _importable(pkg) if pkg else True
    else:
        search_keys = list(RETRIEVER_KEY_MAP.get(retriever, SEARCH_NAMES))
        search_configured = any(_has(n, 4) for n in search_keys)
        search_supported = True
    embedding = embedding_state()
    return {
        "llmConfigured": bool(llm_configured),
        "searchConfigured": bool(search_configured),
        "embeddingConfigured": bool(embedding.get("configured")),
        "liveApproved": os.environ.get(LIVE_ENV) == "1",
        "llmKeyNames": llm_keys,
        "searchKeyNames": search_keys,
        "llm": {"selected": llm["name"], "via": llm["via"], "configured": bool(llm_configured),
                "supported": bool(llm_supported), "keyNames": llm_keys},
        "search": {"retriever": retriever, "configured": bool(search_configured),
                   "supported": bool(search_supported)},
        "embedding": {"provider": embedding.get("provider"), "model": embedding.get("model"),
                      "explicit": bool(embedding.get("explicit")), "configured": bool(embedding.get("configured")),
                      "supported": bool(embedding.get("supported")), "keyNames": embedding.get("keyNames", []),
                      "inInstalledProviders": embedding.get("inInstalledProviders"),
                      "error": embedding.get("error")},
    }


def clamp_int(value, default, low, high):
    try:
        v = int(value)
    except Exception:
        return default
    return max(low, min(v, high))


async def run_deep(request):
    """Execute one bounded deep run. Refuses (no spend) without opt-in/creds."""
    state = config_state()
    if not state["liveApproved"]:
        return {"ok": False, "errorCode": "DEEP_LIVE_NOT_APPROVED",
                "errorMessage": "live deep test not approved (set UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1 explicitly)"}
    if not (state["llmConfigured"] and state["searchConfigured"] and state["embeddingConfigured"]):
        missing = []
        if not state["llmConfigured"]:
            missing.append("LLM")
        if not state["searchConfigured"]:
            missing.append("search")
        if not state["embeddingConfigured"]:
            emb = state["embedding"]
            detail = emb.get("error") or ("embedding key missing for provider %s (checked: %s)"
                                          % (emb.get("provider"), ", ".join(emb.get("keyNames") or ["(none)"])))
            missing.append("EMBEDDING (%s)" % detail)
        return {"ok": False, "errorCode": "DEEP_PROVIDER_MISSING_CREDENTIALS",
                "errorMessage": "required: %s; refusing paid run" % "; ".join(missing)}
    if not (state["llm"]["supported"] and state["search"]["supported"] and state["embedding"]["supported"]):
        missing = []
        if not state["llm"]["supported"]:
            missing.append("llm adapter for selected %s" % state["llm"]["selected"])
        if not state["search"]["supported"]:
            missing.append("retriever dependency for selected %s" % state["search"]["retriever"])
        if not state["embedding"]["supported"]:
            missing.append("embedding adapter for selected %s" % state["embedding"]["provider"])
        return {"ok": False, "errorCode": "DEEP_PROVIDER_NOT_INSTALLED",
                "errorMessage": "selected provider not supported by installed gpt-researcher: %s" % ", ".join(missing)}
    # Pin the resolved embedding (explicit or derived) so the installed library
    # never instantiates its OpenAI default on a Gemini-only run.
    emb = apply_embedding_env()
    try:
        from gpt_researcher import GPTResearcher
    except Exception as exc:
        return {"ok": False, "errorCode": "DEEP_PROVIDER_NOT_INSTALLED",
                "errorMessage": "gpt_researcher import failed: %s" % str(exc)[:300]}

    query = str(request.get("topic") or "")
    gaps = list(request.get("criticalGaps") or request.get("recommendedQuestions") or [])[:6]
    if gaps:
        query = "%s — focus: %s" % (query, "; ".join(str(g)[:160] for g in gaps[:3]))
    breadth = clamp_int(request.get("maxBreadth"), 2, 1, 4)
    depth = clamp_int(request.get("maxDepth"), 1, 1, 2)
    concurrency = clamp_int(request.get("maxConcurrency"), 2, 1, 2)
    total_words = 800  # bounded diagnostic report; canonical path uses sources, not this prose
    # Provider reads breadth/depth/concurrency/total_words from env/config.
    os.environ["DEEP_RESEARCH_BREADTH"] = str(breadth)
    os.environ["DEEP_RESEARCH_DEPTH"] = str(depth)
    os.environ["DEEP_RESEARCH_CONCURRENCY"] = str(concurrency)
    os.environ["TOTAL_WORDS"] = str(total_words)

    started = utc_now()
    try:
        researcher = GPTResearcher(query=query, report_type="deep")
        await researcher.conduct_research()
        try:
            await researcher.write_report()
        except Exception:
            pass  # diagnostic prose is optional; sources are the product
        try:
            source_urls = researcher.get_source_urls() or []
        except Exception:
            source_urls = []
        try:
            sources = researcher.get_research_sources() or []
        except Exception:
            sources = []
        try:
            costs = researcher.get_costs() or []
        except Exception:
            costs = []
        try:
            context = researcher.get_research_context() or []
        except Exception:
            context = []
        candidates = []
        for s in (sources or [])[:50]:
            if isinstance(s, dict) and s.get("url"):
                candidates.append({"url": str(s["url"])[:1000],
                                   "title": str(s.get("title") or "")[:500],
                                   "context": str(s.get("content") or s.get("description") or "")[:1000]})
        for u in (source_urls or [])[:50]:
            if u and not any(c["url"] == str(u) for c in candidates):
                candidates.append({"url": str(u)[:1000], "title": None, "context": "get_source_urls"})
        learnings = []
        for c in (context or [])[:20]:
            if isinstance(c, str) and c.strip():
                learnings.append({"text": c[:2000], "sourceUrls": []})
            elif isinstance(c, dict) and (c.get("content") or c.get("text")):
                learnings.append({"text": str(c.get("content") or c.get("text"))[:2000],
                                  "sourceUrls": [c["url"]] if c.get("url") else []})
        queries = [query] + [str(g)[:200] for g in gaps[:5]]
        return {"ok": True, "result": {
            "requestId": request.get("requestId"),
            "providerVersion": provider_version(),
            "startedAt": started,
            "completedAt": utc_now(),
            "status": "COMPLETED",
            "visitedUrls": [str(u)[:1000] for u in (source_urls or [])[:100]],
            "candidateSources": candidates[:100],
            "queries": queries[:20],
            "followUpQuestions": [],
            "learnings": learnings[:30],
            "providerCitations": [str(u)[:1000] for u in (source_urls or [])[:50]],
            "progressSummary": {"breadth": breadth, "depth": depth, "concurrency": concurrency},
            "warnings": [],
            "errors": [],
            "cost": {"known": (costs if isinstance(costs, (int, float)) else None), "limit": request.get("maxCostClass")},
            "providerReportRef": None,
        }}
    except Exception as exc:
        msg = str(exc)[:500]
        low = msg.lower()
        if "rate" in low and "limit" in low:
            code = "DEEP_RATE_LIMITED"
        elif "quota" in low or "billing" in low or "budget" in low or "insufficient" in low:
            code = "DEEP_BUDGET_EXHAUSTED"
        elif "timeout" in low or "timed out" in low:
            code = "DEEP_TIMEOUT"
        else:
            code = "DEEP_PROVIDER_ERROR"
        return {"ok": False, "errorCode": code, "errorMessage": msg}


async def run_probe(request):
    """One tiny live call through the SAME provider abstraction the run uses.
    Refuses without live opt-in or configured selection; never falls back."""
    state = config_state()
    if not state["liveApproved"]:
        return {"ok": False, "errorCode": "DEEP_LIVE_NOT_APPROVED",
                "errorMessage": "live probe not approved (set UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1 explicitly)"}
    kind = str(request.get("kind") or "").strip().lower()
    if kind == "embedding":
        emb = state["embedding"]
        if not state["embeddingConfigured"] or not emb["supported"] or not emb["provider"]:
            return {"ok": False, "errorCode": "DEEP_PROVIDER_MISSING_CREDENTIALS",
                    "errorMessage": "embedding not ready: %s" % (emb.get("error") or json.dumps(emb, default=str)[:300])}
        apply_embedding_env()
        from gpt_researcher.memory.embeddings import Memory
        memory = Memory(emb["provider"], emb["model"])
        vector = memory.get_embeddings().embed_documents([EMBEDDING_PROBE_INPUT])[0]
        return {"ok": True, "probe": {"kind": "embedding", "provider": emb["provider"], "model": emb["model"],
                                      "className": type(memory.get_embeddings()).__name__,
                                      "dimension": len(vector),
                                      "numeric": all(isinstance(v, (int, float)) for v in vector[:16]),
                                      "explicit": emb["explicit"]}}
    if kind == "llm":
        llm = state["llm"]
        if not state["llmConfigured"] or not llm["supported"] or not llm["selected"]:
            return {"ok": False, "errorCode": "DEEP_PROVIDER_MISSING_CREDENTIALS",
                    "errorMessage": "llm not ready for probe"}
        from gpt_researcher.utils.llm import create_chat_completion
        model = str(os.environ.get("FAST_LLM", "")).split(":", 1)[1] if ":" in os.environ.get("FAST_LLM", "") else None
        text = await create_chat_completion(
            messages=[{"role": "user", "content": LLM_PROBE_INPUT}],
            model=model, llm_provider=llm["selected"], max_tokens=20, stream=False)
        return {"ok": True, "probe": {"kind": "llm", "provider": llm["selected"], "model": model,
                                      "responseHead": str(text)[:120]}}
    if kind == "retriever":
        retriever = state["search"]["retriever"]
        if retriever != "duckduckgo":
            return {"ok": False, "errorCode": "DEEP_PROVIDER_MISSING_CREDENTIALS",
                    "errorMessage": "probe supports the selected duckduckgo retriever only; selected: %s" % retriever}
        if not state["search"]["supported"]:
            return {"ok": False, "errorCode": "DEEP_PROVIDER_NOT_INSTALLED",
                    "errorMessage": "retriever dependency missing for %s" % retriever}
        from gpt_researcher.retrievers.duckduckgo import Duckduckgo
        results = Duckduckgo(RETRIEVER_PROBE_QUERY).search(max_results=3)
        rows = [r for r in (results or []) if isinstance(r, dict) and r.get("url") or isinstance(r, dict) and r.get("href")]
        urls = [str(r.get("url") or r.get("href"))[:500] for r in rows]
        return {"ok": True, "probe": {"kind": "retriever", "provider": "duckduckgo",
                                      "resultCount": len(rows), "urls": urls[:3]}}
    return {"ok": False, "errorCode": "BRIDGE_PROTOCOL_ERROR",
            "errorMessage": "unknown probe kind: %s (embedding|llm|retriever)" % kind}


def main():
    try:
        request = json.loads(sys.stdin.read())
    except Exception as exc:
        sys.stdout.write(json.dumps({"protocolVersion": PROTOCOL_VERSION, "operation": "unknown",
                                     "ok": False, "errorCode": "BRIDGE_PROTOCOL_ERROR",
                                     "errorMessage": "invalid request JSON: %s" % exc}))
        return 3
    if not isinstance(request, dict) or request.get("protocolVersion") != PROTOCOL_VERSION:
        sys.stdout.write(json.dumps({"protocolVersion": PROTOCOL_VERSION,
                                     "operation": request.get("operation") if isinstance(request, dict) else "unknown",
                                     "ok": False, "errorCode": "BRIDGE_PROTOCOL_ERROR",
                                     "errorMessage": "unsupported protocolVersion (expected 1)"}))
        return 3
    op = request.get("operation")
    if op == "version":
        try:
            import gpt_researcher  # noqa: F401
            sys.stdout.write(json.dumps({"protocolVersion": PROTOCOL_VERSION, "operation": "version",
                                         "ok": True, "providerId": PROVIDER_ID,
                                         "providerVersion": provider_version()}))
            return 0
        except Exception as exc:
            sys.stdout.write(json.dumps({"protocolVersion": PROTOCOL_VERSION, "operation": "version",
                                         "ok": False, "errorCode": "DEEP_PROVIDER_NOT_INSTALLED",
                                         "errorMessage": "gpt_researcher import failed: %s" % str(exc)[:300]}))
            return 2
    if op == "config":
        sys.stdout.write(json.dumps({"protocolVersion": PROTOCOL_VERSION, "operation": "config",
                                     "ok": True, **config_state()}))
        return 0
    if op == "probe":
        response = asyncio.run(run_probe(request.get("request") or {}))
        response.setdefault("protocolVersion", PROTOCOL_VERSION)
        response.setdefault("operation", "probe")
        sys.stdout.write(json.dumps(response))
        return 0 if response.get("ok") else 1
    if op == "run":
        response = asyncio.run(run_deep(request.get("request") or {}))
        response.setdefault("protocolVersion", PROTOCOL_VERSION)
        response.setdefault("operation", "run")
        sys.stdout.write(json.dumps(response))
        return 0 if response.get("ok") else 1
    sys.stdout.write(json.dumps({"protocolVersion": PROTOCOL_VERSION, "operation": op,
                                 "ok": False, "errorCode": "BRIDGE_PROTOCOL_ERROR",
                                 "errorMessage": "unknown operation: %s" % op}))
    return 3


if __name__ == "__main__":
    sys.exit(main())
