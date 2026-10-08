"use strict";
// pipeline/incremental-render.js — Phase 5B (5.1): Remotion frame-range
// adapter + chunk/reuse assembly + FinalAudio-once mux + full-render
// fallback + decoded-frame equivalence oracle.
//
// Strategy (§14/§15): dirty visual ranges render as video-only/muted chunks;
// unchanged chunks are reused by content hash; final assembly concatenates
// (stream copy, no re-encode) and muxes the canonical FinalAudioArtifact
// exactly once. Uncertain correctness -> full render (RULE 20).

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");

var incremental = require("../lib/incremental/index.js");
var renderCache = require("../lib/render-cache/index.js");
var probe = require("../lib/render/probe.js");
var renderRunner = require("./remotion-render-runner.js");
var browserPool = require("../lib/browser-pool/index.js");

function loadRenderer(projectRoot) {
  var createRequire = require("module").createRequire;
  var remRequire = createRequire(path.join(projectRoot, "remotion", "package.json"));
  return {
    bundler: remRequire("@remotion/bundler"),
    renderer: remRequire("@remotion/renderer"),
  };
}

function binariesDir() {
  return process.env.UNFOLDIQ_REMOTION_BINARIES_DIR || undefined;
}

// Phase 5C (5.4): browser reuse across range renders. Opt-in via
// UNFOLDIQ_BROWSER_REUSE=1; off keeps the per-call openBrowser behavior.
// renderFrames only closes its pages when given a browserInstance, so a
// leased browser survives the call and is returned to the pool.
function browserReuseEnabled() {
  return process.env.UNFOLDIQ_BROWSER_REUSE === "1";
}

var _pools = new Map(); // projectRoot -> pool (openBrowser bound to its libs)

function compatSpec(projectRoot) {
  var remotionVersion = "unknown";
  try {
    remotionVersion = require(path.join(projectRoot, "remotion", "node_modules", "@remotion", "renderer", "package.json")).version;
  } catch (e) {}
  return {
    remotionVersion: remotionVersion,
    chromeMode: process.env.UNFOLDIQ_REMOTION_CHROME_MODE || null,
    executablePath: process.env.UNFOLDIQ_REMOTION_CHROME_EXECUTABLE || null,
    envHash: crypto.createHash("sha256").update(String(binariesDir() || "default-binaries")).digest("hex").slice(0, 12),
  };
}

function browserPoolFor(libs, projectRoot) {
  var pool = _pools.get(projectRoot);
  if (!pool) {
    pool = browserPool.createPool({
      openBrowser: function (openOpts) {
        var spec = openOpts.compatSpec || {};
        var opts = {};
        if (spec.chromeMode) opts.chromeMode = spec.chromeMode;
        if (spec.executablePath) opts.browserExecutable = spec.executablePath;
        return libs.renderer.openBrowser(opts);
      },
      // Remotion's HeadlessBrowser hides its child pid; liveness = CDP ping.
      isAlive: function (rec) {
        return Promise.race([
          rec.browser.runner.connection.send("Browser.getVersion").then(function () { return true; }, function () { return false; }),
          new Promise(function (resolve) { setTimeout(function () { resolve(false); }, 3000); }),
        ]);
      },
    });
    _pools.set(projectRoot, pool);
  }
  return pool;
}

async function acquireBrowserLease(libs, projectRoot) {
  if (!browserReuseEnabled()) return null;
  var pool = browserPoolFor(libs, projectRoot);
  var spec = compatSpec(projectRoot);
  return pool.acquire(browserPool.compatKey(spec), { compatSpec: spec });
}

function poolSnapshot(projectRoot) {
  var pool = _pools.get(projectRoot);
  return pool ? pool.snapshot() : null;
}

async function shutdownBrowserPool() {
  for (var pool of _pools.values()) await pool.shutdown();
}

