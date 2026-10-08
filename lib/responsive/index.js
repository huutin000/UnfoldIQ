"use strict";

/** Phase 3C — Responsive Timeline facade (UNFOLDIQ CORE). */
const profiles = require("./profiles.js");
const variantLib = require("./variant.js");

module.exports = { ...variantLib, profiles, PROFILE_VERSION: profiles.PROFILE_VERSION };
