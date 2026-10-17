"use strict";

/**
 * Security regression (finding 5): projectId / jobId containing ../ must not
 * make the bridge write outside <projectRoot>/projects/<projectId>.
 *
 * Sandbox: <tmp>/a/b/root is the projectRoot. Everything is inside <tmp>, so a
 * traversal that escapes the project dir lands in <tmp>/a/b/root or <tmp>/a/*
 * (still inside the temp dir) where it is detected by walking the tree.
 * SAFE: request rejected and no file exists outside the legitimate project dir.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { baseJob, TEST_TOKEN } = require("../../flow-companion/bridge/tests/fixtures.js");

let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try { await fn(); console.log("[PASS]"); } catch (e) { console.log(`[FAIL] ${e.message}`); failed++; }
}

function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ hostname: "127.0.0.1", port, path: p, method: "POST", headers: { "Content-Type": "application/json", "x-bridge-token": TEST_TOKEN } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, text: buf }));
    });
    r.on("error", reject);
    r.write(data);
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-traversal-"));
  const root = path.join(tmp, "a", "b", "root");
  fs.mkdirSync(path.join(root, "projects", "legit"), { recursive: true });
  const bridge = createBridgeServer({ projectRoot: root, token: TEST_TOKEN });
  const addr = await bridge.listen(0);
  const legitDir = path.join(root, "projects", "legit") + path.sep;

  // Files outside the legitimate project dir = escape.
  const escaped = () => walk(tmp).filter((f) => !f.startsWith(legitDir));

  try {
    await runTest("projectId '../../../escape' must not create files outside projects/<id>", async () => {
      const r = await post(addr.port, "/jobs", { projectId: "../../../escape", job: baseJob({ projectId: "../../../escape", jobId: "TRAV-1" }) });
      console.log(`  output: status=${r.status} body=${r.text.slice(0, 160)}`);
      const esc = escaped();
      console.log(`  output: files outside project dir: ${JSON.stringify(esc.map((f) => path.relative(tmp, f)))}`);
      assert(esc.length === 0, "no file written outside the project directory");
      assert(r.status >= 400 && r.status < 500, `request rejected with 4xx (got ${r.status})`);
    });

    await runTest("jobId '../../../../pwned' must not create files outside flow-jobs/", async () => {
      const r = await post(addr.port, "/jobs", { projectId: "legit", job: baseJob({ projectId: "legit", jobId: "../../../../pwned" }) });
      console.log(`  output: status=${r.status} body=${r.text.slice(0, 160)}`);
      const esc = escaped();
      console.log(`  output: files outside project dir: ${JSON.stringify(esc.map((f) => path.relative(tmp, f)))}`);
      assert(esc.length === 0, "no file written outside the project directory");
      const inJobs = fs.existsSync(path.join(legitDir, "flow-jobs")) ? walk(path.join(legitDir, "flow-jobs")) : [];
      assert(inJobs.every((f) => path.dirname(f) === path.join(legitDir, "flow-jobs")), "all job files sit directly in flow-jobs/");
      assert(r.status >= 400 && r.status < 500, `request rejected with 4xx (got ${r.status})`);
    });
  } finally {
    await bridge.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
