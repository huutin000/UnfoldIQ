# STEP 10C REPORT

## 1. Status

`PASS`

Step 10C implementation complete. All 139 acceptance criteria PASS. Step 10 is COMPLETE (10A + 10A-FIX + 10B + 10C).

## 2. Work Completed

### Local Media Doctor
- Created `local-media-doctor.js` (inspection-only CLI, `--json` mode, exit 0 always; never pip/npm install, clone, download, launch model, or mutate global config).
- Real detection on this machine: win32 x64, 12x i5-11400H, RAM 15.78 GB, NVIDIA RTX 3050 Laptop GPU 4 GB VRAM, disk free 202.72 GB.
- ComfyUI: registry present (3 workflows), server NOT_AVAILABLE (not installed), video 0 enabled workflows.
- Kokoro: Python 3.12.10 present, package NOT installed, langs metadata-only.
- whisper.cpp: binary/model/server all NOT_CONFIGURED; no transcription attempted.

### ComfyUI
- `providers/local/comfyui/`: README, `workflow-registry.yaml` (1 enabled mock image workflow + 2 disabled examples, no model bundled), `workflow-loader.js`, `parameter-mapper.js` (deterministic, continuity refs never dropped), `client.js` (loopback-only, bounded poll, traversal rejection), `workflows/mock-image-test.json`.
- `providers/runtime/adapters/local-comfyui-image.js` and `local-comfyui-video.js` (video gated FIRST by hardware policy → `UNSUITABLE_BY_POLICY`, resolver falls through; not a failure).

### Kokoro
- `providers/runtime/adapters/local-kokoro.js`: 9 official languages (en-us, en-gb, hi, es, fr, it, pt-br, ja, zh). Vietnamese (`vi`) → `KOKORO_LANGUAGE_UNSUPPORTED` (NOT_AVAILABLE family), never synthesized with an English voice. Voice validation, speed [0.5,2.0], zero-byte rejection, deterministic `assets/voice/<scene>/<request>.wav`, no voice-cloning claim.

### whisper.cpp
- `providers/runtime/adapters/local-whisper.js`: extension allowlist, binary/model detection, `MODEL_MISSING` without auto-download, measured-only segments (start/end ms preserved), timing artifact `timing/<scene>/<request>.json` + transcript `.txt`, project-path confinement.

### Agent Native
- `providers/agent-native/`: README (protocol), `capability-contract.schema.json`, `result-submission.schema.json`.
- `providers/runtime/adapters/agent-native-registry.js`: session-scoped declarations with TTL (not eternal) + `AGENT_ACTION` handoff packet.
- `provider-cli.js --submit-agent-result`: schema/path/safety validation, BLOCKED terminal (exit 2), provenance records agent/tool. No product hard dependency.

### Media MCP
- `mcp/unfoldiq-media/`: zero-dependency stdio server (initialize/tools-list/tools-call/cancelled-ack, clean shutdown), 8 tools delegating to the provider resolver (no duplicated selection logic), concise schemas, bounded responses, secret stripping, traversal rejection.
- Safety states (`PROVIDER_SAFETY_REFUSED`, BLOCKED) preserved end-to-end; adapted retry still requires fresh approval; `SAFETY_REFUSAL_UNRESOLVED` guard on result submission.
- Integration guides: OPENCODE, ANTIGRAVITY, ZCODE, GENERIC_MCP (+ `generated/` placeholder; no global config mutation).

### Cloud Fallback
- `openai-image`, `google-veo`, `elevenlabs-tts`, `elevenlabs-stt` (all `PAID`, disabled unless `costConstraints.allowPaidCloud=true` AND `ctx.enableCloud=true`), `configured-cloud-{image,video,tts,stt}` (cost `UNKNOWN`, never `FREE_TIER`). Env-only secrets, `NOT_CONFIGURED` on missing key, HTTP errors classified, safety-like responses → structured `safetyRefusal` without auto-retry/rewrite. No live paid calls.
- `providers/CONFIG.yaml`: `configured-free-cloud-*` renamed to `configured-cloud-*`; image/video/tts/stt orders updated; flow-web stays primary video route; policies unchanged.

### Provider Resolution
- Resolver extended (additive): safety statuses/refusals surface immediately instead of falling through to the next provider as a silent technical retry. `external-handoff` packet now preserves `safetyContext` (refusal reason/class, original intent, claims, continuity).
- `registerAllProviders()` in bootstrap (keeps `registerCoreProviders()` intact for 10A tests).

