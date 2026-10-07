# PHASE 1H.1 — TASK 01 REPORT
# VERSIONED PROJECT MANIFEST

```text
TASK_VALIDATION = PASS
PHASE_1H1_QUALITY_GATE = PASS
PHASE_1H1 = COMPLETE
NEXT = PHASE_1H.2
```

**Project:** UNFOLDIQ · **Roadmap:** V6.1 · **Phase:** 1H Production Control Plane
**Paid generations:** 0 · **Window:** 2026-10-05

---

## 1. Entry gate

Verified from `Report/PHASE_1G12_02_RETROACTIVE_HARDENING_SWEEP_REPORT.md` (read):

```text
PHASE_1G_QUALITY_GATE = PASS
PHASE_1G = COMPLETE
open P0 = 0 / open P1 = 0 (findings/p0-p1-closure.json)
full regression = PASS (re-run §17, still green on current tree)
Flow Companion regression = PASS (533/533 + e2e, boundary untouched by this task)
```

All entry conditions true → not blocked.

## 2. Existing-state audit

- No project-manifest existed anywhere (grep `project-manifest|manifestId|pipelineVersion`
  over `*.js` → greenfield; no competing state owner to upgrade).
- Conventions reused, not reinvented: `providers/runtime/artifact-store.js`
  (atomic tmp+rename, traversal-safe paths), `lib/output-cost/shared.js`
  (`hash16`/`id12`/`stableStringify`), `schemas/` + Ajv (`ajv` is an
  installed dep), `scripts/checks/validate-schemas.js` (registered +
  extended), `scripts/cli/*` + `tests/<domain>/` (new `tests/project-manifest/`
  auto-discovered by `scripts/run-tests.js`), evidence under
  `projects/phase1h1-validation/` per §23.
- Ownership (§4): manifest file lives at
  `projects/<pid>/manifest/project-manifest.json`, written ONLY by
  `lib/project-manifest` (CORE). Extension owns browser/DOM state only;
  this task touches no boundary contract.

## 3. Manifest schema

`schemas/project-manifest.schema.json` (draft-07, `schemaVersion` const
`1.0.0`): `manifestId pm-<12hex>`, `projectVersion`/`revision` ≥ 1,
`pipelineVersion`/`contentMode`/`contentClass` nullable, 16 roadmap
artifact refs (`version` + `VERIFIED|MIGRATED|UNRESOLVED|NOT_CREATED_YET` +
`ref` + `detail`), `providers.{registryVersion,selections[]}`,
`state.{stage,status}`, `lineage.{previousManifestId,previousProjectVersion}`,
`fingerprint [0-9a-f]{16}`. `additionalProperties: false` everywhere so
1H.2/1H.3 extensions require an explicit schema migration, not drift.

## 4. State ownership

CORE = project/job/artifact canonical state (manifest, ledger, asset
index, decisions). EXTENSION = browser/DOM/Flow execution state. The
manifest never reads extension storage and no extension code writes it.

## 5. Version semantics

Same canonical bytes → no write, no bump, no lineage entry (proven M4).
Any effective mutation → `revision+1` and (artifacts/providers/state/
content change) `projectVersion+1`. `manifestId` stable per lineage;
`previousManifestId/previousProjectVersion` reserved for future
replace-chains (1H.2). Schema change → `schemaVersion` bump + unsupported
rejection (never coerce). Timestamps are metadata, never identity.

## 6. Mutation API

`lib/project-manifest/index.js` — one write path:
`create/load/validate/update` + delegates `setArtifactVersion`,
`setProviderSelection`, `setProjectStage`. Every mutation validates input
(key allowlist, enum, shape), scans secrets, recomputes the fingerprint,
persists atomically, returns `{ok, manifest, changed}` or
`{ok:false, code, message}`. Unknown selection fields are rejected, not
stripped.

## 7. Atomic persistence

Serialize → round-trip parse → Ajv validate → `writeArtifactAtomic`
(tmp+rename) → return. M7 proves: refused update leaves bytes identical;
simulated write failure surfaces `MANIFEST_WRITE_FAILED`/`NOT_FOUND` with
nothing half-written; previous valid state always recoverable by plain `load`.

## 8. Idempotency

M4: same artifact set twice, same selection set twice (order-insensitive),
same stage twice → `changed:false`, no write, `projectVersion`/`revision`
frozen. CLI `--selection` merges into the existing set before the single
canonical update, so repeated CLI calls are idempotent too.

## 9. Conflict detection

`expectedRevision` opts: A loads rev N, B writes rev N+1, A writes with
`expectedRevision: N` → `MANIFEST_CONFLICT`, current state returned and
untouched (M8: revision 2 with the B value survives). Mandatory for future
reconnect/agent safety; no last-write-wins anywhere.

## 10. Migration/backward compatibility

`lib/project-manifest/migrate.js`: `inspectProjectEvidence` (pure,
read-only) + `bootstrapProjectManifest` (refuses to overwrite:
`MANIFEST_CONFLICT`). Rules: own version field → VERIFIED; derived
(lineage stamps, lib consts, content hashes) → MIGRATED with `detail`;
present-but-unprovable → UNRESOLVED; class absent → NOT_CREATED_YET.
Existing files never modified. B/C model selections stay as case-result
refs (documented, not invented).

## 11. Current-project migration

