# PHASE_04_IMPLEMENTATION_REPORT.md
# BÁO CÁO TRIỂN KHAI PHASE 4 — MEDIA, ASSET & EXPORT PIPELINE

> Phase: 4
> Date: 2026-09-17
> Branch: main
> Baseline commit/tag: HEAD af5274a + inventoried dirty worktree (NO pre-phase-4 tag — worktree dirty, no commit per policy; Phase 4 changes isolated, documented §2)
> HEAD before: af5274a
> HEAD after: af5274a (không commit trong task)
> Baseline regression: 588 / 588 PASS (log: temp/phase04_verification/tests/baseline_pytest.log)
> Final regression: 622 / 622 PASS (588 + 34 mới − 0 mất; 2 governance tests updated đúng semantic)
> Verdict: PHASE 4: IMPLEMENTED / REVIEW PENDING — READY FOR EXTERNAL REVIEW — PHASE 5: NOT STARTED

## 1. Executive Summary

Phase 4 triển khai Media/Asset/Export Pipeline trên đúng capability hiện có: Asset Registry 3-tier (stable asset_id, JSON atomic, lazy từ intake ledger + reference assets, không migration); WebP thumbnail 256×144 (~3.7KB @q80, cache/idempotent, master-hash verified); proxy 720p H.264 chỉ cho video (ảnh/audio N/A đúng contract); safe serving (thumbnail/proxy/registry/derivatives routes, traversal-proof); audio master đúng chuẩn PCM/24kHz/mono (ffprobe) + muxed target AAC/192k/48k/stereo (minimal fix `-ar/-ac` vào final render); NVENC runtime proven + benchmark công bằng (giữ libx264 default, không blind switch); VTT deterministic (142 cues, SRT untouched); shots CSV/JSON (141 IDs); asset manifest (no dangling); Portable Package 10 nhóm (~34MB, manifest checksums verified, no secrets); Export Workbench package card + Visual thumbnail-first fallback. 34 focused tests, 622/622 regression, browser 3 viewports PASS. Không chạm Phase 5–9.

## 2. Git / Checkpoint Audit
- Preflight: branch main @ af5274a; tags tới pre-phase-3c (không có pre-phase-4).
- Dirty worktree pre-existing (bảo toàn): 3C/3D source + reports, micro-closure docs, docs-cleanup deletions (19), untracked evidence dirs. Không commit (policy chỉ commit khi được yêu cầu rõ ràng), không tag giả → `pre-phase-4: NOT CREATED — DIRTY WORKTREE`, thay bằng HEAD + status snapshot + danh sách file Phase 4 (§30).
- Files intentionally excluded khỏi mọi stage/commit: docs_cleanup_backup/, phase3d_context/, temp/, projects/, renders outputs, media fixtures.

## 3. Source Audit
- Asset intake hiện hữu: `asset_intake.py` (ledger `assets/intake_ledger.json`, lifecycle GENERATED→SELECTED→APPROVED→LOCKED/REJECTED, sha256, QC ffprobe, lock) — Phase 4 reuse, không sửa semantics.
- Renderer: `FFmpegRenderer` (draft 720p ultrafast/crf28, final 1080p medium/crf18, fallback color card, aac 192k nhưng thiếu `-ar/-ac` → đã fix tối thiểu).
- Production export: preflight + immutable snapshots (3D đã reuse).
- Media storage: `assets/imported/` (ledger, reference trống), `assets/references/...` (1 front.png 850KB — case thumbnail-first), `renders/{draft,final}/`, `audio.wav` 32MB, `timestamps.srt` 142 cues.
- UI dùng master: đúng 1 chỗ — Visual Bible reference `<img>` master preview (app.js:6448) → đã chuyển thumbnail-first + master fallback.

