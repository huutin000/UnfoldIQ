# UNFOLDIQ — SUBPHASE 3A FINAL VERIFICATION & GAP CLOSURE PROMPT
## App Shell + Overview + Story Workbench
### Targeted verification before closing 3A and authorizing Subphase 3B

> **Task type:** VERIFY / FIX SUBPHASE 3A ONLY
>
> **Current implementation report:** `docs/implementation/PHASE_03A_IMPLEMENTATION_REPORT.md`
>
> **Current claimed regression:** `491 / 491 PASS`
>
> **Do NOT start Subphase 3B.**
>
> **Do NOT redesign Voice Workbench.**
>
> **Do NOT start 3C, 3D, Phase 4+ in this task.**
>
> The implementation appears substantially complete. This task exists only to close the remaining evidence/acceptance gaps before `PASS / FINAL`.

---

# 0. Operating Rules

Mandatory flow:

```text
INSPECT CURRENT SOURCE + EXISTING EVIDENCE
→ VERIFY ONLY THE REMAINING 3A GAPS
→ FIX ONLY REAL DEFECTS
→ ADD FOCUSED TESTS IF NEEDED
→ BROWSER VALIDATION
→ FULL REGRESSION IF CODE/TESTS CHANGED
→ DATA INTEGRITY
→ UPDATE REPORT
→ STOP
```

Do not:
- rewrite 3A unnecessarily;
- start 3B/3C/3D;
- add Phase 5 virtualization;
- add full Phase 6 responsive architecture;
- use `git clean -fd`;
- fabricate browser screenshots or JSON evidence.

---

# 1. Gate A — Required Workstation Viewports

The current report proves:

```text
1440x900
1024x768
375x667
```

The 3A implementation contract requires explicit workstation validation at:

```text
1920x1080
1440x900
1366x768
```

## Required action

Validate all three mandatory workstation sizes.

For each viewport verify:

```text
App Shell
Top Workbench navigation
Overview
Story Navigator
Story Workspace
Story Inspector
Primary actions
System Drawer
```

Required:

- [ ] no unintended horizontal page overflow;
- [ ] primary actions are not clipped;
- [ ] Story editor remains usable;
- [ ] Inspector remains reachable/usable;
- [ ] sticky/fixed UI does not cover focused controls;
- [ ] navigation does not break.

Existing 1024/tablet and 375/mobile evidence may remain as extra evidence.

Do NOT treat mobile behavior as a substitute for the required 1366x768 workstation gate.

Evidence:

```text
temp/phase03a_final_verification/responsive/
├── 1920x1080.png
├── 1440x900.png
├── 1366x768.png
└── viewport_results.json
```

---

# 2. Gate B — Browser Console + Network Verification

The current report describes successful browser interaction but does not explicitly report:

```text
console errors
network failures
actual API endpoints used
duplicate/stale requests
```

Use the existing CDP/Chromium harness or the current browser test infrastructure.

## Required checks

Record:

```text
unexpected console errors = 0
unexpected unhandled promise rejections = 0
unexpected failed API requests = 0
```

Verify 3A uses selective contracts:

```text
Overview
→ /api/projects/{id}/v2/overview
→ /api/projects/{id}/next-action

Story
→ /api/projects/{id}/story
```

Do not make Overview/Story depend on the aggregate diagnostic `/visual` or a monolithic project-state endpoint.

Check for obvious duplicate calls during:

```text
Overview → Story → select beat → save → Overview → Story
```

No arbitrary request-count SLA is required; only document obvious redundancy if present.

Evidence:

```text
temp/phase03a_final_verification/browser/
├── console_results.json
├── network_results.json
└── selective_api_audit.md
```

---

# 3. Gate C — Compatibility Access for 3B / 3C / 3D Capabilities

The report states Voice, Visual and Export compatibility surfaces remain functional, but this must be demonstrated because 3A changed the App Shell.

## Verify

From the new App Shell:

```text
Giọng đọc
Hình ảnh & Cảnh
Xuất video
```

must still lead to a usable existing compatibility surface until their own subphases are implemented.

At minimum:

### Voice compatibility
- [ ] existing voice/audio capability remains reachable;
- [ ] no 404/blank/dead navigation;
- [ ] no 3B redesign has been implemented.

### Visual compatibility
- [ ] existing Scene/Shot/Visual functionality remains reachable;
- [ ] no 3C redesign has been implemented.

### Export compatibility
- [ ] existing export surface remains reachable;
- [ ] the Overview CTA `"Xuất video ngay"` routes to a real existing export capability;
- [ ] it does not pretend Subphase 3D is already complete.

If a future Workbench is intentionally represented by a compatibility bridge, label/document it honestly.

