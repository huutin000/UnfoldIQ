"""
UNFOLDIQ Crawl4AI worker (PHASE 1G.1 Prompt 02, work item 1G.1E).

Node owns orchestration, Python owns Crawl4AI invocation, JSON owns the
process boundary: stdin = request JSON, stdout = single response JSON,
stderr = diagnostics, exit code = success/failure.

One AsyncWebCrawler lifecycle per batch (browsers reused across the N bounded
URLs of one acquisition batch). Deterministic extraction only: no LLM
extraction strategy, no screenshots, no PDFs.

Uses the current result.markdown API (raw_markdown / fit_markdown /
markdown_with_citations / references_markdown). No deprecated markdown_v2.
"""

import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone

PROTOCOL_VERSION = 1

try:
    import crawl4ai
    from crawl4ai import (
        AsyncWebCrawler,
        BrowserConfig,
        CacheMode,
        CrawlerRunConfig,
        DefaultMarkdownGenerator,
        BM25ContentFilter,
    )
    from crawl4ai.__version__ import __version__ as CRAWLER_VERSION
except Exception as exc:  # pragma: no cover - import failure is fatal
    sys.stderr.write("crawl4ai import failed: %s\n" % exc)
    sys.stdout.write(json.dumps({
        "protocolVersion": PROTOCOL_VERSION,
        "operation": "version",
        "ok": False,
        "errorCode": "WORKER_IMPORT_FAILED",
        "errorMessage": str(exc),
    }))
    sys.exit(2)


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


CACHE_MODES = {
    "ENABLED": CacheMode.ENABLED,
    "READ_ONLY": CacheMode.READ_ONLY,
    "WRITE_ONLY": CacheMode.WRITE_ONLY,
    "DISABLED": CacheMode.DISABLED,
    "BYPASS": CacheMode.BYPASS,
}


def build_config(item, defaults):
    fit_query = item.get("fitQuery") or defaults.get("fitQuery")
    if fit_query:
        generator = DefaultMarkdownGenerator(
            content_filter=BM25ContentFilter(user_query=fit_query)
        )
    else:
        generator = DefaultMarkdownGenerator()
    cache_mode = CACHE_MODES.get(
        (item.get("cacheMode") or defaults.get("cacheMode") or "BYPASS"),
        CacheMode.BYPASS,
    )
    kwargs = {
        "markdown_generator": generator,
        "cache_mode": cache_mode,
        "wait_until": item.get("waitUntil") or defaults.get("waitUntil") or "domcontentloaded",
        "page_timeout": int(item.get("pageTimeoutMs") or defaults.get("pageTimeoutMs") or 45000),
        "verbose": False,
    }
    if item.get("waitFor"):
        kwargs["wait_for"] = item["waitFor"]
    if item.get("baseUrl"):
        kwargs["base_url"] = item["baseUrl"]
    return CrawlerRunConfig(**kwargs)


def truncate(text, limit):
    if text is None:
        return None, False
    if limit and len(text) > limit:
        return text[:limit], True
    return text, False


def sha256_hex(text):
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


