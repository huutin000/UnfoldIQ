"use strict";

/**
 * Phase 3A — Master Timeline facade (UNFOLDIQ CORE).
 */

const timebase = require("./timebase.js");
const mediaConform = require("./media-conform.js");
const colorPolicyLib = require("./color-policy.js");
const masterTimeline = require("./master-timeline.js");

module.exports = {
  ...masterTimeline,
  timebase,
  mediaConform,
  colorPolicy: colorPolicyLib,
};
