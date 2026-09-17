# UNFOLDIQ — SUBPHASE 3A FINAL MINOR CONSISTENCY & A11Y FIX PROMPT
## Reconcile selective API evidence, Story Navigator keyboard semantics, and performance timing before closing 3A

> **Task type:** TARGETED VERIFY / FIX 3A ONLY
>
> **Current reports:**
> - `docs/implementation/PHASE_03A_IMPLEMENTATION_REPORT.md`
> - `docs/implementation/PHASE_03A_FINAL_VERIFICATION_REPORT.md`
>
> **Current claimed regression:** `491 / 491 PASS`
>
> **Do NOT start Subphase 3B.**
>
> **Do NOT redesign Voice / Visual / Export.**
>
> This is a narrow closure task. Do not reopen completed 3A work unless one of the checks below reveals a real defect.

---

# 1. Gate A — Reconcile the Overview Selective API Contract

## Current inconsistency

The current 3A documentation contains two different routes:

```text
Implementation/source classification:
GET /api/projects/{id}/v2/overview

Browser/network section:
GET /api/projects/{id}/overview
```

Phase 1/3A canonical selective contract is expected to use the actual approved Overview slice endpoint.

## Required action

Inspect:

```text
studio/app.py
studio/static/app.js
studio/project_adapter.py
browser network evidence
tests
```

Determine the **actual runtime route** used by Overview.

### If runtime uses `/api/projects/{id}/v2/overview`

- correct the network audit/report typo;
- update tests/evidence to assert the real path.

### If runtime uses `/api/projects/{id}/overview`

Determine whether it is:

```text
A. an intentional compatibility alias
or
B. an accidental divergence from the canonical Phase 1 contract
```

If it is an intentional alias:
- document both routes and the canonical route;
- frontend should depend on only the canonical route;
- compatibility alias must not become a second source of truth.

If it is accidental:
- migrate 3A Overview to the canonical selective endpoint;
- do not create a new duplicate data model.

## Acceptance

There must be exactly one documented canonical frontend dependency for Overview.

Evidence:

```text
temp/phase03a_minor_closure/api/
├── overview_route_contract.md
└── network_route_verification.json
```

---

# 2. Gate B — Story Navigator `listbox` Keyboard Semantics

## Current implementation claim

The Story Navigator uses:

```html
role="listbox"
role="option"
aria-selected="..."
```

This creates a composite ARIA widget contract.

The final report currently proves Tab order and visible focus, but does not explicitly prove keyboard navigation **inside** the listbox.

## Inspect first

Check how focus is implemented:

```text
roving tabindex
or
aria-activedescendant
or
another valid listbox focus-management model
```

Do not add ARIA attributes mechanically.

## Required keyboard behavior

For the vertical Story Beat list, verify/implement at minimum:

```text
ArrowDown → move focus to next beat
ArrowUp   → move focus to previous beat
```

Because there are 138 options, also implement/verify:

```text
Home → first beat
End  → last beat
```

Selection and `aria-selected` must remain synchronized with the currently selected beat.

### Tab behavior

`Tab` / `Shift+Tab` should move into/out of the composite predictably.

Do not require the user to press Tab 138 times to leave the Story Navigator.

### Alternative

If the component is not intended to behave as a true listbox:
- remove misleading `listbox`/`option` semantics;
- use simpler semantic buttons/list markup with correct keyboard behavior.

Choose semantics that match actual interaction.

## Tests

Add focused browser/DOM tests:

```text
focus Story Navigator
→ ArrowDown
→ selected/focused beat changes

ArrowUp
→ returns correctly

End
→ last beat

Home
→ first beat

Tab
→ leaves composite to the expected next control
```

Evidence:

```text
temp/phase03a_minor_closure/accessibility/
└── story_navigator_keyboard.json
```

---

# 3. Gate C — Performance Measurement Units & Boundaries

## Current report values

```text
App Shell Initial Usable State = 2.511 ms
Overview render                = 1.212 ms
Workbench switch               = 814 ms
Story load/render              = 1.016 ms
Script save round-trip         = 1.203 ms
```

