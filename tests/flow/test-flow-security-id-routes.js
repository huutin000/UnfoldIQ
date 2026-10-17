"use strict";

/**
 * Security regression: projectId / jobId on the jobs/* and instruction/* routes.
 * Real HTTP, in-process bridge on 127.0.0.1 ephemeral port, temp project root.
 * Describes CURRENT group A behaviour (assertSafeId on path + query ids): green.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { TEST_TOKEN } = require("../../flow-companion/bridge/tests/fixtures.js");

let failed = 0;
let passed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
}
async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try { await fn(); console.log("[PASS]"); passed++; } catch (e) { console.log(`[FAIL] ${e.message}`); failed++; }
}

function call(port, method, p, body, headers = { "x-bridge-token": TEST_TOKEN }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: "127.0.0.1", port, path: p, method, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, text: buf }));
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-id-routes-"));
  const root = path.join(tmp, "a", "b", "root");
  const legitDir = path.join(root, "projects", "legit");
  fs.mkdirSync(legitDir, { recursive: true });
  const bridge = createBridgeServer({ projectRoot: root, token: TEST_TOKEN });
  const addr = await bridge.listen(0);
  const port = addr.port;
  const noEscape = () => walk(tmp).filter((f) => !f.startsWith(legitDir + path.sep));

  const expectInvalidId = (r, label) => {
    console.log(`  output: ${label} -> ${r.status} ${r.text.slice(0, 100)}`);
    assert(r.status === 400, `${label}: 400 (got ${r.status})`);
    assert(/INVALID_ID/.test(r.text), `${label}: INVALID_ID error`);
  };

  try {
    await runTest("jobId path segment with encoded slash/traversal is rejected with 400 INVALID_ID", async () => {
      expectInvalidId(await call(port, "GET", "/jobs/..%2F/x?projectId=legit"), "/jobs/..%2F/x");
      expectInvalidId(await call(port, "GET", "/jobs/..%2F..%2Fx?projectId=legit"), "/jobs/..%2F..%2Fx");
      expectInvalidId(await call(port, "POST", "/jobs/a%5Cb/cancel?projectId=legit", {}), "backslash in jobId (cancel)");
      expectInvalidId(await call(port, "POST", "/jobs/..%2Fx/approve?projectId=legit", {}), "traversal in jobId (approve)");
      assert(noEscape().length === 0, "no file created outside the legit project dir");
    });

    await runTest("dot-segment jobId that the URL parser collapses never reaches the store (4xx, no file)", async () => {
      for (const p of ["/jobs/%2e%2e/x?projectId=legit", "/jobs/../x?projectId=legit", "/jobs/./x?projectId=legit"]) {
        const r = await call(port, "GET", p);
        console.log(`  output: ${p} -> ${r.status}`);
        assert(r.status >= 400 && r.status < 500, `${p}: 4xx (got ${r.status})`);
      }
      assert(noEscape().length === 0, "no file created outside the legit project dir");
    });

    await runTest("projectId query with traversal is rejected with 400 INVALID_ID", async () => {
      expectInvalidId(await call(port, "GET", "/jobs/JOB-1?projectId=../x"), "?projectId=../x");
      expectInvalidId(await call(port, "GET", "/jobs/JOB-1?projectId=..%2Fx"), "?projectId=..%2Fx");
      expectInvalidId(await call(port, "GET", "/jobs/JOB-1?projectId=..%5Cx"), "?projectId=..%5Cx");
      expectInvalidId(await call(port, "POST", "/jobs/JOB-1/cancel?projectId=../x", {}), "cancel ?projectId=../x");
      expectInvalidId(await call(port, "POST", "/jobs/JOB-1/result?projectId=../../x", {}), "result ?projectId=../../x");
      assert(noEscape().length === 0, "no file created outside the legit project dir");
    });

    await runTest("missing or empty projectId query is a 400 SCHEMA_INVALID", async () => {
      for (const p of ["/jobs/JOB-1", "/jobs/JOB-1?projectId="]) {
        const r = await call(port, "GET", p);
        assert(r.status === 400 && /SCHEMA_INVALID/.test(r.text), `${p}: 400 SCHEMA_INVALID (got ${r.status} ${r.text.slice(0, 80)})`);
      }
    });

    await runTest("duplicated projectId query (a&b / legit&../x) never yields 2xx or 5xx and writes nothing", async () => {
      for (const p of ["/jobs/JOB-1?projectId=a&projectId=b", "/jobs/JOB-1?projectId=legit&projectId=../x", "/jobs/JOB-1?projectId=../x&projectId=legit"]) {
        const r = await call(port, "GET", p);
        console.log(`  output: ${p} -> ${r.status} ${r.text.slice(0, 80)}`);
        assert(r.status === 400 || r.status === 404, `${p}: 400 or 404 (got ${r.status})`);
      }
      assert(noEscape().length === 0, "no file created outside the legit project dir");
    });

    await runTest("jobId length boundary on the path: 128 passes id check (404), 129 is 400", async () => {
      const ok = await call(port, "GET", `/jobs/${"a".repeat(128)}?projectId=legit`);
      assert(ok.status === 404, `128 chars: valid id, job not found (got ${ok.status})`);
      expectInvalidId(await call(port, "GET", `/jobs/${"a".repeat(129)}?projectId=legit`), "129-char jobId");
      expectInvalidId(await call(port, "GET", `/jobs/JOB-1?projectId=${"p".repeat(129)}`), "129-char projectId");
    });

    await runTest("trailing-newline and non-id characters in ids are rejected", async () => {
      expectInvalidId(await call(port, "GET", "/jobs/JOB-1%0A?projectId=legit"), "jobId with %0A");
      expectInvalidId(await call(port, "GET", "/jobs/JOB-1?projectId=legit%0A"), "projectId with %0A");
      expectInvalidId(await call(port, "GET", "/jobs/JOB%001?projectId=legit"), "jobId with NUL");
    });

    await runTest("instruction/* routes validate path and query ids", async () => {
      expectInvalidId(await call(port, "GET", "/instruction/..%2Fx?projectId=legit"), "GET /instruction/..%2Fx");
      expectInvalidId(await call(port, "POST", "/instruction/apply?projectId=../x", { providerProjectRef: "ref" }), "apply ?projectId=../x");
      expectInvalidId(await call(port, "POST", "/instruction/evidence?projectId=../x", { syncId: "sy-0123456789ab" }), "evidence ?projectId=../x");
      expectInvalidId(await call(port, "POST", "/instruction/apply?projectId=..%2F..%2Fx", { providerProjectRef: "ref" }), "apply ?projectId=..%2F..%2Fx");
      const dup = await call(port, "POST", "/instruction/apply?projectId=a&projectId=../x", { providerProjectRef: "ref" });
      console.log(`  output: apply duplicated projectId -> ${dup.status} ${dup.text.slice(0, 80)}`);
      assert(dup.status < 500, `duplicated projectId on apply is not a 5xx (got ${dup.status})`);
      assert(noEscape().length === 0, "no file created outside the legit project dir");
    });

    await runTest("id checks sit behind the auth gate: no token on traversal ids -> 401", async () => {
      for (const p of ["/jobs/..%2Fx?projectId=legit", "/jobs/JOB-1?projectId=../x", "/instruction/apply?projectId=../x"]) {
        const r = await call(port, "GET", p, null, {});
        assert(r.status === 401, `${p}: 401 without credentials (got ${r.status})`);
      }
    });
  } finally {
    await bridge.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n=== id-routes: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main();