### Final Step 10 Readiness
- `step10-readiness.js`: architecture PASS (7/7) reported SEPARATELY from live availability (all NOT_VERIFIED/not-set, truthful) and safe fallback (PASS).
- `provider-doctor.js` finalized: Core / Flow (+ §28A origin coverage) / Local / MCP / Cloud / Agent Native sections; no secrets.
- Context router updated: stage-10 conditionals for local-comfyui, kokoro, whisper, MCP, capability-matrix.
- New regression: `test-flow-origin.js` (ORIGIN-1..4).

## 3. Files Created

- `local-media-doctor.js`
- `step10-readiness.js`
- `providers/runtime/hardware-policy.js`
- `providers/runtime/timeout-policy.js`
- `providers/runtime/adapters/local-comfyui-image.js`
- `providers/runtime/adapters/local-comfyui-video.js`
- `providers/runtime/adapters/local-kokoro.js`
- `providers/runtime/adapters/local-whisper.js`
- `providers/runtime/adapters/agent-native-registry.js`
- `providers/runtime/adapters/cloud-openai-image.js`
- `providers/runtime/adapters/cloud-google-veo.js`
- `providers/runtime/adapters/cloud-elevenlabs-tts.js`
- `providers/runtime/adapters/cloud-elevenlabs-stt.js`
- `providers/runtime/adapters/configured-cloud.js`
- `providers/local/README.md`
- `providers/local/SETUP_COMFYUI.md`
- `providers/local/SETUP_KOKORO.md`
- `providers/local/SETUP_WHISPER.md`
- `providers/local/comfyui/README.md`
- `providers/local/comfyui/workflow-registry.yaml`
- `providers/local/comfyui/workflow-loader.js`
- `providers/local/comfyui/parameter-mapper.js`
- `providers/local/comfyui/client.js`
- `providers/local/comfyui/workflows/README.md`
- `providers/local/comfyui/workflows/mock-image-test.json`
- `providers/agent-native/README.md`
- `providers/agent-native/capability-contract.schema.json`
- `providers/agent-native/result-submission.schema.json`
- `providers/CAPABILITY_MATRIX.md`
- `mcp/unfoldiq-media/package.json`
- `mcp/unfoldiq-media/server.js`
- `mcp/unfoldiq-media/tools/index.js`
- `mcp/unfoldiq-media/schemas/capabilities.schema.json`
- `mcp/unfoldiq-media/schemas/resolve-request.schema.json`
- `mcp/unfoldiq-media/schemas/submit-result.schema.json`
- `mcp/unfoldiq-media/tests/run.js`
- `mcp/unfoldiq-media/README.md`
- `mcp/unfoldiq-media/integrations/OPENCODE.md`
- `mcp/unfoldiq-media/integrations/ANTIGRAVITY.md`
- `mcp/unfoldiq-media/integrations/ZCODE.md`
- `mcp/unfoldiq-media/integrations/GENERIC_MCP.md`
- `mcp/unfoldiq-media/integrations/generated/.gitkeep`
- `test-comfyui-provider.js`
- `test-kokoro-provider.js`
- `test-whisper-provider.js`
- `test-agent-native-bridge.js`
- `test-media-mcp.js`
- `test-cloud-providers.js`
- `test-provider-resolution-e2e.js`
- `test-safety-provider-integration.js`
- `test-flow-origin.js`
- `Report/STEP-10C_REPORT.md` (this file)

## 4. Files Modified

- `providers/runtime/bootstrap.js` — added `registerAllProviders()` (additive; `registerCoreProviders()` unchanged).
- `provider-cli.js` — added `--submit-agent-result`; fixed 10C register paths; wired 10C registration into dry-run/execute (existing modes intact).
- `providers/runtime/resolver.js` — additive safety-state passthrough (refusals surface, never silent-fallthrough).
- `providers/runtime/adapters/external-handoff.js` — additive `safetyContext` preservation in handoff packet.
- `providers/runtime/adapters/agent-native.js` — session-registry fallback added; bridge behavior unchanged.
- `providers/runtime/adapters/flow-web.js` — appended `checkFlowOriginCoverage` + constants only; behavior unchanged.
- `mcp/unfoldiq-media/tools/index.js` — registered local adapters in runtime; added `SAFETY_REFUSAL_UNRESOLVED` guard.
- `provider-doctor.js` — rewritten to §28 final format + §28A origin section.
- `providers/CONFIG.yaml` — renamed generic cloud slots; updated orders; added provider notes.
- `context/ROUTES.yaml`, `context/DOC_CATALOG.yaml` — stage-10 conditionals for local/MCP/matrix docs.

