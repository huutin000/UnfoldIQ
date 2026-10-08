"use strict";
// scripts/cli/remotion-render-cli.js — STEP-12 Branch A (Node side).
//   node scripts/cli/remotion-render-cli.js --project <id> --validate
//   node scripts/cli/remotion-render-cli.js --project <id> --render-test --out <mp4>
//   node scripts/cli/remotion-render-cli.js --project <id> --render   (REFUSED: STEP13_REQUIRED)
// Resolves the Remotion project dir <root>/remotion. Makes no provider calls.

var fs = require("fs");
var path = require("path");
var Builder = require("../../lib/render-input-builder.js");
var InputCheck = require("../../lib/render-input-check.js");
var GapCheck = require("../../lib/render-gap-check.js");
var Stager = require("../../lib/asset-stager.js");
var RenderErrors = require("../../lib/render-errors.js");

var ROOT = path.join(__dirname, "..", "..");
var REMOTION_DIR = path.join(ROOT, "remotion");
var COMPOSITION_ID = "UNFOLDIQVideo";

function usage() {
  return "Usage: node scripts/cli/remotion-render-cli.js --project <id> (--validate | --render-test --out <mp4> | --render)";
}

function parseArgs(argv) {
  var o = { project: null, mode: null, out: null };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--project" && i + 1 < argv.length) {
      o.project = argv[i + 1];
      i++;
    } else if (a.indexOf("--project=") === 0) {
      o.project = a.slice("--project=".length);
    } else if (a === "--validate") {
      o.mode = "validate";
    } else if (a === "--render-test") {
      o.mode = "render-test";
    } else if (a === "--render") {
      o.mode = "render";
    } else if (a === "--out" && i + 1 < argv.length) {
      o.out = argv[i + 1];
      i++;
    } else if (a.indexOf("--out=") === 0) {
      o.out = a.slice("--out=".length);
    } else {
      return { error: "unknown argument: " + a };
    }
  }
  if (!o.project) return { error: "missing --project <id>" };
  if (!o.mode) return { error: "missing mode flag (--validate | --render-test | --render)" };
  if (o.mode === "render-test" && !o.out) return { error: "missing --out <mp4> for --render-test" };
  return o;
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
}

function worstStatus(list) {
  if (list.indexOf("BLOCKED") !== -1) return "BLOCKED";
  if (list.indexOf("REVIEW_REQUIRED") !== -1 || list.indexOf("REVIEW") !== -1) return "REVIEW_REQUIRED";
  return "READY";
}

