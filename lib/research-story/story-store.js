"use strict";

/**
 * UNFOLDIQ story-handoff persistence (Prompt 04).
 *
 * Canonical layout (no duplicate handoff trees):
 *   research/research-pack.json      (1G.1M structured Pack)
 *   research/research-pack.md        (readable projection, trace tokens)
 *   story/script-evidence-policy.json (1G.1N)
 *   story/narrative-brief.json       (1G.1O)
 *   story/story-draft.json           (1G.1P structured Draft)
 *   story/story-draft.md             (readable projection, no internal IDs)
 *   story/story-evidence-audit.json  (post-generation gate)
 *
 * Atomic writes via artifact-store. Idempotency via input fingerprints:
 * same Pack inputs + template version => same packId (no duplicates).
 * Stale detection refuses falsely-current downstream artifacts.
 */

const artifactStore = require("../../providers/runtime/artifact-store.js");
const { packInputFingerprint } = require("./research-pack.js");

const STORY_VERSION = "1.0.0";

const FILES = {
  packJson: "research/research-pack.json",
  packMd: "research/research-pack.md",
  policy: "story/script-evidence-policy.json",
  brief: "story/narrative-brief.json",
  draftJson: "story/story-draft.json",
  draftMd: "story/story-draft.md",
  audit: "story/story-evidence-audit.json",
};

function persistStoryHandoff(root, projectId, artifacts = {}) {
  const written = [];
  try {
    const jobs = [
      [artifacts.pack, FILES.packJson],
      [artifacts.packMarkdown, FILES.packMd, true],
      [artifacts.policy, FILES.policy],
      [artifacts.narrativeBrief, FILES.brief],
      [artifacts.draft, FILES.draftJson],
      [artifacts.draftMarkdown, FILES.draftMd, true],
      [artifacts.audit, FILES.audit],
    ];
    for (const [doc, rel, raw] of jobs) {
      if (doc === undefined || doc === null) continue;
      const data = raw ? String(doc) : JSON.stringify(doc, null, 2);
      artifactStore.writeArtifactAtomic(root, projectId, rel, data);
      written.push(rel);
    }
    return { ok: true, written };
  } catch (e) {
    return { ok: false, code: "STORY_PERSIST_FAILED", message: String((e && e.message) || e), written };
  }
}

function loadStoryFile(root, projectId, rel) {
  try {
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, doc: null };
    const raw = artifactStore.readArtifact(root, projectId, rel).toString("utf8");
    return { ok: true, doc: rel.endsWith(".md") ? raw : JSON.parse(raw), raw };
  } catch (e) {
    return { ok: false, code: "STORY_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

/** Downstream artifacts must not outlive their Pack's currency. */
function checkDownstreamCurrency(pack, evidenceInput) {
  const { isPackCurrent } = require("./research-pack.js");
  const res = isPackCurrent(pack, evidenceInput);
  if (!res.current) return { current: false, reason: res.reason, stale: ["policy", "narrativeBrief", "draft", "audit"] };
  return { current: true, stale: [] };
}

module.exports = {
  STORY_VERSION,
  FILES,
  persistStoryHandoff,
  loadStoryFile,
  checkDownstreamCurrency,
  packInputFingerprint,
};