## 4. Asset Model / Registry
- Stable IDs: intake `id` (ASSET-{scene}-Vn) + reference `assetId`; không index/DOM/name/filename đơn lẻ. `AssetRef` mở rộng backward-compatible (`proxy_path?`; extra allow giữ unknown fields).
- Persistence: `assets/registry.json` (version 1), atomic tmp+replace; lazy merge ledger + referenceAssets; legacy project không registry vẫn load (empty). Test legacy-field preservation PASS.
- Relation master/proxy/thumbnail + checksum + lifecycle/lock/scene/shot/entity/view preserved. Master chuyển chỗ → derived pointers invalidated (test qua checksum-change path).
- Migration: không cần (lazy, additive-only).

## 5. Thumbnail Pipeline
- WebP, canvas 256×144, scale+pad (không méo), q80 → mẫu thật 3758 bytes (~3.7KB, dưới budget ~15KB mà không giảm chất lượng cực đoan).
- Video: frame @0.5s; audio/other: N/A trung thực (không derivative giả).
- Cache: checksum master khớp + file hợp lệ → CACHED (test). Master đổi → derived invalidated, regenerate đúng asset (không invalidate toàn registry).
- Master preservation: hash trước/sau mọi job, mismatch → abort (test master-bytes-unchanged PASS).

## 6. Proxy Pipeline
- Video: 1280×720 max, force_original_aspect_ratio=decrease (không upscale), H.264 yuv420p, libx264 veryfast/crf23 default, AAC 128k, faststart (browser-compatible, verified decode OK).
- Still: `proxy=null` (thumbnail đảm nhiệm, đúng contract). Audio: null (không video proxy giả).
- Cache/idempotency + failure isolation (tmp→verify→rename; registry chỉ ghi khi success) như thumbnail. Master unchanged verified.

## 7. Asset APIs / Security
- `GET .../assets/registry` (read 3-tier) | `GET .../assets/{id}/thumbnail` (image/webp, inline; KHÔNG generate on read) | `GET .../assets/{id}/proxy[?download=]` | `POST .../assets/{asset_id}/derivatives` (explicit repair, kinds whitelist).
- validate dir (400 traversal), asset 404, registry-file resolve + `relative_to` check, MIME đúng, 404 JSON Việt khi missing/N-A. Tests: 200/404/invalid/traversal.

## 8. Audio Specifications
- Narration Master ffprobe (`temp/phase04_verification/audio/narration_master_ffprobe.json`): pcm_s16le, 24000 Hz, 1 ch, 16-bit — KHỚP canonical (WAV/PCM16/24kHz/Mono). Không overwrite master.
- Muxed Video Audio: final render trước đây `aac/192k` nhưng thiếu rate/channels → minimal fix `-ar 48000 -ac 2` cả 2 nhánh final (contract test trong source PASS). Draft giữ nguyên. Không redesign timeline/engine.

## 9. Encoder Capability Audit
- FFmpeg 8.1.1-essentials (Gyan), `--enable-nvenc --enable-libx264 --enable-libwebp --enable-libvmaf`.
- `ffmpeg -encoders`: h264_nvenc + libx264 đều liệt kê; GPU RTX 3050 Laptop 4GB (+ Intel UHD).
- NVENC runtime: 2s testsrc encode thành công → proven (listing ≠ proof đã được thay bằng proof).

## 10. NVENC vs libx264 Benchmark
- Fixture: draft_preview.mp4 thật (665.6s, 720p, ~90kbps slideshow).
- Methodology: cùng input/resolution/fps/pix_fmt/audio; CBR matched-bitrate thử trước nhưng ratecontrol undershoot khác nhau → chuyển sang quality-profile CRF/CQ 23 & 32 (document rõ vendor scales khác nhau — fairness limitation trung thực). Mỗi profile 3 runs + SSIM/PSNR vs cùng reference (exact commands log).
- Kết quả (run5, CQ/CRF 32): x264 median 17.16s / 7.88MB / SSIM 1.0; NVENC median 16.85s / 8.05MB / SSIM 1.0; PSNR inf cả hai (transparent — content quá đơn giản để phân biệt quality).
- Limitations: fixture không phân biệt được quality (cả hai transparent); audio (AAC 128k ~6.8MB) dominate size/time; cần fixture motion phức tạp cho benchmark phân biệt (ghi rõ, không bịa).
- Recommendation: giữ libx264 default; NVENC là speed option hợp lệ khi cần. Không blind switch (§31).
- Evidence: `temp/phase04_verification/benchmark/{environment.json,commands.txt,results.json,results.csv,run1..run5/}` (media output nặng không commit nhưng nằm trong evidence dir để review).

