"use strict";

/**
 * Phase 1G.12 — real-e2e facade. Consumes 1G.5/1G.6/1G.8/1G.10/1G.11 and the
 * Flow Companion bridge; creates no parallel owners. No generation here —
 * paid provider actions happen only through the operator live path.
 */

const repairScope = require("./repair-scope.js");
const caseResult = require("./case-result.js");
const correlation = require("./correlation.js");

module.exports = {
  scopeRetry: repairScope.scopeRetry,
  authorizeScopedRetry: repairScope.authorizeScopedRetry,
  failureClassFor: repairScope.failureClassFor,
  buildCaseResult: caseResult.buildCaseResult,
  evaluateMatrix: caseResult.evaluateMatrix,
  checkCorrelationForReady: correlation.checkCorrelationForReady,
  CORRELATION_METHODS: correlation.KNOWN_METHODS,
  CASE_IDS: caseResult.CASE_IDS,
  MATRIX_IDS: caseResult.MATRIX_IDS,
  MATRIX_SIZES: caseResult.MATRIX_SIZES,
};
