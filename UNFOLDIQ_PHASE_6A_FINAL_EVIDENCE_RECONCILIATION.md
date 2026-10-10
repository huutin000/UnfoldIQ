# UNFOLDIQ — PHASE 6A FINAL EVIDENCE RECONCILIATION

**Execution:** One-time completion pass, NOT a new phase  
**Ngày:** 10/10/2026  
**Project:** `pilot-sky-blue-canonical`  
**Mục tiêu:** Đối chiếu và đóng các bằng chứng còn thiếu, không làm lại những phần đã PASS.  
**Next:** Phase 6B chỉ khi gate hợp lệ.

---

## 0. MỆNH LỆNH CHO AGENT

Bạn là coding/QA agent của dự án UNFOLDIQ. Hãy tiếp tục từ trạng thái repo thực tế và đọc **hai báo cáo hiện tại**, không suy diễn từ các báo cáo Phase 6A cũ:

1. `PHASE_6A_CANONICAL_PILOT_REPORT.md` (hoặc bản tương ứng trong repo).
2. `Report/phases/phase-6/PHASE_6A_FINAL_CLOSURE_REPORT.md` — ưu tiên **Owner decision round 3 (10/10/2026)**.
3. `Report/evidence/phase-6a/canonical-pilot/`.
4. `projects/pilot-sky-blue-canonical/` và `packaging/final-publish-package.json`.
5. Roadmap hiện hành, Market Gap Registry và Phase 6A completion-gate schema.

**Không triển khai lại Hook, Beat, Rhythm, Phase 5B/5C, renderer architecture, pipeline hoặc Multimodal Watch.** Chỉ thực hiện các kiểm tra thiếu bằng chứng ở §§2–6. Hãy kiểm chứng các path và trạng thái thực tế trong repo trước khi thao tác.

**Absolute guards:**

```text
EXTERNAL_API_COST_BUDGET_VND = 0
PAID_API_ALLOWED = false
PAID_MEDIA_GENERATION_ALLOWED = false
NEW_GEMINI_CALLS = 0
NEW_FLOW_CALLS = 0
NEW_VEO_CALLS = 0
NEW_TTS_GENERATION = 0
NEW_VIDEO_RENDER = 0
NEW_INCREMENTAL_RENDER = 0
AUTOMATIC_OWNER_APPROVAL = false
AUTOMATIC_CLOUD_UPLOAD = false
```

Không chạy lại Gemini whole-video/per-scene. Không thay đổi video đã được duyệt, trừ khi tìm thấy lỗi P0/P1 có căn cứ; khi đó STOP và trình owner quyết định thay vì tự khởi động workflow sửa lại toàn bộ.

---

## 1. BASELINE ĐÃ CÓ — PHẢI REUSE

Dùng làm điểm khởi đầu; xác minh evidence/reference tồn tại, không chạy lại công việc để tạo evidence mới giống hệt:

```text
PROJECT = pilot-sky-blue-canonical
FINAL_VIDEO = out/pilot-sky-blue-canonical/final.mp4
FINAL_SHA256 = 7954a86a793ccbe5e153be30875b832ef813f3e23021e0f571a9da5e823dfcdf
DURATION = 57.152s
VIDEO = 1920x1080 @ 30fps, H.264 + AAC
FINAL_ATTEMPT = attempt-006
OWNER_APPROVAL = approval/owner-approval.json
FINAL_PACKAGE = packaging/final-publish-package.json
SELECTED_PACKAGING_VARIANT = pkv-202fd90e1b72
SELECTED_THUMBNAIL = THUMB_S05

TECHNICAL_QA = 9 PASS / 0 FAIL / 0 REVIEW / 0 UNKNOWN
PHASE_4B_FINAL_QC = PASS
GEMINI_WHOLE_VIDEO = 10/10 PASS (report evidence)
GEMINI_PER_SCENE = 6/6 scenes; 16/16 captions (report evidence)
REAL_INCREMENTAL_CREATIVE_REPAIR = PROVEN ON FIXTURE (495/1800 frames)
CURRENT_REPO_STRUCTURE_CHECK = PASS (theo report)
```

Caveat phải giữ trong report:

- Gemini là model opinion, không phải signed human full-watch; timestamp của Gemini trong per-scene result đã được báo là không đáng tin để chứng minh caption sync.
- Caption timing/frame-boundary phải dùng deterministic render/QC evidence đã lưu; không suy từ timestamp Gemini.
- Free Tier/0 VND hiện dựa trên owner/report attestation; không bịa billing confirmation hoặc token cost mới.
- Video 57.152s là representative pilot Phase 6A; không được viết rằng nó thỏa yêu cầu video 2–3 phút của Phase 4 nếu chưa có owner-approved scope exception.

Nếu bất kỳ evidence nào không tồn tại/không khớp, đánh `EVIDENCE_MISSING` thay vì PASS.

---

## 2. P0 — FINALPUBLISHPACKAGE QA RECONCILIATION

**Vấn đề:** Báo cáo ghi `FinalPublishPackage.qaStatus = REVIEW_REQUIRED` cùng `open items`, dù deterministic technical QA PASS và owner approval đã tồn tại. Báo cáo không liệt kê đầy đủ các open item này.

**Thực hiện:**

1. Đọc trực tiếp `projects/pilot-sky-blue-canonical/packaging/final-publish-package.json` và các finding/report mà nó tham chiếu.
2. Liệt kê **TẤT CẢ** open items với `findingId / code / severity / source / evidenceRef / blockingPolicy / currentStatus / proposedResolution`.
3. Phân loại từng item:
   - `RESOLVED_BY_EXISTING_EVIDENCE` — có evidence xác thực, phù hợp rule hiện hành.
   - `ACCEPTED_NON_BLOCKING` — policy cho phép và có owner decision/evidence tương ứng.
   - `REQUIRES_OWNER_DECISION` — quyền quyết định thuộc owner.
   - `UNRESOLVED_BLOCKING` — chưa có căn cứ để đóng.
4. Đối chiếu status với pipeline/packaging schema thật, không tạo trạng thái không được hỗ trợ.
5. Nếu mọi blocking item đã được giải quyết: cập nhật status thông qua **canonical API/service** hiện có (nếu có), duy trì revision/hash/lineage và lưu reconciliation artifact.
6. Nếu policy cho phép `REVIEW_REQUIRED` với exception không chặn Phase 6B, ghi rõ rule + evidence + owner acceptance; **không ép chuyển thành PASS**.
7. Nếu có blocking finding thật, STOP tại `PACKAGING_QA_BLOCKED` với nội dung cụ thể.

**Đặc biệt kiểm tra claim fidelity:**

```text
APPROVED SCRIPT TOPIC:
Why the sky is blue

SELECTED TITLE:
Why Sunsets Turn Red While the Sky Stays Blue
```

Kiểm tra approved script, transcript, từng scene, visual diagram và description: **video có thực sự giải thích nguyên nhân hoàng hôn đỏ không?** Lấy câu/beat/scene/time range hỗ trợ từng claim; không lấy `Gemini 10/10 PASS` làm bằng chứng duy nhất.

- Nếu đáp ứng: lưu mapping `titleClaim -> script/scene/evidence`.
- Nếu chưa đáp ứng: báo `CLAIM_FIDELITY_REVIEW_REQUIRED`, đề xuất title/thumbnail/description trung thực hơn. Không tự sửa owner-selected variant rồi ngầm giữ approval cũ.
- Nếu owner đồng ý đổi packaging: chỉ sửa đúng packaging qua flow chuẩn, lấy owner decision mới theo contract; không render lại video nếu bytes video không đổi.

**Artifact:** `Report/evidence/phase-6a/final-reconciliation/packaging-qa-reconciliation.md`.

---

## 3. P0 — CANONICAL PILOT / APPROVAL / WATCH LINEAGE

**Vấn đề:** Latest closure ghi `CANONICAL_PILOT_LINEAGE = PROVEN_PARTIAL`, dù đã có owner-approved final.mp4, package và Gemini watch. Xác định **chính xác link nào còn thiếu** trước khi nâng verdict.

Chỉ dùng read-only verification, không render/call provider:

```text
approved script + 8 beats/6 scenes
  -> scene-media-coverage-matrix
  -> original SVG visual sources
  -> narration + captions
  -> render attempt-006
  -> final-artifact.json
  -> exact final.mp4 SHA256
  -> owner-approval.json
  -> selected package + thumbnail
  -> Gemini whole/per-scene watch artifact
  -> final deterministic QC
```

Yêu cầu:

1. So sánh SHA256 của `out/.../final.mp4`, `attempt-006/output.mp4`, `final-artifact.json` và package references; phải cùng bytes/ID theo contract.
2. Đối chiếu owner approval (`DUYỆT attempt-006 7954a86a ...`) có thực sự tham chiếu đúng video hash/revision và selected packaging; phân biệt **owner approval** với **formal signed human watch**.
3. Đối chiếu provenance/rights của SVG tự xây và từng scene; không gán license của third-party khi không có.
4. Xác minh Gemini watch artifacts có tham chiếu đúng video hash. Nếu metadata thiếu, bổ sung **manifest/reference**, không giả mạo nội dung reviewer đã không trả lời.
5. Kiểm tra `FLASH_SAFETY_REVIEW` và `AUDIO_VISUAL_ENERGY_MISMATCH` đã có evidence trên video canonical mới; không mang nguyên cảnh báo fixture cũ thành lỗi của pilot mới.
6. Formal human full-watch checklist chỉ yêu cầu nếu **canonical Phase 6A gate thực sự bắt buộc**. Nếu cần owner ký/xác nhận, tạo bản `PENDING_OWNER_CONFIRMATION` và dừng; không tự ký thay.
7. Nếu video dưới 2–3 phút là giới hạn scope được owner cho phép ở Phase 6A, ghi đúng `ACCEPTED_REPRESENTATIVE_PILOT`; không claim thay thế Phase 4 long-form test.

**Artifact:** `Report/evidence/phase-6a/final-reconciliation/canonical-lineage-audit.md`.

---

## 4. P1 — SAFE GIT WORKING TREE AUDIT

**Vấn đề:** Báo cáo ghi ~18 tracked files được regression sửa và các source changes Remotion chưa commit.

**Read-only trước:**

```bash
git status --porcelain=v1
git rev-parse HEAD
git diff --name-status
git diff --check
```

Thực hiện:

1. Phân loại từng file thành `INTENTIONAL_SOURCE_CHANGE`, `TEST_GENERATED_CHANGE`, `OWNER_DATA`, `REPORT/EVIDENCE`, `UNTRACKED_REQUIRED_ARTIFACT`.
2. Đảm bảo bảo toàn 4 source/test changes đã nêu trong report:
   - `remotion/src/compositions/SkyDiagram.tsx`
   - `remotion/src/Root.tsx`
   - `remotion/src/captions/CaptionTrack.tsx`
   - `tests/remotion/test-remotion-captions.js`
   - cùng `scripts/diagnostics/gemini-video-watch.js` và mọi file mới thực sự thuộc feature.
3. Đối với **chỉ các file chắc chắn do test tạo ra**, liệt kê exact path và diff summary. Chỉ restore đúng các path này khi quyền cho phép, dùng `git restore --worktree -- <path>` sau bước xác nhận an toàn.
4. **CẤM** `git checkout -- projects providers`, `git restore .`, `git reset --hard`, `git clean -fd` hoặc bất kỳ lệnh restore/xóa cả thư mục.
5. Nếu permission classifier chặn restore: STOP ở `RESTORE_PERMISSION_BLOCKED`, đưa danh sách exact path + hướng dẫn để owner thao tác; không retry phá guard hay sử dụng bypass.
6. Không tự commit/push/stash source hoặc xóa untracked media/evidence nếu owner chưa cho phép.
7. Sau full regression (nếu sinh tracked changes trở lại), thực hiện lại **chỉ bước audit + selective cleanup**, không chạy lại cả regression vì cleanup bookkeeping không làm đổi source/config.

**Điều kiện:** `HYGIENE = PASS` theo script checks **không đồng nghĩa** `GIT_WORKTREE_CLEAN = true`. Nếu còn intentionally modified source, báo `EXPECTED_DIRTY`, không bịa `CLEAN`.

**Artifact:** `Report/evidence/phase-6a/final-reconciliation/git-working-tree-audit.md`.

---

## 5. P0 — FULL REGRESSION TRÊN SNAPSHOT CODE HIỆN TẠI

**Vấn đề:** Full regression PASS 1051.7s thuộc revision `4a57790`, **trước các thay đổi Remotion caption/diagram và watch tool**. `test:remotion` PASS không thay thế full regression cho Phase 6A gate nếu canonical contract yêu cầu full suite.

**Quy trình đúng thứ tự:**