Evidence:

```text
temp/phase03a_final_verification/compatibility/
├── compatibility_results.json
└── screenshots/
```

---

# 4. Gate D — Capability Migration Matrix

The report shows the new surfaces, but explicitly prove **zero capability loss** for the three old modal surfaces.

Create a matrix:

| Old surface | Old capability | New 3A surface | Same data/API? | Action still works? | PASS/FAIL |
|---|---|---|---|---|---|
| `edq-modal` | Editorial QA rules/issues/fix actions | Story Inspector | ... | ... | ... |
| `narration-beats-modal` | Beat navigation/management | Story Navigator | ... | ... | ... |
| `modal-storage-manager` | storage/cache/backup/maintenance | Overview System Drawer | ... | ... | ... |

Required:

- [ ] every prior useful action has a destination;
- [ ] no old capability is silently deleted;
- [ ] destructive/maintenance actions retain their confirmations/safety behavior;
- [ ] new surfaces use the existing underlying contract unless an intentional migration is documented.

Only remove/deactivate an old modal after the capability migration is proven complete.

Evidence:

```text
temp/phase03a_final_verification/capability_migration/migration_matrix.md
```

---

# 5. Gate E — Story Unsaved-State / Navigation Safety

The current report proves:

```text
edit → Chưa lưu
save → Đã lưu
```

Also prove the critical navigation case:

```text
edit Story without saving
→ attempt to switch Workbench / selected context
```

Expected behavior must be explicit and safe.

Acceptable patterns include:

```text
prevent navigation until user decides
OR
confirmation: Lưu / Bỏ thay đổi / Hủy
OR
reliable working-state autosave if this is the canonical architecture
```

Unacceptable:

```text
silent discard
```

Test:

```text
Kịch bản
→ modify content
→ verify Chưa lưu
→ navigate Tổng quan
→ return Kịch bản
```

Document exactly what happens.

Also verify successful save/reload:

```text
edit
→ save
→ reload application/project
→ intended Story change persists
```

Evidence:

```text
temp/phase03a_final_verification/story/navigation_save_safety.json
```

---

# 6. Gate F — Loading / Empty / Error States

The current report does not explicitly demonstrate these states.

Verify both:

```text
Overview
Story
```

have appropriate user-facing behavior for:

### Loading
- no blank unexplained panel;
- lightweight indicator/skeleton/status.

### Empty
Examples as applicable:

```text
Chưa có dữ liệu tổng quan.
Chưa có đoạn kịch bản.
Chưa có cảnh báo nội dung.
```

### Error
- Vietnamese message;
- actionable next step where possible;
- no raw-only `500`, `UNKNOWN_ERROR`, `Fetch failed`;
- technical code may be available in diagnostics only.

Use controlled API fixtures/mocks only for verification if real project cannot safely produce an error/empty case.

Do not alter production data destructively just to create an empty state.

Evidence:

```text
temp/phase03a_final_verification/states/
├── loading_empty_error_results.json
└── screenshots/
```

---

# 7. Gate G — Vietnamese-First UI Audit

Audit all new/touched 3A surfaces against:

```text
UI_LANGUAGE_GLOSSARY.md
```

Required:

- [ ] Workbench labels match canonical Vietnamese wording.
- [ ] Actions use canonical Vietnamese wording.
- [ ] Status values do not expose raw internal enums.
- [ ] User-facing validation/errors are Vietnamese.
- [ ] technical proper nouns remain correct.
- [ ] no duplicated contradictory translation for the same concept.

Explicitly search rendered UI/source for raw user-facing occurrences of:

```text
DRAFT
NEEDS_REVIEW
READY
OUTDATED
BLOCKED
Save
Cancel
Generate
Overview
Story
```

Debug/internal code identifiers are allowed.

Evidence:

```text
temp/phase03a_final_verification/language/ui_language_audit.md
```

---

# 8. Gate H — Accessibility Baseline

Full WCAG hardening remains Phase 6.

This gate only verifies 3A did not introduce obvious accessibility debt.

## Required checks

### Keyboard

Using keyboard only:

```text
Top Workbench navigation
Overview actions
System Drawer open/close
Story beat selection where supported
Script editor
Save action
Editorial QA controls
```

Verify:

- [ ] focus visible;
- [ ] logical focus order;
- [ ] no keyboard trap;
- [ ] focused controls are not hidden by fixed/sticky UI.

### Accessible names

- [ ] native visible text used where possible;
- [ ] native `<label>` used for form controls where applicable;
- [ ] icon-only controls have meaningful Vietnamese accessible names;
- [ ] no raw English enum as accessible name;
- [ ] status is not color-only.

Do NOT claim full WCAG 2.2 AA conformance.

