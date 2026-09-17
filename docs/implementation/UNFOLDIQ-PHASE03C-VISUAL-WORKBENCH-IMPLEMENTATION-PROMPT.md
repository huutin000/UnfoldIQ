# UNFOLDIQ — SUBPHASE 3C IMPLEMENTATION PROMPT
## Visual Workbench — Scenes, Shots & Visual Bible
### Sequential Gate 3 of Phase 3

> **Execution authorization**
>
> ```text
> Phase 1 = PASS / FINAL / VERIFIED
> Phase 2 = PASS / FINAL / VERIFIED
> Subphase 3A = PASS / FINAL
> Subphase 3B = PASS / FINAL
> Subphase 3C = READY TO START / NOT STARTED
> Subphase 3D = NOT STARTED
> Phase 4+ = NOT STARTED
> ```
>
> **Current canonical regression before 3C:** `507 / 507 PASS`
>
> **Task:** Implement **ONLY Subphase 3C — Visual Workbench**.
>
> **Do NOT start Subphase 3D.**
>
> **Do NOT implement Phase 4 Media/Asset pipeline.**
>
> **Do NOT implement Phase 7 Render Manifest / Phase 8 Renderer / Phase 9 Render QA.**
>
> **Do NOT automate Google Flow or Veo browser workflows in this task.**
>
> The goal is to consolidate the existing Visual planning workflow into one canonical Workbench for:
>
> ```text
> Scenes
> Shots
> Visual Bible
> Visual Router
> Visual Blueprint
> Image Prompt
> Motion Blueprint
> Veo Motion Prompt
> Approval / Lock / Freshness state
> ```

---

# 0. Mandatory Source-of-Truth Order

Before touching production code, inspect in this order:

```text
1. Current source code
2. docs/implementation/implementation_plan.md
3. docs/implementation/ROADMAP_STATUS.md
4. docs/implementation/PHASE_03A_FINAL_VERIFICATION_REPORT.md
5. docs/implementation/PHASE_03A_MINOR_CLOSURE_REPORT.md
6. docs/implementation/PHASE_03B_FINAL_VERIFICATION_REPORT.md
7. docs/implementation/PHASE_03B_MICRO_CLOSURE_REPORT.md
8. docs/implementation/UI_LANGUAGE_POLICY_FINAL_VERIFICATION_REPORT.md
9. docs/implementation/UI_LANGUAGE_GLOSSARY.md
10. Existing Scene Plan / Visual Bible / Veo Prompt / Visual prompt source
11. Current APIs and ProjectAdapter visual slices
12. Existing frontend/backend/browser tests
13. Existing reference-project evidence
```

Rules:

- Current source is the source of truth for runtime behavior.
- Latest approved implementation plan defines 3C scope.
- Preserve all contracts from Phase 1, Phase 2, 3A and 3B.
- Do not invent endpoint names or schemas before inspecting current source.
- Do not silently rewrite project files merely to simplify UI work.
- Preserve unknown/legacy fields.
- Preserve stable IDs.
- Preserve current manual Flow/Veo production workflow.
- Do not fabricate screenshots, test evidence, asset states, or provider integrations.

---

# 1. Pre-Implementation Gate

## 1.1 Verify roadmap state

Confirm:

```text
Phase 1 = PASS / FINAL
Phase 2 = PASS / FINAL
3A = PASS / FINAL
3B = PASS / FINAL
3C = READY TO START / NOT STARTED
3D = NOT STARTED
Phase 4+ = NOT STARTED
```

If canonical roadmap still temporarily shows 3B `REVIEW PENDING`, synchronize it only after confirming the approved external review outcome.

## 1.2 Git checkpoint

Run:

```bash
git status --short
git branch --show-current
git log -1 --oneline
git tag --list
```

The approved 3B state should be represented by the current committed history.

Create:

```text
pre-phase-3c
```

as a real rollback point containing:

```text
all approved 3A code
+
all approved 3B code
+
0 code from 3C
```

Do not reuse an older Phase 2/3A checkpoint.

Never use:

```bash
git clean -fd
```

## 1.3 Baseline regression

Run:

```bash
pytest --tb=short -q
```

Canonical reference:

```text
507 / 507 PASS
0 failed
0 errors
```

Any unexplained decrease below 507 is a blocker.

## 1.4 Capture current Visual capabilities

Before redesigning the UI, audit all current capabilities related to:

```text
Scene Plan
Scenes
Shots
Visual Bible
Characters
Environments
Objects
Styles
Image prompts
Negative prompts
Motion prompts
Veo prompts
Reference assets
Scene/shot statuses
Generate/copy prompt actions
Approval
Locking
Regeneration
Outdated detection
Visual QA / Editorial visual issues if present
Asset linking if present
Production export of visual prompts if present
```

Capture:
- browser screenshots;
- current DOM surfaces/modals/tabs;
- actual API calls;
- file/data sources;
- actions and confirmations;
- keyboard behavior;
- current capability gaps.

Create the capability migration matrix before removing any legacy surface.

---

# 2. Subphase 3C Objective

Build the canonical **Visual Workbench** around:

```text
SCENE NAVIGATOR
+
SHOT WORKSPACE
+
VISUAL BIBLE / PROMPT INSPECTOR
```

Target user flow:

```text
Scene
→ Shot
→ Visual type / route
→ Visual Blueprint
→ Visual Bible bindings
→ Image Prompt / Start Frame plan
→ Review / Approve / Lock
→ Motion Blueprint
→ Veo Motion Prompt
→ Manual external generation
→ Link/import result when existing workflow supports it
```

The Workbench must let the user quickly answer:

