"use strict";
// pipeline/remotion-render-runner.js — STEP-13 Branch B (orchestration side).
// Thin wrapper around @remotion/bundler bundle() + @remotion/renderer
// selectComposition()/renderMedia()/makeCancelSignal(). Lazy-requires the
// Remotion packages via createRequire from remotion/package.json (same trick
// as Step 12 scripts/cli/remotion-render-cli.js). No provider calls, no network beyond
// what Remotion itself needs locally.
//
// runRender(opts) returns { cancelSignal, promise }:
//   promise resolves { outputPath, frameCount } or rejects a classified error.

var fs = require("fs");
var path = require("path");

var Classifier = require("./render-error-classifier");

var COMPOSITION_ID = "UNFOLDIQVideo";
var PROGRESS_THROTTLE_MS = 1000;
var PROGRESS_FRACTION_JUMP = 0.05;

function remotionDir(projectRoot) {
  return path.join(projectRoot, "remotion");
}

function loadRemotion(projectRoot) {
  var createRequire = require("module").createRequire;
  var remRequire = createRequire(path.join(remotionDir(projectRoot), "package.json"));
  return {
    bundler: remRequire("@remotion/bundler"),
    renderer: remRequire("@remotion/renderer")
  };
}

function makeSignal(projectRoot) {
  var libs = loadRemotion(projectRoot);
  return libs.renderer.makeCancelSignal();
}

// Remotion 4 makeCancelSignal() returns a wrapper
// { cancelSignal: <subscribe-fn>, cancel: <fn> }; renderMedia expects the
// inner subscribe function. Unwrap wrapper-shaped signals for renderMedia
// while callers keep using the wrapper's .cancel().
function toMediaSignal(sig) {
  if (sig && typeof sig.cancelSignal === "function" && typeof sig.cancel === "function") {
    return sig.cancelSignal;
  }
  return sig;
}

function ensureDir(abs) {
  fs.mkdirSync(abs, { recursive: true });
}

function appendJsonLine(abs, obj) {
  var line;
  try {
    line = JSON.stringify(obj);
  } catch (e) {
    line = JSON.stringify({ t: new Date().toISOString(), event: "unserializable-log" });
  }
  fs.appendFileSync(abs, line + "\n", "utf8");
}

function safeCallback(fn, arg) {
  if (typeof fn !== "function") return;
  try {
    fn(arg);
  } catch (e) {
    // Caller progress/log callbacks must never break the render.
  }
}

