"use strict";

/**
 * Phase 6A §48 Golden creative regressions — Case AB.
 * Golden assertions check finding CODE, SCOPE, REASON CLASS and CORRECTIVE-ACTION CLASS
 * (repairClass) — never exact prose, so they survive wording/model changes.
 */

const fx = require("../fixtures/creative-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/golden");

assertEq(fx.GOLDEN.length, 12, "12 golden creative fixtures registered (§48)");

for (const g of fx.GOLDEN) {
  runTest(`Case AB — golden: ${g.name}`, () => {
    const a = fx.analyze(g.build());
    const b = fx.analyze(g.build());
    assertEq(a.findings.map((f) => f.findingId).sort(), b.findings.map((f) => f.findingId).sort(), "deterministic finding ids across runs");
    for (const want of g.expect.present) {
      const hit = a.findings.find((f) => f.code === want.code && f.scope === want.scope && f.reasonClass === want.reasonClass && f.repairClass === want.repairClass);
      assert(hit, `present: ${want.code} / ${want.scope} / ${want.reasonClass} / ${want.repairClass} (have ${a.findings.map((f) => f.code + "/" + f.reasonClass).join(", ") || "none"})`);
      assert(hit.status === "OPEN" && hit.evidenceRefs.length > 0 && hit.reason.length > 10 && hit.correctiveAction.startsWith(want.repairClass), `${want.code} is actionable (open, evidence, repair-routed)`);
    }
    for (const code of g.expect.absent) assert(!a.findings.some((f) => f.code === code && f.status === "OPEN"), `absent (no false-fail): ${code}`);
  });
}

runTest("Golden set guards both directions: good fixtures never false-fail, bad fixtures never pass", () => {
  const good = ["good-hook", "intentional-slow-beat", "purposeful-static-rest"];
  for (const name of good) {
    const a = fx.analyze(fx.GOLDEN.find((g) => g.name === name).build());
    const worst = a.findings.filter((f) => f.status === "OPEN" && ["P0", "P1", "P2"].includes(f.severity));
    assertEq(worst.map((f) => f.code), [], `${name}: zero open P0/P1/P2`);
  }
  for (const g of fx.GOLDEN.filter((x) => !good.includes(x.name))) {
    const a = fx.analyze(g.build());
    assert(a.findings.some((f) => f.status === "OPEN"), `${g.name}: the injected defect is detected`);
  }
});

runTest("Every finding is machine-readable and repair-routable (no score-only QA)", () => {
  const cr = fx.cr;
  for (const g of fx.GOLDEN) {
    for (const f of fx.analyze(g.build()).findings) {
      assert(cr.contract.validateFinding(f).ok, `${g.name}/${f.code} satisfies the CreativeFinding contract`);
      assert(cr.repair.REPAIR_CLASSES[f.repairClass], `${f.code} repairClass ${f.repairClass} maps to an owner`);
      assert(!("score" in f), `${f.code} carries no score`);
    }
  }
});

done();