function shFfmpeg(args, timeoutMs) {
  return childProcess.spawnSync("ffmpeg", args, { encoding: "utf8", timeout: timeoutMs || 300000, maxBuffer: 64 * 1024 * 1024 });
}

function shFfprobe(args, timeoutMs) {
  return childProcess.spawnSync("ffprobe", args, { encoding: "utf8", timeout: timeoutMs || 120000, maxBuffer: 64 * 1024 * 1024 });
}

// Canonical [start, endExclusive) -> Remotion inclusive tuple.
function toRemotionRange(range) {
  if (!incremental.isRange(range)) throw new Error("renderRange: invalid frame range");
  return [range.startFrame, range.endFrameExclusive - 1];
}

async function bundleOnce(projectRoot, onProgress) {
  var libs = loadRenderer(projectRoot);
  var serveUrl = await libs.bundler.bundle({
    entryPoint: path.join(projectRoot, "remotion", "src", "index.ts"),
    onProgress: onProgress || function () {},
  });
  return { libs: libs, serveUrl: serveUrl };
}

async function selectComposition(libs, serveUrl, compositionId, inputProps) {
  return libs.renderer.selectComposition({ serveUrl: serveUrl, id: compositionId, inputProps: inputProps });
}

// Render one canonical range straight to a muted mp4 chunk via renderMedia.
// Browser source (first available): args.browserInstance (caller-held lease)
// > pooled lease (UNFOLDIQ_BROWSER_REUSE=1) > per-call openBrowser.
// renderMedia (not manual renderFrames->stitchFramesToVideo) is required for
// browser reuse: renderFrames' cleanup deletes the downloadMap before a
// manual stitch can run (ffmpeg ENOENT on the faststart intermediate);
// renderMedia stitches before its own cleanup.
async function renderRange(args) {
  args = args || {};
  var range = args.range;
  if (!incremental.isRange(range)) throw new Error("renderRange: invalid range");
  var t0 = Date.now();
  var lease = null;
  if (args.browserInstance) {
    lease = { browser: args.browserInstance, owned: false };
  } else if (args.libs) {
    lease = await acquireBrowserLease(args.libs, args.projectRoot || path.join(__dirname, ".."));
    if (lease) lease.owned = true;
  }
  var outFile = args.outFile;
  try {
    await args.libs.renderer.renderMedia({
      serveUrl: args.serveUrl,
      composition: args.composition,
      inputProps: args.inputProps,
      outputLocation: outFile,
      codec: "h264",
      pixelFormat: "yuv420p",
      muted: true,
      overwrite: true,
      imageFormat: "png",
      frameRange: toRemotionRange(range),
      concurrency: args.concurrency === undefined ? 1 : args.concurrency,
      puppeteerInstance: lease ? lease.browser : undefined,
      binariesDirectory: binariesDir(),
    });
  } catch (e) {
    if (lease && lease.owned) await lease.release(false);
    throw e;
  }
  if (lease && lease.owned) await lease.release(true);
  var pr = probe.probeFile(outFile);
  if (!pr.ok || !pr.evidence || !pr.evidence.format) throw new Error("renderRange: probe failed: " + outFile);
  var frameCount = Math.round(Number(pr.evidence.format.duration) * args.fps);
  var want = range.endFrameExclusive - range.startFrame;
  if (frameCount !== want) {
    throw new Error("renderRange: frame count mismatch (got " + frameCount + ", want " + want + ")");
  }
  return {
    range: range, framesDir: args.framesDir, chunkFile: outFile,
    frameCount: frameCount, renderMs: Date.now() - t0,
  };
}

// ffprobe rational fps ("30/1", "30000/1001") or plain number -> float.
// Never compare raw strings with numbers (NaN poisons every tolerance).
function parseFps(v) {
  if (typeof v === "number") return v;
  var m = String(v || "").match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!m) return NaN;
  var num = Number(m[1]);
  var den = m[2] === undefined ? 1 : Number(m[2]);
  if (!den) return NaN;
  return num / den;
}

