"use strict";

/**
 * UNFOLDIQ Contradictions + Unknowns (1G.1K, Prompt 03).
 *
 * Contradictions persist as structured records (never silently dropped);
 * resolution needs a reason plus citing evidence — the more dramatic claim is
 * never auto-preferred. Unknowns survive into sufficiency evaluation.
 */

const crypto = require("crypto");

const CONTRADICTION_STATUS = ["OPEN", "FRAMED_AS_DISPUTED", "RESOLVED_WITH_REASON", "BLOCKING"];
const UNKNOWN_STATUS = ["OPEN", "ANSWERED", "ACCEPTED"];
const UNKNOWN_MATERIALITY = ["critical", "material", "non-material"];

function contradictionIdFor(claimIds) {
  const seed = [...claimIds].sort().join("|");
  return `ctr-${crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 12)}`;
}

function unknownIdFor(description, questionId) {
  const seed = `${questionId || ""}|${description.trim().toLowerCase()}`;
  return `unk-${crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 12)}`;
}

function recordContradiction(store, input = {}) {
  const claimIds = Array.isArray(input.claimIds) ? input.claimIds.filter((c) => typeof c === "string") : [];
  const sourceIds = Array.isArray(input.sourceIds) ? input.sourceIds.filter((s) => typeof s === "string") : [];
  if (claimIds.length < 2) {
    return { ok: false, code: "CONTRADICTION_INVALID", message: "a contradiction needs at least 2 claimIds" };
  }
  if (sourceIds.length < 1) {
    return { ok: false, code: "CONTRADICTION_INVALID", message: "a contradiction needs at least 1 sourceId" };
  }
  if (typeof input.description !== "string" || !input.description.trim()) {
    return { ok: false, code: "CONTRADICTION_INVALID", message: "description is required" };
  }
  const materiality = input.materiality === "non-critical" ? "non-critical" : "critical";
  const id = contradictionIdFor(claimIds);
  let record = (store.contradictions || []).find((c) => c.contradictionId === id);
  if (!record) {
    record = {
      contradictionId: id,
      claimIds: [...claimIds].sort(),
      sourceIds: [...new Set(sourceIds)],
      description: input.description.trim(),
      materiality,
      status: input.status === "BLOCKING" ? "BLOCKING" : "OPEN",
      resolution: null,
      createdAt: new Date().toISOString(),
    };
    store.contradictions.push(record);
    return { ok: true, record, created: true };
  }
  return { ok: true, record, created: false, deduplicated: true };
}

/**
 * Resolve only with a reason AND citing evidence. The resolver must name the
 * prevailing claim and the evidence behind it; "more dramatic" is not a
 * reason the gate accepts on its own.
 */
function resolveContradiction(store, contradictionId, resolution = {}) {
  const record = (store.contradictions || []).find((c) => c.contradictionId === contradictionId);
  if (!record) {
    return { ok: false, code: "CONTRADICTION_INVALID", message: `unknown contradiction ${contradictionId}` };
  }
  if (record.status === "BLOCKING" && resolution.humanOverride !== true) {
    return { ok: false, code: "CONTRADICTION_BLOCKING", message: "BLOCKING contradiction needs explicit human override to resolve" };
  }
  const reason = typeof resolution.reason === "string" ? resolution.reason.trim() : "";
  if (reason.length < 20) {
    return { ok: false, code: "CONTRADICTION_INVALID", message: "resolution needs a reason (>= 20 chars) with citing evidence" };
  }
  if (!resolution.prevailingClaimId || !resolution.evidenceNote) {
    return { ok: false, code: "CONTRADICTION_INVALID", message: "resolution must name prevailingClaimId + evidenceNote" };
  }
  if (!record.claimIds.includes(resolution.prevailingClaimId)) {
    return { ok: false, code: "CONTRADICTION_INVALID", message: "prevailingClaimId is not part of this contradiction" };
  }
  record.status = "RESOLVED_WITH_REASON";
  record.resolution = `${reason} Prevailing: ${resolution.prevailingClaimId}. Evidence: ${resolution.evidenceNote}`;
  return { ok: true, record };
}

function frameAsDisputed(store, contradictionId) {
  const record = (store.contradictions || []).find((c) => c.contradictionId === contradictionId);
  if (!record) {
    return { ok: false, code: "CONTRADICTION_INVALID", message: `unknown contradiction ${contradictionId}` };
  }
  record.status = "FRAMED_AS_DISPUTED";
  return { ok: true, record };
}

function recordUnknown(store, input = {}) {
  if (typeof input.description !== "string" || !input.description.trim()) {
    return { ok: false, code: "UNKNOWN_INVALID", message: "description is required" };
  }
  const materiality = UNKNOWN_MATERIALITY.includes(input.materiality) ? input.materiality : "material";
  const id = unknownIdFor(input.description, input.researchQuestionId);
  let record = (store.unknowns || []).find((u) => u.unknownId === id);
  if (!record) {
    record = {
      unknownId: id,
      researchQuestionId: input.researchQuestionId || null,
      description: input.description.trim(),
      materiality,
      whyUnknown: input.whyUnknown || "",
      recommendedAction: input.recommendedAction || "",
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    store.unknowns.push(record);
    return { ok: true, record, created: true };
  }
  return { ok: true, record, created: false, deduplicated: true };
}

function settleUnknown(store, unknownId, status) {
  const record = (store.unknowns || []).find((u) => u.unknownId === unknownId);
  if (!record) {
    return { ok: false, code: "UNKNOWN_INVALID", message: `unknown ${unknownId}` };
  }
  if (!["ANSWERED", "ACCEPTED"].includes(status)) {
    return { ok: false, code: "UNKNOWN_INVALID", message: "settle status must be ANSWERED | ACCEPTED" };
  }
  record.status = status;
  return { ok: true, record };
}

module.exports = {
  CONTRADICTION_STATUS,
  UNKNOWN_STATUS,
  UNKNOWN_MATERIALITY,
  contradictionIdFor,
  unknownIdFor,
  recordContradiction,
  resolveContradiction,
  frameAsDisputed,
  recordUnknown,
  settleUnknown,
};
