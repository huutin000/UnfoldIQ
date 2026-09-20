# UNFOLDIQ — MASTER REPOSITORY AUDIT, POST-FINAL-GATE CLEANUP & UI SIMPLIFICATION SPEC

> Status: MASTER SPEC — CONSOLIDATED FROM REPOSITORY AUDIT + POST-FINAL-GATE CLEANUP REQUIREMENTS  
> Date: 19/09/2026  
> Scope: Repository audit, cleanup classification, UI simplification, safe cleanup implementation, blank-state reset, verification  
> Product: UnfoldIQ  
> This is **not Phase 10** and does not modify the completed Final System Integration & Production Validation Gate contract.

---

# 1. Purpose

This document is the single source of truth for two related but distinct activities:

1. **Repository structure and cleanup audit** performed in strict read-only mode.
2. **Post-Final-Gate implementation and cleanup** performed only after the audit gate is satisfied and destructive execution is explicitly authorized.

The target outcome is:

```text
accurate repository map
+ storage analysis
+ cleanup classification with evidence
+ no accidental destructive scan/cleanup
+ no demo/test projects
+ no stale project-specific UI state
+ safe removal of recreatable runtime/evidence artifacts
+ simplified header
+ no guided Help/Onboarding system
+ no Free-Priority feature
+ reliable cleanup preview/modal/loading/result UX
+ clean blank application state
+ source/models/environments/tests/config/docs preserved
+ full verification and regression
```

This master spec intentionally separates **AUDIT** from **EXECUTION** so safety rules do not conflict with implementation requirements.

---

# 2. Role

Act as:

```text
Senior Software Engineer
+ Repository Auditor
+ Application Maintainer
+ Safety-Conscious Cleanup Implementer
+ QA / Verification Owner
```

You are responsible for:

- understanding the real repository before changing anything;
- mapping structure and storage usage;
- identifying cleanup candidates with evidence;
- protecting source-of-truth and active user data;
- removing obsolete product features only after ownership/usage analysis;
- hardening cleanup behavior and UX;
- resetting development/demo state safely;
- verifying the final system through tests and real UI flows.

Do not assume a file, directory, route, state key, or feature is unused from its name alone.

---

# 3. Execution Modes and Hard Gate

This master spec has two stages.

## Stage 1 — READ_ONLY_AUDIT

Default mode.

During Stage 1:

```text
NO delete
NO move
NO rename
NO source modification
NO config modification
NO dependency modification
NO cleanup execution
```

The only repository artifact Stage 1 may create or update is:

```text
PROJECT_STRUCTURE_AUDIT.md
```

Stage 1 ends with an explicit audit verdict and cleanup classification.

## Stage 2 — AUTHORIZED_IMPLEMENTATION_AND_CLEANUP

Stage 2 may begin only when BOTH are true:

1. Stage 1 audit has completed successfully.
2. The current user/developer instruction explicitly authorizes implementation/destructive cleanup.

Examples of sufficient authorization:

```text
Proceed with Stage 2
Implement the full cleanup spec
Execute the approved cleanup
Stage 2 authorized
```

If authorization is absent or ambiguous:

```text
STOP AFTER STAGE 1
```

Do not infer destructive authorization merely because this master spec contains Stage 2 requirements.

---

# 4. Global Non-Negotiable Safety Rules

The following rules apply throughout the task unless a Stage 2 section explicitly authorizes a narrowly scoped modification/deletion.

1. Determine the exact repository root before scanning.
2. Stay inside the repository root.
3. Never follow a symlink outside the repository.
4. Never recursively scan dependency/build/cache/Git-internal directories unless a specific exception is justified.
5. Never expose secrets or credential values.
6. Never delete by broad wildcard or filename pattern alone.
7. Never classify ambiguous source/user data as safe to delete.
8. Never terminate unrelated processes to make cleanup succeed.
9. Never delete active real user projects without explicit evidence and classification.
10. Never delete source code, required config, models, required environments, test source, or protected authored documentation as routine cleanup.
11. Destructive cleanup must be based on an allowlist/classification model.
12. Preview/classification must precede real deletion.
13. If a cleanup target is actively owned by a running job/process, skip or reject it safely.
14. Do not commit unless explicitly authorized.

---

# 5. Repository Boundary

Before any scan:

1. Determine repository root using Git-aware repository metadata where available.
2. Confirm all subsequent paths are descendants of that root.
3. Do not scan:
   - parent directory;
   - `$HOME`;
   - Desktop;
   - Documents;
   - Downloads;
   - sibling repositories;
   - mounted filesystems outside the repository.
4. Do not follow external symlinks.

If a symlink target resolves outside the repository:

```text
record symlink path only
classification = EXTERNAL_SYMLINK_REVIEW
DO NOT traverse target
```

If repository root cannot be determined confidently:

```text
STOP
report the blocker
```

---

# 6. Critical Recursive Scan Exclusions

## 6.1 `node_modules/`

Never recursively tree/read/hash/search all of `node_modules/`.

Do not run commands equivalent to:

```text
tree node_modules
find node_modules
rg ... node_modules
Get-ChildItem -Recurse node_modules
ls -R node_modules
```

Allowed metadata:

- existence;
- total size;
- tracked/untracked/ignored status;
- associated package manager;
- regenerate prerequisites.

Report form:

```text
node_modules/ [SIZE] [DEPENDENCIES — CONTENTS OMITTED]
```

## 6.2 `.next/` and equivalent generated build directories

Never recursively scan `.next/`.

Allowed metadata:

- existence;
- total size;
- Git status;
- framework/build context;
- regenerate method.

Report form:

```text
.next/ [SIZE] [NEXT.JS BUILD OUTPUT — CONTENTS OMITTED]
```

If the application uses a custom `distDir`, apply the same rule.

## 6.3 `.git/`

Never recursively inspect Git internals.

Do not directly scan:

```text
.git/objects/
.git/refs/
.git/logs/
.git/index
```

Use Git commands/metadata for branch/status/tracked/ignored information.

`.git/` is always protected from routine cleanup.

## 6.4 Default metadata-only/generated directories

If present, do not recursively scan these by default:

```text
node_modules/
.next/
.git/
dist/
build/
out/
coverage/
.cache/
.turbo/
.nx/
.parcel-cache/
.vite/
.vercel/
.netlify/
.storybook-static/
playwright-report/
test-results/
allure-results/
allure-report/
cypress/videos/
cypress/screenshots/
__pycache__/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.venv/
venv/
target/
.gradle/
.idea/system/
```

These directories are **not automatically safe to delete**.

Determine project usage first.

If uncertain:

```text
REVIEW_REQUIRED
```

---

# 7. System / OS File Rules

Do not read binary/system content for:

```text
.DS_Store
Thumbs.db
Desktop.ini
ehthumbs.db
Icon\r
$RECYCLE.BIN
System Volume Information
.Trashes
.Spotlight-V100
.fseventsd
```

If found inside the repository:

- record path;
- record size if easy to obtain;
- record Git status;
- classify based on actual repository use;
- do not inspect content.

Do not scan OS directories outside the repository to search for these files.

---

# 8. IDE / Editor Directory Rules

Do not automatically classify:

```text
.vscode/
.idea/
```

as junk.

They may contain team/project setup such as:

- workspace settings;
- formatter config;
- recommended extensions;
- debug config;
- run config.

Allowed:

- shallow listing;
- Git status;
- targeted inspection when needed.

Do not expose credentials.

If ambiguous:

```text
REVIEW_REQUIRED
```

---

# 9. Secret and Sensitive File Rules

Potential secret-bearing paths include:

```text
.env
.env.*
*.pem
*.key
*.p12
*.pfx
*.crt
*.cer
*.keystore
*.jks
credentials.json
service-account*.json
secrets.*
*.secret
.npmrc
.pypirc
.netrc
```

Never copy secret values into reports or chat output.

Allowed metadata:

- path;
- existence;
- size;
- tracked/untracked/ignored status;
- security finding.

Never output:

- API key;
- token;
- password;
- private key;
- database URL containing credentials;
- cloud credential.

If a likely secret is tracked:

```text
SECURITY_REVIEW_REQUIRED
```

Do not automatically modify or rotate credentials.

---

# 10. Binary / Large File Rules

Do not read the full content of large binary files solely for audit.

Examples:

```text
*.zip
*.tar
*.gz
*.7z
*.rar
*.mp4
*.mov
*.avi
*.mkv
*.psd
*.ai
*.fig
*.pdf
*.woff
*.woff2
*.ttf
*.otf
*.sqlite
*.db
```

Record only what is necessary:

- path;
- size;
- type;
- Git status;
- targeted hash if required for duplicate analysis.

Do not extract archives merely to audit them unless specifically required.

---

# 11. Safe Command Principles

During Stage 1:

1. Exclude dependency/build/cache/Git-internal directories from recursive commands.
2. Prefer Git-aware listing for source-controlled areas.
3. Do not follow symlinks.
4. Do not read binary content unnecessarily.
5. Do not run a build merely to create the audit report.
6. Do not install dependencies.
7. Do not run full test suites merely for structural audit.
8. Do not run cleanup/prune/reset commands.
9. If a command may traverse excluded directories unexpectedly, do not run it until properly scoped.
10. If a command may have destructive side effects, do not run it in Stage 1.

---

# 12. STAGE 1 — Mandatory Repository Audit

Before any Stage 2 implementation or deletion, complete all applicable audit steps below.

---

## 12.1 Detect Project Type

Inspect root-level project metadata such as:

```text
package.json
package-lock.json
pnpm-lock.yaml
yarn.lock
bun.lock
bun.lockb
next.config.*
vite.config.*
webpack.config.*
turbo.json
nx.json
tsconfig.json
jsconfig.json
Dockerfile
docker-compose.*
vercel.json
netlify.toml
.github/
.gitlab-ci.yml
pyproject.toml
requirements*.txt
Pipfile
poetry.lock
```

Determine:

- framework;
- runtime;
- package manager;
- Python/package tooling where applicable;
- monorepo vs single app;
- workspace system;
- build tool;
- test framework;
- E2E framework;
- lint tool;
- formatter;
- deployment system;
- containerization;
- CI/CD.

If conflicting lockfiles/package managers exist:

```text
PACKAGE_MANAGER_REVIEW_REQUIRED
```

Do not delete lockfiles automatically.

---

## 12.2 Build a Safe Repository Tree

Create an understandable project tree without polluting the report with generated/dependency content.

Expand reasonably:

- application source;
- config;
- scripts;
- docs;
- tests;
- public assets;
- infrastructure/deployment files;
- application-owned runtime/storage code.

Do not expand:

- dependencies;
- generated build output;
- caches;
- Git internals;
- test output;
- OS/system folders;
- binary archive internals.

If a source directory is extremely large:

- retain module structure;
- collapse repetitive files when necessary;
- record omitted count;
- do not omit an entire important module.

---

## 12.3 Storage Analysis

