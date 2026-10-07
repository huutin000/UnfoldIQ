"use strict";
/* UNFOLDIQ Flow Companion — developer tools render helpers (POST-v1D §39).
 * Visible only inside Settings when Developer Mode is ON. Stacked rows +
 * internal scroll: never forces page-level horizontal scrolling.
 */
(function () {
  function esc(s) {
    if (typeof window !== "undefined" && window.FlowJobCard) return window.FlowJobCard.esc(s);
    return String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderDiagnosticsText(d) {
    if (!d) return "—";
    const gen = d.generateControlFound || {};
    const dl = d.downloadControlFound || {};
    const gt = d.generationType || {};
    // POST-v1E stall fix §12/§13: content-script status comes from the
    // canonical action-time resolver PING — never from a port map, and the
    // canonical ping wins over any supplementary presence signal.
    const cs = [];
    if (d.contentScriptStatus) {
      cs.push(
        `Content script: ${d.contentScriptStatus === "CONNECTED" ? "Đã kết nối" : d.contentScriptStatus === "NOT_CONNECTED" ? "Chưa kết nối" : d.contentScriptStatus}`
      );
      if (d.contentScriptTabId !== undefined && d.contentScriptTabId !== null) cs.push(`  tabId: ${d.contentScriptTabId}`);
      if (d.contentScriptOrigin) cs.push(`  Origin: ${d.contentScriptOrigin}`);
      if (d.contentScriptSource) cs.push(`  Nguồn: ${d.contentScriptSource}`);
      if (d.contentScriptLastPingAt) cs.push(`  Ping lần cuối: ${d.contentScriptLastPingAt}`);
    }
    return [
      ...(cs.length > 0 ? cs : ["Content script: —"]),
      "",
      `extensionVersion: ${d.extensionVersion || "unknown"}`,
      `adapterVersion: ${d.adapterVersion || "unknown"}`,
      `flowOrigin: ${d.flowOrigin || "unknown"}`,
      `contentScriptInjected: ${d.contentScriptInjected}`,
      `bridgeReachable: ${d.bridgeReachable}`,
      `currentJobId: ${d.currentJobId || "none"}`,
      `jobState: ${d.jobState || "none"}`,
      `promptControlFound: ${d.promptControlFound}`,
      `generateControlFound: ${gen.found} (enabled=${gen.enabled})`,
      `generationType: ${gt.type || "UNKNOWN"} (verified=${gt.verified === true})`,
      `modelLabel: ${d.modelLabel || "UNKNOWN"}`,
      `aspect: ${d.aspectSetting || "UNKNOWN"}`,
      `outputCount: ${d.outputCount === undefined ? "UNKNOWN" : d.outputCount}`,
      `creditCost: ${d.creditCost || "UNKNOWN"}`,
      `composer: ${d.composerProbe ? `anchor=${d.composerProbe.composerAnchorFound} root=${d.composerProbe.composerRootFound} editor=${d.composerProbe.promptEditableFound} (${d.composerProbe.promptEditableType || "n/a"}) writable=${d.composerProbe.promptWritable}` : "—"}`,
      `resultControlFound: ${d.resultControlFound}`,
      `downloadControlFound: ${dl.found}`,
      `agentMode: ${(d.agentMode && d.agentMode.mode) || "unknown"}`,
      `projectIdentity: ${renderProjectIdentity(d.projectIdentity)}`,
      `instructionSurface: ${renderInstructionSurface(d.instructionSurface)}`,
      `lastError: ${d.lastError || "none"}`,
    ].join("\n");
  }

  // FIX 02 §8 — one-line renders for the instruction live gate (paste-friendly).
  function renderProjectIdentity(pi) {
    if (!pi) return "UNKNOWN (no data)";
    if (!pi.available) return `UNKNOWN (confidence=${pi.confidence || "UNKNOWN"}, evidence=${pi.evidence || "n/a"})`;
    return `ref=${pi.providerProjectRef} (confidence=${pi.confidence}, source=${pi.source})`;
  }

  function renderInstructionSurface(surface) {
    if (!surface) return "no data";
    const short = (c) => (c && c.status) || "?";
    const ev = (c) => (c && c.selectorEvidence && (c.selectorEvidence.matchedSelector || "—")) || "—";
    return [
      `trigger=${short(surface.agentInstructionsTrigger)}`,
      `add=${short(surface.addInstructionControl)}`,
      `editor=${short(surface.instructionEditor)}`,
      `refAttach=${short(surface.referenceAttachmentControl)}`,
      `done=${short(surface.doneSaveControl)}`,
      `readback=${short(surface.readbackSurface)}`,
      `evidence=[${[surface.agentInstructionsTrigger, surface.addInstructionControl, surface.instructionEditor, surface.doneSaveControl, surface.readbackSurface].map(ev).join(" | ")}]`,
    ].join(" ");
  }

  function pillFor(status) {
    const cls = status === "PASS" ? "pass" : status === "FAIL" ? "fail" : "";
    return `<span class="pill ${cls}">${esc(status)}</span>`;
  }

  function renderSelectorList(selectorHealth) {
    if (!selectorHealth) return "";
    return Object.entries(selectorHealth)
      .map(
        ([control, h]) =>
          `<div class="selector-row"><span>${esc(control)} ${pillFor(h.status)}</span>` +
          `<span class="fb">${esc(h.fallbackUsed || "—")}</span></div>`
      )
      .join("");
  }

  /* §12: honest pending state while no canonical ping has happened yet —
   * never a stale "waiting" line once ping=true evidence exists. */
  function renderContentScriptPending(resolution) {
    if (resolution && resolution.ping) {
      return [
        "Content script: Đã kết nối",
        resolution.tabId !== undefined && resolution.tabId !== null ? `  tabId: ${resolution.tabId}` : null,
        resolution.origin ? `  Origin: ${resolution.origin}` : null,
        resolution.source ? `  Nguồn: ${resolution.source}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
    return "Content script: Chưa kết nối (đang chờ PING đầu tiên từ tab Flow)";
  }

  const api = { renderDiagnosticsText, renderContentScriptPending, renderSelectorList, pillFor };
  if (typeof window !== "undefined") window.FlowDevTools = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