function runRender(opts) {
  opts = opts || {};
  var projectRoot = opts.projectRoot;
  var projectId = opts.projectId;
  var attemptDir = opts.attemptDir;
  var inputProps = opts.inputProps;
  var compositionId = opts.compositionId || COMPOSITION_ID;
  var renderConfig = opts.renderConfig || {};
  var onProgress = opts.onProgress;
  var onStart = opts.onStart;
  var onLog = opts.onLog;

  if (!projectRoot || typeof projectRoot !== "string") {
    throw new Error("runRender: projectRoot required");
  }
  if (!projectId || typeof projectId !== "string") {
    throw new Error("runRender: projectId required");
  }
  if (!attemptDir || typeof attemptDir !== "string") {
    throw new Error("runRender: attemptDir required");
  }
  if (!inputProps || typeof inputProps !== "object") {
    throw new Error("runRender: inputProps required");
  }
  ensureDir(attemptDir);

  var renderLog = path.join(attemptDir, "render.log");
  var browserLog = path.join(attemptDir, "browser.log");
  var progressFile = path.join(attemptDir, "progress.jsonl");

  function logLifecycle(event, data) {
    var entry = { t: new Date().toISOString(), event: event };
    if (data && typeof data === "object") {
      Object.keys(data).forEach(function (k) { entry[k] = data[k]; });
    }
    try {
      appendJsonLine(renderLog, entry);
    } catch (e) {}
    safeCallback(onLog, entry);
  }

  var cancelSignal = opts.cancelSignal || null;
  var ownsSignal = false;
  if (!cancelSignal) {
    cancelSignal = makeSignal(projectRoot);
    ownsSignal = true;
  }

  // Windows-compatible best-effort SIGINT/SIGTERM wiring (guarded).
  var wiredHandlers = [];
  if (opts.signalHandlers === true) {
    ["SIGINT", "SIGTERM"].forEach(function (sig) {
      try {
        var handler = function () {
          logLifecycle("signal-received", { signal: sig });
          try {
            cancelSignal.cancel();
          } catch (e) {}
        };
        process.on(sig, handler);
        wiredHandlers.push({ signal: sig, handler: handler });
      } catch (e) {}
    });
  }

  function unwireHandlers() {
    wiredHandlers.forEach(function (h) {
      try {
        process.removeListener(h.signal, h.handler);
      } catch (e) {}
    });
    wiredHandlers = [];
  }

  var outputLocation = path.join(attemptDir, "output.mp4");
  var lastProgressWrite = 0;
  var lastFraction = -1;
  var startInfo = null;

  var promise = (async function () {
    var libs = loadRemotion(projectRoot);
    var bundler = libs.bundler;
    var renderer = libs.renderer;

    logLifecycle("bundle-start", { projectId: projectId });

    var serveUrl;
    try {
      serveUrl = await bundler.bundle({
        entryPoint: path.join(remotionDir(projectRoot), "src", "index.ts"),
        onProgress: function () {}
      });
    } catch (e) {
      var bc = Classifier.classify(e);
      logLifecycle("bundle-failed", { errorClass: bc.class, detail: bc.detail });
      unwireHandlers();
      var berr = new Error("bundle failed [" + bc.class + "]: " + (e && e.message));
      berr.renderErrorClass = bc.class;
      berr.retryable = bc.retryable;
      berr.cause = e;
      throw berr;
    }
    logLifecycle("bundle-done", {});

    logLifecycle("select-start", { compositionId: compositionId });
    var composition;
    try {
      composition = await renderer.selectComposition({
        serveUrl: serveUrl,
        id: compositionId,
        inputProps: inputProps
      });
    } catch (e) {
      var sc = Classifier.classify(e);
      logLifecycle("select-failed", { errorClass: sc.class, detail: sc.detail });
      unwireHandlers();
      var serr = new Error("selectComposition failed [" + sc.class + "]: " + (e && e.message));
      serr.renderErrorClass = sc.class;
      serr.retryable = sc.retryable;
      serr.cause = e;
      throw serr;
    }
    logLifecycle("select-done", { durationInFrames: composition.durationInFrames });

    var renderMediaOpts = {
      codec: renderConfig.codec || "h264",
      composition: composition,
      serveUrl: serveUrl,
      inputProps: inputProps,
      outputLocation: outputLocation,
      concurrency: renderConfig.concurrency,
      // Branch A render-config.js uses timeoutMs; older callers may pass
      // timeoutInMilliseconds. Accept both.
      timeoutInMilliseconds: (typeof renderConfig.timeoutInMilliseconds === "number"
        ? renderConfig.timeoutInMilliseconds
        : renderConfig.timeoutMs),
      cancelSignal: toMediaSignal(cancelSignal),
      overwrite: false,
      onProgress: function (p) {
        p = p || {};
        var fraction = typeof p.progress === "number" ? p.progress : 0;
        var info = {
          fraction: fraction,
          renderedFrames: p.renderedFrames,
          encodedFrames: p.encodedFrames,
          stitchStage: p.stitchStage
        };
        var now = Date.now();
        var jump = lastFraction < 0 ? 1 : Math.abs(fraction - lastFraction);
        var final = fraction >= 1;
        if (final || (now - lastProgressWrite) >= PROGRESS_THROTTLE_MS || jump >= PROGRESS_FRACTION_JUMP) {
          lastProgressWrite = now;
          lastFraction = fraction;
          info.t = new Date().toISOString();
          try {
            appendJsonLine(progressFile, info);
          } catch (e) {}
        }
        safeCallback(onProgress, info);
      },
      onStart: function (d) {
        d = d || {};
        startInfo = {
          frameCount: (typeof d.frameCount === "number" ? d.frameCount : composition.durationInFrames),
          parallelEncoding: d.parallelEncoding,
          resolvedConcurrency: (d.concurrency !== undefined ? d.concurrency : renderConfig.concurrency)
        };
        logLifecycle("render-start", startInfo);
        safeCallback(onStart, startInfo);
      }
    };
    if (renderConfig.logLevel) renderMediaOpts.logLevel = renderConfig.logLevel;
    // onBrowserLog is supported by renderMedia in Remotion 4; guarded so an
    // unexpected signature never breaks the render.
    try {
      renderMediaOpts.onBrowserLog = function (log) {
        try {
          appendJsonLine(browserLog, {
            t: new Date().toISOString(),
            type: log && log.type,
            text: String((log && (log.text || log.message)) || "").slice(0, 2000)
          });
        } catch (e) {}
      };
    } catch (e) {}

    // Remove the hook if the installed renderer does not accept it: probe by
    // rendering is impossible here, so keep it and strip on RENDER_PROP_ERROR
    // mentioning onBrowserLog via a single retry without the hook.
    logLifecycle("render-start-attempt", { concurrency: renderConfig.concurrency });
    try {
      await renderer.renderMedia(renderMediaOpts);
    } catch (e) {
      var msg = String((e && e.message) || "");
      if (/onBrowserLog/i.test(msg)) {
        delete renderMediaOpts.onBrowserLog;
        logLifecycle("render-retry-without-browser-log", {});
        await renderer.renderMedia(renderMediaOpts);
      } else {
        throw e;
      }
    }

    var frameCount = composition.durationInFrames;
    logLifecycle("render-done", { outputPath: outputLocation, frameCount: frameCount });
    try {
      appendJsonLine(progressFile, { t: new Date().toISOString(), fraction: 1, done: true });
    } catch (e) {}
    unwireHandlers();
    return { outputPath: outputLocation, frameCount: frameCount };
  })().catch(function (e) {
    unwireHandlers();
    var c = Classifier.classify(e);
    logLifecycle("render-failed", { errorClass: c.class, detail: c.detail });
    if (e && e.renderErrorClass) throw e;
    var err = new Error("render failed [" + c.class + "]: " + (e && e.message));
    err.renderErrorClass = c.class;
    err.retryable = c.retryable;
    err.cause = e;
    throw err;
  });

  void ownsSignal;
  return { cancelSignal: cancelSignal, promise: promise };
}

module.exports = {
  runRender: runRender,
  makeSignal: makeSignal,
  PROGRESS_THROTTLE_MS: PROGRESS_THROTTLE_MS,
  COMPOSITION_ID: COMPOSITION_ID
};