async def crawl_item(crawler, item, defaults, limits):
    item_id = item.get("id") or item.get("url") or "raw-html"
    requested = item.get("url") or ""
    retrieved_at = utc_now()
    try:
        if item.get("kind") == "rawHtml":
            # Crawl4AI accepts inline HTML via the raw: scheme; base_url keeps
            # relative links meaningful (config.base_url is honored for raw:).
            source = "raw:" + (item.get("html") or "")
        else:
            source = item.get("url")
        config = build_config(item, defaults)
        result = await crawler.arun(url=source, config=config)
        # arun may return a container in some versions; unwrap defensively.
        if hasattr(result, "results") and isinstance(getattr(result, "results"), list):
            result = result.results[0] if result.results else None
        if result is None:
            raise RuntimeError("empty crawl result")
        md = result.markdown
        raw, raw_truncated = truncate(md.raw_markdown if md else None, limits.get("maxMarkdownChars"))
        fit_src = md.fit_markdown if md else None
        fit, fit_truncated = truncate(fit_src, limits.get("maxMarkdownChars"))
        links = []
        try:
            for link in (result.links or {}).get("internal", []) + (result.links or {}).get("external", []):
                href = link.get("href") if isinstance(link, dict) else str(link)
                if href:
                    links.append(href)
                if len(links) >= 200:
                    break
        except Exception:
            links = []
        title = ""
        try:
            title = ((result.metadata or {}).get("title") or "")[:500]
        except Exception:
            title = ""
        response_headers = {}
        try:
            for k, v in dict(getattr(result, "response_headers", None) or {}).items():
                if len(response_headers) < 50:
                    response_headers[str(k)[:200]] = str(v)[:1000]
        except Exception:
            response_headers = {}
        if result.success:
            return {
                "id": item_id,
                "requestedUrl": requested,
                "finalUrl": getattr(result, "redirected_url", None) or result.url or requested,
                "success": True,
                "statusCode": getattr(result, "status_code", None),
                "retrievedAt": retrieved_at,
                "rawMarkdown": raw,
                "rawTruncated": raw_truncated,
                "fitMarkdown": fit,
                "fitTruncated": fit_truncated,
                "fitQuery": item.get("fitQuery") or defaults.get("fitQuery"),
                "markdownWithCitations": (md.markdown_with_citations if md else None),
                "referencesMarkdown": (md.references_markdown if md else None),
                "title": title,
                "metadata": result.metadata or {},
                "responseHeaders": response_headers,
                "links": links,
                "linkCount": len(links),
                "contentHash": sha256_hex(raw),
                "extractionMethod": "crawl4ai-direct" if item.get("kind") != "rawHtml" else "crawl4ai-raw-html",
                "crawlerVersion": CRAWLER_VERSION,
                "errorCode": None,
                "errorMessage": None,
            }
        return {
            "id": item_id,
            "requestedUrl": requested,
            "finalUrl": getattr(result, "redirected_url", None) or result.url or requested,
            "success": False,
            "statusCode": getattr(result, "status_code", None),
            "retrievedAt": retrieved_at,
            "rawMarkdown": None,
            "fitMarkdown": None,
            "title": title,
            "metadata": result.metadata or {},
            "responseHeaders": response_headers,
            "links": [],
            "linkCount": 0,
            "contentHash": None,
            "extractionMethod": "crawl4ai-direct",
            "crawlerVersion": CRAWLER_VERSION,
            "errorCode": classify_error(result),
            "errorMessage": (getattr(result, "error_message", None) or "crawl failed")[:1000],
        }
    except Exception as exc:
        return {
            "id": item_id,
            "requestedUrl": requested,
            "finalUrl": requested,
            "success": False,
            "statusCode": None,
            "retrievedAt": retrieved_at,
            "rawMarkdown": None,
            "fitMarkdown": None,
            "title": "",
            "metadata": {},
            "links": [],
            "linkCount": 0,
            "contentHash": None,
            "extractionMethod": "crawl4ai-direct",
            "crawlerVersion": CRAWLER_VERSION,
            "errorCode": classify_exception(exc),
            "errorMessage": str(exc)[:1000],
        }


def classify_error(result):
    msg = (getattr(result, "error_message", "") or "").lower()
    status = getattr(result, "status_code", None)
    if status == 429:
        return "RATE_LIMITED"
    if status and 400 <= status < 600:
        return "HTTP_ERROR"
    if "timeout" in msg or "timed out" in msg:
        return "NETWORK_TIMEOUT"
    if "robots" in msg:
        return "ROBOTS_DISALLOWED"
    return "EXTRACTION_FAILED"


def classify_exception(exc):
    msg = str(exc).lower()
    if "timeout" in msg or "timed out" in msg:
        return "NETWORK_TIMEOUT"
    return "EXTRACTION_FAILED"


async def run_crawl(request):
    defaults = request.get("defaults") or {}
    limits = request.get("limits") or {}
    items = request.get("items") or []
    browser_config = BrowserConfig(verbose=False)
    async with AsyncWebCrawler(config=browser_config) as crawler:
        results = []
        for item in items:
            results.append(await crawl_item(crawler, item, defaults, limits))
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "operation": "crawl",
        "crawlerVersion": CRAWLER_VERSION,
        "results": results,
    }


def main():
    try:
        raw = sys.stdin.read()
        request = json.loads(raw)
    except Exception as exc:
        sys.stdout.write(json.dumps({
            "protocolVersion": PROTOCOL_VERSION,
            "operation": "unknown",
            "ok": False,
            "errorCode": "BRIDGE_PROTOCOL_ERROR",
            "errorMessage": "invalid request JSON: %s" % exc,
        }))
        return 3
    if not isinstance(request, dict) or request.get("protocolVersion") != PROTOCOL_VERSION:
        sys.stdout.write(json.dumps({
            "protocolVersion": PROTOCOL_VERSION,
            "operation": request.get("operation") if isinstance(request, dict) else "unknown",
            "ok": False,
            "errorCode": "BRIDGE_PROTOCOL_ERROR",
            "errorMessage": "unsupported protocolVersion (expected 1)",
        }))
        return 3
    operation = request.get("operation")
    if operation == "version":
        sys.stdout.write(json.dumps({
            "protocolVersion": PROTOCOL_VERSION,
            "operation": "version",
            "ok": True,
            "crawlerVersion": CRAWLER_VERSION,
        }))
        return 0
    if operation == "crawl":
        try:
            response = asyncio.run(run_crawl(request))
        except Exception as exc:
            sys.stderr.write("crawl batch failed: %s\n" % exc)
            return 1
        sys.stdout.write(json.dumps(response))
        return 0
    sys.stdout.write(json.dumps({
        "protocolVersion": PROTOCOL_VERSION,
        "operation": operation,
        "ok": False,
        "errorCode": "BRIDGE_PROTOCOL_ERROR",
        "errorMessage": "unknown operation: %s" % operation,
    }))
    return 3


if __name__ == "__main__":
    sys.exit(main())
