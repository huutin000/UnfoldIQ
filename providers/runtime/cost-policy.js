"use strict";

/**
 * UNFOLDIQ provider cost policy (STEP 10A).
 *
 * Cost classes: ZERO_LOCAL | INCLUDED_SUBSCRIPTION | FREE_TIER | PAID | UNKNOWN
 * ZERO_LOCAL means no per-request provider charge (not zero electricity/hardware/time).
 *
 * Project default (providers/CONFIG.yaml):
 *   costPolicy:
 *     preferZeroMarginalCost: true
 *     allowPaidCloud: false
 * Paid providers are never auto-called without explicit enable.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const COST_RANK = {
  ZERO_LOCAL: 0,
  INCLUDED_SUBSCRIPTION: 1,
  FREE_TIER: 2,
  UNKNOWN: 3,
  PAID: 4,
};

function loadCostPolicy(projectRoot) {
  const root = projectRoot || path.join(__dirname, "..", "..");
  try {
    const raw = fs.readFileSync(path.join(root, "providers", "CONFIG.yaml"), "utf8");
    const cfg = yaml.load(raw) || {};
    return {
      preferZeroMarginalCost: cfg.costPolicy?.preferZeroMarginalCost !== false,
      allowPaidCloud: cfg.costPolicy?.allowPaidCloud === true,
    };
  } catch {
    return { preferZeroMarginalCost: true, allowPaidCloud: false };
  }
}

/**
 * isProviderAllowed(providerMeta, { allowPaidCloud }) → { allowed, reason }
 * providerMeta.costClass drives the decision. Request-level
 * costConstraints.allowPaidCloud===true explicitly enables paid for that request.
 */
function isProviderAllowed(providerMeta, opts = {}) {
  const costClass = providerMeta?.costClass || "UNKNOWN";
  const allowPaid = opts.allowPaidCloud === true;
  if (costClass === "PAID" && !allowPaid) {
    return { allowed: false, reason: "PAID provider disabled by cost policy (allowPaidCloud=false)" };
  }
  return { allowed: true, reason: `costClass ${costClass} allowed` };
}

function compareCost(a, b) {
  return (COST_RANK[a] ?? 3) - (COST_RANK[b] ?? 3);
}

module.exports = {
  COST_RANK,
  loadCostPolicy,
  isProviderAllowed,
  compareCost,
};