## 11. EncoderProfile / Compatibility
- Không tạo model/switch mới: production default giữ libx264 (test source-contract `h264_nvenc not in renderer_adapter.py` PASS); NVENC dùng được qua `ensure_proxy(encoder="h264_nvenc")` khi caller chỉ định rõ ràng; CPU fallback luôn tồn tại. Phase 8 sở hữu engine chính thức.

## 12. VTT
- Deterministic SRT→WebVTT (`srt_to_vtt`): 142 cues, timing `00:00:00.000 --> 00:00:02.520` đúng, unicode preserved, WEBVTT header, ordering validated, negative/inverted → raise. SRT gốc byte-identical sau convert (test). Không AI.

## 13. Shots CSV / JSON
- Từ `veo_prompts.json` + `scene_plan.json` (+ route enrichment qua VisualRouter khi có metadata): 141 shots, stable `shot_id`/`scene_id`, timing, category, route, bindings, status/freshness; CSV↔JSON cùng set IDs (test); field vắng → null, không bịa.

## 14. Asset Manifest
- `asset_manifest.json` (assetManifestVersion 1.0): asset_id/media_type/master/proxy/thumbnail/checksum/lifecycle/lock/scene/shot; verify mọi referenced file tồn tại (dangling → blocker). Khác package manifest.json.

## 15. Portable Production Package
- Endpoint `GET .../export/portable-package` (build off-loop qua `asyncio.to_thread`, IO-bound, không CUDA) → FileResponse ZIP attachment; thiếu REQUIRED → 422 blocker Việt; fail → ZIP temp dọn, package cũ không bị đụng.
- Layout §21 đầy đủ 10 nhóm (thiếu mp3/renders thì skip + warnings, không fail): manifest.json (packageSchemaVersion 1.0 — KHÔNG renderManifestVersion, không filtergraph/timeline IR) + audio + subtitles(+vtt) + script + shots + visual + assets manifest/media + video renders.
- Accepted rule: LOCKED>APPROVED>SELECTED>GENERATED cho intake lifecycle; static artifacts dùng canonical current (document, không bịa version).
- Thực đo reference-copy: 34MB, 14 entries, manifest checksums verify OK, no abs paths, no .env/state.db/.bak/logs.

## 16. Package Integrity / Security
- Mở lại ZIP, đọc manifest, verify sha256 từng file, no missing/dangling, no `../`, extract không cần vào production. `_forbidden` chặn .env/state.db/.bak/.log/weights/temp. Tests 200/422/download-headers.