Evidence:

```text
temp/phase03a_final_verification/accessibility/baseline_a11y_checklist.md
```

---

# 9. Gate I — Data Integrity Outside Intentional Story Edits

The current report states the Story save path is atomic, but a 3A closure must prove unrelated project data was not changed.

Compare before/after for the reference project.

At minimum:

```text
Story Beats / stable beat IDs
135 Audio Chunks
79 Scenes
141 Shots
Timestamps / cues
Visual Bible
Image prompts
Motion/Veo prompts
Negative prompts
Asset references
Project settings
Stable IDs
Parent-child relationships
Master audio
state.db
Revision history
Lock states
unknown/legacy preserved fields
```

Allow only the explicit Story test edit(s) expected by the validation scenario.

Expected:

```text
0 unintended semantic differences
```

Evidence:

```text
temp/phase03a_final_verification/integrity/
├── semantic_diff.json
└── integrity_matrix.md
```

---

# 10. Gate J — Performance Measurements

Do not invent an SLA.

Record real measurements for:

```text
App Shell initial usable state
Overview data/render completion
Story load/render completion
Overview ↔ Story switch
script save round-trip
```

Use p50/p95 only if enough iterations are collected; otherwise report individual/median observations honestly.

Do NOT implement Phase 5 virtualization in response to these measurements.

Evidence:

```text
temp/phase03a_final_verification/performance/phase03a_measurements.json
```

---

# 11. Gate K — Documentation / Files Changed / Scope

Verify required 3A documentation exists:

```text
docs/implementation/PHASE_03A_APP_SHELL_OVERVIEW_STORY.md
docs/implementation/PHASE_03A_IMPLEMENTATION_REPORT.md
```

Update the implementation report to include:

```text
baseline
Git checkpoint
files changed
App Shell
Overview
Story
capability migration
API usage
language audit
accessibility baseline
browser validation
viewports
performance
data integrity
tests/regression
scope audit
remaining risks
final verdict
```

Classify changed files:

```text
3A source
3A tests
3A docs/evidence
unexpected/out-of-scope
```

Confirm:

```text
3B = NOT STARTED
3C = NOT STARTED
3D = NOT STARTED
Phase 4+ = NOT STARTED
```

---

# 12. Full Regression

Current successful 3A reference:

```text
491 / 491 PASS
```

If source/tests change:

```bash
pytest --tb=short -q
```

Acceptance:

```text
100% collected canonical tests PASS
0 failed
0 errors
```

Any unexplained decrease below 491 is a blocker.

If only documentation/evidence is added and no source/test code changes:
- retain 491/491 as the latest regression;
- explicitly state no runtime code changed after that run.

---

# 13. Final Gate Matrix

| Gate | Requirement | Result |
|---|---|---|
| A | 1920x1080 / 1440x900 / 1366x768 validated | PASS/FAIL |
| B | Console/network/selective APIs verified | PASS/FAIL |
| C | Voice/Visual/Export compatibility remains reachable | PASS/FAIL |
| D | 3 modal capabilities migrated without loss | PASS/FAIL |
| E | Unsaved Story navigation cannot silently lose data | PASS/FAIL |
| F | Loading/empty/error states verified | PASS/FAIL |
| G | Vietnamese-first UI audit | PASS/FAIL |
| H | Accessibility baseline | PASS/FAIL |
| I | Unrelated project data integrity | PASS/FAIL |
| J | Performance measurements captured | PASS/FAIL |
| K | Required docs + scope audit complete | PASS/FAIL |
| L | Full canonical regression | PASS/FAIL |

---

# 14. Required Closure Report

Create:

```text
docs/implementation/PHASE_03A_FINAL_VERIFICATION_REPORT.md
```

Required sections:

```text
1. Executive Summary
2. Mandatory Viewports
3. Browser Console & Network
4. Legacy Compatibility Surfaces
5. Capability Migration
6. Story Save / Navigation Safety
7. Loading / Empty / Error States
8. UI Language Audit
9. Accessibility Baseline
10. Data Integrity
11. Performance
12. Tests / Full Regression
13. Scope Audit
14. Remaining Risks
15. Final Gate Matrix
16. Final Verdict
```

---

# 15. Final Verdict

Only conclude:

```text
SUBPHASE 3A: PASS / FINAL
READY FOR SUBPHASE 3B REVIEW
```

if every gate above is PASS and no P0/P1 blocker remains.

Otherwise:

```text
SUBPHASE 3A: CONDITIONAL PASS
NOT READY FOR SUBPHASE 3B
```

and list exact blockers.

---

# 16. Stop

After producing the final verification report:

```text
STOP
```

Do NOT start Voice Workbench/Subphase 3B automatically.
