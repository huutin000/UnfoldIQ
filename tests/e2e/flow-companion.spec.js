"use strict";

/**
 * UNFOLDIQ Flow Companion — real-browser E2E (Playwright).
 *
 * Deterministic + isolated: spawns its OWN bridge on an ephemeral loopback
 * port with a random TEST token (env override — never touches the persistent
 * token file), seeds a job via the normal authenticated API, and loads the
 * built extension into Playwright Chromium. No Google Flow page, no credits,
 * no destructive action — the Flow-tab prerequisite is satisfied because the
 * panel's FLOW_TABS resolution only requires A Flow-matching tab; the tests
 * verify the Bridge↔panel contract (auth, remember, offline, reconnect).
 */

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { test, expect, chromium } = require("@playwright/test");

const REPO = path.join(__dirname, "..", "..");
const EXT_DIR = path.join(REPO, "flow-companion", "extension", ".output", "chrome-mv3");
const PROJECT_ID = "E2E_flow_companion_panel";
const JOB_ID = "E2E-PANEL-01";

test.describe.configure({ mode: "serial" });

let bridge = null;
let bridgePort = 0;
let bridgeToken = "";

function bridgeRequest(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: "127.0.0.1", port: bridgePort, method, path: p, headers: { "Content-Type": "application/json", "x-bridge-token": bridgeToken } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }));
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function startBridge() {
  // bridgePort is chosen once and reused across restarts: the panel keeps the
  // saved bridge URL, so a restarted bridge must listen on the same port.
  if (!bridgePort) bridgePort = 20000 + Math.floor(Math.random() * 20000);
  if (!bridgeToken) bridgeToken = crypto.randomBytes(32).toString("hex");
  bridge = spawn(process.execPath, [path.join(REPO, "flow-companion", "bridge", "run.js"), "--port", String(bridgePort)], {
    env: { ...process.env, FLOW_BRIDGE_TOKEN: bridgeToken },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await bridgeRequest("GET", "/health");
      if (r.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("bridge did not become healthy");
}

function stopBridge() {
  if (bridge) {
    bridge.kill();
    bridge = null;
  }
}

async function seedJob() {
  const res = await bridgeRequest("POST", "/jobs", {
    projectId: PROJECT_ID,
    job: {
      projectId: PROJECT_ID,
      jobId: JOB_ID,
      requestId: "E2E-REQ-1",
      sceneId: "S01",
      capability: "image",
      mode: "ASSISTED_APPROVAL",
      prompt: "E2E deterministic test prompt",
      platform: "youtube",
      flowProject: { mode: "REUSE", displayName: "UNFOLDIQ — e2e" },
      outputRequirements: { aspectRatio: "16:9" },
      creativeContext: { contentModeSummary: "e2e" },
      expectedOutputPath: "assets/image/S01/S01_attempt-01.png",
      attempt: 1,
    },
  });
  if (res.status !== 201) throw new Error("job seed failed: " + JSON.stringify(res.json));
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_DIR, "manifest.json"))) {
    throw new Error("extension build missing — run npm run build in flow-companion/extension first");
  }
  // deterministic starting state: no leftover from a previous run
  fs.rmSync(path.join(REPO, "projects", PROJECT_ID), { recursive: true, force: true });
  await startBridge();
  await seedJob();
});

test.afterAll(async () => {
  stopBridge();
  fs.rmSync(path.join(REPO, "projects", PROJECT_ID), { recursive: true, force: true });
});

/**
 * One durable serial scenario covering the high-value deterministic panel flow:
 * token-required → paste once + remember → authenticated connect + persisted
 * → reload → auto-reconnect → offline error retains token → restart reconnects
 * → forget clears.
 */