```text
Cảnh nào đang làm?
Cảnh này có bao nhiêu cảnh quay?
Cảnh quay đang dùng loại hình ảnh nào?
Nhân vật/bối cảnh/vật thể nào được bind?
Prompt hình ảnh đã sẵn sàng chưa?
Ảnh/start frame đã được duyệt chưa?
Motion prompt đã đúng với Scene Plan chưa?
Cảnh quay nào bị OUTDATED?
Cảnh quay nào bị BLOCKED?
Cảnh quay nào đã LOCK?
Cảnh quay nào cần thao tác tiếp theo?
```

---

# 3. Canonical Visual Mental Model

## 3.1 Scene vs Shot

Preserve the approved model:

```text
Scene
→ narrative / semantic production unit

Shot
→ final visual/motion unit inside a Scene
```

Do NOT assume:

```text
1 Scene = exactly 1 Shot
```

The real reference project currently contains approximately:

```text
79 Scenes
141 Shots
```

Use actual project data at runtime; never hardcode these values.

A Scene may contain:

```text
1 Shot
or
multiple Shots
```

if the visual beats require splitting.

## 3.2 Generated candidates are not Shots

Do not treat image generations as extra Shots.

Correct distinction:

```text
Shot
→ one production visual unit

Candidate images
→ alternate generated options for the same Shot
```

Example:

```text
Shot 014
├── candidate A
├── candidate B
├── candidate C
└── approved candidate
```

Do not inflate Scene/Shot counts based on number of generated candidates.

---

# 4. Core Visual Workbench Layout

Target architecture:

```text
┌────────────────────┬──────────────────────────────────┬──────────────────────┐
│ Scene Navigator    │ Shot Workspace                   │ Inspector            │
│                    │                                  │                      │
│ Scenes             │ Shot Cards / selected Shot       │ Visual Bible         │
│ Shot hierarchy     │ Visual Blueprint                 │ Bindings             │
│ Filters/status     │ Image / Motion prompt            │ Status / Lock        │
│ Search             │ External generation handoff      │ Dependencies         │
└────────────────────┴──────────────────────────────────┴──────────────────────┘
```

Reuse the 5-Workbench App Shell established in 3A.

Do not introduce a second app shell.

---

# 5. Vietnamese-First UI Contract

All new/touched user-facing UI:

```text
Vietnamese-first
```

Internal identifiers remain English.

Recommended canonical labels:

```text
Visual Workbench      → Hình ảnh & Cảnh
Scene                 → Cảnh
Shot                  → Cảnh quay
Visual Bible          → Visual Bible
Visual Blueprint      → Bản thiết kế hình ảnh
Motion Blueprint      → Bản thiết kế chuyển động
Image Prompt          → Prompt hình ảnh
Motion Prompt         → Prompt chuyển động
Negative Prompt       → Prompt phủ định
Reference             → Tài nguyên tham chiếu
Binding               → Liên kết
Approve               → Duyệt
Reject                → Từ chối
Lock                  → Khóa
Unlock                → Mở khóa
Regenerate            → Tạo lại
Copy Prompt           → Sao chép prompt
Open Reference        → Xem tham chiếu
```

Keep canonical technical/product terms where clarity is higher:

```text
Visual Bible
Flow
Veo
FFmpeg
JSON
WebP
MP4
```

Do not translate Scene/Shot data content itself if it is authored in another language.

---

# 6. Visual Router — Deterministic Planning Layer

Visual Router must remain a planning decision layer, not an automatic generative engine.

Canonical route categories:

```text
CHARACTER_SCENE
ENVIRONMENT
EVIDENCE
TIMELINE
COMPARISON
PROGRAMMATIC
STATIC_IMAGE
DIRECT_VIDEO
```

Use the actual enums/source values that exist in the project.

Do not invent or rename persisted enum values blindly.

## Default routing concept

Where consistent with current approved workflow:

```text
CHARACTER_SCENE
→ Flow image/start frame
→ approve/lock
→ Motion Blueprint
→ Veo motion prompt
→ manual Veo/Flow animation

ENVIRONMENT
→ image / static / direct video depending on planned motion

EVIDENCE
→ usually STATIC_IMAGE

TIMELINE / COMPARISON
→ programmatic/static composition
```

Not every Shot requires Veo.

Do not default every Shot to generated video.

---

# 7. Visual Blueprint vs Motion Blueprint

These must remain separate concepts.

## Visual Blueprint

Answers:

```text
What should the frame look like?
```

May include, where the current schema supports them:

```text
subject
characters
environment
objects
composition
camera framing
camera angle
lighting
time of day
palette
wardrobe
continuity notes
visual style
negative constraints
reference bindings
```

## Motion Blueprint

Answers:

```text
What moves over time?
```

May include:

```text
subject motion
camera motion
environment motion
timing
pace
entry/exit
continuity
motion constraints
```

Do NOT mix motion instructions into the canonical image/start-frame prompt unless the current provider prompt specifically requires minimal motion context.

Do NOT duplicate the full Visual Blueprint into the Motion Blueprint.

---

# 8. Google Flow / Veo Production Boundary

The approved production model is manual/provider-assisted:

```text
UnfoldIQ
→ plans and prepares prompts/references

Google Flow
→ image/start-frame generation

Veo / Flow video
→ motion generation

User
→ reviews/downloads external result

UnfoldIQ
→ links/imports output through existing workflow
```

## Non-negotiable 3C rule

Do NOT automate:

```text
Google login
Flow browser clicking
Veo browser clicking
automatic paid generation
automatic provider spend
```

unless such integration already exists and is explicitly part of the canonical plan.