Calculate where practical:

- total repository working-tree size;
- top-level directory sizes;
- largest directories;
- largest files;
- approximate percentage of repository size.

Prioritize detection of:

- folders > 100 MB;
- files > 10 MB;
- abnormal assets;
- archives;
- generated output;
- cache;
- log;
- DB/dump files;
- duplicate large binaries.

Do not classify a file as junk merely because it is large.

Required table:

| Path | Size | % Project | Type | Scan Mode |
|---|---:|---:|---|---|

`Scan Mode` values:

```text
FULL_SOURCE_SCAN
METADATA_ONLY
CONTENTS_OMITTED
```

Sort largest to smallest.

---

## 12.4 Git Analysis

Use Git metadata to distinguish:

- tracked;
- modified;
- untracked;
- ignored.

Inspect `.gitignore` without modifying it.

Identify:

- generated folders accidentally tracked;
- cache accidentally tracked;
- secret files tracked;
- large binaries tracked;
- backup/temp files tracked.

If a generated/cache path should likely be ignored:

```text
GITIGNORE_RECOMMENDATION
```

Do not edit `.gitignore` during Stage 1.

---

## 12.5 Cleanup Candidate Detection

Search project-owned areas for patterns such as:

```text
*.bak
*.backup
*.old
*.orig
*.rej
*.tmp
*.temp
*.log
*.cache
*.swp
*.swo
*~
.DS_Store
Thumbs.db
Desktop.ini
```

Also inspect suspicious names such as:

```text
Component-old.*
Component-copy.*
Component-copy-2.*
Component2.*
page-backup.*
page-old.*
old-config.*
temp-data.*
```

A suspicious filename is only a lead.

Usage/reference analysis is required before classification.

---

## 12.6 Duplicate File Analysis

Duplicate analysis order:

1. size;
2. hash;
3. path;
4. usage/reference.

Do not hash recursively:

```text
node_modules/
.next/
.git/
cache/build outputs
```

Focus on project-owned areas such as:

- `src/`;
- `public/`;
- `assets/`;
- `docs/`;
- `scripts/`;
- test fixtures;
- other application-owned directories.

Duplicate content does not imply safe deletion.

Default duplicate source/asset classification:

```text
REVIEW_REQUIRED
```

---

## 12.7 Possible Unused Source Analysis

For source files suspected to be unused, inspect more than direct imports.

Check as relevant:

- static import;
- dynamic import;
- `require()`;
- lazy loading;
- route conventions;
- file-system routing;
- framework conventions;
- barrel exports;
- path aliases;
- package exports;
- CSS references;
- `url()` references;
- metadata/manifest;
- public URL usage;
- config;
- scripts;
- tests;
- Storybook;
- CI/CD;
- Docker;
- runtime filesystem access;
- code generation;
- plugin registration;
- dependency injection;
- server-side dynamic loading.

Possible unused source must **not** be classified `SAFE_TO_DELETE` merely from zero static references.

Default:

```text
REVIEW_REQUIRED
```

---

## 12.8 Generated Artifact Analysis

Identify generated paths created by the actual toolchain, e.g.:

- Next.js;
- Vite;
- Webpack;
- Turbopack;
- TypeScript;
- Babel/SWC;
- Jest/Vitest;
- Playwright/Cypress;
- Storybook;
- Turbo/Nx;
- Python test/cache tooling;
- package managers;
- application generators.

Rule:

```text
GENERATED != AUTOMATICALLY SAFE_TO_DELETE
```

Verify:

- whether deployment consumes the artifact directly;
- whether it is committed;
- whether CI/CD expects it;
- whether packages publish it;
- whether container images copy it.

If uncertain:

```text
REVIEW_REQUIRED
```

---

# 13. Cleanup Classification Model

Every cleanup candidate must belong to exactly one primary decision class.

## A. SAFE_TO_DELETE

Allowed only when:

```text
Confidence = HIGH
```

Minimum conditions:

1. not source-of-truth;
2. no real user data;
3. no secrets;
4. not required config;
5. not migration/database source;
6. no deployment dependency;
7. no CI/CD dependency;
8. no runtime dependency;
9. no active application reference;
10. disposable or regeneratable without loss.

Typical candidates after verification may include:

- OS junk inside repo;
- stale logs;
- temporary files;
- old generated coverage;
- old test result artifacts.

Required table:

| Path | Size | Reason | Evidence | Confidence |
|---|---:|---|---|---|

## B. SAFE_BUT_REGENERATE

For data/artifacts that can be recreated deterministically after confirming usage.

Examples may include:

```text
node_modules/
.next/
build/
dist/
coverage/
```

Required table:

| Path | Size | Regenerate By | Preconditions | Impact | Confidence |
|---|---:|---|---|---|---|

## C. REVIEW_REQUIRED

Default for ambiguity.

Examples:

- source that looks unused;
- duplicate component;
- duplicate image;
- legacy script;
- old folder;
- migration/history;
- old documentation;
- unknown generated folder;
- IDE config;
- deployment artifact;
- database snapshot;
- archive;
- backup-looking file still potentially used.

Required table:

| Path | Size | Why Suspicious | Evidence | Risk | Confidence |
|---|---:|---|---|---|---|

## D. DO_NOT_DELETE

Includes confirmed source-of-truth and required system assets, including:

- application source;
- package manifests;
- active lockfiles;
- TS/JS/Python config;
- framework config;
- build/deployment config;
- migrations;
- infrastructure config;
- CI/CD;
- Docker config;
- production assets;
- required certificates;
- application data;
- user uploads;
- `.git/`;
- active environment config;
- required models;
- required application environments.

