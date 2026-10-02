"use strict";
/* UNFOLDIQ Flow Companion — job card component (POST-v1D).
 * Answers: what is created, prompt, cost, key settings. Technical packet
 * lives under "Xem chi tiết" (progressive disclosure).
 */
(function () {
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function typeLabel(job, t) {
    const cap = String((job && job.capability) || "image").toLowerCase();
    return cap === "video" ? t.createVideo || "Tạo video" : t.createImage || "Tạo ảnh";
  }

  function metaItems(job, diag) {
    const model = (diag && diag.modelLabel) || "UNKNOWN";
    const aspect = (diag && diag.aspectSetting) || ((job && job.outputRequirements && job.outputRequirements.aspectRatio) || "UNKNOWN");
    const outputs = diag && diag.outputCount !== undefined && diag.outputCount !== null
      ? diag.outputCount
      : ((job && job.outputRequirements && job.outputRequirements.outputCount) || 1);
    const cost = (diag && diag.creditCost) || "UNKNOWN";
    return { model, aspect, outputs, cost };
  }

  function renderJobCard(job, diag, t, snapshot) {
    if (!job) return `<div class="empty-note">${esc(t.emptyJob || "Chưa có công việc nào.")}</div>`;
    const m = metaItems(job, diag);
    const costText = m.cost === "UNKNOWN" ? "Chi phí: chưa rõ" : `${esc(m.cost)} ${esc(t.costLabel || "credit")}`;
    // POST-v1E §22: frozen approval snapshot timestamp proves which packet
    // the user approves. Optional — omitted when no snapshot is frozen.
    const snapRow = snapshot && snapshot.timestamp
      ? `<dt>Chốt phê duyệt</dt><dd>${esc(snapshot.timestamp)}</dd>`
      : "";
    return (
      `<div class="job-type">${esc(typeLabel(job, t))}</div>` +
      `<p class="prompt-preview" data-prompt>${esc(job.prompt || "")}</p>` +
      `<button type="button" class="link-btn" data-action="toggle-prompt" aria-expanded="false">${esc(t.viewFull || "Xem đầy đủ")}</button>` +
      `<div class="meta-row"><span><strong>${esc(m.model)}</strong></span><span>·</span>` +
      `<span>${esc(m.aspect)}</span><span>·</span><span>${esc(m.outputs)} ảnh</span><span>·</span>` +
      `<span>${costText}</span></div>` +
      `<details class="tech-details"><summary>${esc(t.viewDetails || "Xem chi tiết")}</summary>` +
      `<dl><dt>Job ID</dt><dd>${esc(job.jobId || "")}</dd>` +
      `<dt>Project</dt><dd>${esc(job.projectId || "")}</dd>` +
      `<dt>Model</dt><dd>${esc(m.model)}</dd>` +
      `<dt>Trạng thái</dt><dd>${esc(job.status || "")}</dd>` +
      snapRow +
      `<dt>Đường dẫn đích</dt><dd>projects/${esc(job.projectId || "")}/assets/${esc(job.jobId || "")}.&lt;ext&gt;</dd></dl></details>`
    );
  }

  /* POST-v1E.1 P2: never render an object as "[object Object]" — errors from
   * any layer (Error, plain rejection object, string) become concise text. */
  function errorText(x) {
    if (x === null || x === undefined || x === "") return "UNKNOWN";
    if (typeof x === "string") return x;
    if (x instanceof Error) return String(x.message || x.name || "UNKNOWN");
    if (typeof x === "object") {
      const c = x.code || x.error || x.message;
      if (typeof c === "string" && c) return c;
      try {
        return JSON.stringify(x);
      } catch (e) {
        return "UNKNOWN";
      }
    }
    return String(x);
  }

  const api = { esc, errorText, typeLabel, metaItems, renderJobCard };
  if (typeof window !== "undefined") window.FlowJobCard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