## 5. Dependencies Changed

None. No new npm dependencies. MCP server uses Node builtins only. Extension build uses existing dev setup.

## 6. Commands Executed

| Command | Result |
|---|---|
| `node local-media-doctor.js` | EXIT 0 — RTX 3050 4 GB, ComfyUI NOT_AVAILABLE, Kokoro pkg NOT_CONFIGURED, whisper NOT_CONFIGURED |
| `node flow-companion-doctor.js` | EXIT 0 — all bridge/extension/path/secret checks OK |
| `node provider-doctor.js` | EXIT 0 — all 6 sections reported, no secrets |
| `node step10-readiness.js` | EXIT 0 — architecture PASS 7/7, live truthfully NOT_VERIFIED, fallback PASS |
| `node test-comfyui-provider.js` | EXIT 0 — CI1–CI12 PASS (15 assertions) |
| `node test-kokoro-provider.js` | EXIT 0 — KO1–KO10 PASS (16 assertions) |
| `node test-whisper-provider.js` | EXIT 0 — WH1–WH10 PASS (12 assertions) |
| `node test-agent-native-bridge.js` | EXIT 0 — AN1–AN10 PASS |
| `node test-media-mcp.js` | EXIT 0 — MCP1–MCP15 PASS (36 assertions) |
| `node test-cloud-providers.js` | EXIT 0 — CL1–CL10 PASS (16 assertions) |
| `node test-provider-resolution-e2e.js` | EXIT 0 — PR-E2E1–10 PASS (12 assertions) |
| `node test-safety-provider-integration.js` | EXIT 0 — SAFE-E2E1–8 PASS (11 assertions) |
| `node test-flow-origin.js` | EXIT 0 — ORIGIN-1–4 PASS |
| `node test-flow-safety-retry.js` | EXIT 0 — SR1–SR20 PASS (34 assertions) |
| `node test-flow-jobs.js` | EXIT 0 — 34 assertions PASS |
| `node test-flow-state-machine.js` | EXIT 0 — 15 assertions PASS |
| `node test-flow-bridge.js` | EXIT 0 — 15 assertions PASS |
| `node test-flow-page-adapter.js` | EXIT 0 — 20 assertions PASS |
| `node test-flow-download-import.js` | EXIT 0 — 15 assertions PASS |
| `node test-flow-manual-assist.js` | EXIT 0 — 12 assertions PASS |
| `node test-provider-core.js` | EXIT 0 — 43 assertions PASS |
| `node test-continuity.js` | EXIT 0 — 20 assertions PASS |
| `node test-duration-planning.js` | EXIT 0 — 37 assertions PASS |
| `node test-context-routing.js` | EXIT 0 — 34 assertions PASS |
| `node test-policy-refresh.js` | EXIT 0 — 8 assertions PASS |
| `node test-policy-rights.js` | EXIT 0 — 26 assertions PASS |
| `node test-topic-registry.js` | EXIT 0 — PASS |
| `node test-editorial-quality.js` | EXIT 0 — 37 assertions PASS |
| `node validate-schemas.js` | EXIT 0 — ALL SCHEMAS PASS (incl. 2 new agent-native schemas) |
| `node mcp/unfoldiq-media/tests/run.js` | EXIT 0 — 5/5 PASS |
| `node context-resolver.js --stage 10 --platform youtube` | EXIT 0 — required + conditional routes resolve |
| `cd flow-companion/extension; npm test` | EXIT 0 — passed=6 failed=0 |
| `cd flow-companion/extension; npm run build` | EXIT 0 — BUILD_OK chrome-mv3, 8 files, minimal permissions |
| `npx remotion compositions` (in `remotion/`) | EXIT 0 — `blank 30 1920x1080 60 (2.00 sec)` |

## 7. Acceptance Criteria Validation

All 139 criteria PASS with evidence (E = evidence ref):

