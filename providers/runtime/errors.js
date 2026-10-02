"use strict";

/**
 * UNFOLDIQ provider runtime errors (STEP 10A).
 *
 * errorClass controls resolver behavior:
 * - transient   → bounded retry allowed, then next provider
 * - permanent   → no retry, try next provider (regenerate)
 * - policy      → BLOCKED, never bypassed by fallback
 * - unavailable → try next provider
 */

const ERROR_CLASSES = ["transient", "permanent", "policy", "unavailable"];

class ProviderError extends Error {
  constructor(errorCode, message, errorClass = "permanent") {
    super(message);
    this.name = "ProviderError";
    this.errorCode = errorCode;
    this.errorClass = ERROR_CLASSES.includes(errorClass) ? errorClass : "permanent";
  }

  get retryable() {
    return this.errorClass === "transient";
  }
}

function transient(errorCode, message) {
  return new ProviderError(errorCode, message, "transient");
}

function permanent(errorCode, message) {
  return new ProviderError(errorCode, message, "permanent");
}

function policyBlocked(errorCode, message) {
  return new ProviderError(errorCode, message, "policy");
}

function unavailable(errorCode, message) {
  return new ProviderError(errorCode, message, "unavailable");
}

module.exports = {
  ProviderError,
  ERROR_CLASSES,
  transient,
  permanent,
  policyBlocked,
  unavailable,
};