3C should prepare the user to work efficiently with manual Flow/Veo.

Useful actions:

```text
Sao chép prompt hình ảnh
Sao chép prompt chuyển động
Sao chép prompt phủ định
Xem danh sách tham chiếu
Xem tài nguyên cần dùng
Đánh dấu đã tạo bên ngoài
Liên kết kết quả
```

only where supported by the current architecture.

---

# 9. Visual Bible — Canonical Entity Library

Preserve the approved hierarchy:

```text
Global Canonical Library
→ Project Visual Bible
→ Scene / Shot Bindings
```

Visual Bible categories may include:

```text
Characters
Environments
Objects
Styles
Media
```

Use actual persisted categories from source.

Do not build collaboration/team library features.

This product remains:

```text
solo-first
local-first
```

---

# 10. Character Reference Contract

One character must remain one canonical entity.

Reference views such as:

```text
FRONT
THREE_QUARTER
PROFILE
FULL_BODY
```

are reference views of the **same character**.

They are NOT four separate characters.

## Canonical workflow

```text
Character
→ canonical reference pack
→ approve
→ lock
→ reuse across Scenes/Shots
```

Do not require the user to manually select a reference angle for every Shot in normal mode.

The system/provider adapter should select compatible reference assets where existing architecture supports it.

Allow explicit manual override only as an advanced action if the current design supports it.

---

# 11. Google Flow Reference / Ingredient Handoff

Flow supports using uploaded image/video references ("ingredients") for consistent characters and key objects across clips.

3C should therefore be able to show, for a selected Shot:

```text
Required references
Character references
Environment references
Object references
```

and prepare a compact handoff package/checklist.

Do not claim that UnfoldIQ has uploaded those assets into Flow unless the user actually did so.

Do not automatically upload to Google Flow in 3C.

---

# 12. Visual Bible Variant Lifecycle

Preserve the approved lifecycle where supported:

```text
GENERATED
→ SELECTED
→ APPROVED
→ LOCKED
```

and:

```text
REJECTED
```

when applicable.

Use actual existing enum names/source contracts.

Important distinction:

```text
Approval status
≠
Freshness status
```

An asset may be:

```text
APPROVED / LOCKED
and
OUTDATED
```

if upstream inputs changed.

Lock prevents silent overwrite.

Lock does not make stale content current.

---

# 13. Scene Navigator

Scene Navigator should let the user move efficiently across the project hierarchy.

At minimum display:

```text
Scene identifier / title
Shot count
Scene status
Blocker indicator
Outdated indicator
Lock indicator if applicable
```

Expandable Scene → Shot hierarchy is acceptable.

## Stable identity

Persistent selection must use:

```text
scene_id
shot_id
```

Never:

```text
array index
DOM position
visible ordinal
```

Test:

```text
select Shot by shot_id
→ reorder/insert neighboring Shot
→ selected Shot still resolves correctly
```

## Search/filter

Where useful:

```text
Tất cả
Cần cập nhật
Bị chặn
Cần kiểm tra
Sẵn sàng
Đã khóa
Thiếu prompt
Thiếu tham chiếu
```

Do not expose raw enum labels in normal UI.

---

# 14. Scene Navigator Accessibility

Choose semantics matching actual interaction.

## Preferred simple approach

If Scene groups only need expand/collapse + clickable Shots:

```text
semantic list
+
buttons/disclosure controls
```

may be simpler and safer than forcing ARIA tree semantics.

## If using `role="tree"`

Implement full tree keyboard behavior, including:

```text
ArrowDown → next visible node
ArrowUp   → previous visible node

ArrowRight
→ expand closed parent
→ or move to first child

ArrowLeft
→ collapse open parent
→ or move to parent

Home → first visible node
End  → last visible node

Enter / Space
→ select/activate as designed
```

Tab should enter/exit the composite predictably.

Do not use `role="tree"` merely for styling.

---

# 15. Shot Workspace

The selected Shot is the main working unit.

A Shot Card / selected-Shot workspace should expose only information useful for production.

At minimum:

```text
Shot ID
Scene context
Duration / timing if available
Visual route/type
Visual Blueprint status
Image prompt
Negative prompt
Visual Bible bindings
Start-frame/image approval state
Motion Blueprint
Motion/Veo prompt
Effective status
Lock state
Next action
```

Do not overload each card with the entire project schema.

Use progressive disclosure for advanced data.

---

# 16. Shot Timing

Shot timing must come from canonical project data.

Do not invent or freely edit final render timing in 3C.

3C may display:

```text
start
end
duration
source cue relation
```

if already part of Scene Plan / timing artifacts.

Final frame-accurate Render Manifest remains Phase 7.

Timeline Editor remains future scope.

---

# 17. Image Prompt Editing

Image prompt UI must clearly distinguish:

```text
generated/suggested prompt
user-edited prompt
approved prompt
outdated prompt
```

## User control

Do not automatically overwrite an edited prompt because upstream data changed.

Use:

```text
OUTDATED
```

and offer explicit action:

```text
Tạo lại prompt
```

or equivalent.

## Lock

If prompt/artifact is locked:

```text
view/copy = allowed
automatic overwrite = prohibited
```

If locked prompt becomes outdated:

```text
Đã khóa
+
Cần cập nhật
```

must both remain visible.

---

# 18. Motion / Veo Prompt Editing

The previously approved product decision is:

```text
Veo prompt
→ describes motion

Scene Plan / Visual Blueprint
→ describes image/start frame
```

Do not collapse these back into one generic prompt.

For each Shot requiring motion:

```text
approved visual/start frame
→ Motion Blueprint
→ Veo motion prompt
```

