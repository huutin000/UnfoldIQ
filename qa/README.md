# qa/ — Step 13 QA hooks (Branch C owns the modules; Branch B owns the contract)

The render orchestrator (`pipeline/render-orchestrator.js`) invokes these hooks
through **guarded requires**: if a module is absent, the attempt is recorded
with a `QA_DEFERRED` history note and `qa` stays `null` — the orchestrator
never crashes on missing QA.

## Expected modules (Branch C)

- `technical-qa.js` — exports `runTechnicalQa({ projectRoot, projectId, attempt })`
  (or `check(...)`). Returns a result object with at least `{ status }` where
  status is `PASS` / `FAIL` / `REVIEW_REQUIRED`. Machine checks only: file
  existence, container probe (ffprobe, guarded), frame-count vs plan,
  caption-sidecar freshness flags (`captionsStale`).
- `visual-evidence.js` (or `visual-qa.js`) — exports `collectEvidence(...)`
  (or `runVisualQa` / `check`). Returns machine-collectable evidence
  (frame hashes, thumbnails manifest). Never claims semantic understanding.

## Machine-vs-semantic QA honesty note

Automated checks verify **bytes, not meaning**: they can assert that frames
exist, that the container decodes, that captions align to measured timing —
they cannot judge story, taste, or brand fit. Any `PASS` from machine QA
means "technically renderable", never "editorially good". Production
promotion additionally requires a recorded human/agent visual review
(`scripts/cli/pipeline-cli.js submit-visual-review ...` → `APPROVE` / `HUMAN_REVIEWED` /
`AGENT_REVIEWED`); TEST-ONLY fixtures may pass `allowMachineOnly:true`.

## No-upload policy

QA modules must not upload media anywhere, call paid/provider APIs, or fetch
remote resources. All evidence stays under `projects/<id>/render/attempts/`
and `out/<projectId>/`. Attempt evidence is never deleted by finalize.
