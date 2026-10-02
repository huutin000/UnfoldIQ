# UNFOLDIQ Context Router

## Purpose

An agent MUST NOT read every `.md` in the project for every task.
The agent resolves the current workflow stage and loads only the context that stage requires.

- `STAGE_REQUIRED` docs are always loaded for the current stage.
- `STAGE_CONDITIONAL` docs are loaded only when their trigger applies.
- `DEVELOPMENT_HISTORY` is NEVER runtime context for normal video production.

## Context Classes

| Class | Meaning | Examples |
|---|---|---|
| `ROUTER_INVARIANT` | Read at the start of a video task / stage routing | `AGENTS.md`, `core/WORKFLOW.md`, `core/CONTEXT_ROUTER.md` |
| `STAGE_REQUIRED` | Mandatory for the current stage | Stage route table in `context/ROUTES.yaml` |
| `STAGE_CONDITIONAL` | Load only when the listed condition/trigger holds | Domain sources, policy categories, provider impl docs |
| `DEVELOPMENT_HISTORY` | Excluded from runtime | `Report/**`, `**/STEP-*_PROMPT.md`, `**/STEP-*_FIX*.md`, `setup/history/**` |

## Routing Procedure

1. Read `AGENTS.md` (thin router), then `core/WORKFLOW.md` to determine the current stage.
2. Consult `context/ROUTES.yaml` for that stage (or run `node scripts/cli/context-resolver.js --stage <STAGE> --platform <youtube|tiktok>`).
3. Load every `required[]` path. Record each in the context manifest `loaded[]`.
4. Load a `conditional[]` path ONLY if its trigger condition is met; otherwise mark `NOT_NEEDED`.
5. NEVER load `DEVELOPMENT_HISTORY` paths for runtime video production, except when:
   - the user explicitly requests a history review/audit; or
   - the task itself is system migration/debugging.
6. Do NOT claim required context was loaded if it was not actually read.

## Context Manifest

For Stage 1/2 onward, each major stage execution produces/updates a context manifest
validated against `schemas/context-manifest.schema.json`:

- `required[]`, `conditional[]`, `loaded[]`, `missingRequired[]`.
- Each `loaded[]` item: `path`, `purpose`, `loadStatus` (`LOADED` | `NOT_NEEDED` | `FAILED`).

## Stage PASS Gate

- `missingRequired.length > 0` → the stage CANNOT be `PASS`.
- A development-history file appearing in runtime `loaded[]` without an explicit
  runtime reason → warning at minimum; error when it replaces required context.

## Reports

From Step 09 onward, every report includes a `## Context Loaded` table:

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|

Requirement is `REQUIRED` or `CONDITIONAL`.
If any REQUIRED item is not loaded, the stage cannot be `PASS 100%`.