The prompt should match the Scene Plan/Shot intent.

Do not ask Veo to redesign the whole image if the approved start frame already defines it.

---

# 19. Prompt Freshness & Dependency Engine

Use Phase 2 DAG/freshness semantics.

Examples:

```text
Visual Bible character changes
→ affected Shot prompts may become OUTDATED

Shot visual blueprint changes
→ image prompt becomes OUTDATED
→ motion prompt may become OUTDATED if dependent

Approved image/start frame changes
→ motion prompt may become OUTDATED
```

Do not invalidate the whole project if dependency scope is narrower.

Do not regenerate automatically.

Correct behavior:

```text
upstream committed input changes
→ mark affected dependent artifact OUTDATED
→ user chooses regenerate/review
```

---

# 20. Transactional Regeneration

For prompt generation/replacement:

```text
existing committed prompt remains valid
→ generate candidate
→ generation fails
→ keep old committed prompt
```

Only after:

```text
generation succeeds
→ validation succeeds
→ explicit commit/apply
```

may the canonical prompt hash/change propagate downstream.

Do not mark downstream stale merely because a candidate generation job started.

This must remain consistent with Phase 2 transactional invalidation.

---

# 21. Generative AI Is Explicitly User-Triggered

Expensive or generative actions:

```text
Generate Visual Blueprint
Generate Image Prompt
Regenerate Prompt
Generate Motion Blueprint
Generate Veo Prompt
```

must be explicit user actions.

Do not trigger generative calls merely because:

```text
Shot selected
Inspector opened
Scene expanded
status = OUTDATED
page loaded
```

Deterministic derivations may update automatically.

Generative/paid work must not.

---

# 22. Visual Bible Bindings

For selected Scene/Shot, Inspector should show actual entity bindings:

```text
Characters
Environments
Objects
Styles
Reference media
```

Bind by stable entity ID.

Never persist only:

```text
display name
array index
DOM element ID
```

If a canonical entity is renamed:

```text
binding remains intact
```

If entity is deleted:

```text
dependent Shot becomes BLOCKED / missing reference
```

according to current contract.

---

# 23. Binding Inspector UX

For each binding show where supported:

```text
entity name
entity type
canonical ID
approval/lock state
thumbnail/reference preview
source scope
```

Actions:

```text
Xem
Thay đổi liên kết
Gỡ liên kết
```

only if supported.

Do not allow destructive entity deletion from Shot context without existing safe contract.

---

# 24. Visual Bible Entity Editing

3C may consolidate existing Visual Bible editing.

Do not expand into a full Digital Asset Management system.

Allowed only where capability exists:

```text
edit entity metadata
manage reference views
approve
reject
lock
unlock
select canonical variant
```

Phase 4 owns broader:

```text
asset registry expansion
thumbnail pipeline
proxy generation
portable package
```

---

# 25. Reference Assets

3C may display/use current reference assets.

Do not implement Phase 4 media processing.

Allowed:

```text
show existing reference
link existing reference
view metadata
copy handoff list
```

Out of scope:

```text
generate thumbnails architecture
proxy transcoding architecture
full media registry rewrite
portable asset package
```

---

# 26. Candidate Image Lifecycle

If current project already tracks generated candidates, preserve that capability.

Do not confuse:

```text
candidate
selected
approved
locked
```

Suggested UX:

```text
Candidates
→ Select
→ Approve
→ Lock
```

Do not auto-lock merely because a candidate is selected.

Do not auto-delete rejected candidates unless current product explicitly does so.

---

# 27. Approval and Lock Semantics

Consequential actions should be explicit.

Examples:

```text
Duyệt
Từ chối
Khóa
Mở khóa
```

Lock rules:

```text
locked item
→ cannot be auto-replaced
→ can become OUTDATED
→ can still be viewed/copied/exported
```

If unlock is needed before replacement, tell the user why.

Do not silently unlock.

---

# 28. Next Best Action

Use the deterministic Phase 2 Next Best Action model where applicable.

Examples:

```text
Shot thiếu Visual Bible binding
→ next action may be bind reference

Shot image prompt OUTDATED
→ next action may be review/regenerate prompt

Shot requires motion but no approved start frame
→ motion generation should remain BLOCKED
```

Do not use an LLM merely to decide the next action.

---

# 29. Blockers

Visual Workbench should make blockers obvious.

Examples:

```text
Missing required character reference
Missing environment binding
Visual Blueprint incomplete
Image prompt missing
Approved start frame missing
Motion prompt depends on outdated image
Locked artifact requires manual decision
```

Do not treat warnings as blockers unless the canonical rule says so.

---

# 30. Image / Motion Readiness

Define readiness from actual project state.

Do not invent one global “READY” toggle.

A Shot may have separate readiness:

```text
Visual Blueprint
Image Prompt
Image / Start Frame
Motion Blueprint
Veo Prompt
```

Surface dependencies.

Example:

```text
Image Prompt = READY
Approved Image = MISSING
Motion Prompt = BLOCKED
```

is valid.

---

# 31. Manual Flow Handoff

For Shots routed to Flow image generation, provide a compact handoff surface where existing data supports it:

```text
Prompt hình ảnh
Prompt phủ định
Character references
Environment references
Object references
Style references
Aspect ratio if canonical
Shot ID
```

Actions may include:

```text
Sao chép prompt
Sao chép danh sách tham chiếu
```

Do not claim prompt has been generated externally.

Optionally allow the user to mark:

```text
Đã gửi sang Flow
```

only if a real state already exists or is clearly modeled as user workflow state.

Do not invent external synchronization.