test("bridge auth + remember-token lifecycle in the real extension panel", async ({}, testInfo) => {
  const userDataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pw-ext-")), "profile");
  // Default: new-Chromium headless (supports MV3 extensions). Headed stays
  // available via `npm run test:e2e:headed` (--headed flips project.use.headless).
  const useHeaded = testInfo.project.use.headless === false;
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: !useHeaded,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  try {
    // Real MV3 service-worker detection. The worker is event-driven and may be
    // dormant right after launch: if it has not appeared, resolve the extension
    // through chrome://extensions (proves the extension registered) and assert
    // the service worker wakes when the panel drives it (below).
    let extId = null;
    for (let i = 0; i < 20 && !extId; i++) {
      const sw = context.serviceWorkers().find((w) => w.url().includes("service-worker.js"));
      if (sw) extId = new URL(sw.url()).host;
      else await new Promise((r) => setTimeout(r, 250));
    }
    if (!extId) {
      const mgr = await context.newPage();
      await mgr.goto("chrome://extensions");
      extId = await mgr.evaluate(
        () =>
          new Promise((resolve) =>
            chrome.developerPrivate.getExtensionsInfo((info) => {
              const ext = info.find((e) => e.name === "UNFOLDIQ Flow Companion" && e.location === "UNPACKED");
              resolve(ext ? ext.id : null);
            })
          )
      );
    }
    expect(extId, "extension should be installed (service worker or registry)").toBeTruthy();

    // A Flow-matching tab is required by the panel pipeline (resolveFlow).
    // Served fully offline via route fulfillment — no real Google traffic,
    // no login, deterministic; the content script still injects on the
    // Flow origin exactly as in production.
    const flowTab = await context.newPage();
    await flowTab.route("**/*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>offline flow stub</title><body>e2e offline stub</body>" })
    );
    await flowTab.goto("https://flow.google.com/about");

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`);

    // The panel bootstrap drives the extension: the real MV3 service worker
    // must wake up and register (headless-safe service-worker detection).
    await expect
      .poll(() => context.serviceWorkers().some((w) => w.url().includes("service-worker.js")), { timeout: 30000 })
      .toBe(true);

    // 1. fresh profile: token-required state, no stored credential
    const card1 = panel.locator(".error-card");
    await expect(card1).toContainText("BRIDGE_TOKEN_REQUIRED", { timeout: 30000 });
    let stored = await panel.evaluate(() => chrome.storage.local.get(null));
    expect(stored.flowCompanionBridge?.bridgeToken ?? null).toBeNull();

    // 2. paste once + tick remember → token-input recovery auto-runs the pipeline
    // (config fields live in the Settings view — open it first)
    await panel.locator("#open-settings").click();
    await panel.locator("#bridge-url").fill(`http://127.0.0.1:${bridgePort}`);
    const jobIdField = panel.locator("#job-id");
    await jobIdField.fill(JOB_ID);
    const projectIdField = panel.locator("#project-id");
    await projectIdField.fill(PROJECT_ID);
    await panel.locator("#bridge-token").fill(bridgeToken);
    await panel.locator("#remember-token").check();

    await expect(panel.locator("#log")).toContainText(`job fetched: ${JOB_ID}`, { timeout: 60000 });
    await expect(card1).toHaveCount(0);

    // 3. token persisted ONLY after authenticated success, with schema
    stored = await panel.evaluate(() => chrome.storage.local.get(null));
    expect(stored.flowCompanionBridge.rememberToken).toBe(true);
    expect(stored.flowCompanionBridge.bridgeToken).toBe(bridgeToken);
    expect(stored.flowCompanionBridge.schemaVersion).toBe(1);

    // 4. the raw token never leaks into the developer log (the field keeps the
    // typed value for the session — only REMEMBERED tokens are never rendered)
    expect(await panel.locator("#log").textContent()).not.toContain(bridgeToken);

    // 5. reload → remembered token auto-reconnects, no paste
    await panel.reload();
    await expect(panel.locator("#log")).toContainText(`job fetched: ${JOB_ID}`, { timeout: 60000 });
    await expect(panel.locator("#bridge-token")).toHaveValue("");
    await expect(panel.locator("#remember-token")).toBeChecked();
    await expect(panel.locator("#bridge-token")).toHaveAttribute("placeholder", /đã nhớ trên thiết bị này/);

    // 6. bridge offline → dedicated BRIDGE_UNREACHABLE error, token retained
    stopBridge();
    await panel.locator("#primary-action").click();
    const card2 = panel.locator(".error-card");
    await expect(card2).toContainText("BRIDGE_UNREACHABLE", { timeout: 60000 });
    stored = await panel.evaluate(() => chrome.storage.local.get(null));
    expect(stored.flowCompanionBridge.rememberToken).toBe(true);
    expect(stored.flowCompanionBridge.bridgeToken).toBe(bridgeToken);

    // 7. bridge back → retry reconnects with the remembered token
    await startBridge();
    await panel.locator("#primary-action").click();
    await expect(card2).toHaveCount(0, { timeout: 60000 });
    await expect(panel.locator("#log")).toContainText(`job fetched: ${JOB_ID}`, { timeout: 60000 });

    // 8. forget → token + flag removed, non-secret config kept, token-entry state
    await panel.locator("#open-settings").click();
    await panel.locator("#forget-token").click();
    await expect(panel.locator("#remember-token")).not.toBeChecked();
    stored = await panel.evaluate(() => chrome.storage.local.get(null));
    expect(stored.flowCompanionBridge.rememberToken).toBe(false);
    expect(stored.flowCompanionBridge.bridgeToken ?? null).toBeNull();
    expect(stored.flowCompanionBridge.bridgeUrl).toContain("127.0.0.1");
  } finally {
    await context.close();
  }
});