These numbers may be valid, but the timing boundaries are not documented clearly enough to interpret them.

## Required action

Inspect:

```text
temp/phase03a_final_verification/performance/phase03a_measurements.json
measurement code
```

Document for each metric:

```text
clock/API used
start marker
end marker
unit
warm/cold state
whether network time is included
whether DOM render is included
number of runs
```

### Unit rule

If using:

```javascript
performance.now()
```

the raw unit is milliseconds.

Do not accidentally report:

```text
2.511 seconds
```

as:

```text
2.511 ms
```

or vice versa.

## Recommended measurement definitions

Use real existing code/evidence, but normalize definitions approximately as:

### App Shell usable
```text
start: page/app initialization marker
end: shell navigation interactive
```

### Overview render
```text
start: Overview data request / switch action
end: overview DOM committed and usable
```

### Story load
```text
start: Story data request / Workbench activation
end: beats + editor + inspector usable
```

### Workbench switch
```text
start: user navigation activation
end: target Workbench interactive
```

### Save round-trip
```text
start: save action
end: API response accepted + UI state becomes "Đã lưu"
```

Do not invent an SLA.

If the values were mislabeled, correct them and rerun measurements.

Evidence:

```text
temp/phase03a_minor_closure/performance/
├── measurement_methodology.md
└── verified_measurements.json
```

---

# 4. Gate D — Minor Roadmap Wording Consistency

The final report currently contains wording similar to:

```text
Phase 4+ (Engine, Cloud, Scale)
```

This does not match the canonical roadmap.

Normalize to:

```text
Phase 4+ = NOT STARTED
```

or use the actual roadmap phase names.

Do not introduce new "Cloud" scope.

Also normalize Scene/Shot wording in documentation where necessary:

```text
79 Scenes → 79 Cảnh
141 Shots → 141 Cảnh quay
```

Do not change code identifiers.

---

# 5. Regression

If source/tests change:

```bash
pytest --tb=short -q
```

Current baseline:

```text
491 / 491 PASS
0 failed
0 errors
```

Acceptance:

```text
100% canonical collected tests PASS
0 failed
0 errors
```

New focused tests should normally make the collected count `>= 491`.

If only documentation/evidence changes:
- do not invent a new regression count;
- keep 491/491 as the latest runtime baseline.

---

# 6. Scope Audit

Confirm:

```text
3B = NOT STARTED
3C = NOT STARTED
3D = NOT STARTED
Phase 4+ = NOT STARTED
```

No Voice Workbench implementation.

No Visual Workbench redesign.

No Export Workbench redesign.

No Phase 5 virtualization.

No Phase 6 full accessibility hardening.

Never use:

```bash
git clean -fd
```

---

# 7. Required Closure Report

Create:

```text
docs/implementation/PHASE_03A_MINOR_CLOSURE_REPORT.md
```

Required sections:

```text
1. Overview API Contract
2. Story Navigator Keyboard Semantics
3. Performance Measurement Methodology
4. Documentation Wording Sync
5. Regression Status
6. Scope Audit
7. Final Verdict
```

---

# 8. Final Verdict

Only conclude:

```text
SUBPHASE 3A: PASS / FINAL
READY FOR SUBPHASE 3B
```

when:

- [ ] Overview canonical API route is unambiguous and verified.
- [ ] Runtime/network evidence matches the documented route.
- [ ] Story Navigator keyboard interaction matches its ARIA semantics.
- [ ] ArrowUp/ArrowDown behavior is verified.
- [ ] Home/End behavior is verified for the 138-item list.
- [ ] Tab enters/exits the composite predictably.
- [ ] Performance units and boundaries are verified.
- [ ] No misleading Phase 4/Cloud wording remains.
- [ ] Regression remains 100% PASS.
- [ ] No 3B/3C/3D scope leakage exists.

Otherwise:

```text
SUBPHASE 3A: CONDITIONAL PASS
NOT READY FOR SUBPHASE 3B
```

and list exact remaining blockers.

---

# 9. Stop

After producing the report:

```text
STOP
```

Do NOT start Subphase 3B automatically.