function probeChunk(abs) {
  var p = probe.probeFile(abs);
  if (!p.ok) throw new Error("probeChunk failed: " + abs);
  return p.evidence;
}

// Assembly validation (§16): exact-once coverage + homogeneous profiles.
function validateAssembly(chunks, expected) {
  expected = expected || {};
  var cov = incremental.validateCoverage(chunks.map(function (c) { return { range: c.range }; }), expected.totalFrames);
  if (!cov.ok) return { ok: false, reason: cov.reason, gaps: cov.gaps, overlaps: cov.overlaps };
  var fpsList = [];
  for (var c of chunks) {
    var pr = c.probe || probeChunk(c.chunkFile);
    c.probe = pr;
    if (expected.width && pr.video.width !== expected.width) {
      return { ok: false, reason: "CHUNK_INCOMPATIBLE", detail: "width " + pr.video.width };
    }
    if (expected.height && pr.video.height !== expected.height) {
      return { ok: false, reason: "CHUNK_INCOMPATIBLE", detail: "height " + pr.video.height };
    }
    if (expected.pixelFormat && pr.video.pixFmt !== expected.pixelFormat) {
      return { ok: false, reason: "CHUNK_INCOMPATIBLE", detail: "pixfmt " + pr.video.pixFmt };
    }
    if (expected.fps && Math.abs(parseFps(pr.video.fps) - expected.fps) > 0.01) {
      return { ok: false, reason: "CHUNK_INCOMPATIBLE", detail: "fps " + pr.video.fps };
    }
    if (!pr.video.codec || !/h264/i.test(pr.video.codec)) {
      return { ok: false, reason: "CHUNK_INCOMPATIBLE", detail: "codec " + pr.video.codec };
    }
    fpsList.push(pr.video.fps);
  }
  return { ok: true, reason: null, chunkFps: fpsList };
}

// Assemble: stream-copy concat (no re-encode) + FinalAudio muxed exactly once.
function assemble(args) {
  args = args || {};
  var check = validateAssembly(args.chunks, args.expected);
  if (!check.ok) {
    var err = new Error("assembly blocked: " + check.reason);
    err.assemblyReason = check.reason;
    err.gaps = check.gaps;
    err.overlaps = check.overlaps;
    throw err;
  }
  var ordered = args.chunks.slice().sort(function (a, b) { return a.range.startFrame - b.range.startFrame; });
  var listFile = path.join(path.dirname(args.outFile), "concat-" + process.pid + ".txt");
  fs.writeFileSync(listFile, ordered.map(function (c) {
    return "file '" + c.chunkFile.split("'").join("'\\''") + "'";
  }).join("\n"));
  var videoOnly = args.outFile + ".video-only.mp4";
  var r = shFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", videoOnly]);
  try { fs.rmSync(listFile, { force: true }); } catch (e) {}
  if (r.status !== 0 || !fs.existsSync(videoOnly)) {
    throw new Error("concat failed: " + (r.stderr || "").slice(-500));
  }
  var finalOut = args.outFile;
  if (args.finalAudioAbs) {
    // §15: mux canonical FinalAudio exactly once; durations must agree.
    var vDur = Number(shFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoOnly]).stdout.trim());
    var aDur = Number(shFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args.finalAudioAbs]).stdout.trim());
    var expectedDur = args.expected.totalFrames / args.expected.fps;
    if (Math.abs(vDur - expectedDur) > 0.6) throw new Error("assembly: video duration drift " + vDur + " vs " + expectedDur);
    if (Math.abs(aDur - expectedDur) > 0.6) throw new Error("assembly: FinalAudio duration drift " + aDur + " vs " + expectedDur);
    var m = shFfmpeg(["-y", "-i", videoOnly, "-i", args.finalAudioAbs, "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-map", "0:v:0", "-map", "1:a:0", finalOut]);
    try { fs.rmSync(videoOnly, { force: true }); } catch (e) {}
    if (m.status !== 0 || !fs.existsSync(finalOut)) {
      throw new Error("audio mux failed: " + (m.stderr || "").slice(-500));
    }
  } else {
    fs.renameSync(videoOnly, finalOut);
  }
  return { outFile: finalOut, bytes: fs.statSync(finalOut).size };
}

