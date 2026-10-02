"use strict";
// scripts/cli/pipeline-cli.js — STEP-13 Branch B CLI (repo root).
//   node scripts/cli/pipeline-cli.js status --project <id> [--json]
//   node scripts/cli/pipeline-cli.js prepare --project <id>
//   node scripts/cli/pipeline-cli.js render --project <id> [--concurrency N] [--timeout-ms N]
//   node scripts/cli/pipeline-cli.js resume --project <id>
//   node scripts/cli/pipeline-cli.js cancel --project <id> [--reason <text>]
//   node scripts/cli/pipeline-cli.js qa --project <id> [--attempt N]
//   node scripts/cli/pipeline-cli.js attempts --project <id> [--json]
//   node scripts/cli/pipeline-cli.js submit-visual-review --project <id> --file <review.json>
// Exit: 0 ok, 1 usage/IO, 2 blocked/failed state. No provider calls.

var fs = require("fs");
var path = require("path");
var Ajv = require("ajv");
var addFormats = require("ajv-formats");

var Orchestrator = require("../../pipeline/render-orchestrator.js");

var ROOT = path.join(__dirname, "..", "..");

function usage() {
  return [
    "Usage:",
    "  node scripts/cli/pipeline-cli.js status --project <id> [--json]",
    "  node scripts/cli/pipeline-cli.js prepare --project <id>",
    "  node scripts/cli/pipeline-cli.js render --project <id> [--concurrency N] [--timeout-ms N] [--max-attempts N]",
    "  node scripts/cli/pipeline-cli.js resume --project <id>",
    "  node scripts/cli/pipeline-cli.js cancel --project <id> [--reason <text>]",
    "  node scripts/cli/pipeline-cli.js qa --project <id> [--attempt N]",
    "  node scripts/cli/pipeline-cli.js attempts --project <id> [--json]",
    "  node scripts/cli/pipeline-cli.js submit-visual-review --project <id> --file <review.json>"
  ].join("\n");
}

function parseArgs(argv) {
  var cmd = argv[0] || null;
  var o = { _: cmd, project: null, json: false, concurrency: null, timeoutMs: null, maxAttempts: null,
    reason: null, attempt: null, file: null, allowMachineOnly: false };
  var cmds = ["status", "prepare", "render", "resume", "cancel", "qa", "attempts", "submit-visual-review"];
  if (!cmd || cmds.indexOf(cmd) === -1) return { error: "unknown command: " + String(cmd) };
  for (var i = 1; i < argv.length; i++) {
    var a = argv[i];
    function next() {
      if (i + 1 >= argv.length) throw new Error("missing value for " + a);
      i++;
      return argv[i];
    }
    try {
      if (a === "--project") o.project = next();
      else if (a.indexOf("--project=") === 0) o.project = a.slice(11);
      else if (a === "--json") o.json = true;
      else if (a === "--concurrency") o.concurrency = Number(next());
      else if (a.indexOf("--concurrency=") === 0) o.concurrency = Number(a.slice(15));
      else if (a === "--timeout-ms") o.timeoutMs = Number(next());
      else if (a.indexOf("--timeout-ms=") === 0) o.timeoutMs = Number(a.slice(13));
      else if (a === "--max-attempts") o.maxAttempts = Number(next());
      else if (a.indexOf("--max-attempts=") === 0) o.maxAttempts = Number(a.slice(15));
      else if (a === "--reason") o.reason = next();
      else if (a.indexOf("--reason=") === 0) o.reason = a.slice(9);
      else if (a === "--attempt") o.attempt = next();
      else if (a.indexOf("--attempt=") === 0) o.attempt = a.slice(10);
      else if (a === "--file") o.file = next();
      else if (a.indexOf("--file=") === 0) o.file = a.slice(7);
      else if (a === "--allow-machine-only") o.allowMachineOnly = true;
      else return { error: "unknown argument: " + a };
    } catch (e) {
      return { error: e.message };
    }
  }
  if (!o.project) return { error: "missing --project <id>" };
  if ((cmd === "render") && (o.concurrency !== null && !(o.concurrency > 0))) {
    return { error: "--concurrency must be > 0" };
  }
  if ((cmd === "render") && (o.timeoutMs !== null && !(o.timeoutMs > 0))) {
    return { error: "--timeout-ms must be > 0" };
  }
  if ((cmd === "render") && (o.maxAttempts !== null && (!(o.maxAttempts > 0) || !(o.maxAttempts <= 6)))) {
    return { error: "--max-attempts must be within 1..6 (operator override, recorded; default policy is 3)" };
  }
  if (cmd === "submit-visual-review" && !o.file) return { error: "missing --file <review.json>" };
  o.cmd = cmd;
  return o;
}

function loadStateStore() {
  try {
    return require("../../pipeline/state-store.js");
  } catch (e) {
    return null;
  }
}

