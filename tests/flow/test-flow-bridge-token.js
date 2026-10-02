"use strict";

/**
 * FLOW BRIDGE one-command setup — auto token + persistent local store.
 * Covers spec §23 (bridge) + §24 (package/PowerShell static assertions).
 * Plain node, zero dependencies. Real fs only in tmpdir; spawn tests use
 * ephemeral loopback ports. No external network.
 */

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO_ROOT = path.join(__dirname, "..", "..");
const { resolveBridgeToken, defaultTokenFile, DEFAULT_PORT } = require("../../flow-companion/bridge/run.js");
const { tokenMatches } = require("../../flow-companion/bridge/security.js");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ✓ ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

function capturingOut() {
  const lines = [];
  return { lines, out: { log: (m) => lines.push(String(m)), error: (m) => lines.push(`ERR: ${m}`) } };
}

function tmpTokenFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fbtok-"));
  return path.join(dir, "UNFOLDIQ", "flow-bridge-token");
}

/* fake fs whose readFileSync starts failing with ENOENT, then serves `content`
 * once openSync("wx") hits EEXIST (another process won the race). */
function raceFs(winnerToken) {
  let reads = 0;
  return {
    mkdirSync: () => {},
    readFileSync: () => {
      reads += 1;
      if (reads === 1) {
        const e = new Error("enoent");
        e.code = "ENOENT";
        throw e;
      }
      return `${winnerToken}\n`;
    },
    openSync: () => {
      const e = new Error("exists");
      e.code = "EEXIST";
      throw e;
    },
    writeFileSync: () => {
      throw new Error("writeFileSync must not be called after EEXIST");
    },
    closeSync: () => {},
  };
}

function brokenFs(code) {
  return {
    mkdirSync: () => {},
    readFileSync: () => {
      const e = new Error(code);
      e.code = code;
      throw e;
    },
  };
}

/* Spawns run.js with LOCALAPPDATA pointed at a tmpdir; resolves the full
 * stdout once FLOW_BRIDGE_URL appears, then kills the child. */
