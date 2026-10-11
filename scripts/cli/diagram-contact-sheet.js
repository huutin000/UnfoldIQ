#!/usr/bin/env node
"use strict";

/**
 * Static contact sheet for DiagramScene specs: one still per spec (default at
 * 85% of its duration, i.e. mostly built) tiled into a single PNG, so scene
 * coverage is reviewed without rendering any motion.
 *
 * Usage: node scripts/cli/diagram-contact-sheet.js --out <sheet.png> [--cols 3] [--at 0.85] <spec.json>...
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { createRequire } = require("module");
const { validateSpec } = require("../../lib/diagram/index.js");

const ROOT = path.join(__dirname, "..", "..");
const REMOTION_DIR = path.join(ROOT, "remotion");

function parseArgs(argv) {
  const o = { cols: 3, at: 0.85, out: null, specs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") o.out = argv[++i];
    else if (argv[i] === "--cols") o.cols = Number(argv[++i]);
    else if (argv[i] === "--at") o.at = Number(argv[++i]);
    else o.specs.push(argv[i]);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.out || o.specs.length === 0 || !(o.at > 0 && o.at <= 1) || !(o.cols >= 1)) {
    console.error("usage: diagram-contact-sheet.js --out <sheet.png> [--cols N] [--at 0..1] <spec.json>...");
    process.exit(1);
  }
  const specs = o.specs.map((f) => ({ file: f, spec: JSON.parse(fs.readFileSync(f, "utf8")) }));
  for (const s of specs) {
    const v = validateSpec(s.spec);
    if (!v.ok) {
      console.error(`INVALID_SPEC ${s.file}: ${v.errors.join("; ")}`);
      process.exit(1);
    }
  }
  const remRequire = createRequire(path.join(REMOTION_DIR, "package.json"));
  const bundler = remRequire("@remotion/bundler");
  const renderer = remRequire("@remotion/renderer");
  const serveUrl = await bundler.bundle({ entryPoint: path.join(REMOTION_DIR, "src", "index.ts"), onProgress() {} });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-sheet-"));
  const frames = [];
  for (let i = 0; i < specs.length; i += 1) {
    const inputProps = { spec: specs[i].spec };
    const composition = await renderer.selectComposition({ serveUrl, id: "DiagramScene", inputProps });
    const frame = Math.min(composition.durationInFrames - 1, Math.floor(composition.durationInFrames * o.at));
    const output = path.join(tmp, `s${String(i).padStart(3, "0")}.png`);
    await renderer.renderStill({
      composition, serveUrl, inputProps, frame, output,
      ...(process.env.UNFOLDIQ_REMOTION_BINARIES_DIR ? { binariesDirectory: process.env.UNFOLDIQ_REMOTION_BINARIES_DIR } : {}),
    });
    frames.push(output);
    console.log(`still ${i + 1}/${specs.length}: ${specs[i].file} @frame ${frame}`);
  }
  const rows = Math.ceil(frames.length / o.cols);
  const args = ["-y", "-v", "error"];
  frames.forEach((f) => args.push("-i", f));
  const scaled = frames.map((_, i) => `[${i}:v]scale=640:-1[v${i}]`).join(";");
  const inputs = frames.map((_, i) => `[v${i}]`).join("");
  const layout = frames.map((_, i) => `${(i % o.cols) * 640}_${Math.floor(i / o.cols) * 360}`).join("|");
  const filter = frames.length === 1
    ? `${scaled}`
    : `${scaled};${inputs}xstack=inputs=${frames.length}:layout=${layout}:fill=black`;
  args.push("-filter_complex", filter, "-frames:v", "1", path.resolve(o.out));
  fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.status !== 0) {
    console.error("CONTACT_SHEET_FAILED: ffmpeg " + (r.stderr || r.error || "").toString().slice(0, 300));
    process.exit(2);
  }
  console.log(`CONTACT_SHEET_OK ${o.out} (${frames.length} stills, ${o.cols}x${rows})`);
}

main().catch((e) => {
  console.error("CONTACT_SHEET_FAILED: " + e.message);
  process.exit(2);
});