---

# 32. Manual Veo Handoff

For motion-ready Shots:

```text
Shot
→ approved start frame/reference
→ Motion Blueprint
→ motion prompt
```

Provide:

```text
Sao chép prompt chuyển động
Xem start frame
Xem tham chiếu
```

Do not generate final video in UnfoldIQ during 3C.

Do not implement Phase 8 renderer.

---

# 33. Visual Output Linking

If current system already supports linking/importing generated image/video outputs, preserve it.

Use actual asset/reference contracts.

Do not expand into the Phase 4 asset registry.

When linking a result, preserve:

```text
shot_id
source/provider metadata if available
file reference
approval state
hash/freshness metadata where existing
```

Do not fabricate provider provenance.

---

# 34. Provider Abstraction

If the project has existing visual prompt/provider abstractions, preserve them.

Do not hardwire business logic to:

```text
Flow only
Veo only
```

at the domain layer.

UI can show:

```text
Flow
Veo
```

as the user's current preferred tools, but canonical Shot planning should remain provider-tolerant.

---

# 35. Existing Visual Data Contract

Inspect current Phase 1 selective APIs.

Expected conceptual endpoints may include:

```text
GET /api/projects/{id}/visual/summary
GET /api/projects/{id}/visual/scenes
GET /api/projects/{id}/visual/scenes/{scene_id}
GET /api/projects/{id}/visual/shots/{shot_id}
GET /api/projects/{id}/visual/bible
```

These routes were part of the Phase 1 architecture, but **verify actual current source before using them**.

Do not create a new:

```text
/api/projects/{id}/visual/all
```

monolithic dependency just to simplify frontend work.

Use selective loading:

```text
Scene list
→ scene summary

select Scene
→ scene detail

select Shot
→ shot detail

open Bible inspector
→ Visual Bible slice
```

---

# 36. Scene / Shot Mutation Contract

All mutations must be stable-ID based:

```text
scene_id
shot_id
entity_id
artifact_id
```

Do not use:

```text
scene index
shot index
row number
```

as persistent mutation identity.

Legacy positional routes may remain compatibility aliases only if they resolve safely to stable IDs.

---

# 37. Search / Filtering

Search/filter is deterministic UI behavior.

Useful filters:

```text
Scene name / ID
Shot ID
Character
Status
Route/type
Locked
Outdated
Blocked
Missing reference
Missing prompt
```

Do not send an LLM request for search/filter.

For 79 Scenes / 141 Shots, measure before adding virtualization.

Phase 5 owns evidence-based virtualization.

---

# 38. Performance Boundary

Do not prematurely implement Phase 5.

Measure:

```text
Visual Workbench initial load
Scene Navigator render
Scene selection
Shot selection
Visual Bible Inspector load
Prompt edit/save
status/filter update
```

For the current reference scale:

```text
~79 Scenes
~141 Shots
```

normal DOM may be adequate.

Do not add virtual scrolling merely because a list exists.

If measured performance is unacceptable, document evidence and implement only the smallest necessary optimization.

---

# 39. Browser State

Workbench switching:

```text
Hình ảnh & Cảnh
→ Tổng quan
→ Kịch bản
→ Giọng đọc
→ Hình ảnh & Cảnh
```

must not silently discard unsaved Visual edits.

Use the existing working-state/dirty-state architecture established in 3A/3B.

At minimum distinguish:

```text
Đã lưu
Chưa lưu
```

where editing exists.

Do not silently autosave generative prompt replacement unless current architecture explicitly does so.

---

# 40. Loading / Empty / Error States

Every 3C primary surface needs clear states.

## Loading

Examples:

```text
Đang tải danh sách cảnh...
Đang tải cảnh quay...
Đang tải Visual Bible...
```

## Empty

Examples:

```text
Cảnh này chưa có cảnh quay.
Chưa có liên kết Visual Bible.
Chưa có prompt hình ảnh.
Chưa có prompt chuyển động.
```

## Error

Must tell the user:
- what failed;
- what remains safe;
- what to do next.

Example:

```text
Không thể tạo lại prompt hình ảnh.
Prompt đã duyệt trước đó vẫn được giữ nguyên.
Thử lại
```

Do not show only:

```text
500
UNKNOWN_ERROR
Fetch failed
```

---

# 41. Confirmation Rules

Require confirmation for consequential actions:

```text
replace approved prompt
unlock approved asset
reject approved candidate
delete binding with downstream impact
bulk regenerate visual prompts
restore revision
```

Do not ask confirmation for:

```text
select Scene
select Shot
expand Scene
filter
copy prompt
view reference
```

---

# 42. Revision Integration

Use the Phase 2 revision system.

Do not invent a second visual history mechanism.

Do not create revisions for:

```text
selecting
expanding
filtering
copying prompt
viewing reference
```

Persisted committed edits may create checkpoints according to the existing contract.

Restore must respect:

```text
lock
conflict
stable IDs
```

---

# 43. Capability Migration Map — MUST PASS

Audit actual old Visual surfaces first.

Do not assume legacy DOM IDs.

Create:

| Old surface | Capability | New Visual Workbench surface | Same data/API? | Action preserved? | Result |
|---|---|---|---|---|---|

At minimum inspect migration for existing capabilities around:

```text
Scene Plan
Scene list
Shot list
Visual Bible
Visual prompts
Veo prompts
reference assets
approval/lock
prompt copy/export
visual readiness
```

No capability may silently disappear.

---

# 44. Preserve 3A and 3B

Regression workflows:

## 3A

```text
Tổng quan
Kịch bản
Next Best Action
Story dirty state
Story save
```

