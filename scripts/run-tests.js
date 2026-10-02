"use strict";

/**
 * UNFOLDIQ test runner — runs the custom Node regression suites by domain.
 * Zero dependencies. Usage:
 *   node scripts/run-tests.js            (all domains)
 *   node scripts/run-tests.js flow       (single domain: flow|providers|pipeline|
 *                                         remotion|media|policy|qa|topic)
 * Exit 0 only if every executed suite passes.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const TESTS_DIR = path.join(REPO_ROOT, "tests");

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
// tests/e2e runs under the Playwright runner (`npm run test:e2e`), not plain node.
const allDomains = fs
  .readdirSync(TESTS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "fixtures" && e.name !== "e2e")
  .map((e) => e.name)
  .sort();
const domains = args.length ? args : allDomains;
for (const d of domains) {
  if (!allDomains.includes(d)) {
    console.error(`UNKNOWN DOMAIN: ${d} (known: ${allDomains.join(", ")})`);
    process.exit(1);
  }
}

let failed = 0;
const started = Date.now();
for (const domain of domains) {
  const dir = path.join(TESTS_DIR, domain);
  const tests = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
  for (const test of tests) {
    const file = path.join(dir, test);
    const res = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 10 * 60 * 1000, cwd: REPO_ROOT });
    const ok = res.status === 0;
    if (ok) {
      const tail = (res.stdout || "").trim().split("\n").pop() || "";
      console.log(`PASS ${domain}/${test}  ${tail.slice(0, 100)}`);
    } else {
      failed++;
      console.log(`FAIL ${domain}/${test} (exit=${res.status})`);
      if (res.stdout) console.log(res.stdout.split("\n").slice(-25).join("\n"));
      if (res.stderr) console.error(res.stderr.split("\n").slice(-10).join("\n"));
    }
  }
}
console.log(`\n=== ${domains.join(", ")}: ${failed} failed suite(s) in ${((Date.now() - started) / 1000).toFixed(1)}s ===`);
process.exit(failed > 0 ? 1 : 0);
