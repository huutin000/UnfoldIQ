"use strict";

/**
 * Phase 2.2+2.3 — validation workspace setup (idempotent CLI).
 *
 * Creates/repairs the resolver-approved validation workspace:
 *   1. registers projects/validation/phase223-narration-pronunciation
 *   2. creates the schema-1.5.0 Project Manifest
 *   3. writes the bounded Final Spoken Script VALIDATION fixture
 *      (productionScriptStatus = NOT_APPLICABLE; no production script exists)
 *   4. creates the DAG with FINAL_SPOKEN_SCRIPT + VOICE_BIBLE nodes only
 *   5. attaches the finalSpokenScriptVersion manifest index ref
 *
 * Run: node scripts/cli/phase223-setup.js
 * Every step is idempotent: existing immutable artifacts are reused, never
 * rewritten. This CLI never creates narration/pronunciation artifacts — those
 * belong to the phase validation runs (tests/narration, tests/pronunciation).
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const workspaceLib = require(path.join(REPO, "lib", "workspace", "index.js"));
const manifestLib = require(path.join(REPO, "lib", "project-manifest", "index.js"));
const dagLib = require(path.join(REPO, "lib", "dependency-dag", "index.js"));
const costShared = require(path.join(REPO, "lib", "output-cost", "shared.js"));

const PROJECT_ID = "phase223-narration-pronunciation";
// Direct-child validation project (same convention as phase2-1-validation):
// the workspace guard + canonical path resolution expect projects/<projectId>.
const PROJECT_PATH = "projects/phase223-narration-pronunciation";
const SCRIPT_REL = "input/final-spoken-script.json";
const VOICE_BIBLE_REF = "vb-19f4fd6a4596"; // locked Phase 2.1 Voice Bible (read-only reference)

const SCRIPT_FIXTURE = {
  schemaVersion: "1.0.0",
  scriptArtifactId: "fss-phase223-validation",
  scriptVersion: 1,
  projectId: PROJECT_ID,
  language: "en-us",
  contentMode: null,
  contentClass: "FACTUAL",
  segments: [
    { segmentId: "S1", ordinal: 0, text: "In 2024, voice AI crossed a threshold that used to sound like science fiction." },
    { segmentId: "S2", ordinal: 1, text: "That threshold was Kokoro. And it changed everything." },
    { segmentId: "S3", ordinal: 2, text: "Mica Reynolds walked through Reykjavik while recording narration for this series." },
    { segmentId: "S4", ordinal: 3, text: "NASA released the weights while CIA briefings mentioned synthetic audio." },
    { segmentId: "S5", ordinal: 4, text: "Misaki turns graphemes into phonemes before UnfoldIQ renders a video." },
    { segmentId: "S6", ordinal: 5, text: "The rest of this series explains how each piece works." },
  ],
  provenance: {
    source: "phase-2.2-2.3 bounded validation fixture",
    createdAt: "2026-10-06T00:00:00.000Z",
    productionScriptStatus: "NOT_APPLICABLE",
  },
  fingerprint: null,
};

function step(name, r) {
  if (!r.ok) {
    console.error(`SETUP_FAILED at ${name}: ${r.code || "ERROR"} — ${r.message || ""}`);
    process.exit(1);
  }
  console.log(`ok  ${name}${r.changed === false ? " (unchanged)" : ""}`);
}

function main() {
  // 1. Register the validation project.
  const regPath = path.join(REPO, "projects", "registry.json");
  const registry = JSON.parse(fs.readFileSync(regPath, "utf8"));
  let entry = registry.projects.find((p) => p.projectId === PROJECT_ID);
  if (!entry) {
    entry = { kind: "VALIDATION", manifestRef: null, path: PROJECT_PATH, projectId: PROJECT_ID, status: "ACTIVE" };
    registry.projects.push(entry);
    registry.projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
    const v = workspaceLib.validateRegistry(registry);
    if (!v.ok) {
      console.error("SETUP_FAILED: registry invalid after insert", v.errors);
      process.exit(1);
    }
    fs.writeFileSync(regPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
    step("register project", { ok: true });
  } else {
    step("register project", { ok: true, changed: false });
  }

  // 2. Manifest (schema 1.5.0). Migrate explicitly when an older one exists.
  {
    const loaded = manifestLib.loadProjectManifest(REPO, PROJECT_ID);
    if (!loaded.ok) {
      const created = manifestLib.createProjectManifest({
        root: REPO,
        projectId: PROJECT_ID,
        contentMode: null,
        contentClass: "FACTUAL",
        state: { stage: "phase-2.2-2.3", status: "ACTIVE" },
      });
      step("create manifest 1.5.0", created);
    } else if (loaded.manifest.schemaVersion === "1.4.0") {
      const migrated = manifestLib.migrateSchema1_4_0_to_1_5_0(REPO, PROJECT_ID);
      step("migrate manifest 1.4.0 -> 1.5.0", migrated);
    } else {
      step("manifest present", { ok: true, changed: false });
    }
  }

  // 3. Final Spoken Script validation fixture (immutable once written).
  const scriptAbs = path.join(REPO, PROJECT_PATH, SCRIPT_REL);
  if (!fs.existsSync(scriptAbs)) {
    const doc = { ...SCRIPT_FIXTURE, fingerprint: null };
    doc.fingerprint = costShared.hash16(doc);
    fs.mkdirSync(path.dirname(scriptAbs), { recursive: true });
    fs.writeFileSync(scriptAbs, JSON.stringify(doc, null, 2) + "\n", "utf8");
    step("write final spoken script fixture", { ok: true });
  } else {
    step("final spoken script fixture", { ok: true, changed: false });
  }

  // 4. DAG with only the real upstream nodes.
  const dagExists = dagLib.exists(REPO, PROJECT_ID);
  if (!dagExists) {
    const created = dagLib.createDag(REPO, PROJECT_ID);
    step("create dag", created);
  }
  const dag = dagLib.loadDag(REPO, PROJECT_ID);
  step("load dag", dag);
  if (!dag.dag.nodes.FINAL_SPOKEN_SCRIPT) {
    const n = dagLib.addNode(REPO, PROJECT_ID, {
      artifactKey: "FINAL_SPOKEN_SCRIPT",
      artifactType: "FINAL_SPOKEN_SCRIPT",
      versionRef: `${SCRIPT_FIXTURE.scriptArtifactId}@${SCRIPT_FIXTURE.scriptVersion}`,
      state: "CLEAN",
      producedBy: "phase-2.2-2.3:validation-fixture",
      provenance: "LIVE",
      inputRefs: [],
    });
    step("dag node FINAL_SPOKEN_SCRIPT", n);
  }
  if (!dag.dag.nodes.VOICE_BIBLE) {
    const n = dagLib.addNode(REPO, PROJECT_ID, {
      artifactKey: "VOICE_BIBLE",
      artifactType: "VOICE_BIBLE",
      versionRef: VOICE_BIBLE_REF,
      state: "CLEAN",
      producedBy: "phase-2.1:voice-bible (cross-project locked reference)",
      provenance: "LIVE",
      inputRefs: [],
    });
    step("dag node VOICE_BIBLE", n);
  }

  // 5. Manifest index ref for the script.
  const scriptDoc = JSON.parse(fs.readFileSync(scriptAbs, "utf8"));
  const ref = {
    version: `${scriptDoc.scriptArtifactId}@v${scriptDoc.scriptVersion}`,
    status: "VERIFIED",
    ref: SCRIPT_REL,
    detail: `bounded validation fixture; productionScriptStatus=${scriptDoc.provenance.productionScriptStatus}`,
  };
  const r = manifestLib.setArtifactVersion(REPO, PROJECT_ID, "finalSpokenScriptVersion", ref);
  step("manifest finalSpokenScriptVersion", r);

  console.log("SETUP_OK");
}

main();
