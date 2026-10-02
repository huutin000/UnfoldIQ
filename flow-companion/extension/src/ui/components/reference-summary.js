"use strict";
/* UNFOLDIQ Flow Companion — reference summary (POST-v1D §17).
 * Conditional + compact: hidden when the job needs no references.
 * "Thay đổi" navigates to the reference editor in Settings.
 */
(function () {
  function esc(s) {
    if (typeof window !== "undefined" && window.FlowJobCard) return window.FlowJobCard.esc(s);
    return String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function hasReference(ref) {
    if (!ref) return false;
    const d = ref.referenceDescription || {};
    return Boolean(
      (ref.referenceAsset && (ref.referenceAsset.path || ref.referenceAsset.id)) ||
        d.semanticRole ||
        (d.identityTraits && d.identityTraits.length) ||
        (d.continuityConstraints && d.continuityConstraints.length) ||
        (d.allowedVariation && d.allowedVariation.length)
    );
  }

  function renderReferenceSummary(ref, t) {
    if (!hasReference(ref)) return "";
    const d = ref.referenceDescription || {};
    const title = (ref.referenceAsset && (ref.referenceAsset.path || ref.referenceAsset.id)) || d.semanticRole || "";
    const keep = [...(d.identityTraits || []), ...(d.continuityConstraints || [])].slice(0, 4);
    const allowed = (d.allowedVariation || []).slice(0, 3);
    return (
      `<section class="card ref-summary" aria-label="${esc((t && t.refTitle) || "Ảnh tham chiếu")}">` +
      `<div class="card-title">${esc((t && t.refTitle) || "Ảnh tham chiếu")}</div>` +
      (title ? `<div><strong>${esc(title)}</strong></div>` : "") +
      (keep.length ? `<div>${esc((t && t.refKeep) || "Giữ")}: ${esc(keep.join(" · "))}</div>` : "") +
      (allowed.length ? `<div>${esc((t && t.refAllowed) || "Cho phép thay đổi")}: ${esc(allowed.join(" · "))}</div>` : "") +
      `<button type="button" class="link-btn" data-action="edit-reference">${esc((t && t.refChange) || "Thay đổi")}</button></section>`
    );
  }

  const api = { hasReference, renderReferenceSummary };
  if (typeof window !== "undefined") window.FlowReference = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
