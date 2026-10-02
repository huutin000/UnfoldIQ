# UNFOLDIQ Flow Companion (STEP 10B)

Human-in-the-loop Google Flow generation. The user performs only the
intentional generation approval; the companion handles prompts, references,
monitoring, download, naming, and import.

- `extension/` — Manifest V3 side-panel extension (approval-gated; all Flow
  DOM interaction centralized in `src/content/flow-page-adapter.js`).
- `bridge/` — localhost-only bridge (narrow API, token-gated, schema-checked
  payloads, project-confined paths, no shell/credentials).
- `harness/` — mock Flow page scenarios for adapter tests (harness success ≠
  live Flow success).
- `docs/` — upstream review and selector-health notes.

No unattended full-auto generation. Retries/regenerations require new
approval. Live UI/generation verification is reported honestly in
`Report/STEP-10B_REPORT.md` (NOT_VERIFIED unless truly verified).

## POST-v1C notes

- Extension branding icons (`extension/icons/`) are PROVISIONAL temporary
  assets (no approved UNFOLDIQ logo exists in the repo yet). Replace with
  approved brand assets when available.
- Toolbar icon opens the Side Panel (`openPanelOnActionClick: true`).
- Roadmap after POST-v1B: see `docs/POST-V1C_ROADMAP.md` — QUALITY 01
  (Voice + Caption) first, then POST-V2 2–3 min publishable-video
  validation (thumbnail + metadata + music-rights stages), then render
  performance, creative quality, and the full 8–12+ min validation.
- New contracts: `schemas/music-source.schema.json`,
  `schemas/thumbnail-package.schema.json`.

## POST-v1D notes

- Side panel is task-centric: one main screen (job + one primary action +
  progress), Settings screen separated, Developer Tools behind Developer
  Mode (default OFF). Vanilla HTML/CSS/JS kept — no React migration.
- UI modules: `extension/src/ui/{styles,state,components,toast.js}` with
  centralized Vietnamese strings (`state/labels.vi.js`) and a single CTA
  state machine (`state/ui-state.js`).
- Vietnamese readability: relaxed line-height (1.65) + letter-spacing
  (0.012em) + word-spacing via design tokens (`styles/tokens.css`).
- Responsive: fluid `width:100%` shell, no page-level horizontal scroll,
  breakpoints at 560/720px.

## Flow Bridge — one-command setup + remember token (2026-10-01)

### First time only

```powershell
cd D:\Project\UNFOLDIQ
npm run flow:bridge
```

The bridge generates a strong random token, stores it outside the repo
(`%LOCALAPPDATA%\UNFOLDIQ\flow-bridge-token`), and prints it ONCE.
Paste it into Flow Companion → tick **Nhớ mã truy cập trên thiết bị này** →
connect. That is the only copy/paste ever needed.

### Every day

```powershell
npm run flow:bridge    # or: .\start-flow.ps1
```

Then open Google Flow — Flow Companion reconnects with its remembered token
automatically. No env vars, no token paste.

### Rotate token

```powershell
npm run flow:bridge:reset-token
```

Prints a new token once; the old one stops working. Paste the new token into
Flow Companion once (keep "Nhớ mã truy cập" ticked). "Quên mã truy cập" in the
extension only forgets the token on this device — it does not rotate the
bridge token.

`FLOW_BRIDGE_TOKEN` env var still works as a CI/dev override (never persisted,
never printed). If the saved token file is unreadable, the bridge refuses to
start instead of silently rotating — run `flow:bridge:reset-token` explicitly.
