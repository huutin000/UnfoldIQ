# Step 12 → Step 13 chain (pipeline, QA, fix, final)

Step 12 produces a validated render input (`lib/render-input-builder.js`),
a derived render plan (`scripts/cli/render-plan-cli.js`), and staged assets
(`lib/asset-stager.js`). Step 13 consumes exactly those artifacts — it never
invents production work and never re-derives inputs from scratch.

Chain (see `pipeline/render-orchestrator.js`):

1. `prepare` — validate inputs, stage assets, derive plan, fingerprint
   (`pipeline/input-fingerprint.js`), set checkpoints. Ends
   `READY_TO_RENDER`.
2. `render` — one pipeline attempt per loop iteration
   (`render/attempts/attempt-NNN/`), driven by `pipeline/remotion-render-runner.js`
   with throttled progress (`PROGRESS_THROTTLE_MS`). A Remotion internal
   frame retry is never a pipeline attempt: one run owns exactly one
   attempt dir and one `progress.jsonl`.
3. Technical QA — `qa/technical-qa.js` (`runTechnicalQa`): bytes, not
   meaning. PASS means "technically renderable", never "editorially good".
   ffprobe missing/unreadable yields UNKNOWN + `REVIEW_REQUIRED`, never a
   fabricated PASS.
4. Visual evidence — `qa/frame-sampler.js` + `qa/contact-sheet.js`
   (dependency-free HTML grid) + `qa/visual-qa.js` (`buildReviewPacket`):
   `MACHINE_CHECKED` packets with a PENDING checklist. No semantic PASS.
5. Review — `qa/visual-qa.js` (`submitReview`) validates against
   `schemas/visual-review.schema.json`; `AGENT_REVIEWED`/`HUMAN_REVIEWED`
   only via a recorded verdict. `scripts/cli/pipeline-cli.js submit-visual-review`
   is the CLI path.
6. Fix — failures are classified (`pipeline/render-error-classifier.js`);
   resource classes retry with halved concurrency (`render-config.js`);
   `pipeline/auto-fix.js` (`planFix`/`applyFix`) executes SAFE_AUTOMATIC
   actions only (restage, rebuild plan/sidecars, knobs, temp cleanup).
   Content edits (rewrite, regenerate, provider calls, drops) are forbidden.
   Cross-attempt issue tracking lives in `qa/qa-diff.js`; any OPEN
   BLOCKER/ERROR blocks finalize promotion (`BLOCKED_FINAL`).
7. Final — `pipeline/finalize-output.js` (`finalize`) promotes an accepted
   attempt (PASSED or RENDERED + technical PASS + approved visual) with a
   current fingerprint to `out/<id>/final.mp4` atomically, keeping
   `final.prev.mp4`, sidecars, QA report, and all attempt evidence.

Recovery: `pipeline/reconcile.js` decides resume (`CONTINUE_FROM_CHECKPOINT`,
`RUN_QA`, `NEW_RENDER_ATTEMPT`, `FINAL_ALREADY_READY`); interrupted work is
never frame-resumed — always a fresh attempt. `pipeline/pipeline-lock.js`
serializes operations; cancel is terminal and never auto-retried.
`pipeline/cleanup.js` touches only managed temp/stale-staging paths.

No Flow/ComfyUI internals load in this chain unless an upstream repair is
explicitly selected.