## 17. Export Workbench Integration
- Card “Gói sản xuất di động” (#export-package-box): nút “Tải gói sản xuất” + states (idle/“Đang đóng gói dữ liệu...”/success toast + blob download/422 warning/Thử lại), focus không mất, aria-live. Không redesign 3D, không job framework mới (build đồng bộ qua to_thread, ~2s ở 36MB).

## 18. Visual Workbench / Thumbnail-Proxy Integration
- 1 chỗ load master (vb ref grid) → thumbnail-first + `onerror` fallback master (giữ behavior khi chưa có derived; không auto-generate on load). Registry sync referenceAssets (READY→APPROVED). Không phá identity/prompt/bible/lock/revision/handoff. Fixture reference không có derived mới (không sinh file vào production).

## 19. Vietnamese-first / Accessibility
- Glossary-mapped: Tài nguyên/Ảnh thu nhỏ/Bản xem trước nhẹ/Bản gốc/Gói sản xuất di động/Tải xuống/Thử lại; giữ FFmpeg/ffprobe/NVENC/CUDA/WebP/MP4/H.264/AAC/PCM/WAV/SRT/VTT/JSON/CSV/SHA-256. Native buttons, visible labels, text statuses, aria-label chỉ khi cần, error actionable Việt, không traceback. Không claim WCAG AA.

## 20. Focused Tests
- `tests/test_phase04_media_asset_pipeline.py`: 34/34 PASS (registry 5, thumbnail 6, proxy 5, serving 6, package 8, audio/encoder/UI 4). Fixtures: temp project copies + lavfi-generated video (3s) + real front.png; reference chỉ đọc.

## 21. Hardware Benchmark Evidence
- §10 + `temp/phase04_verification/benchmark/` (environment/nvidia-smi/commands/results.json+csv/run dirs/logs). Không fabricate; limitations ghi rõ.

## 22. Full Regression
- `python -m pytest --tb=short -q`: **622 / 622 PASS, 0 failed, 0 errors** (~106s). Baseline 588 → +34 mới; 2 governance tests updated đúng semantic mới (Phase 4 routes tồn tại là đúng; production renderer giữ libx264). Không xóa/weaken test.

## 23. Browser Validation
- App thật :7860 + Chrome CDP (`scripts/verify_phase04_browser.py`): 1920×1080/1440×900/1366×768 PASS — package card + button enabled, readiness hiển thị, reference fallback ảnh OK, smoke 5 workbench non-blank.
- Console: 0 errors / 0 unhandled. Network: 0 failed XHR phi-media / 0 5xx. Không thumbnail storm (không auto-gen on load), không duplicate poll, không stale cross-project.
- Evidence: `temp/phase04_verification/browser/{screenshots×3,run_summary_p4.json}`.

## 24. Performance Observations
- Thumbnail WebP 256×144: ~65ms, 3758 bytes (mẫu front.png 850KB).
- Proxy: theo test video 3s (seconds-scale; không đo trên production vì giữ libx264 default).
- Package: ~2s / ~36MB / 16 files trên reference-copy. Không claim SLA (không 15KB-cứng/60fps/instant).

## 25. Data Integrity
- Trước/sau: script/beats/audio bytes (hash verified browser run)/timestamps/cues/pronunciation/voiceQA/scene/79 scenes/141 shots/IDs/Bible/prompts/locks/revisions/state.db/accepted masters — 0 unintended diffs (temp copies dọn sạch, verified 0 `_p4*` còn lại; reference không có file derived mới).
- Derived mới chỉ tồn tại trong temp/evidence, không trong production fixture.

## 26. Backward Compatibility / Migration
- Project cũ không registry: load OK (empty), sync lazy additive, không auto-generate hàng loạt khi mở page. Không migration versioned cần thiết (không đổi schema hiện hữu; `AssetRef.proxy_path?` optional). Unknown fields preserved (test).

## 27. Scope Audit
- NOT implemented: Phase 5 (palette/consolidation/virtualization), Phase 6 full hardening, Phase 7 (render-manifest.json/compiler/TL IR/gates/exports manifest), Phase 8 (manifest engine/render_from_manifest/filtergraph/NVENC architecture), Phase 9 (ffprobe QA framework), localization, Flow/Veo automation, timeline editor/Remotion, team/cloud. `render-manifest.json` không tồn tại ở bất kỳ đâu (package manifest phân biệt rõ §8/§15).

## 28. Defects Found / Fixes
1. `phase14_router.py` IndentationError do edit nối dòng docstring (2 chỗ) → fix + compile-check toàn module; bắt bởi collection error, không lọt regression. 2. Benchmark stats_file backslash-escape → file ma ở repo root (đã xóa) + fix POSIX path. 3. Benchmark bufsize unit bug (400M) → parse unit đúng. 4. CBR fairness vỡ (ratecontrol undershoot khác nhau) → chuyển quality-profile mode + document limitation. 5. Parser key sai (`average` vs `psnr_avg`) → fix. 6. Final render thiếu `-ar/-ac` → minimal fix. Tất cả có evidence/test, không che giấu.

## 29. Open Issues / Known Limitations
- Benchmark chưa phân biệt quality trên fixture hiện tại (cần motion-complex fixture cho lần sau); NVENC proven-functional nhưng không default.
- `GET export/package` (Phase 14) vẫn chưa có caller frontend (giữ nguyên cho Phase 4+ quyết định sau — package mới dùng route riêng).
- Không tạo tag `pre-phase-4` (worktree dirty, policy no-commit).
- Guide tour popup lần đầu vào export (onboarding kỳ vọng, dismiss được).

## 30. Files Changed
- Mới: `studio/asset_registry.py`, `studio/encoder_probe.py`, `studio/portable_package.py`, `tests/test_phase04_media_asset_pipeline.py` (34), `scripts/run_phase04_benchmark.py`, `scripts/verify_phase04_browser.py`, report này.
- Sửa: `studio/domain_models.py` (+`proxy_path?`), `studio/phase14_router.py` (+asset routes + portable-package + asyncio import), `studio/renderer_adapter.py` (`-ar 48000 -ac 2` final ×2), `studio/static/app.js` (thumbnail-first img), `studio/static/index.html` (package box), `studio/static/phase14_ui.js` (package download wiring), `tests/test_phase03d_governance.py` + `tests/test_phase03c_gap_closure.py` (governance semantic mới), `docs/implementation/ROADMAP_STATUS.md` (2.4.0).
- Không chạm: Phase 7/8/9, schema DB, 3A/3B/3C logic.

## 31. Final Gate Matrix
| Gate | Requirement | Result |
|---|---|---|
| A | Approved Phase 3 Git baseline identified/checkpointed | PASS (HEAD + inventory; tag NOT CREATED documented, no fabrication) |
| B | Baseline regression 100% | PASS (588/588 + log) |
| C | Asset Registry stable-ID contract | PASS (5 tests) |
| D | Master media preserved | PASS (hash verify + tests) |
| E | WebP thumbnail 256×144 pipeline | PASS (real webp, dims, ~3.7KB) |
| F | Thumbnail cache/idempotency | PASS (CACHED test) |
| G | Proxy 720p pipeline | PASS (real H264 ≤720p, faststart) |
| H | Safe asset serving | PASS (routes + 404/traversal tests) |
| I | Backward compatibility/migration | PASS (lazy, additive, unknown preserved) |
| J | Narration Master spec verified | PASS (ffprobe PCM/24k/mono/16-bit) |
| K | Muxed audio spec verified/minimally enforced | PASS (contract + `-ar/-ac` fix) |
| L | h264_nvenc capability verified | PASS (listed + runtime probe OK) |
| M | libx264 capability verified | PASS |
| N | NVENC vs libx264 benchmark evidence valid | PASS (3 runs/profile, commands+logs) |
| O | SSIM/PSNR methodology valid | PASS (same-ref, limitations stated) |
| P | VTT generated with timing integrity | PASS (142 cues, SRT untouched) |
| Q | Shots CSV/JSON stable-ID export | PASS (141, same set) |
| R | Asset manifest valid | PASS (no dangling) |
| S | Portable Package contains required 10 groups | PASS (14 entries) |
| T | Package manifest checksums verified | PASS (re-read verify) |
| U | Package excludes sensitive/unwanted files | PASS (forbidden filter + tests) |
| V | Export/Visual UI integration usable | PASS (browser 3/3) |
| W | Vietnamese-first policy | PASS |
| X | Browser 3 viewports usable | PASS (screenshots) |
| Y | Console/network clean | PASS (0/0/0/0) |
| Z | Full regression 100% | PASS (622/622) |
| AA | Data integrity | PASS (hashes + no leftovers) |
| AB | Phase 7 Render Manifest NOT implemented | PASS (governance test) |
| AC | Phase 8 renderer architecture NOT implemented | PASS (governance test) |
| AD | Phase 9 Render QA NOT implemented | PASS (governance test) |
| AE | Phase 5/6 remain NOT STARTED | PASS |

## 32. Final Verdict
```text
PHASE 4: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 5: NOT STARTED
```
(KHÔNG tự PASS/FINAL — chờ external review.)
