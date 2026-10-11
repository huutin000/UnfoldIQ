#!/usr/bin/env node
"use strict";

/**
 * CLI for lib/script-qa (integration of existing QA capabilities + generic
 * script/evidence checks). Exit 0 only for READY_FOR_LOCK; 1 for REVIEW_REQUIRED
 * or FAIL. It never locks a script: locking is an owner decision.
 *
 * Usage: node scripts/checks/script-qa.js --script <draft.md> --ledger <claim-ledger.json>
 *          [--meta meta.json] [--editorial editorial.json] [--dispositions disp.json]
 *          [--wps 2.5] [--basis MEASURED|ESTIMATED] [--golden-passed] [--originality-corpus fingerprints.json] [--out result.json]
 *       node scripts/checks/script-qa.js --golden <golden-cases.json> --ledger <ledger.json> [--out results.json]
 */

const fs = require("fs");
const { runScriptQa, parseScriptTable } = require("../../lib/script-qa/index.js");

function arg(name, flag = false) {
  const i = process.argv.indexOf(name);
  if (i < 0) return flag ? false : null;
  return flag ? true : process.argv[i + 1];
}
const readJson = (p, d) => (p ? JSON.parse(fs.readFileSync(p, "utf8")) : d);

const goldenPath = arg("--golden");
if (goldenPath) {
  const { runGolden } = require("../../lib/script-qa/golden.js");
  const g = runGolden(readJson(goldenPath).cases, readJson(arg("--ledger")));
  if (arg("--out")) fs.writeFileSync(arg("--out"), JSON.stringify({ kind: "SCRIPT_QA_GOLDEN_RESULT", ...g }, null, 2) + "\n");
  console.log(JSON.stringify(g.summary));
  for (const r of g.results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} [${r.kind}] found=${r.found.join(",") || "-"}`);
  process.exit(g.summary.allPassed ? 0 : 1);
}

const scriptPath = arg("--script");
const ledgerPath = arg("--ledger");
if (!scriptPath || !ledgerPath) {
  console.error("usage: script-qa.js --script <draft.md> --ledger <claim-ledger.json> [--meta f] [--editorial f] [--dispositions f] [--wps n] [--basis MEASURED|ESTIMATED] [--golden-passed] [--out f]");
  process.exit(2);
}
const result = runScriptQa({
  scenes: parseScriptTable(fs.readFileSync(scriptPath, "utf8")),
  ledger: readJson(ledgerPath),
  meta: readJson(arg("--meta"), {}),
  editorial: readJson(arg("--editorial"), []),
  dispositions: readJson(arg("--dispositions"), {}),
  options: { wordsPerSecond: arg("--wps") ? Number(arg("--wps")) : undefined, durationBasis: arg("--basis") || undefined, goldenPassed: arg("--golden-passed", true), originalityCorpus: readJson(arg("--originality-corpus"), undefined) },
});
result.script = scriptPath;
result.ledger = ledgerPath;
const out = arg("--out");
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
const by = (s) => result.findings.filter((f) => f.status === s && !(f.disposition && f.disposition.decision === "ACCEPT")).length;
console.log(JSON.stringify({ verdict: result.verdict, scenes: result.scenes, words: result.words, estimatedSeconds: result.estimatedSeconds, durationBasis: result.durationBasis, fail: by("FAIL"), review: by("REVIEW"), requirements: result.requirements.filter((r) => !r.met).map((r) => r.id) }));
for (const f of result.findings) {
  if (f.status === "RESOLVED" || (f.disposition && f.disposition.decision === "ACCEPT")) continue;
  console.log(`${f.status} ${f.severity} ${f.code} ${f.scene || "-"} [${f.class}] ${f.detail}`);
}
process.exit(result.verdict === "READY_FOR_LOCK" ? 0 : 1);