function doValidate(projectId) {
  var projectDir = path.join(ROOT, "projects", projectId);
  var renderDir = path.join(projectDir, "render");
  var input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: projectId });
  var inputCheck = InputCheck.checkRenderInput(input);
  var gapCheck = GapCheck.checkRenderGaps(input);
  var status = worstStatus([input.status, inputCheck.status, gapCheck.status]);
  var manifest = {
    version: "1.0.0",
    mode: "validate",
    projectId: projectId,
    status: status,
    composition: Builder.resolveCompositionMeta(input),
    checks: {
      inputCheck: inputCheck,
      gapCheck: gapCheck
    },
    provenance: input.provenance
  };
  fs.mkdirSync(renderDir, { recursive: true });
  fs.writeFileSync(path.join(renderDir, "render-manifest.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write("validate " + status + " for " + projectId + ": projects/" + projectId + "/render/render-manifest.json\n");
  process.exitCode = status === "BLOCKED" ? 2 : 0;
}

async function doRenderTest(projectId, outRel) {
  var projectDir = path.join(ROOT, "projects", projectId);
  var renderDir = path.join(projectDir, "render");
  var preflight;
  try {
    preflight = readJson(path.join(projectDir, "preflight", "media-preflight.json"));
  } catch (e) {
    console.error("IO error reading preflight: " + e.message);
    process.exitCode = 1;
    return;
  }
  if (!preflight || preflight.status !== "READY") {
    var reason = "preflight not READY (got " + (preflight && preflight.status) + ")";
    console.error("BLOCKED: " + reason);
    process.exitCode = 2;
    return;
  }

  var input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: projectId });
  var inputCheck = InputCheck.checkRenderInput(input);
  var gapCheck = GapCheck.checkRenderGaps(input);
  if (inputCheck.status === "BLOCKED" || gapCheck.status === "BLOCKED") {
    console.error("BLOCKED: render input checks failed");
    process.exitCode = 2;
    return;
  }

  // Stage every READY image/video/audio asset from the asset manifest.
  var assetManifest = readJson(path.join(projectDir, "asset-manifest.json"));
  var stageList = (Array.isArray(assetManifest.assets) ? assetManifest.assets : [])
    .filter(function (a) {
      return a && a.status === "READY" && typeof a.path === "string" &&
        (a.type === "image" || a.type === "video" || a.type === "voice" || a.type === "music" || a.type === "sfx");
    })
    .map(function (a) {
      var t = (a.type === "image" || a.type === "video") ? a.type : "audio";
      return { assetId: a.assetId, sourcePath: a.path, type: t };
    });
  var entries = Stager.stageAssets({ projectRoot: ROOT, projectId: projectId, assets: stageList });
  fs.mkdirSync(renderDir, { recursive: true });
  fs.writeFileSync(path.join(renderDir, "staging-manifest.json"), JSON.stringify({
    version: "1.0.0",
    projectId: projectId,
    generatedAt: new Date().toISOString(),
    root: Stager.STAGING_ROOT,
    entries: entries
  }, null, 2));

  // Rebuild so staged paths (not unstaged fallbacks) feed the renderer.
  input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: projectId });

  var outAbs = path.resolve(ROOT, outRel);
  try {
    var createRequire = require("module").createRequire;
    var remRequire = createRequire(path.join(REMOTION_DIR, "package.json"));
    var bundler = remRequire("@remotion/bundler");
    var renderer = remRequire("@remotion/renderer");
    var serveUrl = await bundler.bundle({
      entryPoint: path.join(REMOTION_DIR, "src", "index.ts"),
      onProgress: function () {}
    });
    var composition = await renderer.selectComposition({
      serveUrl: serveUrl,
      id: COMPOSITION_ID,
      inputProps: input
    });
    await renderer.renderMedia({
      codec: "h264",
      // Phase 4B: explicit SDR broadcast-safe pixel format. Without this,
      // RGB lavfi/image sources can propagate full-range yuvj420p into the
      // H.264 output (caught by encoded-output QC, not assumed from config).
      pixelFormat: "yuv420p",
      composition: composition,
      serveUrl: serveUrl,
      inputProps: input,
      outputLocation: outAbs,
      // See pipeline/remotion-render-runner.js — SAC workaround, inert when unset.
      ...(process.env.UNFOLDIQ_REMOTION_BINARIES_DIR
        ? { binariesDirectory: process.env.UNFOLDIQ_REMOTION_BINARIES_DIR }
        : {})
    });
  } catch (e) {
    var err = RenderErrors.make("RENDER_FAILED", "render-test failed: " + (e && e.message), { projectId: projectId, reason: e && e.message });
    var failManifest = {
      version: "1.0.0",
      mode: "render-test",
      projectId: projectId,
      status: "BLOCKED",
      reason: err.reason,
      composition: Builder.resolveCompositionMeta(input),
      provenance: input.provenance
    };
    try {
      fs.mkdirSync(renderDir, { recursive: true });
      fs.writeFileSync(path.join(renderDir, "render-manifest.json"), JSON.stringify(failManifest, null, 2));
    } catch (w) {}
    console.error("RENDER_FAILED: " + err.reason);
    process.exitCode = 2;
    return;
  }

  var okManifest = {
    version: "1.0.0",
    mode: "render-test",
    projectId: projectId,
    status: "READY",
    out: outRel,
    composition: Builder.resolveCompositionMeta(input),
    remotionVersions: input.provenance.remotionVersions,
    hashes: {
      timelineHash: input.provenance.timelineHash,
      assetManifestHash: input.provenance.assetManifestHash,
      audioMixHash: input.provenance.audioMixHash,
      captionsHash: input.provenance.captionsHash
    },
    provenance: input.provenance
  };
  fs.writeFileSync(path.join(renderDir, "render-manifest.json"), JSON.stringify(okManifest, null, 2));
  process.stdout.write("render-test READY for " + projectId + ": " + outRel + "\n");
  process.exitCode = 0;
}

function main() {
  var args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(usage());
    console.error("error: " + args.error);
    process.exitCode = 1;
    return;
  }
  if (args.mode === "render") {
    // DEPRECATED Step 12 raw path: production render is a Step 13 operation.
    // Per spec §14 (no raw bypass production render), delegate to the Step 13
    // orchestration CLI which owns locking, attempts, QA hooks and finalize.
    var cp = require("child_process");
    var r = cp.spawnSync(process.execPath, [path.join(ROOT, "scripts/cli/pipeline-cli.js"), "render", "--project", args.project], {
      stdio: "inherit"
    });
    if (r.error) {
      console.error("DELEGATION_FAILED: " + r.error.message);
      process.exitCode = 1;
      return;
    }
    process.exitCode = (typeof r.status === "number") ? r.status : 1;
    return;
  }
  if (args.mode === "validate") {
    try {
      doValidate(args.project);
    } catch (e) {
      if (RenderErrors.isRenderError(e) && e.code === "RENDER_INPUT_BLOCKED") {
        console.error("BLOCKED: " + e.message);
        process.exitCode = 2;
        return;
      }
      console.error("IO error: " + (e && e.message));
      process.exitCode = 1;
    }
    return;
  }
  doRenderTest(args.project, args.out).catch(function (e) {
    console.error("RENDER_FAILED: " + (e && e.message));
    process.exitCode = 2;
  });
}

if (require.main === module) {
  main();
}

module.exports = {};
