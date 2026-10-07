# FIX POST-1H — 01
# PHYSICAL REPOSITORY REORGANIZATION + REFERENCE-SAFE MIGRATION

```text
FIX_POST_1H_01 = COMPLETE
PHYSICAL_REPOSITORY_REORGANIZATION = COMPLETE
WORKSPACE_GOVERNANCE = ACTIVE
NEXT = resume current Phase 2 work
```

**Project:** UNFOLDIQ · **Window:** 2026-10-05 · **Migration:** `post1h-physical-migration`
**Journal:** `projects/validation/post-1h-physical-migration/migration/migration-journal.jsonl` (305 events, 0 BLOCKED)

---

## 1. Previous hygiene mismatch

`POST_1H_REPOSITORY_HYGIENE_AND_WORKSPACE_MIGRATION_REPORT.md` (now
`Report/archive/post-1h/…`) established resolver/guard/registry governance but
moved 0 legacy items: 18 flat legacy project dirs and 74 flat `Report/` files
remained. Its W12/W13 tests additionally enshrined KEEP-LEGACY-PATH as expected
behavior. This FIX reverses that default per §2 (references are migrated first;
only a proven technical blocker keeps a path), and updates those two tests to
assert migration-following instead of staying-put.

## 2. Before tree

(`inventory/tree-before-{projects,Report,out}.txt`)

```text
projects/  19 dirs: 18 legacy flat + validation/  (legacy: channel-mascot, DBG_1G12, DBG_H4,
           E2E_bench_panel, HARDENING_1G12, live-1g1-http308, phase1g12-case-a, phase1g12-hardening,
           phase1h{1,2,3,45,67,hyg}-validation, phase2-1-validation, pilot-sky-blue,
           postv1-flow-live-validation, postv1b-flow-companion-live)
Report/    74 flat files (.gitkeep + INDEX.md + 72 reports) + evidence/ + fixes/phase-2/
out/       pilot-sky-blue/ + postv1-flow-live-validation/ + 7 playwright/bridge scratch files
```

## 3. Migration plan

Batches (§12): B1 Report/ phase reports + gates (85 ops) → B2 Report/ fixes/archive
(in same B1 execution) → B3 validation projects → B4 demos/debug → B5 active/archive
(keeps only, documented) → B6 out/ (14 ops) → B7 local cleanup (7 purges).
Executor: `scripts/maintenance/post1h-migrate.js` (journal PLANNED→MOVED→
VALIDATED→COMMITTED/BLOCKED; `--rollback` replays in reverse). DRY_RUN: 91/91
moves pre-validated (source present, target absent). Rollback evidence:
`migration/rollback/` holds before-state registry/graph/inventory copies.

`LEGACY_MANAGED / KEEP_IN_PLACE` (concrete blockers, §2): `phase1g12-case-a`
(golden hash-pins + governance tests), `channel-mascot` (live test + extension
default + ceremony binding), `phase1hyg-validation` (tooling INV_DIR + live test),
`phase2-1-validation` (tests + golden + fingerprinted voice-bible provenance),
`pilot-sky-blue` (golden fixture + live test), `postv1-flow-live-validation`
(brand LOCKED continuity), `postv1b-flow-companion-live` (tests + extension
default + hash-linked evidence), `HARDENING_1G12` (flow bridge job-store
hardcodes `projects/<id>`, live test). Full per-candidate analysis in
`inventory/reference-lists.json`.

## 4. projects/ moves

```text
projects/debug/DBG_1G12                              ← projects/DBG_1G12
projects/debug/DBG_H4                                ← projects/DBG_H4
projects/debug/E2E_bench_panel                       ← projects/E2E_bench_panel
projects/debug/live-1g1-http308                      ← projects/live-1g1-http308
projects/validation/phase-1g/phase1g12-hardening     ← projects/phase1g12-hardening
projects/validation/phase-1h/phase1h1-validation     ← projects/phase1h1-validation
projects/validation/phase-1h/phase1h2-validation     ← projects/phase1h2-validation
projects/validation/phase-1h/phase1h3-validation     ← projects/phase1h3-validation
projects/validation/phase-1h/phase1h45-validation    ← projects/phase1h45-validation
projects/validation/phase-1h/phase1h67-validation    ← projects/phase1h67-validation
```

MOVED_PROJECT_DIRS = 10. Top level went 19 dirs → 13
(`active archive channel-mascot debug demos HARDENING_1G12 phase1g12-case-a
phase1hyg-validation phase2-1-validation pilot-sky-blue postv1-flow-live-validation
postv1b-flow-companion-live validation`). `demos/` + `active/` created for new
work (both resident DEMO/ACTIVE projects are immovable — documented in §3).

