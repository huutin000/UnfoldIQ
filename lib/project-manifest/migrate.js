"use strict";

/**
 * Phase 1H.1 — bounded existing-project migration (§12).
 * Inspects canonical artifacts, creates a manifest FROM EVIDENCE, and
 * distinguishes VERIFIED vs MIGRATED vs UNRESOLVED vs NOT_CREATED_YET.
 * Never fabricates versions: unprovable → UNRESOLVED (or NOT_CREATED_YET
 * when the artifact class provably does not exist yet). Never overwrites an
 * existing manifest (MANIFEST_CONFLICT). Never modifies existing files.
 */

const fs = require("fs");
const path = require("path");
const manifestLib = require("./index.js");
const costShared = require("../output-cost/shared.js");

function projFile(root, projectId, rel) {
  return path.join(root, "projects", projectId, rel);
}

function readJson(root, projectId, rel) {
  try {
    const p = projFile(root, projectId, rel);
    if (!fs.existsSync(p)) return { ok: false, code: "ABSENT" };
    return { ok: true, data: JSON.parse(fs.readFileSync(p, "utf8")), bytes: fs.readFileSync(p) };
  } catch (e) {
    return { ok: false, code: "UNPARSEABLE", message: String((e && e.message) || e) };
  }
}

function hashBytes(buf) {
  return costShared.hash16({ sha: require("crypto").createHash("sha256").update(buf).digest("hex") });
}

