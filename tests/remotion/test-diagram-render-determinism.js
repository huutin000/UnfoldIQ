"use strict";

/**
 * DiagramScene deterministic rendering + backward-compat smoke for the
 * compositions that existed before it (blank, SkyDiagram). Real Remotion
 * stills, no mocks. Timeout budget ~120 s.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");

const REPO = path.join(__dirname, "..", "..");
const REM = path.join(REPO, "remotion");
const req = createRequire(path.join(REM, "package.json"));
const spec = JSON.parse(fs.readFileSync(path.join(REPO, "tests", "fixtures", "diagram", "trilateration-2d.json"), "utf8"));

let passed = 0;
let failed = 0;
function assert(c, m) {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  console.log("  ok  " + m);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " - " + e.message); }
}

(async () => {
  const bundler = req("@remotion/bundler");
  const r = req("@remotion/renderer");
  const serveUrl = await bundler.bundle({ entryPoint: path.join(REM, "src", "index.ts"), onProgress() {} });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-det-"));
  const bin = process.env.UNFOLDIQ_REMOTION_BINARIES_DIR ? { binariesDirectory: process.env.UNFOLDIQ_REMOTION_BINARIES_DIR } : {};
  async function still(id, inputProps, frame, name) {
    const composition = await r.selectComposition({ serveUrl, id, inputProps });
    const output = path.join(tmp, name + ".png");
    await r.renderStill({ composition, serveUrl, inputProps, frame, output, ...bin });
    return crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
  }

  await runTest("DiagramScene renders the same pixels twice (deterministic)", async () => {
    const a = await still("DiagramScene", { spec }, 200, "d1");
    const b = await still("DiagramScene", { spec }, 200, "d2");
    assert(a === b, "identical frame hash");
    const early = await still("DiagramScene", { spec }, 10, "d3");
    assert(early !== a, "different time gives a different frame (animation is live)");
  });

  await runTest("DiagramScene duration follows spec.durationSec", async () => {
    const c = await r.selectComposition({ serveUrl, id: "DiagramScene", inputProps: { spec } });
    assert(c.durationInFrames === Math.ceil(spec.durationSec * 30) && c.fps === 30, "frames = ceil(durationSec*30)");
  });

  await runTest("pre-existing compositions still render (SkyDiagram, blank)", async () => {
    const sky1 = await still("SkyDiagram", { sceneId: "S03", frames: 300 }, 100, "s1");
    const sky2 = await still("SkyDiagram", { sceneId: "S03", frames: 300 }, 100, "s2");
    assert(sky1 === sky2, "SkyDiagram deterministic and unaffected");
    const blank = await still("blank", {}, 0, "b1");
    assert(typeof blank === "string" && blank.length === 64, "blank renders");
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n=== diagram-determinism: ${failed} failed, ${passed} passed ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error("FATAL " + e.message); process.exit(1); });
