"use strict";

/**
 * POST-PHASE-2 B3 — SecretStore abstraction (UNFOLDIQ CORE).
 *
 * OS-protected storage for long-lived device secret material. The contract
 * is platform-agnostic; Windows uses DPAPI (CurrentUser scope — normally
 * decryptable only by the same user on the same machine). A plaintext dev
 * backend exists for explicit developer/recovery mode ONLY and is never the
 * default. Secrets are never logged and never returned in reports.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BACKENDS = ["memory", "dpapi", "dev-plaintext"];
const DPAPI_MAGIC = "DPAPI1"; // marker distinguishing our DPAPI blobs

const ERRORS = {
  UNKNOWN_BACKEND: "unknown secret-store backend",
  DPAPI_UNAVAILABLE: "DPAPI backend unavailable on this platform",
  SECRET_NOT_FOUND: "secret key not found",
  DEV_PLAINTEXT_FORBIDDEN: "dev-plaintext backend requires explicit allowPlaintextDev flag",
};

function createSecretStore({ backend = "dpapi", dir, allowPlaintextDev = false, spawnImpl = spawnSync } = {}) {
  if (!BACKENDS.includes(backend)) {
    throw new Error(`${ERRORS.UNKNOWN_BACKEND}: ${backend}`);
  }
  if (backend === "dev-plaintext" && !allowPlaintextDev) {
    throw new Error(ERRORS.DEV_PLAINTEXT_FORBIDDEN);
  }
  if (backend === "dpapi" && process.platform !== "win32") {
    throw new Error(`${ERRORS.DPAPI_UNAVAILABLE}: ${process.platform}`);
  }
  if (dir) fs.mkdirSync(dir, { recursive: true });

  const memory = new Map();

  const fileFor = (key) => path.join(dir, `${sanitize(key)}.${backend === "dpapi" ? "dpapi" : "devsecret"}`);

  function sanitize(key) {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(key)) throw new Error("SECRET_KEY_INVALID");
    return key;
  }

  function runPowerShell(script) {
    const r = spawnImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 30000 });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`DPAPI_FAILED: exit ${r.status}: ${String(r.stderr || "").slice(0, 200)}`);
    return String(r.stdout || "").trim();
  }

  return {
    backend,
    /** Store a secret string. Rotates by overwriting (old material invalid). */
    put(key, value) {
      if (typeof value !== "string" || value.length === 0) throw new Error("SECRET_VALUE_INVALID");
      if (backend === "memory") {
        memory.set(key, value);
        return { ok: true };
      }
      const file = fileFor(key);
      if (backend === "dpapi") {
        const tmpIn = path.join(dir, `.${key}.plain.${process.pid}-${Date.now()}`);
        fs.writeFileSync(tmpIn, value, "utf8");
        try {
          const b64 = runPowerShell(
            `Add-Type -AssemblyName System.Security; ` +
            `$plain=[Text.Encoding]::UTF8.GetBytes('${DPAPI_MAGIC}:'); ` +
            `$p=[Security.Cryptography.ProtectedData]::Protect([IO.File]::ReadAllBytes('${tmpIn}'),[Text.Encoding]::UTF8.GetBytes('${DPAPI_MAGIC}'),'CurrentUser'); ` +
            `$out=New-Object byte[] ($plain.Length+$p.Length); [Array]::Copy($plain,0,$out,0,$plain.Length); [Array]::Copy($p,0,$out,$plain.Length,$p.Length); ` +
            `[Convert]::ToBase64String($out)`
          );
          fs.writeFileSync(file, Buffer.from(b64, "base64"));
          return { ok: true };
        } finally {
          if (fs.existsSync(tmpIn)) { try { fs.unlinkSync(tmpIn); } catch {} }
        }
      }
      // dev-plaintext: explicit developer/recovery mode only.
      fs.writeFileSync(file, value, { encoding: "utf8", mode: 0o600 });
      return { ok: true, warning: "PLAINTEXT_DEV_SECRET: developer/recovery mode only — never ship" };
    },
    get(key) {
      if (backend === "memory") return memory.has(key) ? { ok: true, value: memory.get(key) } : { ok: false, code: "SECRET_NOT_FOUND" };
      const file = fileFor(key);
      if (!fs.existsSync(file)) return { ok: false, code: "SECRET_NOT_FOUND" };
      if (backend === "dpapi") {
        try {
          const b64 = runPowerShell(
            `Add-Type -AssemblyName System.Security; ` +
            `$raw=[IO.File]::ReadAllBytes('${file}'); ` +
            `$mark=[Text.Encoding]::UTF8.GetByteCount('${DPAPI_MAGIC}:'); ` +
            `$blob=New-Object byte[] ($raw.Length-$mark); [Array]::Copy($raw,$mark,$blob,0,$blob.Length); ` +
            `$p=[Security.Cryptography.ProtectedData]::Unprotect($blob,[Text.Encoding]::UTF8.GetBytes('${DPAPI_MAGIC}'),'CurrentUser'); ` +
            `[Text.Encoding]::UTF8.GetString($p)`
          );
          return { ok: true, value: b64 };
        } catch (e) {
          return { ok: false, code: "SECRET_UNPROTECT_FAILED", message: String(e.message).slice(0, 200) };
        }
      }
      return { ok: true, value: fs.readFileSync(file, "utf8") };
    },
    delete(key) {
      if (backend === "memory") { memory.delete(key); return { ok: true }; }
      const file = fileFor(key);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { ok: true };
    },
    /** Whether the at-rest bytes are OS-protected (Case H evidence). */
    isProtectedAtRest() {
      return backend === "dpapi" || backend === "memory";
    },
  };
}

/** Random helper (exported for deterministic test seeding avoidance). */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

module.exports = { createSecretStore, randomToken, BACKENDS, ERRORS, DPAPI_MAGIC };
