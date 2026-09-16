/* ==========================================================================
   UnfoldIQ Onboarding Revamp — guide engine (spec 04/05/06).
   - Script-first tours, stable anchors [data-guide-id], per-tour versioning.
   - State machine: IDLE → STARTING → ACTIVE ⇄ PAUSED → COMPLETED | DISMISSED | ERROR.
   - Không tour nào chạy đồng thời. Missing target không crash production UI.
   - Toàn bộ copy tiếng Việt (allowlist kỹ thuật giữ nguyên).
   ========================================================================== */
(function () {
  "use strict";

  var STORE_KEY = "unfoldiq.onboarding.v2";
  var LEGACY_KEY = "unfoldiq_tour_completed";
  var REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function log() {
    if (window.console && console.debug) console.debug.apply(console, ["[guide]"].concat([].slice.call(arguments)));
  }

  /* ------------------------------------------------------------------ */
  /* Tour content (spec 05 — nguồn nội dung implementation, tiếng Việt).  */
  /* ------------------------------------------------------------------ */
  var TOURS = {
    "product-overview": { version: 1, title: "Hướng dẫn nhanh", steps: [
      { anchor: "workflow-overview", workspace: "overview", title: "Tổng quan dự án", body: "Theo dõi trạng thái toàn bộ quy trình, bước nào đã sẵn sàng và việc cần làm tiếp theo." },
      { anchor: "workflow-content", workspace: "content", title: "Kịch bản là điểm bắt đầu", body: "Nhập hoặc chỉnh sửa kịch bản. Sau khi duyệt và khóa, UnfoldIQ mới tạo dữ liệu sản xuất phía sau." },
      { anchor: "workflow-scenes", workspace: "scenes", title: "Từ kịch bản đến từng cảnh", body: "UnfoldIQ phân tích kịch bản thành Scene, tạo Scene Plan và dữ liệu visual." },
      { anchor: "workflow-studio", workspace: "timeline", title: "Ghép asset thành video", body: "Import ảnh/video, kiểm tra asset, xếp timeline và tạo bản dựng nháp." },
      { anchor: "workflow-review", workspace: "review", title: "Chỉ sửa đúng phần có vấn đề", body: "Xem lỗi theo Scene và thay đúng asset chưa đạt mà không làm lại toàn bộ dự án." },
      { anchor: "workflow-export", workspace: "export", title: "Render và xuất bản cuối", body: "Khi các điều kiện sẵn sàng, tạo bản render cuối và gói file bàn giao." }
    ]},
    "content-basics": { version: 1, title: "Hướng dẫn mục Nội dung", steps: [
      { anchor: "content-script-editor", workspace: "script", title: "Kịch bản sản xuất", body: "Dán hoặc chỉnh sửa kịch bản. Đây là nguồn đầu vào chính cho các bước sản xuất tiếp theo." },
      { anchor: "content-script-stats", workspace: "script", title: "Ước tính nhanh", body: "Theo dõi số ký tự, số từ và thời lượng dự kiến trước khi tạo giọng đọc." },
      { anchor: "content-voice-config", workspace: "script", title: "Giọng đọc Kokoro", body: "Chọn giọng, ngôn ngữ và tốc độ đọc. Kokoro chạy cục bộ trên máy." },
      { anchor: "content-generate-voice", workspace: "script", title: "Tạo narration", body: "Tạo giọng đọc làm cơ sở cho timestamp và Scene Plan." },
      { anchor: "content-research-optional", workspace: "research", title: "Nguồn & nghiên cứu — tùy chọn", body: "Lưu nguồn, ghi chú hoặc Claim Ledger nếu cần. Có thể bỏ qua nếu đã có kịch bản hoàn chỉnh.", optional: true }
    ]},
    "scene-visual-basics": { version: 1, title: "Hướng dẫn mục Cảnh & Visual", steps: [
      { anchor: "scene-list", workspace: "scenes", title: "Danh sách Scene", body: "Mỗi Scene có narration, thời lượng, loại cảnh và trạng thái riêng." },
      { anchor: "scene-detail", workspace: "scenes", title: "Ý nghĩa của Scene", body: "UnfoldIQ xác định nhân vật, bối cảnh, mục đích hình ảnh, góc máy và chiến lược visual." },
      { anchor: "scene-visual-bible", workspace: "scenes", title: "Visual Bible", body: "Lưu các thực thể chuẩn để giữ nhân vật, bối cảnh, vật thể và phong cách nhất quán." },
      { anchor: "scene-character-reference", workspace: "scenes", title: "Bộ ảnh tham chiếu", body: "Chính diện, Góc 3/4, Góc nghiêng và Toàn thân là các góc của cùng một nhân vật." },
      { anchor: "scene-visual-blueprint", workspace: "scenes", title: "Visual Blueprint", body: "Mô tả khung hình: chủ thể, bối cảnh, bố cục, ánh sáng, phong cách và reference." },
      { anchor: "scene-flow-actions", workspace: "scenes", title: "Tạo ảnh bằng Google Flow", body: "UnfoldIQ chuẩn bị prompt và reference. Hiện tại bạn tạo ảnh thủ công trên Google Flow rồi import lại." },
      { anchor: "scene-motion-blueprint", workspace: "veo", title: "Motion Blueprint", body: "Mô tả chuyển động của chủ thể, camera và môi trường dựa trên ảnh đã duyệt." },
      { anchor: "scene-veo-actions", workspace: "veo", title: "Tạo chuyển động bằng Veo", body: "UnfoldIQ chuẩn bị Veo Prompt. Hiện tại bạn chạy Veo thủ công rồi import video về dự án." }
    ]},
    "studio-basics": { version: 1, title: "Hướng dẫn mục Studio", steps: [
      { anchor: "studio-asset-intake", workspace: "timeline", title: "Import asset", body: "Đưa ảnh/video đã tạo trở lại UnfoldIQ và gắn đúng Scene." },
      { anchor: "studio-asset-qc", workspace: "timeline", title: "Kiểm tra asset", body: "Xác minh định dạng, độ phân giải, thời lượng và mapping Scene." },
      { anchor: "studio-timeline", workspace: "timeline", title: "Timeline", body: "Ghép narration, visual, timestamp, subtitle và transition thành một timeline." },
      { anchor: "studio-draft-render", workspace: "export", title: "Bản dựng nháp", body: "Render bản nháp để xem toàn bộ video trước khi chốt bản cuối." }
    ]},
    "review-basics": { version: 1, title: "Hướng dẫn mục Kiểm tra", steps: [
      { anchor: "review-issues", workspace: "review", title: "Vấn đề theo Scene", body: "Mỗi lỗi phải dẫn về đúng Scene hoặc asset cần xử lý." },
      { anchor: "review-targeted-fix", workspace: "review", title: "Sửa có mục tiêu", body: "Chỉ thay hoặc tạo lại Scene chưa đạt. Asset đã duyệt ở Scene khác phải được giữ nguyên." },
      { anchor: "review-audio", workspace: "voice-qa", title: "Kiểm tra giọng đọc", body: "Nghe lại phát âm, nhịp đọc và các đoạn TTS cần xử lý trước khi render cuối." }
    ]},
    "export-basics": { version: 1, title: "Hướng dẫn mục Xuất video", steps: [
      { anchor: "export-readiness", workspace: "export", title: "Điều kiện xuất video", body: "Chỉ xuất bản cuối khi asset, timeline và kiểm tra bắt buộc đã sẵn sàng." },
      { anchor: "export-render-types", workspace: "export", title: "Bản nháp và bản chính thức", body: "Dùng bản nháp để kiểm tra nhanh; bản chính thức dùng thiết lập chất lượng dự án." },
      { anchor: "export-package", workspace: "export", title: "Gói bàn giao", body: "Chỉ hiển thị file đầu ra là sẵn sàng khi chúng thực sự đã được tạo." }
    ]},
    "visual-bible-basics": { version: 1, title: "Hướng dẫn Visual Bible", steps: [
      { anchor: "scene-visual-bible", workspace: "scenes", title: "Visual Bible là gì", body: "Nơi lưu thực thể chuẩn: nhân vật, bối cảnh, vật thể và phong cách để giữ nhất quán toàn dự án." },
      { anchor: "scene-character-reference", workspace: "scenes", title: "Bốn góc tham chiếu", body: "Chính diện, Góc 3/4, Góc nghiêng và Toàn thân là các góc của cùng một nhân vật, không phải bốn người khác nhau." },
      { anchor: "scene-visual-blueprint", workspace: "scenes", title: "Dùng reference thế nào", body: "Mỗi Scene tự gắn reference phù hợp. Chế độ Nâng cao mới cần ghi đè thủ công." },
      { anchor: "scene-flow-actions", workspace: "scenes", title: "Từ Bible ra ảnh thật", body: "Prompt Google Flow luôn kèm reference đã duyệt để giữ nhận diện nhân vật." }
    ]}
  };

  /* Workspace đang mở → tour hiện tại (§9 spec 06). */
  var WORKSPACE_TOUR = {
    research: "content-basics", script: "content-basics",
    scenes: "scene-visual-basics", veo: "scene-visual-basics",
    timeline: "studio-basics", audio: "studio-basics", "voice-qa": "studio-basics", timestamp: "studio-basics",
    review: "review-basics", export: "export-basics",
    overview: "product-overview", projects: "product-overview", library: "product-overview",
    activity: "product-overview", pronunciation: "product-overview"
  };

  var GLOSSARY = [
    ["Scene", "Một đoạn video ngắn có narration, thời lượng và mục đích hình ảnh riêng."]

,
    ["Visual Bible", "Bộ thực thể chuẩn (nhân vật, bối cảnh, vật thể, phong cách) để giữ nhất quán."],
    ["Visual Blueprint", "Mô tả khung hình phải trông như thế nào: chủ thể, bối cảnh, bố cục, ánh sáng, phong cách."],
    ["Motion Blueprint", "Mô tả khung hình đã duyệt sẽ chuyển động như thế nào: chủ thể, camera, môi trường."],
    ["Claim Ledger", "Sổ nhận định khoa học liên kết với bằng chứng. Công cụ tùy chọn, không bắt buộc."],
    ["Khóa (khịch bản/ảnh)", "Trạng thái bảo vệ: nội dung đã duyệt không bị thay đổi ngoài ý muốn ở bước sau."],
    ["Thủ công (Google Flow/Veo)", "Hiện tại bạn tạo ảnh/video trên trang nhà cung cấp rồi import lại; UnfoldIQ chuẩn bị prompt, reference và kiểm tra file."],
    ["Bản dựng nháp", "Bản render nhanh để kiểm tra toàn bộ video trước khi chốt bản cuối."],
    ["Sửa có mục tiêu", "Chỉ thay hoặc tạo lại đúng Scene/asset lỗi, giữ nguyên phần đã duyệt."]
  ];

  /* ------------------------------------------------------------------ */
  /* Persistence per-tour (§14 spec 04, §3 spec 06).                      */
  /* ------------------------------------------------------------------ */
  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { schemaVersion: 2, tours: {} };
      var s = JSON.parse(raw);
      if (!s || typeof s !== "object" || !s.tours) return { schemaVersion: 2, tours: {} };
      return s;
    } catch (e) { return { schemaVersion: 2, tours: {} }; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function tourRecord(tourId) {
    var s = loadStore();
    return s.tours[tourId] || null;
  }
  function writeTour(tourId, patch) {
    var s = loadStore();
    var cur = s.tours[tourId] || { version: TOURS[tourId].version, status: "idle", lastStep: 0 };
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    s.tours[tourId] = cur;
    saveStore(s);
  }

  /* Migration tour 12 bước cũ (§15 spec 04, §8 spec 06): không xóa mù quáng. */
  function migrateLegacy() {
    var s = loadStore();
    if (s.meta && s.meta.migratedFromLegacy) return s;
    var legacyDone = false;
    try { legacyDone = localStorage.getItem(LEGACY_KEY) === "true"; } catch (e) {}
    if (legacyDone && !s.tours["product-overview"]) {
      s.tours["product-overview"] = {
        version: 1, status: "completed", lastStep: 6,
        completedAt: new Date().toISOString(), via: "legacy-tour-migration"
      };
    }
    s.meta = s.meta || {};
    s.meta.migratedFromLegacy = true;
    if (legacyDone) s.meta.legacyCompleted = true;
    saveStore(s);
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Engine.                                                             */
  /* ------------------------------------------------------------------ */
  var machine = { state: "IDLE", tourId: null, stepIndex: 0, lastFocus: null };
  var observer = null;

  function stopObserver() {
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
  }

  function resolveAnchor(guideId) {
    var el = null;
    try { el = document.querySelector('[data-guide-id~="' + guideId + '"]'); } catch (e) { el = null; }
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    return visible ? el : null;
  }

  /* Đợi DOM sẵn sàng: rAF poll + MutationObserver có cleanup (không setTimeout cố định). */
  function waitAnchor(guideId, done) {
    var settled = false;
    function finish(el) {
      if (settled) return;
      settled = true;
      stopObserver();
      done(el);
    }
    var frames = 0;
    (function poll() {
      if (settled) return;
      var el = resolveAnchor(guideId);
      if (el) { finish(el); return; }
      if (++frames < 90) { requestAnimationFrame(poll); return; }
      try {
        stopObserver();
        observer = new MutationObserver(function () {
          var found = resolveAnchor(guideId);
          if (found) finish(found);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        setTimeout(function () { finish(resolveAnchor(guideId)); }, 4000);
      } catch (e) { finish(null); }
    })();
  }

  function overlayEls() {
    return {
      overlay: document.getElementById("onboarding-tour-overlay"),
      spotlight: document.getElementById("tour-spotlight"),
      card: document.getElementById("tour-card"),
      badge: document.getElementById("tour-step-badge"),
      title: document.getElementById("tour-card-title"),
      body: document.getElementById("tour-card-body"),
      prev: document.getElementById("tour-btn-prev"),
      next: document.getElementById("tour-btn-next"),
      skip: document.getElementById("tour-btn-skip")
    };
  }

  function placeCard(els, target) {
    var card = els.card;
    card.style.transform = "";
    card.style.width = "";
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!target) {
      card.style.top = "50%"; card.style.left = "50%";
      card.style.transform = "translate(-50%, -50%)";
      card.style.maxWidth = Math.min(420, vw - 32) + "px";
      return;
    }
    var r = target.getBoundingClientRect(), pad = 8;
    var spot = els.spotlight;
    if (spot) {
      spot.style.display = "block";
      spot.style.top = Math.max(0, r.top - pad + window.scrollY) + "px";
      spot.style.left = Math.max(0, r.left - pad + window.scrollX) + "px";
      spot.style.width = (r.width + pad * 2) + "px";
      spot.style.height = (r.height + pad * 2) + "px";
    }
    var cardW = Math.min(360, vw - 32);
    var left = Math.max(16, Math.min(r.left, vw - cardW - 16));
    var below = r.bottom + 12, above = r.top - 12;
    var cardH = card.offsetHeight || 220;
    var top = (below + cardH < vh - 90) ? below : Math.max(16, above - cardH);
    /* Không che sticky audio player phía đáy. */
    var player = document.getElementById("app-player-bar");
    if (player) {
      var pr = player.getBoundingClientRect();
      if (top + cardH > pr.top - 8) top = Math.max(16, pr.top - cardH - 12);
    }
    card.style.width = cardW + "px";
    card.style.top = Math.max(16, top + window.scrollY) + "px";
    card.style.left = left + "px";
  }

  function showStep() {
    var tour = TOURS[machine.tourId];
    if (!tour) { setState("ERROR"); return; }
    var step = tour.steps[machine.stepIndex];
    if (!step) { completeTour(); return; }
    if (step.workspace && typeof window.switchWorkspace === "function") {
      try { window.switchWorkspace(step.workspace); } catch (e) {}
    }
    var els = overlayEls();
    if (els.badge) els.badge.textContent = "Bước " + (machine.stepIndex + 1) + " / " + tour.steps.length + " · " + tour.title;
    if (els.title) els.title.textContent = step.title;
    if (els.body) els.body.textContent = step.body;
    if (els.prev) els.prev.disabled = (machine.stepIndex === 0);
    if (els.next) els.next.textContent = (machine.stepIndex === tour.steps.length - 1) ? "Hoàn tất" : "Tiếp tục";
    if (els.overlay) {
      /* P1 (§8): tour overlay dùng chung UQModal để có trap + scroll lock + restore. */
      if (window.UQModal && window.UQModal.open) {
        try { window.UQModal.open(els.overlay, machine.lastFocus); } catch (e) {
          els.overlay.style.display = "block"; els.overlay.classList.add("open");
        }
      } else {
        els.overlay.style.display = "block"; els.overlay.classList.add("open");
      }
    }
    writeTour(machine.tourId, { status: "active", lastStep: machine.stepIndex + 1 });
    log("step", machine.tourId, machine.stepIndex + 1, step.anchor);
    waitAnchor(step.anchor, function (target) {
      if (machine.state !== "ACTIVE" || !tour.steps[machine.stepIndex]) return;
      if (!target) {
        /* §6 spec 06: optional → skip + tiếp tục; required → dừng gracefully, app vẫn dùng được. */
        log("missing-anchor", machine.tourId, step.anchor, step.optional ? "optional-skip" : "required-stop");
        if (step.optional) {
          if (window.showNotification) window.showNotification("Không tìm thấy mục hướng dẫn (" + step.anchor + "), bỏ qua bước này.", "warning");
          nextStep(true);
        } else {
          if (window.showNotification) window.showNotification("Không thể tiếp tục hướng dẫn (thiếu mục " + step.anchor + "). Ứng dụng vẫn dùng bình thường.", "warning");
          pauseTour();
          restoreFocus();
        }
        return;
      }
      placeCard(els, target);
      try {
        if (!REDUCED_MOTION) target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        else target.scrollIntoView({ block: "nearest" });
      } catch (e) {}
      var card = els.card;
      if (card) {
        var btn = card.querySelector("#tour-btn-next") || card;
        try { btn.focus({ preventScroll: true }); } catch (e2) {}
      }
    });
  }

  function setState(s) {
    log("state", machine.state, "→", s);
    machine.state = s;
  }

  function hideOverlay() {
    stopObserver();
    var els = overlayEls();
    if (els.overlay) {
      if (window.UQModal && window.UQModal.close) {
        try { window.UQModal.close(els.overlay); } catch (e) {
          els.overlay.style.display = "none"; els.overlay.classList.remove("open");
        }
      } else {
        els.overlay.style.display = "none"; els.overlay.classList.remove("open");
      }
    }
    if (els.spotlight) els.spotlight.style.display = "none";
  }

  function restoreFocus() {
    if (machine.lastFocus && typeof machine.lastFocus.focus === "function") {
      try { machine.lastFocus.focus(); } catch (e) {}
    }
    machine.lastFocus = null;
  }

  function startTour(tourId, fromStep) {
    if (!TOURS[tourId]) return false;
    if (machine.state === "ACTIVE") pauseTour();
    var rec = tourRecord(tourId);
    var idx = 0;
    if (typeof fromStep === "number") idx = fromStep;
    else if (rec && rec.status === "active" && rec.lastStep > 0) idx = Math.min(rec.lastStep - 1, TOURS[tourId].steps.length - 1);
    if (rec && rec.version !== TOURS[tourId].version) idx = 0;
    machine.tourId = tourId;
    machine.stepIndex = idx;
    machine.lastFocus = document.activeElement;
    setState("STARTING");
    setState("ACTIVE");
    showStep();
    return true;
  }

  function nextStep(skipped) {
    var tour = TOURS[machine.tourId];
    if (!tour) return;
    if (machine.stepIndex < tour.steps.length - 1) {
      machine.stepIndex++;
      if (!skipped) writeTour(machine.tourId, { lastStep: machine.stepIndex + 1 });
      showStep();
    } else {
      completeTour();
    }
  }
  function prevStep() {
    if (machine.stepIndex > 0) {
      machine.stepIndex--;
      writeTour(machine.tourId, { lastStep: machine.stepIndex + 1 });
      showStep();
    }
  }
  function completeTour() {
    if (!machine.tourId) return;
    writeTour(machine.tourId, {
      status: "completed", lastStep: TOURS[machine.tourId].steps.length,
      completedAt: new Date().toISOString(), version: TOURS[machine.tourId].version
    });
    setState("COMPLETED");
    hideOverlay();
    restoreFocus();
    machine.tourId = null;
    setState("IDLE");
  }
  function dismissTour() {
    if (machine.tourId) {
      writeTour(machine.tourId, {
        status: "dismissed", lastStep: machine.stepIndex + 1,
        dismissedAt: new Date().toISOString(), version: TOURS[machine.tourId].version
      });
    }
    setState("DISMISSED");
    hideOverlay();
    restoreFocus();
    machine.tourId = null;
    setState("IDLE");
  }
  function pauseTour() {
    if (machine.state === "ACTIVE" && machine.tourId) {
      writeTour(machine.tourId, { status: "active", lastStep: machine.stepIndex + 1 });
    }
    setState("PAUSED");
    hideOverlay();
  }

  /* ------------------------------------------------------------------ */
  /* Welcome (first-run, không chặn).                                    */
  /* ------------------------------------------------------------------ */
  function showWelcome() {
    if (document.getElementById("uq-welcome-overlay")) return;
    var ov = document.createElement("div");
    ov.id = "uq-welcome-overlay";
    ov.className = "uq-welcome-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-labelledby", "uq-welcome-title");
    ov.innerHTML =
      '<div class="uq-welcome-card">' +
        '<h2 id="uq-welcome-title" class="uq-welcome-title">Chào mừng đến UnfoldIQ</h2>' +
        '<p class="uq-welcome-body">UnfoldIQ giúp bạn biến một kịch bản đã duyệt thành video: ' +
        'tạo giọng đọc, chia cảnh, chuẩn bị hình ảnh và chuyển động, kiểm tra chất lượng, ' +
        'dựng timeline và xuất video cuối.</p>' +
        '<div class="uq-welcome-actions">' +
          '<button id="uq-welcome-start" class="btn btn-primary" type="button">Bắt đầu hướng dẫn nhanh</button>' +
          '<button id="uq-welcome-later" class="btn btn-secondary" type="button">Khám phá sau</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    machine.lastFocus = document.activeElement;
    trapIn(ov);
    var btnStart = document.getElementById("uq-welcome-start");
    function closeWelcome(dismissed) {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      var s = loadStore();
      s.meta = s.meta || {};
      s.meta.welcome = dismissed ? "dismissed" : "started";
      saveStore(s);
      restoreFocus();
    }
    if (btnStart) btnStart.addEventListener("click", function () {
      closeWelcome(false);
      startTour("product-overview", 0);
    });
    var btnLater = document.getElementById("uq-welcome-later");
    if (btnLater) btnLater.addEventListener("click", function () { closeWelcome(true); });
    document.addEventListener("keydown", function esc(ev) {
      if (ev.key === "Escape" && document.getElementById("uq-welcome-overlay")) {
        var b = document.getElementById("uq-welcome-later");
        if (b) b.click();
        document.removeEventListener("keydown", esc);
      }
    });
    try { if (btnStart) btnStart.focus(); } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /* Help / Replay Center (§12 spec 04): menu, không auto-run tour.       */
  /* ------------------------------------------------------------------ */
  function currentWorkspace() {
    var active = document.querySelector(".workspace-view.active");
    if (active && active.id) return active.id.replace(/^ws-/, "");
    return "overview";
  }
  function currentTourId() {
    return WORKSPACE_TOUR[currentWorkspace()] || "product-overview";
  }
  function tourLabel(tourId) {
    return (TOURS[tourId] && TOURS[tourId].title) || tourId;
  }

  function closeHelpMenu() {
    var m = document.getElementById("uq-help-menu");
    if (m && m.parentNode) m.parentNode.removeChild(m);
    document.removeEventListener("click", outsideHelp, true);
  }
  function outsideHelp(e) {
    var m = document.getElementById("uq-help-menu");
    var btn = document.getElementById("btn-open-tour");
    if (m && !m.contains(e.target) && e.target !== btn && !(btn && btn.contains(e.target))) closeHelpMenu();
  }

  function openHelpMenu(anchorBtn) {
    closeHelpMenu();
    var tid = currentTourId();
    var rec = tourRecord(tid);
    var menu = document.createElement("div");
    menu.id = "uq-help-menu";
    menu.className = "uq-help-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Trung tâm hướng dẫn");
    var canResume = !!(rec && rec.status === "active" && rec.lastStep > 0 && rec.lastStep < TOURS[tid].steps.length);
    menu.innerHTML =
      '<button type="button" role="menuitem" data-act="quick"><span>Hướng dẫn nhanh</span><small>6 bước script-first</small></button>' +
      '<button type="button" role="menuitem" data-act="current"><span>Hướng dẫn mục hiện tại</span><small>' + escapeHtml(tourLabel(tid)) + '</small></button>' +
      '<button type="button" role="menuitem" data-act="resume"' + (canResume ? "" : " disabled") + '><span>Tiếp tục hướng dẫn</span><small>' + (canResume ? ("Bước " + rec.lastStep + " · " + escapeHtml(tourLabel(tid))) : "Không có tour đang dở") + '</small></button>' +
      '<button type="button" role="menuitem" data-act="restart"><span>Bắt đầu lại hướng dẫn</span><small>Từ bước 1 mục hiện tại</small></button>' +
      '<button type="button" role="menuitem" data-act="glossary"><span>Giải thích thuật ngữ</span><small>Scene, Blueprint, Khóa…</small></button>';
    document.body.appendChild(menu);
    try {
      var r = anchorBtn.getBoundingClientRect();
      menu.style.top = (r.bottom + 8 + window.scrollY) + "px";
      menu.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    } catch (e) {}
    menu.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b || b.disabled) return;
      var act = b.getAttribute("data-act");
      closeHelpMenu();
      if (act === "quick") startTour("product-overview", 0);
      else if (act === "current") startTour(currentTourId(), 0);
      else if (act === "resume") startTour(tid);
      else if (act === "restart") startTour(currentTourId(), 0);
      else if (act === "glossary") openGlossary();
    });
    menu.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeHelpMenu(); try { anchorBtn.focus(); } catch (e2) {} }
    });
    document.addEventListener("click", outsideHelp, true);
    try {
      var first = menu.querySelector("button:not([disabled])");
      if (first) first.focus();
    } catch (e2) {}
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* Focus trap tối thiểu cho modal do guide mở (welcome/glossary). */
  function trapIn(container) {
    function onKey(e) {
      if (e.key !== "Tab") return;
      var f = container.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
      f = Array.prototype.filter.call(f, function (el) { return !el.disabled; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    container.addEventListener("keydown", onKey);
    return function release() { container.removeEventListener("keydown", onKey); };
  }

  function openGlossary() {
    var title = document.getElementById("help-modal-title");
    var body = document.getElementById("help-modal-body");
    var modal = document.getElementById("contextual-help-modal");
    if (!title || !body || !modal) return;
    title.textContent = "Giải thích thuật ngữ";
    body.innerHTML = '<div class="help-sections-list">' + GLOSSARY.map(function (g) {
      return '<div class="help-section"><div class="help-section-title">' + escapeHtml(g[0]) +
        '</div><div class="help-section-content">' + escapeHtml(g[1]) + '</div></div>';
    }).join("") + "</div>";
    modal.style.display = "flex";
    modal.classList.add("open");
    machine.lastFocus = document.activeElement;
    var releaseTrap = trapIn(modal);
    var closeBtn = document.getElementById("help-modal-close-btn");
    var actionBtn = document.getElementById("help-modal-action-btn");
    function done() {
      try { releaseTrap(); } catch (e) {}
      restoreFocus();
    }
    if (closeBtn && !closeBtn.__uqGuideGlossary) {
      closeBtn.__uqGuideGlossary = true;
      closeBtn.addEventListener("click", done);
    }
    if (actionBtn && !actionBtn.__uqGuideGlossary) {
      actionBtn.__uqGuideGlossary = true;
      actionBtn.addEventListener("click", done);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tooltip engine (§16 spec 04, §10 spec 06): hover + focus,            */
  /* aria-describedby, role=tooltip, Escape, không control tương tác.     */
  /* ------------------------------------------------------------------ */
  var tipEl = null, tipFor = null;
  function hideTip() {
    if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    tipEl = null;
    if (tipFor) {
      try { tipFor.removeAttribute("aria-describedby"); } catch (e) {}
      tipFor = null;
    }
    document.removeEventListener("keydown", tipEsc, true);
  }
  function tipEsc(e) {
    if (e.key === "Escape") { hideTip(); }
  }
  function showTip(target) {
    var text = target.getAttribute("data-guide-tip");
    if (!text) return;
    hideTip();
    tipEl = document.createElement("div");
    tipEl.className = "uq-tip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.id = "uq-tip-live";
    tipEl.textContent = text;
    document.body.appendChild(tipEl);
    target.setAttribute("aria-describedby", "uq-tip-live");
    tipFor = target;
    try {
      var r = target.getBoundingClientRect();
      var tw = tipEl.offsetWidth || 220, th = tipEl.offsetHeight || 40;
      var left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
      var top = r.bottom + 8 + window.scrollY;
      if (r.bottom + th + 12 > window.innerHeight) top = r.top - th - 8 + window.scrollY;
      tipEl.style.left = left + "px";
      tipEl.style.top = Math.max(8, top) + "px";
    } catch (e) {}
    document.addEventListener("keydown", tipEsc, true);
  }
  function bindTips() {
    document.querySelectorAll("[data-guide-tip]").forEach(function (el) {
      if (el.__uqTipBound) return;
      el.__uqTipBound = true;
      el.addEventListener("mouseenter", function () { showTip(el); });
      el.addEventListener("mouseleave", function () { if (tipFor === el) hideTip(); });
      el.addEventListener("focus", function () { showTip(el); });
      el.addEventListener("blur", function () { if (tipFor === el) hideTip(); });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Public API + boot.                                                  */
  /* ------------------------------------------------------------------ */
  window.UQGuide = {
    TOURS: TOURS,
    start: startTour,
    next: function () { nextStep(false); },
    prev: prevStep,
    dismiss: dismissTour,
    pause: pauseTour,
    openHelp: openHelpMenu,
    openGlossary: openGlossary,
    currentTourId: currentTourId,
    state: function () { return machine.state; },
    store: loadStore
  };

  function boot() {
    migrateLegacy();
    bindTips();
    /* First-visit contextual offer (§C QA + §15 spec 04): mở workspace lần đầu →
       tự chạy tour tương ứng (trừ product-overview đã có Welcome). Một lần duy nhất
       (dismiss/complete ghi record nên không lặp). Không chạy khi tour đang active,
       Welcome còn mở, hay user đã có state. */
    try {
      if (typeof window.switchWorkspace === "function" && !window.switchWorkspace.__uqGuideWrapped) {
        var prevSwitch = window.switchWorkspace;
        var wrapped = function (targetId) {
          var r = prevSwitch.apply(this, arguments);
          try {
            var tid = WORKSPACE_TOUR[targetId] || null;
            var s = loadStore();
            var welcomeDone = !!(s.meta && (s.meta.welcome || s.meta.legacyCompleted));
            if (tid && tid !== "product-overview" && machine.state === "IDLE" &&
                welcomeDone && !s.tours[tid] && !document.getElementById("uq-welcome-overlay")) {
              log("first-visit", targetId, "→", tid);
              startTour(tid, 0);
            }
          } catch (e) {}
          return r;
        };
        wrapped.__uqGuideWrapped = true;
        window.switchWorkspace = wrapped;
      }
    } catch (e) {}
    /* Nút Hướng dẫn → Help Center (không auto-run tour). */
    var btn = document.getElementById("btn-open-tour");
    if (btn && !btn.__uqGuideBound) {
      btn.__uqGuideBound = true;
      /* Ghi đè listener cũ (mở tour ngay) bằng capture + stopImmediatePropagation. */
      btn.addEventListener("click", function (e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        openHelpMenu(btn);
      }, true);
    }
    /* Tour card buttons → engine. */
    var els = overlayEls();
    if (els.overlay && !els.overlay.__uqTrap) {
      els.overlay.__uqTrap = true;
      trapIn(els.overlay);
    }
    if (els.next && !els.next.__uqGuideBound) {
      els.next.__uqGuideBound = true;
      els.next.addEventListener("click", function () { nextStep(false); });
    }
    if (els.prev && !els.prev.__uqGuideBound) {
      els.prev.__uqGuideBound = true;
      els.prev.addEventListener("click", prevStep);
    }
    if (els.skip && !els.skip.__uqGuideBound) {
      els.skip.__uqGuideBound = true;
      els.skip.addEventListener("click", dismissTour);
    }
    document.addEventListener("keydown", function (e) {
      if (machine.state !== "ACTIVE") return;
      var ov = els.overlay;
      if (!ov || ov.style.display === "none") return;
      if (e.key === "Escape") { dismissTour(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (document.activeElement === els.next || document.activeElement === els.prev || document.activeElement === els.skip) return;
        nextStep(false);
      } else if (e.key === "ArrowLeft") { prevStep(); }
    });
    /* First-run welcome: chỉ khi chưa có state v2 nào (không ép user đã xong tour cũ). */
    var s = loadStore();
    /* Welcome chỉ khi hoàn toàn chưa có state (user mới). User đã xong tour cũ
       (legacyCompleted) hay đã có record/welcome thì không hiện. */
    var hasAny = Object.keys(s.tours || {}).length > 0 ||
      (s.meta && (s.meta.welcome || s.meta.legacyCompleted));
    if (!hasAny) showWelcome();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