## 5. Report/ moves

MOVED_REPORT_FILES = 72. Flat `Report/` went 74 files → 2 (`.gitkeep` + `INDEX.md`).

```text
Report/phases/phase-1g/    19 final 1G reports (+ preflight migration map)
Report/phases/phase-1h/     5 final 1H gates
Report/phases/post-v1/      1 live-validation gate
Report/fixes/post-v1/      14 bridge/flow fix reports (incl. 3 FLOW_BRIDGE_*)
Report/fixes/phase-1/       1 remotion environment fix (+ existing fixes/phase-2/)
Report/archive/phase-1/    23 superseded STEP-*, setup, root-cleanup
Report/archive/post-v1/     7 superseded post-V1 intermediates
Report/archive/post-1h/     1 previous hygiene gate (superseded by this FIX)
Report/archive/phase-2/     1 superseded Phase 2.1 task report
Report/current/             this report (+ current-roadmap/ + current-gates/)
```

## 6. out/ organization

```text
out/final/pilot-sky-blue/                DURABLE final deliverable set (8.7 MB incl. final.mp4)
out/final/postv1-flow-live-validation/   RETENTION_MANAGED validation deliverable
out/temp|preview|test|debug/             EPHEMERAL/REGENERABLE scratch locations (ready, empty)
```

7 playwright/bridge scratch files (`_pw.*`, `_cdp2g.js`, `_launch2g.js`,
`_e_logincheck.txt`, `bridge-2g-live.log`) purged with hash proof (B7, §7).

## 7. local regenerable cleanup

| Candidate | Size | Class | Decision |
|---|---|---|---|
| `node_modules/` (root, `npm ci` proven) | 322 MB | R1 | KEEP — active dep tree; reinstall breaks all work |
| `remotion/node_modules/` | 843 MB | R1 | KEEP — active render deps |
| `.opencode/node_modules/` | 55 MB | R1 | KEEP — agent tooling |
| `flow-companion/extension/.output/` | 0.5 MB | R1 | KEEP — tiny, extension tests may consume |
| `out/` scratch (7 files) | 4,474 B | R0/EPHEMERAL | PURGED with journal proof |
| `playwright-report/`, `test-results/` | absent | — | nothing to do |

Reclaimed: 4,474 B. Reclaimable-if-ever-needed (kept, active): ~1.22 GB reported, not touched.

## 8. reference rewrites

- `projects/registry.json`: 10 moved paths + 1 new migration project (19 entries, validates; all resolve)
- `Report/INDEX.md`: rewritten to the new hierarchy (+ fix history, archive map, artifact registry pointer)
- `reference-graph.json`: regenerated via `repo-inventory.js` + `hygiene-classify.js` (436 → 510 nodes; old flat paths gone)
- Tests: 14 outDir/path constants (`manifest history recovery dag golden telemetry compliance provenance storage`), W12 (tracks migrated path + asserts old-path eradication), C7 label, `run-case-b.js` evidence string
- Frozen report prose + pre-migration inventory snapshots intentionally untouched (before-evidence, §13 allowed-remaining)
- No duplicate compatibility copies; no silent aliases

## 9. registry update

`projects/registry.json` references the physical new locations (verified: all 10
moved ids resolve via `resolveProjectRoot`). `projects/artifact-registry.json`
(new, 19 records) resolves every affected durable artifact by `artifactId` with
hash/state validation — 12/12 live records verify; 7 PURGED scratch records
retain id + hash + original path.

## 10. workspace resolver/guard update

- `resolveProjectRoot` already registry-aware (nested paths work); `artifact-store`
  (`resolveProjectPath`, `assetDir`, fingerprint index) and `lib/storage`
  (walk/inventory/missing/cleanup) were hardcoded to `projects/<id>` — now
  registry-aware with legacy fallback (all current behavior preserved).
- Guard: still refuses unregistered legacy-style paths (`projects/DBG_NEW`,
  `projects/phase2-test`), plus new portability rejections — Windows reserved
  device names, illegal characters, trailing dots/spaces. Case/unicode scan:
  no collisions exist.
- New writes default to the new hierarchy (`KIND_DIR`); slug convention
  documented for new work, legacy names grandfathered.

## 11. old-path scan