must still work.

## 3B

```text
Giọng đọc
audio playback
chunk selection
word cues
Voice QA
Pronunciation
TTS/STT controls
```

must still work.

Do not break canonical:

```text
/v2/overview
/v2/voice
```

frontend dependencies.

---

# 45. 3D Compatibility

`Xuất video` remains a compatibility surface until 3D.

Do not redesign it in 3C.

It must remain reachable.

If visual changes make export prerequisites stale:

```text
show correct Phase 2 status
```

but do not implement 3D preflight UI.

---

# 46. Accessibility Baseline

Full WCAG hardening remains Phase 6.

3C must nevertheless avoid obvious debt.

Required:

- visible focus;
- semantic buttons;
- native form labels;
- selected Scene/Shot state exposed accessibly;
- status is not color-only;
- icon-only controls have Vietnamese accessible names;
- no keyboard trap;
- no hundreds of unnecessary Tab stops;
- expandable hierarchy has coherent keyboard semantics;
- tooltips are not the only source of essential information.

Do not claim full WCAG 2.2 AA conformance.

---

# 47. Mandatory Viewports

Validate:

```text
1920x1080
1440x900
1366x768
```

At minimum verify:

```text
Scene Navigator usable
Shot Workspace usable
Inspector reachable
prompt editor not clipped
primary actions visible
no unintended horizontal page overflow
```

Full responsive architecture remains Phase 6.

---

# 48. Browser Validation Workflow

Use the real running application and the real reference project.

Required workflow:

```text
Open project
→ Hình ảnh & Cảnh
→ inspect Scene Navigator
→ select Scene
→ select Shot by stable shot_id
→ inspect Visual route/type
→ inspect Visual Blueprint
→ inspect Visual Bible bindings
→ edit a safe prompt in isolated fixture/working state
→ verify Chưa lưu
→ navigate away/back
→ verify no silent loss
→ save
→ inspect freshness/status
→ copy image prompt
→ inspect Motion Blueprint
→ copy motion/Veo prompt
→ inspect lock/approval state
→ inspect Next Action
→ return Tổng quan
→ return Kịch bản
→ return Giọng đọc
→ return Hình ảnh & Cảnh
→ open Xuất video compatibility
```

Record:

```text
console errors
unhandled promise rejections
failed requests
obvious duplicate requests
stale UI
selection mismatch
```

Expected:

```text
unexpected console errors = 0
unexpected failed API requests = 0
```

---

# 49. Flow/Veo Handoff Verification

Without invoking paid generation, verify that for a representative Shot the Workbench can prepare the information needed by the manual production workflow.

## Character Shot

Verify handoff includes where applicable:

```text
image prompt
negative prompt
character references
environment reference
object references
Shot ID
```

## Motion Shot

Verify handoff includes:

```text
approved/start image context
Motion Blueprint
motion/Veo prompt
Shot ID
```

Do not claim the external asset exists unless it actually exists.

---

# 50. Data Integrity Gate

Compare before/after on the reference project.

Verify:

```text
Script
Story Beats
Audio Chunks
Voice settings
Master audio
Transcript
Timestamps
Word cues
Pronunciation
Voice QA
Scenes
Shots
Scene/Shot stable IDs
Scene → Shot hierarchy
Visual Bible
Characters
Environments
Objects
Styles
Image prompts
Negative prompts
Motion/Veo prompts
Visual references
Asset references
Approval states
Lock states
Project settings
state.db
Revision history
unknown/legacy fields
```

Expected:

```text
0 unintended semantic differences
```

Use isolated fixtures for intentional mutations.

Do not destroy production/reference data to test the UI.

---

# 51. Focused Test Requirements

## 51.1 Visual selective API

- [ ] canonical scene summary route works;
- [ ] scene detail uses `scene_id`;
- [ ] shot detail uses `shot_id`;
- [ ] Visual Bible is selectively loaded;
- [ ] no monolithic state dependency introduced.

## 51.2 Scene Navigator

- [ ] all reference Scenes render;
- [ ] Scene → Shot hierarchy correct;
- [ ] selected Scene uses stable ID;
- [ ] selected Shot uses stable ID;
- [ ] reorder/insert does not break selection identity;
- [ ] filters preserve correct identity.

## 51.3 Accessibility

If using tree semantics:

- [ ] Up/Down;
- [ ] Left/Right;
- [ ] Home/End;
- [ ] Enter/Space as designed;
- [ ] Tab exits composite predictably.

If using disclosure/list semantics:
- [ ] native button behavior;
- [ ] expand/collapse state exposed;
- [ ] Shot actions keyboard accessible.

## 51.4 Visual Bible

- [ ] bind by entity ID;
- [ ] rename entity does not break binding;
- [ ] missing/deleted binding yields correct blocker;
- [ ] reference pack is not duplicated as multiple character entities;
- [ ] approved/locked state preserved.

## 51.5 Prompts

- [ ] edit/save Image Prompt;
- [ ] edit/save Motion Prompt;
- [ ] Image and Motion prompts remain separate;
- [ ] upstream change marks only dependent prompts OUTDATED;
- [ ] locked prompt not auto-overwritten;
- [ ] failed regeneration preserves committed prompt;
- [ ] generative action is explicit.

## 51.6 Approval/lock

- [ ] APPROVED and OUTDATED can coexist where applicable;
- [ ] LOCKED and OUTDATED can coexist;
- [ ] unlock is explicit;
- [ ] locked asset/prompt cannot be silently replaced.

## 51.7 Flow/Veo handoff

