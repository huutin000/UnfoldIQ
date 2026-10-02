"use strict";

/**
 * Shared deterministic evidence fixtures for tests/research (Prompt 03).
 * Benign technical topic (HTTP 308). No network. Bodies are calibrated:
 * A~C near-duplicate Jaccard ~0.77, A~D Jaccard ~0.00.
 */

const crypto = require("crypto");

const BODY_A = `The HTTP 308 Permanent Redirect status code indicates that the target resource has been assigned a new permanent URI. The client must use the new URI for all future requests. Unlike the 301 status code, the 308 status code requires the client to preserve the original request method and body when following the redirect. A server sending a 308 response should include a Location header field with the new permanent URI. User agents may rewrite history and bookmarks to the new address. The 308 code was standardized to remove ambiguity about method preservation that existed with older redirect codes. Caches may store the redirect response for future use. Search engines transfer ranking signals to the new permanent address over time.`;

const BODY_B = BODY_A; // exact syndicated copy on another URL

const BODY_C = `The HTTP 308 Permanent Redirect status code indicates that the target resource has been assigned a new permanent URI. The client should use the new URI for all future requests. Unlike the 301 status code, the 308 status code requires the client to preserve the original request method and body when following the redirect. A server sending a 308 response must include a Location header field with the new permanent URI. User agents may update history and bookmarks to the new address. The 308 code was standardized to remove ambiguity about method preservation that existed with older redirect codes. Caches may store the redirect response for future use. Search engines transfer ranking signals to the new permanent address over time.`;

const BODY_D = `Redirects tell browsers that a page moved. A permanent redirect uses status 308 or 301, sending visitors to a Location header. With 308 the method stays PUT or POST exactly as sent, which matters for forms and APIs. Operators configure these rules in their web server or CDN settings. Testing is done with curl using the verbose flag to inspect headers. Monitoring dashboards track redirect chains to avoid loops that slow down page loads for users.`;

const BODY_SHORT = `Short stub about redirects.`;

// Material disagreement fixtures: method preservation on 308.
const BODY_PRESERVE = `Our reference states that HTTP 308 Permanent Redirect requires clients to preserve the original request method and body. A POST stays a POST after following the Location header. This behavior was the entire motivation for standardizing 308 separately from 301. Server operators rely on this guarantee for form submissions and API calls that must not silently change method across the redirect boundary.`;

const BODY_REWRITE = `Our reference states that HTTP 308 Permanent Redirect allows clients to rewrite the request method to GET when following the redirect. A POST may become a GET after following the Location header. This flexibility helps browsers optimize repeat visits and caching behavior. Server operators should not depend on method stability across the redirect boundary in this interpretation.`;

const BODY_VI = `Mã trạng thái HTTP 308 Permanent Redirect cho biết tài nguyên đã được gán một URI thường trú mới. Máy khách phải sử dụng URI mới cho mọi yêu cầu trong tương lai. Khác với mã 301, mã 308 yêu cầu máy khách giữ nguyên phương thức và thân yêu cầu gốc khi đi theo chuyển hướng. Máy chủ nên kèm tiêu đề Location chứa URI mới. Đây là toàn bộ nội dung liên quan trích từ tài liệu gốc dài hơn nhiều.`;

function sha256(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function makeDoc(url, body, opts = {}) {
  const hash = opts.contentHash || sha256(body);
  return {
    requestedUrl: url,
    finalUrl: opts.finalUrl || url,
    retrievedAt: opts.retrievedAt || "2026-10-02T10:00:00.000Z",
    success: true,
    statusCode: 200,
    route: "crawl4ai-direct",
    extractionMethod: "crawl4ai-direct",
    crawlerVersion: "0.9.4",
    browserAcquired: false,
    rawMarkdown: body,
    rawTruncated: false,
    fitMarkdown: opts.fitMarkdown !== undefined ? opts.fitMarkdown : body.slice(0, 400),
    fitQuery: opts.fitQuery || null,
    title: opts.title || "Fixture",
    metadata: opts.metadata || {},
    links: [],
    linkCount: 0,
    contentHash: hash,
    errorCode: null,
    errorMessage: null,
  };
}

function makeSearch(query, url, rank = 1) {
  return { query, url, title: "Fixture result", snippet: "fixture snippet", provider: "agent-exchange", retrievedAt: "2026-10-02T10:00:00.000Z", searchRank: rank };
}

module.exports = {
  BODY_A, BODY_B, BODY_C, BODY_D, BODY_SHORT,
  BODY_PRESERVE, BODY_REWRITE, BODY_VI,
  sha256, makeDoc, makeSearch,
};