1. PASS — `local-media-doctor.js` exists (E: §8 output).
2. PASS — doctor inspection-only (E: source has no install/clone/download/launch; KO9 test).
3. PASS — GPU/VRAM detection (E: RTX 3050 4 GB via nvidia-smi).
4. PASS — ComfyUI reachability reported (E: NOT_AVAILABLE 127.0.0.1:8188).
5. PASS — ComfyUI model/workflow availability (E: 3 workflows, enabled-model check).
6. PASS — Kokoro availability (E: Python 3.12 present, package NOT_CONFIGURED).
7. PASS — Kokoro language capability (E: 9 langs listed, §11).
8. PASS — whisper binary reported (E: NOT_CONFIGURED).
9. PASS — whisper model reported (E: NOT_CONFIGURED).
10. PASS — heavy local video policy respected (E: CI9 UNSUITABLE_BY_POLICY).
11. PASS — unknown suitability never auto-AVAILABLE (E: hardware-policy returns UNKNOWN without metadata).
12. PASS — workflow registry exists (E: `workflow-registry.yaml`, 3 entries).
13. PASS — image adapter exists (E: CI2 READY).
14. PASS — video adapter exists (E: CI9 gate + §10).
15. PASS — no single model hard-coded (E: registry-driven; example workflows disabled).
16. PASS — no auto checkpoint download (E: CI8).
17. PASS — output via artifact store (E: CI2 artifact exists under projects/).
18. PASS — timeout bounded (E: CI7 explicit TIMEOUT; timeout-policy).
19. PASS — workflow/model provenance (E: CI11).
20. PASS — image continuity bindings (E: CI12).
21. PASS — video continuity bindings (E: parameter-mapper `mapVideoParams` + continuity passthrough).
22. PASS — local video skippable as unsuitable (E: CI10 fall-through).
23. PASS — local-kokoro adapter exists (E: KO2).
24. PASS — TTS capability registered (E: provider-doctor Local section).
25. PASS — language validation (E: KO3).
26. PASS — unsupported language never wrong-voice synthesizes (E: KO3 throws before transport).
27. PASS — voice validation (E: KO4 UNKNOWN_VOICE).
28. PASS — deterministic output path (E: `assets/voice/<scene>/<request>.wav`; KO2/KO6).
29. PASS — output validation (E: KO5 zero-byte rejected).
30. PASS — no voice-cloning claim (E: KO8 + explicit disclaimer in source).
31. PASS — provenance/version recorded (E: KO7).
32. PASS — no auto-install from doctor (E: KO9).
33. PASS — local-whisper adapter exists (E: WH3).
34. PASS — STT capability registered (E: provider-doctor).
35. PASS — binary/model detection (E: WH1/WH2).
36. PASS — real measured segment timestamps (E: WH4 ms preserved, timingSource measured).
37. PASS — no fabricated timing (E: WH5).
38. PASS — timing artifact stored (E: WH3 `timing/<scene>/<request>.json`).
39. PASS — project path confinement (E: WH6).
40. PASS — existing timestamps preferred (E: WH10 order check).
41. PASS — runtime capability contract exists (E: `capability-contract.schema.json`, validate-schemas PASS).
42. PASS — no implicit native capability (E: AN1, AN3).
43. PASS — action/handoff packet exists (E: AN2 `AGENT_NATIVE_GENERATE`).
44. PASS — result submission path exists (E: AN4 CLI + MCP submit).
45. PASS — job/request identity validated (E: AN5).
46. PASS — artifact path validated (E: AN6, MCP10).
47. PASS — provenance records agent/tool (E: AN7).
48. PASS — continuity preserved (E: AN8).
49. PASS — runtime/session declaration (E: AN10 TTL expiry).
50. PASS — no product hard dependency (E: README + bridge-agnostic design).
51. PASS — Media MCP exists (E: server.js + MCP1).
52. PASS — stdio protocol works (E: MCP1/MCP15).
53. PASS — media_capabilities (E: MCP3).
54. PASS — resolve_media_request (E: MCP4).
55. PASS — generate_image (E: MCP5).
56. PASS — generate_video (E: MCP6).
57. PASS — generate_tts (E: MCP7).
58. PASS — transcribe_media (E: MCP8 dry-run + WH coverage).
59. PASS — submit_media_result (E: MCP12).
60. PASS — get_media_job (E: SAFE-E2E4 via MCP).
61. PASS — MCP delegates to runtime (E: tools/index.js uses resolver.resolve; no candidate logic duplicated).
62. PASS — no duplicated resolver (E: source review; MCP4/MCP5 delegate).
63. PASS — provider statuses preserved (E: MCP5/MCP6/MCP9 passthrough incl. AWAITING/BLOCKED).
64. PASS — BLOCKED remains BLOCKED (E: MCP9, SAFE-E2E2).
65. PASS — traversal rejected (E: MCP10).
66. PASS — no secrets returned (E: MCP11).
67. PASS — bounded responses (E: MCP14).
68. PASS — clean shutdown (E: MCP15 + stdin end/close handlers).
69. PASS — OpenCode guide exists (E: `integrations/OPENCODE.md`, project-local format).
70. PASS — Antigravity guide exists (E: `integrations/ANTIGRAVITY.md`, no native-video assumption).
71. PASS — ZCode guide exists (E: `integrations/ZCODE.md`, no marketplace publish).
72. PASS — generic guide exists (E: `integrations/GENERIC_MCP.md`).
73. PASS — no automatic global edits (E: guides document only; `generated/` placeholder).
74. PASS — openai-image disabled by default (E: CL1).
75. PASS — google-veo disabled by default (E: CL1).
76. PASS — elevenlabs-tts disabled by default (E: CL1).
77. PASS — elevenlabs-stt disabled by default (E: CL1).
78. PASS — missing key → NOT_CONFIGURED (E: CL2).
79. PASS — allowPaidCloud:false enforced (E: CL3 + resolver cost filter).
80. PASS — env-only secrets (E: CL8 no persistence; doctor/MCP print none).
81. PASS — no live paid calls in tests (E: mocks only; CL4–CL7).
82. PASS — no fabricated free tier (E: CL10; cost UNKNOWN).
83. PASS — slots renamed without "free" (E: CL10 config check).
84. PASS — cloud errors classified (E: CL9 transient/permanent).
85. PASS — Flow primary video route (E: PR-E2E4; CONFIG video order).
86. PASS — local image supported (E: PR-E2E2).
87. PASS — Flow image not globally mandatory (E: image order keeps agent-native/local before flow-web).
88. PASS — continuity-aware image preference (E: PR-E2E3 strict-ref → flow-web).
89. PASS — local heavy video not forced (E: PR-E2E5).
90. PASS — TTS unsupported falls through (E: PR-E2E7, MCP7).
91. PASS — STT prefers existing timestamps (E: WH10).
92. PASS — external/manual handoff final fallback (E: PR-E2E5, MCP5).
93. PASS — no duration coupling (E: Veo adapter comment + duration tests PASS; §19).
94. PASS — rights/policy preconditions preserved (E: PR-E2E9).
95. PASS — no BLOCKED bypass (E: SAFE-E2E2).
96. PASS — no arbitrary filesystem writes (E: traversal tests CI4/WH6/AN6/MCP10).
97. PASS — no shell injection from MCP/browser (E: no shell execution in MCP/tools; extension sender-check + build guard PASS).
98. PASS — no secret persistence (E: CL8, MCP11, doctor output).
99. PASS — loopback/local default safe (E: ComfyUI client rejects non-loopback; bridge localhost-only).
100. PASS — cancellation/retry bounded (E: MAX_TRANSIENT_ATTEMPTS=2; poll deadlines; job cancel states intact).
101. PASS — CI1–CI12 (E: §6 table).
102. PASS — KO1–KO10 (E: §6 table).
103. PASS — WH1–WH10 (E: §6 table).
104. PASS — AN1–AN10 (E: §6 table).
105. PASS — MCP1–MCP15 (E: §6 table).
106. PASS — CL1–CL10 (E: §6 table).
107. PASS — PR-E2E1–10 (E: §6 table).
108. PASS — all Step 10B tests (E: r1–r6 logs, extension test/build).
109. PASS — provider core (E: 43 assertions).
110. PASS — continuity (E: 20 assertions).
111. PASS — duration (E: 37 assertions).
112. PASS — context (E: 34 assertions + ctx.log).
113. PASS — policy (E: refresh 8 + rights 26 assertions).
114. PASS — topic registry (E: PASS).
115. PASS — editorial/research (E: 37 assertions).
116. PASS — schemas (E: validate-schemas PASS incl. new agent-native schemas).
117. PASS — extension tests/build (E: 6 passed, BUILD_OK).
118. PASS — Remotion compositions (E: blank composition listed).
119. PASS — SR1–SR20 (E: 34 assertions, sr.log).
120. PASS — SAFE-E2E1–8 (E: §6 table).
121. PASS — MCP preserves provider-safety states (E: SAFE-E2E1).
122. PASS — BLOCKED terminal through MCP/providers (E: SAFE-E2E2).
123. PASS — adapted retries need fresh approval (E: SAFE-E2E3).
124. PASS — fallback state visible/actionable (E: SAFE-E2E4 get_media_job).
125. PASS — no safety-evasion logic (E: SAFE-E2E8 scan).
126. PASS — no production final video (E: no render executed; only `compositions` listing).
127. PASS — no publishing (E: nothing published).
128. PASS — no analytics (E: nothing added).
129. PASS — no Step 11 implementation (E: no preflight/audio/caption artifacts created).
130. PASS — no automatic large model download (E: CI8, WH2, doctors download nothing).
131. PASS — no cloud billing/top-up (E: no live calls; CL1–CL3 gates).
132. PASS — no global agent config mutation (E: §73 evidence).
133. PASS — architecture PASS without installed tools (E: readiness splits implementation vs live).
134. PASS — live availability truthful (E: §8 doctor output verbatim).
135. PASS — readiness distinguishes implementation/live/fallback (E: ready.log).
136. PASS — Flow entrypoint/origin compatibility reported (E: provider-doctor Flow section).
137. PASS — labs.google/fx fixture covered (E: ORIGIN-1).
138. PASS — flow.google fixture exact-permission policy (E: ORIGIN-2, no `<all_urls>`).
139. PASS — unknown origin fails safe (E: ORIGIN-3/ORIGIN-4).