function modeOf(values) {
  const counts = new Map();
  for (const v of values) {
    if (typeof v !== "string" || !v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best ? { value: best, count: bestN, total: values.length } : null;
}

function notCreated(detail) {
  return { version: null, status: "NOT_CREATED_YET", ref: null, detail: detail || null };
}

/**
 * Pure inspection (no writes). Returns { artifacts, providers, contentClass,
 * pipelineVersion, decisions } where decisions[] documents every key.
 */
function inspectProjectEvidence(root, projectId) {
  const decisions = [];
  const artifacts = {};
  for (const k of manifestLib.ARTIFACT_KEYS) artifacts[k] = notCreated(null);

  const put = (key, entry, why) => {
    artifacts[key] = entry;
    decisions.push({ key, ...entry, why });
  };

  // Asset registry — versioned index file (VERIFIED when it parses).
  const libIdx = readJson(root, projectId, "assets/library-index.json");
  if (libIdx.ok && typeof libIdx.data.version === "string") {
    const count = libIdx.data.assets ? Object.keys(libIdx.data.assets).length : 0;
    put("assetRegistryVersion",
      { version: libIdx.data.version, status: "VERIFIED", ref: "assets/library-index.json", detail: `${count} records` },
      "index carries its own version field");
  } else if (libIdx.code === "UNPARSEABLE") {
    put("assetRegistryVersion", { version: null, status: "UNRESOLVED", ref: "assets/library-index.json", detail: "file exists but is unparseable" }, "cannot prove version");
  } else if (libIdx.ok) {
    put("assetRegistryVersion", { version: null, status: "UNRESOLVED", ref: "assets/library-index.json", detail: "index exists without a version field" }, "cannot prove version");
  } else {
    put("assetRegistryVersion", notCreated("no assets/library-index.json"), "registry class absent");
  }

  // Agent Instructions — derived from lineage stamps (MIGRATED, not the store).
  if (libIdx.ok && libIdx.data.assets) {
    const stamps = Object.values(libIdx.data.assets).map((r) => r && r.instructionVersion);
    const m = modeOf(stamps);
    if (m) {
      put("agentInstructionsVersion",
        { version: m.value, status: "MIGRATED", ref: "assets/library-index.json", detail: `most-common instructionVersion stamp (${m.count}/${m.total} records); canonical store is lib/agent-instructions, not re-resolved here` },
        "lineage stamps, not instruction-store proof");
    } else {
      put("agentInstructionsVersion", { version: null, status: "UNRESOLVED", ref: "assets/library-index.json", detail: "no instructionVersion stamps on records" }, "unprovable from evidence");
    }
  } else {
    put("agentInstructionsVersion", notCreated("no asset lineage to derive from"), "class absent");
  }

  // Prompt compiler — lib const cross-checked against packages on disk.
  try {
    const compilerVersion = require("../prompt-compiler/shared.js").COMPILER_VERSION || null;
    const promptsDir = projFile(root, projectId, "prompts");
    let pkgCount = 0;
    if (fs.existsSync(promptsDir)) {
      for (const d of fs.readdirSync(promptsDir)) {
        const sub = path.join(promptsDir, d);
        if (fs.statSync(sub).isDirectory() && fs.readdirSync(sub).some((f) => f.endsWith(".json"))) pkgCount++;
      }
    }
    if (compilerVersion && pkgCount > 0) {
      put("promptCompilerVersion",
        { version: compilerVersion, status: "MIGRATED", ref: "prompts/", detail: `${pkgCount} compiled packages on disk; compiler const ${compilerVersion} (package files carry version 1.0.0)` },
        "const + on-disk packages, not a recorded compiler run");
    } else {
      put("promptCompilerVersion", notCreated("no compiled packages"), "class absent");
    }
  } catch (e) {
    put("promptCompilerVersion", { version: null, status: "UNRESOLVED", ref: null, detail: `compiler const unreadable: ${String((e && e.message) || e)}` }, "unprovable");
  }

  // Shot plan — content-hash identity when no version field exists.
  const shotPlanRel = readJson(root, projectId, "case/case-d-shot-plan.json").ok
    ? "case/case-d-shot-plan.json"
    : (readJson(root, projectId, "scene-script.json").ok ? "scene-script.json" : null);
  if (shotPlanRel) {
    const r = readJson(root, projectId, shotPlanRel);
    put("shotPlanVersion",
      { version: hashBytes(r.bytes), status: "MIGRATED", ref: shotPlanRel, detail: "no version field on the plan file; version is the content hash (deterministic identity, not fabricated)" },
      "content-hash identity");
  } else {
    put("shotPlanVersion", notCreated("no shot/scene plan file"), "class absent");
  }

  // Render — Case-A style render input hash; no versioned render-output artifact.
  const renderInput = readJson(root, projectId, "render/render-input-case-a.json");
  if (renderInput.ok) {
    put("renderVersion",
      { version: hashBytes(renderInput.bytes), status: "MIGRATED", ref: "render/render-input-case-a.json", detail: "render input hash; no versioned render-output artifact exists" },
      "input hash, output unversioned");
  } else {
    put("renderVersion", notCreated("no render input"), "class absent");
  }

  // Timeline — a timing measurement is not a timeline artifact.
  put("timelineVersion", notCreated("timing/timeline-measured.json is a measurement, not a timeline; no timeline implementation (1H non-goal)"), "class absent by roadmap");

  // Bible / research / script / audio classes — bounded candidate probes.
  const probes = {
    creativeBriefVersion: ["creative-brief.json", "brief/creative-brief.json"],
    channelBibleVersion: ["bibles/channel.json", "channel-bible.json"],
    storyBibleVersion: ["bibles/story.json", "story-bible.json"],
    characterBibleVersion: ["bibles/character.json", "character-bible.json"],
    worldBibleVersion: ["bibles/world.json", "world-bible.json"],
    visualBibleVersion: ["bibles/visual.json", "visual-bible.json"],
    researchPackVersion: ["research-pack.json", "story/research-pack.json"],
    finalSpokenScriptVersion: ["final-spoken-script.json", "script/final-spoken-script.json"],
    finalAudioVersion: ["audio/final-mix.json", "final-audio.json"],
    alignmentVersion: ["alignment.json", "audio/alignment.json"],
  };
  for (const [key, rels] of Object.entries(probes)) {
    let found = null;
    for (const rel of rels) {
      const r = readJson(root, projectId, rel);
      if (r.ok) { found = { rel, r }; break; }
    }
    if (found) {
      const v = found.r.data && (found.r.data.version || found.r.data.bibleVersion || found.r.data.packVersion);
      if (typeof v === "string" && v) {
        put(key, { version: v, status: "VERIFIED", ref: found.rel, detail: null }, "file carries its own version");
      } else {
        put(key, { version: hashBytes(found.r.bytes), status: "MIGRATED", ref: found.rel, detail: "no version field; content-hash identity" }, "content-hash identity");
      }
    } else {
      put(key, notCreated(`none of ${rels.join(", ")}`), "class absent");
    }
  }

  // Providers — global seed snapshot (referenced, never copied) + D resolutions.
  let registryVersion = null;
  try {
    const snapDir = path.join(root, "providers", "model-registry", "snapshots");
    if (fs.existsSync(snapDir)) {
      const files = fs.readdirSync(snapDir).filter((f) => f.endsWith(".json")).sort();
      if (files.length > 0) {
        const snap = JSON.parse(fs.readFileSync(path.join(snapDir, files[files.length - 1]), "utf8"));
        if (snap && snap.snapshotId) {
          registryVersion = {
            version: snap.snapshotId, status: "MIGRATED",
            ref: `providers/model-registry/snapshots/${files[files.length - 1]}`,
            detail: "global registry snapshot applicable to this project (no fingerprint field; identity is snapshotId)",
          };
        }
      }
    }
  } catch { /* stays null → UNRESOLVED below */ }
  const providers = { registryVersion, selections: [] };
  if (!registryVersion) {
    providers.registryVersion = null;
    decisions.push({ key: "providers.registryVersion", version: null, status: "UNRESOLVED", ref: null, detail: "no readable registry snapshot", why: "unprovable from evidence" });
  } else {
    decisions.push({ key: "providers.registryVersion", ...registryVersion, why: "snapshot file on disk" });
  }
  const dRes = readJson(root, projectId, "case/case-d-resolutions.json");
  if (dRes.ok && dRes.data && typeof dRes.data === "object") {
    const seen = new Map();
    for (const [shot, r] of Object.entries(dRes.data)) {
      if (r && r.model && r.resolutionId) {
        seen.set(`${r.model}||${r.resolutionId}`, { modelId: r.model, providerId: null, resolutionRef: r.resolutionId, detail: `case-d-resolutions.json:${shot}` });
      }
    }
    providers.selections = [...seen.values()];
    decisions.push({ key: "providers.selections", version: `${providers.selections.length} selections`, status: providers.selections.length > 0 ? "MIGRATED" : "UNRESOLVED", ref: "case/case-d-resolutions.json", detail: "model+resolution pairs from D resolutions; B/C resolutions live as refs in case results", why: "evidence-based, no invented models" });
  } else {
    decisions.push({ key: "providers.selections", version: null, status: "UNRESOLVED", ref: null, detail: "no resolution records found", why: "unprovable from evidence" });
  }

  // Pipeline — the running code version (code-readable → VERIFIED).
  let pipelineVersion = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg && typeof pkg.version === "string" && pkg.version) pipelineVersion = pkg.version;
  } catch { /* null */ }

  // Content class — most-common contentClass across compiled prompt packages
  // and scene files (pervasive FICTION evidence in validation projects).
  let contentClass = null;
  try {
    const classes = [];
    const promptsDir = projFile(root, projectId, "prompts");
    if (fs.existsSync(promptsDir)) {
      for (const d of fs.readdirSync(promptsDir)) {
        const sub = path.join(promptsDir, d);
        if (!fs.statSync(sub).isDirectory()) continue;
        for (const f of fs.readdirSync(sub).filter((x) => x.endsWith(".json"))) {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(sub, f), "utf8"));
            const c = pkg && (pkg.contentClass || (pkg.compilerInput && pkg.compilerInput.contentClass));
            if (c) classes.push(c);
          } catch { /* skip corrupt packages in probing */ }
        }
      }
    }
    const sceneDir = projFile(root, projectId, "scene");
    if (fs.existsSync(sceneDir)) {
      for (const f of fs.readdirSync(sceneDir).filter((x) => x.endsWith(".json"))) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(sceneDir, f), "utf8"));
          if (s && s.contentClass) classes.push(s.contentClass);
        } catch { /* skip */ }
      }
    }
    const m = modeOf(classes);
    if (m) contentClass = m.value;
  } catch { /* null */ }

  return { artifacts, providers, contentClass, contentMode: null, pipelineVersion, decisions };
}