Required table:

| Path | Reason | Risk If Deleted |
|---|---|---|

## E. SECURITY_REVIEW_REQUIRED

Use for:

- tracked secrets;
- credential files;
- private keys;
- suspicious DB dumps;
- production snapshots;
- sensitive exports.

Do not expose content.

Required table:

| Path | Finding | Git Status | Recommended Manual Action |
|---|---|---|---|

---

# 14. Special Audit Rules

## 14.1 Database and migrations

Never automatically classify as safe:

```text
migrations/
prisma/migrations/
database/
seed/
seeds/
*.db
*.sqlite
*.sql
*.dump
```

Default:

- migration → `DO_NOT_DELETE` or `REVIEW_REQUIRED`;
- database → `REVIEW_REQUIRED` / `SECURITY_REVIEW_REQUIRED`;
- seed → inspect real usage.

Do not open production databases solely for cleanup auditing.

## 14.2 Public assets

For:

```text
public/
assets/
static/
images/
icons/
fonts/
```

Do not classify as unused merely because direct source search does not find a filename.

Consider:

- runtime URL;
- data-driven URL;
- backend-provided path;
- CSS backgrounds;
- metadata;
- manifests;
- email templates;
- SEO/social assets;
- favicon/PWA assets.

If uncertain:

```text
REVIEW_REQUIRED
```

## 14.3 Documentation

Do not automatically delete:

```text
docs/
README*
CHANGELOG*
ADR/
architecture/
*.md
```

If multiple versions exist:

- list them;
- record timestamp/Git context where useful;
- recommend consolidation;
- do not delete during Stage 1.

## 14.4 Tests

Test source is project source.

Protect:

```text
tests/
__tests__/
e2e/
cypress/
playwright/
fixtures/
```

Generated test output may become a cleanup candidate after verification:

```text
coverage/
playwright-report/
test-results/
cypress/videos/
cypress/screenshots/
```

---

# 15. Stage 1 Audit Output

Create/update exactly:

```text
PROJECT_STRUCTURE_AUDIT.md
```

Required structure:

```text
# Project Structure Audit

## 1. Audit Metadata
## 2. Project Overview
## 3. Scan Policy
## 4. Directory Tree
## 5. Storage Analysis
## 6. Largest Files
## 7. SAFE_TO_DELETE
## 8. SAFE_BUT_REGENERATE
## 9. REVIEW_REQUIRED
## 10. DO_NOT_DELETE
## 11. SECURITY_REVIEW_REQUIRED
## 12. Duplicate Files
## 13. Possible Unused Source
## 14. Generated Artifacts
## 15. Gitignore Recommendations
## 16. Cleanup Summary
## 17. Top Storage Consumers
## 18. Recommended Cleanup Order
## 19. Proposed Cleanup Commands — DO NOT EXECUTE
## 20. Post-Final-Gate Targeted Audit Inputs
## 21. Final Recommendation
```

### Audit Metadata must include

```text
Audit date:
Repository root:
Git branch:
Audit mode: READ_ONLY
Destructive operations executed: NONE
```

### Cleanup Summary must include

```text
Current project size:
SAFE_TO_DELETE:
SAFE_BUT_REGENERATE:
REVIEW_REQUIRED:
Estimated immediate safe cleanup:
Estimated cleanup after manual review:
```

Do not include `REVIEW_REQUIRED` in immediate safe cleanup totals.

### Proposed Cleanup Commands

Commands may be written as proposals only.

Header:

> WARNING: The following commands were NOT executed. Review manually before running anything.

Each proposal must contain:

```text
Target:
Classification:
Reason:
Expected reclaimed size:
Command:
Rollback / Regenerate:
Risk:
```

Do not execute these proposals during Stage 1.

---

# 16. Stage 1 Final Safety Check

Before completing Stage 1, verify:

- [ ] No file was deleted.
- [ ] No file was moved/renamed.
- [ ] No source/config was modified.
- [ ] `node_modules/` was not recursively scanned.
- [ ] `.next/` was not recursively scanned.
- [ ] `.git/` internals were not recursively scanned.
- [ ] No path outside repository root was scanned.
- [ ] No external symlink was followed.
- [ ] No secret value was output.
- [ ] No unnecessary large binary was parsed.
- [ ] No cleanup/prune/reset command was executed.
- [ ] `.gitignore` was not modified.
- [ ] No dependency was installed/uninstalled.
- [ ] Suspected unused source remains `REVIEW_REQUIRED`.
- [ ] Only HIGH-confidence disposable items are `SAFE_TO_DELETE`.

If any item fails, correct the audit method before declaring Stage 1 complete.

---

# 17. Stage 1 Completion Gate

At the end of Stage 1:

1. Produce `PROJECT_STRUCTURE_AUDIT.md`.
2. Summarize the major findings.
3. Check whether Stage 2 has explicit authorization.

If Stage 2 is **not explicitly authorized**:

```text
STOP
```

Do not modify application code or delete anything.

If Stage 2 **is explicitly authorized**:

continue to the targeted audit below before changing code.

---

# 18. STAGE 2 — Post-Final-Gate Targeted Pre-Implementation Audit

Stage 2 begins with a **targeted delta audit**, not a duplicate full repository audit.

Use `PROJECT_STRUCTURE_AUDIT.md` as baseline and inspect all implementation paths related to:

```text
guide
guided tour
tour
onboarding
tooltip
coachmark
spotlight
walkthrough
help
replay
firstRun
hasSeen
dismissed
completed
priority
free
free-priority
cleanup
storage
maintenance
recent project
active project
localStorage
sessionStorage
IndexedDB
project lifecycle
runtime jobs
browser/CDP test profiles
validation/evidence artifacts
```

Inspect at minimum, if present:

```text
studio/static/index.html
studio/static/app.js
studio/static/phase14_ui.js
studio/static/i18n.js
studio/static/style.css
studio/app.py
studio/phase14_router.py
storage cleanup modules/services
project lifecycle/state modules
launcher/runtime scripts
browser/E2E tests
tests related to onboarding/help/storage/project lifecycle
```

Create:

```text
temp/post_final_cleanup_audit.md
```

Classify every item touched by Stage 2 as:

```text
REMOVE
KEEP
SHARED — KEEP
REWRITE
DATA CLEANUP
PROTECTED
```

No deletion may be based only on a filename or directory name.

---

# 19. Stage 2 Scope

Stage 2 contains four tightly related changes:

```text
A. Remove in-app guided Help / Onboarding
B. Remove Free-Priority feature boundary
C. Improve System Maintenance cleanup UX and safety
D. Reset the application to a clean blank development state
```

The implementation must inspect real ownership/consumers before deleting shared code.

---

# 20. Stage 2 Non-Goals

Do not implement as part of this task:

```text
new onboarding replacement
new documentation portal
new tutorial framework
new product tour
new AI assistant/help agent
new storage architecture
new project format
new media pipeline
new render engine
new Phase 10
Google Flow/Veo automation
YouTube publishing
unrelated workbench redesign
```

---

# 21. Remove `? Hướng dẫn`

## 21.1 User-visible behavior

Remove the Help entry from the header completely.

Do not leave:

```text
disabled button
empty placeholder
hidden click target
blank dropdown
orphan icon spacing
```

The header must reflow naturally.

## 21.2 Remove guided-help implementation

Remove implementation that exists only for guided Help/Onboarding, where applicable:

```text
Help / Replay Center
first-run welcome modal
product tour
contextual mini tours
coachmarks
spotlights
walkthrough state
tour definitions
tour navigation
tour persistence
data-guide-id attributes used only by tours
i18n keys used only by guided help
CSS used only by guided help
help/tour event handlers
onboarding-only browser tests
```

## 21.3 Preserve normal useful tooltips

Do not remove a tooltip merely because its code contains `help` or `tooltip`.

Keep it when:

- it explains a real control;
- it is independent of tour state;
- it does not require multi-step walkthrough maintenance;
- it matches current behavior.

## 21.4 Remove obsolete persistence

Safely remove obsolete guided-help preference/state keys from:

- localStorage;
- sessionStorage;
- other client preference stores.

Normal startup must not recreate obsolete keys.

---

# 22. Remove `⚡ Ưu tiên miễn phí`

## 22.1 User-visible behavior

Remove the header control completely.

No layout space should remain.

## 22.2 Feature ownership boundary

Audit all code reachable from the feature.

Remove only code exclusively owned by Free Priority.

If underlying logic is shared:

```text
remove feature-specific UI/state/route wiring
keep shared reusable logic
```

Do not remove shared project/scheduling/provider/settings logic without proving no remaining consumer exists.

## 22.3 Persistence/config cleanup

Remove obsolete feature-specific:

- settings;
- local state;
- i18n keys;
- CSS;
- tests;
- dead routes;

only when no active consumer remains.

Normal startup must not recreate removed feature state.

---

# 23. System Maintenance Cleanup State Machine

Keep the existing System Maintenance drawer.

Cleanup flow must be explicit and observable:

```text
IDLE
  ↓
PREVIEW
  ↓
CONFIRMATION MODAL
  ↓
CLEANING
  ↓
SUCCESS | PARTIAL_FAILURE | FAILURE
```

---

# 24. Cleanup Preview

`Xem trước dọn dẹp` must show what is eligible before destructive execution.

Where available, show:

```text
category
path or logical group
file/folder count
estimated reclaimable size
reason it is safe to delete
protection status
```

Distinguish:

```text
SAFE_TO_DELETE
PROTECTED
NEEDS_REVIEW
```

Rules:

1. Confirmation cannot be enabled until a valid current preview exists.
2. Preview must be server-validated or equivalent.
3. If the filesystem materially changes after preview:
   - recompute before execution; or
   - reject stale preview and require a new preview.
4. Preview must never silently expand beyond its validated scope.

---

# 25. Cleanup Confirmation Modal

Clicking `Xác nhận dọn dẹp` must open a real confirmation modal.

The modal must clearly describe eligible deletion categories, which may include after validation:

```text
demo/test projects
old demo exports/renders
recreatable render cache
old temporary jobs
old browser/CDP test profiles
obsolete screenshots
old benchmark outputs
old pytest/test logs
old validation/evidence runtime artifacts classified safe
stale runtime markers when no owned process is active
```

It must also list protected classes:

```text
source code
.git/
studio/
scripts/
tests/
startup-required config
models/
Kokoro weights
Whisper weights
Python environments
upstream dependencies
transcription runtime/dependencies
documentation/specs/plans/reports
active non-demo user data unless explicitly classified
```

Primary action:

```text
Dọn dẹp
```

Secondary action:

```text
Hủy
```

Accessibility/interaction requirements:

- initial focus management;
- keyboard navigation;
- Escape cancels before execution starts;
- focus is trapped appropriately while modal is open;
- visible disabled state where applicable.

---

# 26. Cleanup Loading State

After confirmation:

```text
confirmation button disabled
cleanup controls disabled
spinner/progress indicator visible
status text = "Đang dọn dẹp..."
double-submit prevented
```

If real progress is available, display it.

Do not fabricate percentages.

The UI must remain responsive enough to show status updates.

---

# 27. Cleanup Result State

## 27.1 SUCCESS

Show clear feedback such as:

```text
Dọn dẹp hoàn tất
Đã giải phóng X MB / GB
```

Then refresh storage statistics automatically.

## 27.2 PARTIAL_FAILURE

If some items are deleted and some fail:

```text
Dọn dẹp chưa hoàn tất
Đã xóa: ...
Không thể xóa: ...
```

Do not display full success.

## 27.3 FAILURE

On complete failure:

- show a clear error;
- keep the application usable;
- preserve protected data;
- expose diagnostic detail without dumping raw stack traces into primary UI.

---

# 28. Safe Deletion Policy

Cleanup must use explicit classification/allowlist rules.

Never implement broad deletion such as:

```text
delete everything in temp/
delete by broad wildcard without inspection
delete every folder containing "test"
delete every project containing "demo"
```

`temp/` may contain mixed:

- evidence;
- fixtures;
- helper data;
- generated media;
- active development artifacts.

Every deletion category must be verified against actual repository/application usage.

---

# 29. Candidate Safe Cleanup Categories

After inspection and HIGH-confidence classification, candidate categories may include:

```text
temp/edge_cdp_profile_*
temp/*_verification/
temp/*_audit/
temp/*_validation/
old browser test profiles
obsolete screenshots
old benchmark outputs
old pytest logs
orphan temporary jobs
demo/test render cache
demo/test exports
demo/test renders
verified demo/test projects
```

This list is not an unconditional delete list.

Every path/category requires evidence and scope validation.

---

# 30. Protected Paths and Assets

Routine cleanup must never delete these merely because they consume storage:

```text
.git/
studio/
scripts/
tests/
config/
models/
upstream/
transcription/
docs/
Python virtual environments required by the application
Kokoro model files
Whisper model files
launcher scripts
application source
active project/user data
required runtime config
```

Project-specific audit evidence may add more protected paths.

---

# 31. Demo/Test Project Cleanup

The project:

```text
2026-09-12_210003_youtube-narration-01
```

and its associated:

```text
79 Scenes / 141 Shots
```

are considered demo/development data according to the approved product decision and may be removed during authorized Stage 2 cleanup, subject to runtime ownership checks.

Before deleting:

1. confirm it is development/demo data;
2. confirm it is not an active real-user project;
3. confirm no active job owns files inside it;
4. reject/skip safely if active ownership exists.

After deletion, the project must no longer appear in project lists/recent state.

Other projects must not be treated as demo solely because of naming.

---

# 32. Blank Application State

After authorized cleanup and restart:

```text
Active Project: NONE
Projects list: empty
Recent Projects: empty
```

Project-scoped workbenches must render valid empty states:

```text
Kịch bản: empty
Giọng đọc: empty
Voice QA: empty
Timestamp/SRT: empty
Scene Plan: empty
Shots/Prompts: empty
Assets: empty
Exports: empty
Render QA: empty
```

Normal startup must not:

```text
auto-open a demo project
seed sample projects
insert fake Recent Projects
preload demo script/audio/scenes/shots
recreate deleted demo data
```

A project hydrates only after explicit create/open action.

---

# 33. Clear Project-Specific Client State

When a project is removed, clear stale project-scoped client state where applicable:

```text
activeProjectId
recent-project references to deleted projects
project-specific localStorage/sessionStorage
project-scoped IndexedDB entries
cached API/query state
Blob/Object URLs
selection state
open scene/shot IDs
unsaved demo-only editor state
```

Do not wipe still-valid global preferences such as:

- theme;
- unrelated user preferences;
- active non-obsolete application settings.

Only remove global keys if they exclusively belong to removed features.

---

# 34. Runtime Directory Handling

Never delete `runtime/` blindly while services are running.

Routine cleanup may remove only validated safe runtime artifacts such as:

```text
stale PID markers proven not to belong to active owned processes
obsolete logs allowed by policy
completed temporary job markers
```

Current launcher/process ownership state must remain valid.

If a file is locked or active:

```text
record skip/failure
continue where safe
return PARTIAL_FAILURE if applicable
```

Do not kill unrelated processes.

Never use process-wide destructive shortcuts such as killing every `python.exe`.

---

# 35. Documentation Preservation

Protect authored historical/product documentation needed to understand system evolution.

At minimum:

```text
docs/superpowers/specs/
docs/superpowers/plans/
docs/implementation/
Final Gate reports
phase implementation reports intentionally retained in docs
```

Runtime evidence may be removable after classification.

Authored documentation is not runtime evidence.

---

# 36. Cleanup Backend/API Contract

Reuse existing storage-cleanup architecture where practical.

Keep/implement separate logical operations for:

```text
preview cleanup
execute confirmed cleanup
get storage overview
```

Execution must use:

- the current validated preview; or
- equivalent server-side revalidation.

Machine-readable execution result must include at least:

```text
status
bytes_reclaimed
items_deleted
items_failed
failed_items[]
protected_items_skipped[]
```

Recommended status values:

```text
SUCCESS
PARTIAL_FAILURE
FAILURE
```

Do not report success merely because the HTTP request itself completed.

---

# 37. Error and Concurrency Rules

Cleanup must reject or skip safely when files are owned by current jobs/processes.

Do not terminate unrelated processes.