## 8. Local Media Doctor Evidence

Actual output of `node local-media-doctor.js` on this machine (2026-09-26):

```text
UNFOLDIQ local-media-doctor (inspection only)
[system]
  AVAILABLE        os — win32 10.0.26200 (x64)
  AVAILABLE        cpu — 12x 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz
  AVAILABLE        ram — total 15.78GB free 5.1GB
  AVAILABLE        gpu — NVIDIA GeForce RTX 3050 Laptop GPU vram 4GB
  AVAILABLE        disk — free 202.72GB
[comfyui]
  NOT_CONFIGURED   comfyui.command — COMFYUI_CMD unset; registry file present
  AVAILABLE        comfyui.registry — 3 workflow(s) in registry
  NOT_AVAILABLE    comfyui.server — not reachable http://127.0.0.1:8188/system_stats
  UNKNOWN          comfyui.version — version not detectable
  AVAILABLE        comfyui.capability.image — 1 enabled image workflow(s)
  NOT_CONFIGURED   comfyui.capability.video — 0 enabled video workflow(s)
  AVAILABLE        comfyui.models — enabled workflows reference no models (mock/test)
[kokoro]
  AVAILABLE        kokoro.python — Python 3.12.10
  NOT_CONFIGURED   kokoro.package — kokoro package not importable
  NOT_CONFIGURED   kokoro.env.voices — KOKORO_VOICES unset
  NOT_CONFIGURED   kokoro.env.langs — KOKORO_LANGS unset
  AVAILABLE        kokoro.languages — supported: en (metadata only; no audio generated)
  UNKNOWN          kokoro.synth — not attempted — doctor never generates audio
[whisper]
  NOT_CONFIGURED   whisper.binary — WHISPER_CPP_BIN unset; whisper-cli not on PATH
  NOT_CONFIGURED   whisper.model — WHISPER_CPP_MODEL unset
  NOT_CONFIGURED   whisper.server — WHISPER_CPP_SERVER_URL unset (optional)
  UNKNOWN          whisper.transcribe — not attempted — doctor never transcribes
```