- [ ] copy image prompt works;
- [ ] copy motion prompt works;
- [ ] reference list matches actual Shot bindings;
- [ ] no automatic provider invocation occurs.

## 51.8 3A/3B regression

- [ ] Overview works;
- [ ] Story works;
- [ ] Voice works;
- [ ] Export compatibility still reachable.

## 51.9 Language

- [ ] UI Vietnamese-first;
- [ ] `READY`, `OUTDATED`, `BLOCKED`, etc. not exposed raw;
- [ ] Scene/Shot authored content language preserved;
- [ ] Flow/Veo proper names preserved.

---

# 52. Performance Measurements

Record methodology and observed values for:

```text
Visual Workbench initial usable state
Scene list render
Scene switch
Shot switch
Visual Bible Inspector load
Prompt edit/save
filter/search update
```

For each metric record:

```text
clock
start boundary
end boundary
warm/cold state
network included?
DOM included?
number of runs
median
p95 if enough samples
```

Do not invent performance targets.

Do not automatically add virtualization.

---

# 53. Required Evidence Directory

Create:

```text
temp/phase03c_validation/
├── baseline/
│   ├── pytest_summary.json
│   └── screenshots/
├── capability_migration/
│   └── visual_migration_matrix.md
├── api/
│   ├── visual_route_contract.md
│   └── network_results.json
├── scene_navigator/
│   ├── scene_selection_results.json
│   ├── shot_selection_results.json
│   └── keyboard_results.json
├── shot_workspace/
│   ├── shot_workspace_results.json
│   └── screenshots/
├── visual_router/
│   └── routing_results.json
├── visual_blueprint/
│   └── blueprint_results.json
├── motion_blueprint/
│   └── motion_results.json
├── prompts/
│   ├── image_prompt_results.json
│   ├── motion_prompt_results.json
│   └── transactional_regeneration.json
├── visual_bible/
│   ├── entity_binding_results.json
│   ├── reference_pack_results.json
│   └── screenshots/
├── approval_lock/
│   └── lifecycle_results.json
├── freshness/
│   └── dependency_invalidation_results.json
├── flow_handoff/
│   └── image_handoff_results.json
├── veo_handoff/
│   └── motion_handoff_results.json
├── states/
│   ├── loading_empty_error_results.json
│   └── screenshots/
├── language/
│   └── ui_language_audit.md
├── accessibility/
│   └── baseline_a11y_checklist.md
├── responsive/
│   ├── 1920x1080.png
│   ├── 1440x900.png
│   ├── 1366x768.png
│   └── viewport_results.json
├── browser/
│   ├── console_results.json
│   └── network_results.json
├── performance/
│   ├── methodology.md
│   └── measurements.json
├── integrity/
│   ├── semantic_diff.json
│   └── integrity_matrix.md
├── regression/
│   ├── pytest_full.log
│   └── pytest_summary.json
└── scope/
    └── git_diff_review.md
```

Do not fabricate missing evidence.

---

# 54. Required Technical Documentation

Create:

```text
docs/implementation/PHASE_03C_VISUAL_WORKBENCH.md
```

Required sections:

```text
Scope
Out of scope
Visual Workbench layout
Scene / Shot identity
Visual selective API contract
Scene Navigator
Shot Workspace
Visual Router
Visual Blueprint
Motion Blueprint
Image Prompt
Motion / Veo Prompt
Visual Bible architecture
Entity bindings
Character reference packs
Candidate lifecycle
Approval / Lock
Freshness / Dependency semantics
Flow handoff
Veo handoff
Transactional regeneration
UI language contract
Accessibility baseline
Responsive boundary
Performance boundary
Capability migration
Tests
Rollback
Acceptance criteria
```

---

# 55. Required Implementation Report

Create:

```text
docs/implementation/PHASE_03C_IMPLEMENTATION_REPORT.md
```

Required sections:

## 1. Executive Summary

```text
Subphase 3C status:
Implementation result:
Full regression:
Final gate verdict:
```

## 2. Baseline / Git Checkpoint

## 3. Files Changed

Classify:

```text
3C source
3C tests
3C docs/evidence
unexpected/out-of-scope
```

## 4. Capability Migration

## 5. Visual Workbench Architecture

```text
Scene Navigator
Shot Workspace
Inspector
```

## 6. Scene / Shot Stable Identity

## 7. Selective API Contract

## 8. Visual Router

## 9. Visual Blueprint

## 10. Motion Blueprint

## 11. Image Prompt

## 12. Motion / Veo Prompt

## 13. Visual Bible

## 14. Character / Environment / Object Bindings

## 15. Approval / Lock / Candidate Lifecycle

## 16. Freshness / Dependency Invalidation

## 17. Flow Handoff

## 18. Veo Handoff

## 19. Vietnamese-First Language Audit

## 20. Accessibility Baseline

Do not claim full WCAG conformance.

## 21. Browser / Viewport Validation

## 22. Performance

## 23. Data Integrity

## 24. Full Regression

Report:

```text
Collected
Passed
Failed
Skipped
Errors
Warnings
Duration
Exit code
```

## 25. Scope Audit

Confirm:

```text
3D = NOT STARTED
Phase 4+ = NOT STARTED
Phase 7–9 = FUTURE / NOT STARTED
Localization/Multi-language = NOT STARTED
```

## 26. Remaining Risks

Only real residual risks.

## 27. Final Verdict

Only one:

```text
PASS / FINAL — READY FOR SUBPHASE 3D REVIEW
CONDITIONAL PASS — NOT READY FOR SUBPHASE 3D
FAIL — NOT READY FOR SUBPHASE 3D
```

---

# 56. Full Regression Gate

After implementation:

