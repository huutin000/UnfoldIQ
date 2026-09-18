/* UnfoldIQ shell behaviors — single-owner helpers (01B/01C).
   Không vá UI bằng observer; i18n nằm tại source renderers. */
(function () {
  "use strict";
  function onReady(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

  /* ---------- Toast info (dùng hệ sẵn có, fallback) ---------- */
  function toast(msg, type) {
    try {
      if (typeof window.showToast === "function") { window.showToast(msg, type || "info"); return; }
      var c = document.getElementById("toast-container");
      if (!c) { c = document.createElement("div"); c.id = "toast-container"; c.className = "toast-container"; c.setAttribute("aria-live", "polite"); document.body.appendChild(c); }
      var d = document.createElement("div"); d.className = "toast-item toast-" + (type || "info"); d.setAttribute("role", "status");
      d.textContent = msg; c.appendChild(d); setTimeout(function () { d.remove(); }, 4200);
    } catch (e) { /* no-op */ }
  }

  /* ---------- UIR-002: helper loading chuẩn ---------- */
  function setBtnLoading(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      if (btn.dataset.origText === undefined) btn.dataset.origText = btn.innerHTML;
      btn.classList.add("is-loading"); btn.setAttribute("aria-busy", "true"); btn.disabled = true;
      var label = btn.querySelector("span:last-child");
      if (loadingText && label) label.textContent = loadingText;
    } else {
      btn.classList.remove("is-loading"); btn.removeAttribute("aria-busy"); btn.disabled = false;
      if (btn.dataset.origText !== undefined) { btn.innerHTML = btn.dataset.origText; delete btn.dataset.origText; }
    }
  }
  window.setBtnLoading = setBtnLoading;
  /* Track một promise thật: loading tới khi settle, không dùng timer giả.
     Các call-site trong app.js/phase14_ui.js gọi trực tiếp khi bắt đầu/kết thúc. */
  function trackAsync(btn, promise, loadingText) {
    setBtnLoading(btn, true, loadingText || "Đang xử lý...");
    return Promise.resolve(promise).then(
      function (v) { setBtnLoading(btn, false); return v; },
      function (e) { setBtnLoading(btn, false); throw e; }
    );
  }
  window.trackAsync = trackAsync;

  /* ---------- UIR-001: stepper wrap + nút ‹ › + select mobile ---------- */
  function enhanceStepper() {
    var stepper = document.getElementById("workflow-stepper");
    if (!stepper || stepper.dataset.enhanced === "1") return;
    stepper.dataset.enhanced = "1";
    var wrap = document.createElement("div"); wrap.className = "stepper-wrap";
    stepper.parentNode.insertBefore(wrap, stepper); wrap.appendChild(stepper);
    var prev = document.createElement("button"); prev.className = "stepper-nav-btn"; prev.type = "button"; prev.textContent = "‹"; prev.setAttribute("aria-label", "Cuộn bước trước");
    var next = document.createElement("button"); next.className = "stepper-nav-btn"; next.type = "button"; next.textContent = "›"; next.setAttribute("aria-label", "Cuộn bước sau");
    wrap.insertBefore(prev, stepper); wrap.appendChild(next);
    prev.addEventListener("click", function () { stepper.scrollBy({ left: -220, behavior: "smooth" }); });
    next.addEventListener("click", function () { stepper.scrollBy({ left: 220, behavior: "smooth" }); });
    function syncArrows() {
      prev.disabled = stepper.scrollLeft <= 4;
      next.disabled = stepper.scrollLeft + stepper.clientWidth >= stepper.scrollWidth - 4;
    }
    stepper.addEventListener("scroll", syncArrows, { passive: true });
    window.addEventListener("resize", function () { syncArrows(); syncFit(); });
    // 01B: layout-driven — grid collapse đổi clientWidth mà không có window resize.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(function () { syncArrows(); syncFit(); }).observe(stepper);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { syncArrows(); syncFit(); });
    setTimeout(function () { syncArrows(); syncFit(); }, 300);
    // 01B: vừa đủ chỗ thì giãn đều + ẩn nút cuộn; thiếu chỗ mới cuộn + hiện nút.
    function syncFit() {
      var fits = stepper.scrollWidth <= stepper.clientWidth + 1;
      wrap.classList.toggle("fit", fits);
      syncArrows();
    }
    // Select bước hiện tại cho mobile
    var sel = document.createElement("select"); sel.className = "form-select stepper-select"; sel.setAttribute("aria-label", "Chọn bước sản xuất");
    var steps = stepper.querySelectorAll(".stepper-item[data-workspace]");
    steps.forEach(function (s, i) {
      var o = document.createElement("option"); o.value = s.dataset.workspace || "";
      o.textContent = (i + 1) + ". " + (s.querySelector(".step-label") ? s.querySelector(".step-label").textContent.trim() : o.value);
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { if (window.switchWorkspace && sel.value) window.switchWorkspace(sel.value); });
    wrap.parentNode.insertBefore(sel, wrap.nextSibling);
    // Active step luôn visible + đồng bộ select (chỉ cuộn khi thực sự bị che)
    var obs = new MutationObserver(function () {
      var act = stepper.querySelector(".stepper-item.active");
      if (act) {
        var sr = stepper.getBoundingClientRect(), r = act.getBoundingClientRect();
        if (r.left < sr.left - 1 || r.right > sr.right + 1) {
          try { act.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); } catch (e) {}
        }
        sel.value = act.dataset.workspace || "";
      }
      syncArrows(); syncFit();
    });
    obs.observe(stepper, { attributes: true, subtree: true, attributeFilter: ["class"] });
  }

  /* 01B: shell toggle (sidebar/inspector/gear) do app.js làm single owner.
     redesign.js không gắn thêm handler để tránh duplicate/conflict. */

  /* ---------- Dropzone + lightbox (single owner) ---------- */
  function makeDropzone(fileInput, acceptHint) {
    if (!fileInput || fileInput.dataset.dz === "1") return;
    fileInput.dataset.dz = "1";
    var wrap = document.createElement("div"); wrap.className = "dropzone-wrap";
    var dz = document.createElement("div"); dz.className = "dropzone"; dz.setAttribute("role", "button"); dz.tabIndex = 0;
    dz.setAttribute("aria-label", "Vùng tải tệp: " + acceptHint);
    dz.innerHTML = "<div class='dz-title'>Kéo tệp vào đây</div><div>hoặc</div>";
    var pick = document.createElement("button"); pick.type = "button"; pick.className = "btn btn-secondary btn-sm"; pick.textContent = "Chọn tệp";
    var hint = document.createElement("div"); hint.className = "dz-hint"; hint.textContent = acceptHint;
    dz.appendChild(pick); dz.appendChild(hint);
    fileInput.parentNode.insertBefore(wrap, fileInput);
    wrap.appendChild(dz); wrap.appendChild(fileInput);
    dz.style.position = "relative";
    fileInput.style.cssText = "position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;";
    dz.insertBefore(fileInput, pick);
    var meta = document.createElement("div"); meta.className = "upload-meta"; meta.style.display = "none";
    meta.innerHTML = "<div class='meta-preview'></div><div class='meta-text'><div class='fname'></div><div class='fsub'></div></div>";
    var acts = document.createElement("div"); acts.style.display = "flex"; acts.style.gap = "6px";
    var bView = document.createElement("button"); bView.type = "button"; bView.className = "btn btn-secondary btn-sm"; bView.textContent = "Xem";
    var bClear = document.createElement("button"); bClear.type = "button"; bClear.className = "btn btn-secondary btn-sm"; bClear.textContent = "Xóa";
    acts.appendChild(bView); acts.appendChild(bClear); meta.appendChild(acts);
    wrap.appendChild(meta);
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("dragover"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("dragover"); });
    dz.addEventListener("drop", function (e) {
      e.preventDefault(); dz.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
    // Ngăn nút "Chọn tệp" kích hoạt 2 lần (input đã phủ toàn dropzone)
    pick.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) { meta.style.display = "none"; return; }
      meta.style.display = "flex";
      meta.querySelector(".fname").textContent = f.name;
      meta.querySelector(".fsub").textContent = (f.type || "tệp") + " · " + Math.round(f.size / 1024) + " KB";
      var pv = meta.querySelector(".meta-preview"); pv.innerHTML = "";
      if ((f.type || "").indexOf("image/") === 0) {
        var img = document.createElement("img"); img.alt = "Xem trước " + f.name;
        img.src = URL.createObjectURL(f); pv.appendChild(img);
        bView.onclick = function () { openLightbox(img.src, "image"); };
      } else if ((f.type || "").indexOf("video/") === 0) {
        var v = document.createElement("video"); v.controls = true; v.src = URL.createObjectURL(f); pv.appendChild(v);
        bView.onclick = function () { openLightbox(v.src, "video"); };
      } else { pv.textContent = "—"; bView.onclick = function () { toast("Không xem trước được loại tệp này.", "info"); }; }
    });
    bClear.addEventListener("click", function () { fileInput.value = ""; meta.style.display = "none"; });
  }
  function openLightbox(src, kind, gallery) {
    var lb = document.getElementById("ui-lightbox");
    var lbReturnFocus = document.activeElement;
    if (!lb) {
      lb = document.createElement("div"); lb.id = "ui-lightbox"; lb.className = "lightbox-overlay"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Xem ảnh tham chiếu");
      lb.innerHTML = "<div class='lightbox-bar'><button class='btn btn-secondary btn-sm' data-lb='zoom-in'>Phóng to +</button><button class='btn btn-secondary btn-sm' data-lb='zoom-out'>Thu nhỏ −</button><button class='btn btn-secondary btn-sm' data-lb='fit'>Vừa khung</button><button class='btn btn-secondary btn-sm' data-lb='prev'>Trước</button><button class='btn btn-secondary btn-sm' data-lb='next'>Sau</button><button class='btn btn-secondary btn-sm' data-lb='close'>Đóng</button></div><div class='lightbox-media'></div>";
      document.body.appendChild(lb);
      lb.addEventListener("click", function (e) {
        if (e.target === lb || (e.target.closest && e.target.closest("[data-lb='close']"))) closeLb();
      });
      document.addEventListener("keydown", function (e) {
        if (!lb.classList.contains("open")) return;
        if (e.key === "Escape") closeLb();
        if (e.key === "ArrowLeft") stepLb(-1);
        if (e.key === "ArrowRight") stepLb(1);
        // Phase 6: keep Tab cycling inside the lightbox dialog.
        if (e.key === "Tab") {
          var btns = Array.prototype.slice.call(lb.querySelectorAll(".lightbox-bar button"));
          if (!btns.length) return;
          var first = btns[0], last = btns[btns.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
    }
    var items = (gallery && gallery.length ? gallery : [{ src: src, kind: kind || "image" }]);
    var idx = 0;
    var zoom = 1;
    function render() {
      var media = lb.querySelector(".lightbox-media"); media.innerHTML = "";
      var cur = items[idx];
      var el = cur.kind === "video" ? document.createElement("video") : document.createElement("img");
      if (cur.kind === "video") el.controls = true; else el.alt = "Ảnh tham chiếu phóng to (" + (idx + 1) + "/" + items.length + ")";
      el.src = cur.src; zoom = 1;
      media.appendChild(el);
      lb.querySelector("[data-lb='zoom-in']").onclick = function () { zoom = Math.min(3, zoom + 0.25); el.style.transform = "scale(" + zoom + ")"; };
      lb.querySelector("[data-lb='zoom-out']").onclick = function () { zoom = Math.max(0.5, zoom - 0.25); el.style.transform = "scale(" + zoom + ")"; };
      lb.querySelector("[data-lb='fit']").onclick = function () { zoom = 1; el.style.transform = ""; };
      var multi = items.length > 1;
      lb.querySelector("[data-lb='prev']").style.display = multi ? "" : "none";
      lb.querySelector("[data-lb='next']").style.display = multi ? "" : "none";
    }
    function stepLb(d) {
      if (items.length < 2) return;
      idx = (idx + d + items.length) % items.length;
      render();
    }
    function closeLb() { lb.classList.remove("open"); if (lbReturnFocus && lbReturnFocus.focus) { try { lbReturnFocus.focus({ preventScroll: true }); } catch (e) {} } lbReturnFocus = null; }
    lb.querySelector("[data-lb='prev']").onclick = function () { stepLb(-1); };
    lb.querySelector("[data-lb='next']").onclick = function () { stepLb(1); };
    render();
    lb.classList.add("open");
    lbReturnFocus = document.activeElement;
    var closeBtn = lb.querySelector("[data-lb='close']");
    if (closeBtn) try { closeBtn.focus({ preventScroll: true }); } catch (e) {}
    window._uiCloseLightbox = closeLb;
    window._uiLightboxStep = stepLb;
  }
  window.openLightbox = openLightbox;
  function enhanceUploads() {
    makeDropzone(document.getElementById("intake-file-input"), "PNG / JPG / WEBP / MP4");
    makeDropzone(document.getElementById("vb-ref-file"), "PNG / JPG / WEBP");
    // Lightbox cho lưới tham chiếu có sẵn (delegation, kèm gallery Trước/Sau + phím ←/→)
    // Phase 6: thumbnails are keyboard-activatable (Enter/Space), not hover/click-only.
    document.addEventListener("click", function (e) {
      var img = e.target.closest ? e.target.closest("#vb-ref-grid img, .vb-ref-grid img, .ref-carousel img") : null;
      if (img && img.src) {
        var scope = img.closest("#vb-ref-grid, .vb-ref-grid, .ref-carousel");
        var all = scope ? [...scope.querySelectorAll("img")].filter(function (x) { return x.src; }) : [img];
        openLightbox(img.src, "image", all.map(function (x) { return { src: x.src, kind: "image" }; }));
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var img = e.target && e.target.closest ? e.target.closest("#vb-ref-grid img, .vb-ref-grid img, .ref-carousel img") : null;
      if (!img || !img.src) return;
      e.preventDefault();
      img.click();
    });
    var GRID_IMG_SEL = "#vb-ref-grid img, .vb-ref-grid img, .ref-carousel img";
    function tagGridImg(img) {
      if (img && !img.hasAttribute("tabindex")) {
        img.setAttribute("tabindex", "0");
        if (!img.getAttribute("role")) img.setAttribute("role", "button");
        if (!img.getAttribute("aria-label")) {
          img.setAttribute("aria-label", img.alt ? "Phóng to: " + img.alt : "Xem ảnh tham chiếu phóng to");
        }
      }
    }
    document.querySelectorAll(GRID_IMG_SEL).forEach(tagGridImg);
    var gridImgMo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (!n || n.nodeType !== 1) return;
          if (n.matches && n.matches(GRID_IMG_SEL)) tagGridImg(n);
          if (n.querySelectorAll) n.querySelectorAll(GRID_IMG_SEL).forEach(tagGridImg);
        });
      });
    });
    try { gridImgMo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }

  /* ---------- Modal: Escape + focus restore ---------- */
  var lastFocus = null;
  function enhanceModals() {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      document.querySelectorAll(".modal-overlay").forEach(function (m) {
        if (m.style.display !== "none" && getComputedStyle(m).display !== "none") {
          // Chỉ đóng modal top-most có nút đóng
          var btn = m.querySelector(".modal-close-btn, [id$='-done-btn'], [id$='-cancel-btn']");
          if (btn && m.classList.contains("top-escape")) { btn.click(); }
        }
      });
      var lb = document.getElementById("ui-lightbox");
      if (lb && lb.classList.contains("open") && window._uiCloseLightbox) window._uiCloseLightbox();
    });
    // Đánh dấu modal đang mở để Escape đúng + focus vào modal
    var obs = new MutationObserver(function () {
      document.querySelectorAll(".modal-overlay").forEach(function (m) {
        var open = m.style.display !== "none" && getComputedStyle(m).display !== "none";
        if (open && !m.dataset.opened) {
          m.dataset.opened = "1"; m.classList.add("top-escape");
          lastFocus = document.activeElement;
          var f = m.querySelector("input, select, textarea, button.btn-primary, .modal-close-btn");
          if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
        } else if (!open && m.dataset.opened) {
          delete m.dataset.opened; m.classList.remove("top-escape");
          if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
        }
      });
    });
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["style", "class"] });
  }

  onReady(function () {
    enhanceStepper(); enhanceUploads(); enhanceModals();
  });
})();
