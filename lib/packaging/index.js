"use strict";

/** Phase 4A — Publish Packaging facade (UNFOLDIQ CORE). */
const profiles = require("./profiles.js");
const experimentLib = require("./experiment.js");
const claimsLib = require("./claims.js");
const packageLib = require("./package.js");

module.exports = {
  ...packageLib,
  profiles,
  experiment: experimentLib,
  claims: claimsLib,
  PROFILE_VERSION: profiles.PROFILE_VERSION,
  EXPERIMENT_VERSION: experimentLib.EXPERIMENT_VERSION,
};