`manifest.js migrate --project phase1g12-case-a` → `pm-170a9f2f093c`
(full output: `phase1h1-validation/migration/phase1g12-case-a-bootstrap.json`):
registry `1.0.0` VERIFIED; instructions `iv-7e784d73e229` MIGRATED (6/11
stamps); compiler `1.0.0` MIGRATED (6 packages); shot plan + render input
content-hash MIGRATED; snapshot `rs-flow-baseline-2026-10-03` MIGRATED; 3
D-selections with `google--gemini-omni-flash--1-1` + `mr-…`; `FICTION`,
pipeline `1.0.0`; 10 classes honestly NOT_CREATED_YET (incl. timeline —
a measurement is not a timeline); `contentMode` null (no content-mode
contract for validation projects — recorded, not guessed). Then
`validate` → ok, `update --status ACTIVE` → pv2/rev2, `show` confirms.

## 12. Structured errors

11 codes, all machine-readable, all exercised by tests:
`MANIFEST_NOT_FOUND/SCHEMA_INVALID/VERSION_UNSUPPORTED/WRITE_FAILED/
MIGRATION_FAILED/CONFLICT/SECRET_REJECTED, ARTIFACT_VERSION_NOT_FOUND/
ARTIFACT_VERSION_INVALID, PROVIDER_VERSION_INVALID, STATE_TRANSITION_INVALID`.
No orchestration string-matching needed.

## 13. Security/privacy

Secret key-name scan (`password|secret|token|cookie|bearer|authorization|
api_key|sessionid|private_key`, case-insensitive, recursive) on every
validate/write path → `MANIFEST_SECRET_REJECTED`. M12: top-level, nested,
and hostile selection fields refused; clean updates unaffected; secrets
never reach disk. Manifest carries ids/refs/hashes only (content hashes
are not secrets and remain allowed).

## 14. Performance baseline

`phase1h1-validation/baseline/perf-baseline.json` (hrtime, local Windows):
validate p50 0.076ms (n=50), load p50 0.32ms (n=20), write p50 ~7–9ms
(n=10), conflict-check p50 0.253ms (n=20), manifest 2717B (<8KB budget),
migration ~27–32ms (<500ms). 1 file per load; 1 atomic replace per
effective mutation, 0 on no-op. Result PASS.

## 15. M1–M14 matrix

`phase1h1-validation/evidence/m1-m14-matrix.txt`: **69 passed, 0 failed** —
M1 create, M2 round-trip + NOT_FOUND, M3 invalid/tamper/duplicate-create,
M4 triple idempotency, M5 preservation, M6 explicit absent, M7 refused +
failed writes, M8 stale-writer conflict, M9 evidence bootstrap +
no-overwrite, M10 UNRESOLVED, M11 no host metadata, M12 secret rejection,
M13 fresh-process fingerprint-identical restore, M14 known-1G-version proof.

## 16. Targeted regression

`run-tests.js project-manifest cost real-e2e flow` → 0 failed (117.4s);
`validate-schemas.js` → ALL PASSED (incl. 2 new project-manifest cases);
manifest CLI create/validate/show/migrate/update exercised live (§11).

## 17. Full regression

`phase1h1-validation/evidence/full-repo-regression.txt`: **15 domains
(incl. new project-manifest), 0 failed suites, 283.0s.**
`check:repo-structure` → OK. Boundary untouched → Flow Companion suite
not re-required (§24); its 1G evidence (533/533 + e2e) still stands.

## 18. Open P2/P3

P0: 0. P1: 0. P2: (1) B/C model selections referenced only via case
results — extend when 1G.6 emits per-case resolution records; (2)
`contentMode` null until a content-mode contract exists. P3: (3) no
schema-migration runner yet (only `1.0.0` exists — add with the first bump);
(4) CLI `--selection` merge is additive-only (removal via future 1H.2
history). None blocks use.

## 19. H1–H20 matrix

H1 PASS (manifest exists) · H2 PASS (versioned schema) · H3 PASS (16 refs +
providers) · H4 PASS (explicit NOT_CREATED_YET) · H5 PASS (one write path) ·
H6 PASS (M7) · H7 PASS (M4) · H8 PASS (M8) · H9 PASS (M9, no fabrication) ·
H10 PASS (CLI validate ok) · H11 PASS (M12) · H12 PASS (11 codes) ·
H13 PASS (M13) · H14 PASS (M11+M13) · H15 PASS (baseline) · H16/H17 PASS
(P0/P1 = 0) · H18 PASS (targeted) · H19 PASS (full) · H20 PASS (no
locks/DAG/observability; `additionalProperties:false` forces explicit
migration for 1H.2/1H.3 fields).

## 20. Final verdict

```text
TASK_VALIDATION = PASS
PHASE_1H1_QUALITY_GATE = PASS
PHASE_1H1 = COMPLETE
NEXT = PHASE_1H.2 — GENERATION HISTORY / LOCKING
```

No stop condition triggered. Files added (no root files): `schemas/…`,
`lib/project-manifest/{index,migrate}.js`, `scripts/cli/manifest.js`,
`tests/project-manifest/test-manifest.js`,
`tests/e2e` untouched, `Report/PHASE_1H1_01_…`, live manifest at
`projects/phase1g12-case-a/manifest/project-manifest.json` (pv2/rev2/ACTIVE),
evidence under `projects/phase1h1-validation/`. No secrets, no paid calls.
