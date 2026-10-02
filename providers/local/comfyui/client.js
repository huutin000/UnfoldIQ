"use strict";

/**
 * Minimal loopback-only ComfyUI HTTP client (STEP-10C Branch A).
 * Uses only the built-in http module. Never downloads models.
 */

const http = require("http");

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"]);

function assertLoopback(host) {
  if (!ALLOWED_HOSTS.has(String(host))) {
    throw new Error(`COMFYUI_NON_LOOPBACK_REJECTED: ${host}`);
  }
}

function rejectUnsafeOutputPath(p) {
  const s = String(p || "");
  if (s.length === 0) throw new Error("OUTPUT_PATH_EMPTY");
  if (/^https?:\/\//i.test(s)) throw new Error(`OUTPUT_PATH_URL_REJECTED: ${s}`);
  if (require("path").isAbsolute(s)) throw new Error(`OUTPUT_PATH_ABSOLUTE_REJECTED: ${s}`);
  const segs = s.split(/[\\/]/);
  if (segs.includes("..")) throw new Error(`OUTPUT_PATH_TRAVERSAL_REJECTED: ${s}`);
  if (s.includes("\0")) throw new Error("OUTPUT_PATH_INVALID");
  return s;
}

function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(body) : null;
    const reqOpts = { ...opts };
    if (payload) {
      reqOpts.headers = { ...(opts.headers || {}), "Content-Length": payload.length };
    }
    const req = http.request(reqOpts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("COMFYUI_HTTP_TIMEOUT"));
    });
    if (opts.timeout) req.setTimeout(opts.timeout);
    if (payload) req.write(payload);
    req.end();
  });
}

class Client {
  constructor(opts) {
    const o = opts || {};
    const host = o.host || "127.0.0.1";
    assertLoopback(host);
    this.host = host;
    this.port = o.port || 8188;
    this.timeoutMs = typeof o.timeoutMs === "number" ? o.timeoutMs : 10000;
  }

  async health() {
    try {
      const res = await httpRequest(
        { hostname: this.host, port: this.port, path: "/system_stats", method: "GET", timeout: Math.min(this.timeoutMs, 10000) }
      );
      return res.statusCode >= 200 && res.statusCode < 300;
    } catch {
      return false;
    }
  }

  async queuePrompt(promptPatch) {
    const body = JSON.stringify({ prompt: promptPatch || {} });
    const res = await httpRequest(
      {
        hostname: this.host,
        port: this.port,
        path: "/prompt",
        method: "POST",
        timeout: this.timeoutMs,
        headers: { "Content-Type": "application/json" },
      },
      body
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`COMFYUI_QUEUE_FAILED: http ${res.statusCode}`);
    }
    let json = {};
    try {
      json = JSON.parse(res.body.toString("utf8"));
    } catch {
      throw new Error("COMFYUI_QUEUE_BAD_RESPONSE");
    }
    const promptId = json.prompt_id || json.promptId || json.id;
    if (!promptId) throw new Error("COMFYUI_QUEUE_NO_PROMPT_ID");
    return String(promptId);
  }

  async pollHistory(promptId, opts) {
    const o = opts || {};
    const timeoutMs = typeof o.timeoutMs === "number" ? o.timeoutMs : this.timeoutMs;
    const pollMs = typeof o.pollMs === "number" ? o.pollMs : 500;
    const { pollWithDeadline } = require("../../runtime/timeout-policy");
    const id = String(promptId);
    return pollWithDeadline(
      async () => {
        const h = await this.getOutput(id);
        const done = historyComplete(h, id);
        if (done) return { done: true, value: h };
        return { done: false };
      },
      { timeoutMs, pollMs }
    );
  }

  async getOutput(promptId) {
    const id = String(promptId).replace(/[^a-zA-Z0-9_-]/g, "");
    const res = await httpRequest({
      hostname: this.host,
      port: this.port,
      path: `/history/${encodeURIComponent(id)}`,
      method: "GET",
      timeout: this.timeoutMs,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`COMFYUI_HISTORY_FAILED: http ${res.statusCode}`);
    }
    try {
      return JSON.parse(res.body.toString("utf8"));
    } catch {
      throw new Error("COMFYUI_HISTORY_BAD_RESPONSE");
    }
  }

  extractOutputPath(historyJson, outputNode) {
    return extractOutputPath(historyJson, outputNode);
  }
}

function historyComplete(historyJson, promptId) {
  if (!historyJson || typeof historyJson !== "object") return false;
  const entry = historyJson[promptId] || historyJson;
  if (!entry || typeof entry !== "object") return false;
  if (entry.status && entry.status.completed === false) return false;
  return !!(entry.outputs || entry.output || entry.bytes || entry.filename);
}

function extractOutputPath(historyJson, outputNode) {
  if (!historyJson || typeof historyJson !== "object") throw new Error("OUTPUT_HISTORY_INVALID");
  const node = String(outputNode);
  const candidates = [];
  const roots = [];
  const firstKey = Object.keys(historyJson)[0];
  if (historyJson[outputNode] !== undefined) roots.push(historyJson[outputNode]);
  for (const k of Object.keys(historyJson)) {
    const e = historyJson[k];
    if (e && typeof e === "object" && e.outputs && e.outputs[node] !== undefined) {
      roots.push(e.outputs[node]);
    }
    if (e && typeof e === "object" && e.outputs && typeof e.outputs === "object") {
      for (const ok of Object.keys(e.outputs)) {
        roots.push(e.outputs[ok]);
      }
    }
  }
  if (historyJson.outputs && typeof historyJson.outputs === "object") {
    if (historyJson.outputs[node] !== undefined) roots.push(historyJson.outputs[node]);
    for (const ok of Object.keys(historyJson.outputs)) roots.push(historyJson.outputs[ok]);
  }
  if (roots.length === 0 && firstKey !== undefined) {
    const e = historyJson[firstKey];
    if (e && e.outputs) roots.push(e.outputs);
    else roots.push(e);
  }
  const queue = roots.slice();
  while (queue.length > 0) {
    const cur = queue.shift();
    if (typeof cur === "string") {
      candidates.push(cur);
    } else if (Array.isArray(cur)) {
      for (const item of cur) queue.push(item);
    } else if (cur && typeof cur === "object") {
      for (const key of ["filename", "subfolder", "name", "path", "uri", "url", "filepath"]) {
        if (typeof cur[key] === "string") {
          if (key === "subfolder" && typeof cur.filename === "string") {
            candidates.push(`${cur.subfolder}/${cur.filename}`);
          } else if (key !== "subfolder") {
            candidates.push(cur[key]);
          }
        }
      }
      if (Array.isArray(cur.images)) for (const i of cur.images) queue.push(i);
      if (Array.isArray(cur.files)) for (const f of cur.files) queue.push(f);
      if (Array.isArray(cur.gifs)) for (const g of cur.gifs) queue.push(g);
    }
  }
  if (candidates.length === 0) throw new Error("OUTPUT_NOT_FOUND");
  const chosen = candidates[0];
  return rejectUnsafeOutputPath(chosen);
}

module.exports = { Client, extractOutputPath, historyComplete };
