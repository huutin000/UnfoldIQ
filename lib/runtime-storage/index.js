"use strict";

/**
 * POST-PHASE-2 D1/D3/D4 — Runtime storage lifecycle management
 * (UNFOLDIQ CORE).
 *
 * MEASURE FIRST: every runtime directory under the canonical UNFOLDIQ
 * AppData root gets an explicit lifecycle class (DURABLE / SECURE_DURABLE /
 * RETENTION_MANAGED / CACHE / EPHEMERAL). Cleanup only ever touches CACHE /
 * EPHEMERAL classes, is dry-run capable, idempotent, path-guarded (realpath
 * must stay inside the owned root; symlink/junction escapes rejected) and
 * reports reclaimed bytes. Auth/evidence never outranks cleanup (RULE 9).
 */

const fs = require("fs");
const path = require("path");

const POLICY_VERSION = "1.0.0";

const LIFECYCLE = ["DURABLE", "SECURE_DURABLE", "RETENTION_MANAGED", "CACHE", "EPHEMERAL"];

/**
 * Versioned policy (spec §12). Patterns are relative to the canonical
 * runtime root (%LOCALAPPDATA%\UNFOLDIQ or ~/.unfoldiq/UNFOLDIQ). Values
 * derived from the measured 2026-10-07 baseline (4.45GB profile, 94%
 * Chrome OptGuideOnDeviceModel) — not invented caps.
 */
const RUNTIME_STORAGE_POLICY = {
  version: POLICY_VERSION,
  measuredBaselineDate: "2026-10-07",
  roots: [
    // Chrome on-device AI / model caches — fully reproducible, largest owner.
    { pattern: "pw-flow-profile/OptGuideOnDeviceModel", lifecycle: "CACHE", owner: "chrome-ondevice-model", cleanupEligible: true },
    { pattern: "pw-flow-profile/optimization_guide_model_store", lifecycle: "CACHE", owner: "chrome-optimization-models", cleanupEligible: true },
    { pattern: "pw-flow-profile/component_crx_cache", lifecycle: "CACHE", owner: "chrome-component-cache", cleanupEligible: true },
    { pattern: "pw-flow-profile/WasmTtsEngine", lifecycle: "CACHE", owner: "chrome-wasm-tts", cleanupEligible: true },
    { pattern: "pw-flow-profile/OnDeviceHeadSuggestModel", lifecycle: "CACHE", owner: "chrome-head-suggest", cleanupEligible: true },
    { pattern: "pw-flow-profile/Safe Browsing", lifecycle: "CACHE", owner: "chrome-safebrowsing", cleanupEligible: true },
    { pattern: "pw-flow-profile/GPUCache", lifecycle: "CACHE", owner: "chrome-gpu-cache", cleanupEligible: true },
    { pattern: "pw-flow-profile/GPUPersistentCache", lifecycle: "CACHE", owner: "chrome-gpu-persistent-cache", cleanupEligible: true },
    { pattern: "pw-flow-profile/GraphiteDawnCache", lifecycle: "CACHE", owner: "chrome-graphite-cache", cleanupEligible: true },
    { pattern: "pw-flow-profile/ShaderCache", lifecycle: "CACHE", owner: "chrome-shader-cache", cleanupEligible: true },
    { pattern: "pw-flow-profile/GrShaderCache", lifecycle: "CACHE", owner: "chrome-grshader-cache", cleanupEligible: true },
    { pattern: "pw-flow-profile/Code Cache", lifecycle: "CACHE", owner: "chrome-code-cache", cleanupEligible: true },
    { pattern: "pw-flow-profile/Crashpad", lifecycle: "EPHEMERAL", owner: "chrome-crash-dumps", cleanupEligible: true },
    // The Default profile directory owns cookies/login — NEVER cleaned here.
    { pattern: "pw-flow-profile/Default", lifecycle: "DURABLE", owner: "chrome-profile-auth", sensitivity: "SENSITIVE_AUTH", cleanupEligible: false },
    { pattern: "pw-flow-profile/Local State", lifecycle: "DURABLE", owner: "chrome-profile-meta", sensitivity: "SENSITIVE_AUTH", cleanupEligible: false },
    { pattern: "auth-state", lifecycle: "SECURE_DURABLE", owner: "playwright-auth", sensitivity: "SENSITIVE_AUTH", cleanupEligible: false },
    { pattern: "secrets", lifecycle: "SECURE_DURABLE", owner: "device-pairing-secrets", sensitivity: "SENSITIVE_SECRET", cleanupEligible: false },
    { pattern: "pairing", lifecycle: "DURABLE", owner: "device-pairing-trust", sensitivity: "LOW", cleanupEligible: false },
    { pattern: "flow-bridge-token", lifecycle: "SECURE_DURABLE", owner: "bridge-dev-recovery-token", sensitivity: "SENSITIVE_SECRET", cleanupEligible: false },
    { pattern: "logs", lifecycle: "RETENTION_MANAGED", owner: "diagnostics", maxRetentionDays: 30, cleanupEligible: false },
    { pattern: "tmp", lifecycle: "EPHEMERAL", owner: "temp", cleanupEligible: true },
  ],
  defaultLifecycle: "RETENTION_MANAGED",
};

