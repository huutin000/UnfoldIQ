#!/usr/bin/env node
"use strict";

/**
 * Record the OWNER's approval of an exact script text and rebuild the TTS-ready
 * plan so the Script Quality Gate opens. The agent must run this only after the
 * owner has explicitly approved; the approver and the source of the approval
 * (for example the owner's message) are mandatory and are stored in the decision.
 * Approval is bound to the script text hash: any later text change makes it stale.
 *
 * Usage: node scripts/cli/script-owner-approval.js --project <id> --script <fssArtifactId> --version <n>
 *          --approved-by "<owner>" --source "<where the approval was given>" [--note "..."] [--root <dir>]
 * It never creates audio.
 */

const fs = require("fs");
const path = require("path");

const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const REPO = path.resolve(arg("--root") || path.join(__dirname, "..", ".."));
const lib = (p) => require(path.join(__dirname, "..", "..", "lib", p));
const ss = lib("spoken-script/index.js");
const narr = lib("narration/index.js");
const pron = lib("pronunciation/index.js");
const ttsReady = lib("tts-ready-plan.js");
const gate = lib("script-qa/gate.js");

const P = arg("--project");
const fssId = arg("--script");
const version = Number(arg("--version"));
const approvedBy = arg("--approved-by");
const source = arg("--source");
if (!P || !fssId || !version || !approvedBy || !source) {
  console.error('usage: script-owner-approval.js --project <id> --script <fssId> --version <n> --approved-by "<owner>" --source "<evidence of the approval>" [--note ".."]');
  process.exit(2);
}
const fail = (m) => { console.error("SCRIPT_APPROVAL_FAILED: " + m); process.exit(1); };

const loaded = gate.loadDecision(REPO, P, fssId, version);
if (!loaded.ok) fail(loaded.code);
if (loaded.decision.verdict !== "READY_FOR_LOCK") fail(`Script QA verdict is ${loaded.decision.verdict}; approval refused`);
const fss = ss.loadFinalSpokenScript(REPO, P, fssId, version);
if (!fss.ok) fail(fss.code);
if (gate.scriptTextHash(fss.script.segments) !== loaded.decision.scriptTextHash) fail("script text changed after the QA decision (stale); re-run Script QA first");

const approvedDecision = gate.withOwnerApproval(loaded.decision, { approvedBy, source, note: arg("--note") });
gate.persistDecision(REPO, P, approvedDecision);

const nd = narr.latestNarrationDirection(REPO, P);
const vbRef = JSON.parse(fs.readFileSync(path.join(REPO, "projects", P, "voice", "narration-direction", fs.readdirSync(path.join(REPO, "projects", P, "voice", "narration-direction"))[0]), "utf8")).voiceBibleRef;
const passes = fs.readdirSync(path.join(REPO, "projects", P, "voice", "pronunciation-pass"));
const pass = JSON.parse(fs.readFileSync(path.join(REPO, "projects", P, "voice", "pronunciation-pass", passes[passes.length - 1]), "utf8"));
const plan = ttsReady.buildTtsReadyPlan(REPO, P, { scriptDoc: fss.script, narrationDirectionDoc: nd.narrationDirection, passDoc: pass, voiceBibleRef: vbRef, provider: pass.provider, providerModel: pass.providerModel, requireScriptQa: true, scriptQaDecision: approvedDecision });
if (!plan.ok) fail(plan.code);
const att = ttsReady.attachManifestReference(REPO, P, plan.plan.ttsReadyPlanId);
if (!att.ok) fail(att.code);
const reg = ttsReady.registerDagNode(REPO, P, plan.plan.ttsReadyPlanId);
if (!reg.ok) fail(reg.code);
console.log(JSON.stringify({ approved: true, approvedBy, scriptTextHash: approvedDecision.scriptTextHash, ttsReadyPlan: plan.plan.ttsReadyPlanId, productionTtsBlocked: plan.plan.productionTtsBlocked, scriptQa: plan.plan.provenance.scriptQa, note: "approval does not create audio; full TTS remains a separate step" }, null, 2));