```bash
pytest --tb=short -q
```

Baseline before 3C:

```text
507 tests PASS
```

Acceptance:

```text
100% canonical collected tests PASS
0 failed
0 errors
```

New 3C tests should normally increase the collected count.

Any unexplained decrease below 507 is a blocker.

---

# 57. Subphase 3C Acceptance Gate

3C may be marked `PASS / FINAL` only if ALL are true:

- [ ] Phase 1/2/3A/3B contracts remain intact.
- [ ] Full canonical regression PASS.
- [ ] `pre-phase-3c` is a valid rollback checkpoint of approved 3B final state.
- [ ] Visual Workbench becomes the canonical Visual user path.
- [ ] Existing Visual capabilities migrate without unintended loss.
- [ ] Scene selection uses stable `scene_id`.
- [ ] Shot selection/mutation uses stable `shot_id`.
- [ ] No canonical mutation depends on array position.
- [ ] Scene → Shot hierarchy is correct.
- [ ] Scene and Shot remain distinct concepts.
- [ ] Candidate images are not mis-modeled as Shots.
- [ ] Visual Router is deterministic and uses actual canonical types.
- [ ] Visual Blueprint and Motion Blueprint remain separate.
- [ ] Image Prompt and Motion/Veo Prompt remain separate.
- [ ] Motion prompt matches the approved Scene/Shot intent.
- [ ] Not every Shot is forced through Veo.
- [ ] Visual Bible is canonical and entity-ID based.
- [ ] Character reference views remain one canonical character.
- [ ] Scene/Shot bindings survive entity rename.
- [ ] Missing required bindings produce an explicit blocker.
- [ ] Approval state is distinct from freshness state.
- [ ] LOCKED + OUTDATED can coexist.
- [ ] Locked visual artifacts/prompts are not silently overwritten.
- [ ] Prompt generation/regeneration is explicitly user-triggered.
- [ ] Failed prompt regeneration preserves prior committed prompt.
- [ ] Downstream invalidation happens only after committed upstream change.
- [ ] Dependency invalidation is selective.
- [ ] Flow image handoff is practical and uses actual references.
- [ ] Veo motion handoff is practical and uses the approved start-frame context.
- [ ] No automatic Google Flow/Veo generation/spend was introduced.
- [ ] No automatic login/browser automation was introduced.
- [ ] Existing linked visual output behavior remains functional where supported.
- [ ] UI is Vietnamese-first.
- [ ] Technical proper nouns remain accurate.
- [ ] Loading/empty/error states PASS.
- [ ] Accessibility baseline PASS.
- [ ] Mandatory workstation viewports PASS.
- [ ] Browser console/network validation PASS.
- [ ] Performance evidence captured honestly.
- [ ] Data integrity PASS.
- [ ] 3A Overview/Story remain functional.
- [ ] 3B Voice remains functional.
- [ ] Export compatibility remains reachable.
- [ ] 3D NOT STARTED.
- [ ] Phase 4+ NOT STARTED.
- [ ] Phase 7–9 NOT STARTED.
- [ ] No P0/P1 blocker remains.

---

# 58. Out of Scope — DO NOT IMPLEMENT

## Subphase 3D

Do not implement:

```text
final Export Workbench redesign
full preflight UI
final render trigger architecture
final package download center
```

## Phase 4

Do not implement:

```text
thumbnail WebP generation architecture
proxy 720p pipeline
full asset registry redesign
portable package pipeline redesign
```

## Phase 5

Do not implement:

```text
general virtualization system
Command Palette
full UI primitive consolidation
```

## Phase 6

Do not implement:

```text
full responsive architecture
full WCAG 2.2 AA audit
```

## Phase 7

Do not implement:

```text
Render Manifest
frame-accurate final composition
Timeline Compiler
```

## Phase 8

Do not implement:

```text
manifest-driven FFmpeg renderer refactor
NVENC/CPU final render pipeline changes
```

## Phase 9

Do not implement:

```text
automated render QA
ffprobe final-render gates
black/freeze/silence analysis
```

## Future

Do not implement:

```text
Timeline Editor
Remotion
multi-language localization
automatic dubbing
collaboration/team workflows
cloud orchestration
automatic Google Flow/Veo browser operation
```

---

# 59. Final Instruction

You are explicitly authorized to implement:

```text
SUBPHASE 3C ONLY
VISUAL WORKBENCH
SCENES + SHOTS + VISUAL BIBLE
```

Execution flow:

```text
VERIFY APPROVED 3B FINAL STATE
→ CREATE pre-phase-3c CHECKPOINT
→ BASELINE 507 TESTS
→ AUDIT LEGACY VISUAL CAPABILITIES
→ IMPLEMENT VISUAL WORKBENCH
→ MIGRATE CAPABILITIES
→ STABLE SCENE/SHOT ID INTEGRATION
→ VISUAL ROUTER
→ VISUAL BLUEPRINT
→ VISUAL BIBLE BINDINGS
→ IMAGE PROMPT
→ MOTION BLUEPRINT
→ VEO MOTION PROMPT
→ APPROVAL / LOCK / FRESHNESS
→ FLOW/VEO MANUAL HANDOFF
→ TEST
→ BROWSER VALIDATION
→ FULL REGRESSION
→ DATA INTEGRITY
→ SCOPE AUDIT
→ PHASE_03C_IMPLEMENTATION_REPORT.md
→ STOP
```

At the end:

- Do NOT start Subphase 3D.
- Do NOT implement Phase 4.
- Do NOT implement Phase 7–9.
- Do NOT automate external Google Flow/Veo generation.
- Return the 3C implementation report for external review.
