"use strict";

/**
 * Central UNFOLDIQ root-env bootstrap (PHASE 1G.1 Prompt 05 Fix 3).
 *
 * Loads the repo-root .env (if present) via Node native process.loadEnvFile().
 * The real shell environment always wins: loadEnvFile never overwrites an
 * existing process.env value (verified on Node 24). Values are never logged,
 * returned, or persisted — only the NAMES of newly loaded variables.
 *
 * Optional argument: explicit .env path (tests use an isolated temp file so
 * they never touch the operator's real .env).
 */

const fs = require("fs");
const path = require("path");

const ROOT_ENV_PATH = path.join(__dirname, "..", ".env");

function loadRootEnv(envPath = ROOT_ENV_PATH) {
  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: envPath, names: [] };
  }
  // Node's parser cannot strip a UTF-8 BOM: the first variable would silently
  // gain a U+FEFF prefix (e.g. "\uFEFFGOOGLE_API_KEY") and never match. Fail
  // loudly instead of missing credentials invisibly.
  if (fs.readFileSync(envPath).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    return { loaded: false, path: envPath, names: [], error: "root .env has a UTF-8 BOM; re-save it without BOM (first variable would otherwise be corrupted)" };
  }
  const before = new Set(Object.keys(process.env));
  try {
    process.loadEnvFile(envPath);
  } catch (e) {
    return { loaded: false, path: envPath, names: [], error: `malformed env file (${e.code || e.message})` };
  }
  return { loaded: true, path: envPath, names: Object.keys(process.env).filter((k) => !before.has(k)) };
}

module.exports = { ROOT_ENV_PATH, loadRootEnv };