Live tooling (`tests scripts lib schemas golden extension-src core platforms policy
pipeline qa providers mcp context brand remotion` + both registries + INDEX):
**0 active old-path refs**. Remaining appearances are exactly the allowed set:
frozen report prose, pre-migration inventory snapshots (`rollback/`, phase1hyg
before-regen state), the W12 eradication assertion itself, and migration evidence.

## 12. before/after metrics

```text
legacy project dirs ....... 18 → 8 keeps (10 moved, all with rewritten refs)
flat Report/ files ........ 74 → 2 (72 moved; 0 stranded)
project top-level dirs ..... 19 → 13 (active/archive/debug/demos/validation added)
files moved ................ 91 (72 reports + 10 project dirs + 9 out relocations)
dirs moved ................. 12
refs rewritten ............. registry 11 · INDEX ~40 · graph 510 nodes regen · tests 16 · CLI 1
bytes moved ................ reports 1.29 MB · projects 670 KB · out/final 8.73 MB
bytes deleted .............. 4,474 (7 R0 scratch, journal-hashed)
bytes archived ............. same moved bytes (no separate archive dump)
regenerable reclaimed ...... 4,474 B executed · ~1.22 GB reported-but-kept (active)
future-protected ........... 2 exact (R4 deliverables) · 1 REVIEW_REQUIRED (.output)
managed artifacts .......... 19 registry records (12 live + 7 purged)
stable artifactIds ......... 19 · duplicate ids 0 · hash mismatches 0
path-only durable refs ..... 0 new (registry is artifactId-keyed)
resolver failures .......... 0 · quarantined 0 · purged-managed 0 · journal BLOCKED 0
```

## 13. targeted regression

```text
workspace 53 · manifest 69 · history 109 · recovery 75 · dag 156 · golden 63
telemetry 54 · compliance 38 · provenance 30 · storage 46 · context-routing PASS
kokoro/provider-core PASS — 0 failures
```

The suites caught 2 real migration misses mid-run (45/67-variant outDir regex gap
recreating legacy dirs; D23 stale report path) — both fixed at root cause, suites
re-green before the full run. No weakened assertions.

## 14. full regression

```text
npm test → 25 domains, 0 failed suites, 387.4s
npm run check:workspace → ok:true, 19 projects
npm run check:repo-structure → REPOSITORY_STRUCTURE_OK
validate-schemas → ALL TESTS PASSED
```

P0 = 0 · P1 = 0. Extension/Playwright suites not re-run (their paths/configs untouched).

## 15. F1–F36

All 36 PASS: F1 real moves (91) · F2/F3 hierarchies match target · F4/F5 INDEX +
registry on new paths · F6 refs rewritten · F7 old active refs eliminated ·
F8 registry-aware resolution (workspace + artifact-store + storage) · F9 guard
blocks legacy-style + portability hazards · F10 out/ organized · F11 clutter
measured · F12 proven cleanup executed (active trees kept with rationale) ·
F13 tests/Golden/evidence preserved · F14 deliverables preserved (hash-pinned) ·
F15 zero broken refs · F16 zero missing durables (12/12 resolve) · F17
fresh-process restore (W22 + voice D20 in-run) · F18 targeted · F19 full green ·
F20/F21 P0/P1 zero · F22 dependency map covers all DELETE candidates ·
F23 no exact-future deleted · F24 no R4/R5 deleted · F25 regeneration documented ·
F26 zero REVIEW_REQUIRED among executed deletions · F27 Phase 2–7 consumers
resolvable (voice/golden suites green post-move) · F28 paid/operator evidence
preserved · F29 stable identity for all affected durables (19 records) · F30 no
new path-only canonical durable refs · F31 resolver hash/state validation green ·
F32 journal complete with rollback coverage (audit: 91/91 moves PLANNED +
VALIDATED-with-rollbackRef, all at target or PURGED) · F33 purge policy followed
(R0/EPHEMERAL immediate-delete with proof; quarantine chain defined, unused) ·
F34 revision/lineage intact (voice bibles, golden, approvals untouched) · F35
retention policy exists, outputs classified · F36 registries resolve without
directory-name semantics.

## 16. Future Dependency / Regeneration Cost audit

`inventory/future-dependency-map.json` (13 entries): 7 DELETE (all R0/EPHEMERAL,
`futureDependencyStatus NONE`, executed with hash proof), 4 KEEP (node trees +
`.output`, R1 with rebuild contracts), 2 KEEP_EXACT (R4 deliverables).

