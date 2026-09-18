/**
 * UnfoldIQ — UQ Command Palette (Phase 5, Ctrl+K)
 * Vanilla JS, no dependencies, no network, no LLM.
 *
 * Index sources (already-loaded lightweight slices only):
 * - visualScenesList (scene_id, index, category)
 * - shot_ids per scene (stable IDs, no detail preload)
 * - visualBibleSliceData characters/subjects (stable entity IDs)
 *
 * Results carry {type, stable_id, label, context, activate}.
 * Activation reuses existing globals: switchWorkspace, selectVisualShot,
 * openVisualBibleModal, selectVisualBibleEntity. Nothing is mutated.
 */
(function () {
  "use strict";

  var KIND_LABEL = { scene: "Cảnh", shot: "Cảnh quay", character: "Nhân vật" };
  var MAX_RESULTS = 9;

  var backdrop = null;
  var input = null;
  var list = null;
  var items = [];
  var activeIdx = 0;
  var returnFocusTo = null;
  var currentProject = null;

  function norm(s) {
    return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  /**
   * Deterministic local fuzzy score. Higher = better. -1 = no match.
   * Supports substring, token-prefix, subsequence; stable ranking.
   */
  function fuzzyScore(query, text) {
    var q = norm(query), t = norm(text);
    if (!q) return 0;
    if (t === q) return 1000;
    if (t.indexOf(q) !== -1) return 500 - t.indexOf(q);
    var qt = q.split(" "), tt = t.split(" ");
    var prefixHits = 0, ok = true;
    for (var i = 0; i < qt.length; i++) {
      var hit = false;
      for (var j = 0; j < tt.length; j++) {
        if (tt[j].indexOf(qt[i]) === 0) { hit = true; prefixHits++; break; }
      }
      if (!hit) { ok = false; break; }
    }
    if (ok) return 300 + prefixHits * 10 - t.length;
    // subsequence fallback
    var qi = 0;
    for (var k = 0; k < t.length && qi < q.length; k++) {
      if (t[k] === q[qi]) qi++;
    }
    if (qi === q.length) return 100 - t.length;
    return -1;
  }

  function buildIndex() {
    var idx = [];
    // Scene/shot data comes from the read-only app hook (lightweight slices
    // already loaded by the Visual Workbench — no extra network per keystroke).
    var scenes = (window.__uqPaletteScenes ? window.__uqPaletteScenes() : []) || [];
    scenes.forEach(function (sc) {
      idx.push({ type: "scene", stable_id: sc.scene_id,
        label: "Cảnh " + sc.index + " (" + sc.scene_id + ")",
        hay: [sc.scene_id, "canh " + sc.index, String(sc.index), sc.category || "", "scene"].join(" "),
        context: (sc.category || "") + " · " + ((sc.shot_ids || []).length + " shot"),
        scene_id: sc.scene_id });
      (sc.shot_ids || []).forEach(function (shotId) {
        idx.push({ type: "shot", stable_id: shotId,
          label: "Cảnh quay " + shotId,
          hay: [shotId, "canh quay", sc.scene_id, "shot"].join(" "),
          context: sc.scene_id, scene_id: sc.scene_id, shot_id: shotId });
      });
    });
    var vb = null;
    try {
      if (window.getVisualBibleData) vb = window.getVisualBibleData();
    } catch (e) { vb = null; }
    var chars = (vb && (vb.characters || vb.subjects)) || [];
    chars.forEach(function (c) {
      var id = c.characterId || c.subjectId || c.id;
      if (!id) return;
      idx.push({ type: "character", stable_id: id,
        label: c.name || id,
        hay: [id, c.name || "", c.species || "", "nhan vat", "character"].join(" "),
        context: c.species || "Visual Bible", entity_id: id });
    });
    return idx;
  }

  function search(query) {
    var idx = buildIndex();
    var out = [];
    idx.forEach(function (it) {
      var s = fuzzyScore(query, it.hay);
      if (s >= 0) out.push({ it: it, score: s });
    });
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.it.type !== b.it.type) return a.it.type < b.it.type ? -1 : 1;
      return a.it.stable_id < b.it.stable_id ? -1 : 1;
    });
    return out.slice(0, MAX_RESULTS).map(function (r) { return r.it; });
  }

  function render() {
    if (!list) return;
    items = search(input.value);
    activeIdx = 0;
    if (!items.length) {
      list.innerHTML = '<div class="uq-cmd-empty" role="status">Không tìm thấy kết quả</div>';
      input.setAttribute("aria-expanded", "false");
      return;
    }
    input.setAttribute("aria-expanded", "true");
    list.innerHTML = items.map(function (it, i) {
      return '<button type="button" role="option" id="uq-cmd-opt-' + i + '" ' +
        'class="uq-cmd-item' + (i === activeIdx ? " is-active" : "") + '" ' +
        'aria-selected="' + (i === activeIdx) + '" data-idx="' + i + '">' +
        '<span class="uq-cmd-kind">' + KIND_LABEL[it.type] + '</span>' +
        '<span><span class="uq-cmd-label">' + escapeHtml(it.label) + '</span><br>' +
        '<span class="uq-cmd-sub">' + escapeHtml(it.stable_id + (it.context ? " · " + it.context : "")) + '</span></span>' +
        '</button>';
    }).join("");
    input.setAttribute("aria-activedescendant", "uq-cmd-opt-0");
    Array.prototype.forEach.call(list.querySelectorAll(".uq-cmd-item"), function (btn) {
      btn.addEventListener("click", function () {
        activate(parseInt(btn.dataset.idx, 10));
      });
      btn.addEventListener("mousemove", function () {
        setActive(parseInt(btn.dataset.idx, 10));
      });
    });
  }

  function escapeHtml(s) {
    if (window.UQ && window.UQ.esc) return window.UQ.esc(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function setActive(i) {
    if (!items.length) return;
    activeIdx = Math.max(0, Math.min(items.length - 1, i));
    Array.prototype.forEach.call(list.querySelectorAll(".uq-cmd-item"), function (btn, j) {
      var on = j === activeIdx;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    input.setAttribute("aria-activedescendant", "uq-cmd-opt-" + activeIdx);
    var active = list.querySelector("#uq-cmd-opt-" + activeIdx);
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function activate(i) {
    var it = items[i];
    if (!it) return;
    var project = currentProject;
    close();
    try {
      if (it.type === "scene") {
        if (window.switchWorkspace) window.switchWorkspace("scenes");
        if (window.selectVisualShot && window.__uqPaletteFirstShot) {
          var first = window.__uqPaletteFirstShot(it.scene_id);
          if (first) window.selectVisualShot(first, it.scene_id);
        }
      } else if (it.type === "shot") {
        if (window.switchWorkspace) window.switchWorkspace("scenes");
        if (window.selectVisualShot) window.selectVisualShot(it.shot_id, it.scene_id);
      } else if (it.type === "character") {
        if (window.openVisualBibleModal) window.openVisualBibleModal();
        if (window.selectVisualBibleEntity) {
          window.selectVisualBibleEntity("subjects", it.entity_id);
        }
      }
    } catch (e) { /* never break the app from palette */ }
    void project;
  }

  function open() {
    if (backdrop) { input.value = ""; render(); input.focus(); return; }
    returnFocusTo = document.activeElement;
    try {
      currentProject = window.currentProjectDir || null;
    } catch (e) { currentProject = null; }
    backdrop = document.createElement("div");
    backdrop.className = "uq-cmd-backdrop";
    backdrop.innerHTML =
      '<div class="uq-cmd-dialog" role="dialog" aria-modal="true" aria-label="Tìm nhanh">' +
      '<input id="uq-cmd-input" class="uq-cmd-input" type="text" role="combobox" ' +
      'aria-expanded="false" aria-controls="uq-cmd-list" aria-autocomplete="list" ' +
      'aria-label="Tìm nhanh" placeholder="Tìm cảnh, cảnh quay hoặc nhân vật...">' +
      '<div id="uq-cmd-list" class="uq-cmd-list" role="listbox" aria-label="Kết quả tìm kiếm"></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    input = backdrop.querySelector("#uq-cmd-input");
    list = backdrop.querySelector("#uq-cmd-list");
    input.addEventListener("input", render);
    input.addEventListener("keydown", onInputKey);
    list.addEventListener("keydown", function (e) {
      if (e.key === "Tab") trapTab(e);
    });
    backdrop.addEventListener("mousedown", function (e) {
      if (e.target === backdrop) close();
    });
    render();
    input.focus();
  }

  // Phase 6: modal dialog keeps Tab cycling inside (SC 2.4.3 help).
  function trapTab(e) {
    var focusables = list ? Array.prototype.slice.call(
      list.querySelectorAll(".uq-cmd-item")) : [];
    if (input) focusables.unshift(input);
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function onInputKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === "Enter") { e.preventDefault(); activate(activeIdx); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") { trapTab(e); }
  }

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null; input = null; list = null; items = [];
    if (returnFocusTo && document.contains(returnFocusTo)) {
      try { returnFocusTo.focus(); } catch (e) {}
    }
    returnFocusTo = null;
  }

  function isOpen() { return !!backdrop; }

  document.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod || (e.key !== "k" && e.key !== "K")) return;
    if (e.isComposing) return;
    // Respect components with their own Ctrl+K binding.
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (isOpen()) close();
    else open();
  });

  window.UQPalette = {
    open: open, close: close, isOpen: isOpen, search: search,
    fuzzyScore: fuzzyScore, KIND_LABEL: KIND_LABEL,
  };
})();
