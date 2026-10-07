"use strict";

/**
 * Flow Companion bridge launcher (POST-v1B live run).
 * Loopback-only, token-gated.
 *
 * Token resolution precedence (FLOW BRIDGE one-command setup):
 *   1. FLOW_BRIDGE_TOKEN env override (CI/dev; never persisted, never printed)
 *   2. persistent local token file (%LOCALAPPDATA%\UNFOLDIQ\flow-bridge-token)
 *   3. first run: generate crypto.randomBytes(32) hex token, persist, print ONCE
 *
 * Usage:
 *   npm run flow:bridge                       (auto token, no env setup)
 *   npm run flow:bridge:reset-token           (rotate: new token printed once)
 *   FLOW_BRIDGE_TOKEN=<token> node flow-companion/bridge/run.js [--port 4317]
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DEFAULT_PORT = 4317;

function parsePort(argv) {
  const i = argv.indexOf("--port");
  if (i >= 0 && argv[i + 1]) {
    const p = Number(argv[i + 1]);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error(`INVALID_PORT: ${argv[i + 1]}`);
    return p;
  }
  return DEFAULT_PORT;
}

function defaultTokenFile() {
  // %LOCALAPPDATA% on Windows; ~/.unfoldiq elsewhere (outside the repository).
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), ".unfoldiq");
  return path.join(base, "UNFOLDIQ", "flow-bridge-token");
}

/**
 * Resolve the bridge token. Returns { token, created }.
 * `created` is true only when a new token was generated this run — the only
 * time the raw token may be printed. Unreadable/corrupt persistent state
 * fails loudly instead of silently rotating (that would invalidate the
 * token the extension remembers).
 */
function resolveBridgeToken({ env = process.env, tokenFile = defaultTokenFile(), fsImpl = fs, out = console, reset = false } = {}) {
  if (reset && env.FLOW_BRIDGE_TOKEN) {
    // Reset rotates the persistent file, but an env override in THIS shell
    // would silently shadow the new token on normal starts. Never print it.
    out.log("FLOW_BRIDGE_RESET_WARNING: FLOW_BRIDGE_TOKEN is still set in this shell.");
    out.log("Future normal Bridge starts in this SAME shell will still use the environment override instead of the new persistent token.");
    out.log("PowerShell remediation: Remove-Item Env:FLOW_BRIDGE_TOKEN");
    out.log("");
  }
  if (!reset && env.FLOW_BRIDGE_TOKEN) {
    const t = String(env.FLOW_BRIDGE_TOKEN);
    if (t.length < 16) throw new Error("BRIDGE_TOKEN_INVALID: FLOW_BRIDGE_TOKEN must be >=16 chars");
    out.log("FLOW_BRIDGE_TOKEN_SOURCE=ENV");
    return { token: t, created: false };
  }

  if (!reset) {
    let existing;
    try {
      existing = fsImpl.readFileSync(tokenFile, "utf8").trim();
    } catch (e) {
      if (e.code !== "ENOENT") {
        out.error("FLOW_BRIDGE_TOKEN_ERROR");
        out.error("Không thể đọc mã truy cập Bridge đã lưu. Chạy npm run flow:bridge:reset-token để tạo mã mới.");
        throw e;
      }
    }
    if (existing) {
      out.log("FLOW_BRIDGE_TOKEN_SOURCE=LOCAL_FILE");
      return { token: existing, created: false };
    }
    if (existing !== undefined) {
      // empty file = corrupt persistent state → explicit reset required
      out.error("FLOW_BRIDGE_TOKEN_ERROR");
      out.error("Không thể đọc mã truy cập Bridge đã lưu. Chạy npm run flow:bridge:reset-token để tạo mã mới.");
      throw new Error("FLOW_BRIDGE_TOKEN_EMPTY");
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  fsImpl.mkdirSync(path.dirname(tokenFile), { recursive: true });
  try {
    // exclusive create on first run: never clobber a token another process
    // just wrote; reset intentionally overwrites.
    const fd = fsImpl.openSync(tokenFile, reset ? "w" : "wx", 0o600);
    fsImpl.writeFileSync(fd, `${token}\n`, "utf8");
    fsImpl.closeSync(fd);
  } catch (e) {
    if (e.code === "EEXIST") {
      out.log("FLOW_BRIDGE_TOKEN_SOURCE=LOCAL_FILE");
      return { token: fsImpl.readFileSync(tokenFile, "utf8").trim(), created: false };
    }
    throw e;
  }
  // The ONLY intentional raw-token display: first persistent creation or
  // explicit reset. Local terminal, once.
  out.log("FLOW_BRIDGE_TOKEN_CREATED=true");
  out.log(`FLOW_BRIDGE_TOKEN=${token}`);
  out.log("");
  out.log('Copy FLOW_BRIDGE_TOKEN into Flow Companion once, then check "Nhớ mã truy cập trên thiết bị này".');
  out.log("The token is stored locally and will be reused on future starts.");
  return { token, created: true };
}

function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset-token");
  let resolved;
  try {
    resolved = resolveBridgeToken({ reset, out: console });
  } catch (e) {
    if (!/FLOW_BRIDGE_TOKEN_ERROR/.test(e.message)) console.error(`BRIDGE_TOKEN_ERROR: ${e.message}`);
    process.exit(2);
  }
  const port = parsePort(args);
  const { createBridgeServer } = require("./server");
  const { createPairingManager } = require("../../lib/device-pairing/index.js");
  const { createSecretStore } = require("../../lib/device-pairing/secret-store.js");

  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), ".unfoldiq");
  const runtimeRoot = path.join(base, "UNFOLDIQ");
  const secretBackend = process.platform === "win32" ? "dpapi" : "dev-plaintext";
  const secretStore = createSecretStore({
    backend: secretBackend,
    dir: path.join(runtimeRoot, "secrets"),
    allowPlaintextDev: secretBackend === "dev-plaintext",
  });
  // Exact-origin allowlist for trusted-device pairing (spec §7.1). Override
  // with FLOW_PAIRING_ORIGINS="https://app.example.com,http://localhost:5173".
  const pairingOrigins = String(process.env.FLOW_PAIRING_ORIGINS ||
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080,http://127.0.0.1:8080")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const pairing = createPairingManager({
    stateDir: path.join(runtimeRoot, "pairing"),
    secretStore,
    allowedOrigins: pairingOrigins,
  });
  const bridge = createBridgeServer({ projectRoot: PROJECT_ROOT, token: resolved.token, host: "127.0.0.1", pairing });
  bridge.listen(port).then(
    (addr) => {
      console.log(`FLOW_BRIDGE_LISTENING host=127.0.0.1 port=${addr.port}`);
      console.log(`FLOW_BRIDGE_URL=http://127.0.0.1:${addr.port}`);
      console.log(`FLOW_PAIRING_ENABLED=true secretBackend=${secretBackend} origins=${pairingOrigins.join(",")}`);
      console.log("Trusted-device pairing is active: the normal flow no longer needs the token (kept for developer/recovery mode).");
      console.log("Keep this terminal open for the whole live run. Ctrl+C stops the bridge.");
    },
    (e) => {
      console.error(`BRIDGE_LISTEN_FAILED: ${e.message}`);
      process.exit(1);
    }
  );
}

if (require.main === module) main();

module.exports = { DEFAULT_PORT, parsePort, defaultTokenFile, resolveBridgeToken };