function readState(projectId) {
  var SS = loadStateStore();
  if (SS) {
    try {
      var s = SS.loadState(ROOT, projectId);
      if (s && s.status === "NEW" && !(s.attempts || []).length) return null;
      return s;
    } catch (e) {
      return null;
    }
  }
  var abs = path.join(ROOT, "projects", projectId, "render", "pipeline-state.json");
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    return null;
  }
}

function latestAttempt(state) {
  if (!state || !Array.isArray(state.attempts) || !state.attempts.length) return null;
  return state.attempts[state.attempts.length - 1];
}

function fmtPct(f) {
  if (typeof f !== "number" || !isFinite(f)) return "n/a";
  return Math.round(f * 100) + "%";
}

function nextAction(state) {
  if (!state) return "run prepare to validate inputs and derive the render plan";
  var last = latestAttempt(state);
  switch (state.status) {
    case "FINAL_RENDER_READY": return "done: out/" + state.projectId + "/final.mp4";
    case "READY_TO_RENDER": return "run render to start attempt " + ((state.attempts || []).length + 1);
    case "RENDERING": return "render in progress; wait, or run cancel to stop it";
    case "RENDER_INTERRUPTED": return "run resume: interrupted work is never frame-resumed, a fresh attempt is required";
    case "RENDERED": return "run qa to evaluate attempt " + (last && last.attemptId);
    case "QA_RUNNING": return "QA running; wait for the verdict";
    case "QA_REVIEW_REQUIRED": return "submit a visual review (submit-visual-review) for attempt " + (last && last.attemptId);
    case "FIX_REQUIRED": return "resolve the required fix, then run resume for a fresh attempt";
    case "RE_RENDERING": return "re-render queued; wait for the new attempt";
    case "BLOCKED": return "resolve blockers, then run prepare";
    case "FAILED": return "inspect the failure class, then run resume (or prepare for fresh inputs)";
    case "CANCELLED": return "cancelled; run prepare to start fresh (never auto-resumed)";
    case "PREPARING": return "prepare interrupted; run prepare again";
    default: return "run resume to compute the next step";
  }
}

// Human-readable status per spec §44:
// Project / State / Attempt / Progress / Technical QA / Visual QA / Issues / Next action.
function printStatus(projectId, state) {
  if (!state) {
    process.stdout.write("Project: " + projectId + "\n");
    process.stdout.write("State: NEW (no pipeline state yet)\n");
    process.stdout.write("Attempt: none\n");
    process.stdout.write("Progress: n/a\n");
    process.stdout.write("Technical QA: n/a\n");
    process.stdout.write("Visual QA: n/a\n");
    process.stdout.write("Issues: none recorded\n");
    process.stdout.write("Next action: run prepare to validate inputs and derive the render plan\n");
    return;
  }
  var last = latestAttempt(state);
  var open = (state.issues || []).filter(function (i) { return i && i.status === "OPEN"; });
  var blocking = open.filter(function (i) {
    return i.severity === "BLOCKER" || i.blocking === true;
  });
  process.stdout.write("Project: " + state.projectId + "\n");
  process.stdout.write("State: " + state.status + (state.currentStage ? " (stage: " + state.currentStage + ")" : "") + "\n");
  if (last) {
    process.stdout.write("Attempt: " + last.attemptId + " " + last.status +
      " (attempt " + last.number + " of " + state.attempts.length + ")\n");
    var p = last.progress || {};
    process.stdout.write("Progress: " + fmtPct(p.fraction) +
      (p.renderedFrames !== undefined ? " renderedFrames=" + p.renderedFrames : "") +
      (p.frameCount !== undefined ? " frameCount=" + p.frameCount : "") +
      (last.outputPath ? " output=" + last.outputPath : "") + "\n");
    if (last.error && last.error.errorClass) {
      process.stdout.write("Last error: [" + last.error.errorClass + "] " +
        String(last.error.detail || "").slice(0, 200) + "\n");
    }
    process.stdout.write("Technical QA: " + ((last.technicalQa && last.technicalQa.status) || "none") + "\n");
    var v = last.visualQa;
    process.stdout.write("Visual QA: " + (v ? (v.decision || v.status || JSON.stringify(v)).toString().slice(0, 120) : "none") + "\n");
  } else {
    process.stdout.write("Attempt: none\n");
    process.stdout.write("Progress: n/a\n");
    process.stdout.write("Technical QA: n/a\n");
    process.stdout.write("Visual QA: n/a\n");
  }
  process.stdout.write("Issues: " + open.length + " open (" + blocking.length + " blocking), " +
    (state.blockers || []).length + " blocker(s)\n");
  open.slice(0, 8).forEach(function (i) {
    var label = i.issueId || i.code || "?";
    var sev = i.severity ? "[" + i.severity + "]" : "";
    var note = String(i.note || i.message || "").slice(0, 160);
    process.stdout.write("  - " + label + " " + sev + " " + note + "\n");
  });
  (state.blockers || []).slice(0, 8).forEach(function (b) {
    process.stdout.write("  ! [BLOCKER " + (b.code || "?") + "] " + String(b.detail || "").slice(0, 160) + "\n");
  });
  process.stdout.write("Next action: " + nextAction(state) + "\n");
}