ACCEPTED_DEVIATION DEV-MAP-1: the canonical Roadmap V6.2 file is not present
anywhere in the repository (verified: no `ROADMAP*V6*` file exists in-repo; the
index locates it outside the repo at Downloads All). Phase 2–7 areas are
therefore taken from the FIX text §9D, not from the roadmap file — recorded in
the map, not silently substituted. Compensating proof that no Phase 2–7
dependency was deleted: full-repo scan (4,263 files) for the 7 purged basenames
finds references ONLY in this FIX's own evidence (journal PURGED events,
artifact-registry PURGED records, the map itself, the move plan, before-trees,
this report) plus frozen pre-migration snapshots that describe before-state;
**zero** references in `tests/ scripts/ lib/ golden/ schemas/ core/ pipeline/
remotion/ platforms/ providers/` and specifically zero in the Phase 2–7
contract owners (`lib/voice-bible`, `golden/`, `core/WORKFLOW.md` stages,
provider contracts). All 7 were R0/EPHEMERAL playwright/bridge rerun scratch
with canonical evidence long since extracted to
`Report/evidence/post-v1f-real-execution/`. Unknown never defaulted to deletion.

## 17. Stable Artifact Identity / Resolver audit

`lib/artifact-resolver/index.js`: `artifact://` identity, `artifactId →
physicalPath + lifecycle + contentHash (+ tree-hash for dirs) + revision metadata
where present`, fresh-process resolution from the JSON registry, explicit failure
for unknown id / missing bytes / hash mismatch / duplicate id / invalid
lifecycle — no stale-path fallback. No second identity system introduced
(recovery `artifactId` passthroughs are unrelated fields, left alone).

## 18. Artifact Registry / Version / Lineage audit

19 records with id/projectId/type/path/hash/size/timestamps/lifecycle/
retention/pinned; provider/lineage metadata uses `UNKNOWN_NOT_AVAILABLE`-style
honesty by omission (no provider fields fabricated — records carry only proven
values). No APPROVED/LOCKED/GOLDEN bytes replaced; voice-bible v1→v3 lineage
untouched by this FIX.

## 19. Lifecycle / Retention / Quarantine audit

`policy/artifact-retention-policy.json` covers DURABLE / RETENTION_MANAGED /
REGENERABLE / EPHEMERAL / GOLDEN with autoPurge rules, the
ACTIVE→DELETE_CANDIDATE→QUARANTINED→PURGED chain, and the R0–R5 default table.
No `debug = delete` hardcoding. Quarantine unused (nothing met the bar for
deferred destruction); the 7 purges qualified for proven safe-immediate-delete.

## 20. Migration Journal audit

305 events / 123 items: COMMITTED 116 · PLANNED 91 · VALIDATED 91 · PURGED 7 ·
BLOCKED 0 · ROLLED_BACK 0. Audit: 91/91 moves carry PLANNED + VALIDATED with
`rollbackRef` (reverse move); every item verifies at target or PURGED-with-hash.
`--rollback` replay available from journal + `rollback/` before-evidence.
Destructive actions fully represented (7 purges with hash + reason + rollback =
rerun provenance).

## 21. Deferred future-storage/provenance compatibility note

Resolver maps `artifactId → local path` today; the contract supports a future
`→ R2/S3` mapping without redesign (content hash + lineage + approval state
already recorded). NOT built in this FIX: object storage, database service,
C2PA signing, S3 Object Lock, build attestations, microservices.

## 22. Final verdict

```text
FIX_POST_1H_01 = COMPLETE
PHYSICAL_REPOSITORY_REORGANIZATION = COMPLETE
WORKSPACE_GOVERNANCE = ACTIVE
NEXT = resume current Phase 2 work
```

No stop condition triggered: no canonical evidence destroyed (moves are
byte-moves + registry re-points; keeps documented with blockers), all rewrites
proven by green suites, rollback path available, no secrets copied (`.env`
untouched at root; only path strings moved), full regression green, P0/P1 zero,
no R4/R5 or exact-future deletion, no identity collision or hash mismatch.

**Added:** `lib/artifact-resolver/`, `projects/artifact-registry.json`,
`policy/artifact-retention-policy.json`, `scripts/maintenance/post1h-migrate.js`,
`projects/validation/post-1h-physical-migration/` (inventory/migration/evidence/
regression/rollback), this report. **Edited:** `lib/workspace` (comment +
portability guard), `artifact-store` + `lib/storage` (registry-aware bases),
`projects/registry.json`, 16 test/CLI files (path-following only, zero weakened
assertions), regenerated phase1hyg inventory/graph. **Purged:** 7 R0 scratch
files with journal proof.
