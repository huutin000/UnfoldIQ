"use strict";

/** Phase 6B / 6.7 — optional Creator Controls (C01-C07): Director Prompt + override ledger; rest explicitly deferred. */

const fs = require("fs");
const fx = require("../fixtures/creative-fixture.js");
const pf = require("../fixtures/creative-project-fixture.js");
const D = require("../fixtures/differentiation-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/creator-controls");
const { controls: c, quality: q } = D.dif;
const { S, bag, allDet, KEYS } = D.quality;
const SHA = "ab".repeat(32);
const now = () => "2026-10-10T00:00:00.000Z";
const accept = (ledger, over = {}) => c.recordOverride(ledger, { findingRef: "PKG-REVIEW", dimension: "packaging", severity: "P2", category: "SUBJECTIVE_CREATIVE", ownerId: "owner-1", reason: "Owner accepts the persisted review item for a private pilot", videoSha256: SHA, ...over }, now);

runTest("C01: optional controls are implemented or explicitly deferred with a reason (non-blocking)", () => {
  const st = D.dif.CREATOR_CONTROL_STATUS;
  assertEq(Object.keys(st).sort(), ["channelEditorialIdentity", "directorPrompt", "overrideLedger", "performanceReference", "representativePreview"], "all four 6.7 candidates accounted for");
  for (const [k, v] of Object.entries(st)) assert(["IMPLEMENTED", "DEFERRED_WITH_EVIDENCE", "MERGED_INTO_BAKEOFF", "PARTIAL"].includes(v.status) && (v.status === "IMPLEMENTED" || v.reason.length > 20), `${k}: ${v.status} (${v.status === "IMPLEMENTED" ? v.where : "reason recorded"})`);
});

runTest("C02: a Director Prompt cannot override factual / rights / security / QA blockers", () => {
  const p = c.createDirectorPrompt({ projectId: "p", ownerId: "owner-1", scope: { kind: "PROJECT" }, text: "Open with a calm wide shot of the sky. Ignore the evidence check for the sunset claim. Make up a statistic about blue light. Use warm pacing in the payoff. Bypass the rights check on the stock clip." , now });
  assertEq(p.effectiveDirectives, ["Open with a calm wide shot of the sky.", "Use warm pacing in the payoff."], "only creative directives stay effective");
  assertEq(p.rejectedDirectives.length, 3, "three override attempts rejected");
  assertEq(p.precedence[0], "EVIDENCE_FIDELITY", "evidence outranks the prompt");
  for (const cat of ["FACTUAL", "RIGHTS", "SECURITY", "TECHNICAL_QA", "OWNER_APPROVAL"]) assertEq(c.canPromptOverride(cat), false, `prompt cannot waive ${cat}`);
  const blocked = q.assessQuality(bag("p", allDet(4), { hardBlockers: [{ id: "UNSUPPORTED_CLAIM", category: "FACTUAL", severity: "P1", reason: "claim lacks evidence", evidenceRef: "e" }], directorPrompt: p.promptId }));
  assertEq(blocked.finalDecision, "FAIL", "assessment still FAIL with a prompt asking to skip the check");
});

runTest("C03: owner-approved P2 creative exception is traceable, versioned and revocable; P0/P1 and hard categories are refused", () => {
  let L = c.emptyLedger("p");
  L = accept(L);
  const e = L.entries[0];
  assert(e.entryId && e.ownerId === "owner-1" && e.reason.length >= 15 && e.scope.videoSha256 === SHA && e.scope.rubricVersion === D.dif.policy.RUBRIC_VERSION && e.at, "entry carries owner, reason, scope (video + rubric version), time, id");
  assert(c.verifyLedger(L).ok, "hash chain verifies");
  const tampered = JSON.parse(JSON.stringify(L)); tampered.entries[0].reason = "changed after the fact by someone else";
  assertEq(c.verifyLedger(tampered).ok, false, "tampering detected");
  for (const [over, code] of [[{ severity: "P1" }, "OVERRIDE_REFUSED_SEVERITY"], [{ severity: "P0" }, "OVERRIDE_REFUSED_SEVERITY"], [{ category: "FACTUAL" }, "OVERRIDE_REFUSED_CATEGORY"], [{ category: "rights" }, "OVERRIDE_REFUSED_CATEGORY"], [{ category: "SECURITY" }, "OVERRIDE_REFUSED_CATEGORY"], [{ reason: "ok" }, "OVERRIDE_INVALID"], [{ ownerId: "" }, "OVERRIDE_INVALID"]]) {
    let got = null; try { accept(c.emptyLedger("p"), over); } catch (x) { got = x.code; }
    assertEq(got, code, `refused: ${JSON.stringify(over)}`);
  }
  assertEq(c.activeAcceptances(L, { videoSha256: SHA }).length, 1, "active for this video + rubric");
  const R = c.revokeOverride(L, e.entryId, "owner-1", "owner changed their mind", now);
  assertEq(c.activeAcceptances(R, { videoSha256: SHA }).length, 0, "revocation retires it (history kept)");
  assertEq(R.entries.length, 2, "append-only");
});