// Equivalence oracle (§42): exact decoded-frame identity (framemd5) +
// audio-stream identity + container/duration/profile equality.
function framemd5(abs) {
  var r = shFfmpeg(["-i", abs, "-map", "0:v:0", "-f", "framemd5", "-"], 300000);
  if (r.status !== 0) throw new Error("framemd5 failed");
  return r.stdout;
}

function audiomd5(abs) {
  var r = shFfmpeg(["-i", abs, "-map", "0:a:0", "-f", "md5", "-"], 120000);
  if (r.status !== 0) return null; // no audio stream
  return (r.stdout || "").trim();
}

// Range-aware delivery conform (§16 + 5B lesson): the 4B conform stage
// assumes full-range renderMedia output. Incremental chunks already carry
// tv-range yuv420p (stitch output) — forcing in_range=full on them corrupts
// levels (measured: mean 16.5 -> 20.6). Probe first, scale only when needed.
function conformAssembly(inputAbs, outAbs, effectiveProfile, timeoutMs) {
  var pr = probeChunk(inputAbs);
  var range = pr.video.colorRange || "unknown";
  var isFull = /pc|full/i.test(range) || pr.video.pixFmt === "yuvj420p" || pr.video.pixFmt === "yuvj422p" || pr.video.pixFmt === "yuvj444p";
  if (isFull) {
    var delivery = require("../lib/render/delivery.js");
    return delivery.conformDelivery(inputAbs, outAbs, effectiveProfile, timeoutMs);
  }
  var inHash = crypto.createHash("sha256").update(fs.readFileSync(inputAbs)).digest("hex");
  var args = [
    "-y", "-v", "error", "-i", inputAbs,
    "-vf", "format=yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-profile:v", "high",
    "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709",
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    outAbs,
  ];
  var r = shFfmpeg(args, timeoutMs || 590000);
  if (r.status !== 0 || !fs.existsSync(outAbs)) {
    return { ok: false, code: "CONFORM_FAILED", message: (r.stderr || "").slice(-300) };
  }
  return {
    ok: true,
    record: {
      conformVersion: "5b-range-aware-tv",
      inputRange: range, inputHash: inHash,
      outputHash: crypto.createHash("sha256").update(fs.readFileSync(outAbs)).digest("hex"),
      ffmpegArgs: args,
    },
  };
}

// Decoded-frame comparison: framemd5 diff list + max-abs-diff sampling on
// differing frames. GOP segmentation makes segmented-vs-monolithic encodes
// differ on ~1% of pixels (measured); this localizes and quantifies it
// instead of hiding behind a threshold.
function framemd5List(abs) {
  var r = shFfmpeg(["-i", abs, "-map", "0:v:0", "-f", "framemd5", "-"], 300000);
  if (r.status !== 0) throw new Error("framemd5 failed: " + abs);
  return r.stdout.split("\n").filter(function (l) { return l.indexOf("0,") === 0; }).map(function (l) { return l.split(",")[5]; });
}

