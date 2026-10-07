"use strict";

/**
 * Phase 1G.10 — asset-library facade (Stage B).
 * Registry (records, dedup, lineage, locks, selection, rights, instruction
 * linkage) + indexer (real existing-asset migration). No generation, no
 * network, no credentials — hashes/paths/metadata only.
 */

const registryLib = require("./registry.js");
const indexerLib = require("./indexer.js");

module.exports = {
  INDEX_REL: registryLib.INDEX_REL,
  ASSET_TYPES: registryLib.ASSET_TYPES,
  ASSET_ROLES: registryLib.ASSET_ROLES,
  ASSET_SOURCES: registryLib.ASSET_SOURCES,
  QUALITY_STATUSES: registryLib.QUALITY_STATUSES,
  SELECTION_STATUSES: registryLib.SELECTION_STATUSES,
  RIGHTS_STATUSES: registryLib.RIGHTS_STATUSES,
  sha256Hex: registryLib.sha256Hex,
  assetIdFor: registryLib.assetIdFor,
  buildAssetRecord: registryLib.buildAssetRecord,
  registerAsset: registryLib.registerAsset,
  getAsset: registryLib.getAsset,
  listAssets: registryLib.listAssets,
  lockAsset: registryLib.lockAsset,
  unlockAsset: registryLib.unlockAsset,
  setSelection: registryLib.setSelection,
  setQualityStatus: registryLib.setQualityStatus,
  setRights: registryLib.setRights,
  linkInstruction: registryLib.linkInstruction,
  addLineage: registryLib.addLineage,
  lineageChain: registryLib.lineageChain,
  validateCanonicalSource: registryLib.validateCanonicalSource,
  indexDirectory: indexerLib.indexDirectory,
  MEDIA_EXTS: indexerLib.MEDIA_EXTS,
};