No tool is inferred as installed. Doctor performed zero installs/downloads/generations.

## 9. Hardware Policy Evidence

Detected: NVIDIA GeForce RTX 3050 Laptop GPU, VRAM 4 GB, RAM 15.78 GB.
Project policy: `avoidHeavyLocalVideoByDefault: true`.

- `example-video-wan` (heavy, minVramGB 12): requirement metadata (4 GB actual < 12 GB) AND policy gate → `UNSUITABLE_BY_POLICY` (CI9). Resolver proceeds to Flow/external (CI10), not a failure.
- Workflows without reliable requirement metadata → `UNKNOWN`, never `AVAILABLE` (hardware-policy unit path).
- No GPU model name is hard-coded; no stress test executed.

## 10. ComfyUI Evidence

CI1 PASS (absent server → NOT_AVAILABLE) · CI2 PASS (mock → READY png, file exists) · CI3 PASS (missing model → MODEL_MISSING) · CI4 PASS (traversal rejected) · CI5 PASS (unknown workflow rejected) · CI6 PASS (deterministic mapping) · CI7 PASS (explicit TIMEOUT) · CI8 PASS (no download code) · CI9 PASS (UNSUITABLE_BY_POLICY) · CI10 PASS (fall-through to flow-web) · CI11 PASS (workflowId provenance) · CI12 PASS (continuity refs survive).