function frameMaxDiff(fileA, fileB, frameIndex, scratchDir) {
  var a = path.join(scratchDir, "cmp-a.png");
  var b = path.join(scratchDir, "cmp-b.png");
  shFfmpeg(["-y", "-v", "error", "-i", fileA, "-vf", "select=eq(n\\," + frameIndex + ")", "-frames:v", "1", a], 120000);
  shFfmpeg(["-y", "-v", "error", "-i", fileB, "-vf", "select=eq(n\\," + frameIndex + ")", "-frames:v", "1", b], 120000);
  var r = childProcess.spawnSync("ffmpeg", ["-i", a, "-i", b, "-lavfi", "[0:v][1:v]blend=all_mode=difference,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { encoding: "binary", timeout: 120000, maxBuffer: 512 * 1024 * 1024 });
  var buf = Buffer.from(r.stdout, "binary");
  var mx = 0, n = 0;
  for (var i = 0; i < buf.length; i++) { if (buf[i] > mx) mx = buf[i]; if (buf[i] !== 0) n++; }
  return { max: mx, diffPixels: n, totalPixels: buf.length };
}

function compareFrameStats(refFile, incFile, opts) {
  opts = opts || {};
  var refList = framemd5List(refFile);
  var incList = framemd5List(incFile);
  var differing = [];
  var n = Math.max(refList.length, incList.length);
  for (var i = 0; i < n; i++) if (refList[i] !== incList[i]) differing.push(i);
  var stats = { frameCountRef: refList.length, frameCountInc: incList.length, differingFrames: differing };
  if (differing.length > 0 && opts.scratchDir && opts.sample !== false) {
    var sample = differing.filter(function (_, k) { return k % Math.ceil(differing.length / Math.min(differing.length, opts.maxSamples || 12)) === 0; });
    stats.sampled = sample.map(function (f) {
      var d = frameMaxDiff(refFile, incFile, f, opts.scratchDir);
      return { frame: f, maxDiff: d.max, diffPixels: d.diffPixels, totalPixels: d.totalPixels };
    });
    stats.sampleMaxDiff = Math.max.apply(null, stats.sampled.map(function (s) { return s.maxDiff; }));
  }
  return stats;
}

function compareOutputs(refFile, incFile, opts) {
  opts = opts || {};
  var refProbe = probeChunk(refFile);
  var incProbe = probeChunk(incFile);
  var findings = [];
  var pass = true;
  function check(name, ok, detail) {
    findings.push({ check: name, ok: !!ok, detail: detail || null });
    if (!ok) pass = false;
  }
  check("container", (refProbe.format.formatName || "") === (incProbe.format.formatName || ""), (refProbe.format.formatName || "?") + " vs " + (incProbe.format.formatName || "?"));
  check("resolution", refProbe.video.width === incProbe.video.width && refProbe.video.height === incProbe.video.height,
    JSON.stringify([refProbe.video.width, refProbe.video.height]) + " vs " + JSON.stringify([incProbe.video.width, incProbe.video.height]));
  var refFps = parseFps(refProbe.video.fps);
  var incFps = parseFps(incProbe.video.fps);
  check("fps", Math.abs(refFps - incFps) < 0.01, refProbe.video.fps + " vs " + incProbe.video.fps);
  check("pixfmt", refProbe.video.pixFmt === incProbe.video.pixFmt, refProbe.video.pixFmt + " vs " + incProbe.video.pixFmt);
  check("duration", Math.abs(refProbe.format.duration - incProbe.format.duration) < 1 / refFps + 0.05,
    refProbe.format.duration + " vs " + incProbe.format.duration);
  var refMd5 = framemd5(refFile);
  var incMd5 = framemd5(incFile);
  var exact = refMd5 === incMd5;
  check("decodedFramesExact", exact, exact ? "framemd5 identical" : "framemd5 differs (expected for segmented encodes: GOP boundaries reset prediction; see frameStats)");
  var refA = audiomd5(refFile);
  var incA = audiomd5(incFile);
  check("audioStream", refA === incA, (refA || "none") + " vs " + (incA || "none"));
  var out = { status: pass ? "PASS" : "FAIL", findings: findings };
  // frameStats is evidence, not a gate: with lossy temporal codecs,
  // segmented encodes cannot be pixel-identical to monolithic encodes.
  // Correctness gates are coverage/profile/duration/audio + QC/QA suite.
  if (!exact && opts.frameStats) {
    try { out.frameStats = compareFrameStats(refFile, incFile, opts.frameStats); }
    catch (e) { out.frameStats = { error: String((e && e.message) || e) }; }
  }
  return out;
}

// Full-render fallback (RULE 20): reuse the proven Step-13 runner.
function fullRenderFallback(opts) {
  if (!opts || !opts.projectRoot || !opts.projectId || !opts.attemptDir || !opts.inputProps) {
    throw new Error("fullRenderFallback: projectRoot/projectId/attemptDir/inputProps required");
  }
  return renderRunner.runRender(opts);
}

// Agent-ready facade (§52, render subset).
async function executeIncrementalRender(args) {
  args = args || {};
  if (process.env.UNFOLDIQ_INCREMENTAL_RENDER !== "1") {
    return { fallback: "FULL_RENDER_REQUIRED", fallbackReason: "incrementalRenderEnabled=0 (flag off)" };
  }
  var plan = args.plan;
  if (!plan || plan.fallback === "FULL_RENDER_REQUIRED") {
    return { fallback: "FULL_RENDER_REQUIRED", fallbackReason: (plan && plan.fallbackReason) || "no valid plan" };
  }
  var rendered = [];
  var libs = args.renderArgs && args.renderArgs.libs ? args.renderArgs.libs : loadRenderer(args.projectRoot || path.join(__dirname, ".."));
  var lease = await acquireBrowserLease(libs, args.projectRoot || path.join(__dirname, ".."));
  try {
    for (var region of plan.renderRegions) {
      var out = await renderRange(Object.assign({}, args.renderArgs, {
        range: region.range,
        framesDir: path.join(args.scratchDir, "frames-" + region.range.startFrame + "-" + region.range.endFrameExclusive),
        outFile: path.join(args.scratchDir, "chunk-" + region.range.startFrame + "-" + region.range.endFrameExclusive + ".mp4"),
        browserInstance: lease ? lease.browser : undefined,
      }));
      rendered.push(out);
    }
  } catch (e) {
    if (lease) await lease.release(false);
    throw e;
  }
  if (lease) await lease.release(true);
  var chunks = plan.reusableRegions.map(function (r) {
    return { range: r.range, chunkFile: renderCache.readBlob ? casToFile(args.cacheRoot, r.cachedArtifactRef) : r.cachedArtifactRef };
  }).concat(rendered);
  var asm = assemble({ chunks: chunks, totalFrames: args.totalFrames, expected: args.expected, finalAudioAbs: args.finalAudioAbs, outFile: args.outFile });
  return { fallback: "NONE", rendered: rendered, reused: plan.reusableRegions.length, assembly: asm };
}

function casToFile(cacheRoot, ref) {
  var parts = String(ref).split("/");
  var hash = parts[parts.length - 1];
  var abs = path.join(cacheRoot, "CAS", "sha256", hash);
  if (!fs.existsSync(abs)) throw new Error("CHUNK_MISSING: " + ref);
  return abs;
}

module.exports = {
  parseFps: parseFps,
  toRemotionRange: toRemotionRange,
  bundleOnce: bundleOnce,
  selectComposition: selectComposition,
  renderRange: renderRange,
  probeChunk: probeChunk,
  validateAssembly: validateAssembly,
  assemble: assemble,
  framemd5: framemd5,
  audiomd5: audiomd5,
  compareOutputs: compareOutputs,
  fullRenderFallback: fullRenderFallback,
  executeIncrementalRender: executeIncrementalRender,
  conformAssembly: conformAssembly,
  framemd5List: framemd5List,
  frameMaxDiff: frameMaxDiff,
  compareFrameStats: compareFrameStats,
  browserReuseEnabled: browserReuseEnabled,
  acquireBrowserLease: acquireBrowserLease,
  poolSnapshot: poolSnapshot,
  shutdownBrowserPool: shutdownBrowserPool,
};