function spawnBridge(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "flow-companion", "bridge", "run.js"), ...args], {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`spawn timeout; stdout so far: ${buf}`));
    }, 15000);
    child.stdout.on("data", (c) => {
      buf += c;
      if (buf.includes("FLOW_BRIDGE_URL=")) {
        clearTimeout(timer);
        child.kill();
        resolve(buf);
      }
    });
    child.stderr.on("data", (c) => (buf += c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  await runTest("1-3. first run generates 64-hex token, persists, reuses on second resolve", () => {
    const tokenFile = tmpTokenFile();
    const c1 = capturingOut();
    const r1 = resolveBridgeToken({ env: {}, tokenFile, out: c1.out });
    assert(r1.created === true, "first resolve reports created=true");
    assert(/^[0-9a-f]{64}$/.test(r1.token), "token is 64 hex chars (crypto.randomBytes(32))");
    assert(c1.lines.some((l) => /FLOW_BRIDGE_TOKEN_CREATED=true/.test(l)), "creation flagged in output");
    const persisted = fs.readFileSync(tokenFile, "utf8").trim();
    assert(persisted === r1.token, "token persisted to token file");
    assert(!tokenFile.startsWith(REPO_ROOT), "token file is outside the repository");
    const c2 = capturingOut();
    const r2 = resolveBridgeToken({ env: {}, tokenFile, out: c2.out });
    assert(r2.token === r1.token && r2.created === false, "second resolve reuses the same token");
    assert(c2.lines.includes("FLOW_BRIDGE_TOKEN_SOURCE=LOCAL_FILE"), "second resolve logs LOCAL_FILE");
    assert(!c2.lines.join("\n").includes(r1.token), "second resolve never prints the raw token");
  });

  await runTest("4. default token file lives under LOCALAPPDATA/UNFOLDIQ, outside repo", () => {
    const p = defaultTokenFile();
    assert(/UNFOLDIQ[\\/]flow-bridge-token$/.test(p), `default path ends with UNFOLDIQ\\flow-bridge-token: ${p}`);
    assert(!p.startsWith(REPO_ROOT), "default path is not inside the repository");
  });

  await runTest("5. env override wins without overwriting the file", () => {
    const tokenFile = tmpTokenFile();
    const seed = resolveBridgeToken({ env: {}, tokenFile, out: capturingOut().out });
    const c = capturingOut();
    const r = resolveBridgeToken({ env: { FLOW_BRIDGE_TOKEN: "env-override-token-0123456789" }, tokenFile, out: c.out });
    assert(r.token === "env-override-token-0123456789", "env token used for this process");
    assert(r.created === false && c.lines.includes("FLOW_BRIDGE_TOKEN_SOURCE=ENV"), "ENV source logged");
    assert(fs.readFileSync(tokenFile, "utf8").trim() === seed.token, "persistent file untouched by env override");
  });

  await runTest("6-7. reset-token generates a different token; old token no longer matches", () => {
    const tokenFile = tmpTokenFile();
    const first = resolveBridgeToken({ env: {}, tokenFile, out: capturingOut().out });
    const second = resolveBridgeToken({ env: {}, tokenFile, out: capturingOut().out, reset: true });
    assert(second.created === true && second.token !== first.token, "reset produces a new token");
    assert(fs.readFileSync(tokenFile, "utf8").trim() === second.token, "reset persists the new token");
    assert(!tokenMatches(first.token, second.token), "old token fails against new bridge token");
  });

  await runTest("6b. reset with env override: rotates file, warns, never prints env token", () => {
    const tokenFile = tmpTokenFile();
    const envToken = "s3cret-env-token-0123456789abcdef";
    const first = resolveBridgeToken({ env: {}, tokenFile, out: capturingOut().out });
    const c = capturingOut();
    const r = resolveBridgeToken({ env: { FLOW_BRIDGE_TOKEN: envToken }, tokenFile, out: c.out, reset: true });
    assert(r.created === true && r.token !== first.token, "reset still rotates the persistent token under env override");
    assert(fs.readFileSync(tokenFile, "utf8").trim() === r.token, "new token persisted");
    assert(c.lines.some((l) => l.includes("FLOW_BRIDGE_RESET_WARNING")), "reset warning printed");
    assert(c.lines.some((l) => l.includes("Remove-Item Env:FLOW_BRIDGE_TOKEN")), "PowerShell remediation command printed");
    assert(c.lines.some((l) => l.includes("SAME shell")), "same-shell override shadowing explained");
    assert(!c.lines.join("\n").includes(envToken), "environment token never printed");
    // non-reset env path stays warning-free (SOURCE=ENV is the only signal)
    const c2 = capturingOut();
    resolveBridgeToken({ env: { FLOW_BRIDGE_TOKEN: envToken }, tokenFile, out: c2.out });
    assert(!c2.lines.join("\n").includes("FLOW_BRIDGE_RESET_WARNING"), "no reset warning on normal env-override start");
  });

  await runTest("8. concurrent first-start (EEXIST race) keeps the other process's token", () => {
    const winnerToken = "b".repeat(64);
    const c = capturingOut();
    const r = resolveBridgeToken({ env: {}, tokenFile: tmpTokenFile(), fsImpl: raceFs(winnerToken), out: c.out });
    assert(r.token === winnerToken && r.created === false, "reread the persisted winner token, no overwrite");
    assert(c.lines.includes("FLOW_BRIDGE_TOKEN_SOURCE=LOCAL_FILE"), "race loss logs LOCAL_FILE");
  });

  await runTest("9. unreadable / empty persistent token fails safely (no silent rotation)", () => {
    const c1 = capturingOut();
    let threw = null;
    try {
      resolveBridgeToken({ env: {}, tokenFile: tmpTokenFile(), fsImpl: brokenFs("EACCES"), out: c1.out });
    } catch (e) {
      threw = e;
    }
    assert(threw !== null, "EACCES read aborts startup");
    assert(c1.lines.some((l) => l.includes("FLOW_BRIDGE_TOKEN_ERROR")), "FLOW_BRIDGE_TOKEN_ERROR reported");
    const c2 = capturingOut();
    threw = null;
    try {
      resolveBridgeToken({ env: {}, tokenFile: tmpTokenFile(), fsImpl: { readFileSync: () => "  \n " }, out: c2.out });
    } catch (e) {
      threw = e;
    }
    assert(threw !== null && c2.lines.some((l) => l.includes("FLOW_BRIDGE_TOKEN_ERROR")), "empty token file fails safely too");
  });

  await runTest("10. tokenMatches: missing/wrong/correct", () => {
    const t = "x".repeat(64);
    assert(tokenMatches(t, t) === true, "correct token accepted");
    assert(tokenMatches("y".repeat(64), t) === false, "wrong token rejected");
    assert(tokenMatches(undefined, t) === false && tokenMatches("", t) === false, "missing token rejected");
    assert(tokenMatches(t, undefined) === false, "no expected token configured rejects all");
    assert(tokenMatches(["a", "b"], t) === false, "non-string header rejected");
  });

  await runTest("11. spawn first run: token printed once, bind 127.0.0.1, port 4317", async () => {
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "fbspawn1-"));
    const out = await spawnBridge(["--port", "43117"], { LOCALAPPDATA: local });
    assert(out.includes("FLOW_BRIDGE_TOKEN_CREATED=true"), "first run prints creation block");
    const m = out.match(/FLOW_BRIDGE_TOKEN=([0-9a-f]{64})/);
    assert(m, "first run prints the raw token exactly for copying");
    assert((out.match(/FLOW_BRIDGE_TOKEN=[0-9a-f]{64}/g) || []).length === 1, "token printed exactly once");
    assert(out.includes("FLOW_BRIDGE_LISTENING host=127.0.0.1 port=43117"), "default bind 127.0.0.1");
    assert(fs.readFileSync(path.join(local, "UNFOLDIQ", "flow-bridge-token"), "utf8").trim() === m[1], "spawned run persisted the token");
  });

  await runTest("12. spawn second run: LOCAL_FILE source, raw token NOT printed", async () => {
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "fbspawn2-"));
    await spawnBridge(["--port", "43118"], { LOCALAPPDATA: local });
    const stored = fs.readFileSync(path.join(local, "UNFOLDIQ", "flow-bridge-token"), "utf8").trim();
    const out = await spawnBridge(["--port", "43118"], { LOCALAPPDATA: local });
    assert(out.includes("FLOW_BRIDGE_TOKEN_SOURCE=LOCAL_FILE"), "second run logs LOCAL_FILE");
    assert(!out.includes(stored), "second run never prints the raw token");
  });

  await runTest("13-15. package.json scripts + start-flow.ps1 static assertions", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert(/flow-companion[\\/]bridge[\\/]run\.js/.test(pkg.scripts["flow:bridge"]), "flow:bridge script present");
    assert(/--reset-token/.test(pkg.scripts["flow:bridge:reset-token"]), "flow:bridge:reset-token script present");
    assert(DEFAULT_PORT === 4317, "DEFAULT_PORT stays 4317");
    const ps1 = fs.readFileSync(path.join(REPO_ROOT, "start-flow.ps1"), "utf8");
    assert(ps1.includes("$PSScriptRoot"), "start-flow.ps1 uses $PSScriptRoot");
    assert(!ps1.includes("D:\\Project\\UNFOLDIQ"), "start-flow.ps1 has no hard-coded project path");
    assert(ps1.includes("npm run flow:bridge"), "start-flow.ps1 invokes npm run flow:bridge");
    assert(!ps1.includes("FLOW_BRIDGE_TOKEN"), "no token embedded in start-flow.ps1");
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

// http import kept for parity with tests/flow/test-flow-bridge.js conventions (unused here)
void http;
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
