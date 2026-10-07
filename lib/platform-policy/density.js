"use strict";

/**
 * 1G.7 shot-density + pacing guidance (PHASE 1G.7, Prompt 01, §§16–17).
 * Contextual tiers (LOW/MEDIUM/HIGH) from explicit inputs — platform,
 * content class, narrative role, visual modality, importance, target
 * duration band. No pseudo-universal cut rules, no timestamps, no final
 * audio authority (FINAL AUDIO → FORCED ALIGNMENT → MASTER TIMELINE later).
 */

const shared = require("./shared.js");

function densityTier(input = {}) {
  const reasons = [];
  const platform = input.platformId || null;
  const role = input.narrativeRole || null;
  const modality = input.visualModality || null;
  const importance = input.importance || null;
  let tier = "MEDIUM";
  if (platform === "YOUTUBE_LONG") {
    tier = "LOW";
    reasons.push("density LOW: long-form explanatory holding is the platform default");
  } else if (platform === "YOUTUBE_SHORTS" || platform === "TIKTOK") {
    tier = "MEDIUM";
    reasons.push("density MEDIUM: short-form default without invented per-second cut rules");
  } else {
    reasons.push("density MEDIUM: platform unspecified, neutral default");
  }
  if (role === "hook" || importance === "HIGH") {
    tier = tier === "LOW" ? "MEDIUM" : "HIGH";
    reasons.push(`density raised for ${role === "hook" ? "hook" : "high-importance"} beat`);
  }
  if (["TIMELINE", "CHART", "DIAGRAM"].includes(modality) && tier === "HIGH") {
    tier = "MEDIUM";
    reasons.push(`density capped at MEDIUM: ${modality} needs reading room`);
  }
  return { tier, reasons };
}

function pacingGuidance(input = {}) {
  const reasons = [];
  const platform = input.platformId || null;
  const guidance = {
    hookUrgency: platform === "YOUTUBE_LONG" ? "MEDIUM" : "HIGH",
    visualChangeFrequency: platform === "YOUTUBE_LONG" ? "LOW" : "MEDIUM",
    restAllowance: platform === "YOUTUBE_LONG" ? "HIGH" : "LOW",
    informationDensity: "MEDIUM",
    transitionRestraint: platform === "YOUTUBE_LONG" ? "HIGH" : "MEDIUM",
    shortFormUrgency: platform === "YOUTUBE_LONG" ? "LOW" : "HIGH",
    longFormBreathingRoom: platform === "YOUTUBE_LONG" ? "HIGH" : "LOW",
  };
  reasons.push(`pacing from platform ${platform || "unspecified"} policy (guidance only, no timestamps)`);
  if ((input.targetDurationBand || "").toLowerCase().includes("short")) {
    guidance.shortFormUrgency = "HIGH";
    reasons.push("short target duration band raises urgency guidance");
  }
  return { guidance, reasons };
}

module.exports = { densityTier, pacingGuidance };
