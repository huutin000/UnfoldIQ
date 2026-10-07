#!/usr/bin/env node
"use strict";

/**
 * POST-1H FIX 01 — bounded physical migration executor with journaling.
 *
 * Usage:
 *   node scripts/maintenance/post1h-migrate.js --map <migration-map.json> [--journal <journal.jsonl>] [--rollback]
 *
 * Map entry: { itemId, action: "mkdir"|"move", from?, to, reason }.
 * Journal event: { migrationId, itemId, from, to, action, state, timestamp,
 *   contentHash?, reason, validationResult?, rollbackRef? }.
 *
 * States: PLANNED → MOVED → VALIDATED → COMMITTED | BLOCKED. Rollback mode
 * replays COMMITTED moves in reverse (→ ROLLED_BACK). Append-only: this tool
 * never rewrites prior journal lines. No deletes: destructive cleanup goes
 * through quarantine policy, not this mover.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = path.join(__dirname, "..", "..");
const MIGRATION_ID = "post1h-physical-migration";

function args() {
  const a = process.argv.slice(2);
  const get = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  return {
    map: get("--map"),
    journal: get("--journal") || path.join(REPO, "projects", "validation", "post-1h-physical-migration", "migration", "migration-journal.jsonl"),
    rollback: a.includes("--rollback"),
  };
}

function sha256File(abs) {
  try {
    if (!fs.statSync(abs).isFile()) return null;
    return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  } catch { return null; }
}

function journalAppend(journalPath, event) {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.appendFileSync(journalPath, JSON.stringify({ migrationId: MIGRATION_ID, timestamp: new Date().toISOString(), ...event }) + "\n");
}

function validateMove(from, to) {
  if (!fs.existsSync(from)) return { ok: false, reason: `source absent: ${from}` };
  if (fs.existsSync(to)) return { ok: false, reason: `target already exists: ${to}` };
  return { ok: true };
}

function doMove(root, journalPath, item) {
  const from = path.join(root, item.from);
  const to = path.join(root, item.to);
  journalAppend(journalPath, { itemId: item.itemId, from: item.from, to: item.to, action: "move", state: "PLANNED", reason: item.reason });
  const pre = validateMove(from, to);
  if (!pre.ok) {
    journalAppend(journalPath, { itemId: item.itemId, from: item.from, to: item.to, action: "move", state: "BLOCKED", reason: item.reason, validationResult: pre.reason });
    return { ok: false, blocked: true, reason: pre.reason };
  }
  const wasFile = fs.statSync(from).isFile();
  const hash = wasFile ? sha256File(from) : null;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  const post = validateMove(to, from);
  const result = post.ok ? "target present, source gone" : `post-check failed: ${post.reason}`;
  const state = post.ok ? "VALIDATED" : "BLOCKED";
  journalAppend(journalPath, {
    itemId: item.itemId, from: item.from, to: item.to, action: "move", state,
    contentHash: hash, reason: item.reason, validationResult: result,
    rollbackRef: `reverse move ${item.to} → ${item.from}`,
  });
  if (post.ok) journalAppend(journalPath, { itemId: item.itemId, from: item.from, to: item.to, action: "move", state: "COMMITTED", contentHash: hash, reason: item.reason, validationResult: result });
  return { ok: post.ok, blocked: !post.ok, reason: result };
}

function doMkdir(root, journalPath, item) {
  const to = path.join(root, item.to);
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  journalAppend(journalPath, { itemId: item.itemId, from: null, to: item.to, action: "mkdir", state: "COMMITTED", reason: item.reason, validationResult: "directory present" });
  return { ok: true };
}

function rollback(root, journalPath) {
  const lines = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const committed = lines.filter((e) => e.state === "COMMITTED" && e.action === "move").reverse();
  let ok = 0, blocked = 0;
  for (const e of committed) {
    const from = path.join(root, e.to);
    const to = path.join(root, e.from);
    if (!fs.existsSync(from) || fs.existsSync(to)) {
      journalAppend(journalPath, { itemId: e.itemId, from: e.to, to: e.from, action: "move", state: "BLOCKED", reason: "rollback pre-check failed" });
      blocked++;
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    journalAppend(journalPath, { itemId: e.itemId, from: e.to, to: e.from, action: "move", state: "ROLLED_BACK", reason: `rollback of ${e.itemId}` });
    ok++;
  }
  console.log(JSON.stringify({ rolledBack: ok, blocked }));
  process.exit(blocked > 0 ? 1 : 0);
}

function main() {
  const { map, journal, rollback: rb } = args();
  if (rb) return rollback(REPO, journal);
  if (!map) { console.error("--map <migration-map.json> required"); process.exit(2); }
  const items = JSON.parse(fs.readFileSync(map, "utf8")).moves || [];
  let ok = 0, blocked = 0;
  for (const item of items) {
    const r = item.action === "mkdir" ? doMkdir(REPO, journal, item) : doMove(REPO, journal, item);
    if (r.ok) ok++; else { blocked++; console.error(`BLOCKED ${item.itemId}: ${r.reason}`); }
  }
  console.log(JSON.stringify({ movedOrCreated: ok, blocked, total: items.length }));
  process.exit(blocked > 0 ? 1 : 0);
}

main();