function exitFor(result) {
  if (!result) return 1;
  if (result.ok === true) return 0;
  var terminal = ["BLOCKED", "FAILED", "CANCELLED", "MAX_ATTEMPTS", "STALE_INPUT",
    "BLOCKED_REVIEW_REQUIRED", "VISUAL_REVIEW_REQUIRED", "NOT_ACCEPTED"];
  if (terminal.indexOf(result.status) !== -1 || terminal.indexOf(result.reason) !== -1 ||
      terminal.indexOf(result.decision) !== -1) return 2;
  if (result.reason === "LOCKED") return 1;
  return 1;
}

var VISUAL_REVIEW_SCHEMA = (function () {
  // Single source of truth: canonical schema file (inline copy removed — it drifted).
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "visual-review.schema.json"), "utf8"));
  } catch (e) {
    return {
      type: "object",
      additionalProperties: false,
      required: ["attemptId", "decision", "reviewer"],
      properties: {
        attemptId: { type: "string", minLength: 1 },
        decision: { type: "string" },
        reviewer: { type: "string", minLength: 1 }
      }
    };
  }
})();

function doSubmitVisualReview(projectId, fileRel) {
  var abs = path.resolve(ROOT, fileRel);
  var doc;
  try {
    doc = JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    console.error("IO error reading review file: " + e.message);
    return 1;
  }
  var ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  var validate = ajv.compile(VISUAL_REVIEW_SCHEMA);
  if (!validate(doc)) {
    console.error("BLOCKED: visual review schema invalid: " +
      (validate.errors || []).map(function (e) { return (e.instancePath || "/") + " " + e.message; }).join("; "));
    return 2;
  }
  var SS = loadStateStore();
  var stateAbs = path.join(ROOT, "projects", projectId, "render", "pipeline-state.json");
  var state;
  var useModule = !!(SS && typeof SS.loadState === "function" && typeof SS.saveState === "function");
  try {
    state = useModule ? SS.loadState(ROOT, projectId)
      : JSON.parse(fs.readFileSync(stateAbs, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    console.error("IO error reading pipeline state: " + e.message);
    return 1;
  }
  if (!state || (state.status === "NEW" && !(state.attempts || []).length)) {
    console.error("BLOCKED: no pipeline state for " + projectId + "; run prepare first");
    return 2;
  }
  var attempt = null;
  (state.attempts || []).forEach(function (a) {
    if (a && (a.attemptId === doc.attemptId || String(a.number) === String(doc.attemptId))) attempt = a;
  });
  if (!attempt) {
    console.error("BLOCKED: review attemptId does not match any attempt: " + doc.attemptId);
    return 2;
  }
  var visualQa = {
    decision: doc.decision,
    reviewer: doc.reviewer,
    reviewState: doc.reviewState || (String(doc.reviewer).toLowerCase() === "agent" ? "AGENT_REVIEWED" : "HUMAN_REVIEWED"),
    notes: doc.notes || null,
    at: doc.at || doc.reviewedAt || new Date().toISOString()
  };
  attempt.visualQa = Object.assign({}, attempt.visualQa || {}, visualQa);
  var qaDir = path.join(ROOT, "projects", projectId, "render", "attempts", attempt.attemptId, "qa");
  try {
    fs.mkdirSync(qaDir, { recursive: true });
    fs.writeFileSync(path.join(qaDir, "visual-review.json"), JSON.stringify(doc, null, 2), "utf8");
    (attempt.artifacts = attempt.artifacts || []).push(
      ["attempts", attempt.attemptId, "qa", "visual-review.json"].join("/"));
  } catch (e) {
    console.error("IO error storing visual review: " + e.message);
    return 1;
  }
  state.updatedAt = new Date().toISOString();
  var histEntry = { event: "visual-review-submitted",
    attemptId: attempt.attemptId, decision: doc.decision, reviewer: doc.reviewer };
  try {
    if (useModule) {
      if (typeof SS.setQa === "function") {
        try {
          SS.setQa(state, "visual", visualQa);
        } catch (e) {}
      }
      if (typeof SS.appendHistory === "function") {
        SS.appendHistory(state, histEntry.event, { attemptId: attempt.attemptId,
          decision: doc.decision, reviewer: doc.reviewer });
      } else {
        (state.history = state.history || []).push(Object.assign({ t: state.updatedAt }, histEntry));
      }
      SS.saveState(ROOT, projectId, state);
    } else {
      (state.history = state.history || []).push(Object.assign({ t: state.updatedAt }, histEntry));
      fs.writeFileSync(stateAbs, JSON.stringify(state, null, 2), "utf8");
    }
  } catch (e) {
    console.error("IO error writing pipeline state: " + e.message);
    return 1;
  }
  process.stdout.write("visual review recorded for " + attempt.attemptId + ": " + doc.decision + "\n");
  return 0;
}

async function main() {
  var args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(usage());
    console.error("error: " + args.error);
    process.exitCode = 1;
    return;
  }
  var projectId = args.project;
  var opts = { projectRoot: ROOT, projectId: projectId };

  try {
    if (args.cmd === "status") {
      var state = readState(projectId);
      if (args.json) {
        process.stdout.write(JSON.stringify(state || { projectId: projectId, status: "NEW" }, null, 2) + "\n");
      } else {
        printStatus(projectId, state);
      }
      process.exitCode = 0;
      return;
    }
    if (args.cmd === "attempts") {
      var res = await Orchestrator.orchestrate({ projectRoot: ROOT, projectId: projectId,
        op: "attempts", opts: opts });
      if (args.json) {
        process.stdout.write(JSON.stringify(res, null, 2) + "\n");
      } else {
        (res.attempts || []).forEach(function (a) {
          process.stdout.write(a.attemptId + " #" + a.number + " " + a.status +
            (a.errorClass ? " [" + a.errorClass + "]" : "") +
            (a.outputPath ? " " + a.outputPath : "") + "\n");
        });
        if (!(res.attempts || []).length) process.stdout.write("no attempts for " + projectId + "\n");
      }
      process.exitCode = 0;
      return;
    }
    if (args.cmd === "submit-visual-review") {
      process.exitCode = doSubmitVisualReview(projectId, args.file);
      return;
    }
    if (args.cmd === "prepare") {
      var prep = await Orchestrator.orchestrate({ projectRoot: ROOT, projectId: projectId,
        op: "prepare", opts: opts });
      process.stdout.write(JSON.stringify(prep, null, 2) + "\n");
      process.exitCode = prep.ok ? 0 : (prep.status === "BLOCKED" ? 2 : 1);
      return;
    }
    if (args.cmd === "render") {
      var ropts = Object.assign({}, opts);
      if (args.concurrency !== null) ropts.concurrency = args.concurrency;
      if (args.timeoutMs !== null) ropts.timeoutMs = args.timeoutMs;
      if (args.maxAttempts !== null) ropts.maxTotalAttempts = args.maxAttempts;
      if (args.allowMachineOnly) ropts.allowMachineOnly = true;
      var rend = await Orchestrator.orchestrate({ projectRoot: ROOT, projectId: projectId,
        op: "render", opts: ropts });
      process.stdout.write(JSON.stringify(rend, null, 2) + "\n");
      process.exitCode = exitFor(rend);
      return;
    }
    if (args.cmd === "resume") {
      var resume = await Orchestrator.orchestrate({ projectRoot: ROOT, projectId: projectId,
        op: "resume", opts: opts });
      if (args.json || true) {
        process.stdout.write(JSON.stringify(resume, null, 2) + "\n");
      }
      process.exitCode = resume.decision === "BLOCKED_REVIEW_REQUIRED" ? 2 : 0;
      return;
    }
    if (args.cmd === "cancel") {
      var copts = Object.assign({}, opts);
      if (args.reason) copts.reason = args.reason;
      var canc = await Orchestrator.orchestrate({ projectRoot: ROOT, projectId: projectId,
        op: "cancel", opts: copts });
      process.stdout.write(JSON.stringify(canc, null, 2) + "\n");
      process.exitCode = canc.ok ? 0 : 1;
      return;
    }
    if (args.cmd === "qa") {
      var qopts = Object.assign({}, opts);
      if (args.attempt !== null) qopts.attempt = args.attempt;
      var qa = await Orchestrator.orchestrate({ projectRoot: ROOT, projectId: projectId,
        op: "qa", opts: qopts });
      process.stdout.write(JSON.stringify(qa, null, 2) + "\n");
      process.exitCode = exitFor(qa);
      return;
    }
    console.error(usage());
    process.exitCode = 1;
  } catch (e) {
    if (e && (e.code === "RENDER_INPUT_BLOCKED" || e.code === "ASSET_STAGE_FAILED")) {
      console.error("BLOCKED: " + (e.message || String(e)));
      process.exitCode = 2;
      return;
    }
    console.error("IO error: " + ((e && e.message) || String(e)));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(function (e) {
    console.error("IO error: " + ((e && e.message) || String(e)));
    process.exitCode = 1;
  });
}

module.exports = {};