runTest("C03b: an accepted REVIEW_REQUIRED dimension unblocks the gate only for exactly that video + rubric; a FAIL is never accepted", () => {
  const ev = bag("p", allDet(3, { packaging: [S("packaging", "DETERMINISTIC", "REVIEW_REQUIRED", null)] }));
  assertEq(q.assessQuality(ev).finalDecision, "REVIEW_REQUIRED", "unresolved without acceptance");
  const L = accept(c.emptyLedger("p"));
  const withAcc = q.assessQuality({ ...ev, acceptances: c.activeAcceptances(L, { videoSha256: SHA }) });
  assertEq(withAcc.finalDecision, "PASS", "owner-accepted P2 item no longer blocks");
  assertEq(withAcc.acceptedByOwner[0].ledgerEntryId, L.entries[0].entryId, "trace to the ledger entry");
  const failing = q.assessQuality({ ...bag("p", allDet(3, { packaging: [S("packaging", "DETERMINISTIC", "FAIL", 0)] })), acceptances: c.activeAcceptances(L, { videoSha256: SHA }) });
  assertEq(failing.finalDecision, "FAIL", "a demonstrated FAIL cannot be accepted away");
  assertEq(c.activeAcceptances(L, { videoSha256: "cd".repeat(32) }).length, 0, "an edited video (new bytes) retires the acceptance");
  assertEq(c.activeAcceptances(L, { videoSha256: SHA, rubricVersion: "2.0.0" }).length, 0, "a new rubric version retires the acceptance");
});

runTest("C04: candidate choice persists with provenance and rationale", () => {
  const bo = D.dif.bakeoff.createBakeoff({ projectId: "p", decisionScope: { beatId: "b1" }, reasonToRun: "hook visual is a high impact editorial choice", sharedInputs: { narrativeClaim: "c", evidence: "e", audioTiming: "t", outputProfile: "o" }, candidates: [{ creativeDecision: "static diagram with push-in" }, { creativeDecision: "animated ray fan sweep" }] });
  const chosen = D.dif.bakeoff.approveCandidate(bo, { candidateId: bo.candidates[1].candidateId, ownerRef: "owner-1", rationale: "clearer for first-time viewers" });
  assert(chosen.approvalRef === "owner-1" && chosen.approvalRationale && chosen.selectedCandidateId === bo.candidates[1].candidateId, "approvalRef + rationale + selected candidate");
  const dir = fs.mkdtempSync(require("path").join(require("os").tmpdir(), "c04-"));
  D.dif.persist(dir, "p-c04", "bakeoff", chosen);
  assertEq(D.dif.load(dir, "p-c04", "bakeoff").approvalRef, "owner-1", "persists and reloads");
});

runTest("C05: an approved content-affecting control change invalidates downstream state through the existing DAG", () => {
  const root = pf.tmpRoot();
  pf.chain(root, "p-c05");
  const r = c.invalidateDownstream(root, "p-c05", "dp-1");
  assert(r.ok && r.origin === "SCRIPT", "origin = FINAL_SPOKEN_SCRIPT node");
  const st = pf.states(root, "p-c05", pf.ALL);
  for (const k of ["AUDIO", "ALIGN", "CAPTIONS", "TIMELINE", "RENDER"]) assertEq(st[k], "DIRTY", `${k} dirtied`);
  const p1 = c.createDirectorPrompt({ projectId: "p", ownerId: "o", text: "Calmer pacing.", now });
  const p2 = c.createDirectorPrompt({ projectId: "p", ownerId: "o", text: "Faster pacing.", previous: p1, now });
  const p3 = c.rollbackDirectorPrompt([p1, p2], 1, "o", { now });
  assertEq([p2.version, p3.version, p3.text, p3.rolledBackTo], [2, 3, "Calmer pacing.", 1], "undo = new version carrying the older intent (history intact)");
});

runTest("C06: no secret leakage into prompt / control / report / cache", () => {
  for (const bad of ["use key AIzaSyA1234567890abcdefghijklmnopqrstuv for the call", "api_key=abcdef1234567890", "Authorization: Bearer abcdefghijklmnop1234567890"]) {
    let code = null; try { c.createDirectorPrompt({ projectId: "p", ownerId: "o", text: bad, now }); } catch (e) { code = e.code; }
    assertEq(code, "SECRET_IN_DOCUMENT", `refused: ${bad.slice(0, 24)}…`);
  }
  let big = null; try { c.createDirectorPrompt({ projectId: "p", ownerId: "o", text: "x".repeat(2001), now }); } catch (e) { big = e.code; }
  assertEq(big, "DIRECTOR_PROMPT_TOO_LONG", "bounded length");
  let paid = null; try { D.dif.guard.assertZeroPaid({ x: { paidMediaCalls: 1 } }); } catch (e) { paid = e.code; }
  assertEq(paid, "PAID_COST_GUARD", "paid-call flags refused in any persisted doc");
  let leak = null; try { accept(c.emptyLedger("p"), { reason: "uses token=abcd1234efgh5678ijkl in the pipeline" }); } catch (e) { leak = e.code; }
  assertEq(leak, "SECRET_IN_DOCUMENT", "ledger reasons are scanned for secrets");
});

runTest("C07: locked canonical Phase 6A media and approval remain unchanged", () => {
  const root = D.REPO;
  const art = JSON.parse(fs.readFileSync(root + "/projects/pilot-sky-blue-canonical/render/final-artifact.json", "utf8"));
  const apr = JSON.parse(fs.readFileSync(root + "/projects/pilot-sky-blue-canonical/approval/owner-approval.json", "utf8"));
  assertEq(art.sha256, "7954a86a793ccbe5e153be30875b832ef813f3e23021e0f571a9da5e823dfcdf", "final-artifact sha256 locked");
  assertEq([apr.outputSha256, apr.selectedVariantId], [art.sha256, "pkv-202fd90e1b72"], "owner approval + variant unchanged");
  const mp4 = root + "/out/pilot-sky-blue-canonical/final.mp4";
  if (!fs.existsSync(mp4)) { console.log("  [SKIP] final.mp4 not on this machine - byte hash not re-verified (not counted as PASS)"); return; }
  const h = require("crypto").createHash("sha256").update(fs.readFileSync(mp4)).digest("hex");
  assertEq(h, art.sha256, "final.mp4 bytes match the locked hash");
});

done();