**No real ComfyUI installation/workflow was live-tested** (server NOT_AVAILABLE on this machine). Architecture PASS rests on mock-transport tests + registry/loader/mapper/client unit paths.

## 11. Kokoro Evidence

KO1 PASS (missing package → NOT_AVAILABLE) · KO2 PASS (mock → READY WAV, non-empty) · KO3 PASS (`vi` → KOKORO_LANGUAGE_UNSUPPORTED, transport never called) · KO4 PASS (unknown voice) · KO5 PASS (zero-byte rejected) · KO6 PASS (speed passthrough) · KO7 PASS (model/voice/lang provenance) · KO8 PASS (no cloning) · KO9 PASS (doctor installs nothing) · KO10 PASS (resolver fall-through).

Supported languages (from adapter metadata + official https://github.com/hexgrad/kokoro): en-us, en-gb, hi, es, fr, it, pt-br, ja, zh.
**Vietnamese status: UNSUPPORTED.** The official Kokoro package exposes no Vietnamese voice; the adapter refuses `vi`/`vn` before any synthesis. The Kokoro package itself is NOT installed on this machine, so no live synthesis was performed at all.

## 12. whisper.cpp Evidence

WH1 PASS (WHISPER_NOT_AVAILABLE/MODEL_MISSING family) · WH2 PASS (MODEL_MISSING branch) · WH3 PASS (mock segments imported) · WH4 PASS (0/1200 ms preserved) · WH5 PASS (measured-only) · WH6 PASS (traversal rejected) · WH7 PASS (`.exe` rejected) · WH8 PASS (language optional) · WH9 PASS (model provenance) · WH10 PASS (existing-timestamps first).

**No real local model exists** (binary NOT_CONFIGURED, model NOT_CONFIGURED). No transcription executed outside mocks.

## 13. Agent Native Evidence

AN1 PASS (no declaration → NOT_AVAILABLE) · AN2 PASS (declared image → AGENT_NATIVE_GENERATE handoff) · AN3 PASS (video not assumed) · AN4 PASS (valid submit → READY) · AN5 PASS (wrong job rejected) · AN6 PASS (external path rejected) · AN7 PASS (agent/tool provenance) · AN8 PASS (continuity preserved) · AN9 PASS (empty artifact rejected) · AN10 PASS (TTL expiry → not capable).

No assumption is made about Antigravity/ZCode/OpenCode native media: capabilities are per-session declarations verified in AN1/AN3/AN10.

## 14. MCP Evidence

MCP1–MCP15 all PASS (36 assertions). Tool catalog (8): `media_capabilities, resolve_media_request, generate_image, generate_video, generate_tts, transcribe_media, submit_media_result, get_media_job`. Server self-test (`tests/run.js`): 5/5. Responses bounded (promptSummary ≤ 200 chars, tool descriptions < 300 chars).

## 15. Agent Integration Evidence

- OpenCode: `mcp/unfoldiq-media/integrations/OPENCODE.md` created (project-local config, health + capability test). Real connection in OpenCode: NOT_VERIFIED.
- Antigravity: `integrations/ANTIGRAVITY.md` created (registration + agent-native submit-back; no native-video assumption). Real connection in Antigravity: NOT_VERIFIED.
- ZCode: `integrations/ZCODE.md` created (local config + future plugin option, not published). Real connection in ZCode: NOT_VERIFIED.
- Verified instead: stdio `initialize` handshake, `tools/list`, in-process dispatch (MCP1–MCP15), `tests/run.js`. No global configs were edited (only `integrations/generated/.gitkeep` placeholder).

## 16. Cloud Provider Evidence

CL1–CL10 all PASS. All four paid adapters disabled by default (CLOUD_NOT_ENABLED without dual enable); missing key → NOT_CONFIGURED; `allowPaidCloud:false` blocks execution at the resolver cost filter; mocks used for CL4–CL7; filesystem scan confirms no secret persisted (CL8); no key printed anywhere (env `not-set` in doctor). Zero live paid calls.

## 17. Provider Resolution E2E

| Scenario | Result |
|---|---|
| PR-E2E1 existing reuse | PASS — existing/READY |
| PR-E2E2 simple image → local | PASS — local-comfyui-image/READY |
| PR-E2E3 strict ref → flow-web | PASS — flow-web/HANDOFF_REQUIRED |
| PR-E2E4 project video → flow-web | PASS — flow-web/HANDOFF_REQUIRED |
| PR-E2E5 flow unavailable → handoff | PASS — HANDOFF_REQUIRED, heavy video not forced |
| PR-E2E6 TTS en → kokoro | PASS — local-kokoro/READY |
| PR-E2E7 TTS vi → fallthrough | PASS — no kokoro READY |
| PR-E2E8 STT → whisper | PASS — local-whisper/READY |
| PR-E2E9 policy blocked | PASS — BLOCKED |
| PR-E2E10 paid enabled mock cloud | PASS — openai-image/READY |

## 18. Flow + Safety Regression

- 10B suites PASS: flow-jobs (34), state-machine (15), bridge (15), page-adapter (20), download-import (15), manual-assist (12), extension tests (6/6), extension build (BUILD_OK).
- SR1–SR20 PASS (34 assertions, `test-flow-safety-retry.js`).
- SAFE-E2E1–8 PASS (11 assertions): safety refusal surfaces as `PROVIDER_SAFETY_REFUSED` through resolver (never generic FAILED retry); Step 09 BLOCKED terminal through MCP; adapted retry gated on fresh approval (`APPROVAL_REQUIRED` enforced); `SAFE_FALLBACK_REQUIRED` visible via `get_media_job`; handoff packet preserves intent/claims/continuity/refusal; refused job cannot become READY without valid superseding result; mock cloud safety classified without retry; evasion scan clean.
- Live UI/generation state: NOT_VERIFIED (no browser, no credits consumed) — reported exactly as known.

## 19. Continuity / Duration Regression

- `test-continuity.js`: 20 assertions PASS (STRICT preconditions, lock semantics intact).
- `test-duration-planning.js`: 37 assertions PASS (duration contract is the source of truth; no clip-count/media-duration coupling introduced — Veo adapter carries an explicit render-hint-only comment).

## 20. Step 10 Capability Matrix

See `providers/CAPABILITY_MATRIX.md` (implementation vs live availability split). Summary:

| Provider | Capability | Implementation | Live availability | Cost class | Approval | Notes |
|---|---|---|---|---|---|---|
| existing | all | READY | AVAILABLE | ZERO_LOCAL | no | fingerprint reuse |
| approved-local | image/video/music/sfx | READY | AVAILABLE (library-dependent) | ZERO_LOCAL | no | rights-checked |
| agent-native | image/video/tts/stt | READY (bridge) | BRIDGE_NOT_CONFIGURED | ZERO_LOCAL | no | session-declared only |
| flow-web | image/video | READY | NOT_VERIFIED (UI/credits) | INCLUDED_SUBSCRIPTION | yes | primary video route; manual-assist fallback |
| local-comfyui-image | image | READY | NOT_AVAILABLE (no server) | ZERO_LOCAL | no | registry-driven; mock tested |
| local-comfyui-video | video | READY | UNSUITABLE_BY_POLICY | ZERO_LOCAL | no | heavy; policy-skipped |
| local-kokoro | tts | READY | NOT_CONFIGURED (pkg missing) | ZERO_LOCAL | no | 9 langs; vi unsupported |
| local-whisper | stt | READY | NOT_CONFIGURED | ZERO_LOCAL | no | measured timing only |
| openai-image | image | READY | NOT_CONFIGURED | PAID | yes | dual-enable gate |
| google-veo | video | READY | NOT_CONFIGURED | PAID | yes | distinct from flow-web |
| elevenlabs-tts | tts | READY | NOT_CONFIGURED | PAID | yes | dual-enable gate |
| elevenlabs-stt | stt | READY | NOT_CONFIGURED | PAID | yes | timing artifact |
| configured-cloud-* | image/video/tts/stt | READY | NOT_CONFIGURED | UNKNOWN | yes | no free-tier claim |
| remote-mcp-video | video | PLANNED | NOT_VERIFIED | UNKNOWN | yes | resolver-skipped until registered |
| external-handoff | all | READY | AVAILABLE | UNKNOWN | n/a | terminal fallback + safety packet |

## 21. Step 10 Readiness

Output of `node step10-readiness.js` (verbatim structure, see §6/ready.log):

- architecture: coreRuntime PASS, continuity PASS, duration PASS, flowCompanion PASS, localProviders PASS, mcp PASS, cloudFallback PASS → overall PASS.
- liveAvailability: flowLiveUI/Gene
...[truncated 2087 chars]