For locked files:

```text
record failure/skip
continue where safe
return PARTIAL_FAILURE if applicable
```

Cleanup must be idempotent enough that a second run on an already-clean state does not cause destructive side effects or false errors.

---

# 38. UI Design Rules

Keep the current UnfoldIQ workstation visual language.

After removing Help and Free Priority:

- header reflows naturally;
- no visual gaps;
- no orphan click targets;
- no layout placeholders.

System Maintenance UI must:

- reuse existing design tokens;
- reuse existing modal/button primitives where available;
- have clear primary/secondary actions;
- provide visible loading state;
- provide visible success/error/partial state;
- support keyboard/focus behavior;
- respect reduced-motion settings where applicable.

Do not introduce a new visual theme.

---

# 39. Stage 2 Implementation Workflow

Follow this order:

```text
1. Read PROJECT_STRUCTURE_AUDIT.md
2. Produce targeted post_final_cleanup_audit.md
3. Confirm Stage 2 authorization still applies
4. Identify protected/shared boundaries
5. Implement Help/Onboarding removal
6. Implement Free-Priority removal
7. Harden cleanup preview/API classification
8. Implement confirmation modal
9. Implement loading/result/error states
10. Implement project/client-state cleanup
11. Execute only approved cleanup categories
12. Verify blank application state
13. Run targeted tests
14. Run real browser verification
15. Run full regression
16. Produce implementation report
```

Before any real deletion:

```text
preview
classify
verify protected paths
verify active ownership
then delete
```

Do not use parallel subagents for destructive cleanup decisions.

Use one sequential implementation owner for the destructive phase.

---

# 40. Testing Strategy

## 40.1 Feature-removal tests

Verify:

```text
Help button absent
Free Priority button absent
no hidden click targets
no stale onboarding modal
no guided tour auto-start
obsolete onboarding state not recreated
obsolete Free-Priority state not recreated
header layout valid
normal independent tooltips still work
```

## 40.2 Cleanup backend tests

At minimum:

```text
preview classification
protected-path rejection
demo project identification
safe deletion
stale preview handling
locked file partial failure
accurate bytes reclaimed
partial failure result
full failure result
idempotent second cleanup
active job protection
unknown/needs-review item not deleted
```

## 40.3 Browser/E2E tests

Through real UI:

```text
open System Maintenance
run preview
inspect classifications
open confirmation modal
cancel once
re-open and confirm cleanup
observe loading state
prevent double-submit
observe success/partial/failure feedback
verify storage stats refresh
verify keyboard/focus behavior
```

## 40.4 Clean-start acceptance

After cleanup and restart, verify:

```text
Projects list empty
Recent Projects empty
Active Project none
all project-scoped workbenches empty
no demo project auto-load
Kokoro still available
Whisper/model assets still available
application starts normally
new project can still be created/opened
```

## 40.5 Regression

Run the full existing regression suite after implementation.

Cleanup-related tests must create isolated temporary fixtures and remove them after tests.

Tests must not depend on the deleted real demo project.

---

# 41. Data-Safety Acceptance Criteria

Stage 2 is not complete unless all are true:

```text
0 source files deleted by routine cleanup
0 model files deleted
0 required environment files deleted
0 test source files deleted
0 protected docs deleted
0 unrelated processes terminated
0 active real project deleted without explicit classification
0 stale demo data visible after clean restart
0 secret values exposed in logs/reports
0 REVIEW_REQUIRED item deleted as if SAFE_TO_DELETE
```

---

# 42. Functional Acceptance Criteria

Pass only when:

```text
[ ] `? Hướng dẫn` is fully removed
[ ] guided onboarding/help state no longer runs or persists
[ ] useful independent control tooltips are preserved
[ ] `⚡ Ưu tiên miễn phí` is fully removed
[ ] shared logic used elsewhere is preserved
[ ] cleanup preview is explicit and accurate
[ ] cleanup confirmation uses a proper modal
[ ] cleanup shows a visible loading state
[ ] double-submit is prevented
[ ] success feedback is visible
[ ] partial failure is distinguished from success
[ ] full failure is clear and non-destructive
[ ] storage stats refresh after cleanup
[ ] verified demo/test projects are removed
[ ] old safe runtime/evidence artifacts are removed according to allowlist
[ ] active/locked resources are skipped or rejected safely
[ ] app restarts into a blank workspace
[ ] no demo data is auto-seeded
[ ] stale project-scoped client state is cleared
[ ] Kokoro/Whisper/models/environments remain intact
[ ] new project create/open still works
[ ] full regression passes
```

---

# 43. Required Stage 2 Implementation Report

Create:

```text
docs/implementation/POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md
```

Required sections:

1. Executive Summary
2. Git / Baseline
3. Repository Audit Reference
4. Targeted Pre-Implementation Audit
5. Help / Onboarding Removal
6. Free-Priority Removal
7. Shared Code Preserved
8. Cleanup Architecture
9. Safe Delete Classification
10. Protected Paths
11. Demo/Test Projects Removed
12. Client-State Cleanup
13. Confirmation Modal UX
14. Loading / Result UX
15. Backend Result Contract
16. Runtime Safety
17. Blank-Workspace Verification
18. Browser Verification
19. Full Regression
20. Files Removed
21. Files Modified
22. Storage Before/After
23. Data-Safety Matrix
24. Known Limitations
25. Final Verdict

Final verdict must be exactly one of:

```text
POST-FINAL CLEANUP PASS
POST-FINAL CLEANUP FAIL
```

Do not use PASS if any mandatory acceptance criterion remains unverified.

