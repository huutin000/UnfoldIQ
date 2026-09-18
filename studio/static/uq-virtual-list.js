/**
 * UnfoldIQ — UQ Virtual List (Phase 5)
 * Vanilla-JS windowing helper for long navigator lists. No dependencies.
 *
 * Contract:
 * - Identity is ALWAYS stable IDs (scene_id / shot_id), never row index.
 * - Selection/focus state lives outside the DOM (caller-owned).
 * - Overscan renders a buffer above/below the viewport.
 * - Top/bottom spacers preserve total scroll height (calibrated average).
 * - Scroll listener is single + passive + rAF-throttled (no leaks).
 *
 * Exposed for contract tests: window.UQVirtualList.THRESHOLD_GROUPS.
 */
(function () {
  "use strict";

  // Evidence-based: direct render p95 stays <50ms up to ~1500 rows;
  // windowing engages at 200 scene groups (well before the knee).
  var THRESHOLD_GROUPS = 200;
  var OVERSCAN_GROUPS = 6;
  var FALLBACK_ROW_PX = 41;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /**
   * Pure window computation (unit-testable, no DOM).
   * Returns {start, end} item indexes (end exclusive) to render.
   */
  function computeWindow(total, scrollTop, viewportH, avgH, overscan) {
    if (total <= 0) return { start: 0, end: 0 };
    var h = avgH > 0 ? avgH : FALLBACK_ROW_PX;
    var ov = (overscan == null ? OVERSCAN_GROUPS : overscan) * h;
    var start = Math.floor(Math.max(0, scrollTop - ov) / h);
    var end = Math.ceil((scrollTop + viewportH + ov) / h);
    return { start: clamp(start, 0, total), end: clamp(end, 0, total) };
  }

  /**
   * Calibrate average row height from rendered rows.
   * rows: array-like of elements with offsetHeight. Falls back safely.
   */
  function calibrateAvg(rows, fallback) {
    var fb = fallback > 0 ? fallback : FALLBACK_ROW_PX;
    if (!rows || !rows.length) return fb;
    var sum = 0, n = 0;
    for (var i = 0; i < rows.length; i++) {
      var h = rows[i] && rows[i].offsetHeight;
      if (h > 0) { sum += h; n++; }
    }
    return n > 0 ? sum / n : fb;
  }

  /**
   * Attach a single passive scroll listener to container.
   * onWindow(start, end) is called only when the window actually changes.
   * Returns a detach function.
   */
  function attachWindowedScroll(container, getState, onWindow) {
    var ticking = false;
    var lastKey = "";
    function current() {
      var st = getState();
      var w = computeWindow(st.total, container.scrollTop,
        container.clientHeight || 600, st.avgH, st.overscan);
      return w;
    }
    function maybeFire() {
      ticking = false;
      var w = current();
      var key = w.start + ":" + w.end;
      if (key !== lastKey) {
        lastKey = key;
        onWindow(w.start, w.end);
      }
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(maybeFire);
      }
    }
    container.addEventListener("scroll", onScroll, { passive: true });
    return function detach() {
      container.removeEventListener("scroll", onScroll);
      lastKey = "";
    };
  }

  /**
   * Exact offset layout for variable-height groups.
   * rowCounts[i] = number of mounted child rows in group i (0 when collapsed).
   * Returns {offsets, totalH}. Pure (unit-testable).
   */
  function layoutOffsets(rowCounts, headerH, rowH, padPx) {
    var offsets = new Array(rowCounts.length);
    var top = 0;
    for (var i = 0; i < rowCounts.length; i++) {
      offsets[i] = top;
      top += headerH + (rowCounts[i] > 0 ? padPx + rowCounts[i] * rowH : 0);
    }
    return { offsets: offsets, totalH: top };
  }

  /**
   * Window over exact offsets. overscanPx in pixels.
   * Returns {start, end} (end exclusive).
   */
  function windowForOffsets(offsets, totalH, scrollTop, viewportH, overscanPx) {
    var n = offsets.length;
    if (!n) return { start: 0, end: 0 };
    var lo = Math.max(0, scrollTop - overscanPx);
    var hi = scrollTop + viewportH + overscanPx;
    var start = 0, end = n;
    for (var i = 0; i < n; i++) {
      if (offsets[i] <= lo) start = i;
      if (offsets[i] < hi) end = i + 1;
    }
    return { start: clamp(start, 0, n), end: clamp(end, 0, n) };
  }

  window.UQVirtualList = {
    THRESHOLD_GROUPS: THRESHOLD_GROUPS,
    OVERSCAN_GROUPS: OVERSCAN_GROUPS,
    OVERSCAN_PX: 300,
    computeWindow: computeWindow,
    calibrateAvg: calibrateAvg,
    layoutOffsets: layoutOffsets,
    windowForOffsets: windowForOffsets,
    attachWindowedScroll: attachWindowedScroll,
  };
})();
