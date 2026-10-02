"use strict";

/**
 * UNFOLDIQ provider timeout policy (STEP-10C Branch A).
 * Bounded waits only. No infinite polling. Timeout never implies paid retry.
 */

const TIMEOUTS = {
  "comfyui-image": 120000,
  "comfyui-video": 600000,
  "kokoro-tts": 60000,
  "whisper-stt": 300000,
  "cloud-image": 120000,
  "cloud-video": 600000,
  "cloud-tts": 60000,
  "cloud-stt": 180000,
  "flow-bridge": 10000,
  "mcp-default": 60000,
};

function getTimeout(op) {
  if (Object.prototype.hasOwnProperty.call(TIMEOUTS, op)) return TIMEOUTS[op];
  return TIMEOUTS["mcp-default"];
}

function withTimeout(promise, ms, code) {
  const timeoutMs = typeof ms === "number" && ms > 0 ? ms : getTimeout("mcp-default");
  const errCode = code || "TIMEOUT";
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        const { transient } = require("./errors");
        reject(transient(errCode, `operation timed out after ${timeoutMs}ms (${errCode})`));
      } catch (e) {
        reject(e);
      }
    }, timeoutMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    Promise.resolve(promise).then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollWithDeadline(fn, opts) {
  const o = opts || {};
  const timeoutMs = typeof o.timeoutMs === "number" && o.timeoutMs > 0 ? o.timeoutMs : getTimeout("mcp-default");
  const pollMs = typeof o.pollMs === "number" && o.pollMs > 0 ? o.pollMs : 500;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await fn();
    if (last && last.done === true) return last.value !== undefined ? last.value : last;
    if (Date.now() >= deadline) {
      const { transient } = require("./errors");
      throw transient("TIMEOUT", `polling timed out after ${timeoutMs}ms`);
    }
    const wait = Math.min(pollMs, Math.max(0, deadline - Date.now()));
    if (wait <= 0) {
      const { transient } = require("./errors");
      throw transient("TIMEOUT", `polling timed out after ${timeoutMs}ms`);
    }
    await sleep(wait);
    if (Date.now() >= deadline) {
      const { transient } = require("./errors");
      throw transient("TIMEOUT", `polling timed out after ${timeoutMs}ms`);
    }
  }
}

module.exports = { TIMEOUTS, getTimeout, withTimeout, pollWithDeadline };