/**
 * Bootstrap a manifest from evidence. Fails WITHOUT WRITING when a manifest
 * already exists (MANIFEST_CONFLICT) or evidence cannot be read
 * (MANIFEST_MIGRATION_FAILED).
 */
function bootstrapProjectManifest(root, projectId, opts = {}) {
  if (manifestLib.loadProjectManifest(root, projectId).ok) {
    return { ok: false, code: "MANIFEST_CONFLICT", message: "manifest already exists; migration must not overwrite it" };
  }
  let inspected;
  try {
    inspected = inspectProjectEvidence(root, projectId);
  } catch (e) {
    return { ok: false, code: "MANIFEST_MIGRATION_FAILED", message: String((e && e.message) || e) };
  }
  const created = manifestLib.createProjectManifest({
    root,
    projectId,
    pipelineVersion: inspected.pipelineVersion,
    contentMode: inspected.contentMode,
    contentClass: inspected.contentClass,
    artifacts: inspected.artifacts,
    providers: inspected.providers,
    state: { stage: null, status: "DRAFT" },
    now: opts.now,
  });
  if (!created.ok) return created;
  return { ok: true, manifest: created.manifest, changed: true, decisions: inspected.decisions };
}

module.exports = { inspectProjectEvidence, bootstrapProjectManifest };
