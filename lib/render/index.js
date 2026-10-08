"use strict";

/** Phase 4B — Renderer Integration + Final QA facade (UNFOLDIQ CORE). */
const exportProfile = require("./export-profile.js");
const mappingRegistry = require("./mapping-registry.js");
const renderJob = require("./render-job.js");
const probe = require("./probe.js");
const qc = require("./qc.js");
const semantic = require("./semantic.js");
const content = require("./content.js");
const revalidate = require("./revalidate.js");
const e2e = require("./e2e.js");
const delivery = require("./delivery.js");

module.exports = {
  exportProfile, mapping: mappingRegistry, job: renderJob, probe, qc, semantic, content, revalidate, e2e, delivery,
  EXPORT_PROFILE_VERSION: exportProfile.PROFILE_VERSION,
  MAPPING_VERSION: mappingRegistry.REGISTRY_VERSION,
  JOB_VERSION: renderJob.JOB_VERSION,
  QC_VERSION: qc.QC_VERSION,
};
