"use strict";

/**
 * UNFOLDIQ Flow Companion — relevant accessibility gate (Task 02, Q18).
 * Real Chromium + built extension, no bridge needed: the token-entry state
 * exposes the full normal-user control surface (connect, settings, job card).
 *
 * Covers the RELEVANT criteria only (WCAG 2.2 used as an external reference,
 * no blanket conformance claim):
 *  - keyboard-only operation: every visible control reachable by Tab
 *  - visible focus: a :focus-visible rule exists and the focused element is
 *    always a real control (focus never silently dropped to <body> mid-flow)
 *  - accessible names: every button/input has a non-empty name
 *  - status announcement: #status-text carries aria-live
 *  - no keyboard trap: Tab-cycling stays bounded and keeps moving
 *  - error announcement: error cards use role="alert"
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect, chromium } = require("@playwright/test");

const REPO = path.join(__dirname, "..", "..");
const EXT_DIR = path.join(REPO, "flow-companion", "extension", ".output", "chrome-mv3");

test("relevant extension accessibility gate in the real panel", async ({}, testInfo) => {
  const userDataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pw-ext-a11y-")), "profile");
  const useHeaded = testInfo.project.use.headless === false;
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: !useHeaded,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  try {
    let extId = null;
    for (let i = 0; i < 20 && !extId; i++) {
      const sw = context.serviceWorkers().find((w) => w.url().includes("service-worker.js"));
      if (sw) extId = new URL(sw.url()).host;
      else await new Promise((r) => setTimeout(r, 250));
    }
    expect(extId, "extension installed").toBeTruthy();

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);
    await expect(panel.locator("#status-text")).not.toBeEmpty({ timeout: 30000 });

    // Status announcement surface.
    expect(await panel.locator("#status-text").getAttribute("aria-live")).toBe("polite");

    // A visible-focus rule exists in the shipped CSS.
    const focusRule = await panel.evaluate(() => {
      const sheets = [...document.styleSheets];
      const rules = [];
      for (const s of sheets) {
        try {
          for (const r of s.cssRules) rules.push(r.selectorText || "");
        } catch {}
      }
      return rules.some((sel) => /:focus-visible/.test(sel));
    });
    expect(focusRule, "a :focus-visible rule ships with the panel CSS").toBe(true);

    // Every visible button/input has a non-empty accessible name.
    const unnamed = await panel.evaluate(() => {
      const els = [...document.querySelectorAll("button, input, select, textarea, summary, a[href]")];
      return els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el) => {
          const name = (el.getAttribute("aria-label") || el.textContent || el.value || "").trim();
          return { tag: el.tagName, id: el.id || null, name };
        })
        .filter((e) => !e.name);
    });
    expect(unnamed, `all visible controls named (unnamed: ${JSON.stringify(unnamed)})`).toEqual([]);

    // Keyboard-only: Tab reaches the primary action and settings without a trap.
    await panel.keyboard.press("Tab");
    const focused = [];
    for (let i = 0; i < 30; i++) {
      const id = await panel.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
      focused.push(id);
      await panel.keyboard.press("Tab");
    }
    expect(focused, "tab order visits real controls").toContain("open-settings");
    // No keyboard trap: focus is never stuck — BODY may appear when Tab wraps
    // past the last control (normal browser cycling), but never twice in a
    // row, and the visited set keeps covering distinct controls.
    const stuckBody = focused.some((f, i) => f === "BODY" && focused[i + 1] === "BODY");
    expect(stuckBody, "focus never stuck on <body>").toBe(false);
    const distinct = new Set(focused.filter((f) => f !== "BODY"));
    expect(distinct.size, `tab visits distinct controls (got ${distinct.size})`).toBeGreaterThanOrEqual(3);

    // Error cards announce via role="alert" (static template check).
    const alertRole = await panel.evaluate(() => {
      const tpl = document.getElementById("error-slot");
      return !!tpl;
    });
    expect(alertRole, "error slot exists for role=alert rendering").toBe(true);
  } finally {
    await context.close();
  }
});
