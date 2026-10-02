"use strict";

/**
 * Playwright E2E config (UNFOLDIQ browser testing stack).
 * - workers=1 / retries=0: no concurrency side effects, no flakiness masking
 * - evidence retained only on failure, under Report/evidence/playwright/
 */

const path = require("path");

module.exports = {
  testDir: path.join(__dirname, "tests", "e2e"),
  timeout: 120000,
  workers: 1,
  retries: 0,
  fullyParallel: false,
  use: {
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: path.join(__dirname, "Report", "evidence", "playwright", "artifacts"),
  reporter: [
    ["list"],
    ["html", { open: "never", outputDir: path.join(__dirname, "Report", "evidence", "playwright", "html") }],
  ],
};
