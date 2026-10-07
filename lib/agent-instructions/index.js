"use strict";

/**
 * 1G.9 agent-instructions facade (PHASE 1G.9, Prompt 01, Stage A).
 * Deterministic core: compile → validate → persist → sync-record →
 * semantic-compare. Provider execution/readback belongs to the Flow
 * Companion adapter (separate workstream); this owner never touches the
 * browser, generates media, spends credits, or changes account settings.
 */

const shared = require("./shared.js");
const compilerLib = require("./compiler.js");
const compareLib = require("./compare.js");
const validatorLib = require("./validator.js");
const storeLib = require("./store.js");
const bindingLib = require("./binding.js");

module.exports = {
  INSTRUCTIONS_VERSION: shared.INSTRUCTIONS_VERSION,
  REFERENCE_ROLES: shared.REFERENCE_ROLES,
  SYNC_STATUSES: shared.SYNC_STATUSES,
  compileInstructionSet: compilerLib.compileInstructionSet,
  compareInstructionReadback: compareLib.compareInstructionReadback,
  validateInstructionSet: validatorLib.validateInstructionSet,
  validateSync: validatorLib.validateSync,
  persistInstructionSet: storeLib.persistInstructionSet,
  loadInstructionSet: storeLib.loadInstructionSet,
  loadLatestInstructionSet: storeLib.loadLatestInstructionSet,
  startInstructionSync: storeLib.startInstructionSync,
  recordSyncEvidence: storeLib.recordSyncEvidence,
  loadSync: storeLib.loadSync,
  latestVerifiedSync: storeLib.latestVerifiedSync,
  saveProjectBinding: bindingLib.saveProjectBinding,
  loadProjectBinding: bindingLib.loadProjectBinding,
  shared,
};