function defaultRuntimeRoot(env = process.env, homedir = require("os").homedir()) {
  return path.join(env.LOCALAPPDATA || path.join(homedir, ".unfoldiq"), "UNFOLDIQ");
}

function statDeep(dir) {
  let sizeBytes = 0;
  let fileCount = 0;
  let lastModified = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return null; // unreadable (locked/permission) — report honestly
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      let st;
      try {
        st = fs.statSync(full); // stat follows symlinks by design for size truth
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else {
        sizeBytes += st.size;
        fileCount += 1;
        if (st.mtimeMs > lastModified) lastModified = st.mtimeMs;
      }
    }
  }
  return { sizeBytes, fileCount, lastModified };
}

function isInsideRoot(rootReal, candidateReal) {
  const rel = path.relative(rootReal, candidateReal);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function classify(relPath, policy = RUNTIME_STORAGE_POLICY) {
  const norm = relPath.split(path.sep).join("/");
  let best = null;
  for (const root of policy.roots) {
    if (norm === root.pattern || norm.startsWith(root.pattern + "/")) {
      if (!best || root.pattern.length > best.pattern.length) best = root;
    }
  }
  if (best) {
    return { lifecycle: best.lifecycle, owner: best.owner, sensitivity: best.sensitivity || "LOW", cleanupEligible: !!best.cleanupEligible, policyRef: `${best.pattern}` };
  }
  return { lifecycle: policy.defaultLifecycle, owner: "unknown", sensitivity: "UNKNOWN", cleanupEligible: false, policyRef: "(default)" };
}

/**
 * SCAN — inventory with nested classification: an unclassified directory is
 * recursed (up to depth 4) so deep policy patterns (e.g.
 * pw-flow-profile/OptGuideOnDeviceModel) are individually classified. The
 * parent directory is still listed as a rollup.
 */
function scan({ root = defaultRuntimeRoot(), policy = RUNTIME_STORAGE_POLICY } = {}) {
  const inventory = [];
  if (!fs.existsSync(root)) {
    return { ok: true, root, policyVersion: policy.version, totalBytes: 0, inventory, measuredAt: new Date().toISOString() };
  }
  const rootReal = fs.realpathSync(root);

  function addEntry(full, rel, isDir, depth) {
    const cls = classify(rel, policy);
    let stats;
    try {
      stats = isDir ? statDeep(full) : (() => { const st = fs.statSync(full); return { sizeBytes: st.size, fileCount: 1, lastModified: st.mtimeMs }; })();
    } catch {
      stats = null;
    }
    inventory.push({
      path: rel.split(path.sep).join("/"),
      depth,
      lifecycle: cls.lifecycle,
      owner: cls.owner,
      sensitivity: cls.sensitivity,
      cleanupEligible: cls.cleanupEligible,
      sizeBytes: stats ? stats.sizeBytes : null,
      fileCount: stats ? stats.fileCount : null,
      lastModified: stats && stats.lastModified ? new Date(stats.lastModified).toISOString() : null,
      readable: !!stats,
    });
    // Recurse into unclassified directories so nested policy roots surface.
    if (isDir && cls.policyRef === "(default)" && depth < 4 && stats) {
      for (const e of fs.readdirSync(full, { withFileTypes: true })) {
        addEntry(path.join(full, e.name), path.join(rel, e.name), e.isDirectory(), depth + 1);
      }
    }
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    addEntry(path.join(root, entry.name), entry.name, entry.isDirectory(), 0);
  }
  // Total = sum of top-level entries only (nested entries are subsets).
  const totalBytes = inventory.reduce((n, i) => n + (i.depth === 0 ? i.sizeBytes || 0 : 0), 0);
  inventory.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  return { ok: true, root: rootReal, policyVersion: policy.version, totalBytes, inventory, measuredAt: new Date().toISOString() };
}

/**
 * DRY_RUN / CLEAN. Only cleanupEligible CACHE/EPHEMERAL entries are removed.
 * Guards: realpath containment inside the canonical root; symlink/junction
 * escape rejected; locked/unreadable dirs are skipped and reported; retry is
 * idempotent. cleanupTrigger respects an active-session lock file
 * (.session-active in the root) — cleanup is skipped entirely when present.
 */
function cleanup({ root = defaultRuntimeRoot(), policy = RUNTIME_STORAGE_POLICY, dryRun = true, now = new Date() } = {}) {
  const scanResult = scan({ root, policy });
  if (!scanResult.ok) return scanResult;
  const rootReal = fs.realpathSync(root);
  const candidates = scanResult.inventory.filter((i) => i.cleanupEligible && ["CACHE", "EPHEMERAL"].includes(i.lifecycle));
  const activeLock = fs.existsSync(path.join(root, ".session-active"));
  const result = {
    ok: true,
    dryRun,
    mode: dryRun ? "DRY_RUN" : "CLEAN",
    policyVersion: policy.version,
    root: rootReal,
    skippedActiveSession: activeLock,
    candidates: candidates.map((c) => ({ path: c.path, lifecycle: c.lifecycle, sizeBytes: c.sizeBytes })),
    reclaimableBytes: candidates.reduce((n, c) => n + (c.sizeBytes || 0), 0),
    removed: [],
    skipped: [],
    reclaimedBytes: 0,
    cleanedAt: now.toISOString(),
  };
  if (dryRun || activeLock) {
    if (activeLock) result.note = "CLEANUP_SKIPPED: active session lock present (.session-active)";
    return result;
  }
  for (const c of candidates) {
    const target = path.join(rootReal, c.path);
    let real;
    try {
      real = fs.realpathSync(target);
    } catch {
      result.skipped.push({ path: c.path, reason: "NOT_FOUND_OR_INACCESSIBLE" });
      continue;
    }
    // Path guard: realpath must stay inside the owned root (symlink/junction
    // pointing outside is rejected — RULE: no delete outside owned roots).
    if (!isInsideRoot(rootReal, real)) {
      result.skipped.push({ path: c.path, reason: "SYMLINK_ESCAPE_REJECTED" });
      continue;
    }
    const before = statDeep(real);
    try {
      fs.rmSync(real, { recursive: true, force: false });
      result.removed.push({ path: c.path, lifecycle: c.lifecycle, reclaimedBytes: before ? before.sizeBytes : 0 });
      result.reclaimedBytes += before ? before.sizeBytes : 0;
    } catch (e) {
      result.skipped.push({ path: c.path, reason: `DELETE_FAILED: ${e.code || e.message}` });
    }
  }
  return result;
}

module.exports = {
  POLICY_VERSION,
  RUNTIME_STORAGE_POLICY,
  LIFECYCLE,
  defaultRuntimeRoot,
  scan,
  cleanup,
  classify,
};