---

# 44. Confidence Rules

Every important audit/cleanup finding should have confidence:

```text
HIGH
MEDIUM
LOW
```

Only allow:

```text
SAFE_TO_DELETE
```

when confidence is HIGH.

If confidence is MEDIUM or LOW:

```text
REVIEW_REQUIRED
```

Safety takes priority over maximizing reclaimed storage.

---

# 45. Decision Matrix

| Condition | Decision |
|---|---|
| Generated + regeneratable + no deployment/runtime dependency | SAFE_BUT_REGENERATE |
| Cache/temp/log + untracked/dispensable + no runtime dependency | SAFE_TO_DELETE only with HIGH confidence |
| Source suspected unused | REVIEW_REQUIRED |
| Duplicate source | REVIEW_REQUIRED |
| Duplicate asset | REVIEW_REQUIRED |
| Migration | DO_NOT_DELETE / REVIEW_REQUIRED |
| Active config | DO_NOT_DELETE |
| Secret/credential | SECURITY_REVIEW_REQUIRED |
| `.git/` | DO_NOT_DELETE |
| Required models/environment | DO_NOT_DELETE |
| Authored product docs | DO_NOT_DELETE unless separately approved |
| Active user project | DO_NOT_DELETE |
| Verified approved demo project + no active owner | DATA CLEANUP / eligible Stage 2 deletion |
| Locked safe cleanup item | skip/fail item; PARTIAL_FAILURE if needed |
| Unknown item | REVIEW_REQUIRED |

Never choose a more destructive classification merely to reclaim more space.

---

# 46. Performance Rules

Audit/cleanup analysis must avoid unnecessary load.

Do not:

- parse hundreds of thousands of dependency files;
- hash all of `node_modules`;
- hash all of `.next`;
- hash `.git` internals;
- parse large binaries unnecessarily;
- build solely for audit;
- reinstall dependencies solely for audit;
- run full regression during Stage 1;
- scan the whole disk.

Prefer:

1. repository metadata;
2. Git index/status;
3. top-level sizes;
4. project-owned source paths;
5. targeted references;
6. targeted Stage 2 validation.

---

# 47. Execution Governance

1. Stage 1 is strictly read-only.
2. Stage 2 requires explicit authorization.
3. Destructive cleanup uses one sequential implementation owner.
4. Do not parallelize deletion decisions across independent agents.
5. Preview/classify/protect before deleting.
6. Do not commit unless explicitly authorized.
7. Do not start another product feature automatically after completion.
8. If new ambiguity is discovered during deletion, downgrade that item to `REVIEW_REQUIRED` and skip it rather than guessing.
9. Partial completion with protected data intact is preferable to aggressive cleanup.

---

# 48. Final Desired State

After successful Stage 2:

```text
UnfoldIQ starts normally
Header is simpler
No Help/Tour system
No Free-Priority feature
No demo/test projects approved for removal
No stale Recent Projects
No active project
Project workbenches are blank
System Maintenance cleanup is safe and observable
Cleanup has preview + modal + loading + explicit result states
Protected source/config/tests/docs/models/environments remain intact
Kokoro and Whisper remain ready
Repository remains development-ready
Full regression passes
System is ready for the next feature cycle
```

---

# 49. Final Agent Response Rules

## If Stage 1 only was authorized

Return a concise summary:

```text
Audit completed.

Report: PROJECT_STRUCTURE_AUDIT.md

Repository size: <size>
SAFE_TO_DELETE: <size>
SAFE_BUT_REGENERATE: <size>
REVIEW_REQUIRED: <size>

Top storage consumers:
1. <path> — <size>
2. <path> — <size>
3. <path> — <size>
4. <path> — <size>
5. <path> — <size>

No files were deleted or modified.
Stage 2 was not executed because destructive implementation was not explicitly authorized.
```

Then stop.

## If Stage 2 was explicitly authorized and executed

Return a concise summary containing:

```text
Stage 1 audit: COMPLETE
Stage 2 implementation: COMPLETE / INCOMPLETE
Cleanup result: SUCCESS / PARTIAL_FAILURE / FAILURE
Repository audit: PROJECT_STRUCTURE_AUDIT.md
Targeted audit: temp/post_final_cleanup_audit.md
Implementation report: docs/implementation/POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md

Help/Onboarding removed: YES/NO
Free Priority removed: YES/NO
Demo/test data cleanup: <summary>
Blank workspace verified: YES/NO
Protected assets preserved: YES/NO
Full regression: PASS/FAIL
Final verdict: POST-FINAL CLEANUP PASS / POST-FINAL CLEANUP FAIL
```

Do not claim PASS without evidence.

---

# 50. Absolute Priority

When requirements compete, use this priority order:

```text
1. Prevent irreversible loss of source/user data/secrets
2. Stay inside repository boundary
3. Preserve protected runtime/models/environments/config/docs/tests
4. Produce evidence-backed classification
5. Preserve active application behavior not explicitly removed
6. Implement approved cleanup/UI changes correctly
7. Reclaim storage
```

If unsure whether a file is safe to delete:

```text
REVIEW_REQUIRED
```

If unsure whether a directory should be recursively scanned:

```text
DO NOT SCAN RECURSIVELY
```

If unsure whether a command has destructive side effects:

```text
DO NOT RUN IT
```

The goal is **not** to delete as much as possible.

The goal is to leave UnfoldIQ in a clean, simplified, development-ready state while maintaining a defensible safety boundary and preserving everything required to build, test, run, understand, and extend the product.