1. Hoàn thành mọi sửa source/config cần thiết từ §2; freeze code.
2. Ghi `HEAD`, branch, `git diff --name-status`, hashes/diff fingerprint cho staged + unstaged changes, và hashes của **untracked source có liên quan**.
3. Xác định `npm test`/`node scripts/run-tests.js` canonical từ `package.json` + repo docs. Dùng **runner hiện có**, không đổi runner/tăng timeout chỉ để PASS.
4. Trước full run chỉ chạy targeted tests nếu có source thay đổi chưa được test; **đừng lặp lại** test:remotion/creative nếu evidence đúng current snapshot và không có code liên quan thay đổi.
5. Chạy **một** full regression trên snapshot đã freeze:

```bash
node scripts/run-tests.js
```

6. Lưu exit code thật, count PASS/FAIL, duration, log nguyên vẹn, start/end, snapshot fingerprint và test environment.
7. Nếu 0 failed suites + exit 0: `FULL_REGRESSION_CURRENT_SNAPSHOT = PASS`.
8. Nếu FAIL: chia lỗi theo `PRODUCT_DEFECT`, `ENVIRONMENT`, `TIMEOUT`, `FIXTURE_SIDE_EFFECT`; chỉ chạy affected suite để điều tra; không tự khởi động full suite lần 2. Sửa xong báo cần owner chấp thuận một final rerun mới.
9. Nếu quá 20 phút mà chưa hoàn tất hoặc có dấu hiệu treo: dừng vòng thử lặp, báo bottleneck; không tự đổi gate thành PASS.
10. Sau suite, cleanup tracked test side effects theo §4; KHÔNG xóa log/evidence, không thay đổi product source/config mà không đánh dấu gate cần chạy lại.

**Lưu ý:** Git HEAD đơn lẻ chưa đủ khi code chưa commit. Evidence full regression phải gắn với toàn bộ snapshot (HEAD + working source/config differences), không chỉ tên branch.

**Artifacts:**

```text
Report/evidence/phase-6a/final-reconciliation/full-regression-current.log
Report/evidence/phase-6a/final-reconciliation/regression-snapshot.json
```

Nếu local TypeScript toolchain có sẵn và repo có gate typecheck: chạy lệnh typecheck chuẩn. Nếu thiếu công cụ, ghi `TYPECHECK_NOT_RUN` với lý do; không tự cài gói có phí/đổi dependency graph chỉ để lấp chứng cứ.

---

## 6. FINAL QUALITY GATE / REPORT UPDATE

Thay đổi *duy nhất* các báo cáo/registry có liên quan, tránh mở rộng roadmap:

- `Report/phases/phase-6/PHASE_6A_FINAL_CLOSURE_REPORT.md`
- canonical Phase 6A completion gate JSON hiện có
- Market Gap Registry chỉ nếu status/evidence thực sự thay đổi
- `Report/evidence/phase-6a/final-reconciliation/PHASE_6A_FINAL_GATE_RECONCILIATION.md`

**Phân biệt:**

- `TECHNICAL_QA_PASS` != `PUBLISH_PACKAGE_APPROVED`
- `OWNER_APPROVED_VIDEO` != `HUMAN_FULL_WATCH_SIGNED`
- `MODEL_WATCH_PASS` != `FRAME_EXACT_QA`
- `OLD_REGRESSION_PASS` != `CURRENT_SNAPSHOT_REGRESSION_PASS`
- `REPO_STRUCTURE_PASS` != `GIT_CLEAN`
- `PILOT_57S_ACCEPTED` != `PHASE_4_2_TO_3_MIN_REQUIREMENT_PROVEN`

Verdict bắt buộc có đầy đủ các trường:

```text
CANONICAL_PILOT                        = READY | BLOCKED
CANONICAL_PILOT_LINEAGE                = PROVEN | PARTIAL | NOT_PROVEN
OWNER_APPROVAL                         = PROVEN | NOT_PROVEN
FINAL_VIDEO_SHA256_MATCH               = PASS | FAIL
REPRESENTATIVE_PILOT_SCOPE             = ACCEPTED | REVIEW_REQUIRED

FINAL_MULTIMODAL_WATCH                 = PASS_WITH_LIMITATIONS | FAIL | NOT_PROVEN
CAPTION_FRAME_BOUNDARY_QA              = PASS | FAIL | NOT_PROVEN
FLASH_QA_CANONICAL                     = PASS | FAIL | REVIEW_REQUIRED
AUDIO_VISUAL_QA_CANONICAL              = PASS | FAIL | REVIEW_REQUIRED
REAL_INCREMENTAL_CREATIVE_REPAIR       = PROVEN | NOT_PROVEN

PACKAGING_CLAIM_FIDELITY                = PASS | FAIL | REVIEW_REQUIRED
PACKAGING_OPEN_ITEMS                   = <count>
PACKAGING_QA                            = PASS | ACCEPTED_NON_BLOCKING | REVIEW_REQUIRED | FAIL

FULL_REGRESSION_CURRENT_SNAPSHOT       = PASS | FAIL | NOT_RUN
HYGIENE                                = PASS | FAIL
GIT_STATUS                             = CLEAN | EXPECTED_DIRTY | UNRECONCILED
P0                                     = <count>
P1_CRITICAL                            = <count>
EXTERNAL_PAID_COST_VND                 = 0

PHASE_6A_ENGINEERING_GATE              = PASS | FAIL | NOT_PROVEN
PHASE_6A_PRODUCT_ACCEPTANCE            = PASS | REVIEW_REQUIRED | BLOCKED
PHASE_6A                               = COMPLETE | NOT_COMPLETE
PHASE_6B_READY                         = YES | NO
```

Nếu completion gate schema chỉ hỗ trợ enum khác, map sang enum **được khai báo** và giữ trạng thái chi tiết trong report; không sửa schema chỉ để tạo PASS. Không tự định nghĩa `ACCEPTED_NON_BLOCKING` thành trạng thái persist mới nếu hệ thống không hỗ trợ.

**Chỉ được `PHASE_6B_READY = YES` khi:**

- Same-hash canonical pilot + owner approval + selected packaging lineage đã được xác thực.
- Multimedia/full AV watch evidence đã có và giới hạn được ghi rõ.
- Các **blocking** findings về package, claim fidelity, rights/safety, caption/flash/AV đã được đóng theo chính sách thật.
- Real Incremental Repair evidence còn hợp lệ.
- Full regression **current snapshot** PASS; hygiene PASS.
- P0 = 0, P1 critical = 0.
- Không giả mạo human signature, Gemini timestamps hoặc approval.

Nếu vướng bước yêu cầu owner quyết định, dừng ở `PENDING_OWNER_DECISION` và **chỉ hỏi đúng quyết định còn thiếu**. Không tự chốt thay owner.

---

## 7. TỐI ƯU THỜI GIAN / STOP CONDITIONS

```text
Read-only evidence audit           ưu tiên trước, không render
Targeted tests                    chỉ khi source change thực sự cần
Full regression                   tối đa 1 lần, sau khi freeze
New Gemini/Flow/Veo calls         0
New render / incremental render   0
```

- Trước bất kỳ tác vụ nào dự kiến tốn >10 phút: thông báo mục đích, chi phí thời gian và lý do.
- Nếu một bước vượt 20 phút: báo lại ngay và không tự khởi động lặp vô hạn.
- Cấm tạo fixture mới, re-render 57s pilot hoặc test lại 495/1800-frame repair.
- Không chạy lại full suite do báo cáo hoặc Git cleanup đơn thuần.

---

## 8. ĐẦU RA CUỐI CÙNG

Hãy trả lời ngắn gọn bằng tiếng Việt:

1. Bảng `Missing Evidence -> Action -> Evidence Path -> PASS/FAIL/BLOCKED`.
2. List chính xác open items từ `FinalPublishPackage` và quyết định cho từng item.
3. Kết quả claim fidelity (title hứa hoàng hôn đỏ) kèm bằng chứng script/scene.
4. Full regression current snapshot: exit code, số suites, duration, log path, revision fingerprint.
5. Git status audit: phân loại những thay đổi được giữ/được restore/còn chờ owner.
6. Final gate: `PHASE_6A`, `PHASE_6B_READY`; lý do nếu vẫn NO.
7. Nếu PASS: đề xuất task kế tiếp **Phase 6B**, nhưng KHÔNG tự triển khai Phase 6B trong lượt này.

### References (policy/tool behavior; project evidence remains source of truth)

- YouTube misleading title/thumbnail/description: https://support.google.com/youtube/answer/2801973
- Google Gemini video understanding and 1 FPS default: https://ai.google.dev/gemini-api/docs/video-understanding
- Git restore restricted by explicit pathspec: https://git-scm.com/docs/git-restore
- Git status porcelain for audit: https://git-scm.com/docs/git-status
- Git diff `--check`: https://git-scm.com/docs/git-diff
- Remotion caption timing/rendering: https://www.remotion.dev/docs/captions/displaying
