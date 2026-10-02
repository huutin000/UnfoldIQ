"use strict";
/* UNFOLDIQ Flow Companion — progress stepper (POST-v1D §18).
 * Minimal steps only: prepare → await → create → done.
 */
(function () {
  const ORDER = ["prepare", "await", "create", "done"];

  function stepLabels(t) {
    return {
      prepare: (t && t.stepPrepare) || "Chuẩn bị",
      await: (t && t.stepAwait) || "Chờ duyệt",
      create: (t && t.stepCreate) || "Tạo",
      done: (t && t.stepDone) || "Hoàn tất",
    };
  }

  function renderStepper(activeKeys, t) {
    const keys = (activeKeys || []).filter((k) => ORDER.includes(k));
    if (keys.length === 0) return "";
    const labels = stepLabels(t);
    const lastIdx = keys.length - 1;
    const items = keys
      .map((k, i) => {
        const state = i < lastIdx ? "done" : "current";
        const label = labels[k] || k;
        return `<li data-state="${state}"${state === "current" ? ' aria-current="step"' : ""}><span class="pip" aria-hidden="true"></span><span>${label}</span></li>`;
      })
      .join("");
    return `<ol class="stepper" aria-label="Tiến trình">${items}</ol>`;
  }

  const api = { ORDER, stepLabels, renderStepper };
  if (typeof window !== "undefined") window.FlowStepper = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
