"use strict";

/**
 * Diagram spec boundary + helpers for the data-driven DiagramScene
 * (remotion/src/diagram). Specs are plain JSON; this validates them before a
 * render and builds reusable chart specs so new scenes need no new component.
 */

const Ajv = require("ajv");
const schema = require("../../schemas/diagram-spec.schema.json");

const validateShape = new Ajv({ allErrors: true, strict: false }).compile(schema);

const ELEMENT_FIELDS = {
  circle: ["cx", "cy", "r"],
  line: ["x1", "y1", "x2", "y2"],
  rect: ["x", "y", "w", "h"],
  path: ["d"],
  text: ["x", "y", "text"],
};
const TRACKED = ["cx", "cy", "r", "x1", "y1", "x2", "y2", "x", "y", "w", "h", "opacity", "strokeWidth", "draw"];

function validTrack(v) {
  if (typeof v === "number") return Number.isFinite(v);
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((k, i) => Array.isArray(k) && k.length === 2 && k.every(Number.isFinite) && (i === 0 || k[0] >= v[i - 1][0]));
}

function validateSpec(spec) {
  const errors = [];
  if (!validateShape(spec)) {
    return { ok: false, errors: validateShape.errors.map((e) => `schema: ${e.instancePath || "/"} ${e.message}`) };
  }
  const ids = new Set();
  for (const el of (spec && spec.elements) || []) {
    const where = `element ${el && el.id}`;
    if (!el || !el.id) { errors.push("element without id"); continue; }
    if (ids.has(el.id)) errors.push(`${where}: duplicate id`);
    ids.add(el.id);
    const need = ELEMENT_FIELDS[el.type];
    if (!need) { errors.push(`${where}: unknown type ${el.type}`); continue; }
    for (const k of need) if (el[k] === undefined) errors.push(`${where}: missing ${k}`);
    for (const k of TRACKED) if (el[k] !== undefined && !validTrack(el[k])) errors.push(`${where}: bad track ${k}`);
    if (el.show && !(el.show[0] >= 0 && (el.show[1] === undefined || el.show[1] > el.show[0]))) errors.push(`${where}: bad show window`);
  }
  if (errors.length === 0 && spec.elements.some((e) => e.type === "text" && !e.text)) errors.push("empty text element");
  return { ok: errors.length === 0, errors };
}

/**
 * Bar chart as plain elements: bars grow in sequence, values are printed
 * verbatim (numbers stay deterministic and sourced by the caller).
 */
function barChart({ id = "bars", bars, x = 260, y = 220, w = 1400, h = 640, max, startSec = 0.6, stepSec = 0.5, growSec = 0.9, color = "#4da3ff", textColor = "#f5f7fa" }) {
  const top = max || Math.max(...bars.map((b) => b.value));
  const gap = 24;
  const bw = (w - gap * (bars.length - 1)) / bars.length;
  const els = [{ id: `${id}-axis`, type: "line", x1: x, y1: y + h, x2: x + w, y2: y + h, stroke: "#8a93a6", strokeWidth: 3 }];
  bars.forEach((b, i) => {
    const bh = (b.value / top) * h;
    const t0 = startSec + i * stepSec;
    const bx = x + i * (bw + gap);
    els.push({ id: `${id}-bar${i}`, type: "rect", x: bx, y: [[t0, y + h], [t0 + growSec, y + h - bh]], w: bw, h: [[t0, 0], [t0 + growSec, bh]], rx: 8, fill: b.color || color });
    els.push({ id: `${id}-val${i}`, type: "text", x: bx + bw / 2, y: y + h - bh - 18, text: b.valueLabel || String(b.value), size: 38, fill: textColor, anchor: "middle", opacity: [[t0 + growSec * 0.6, 0], [t0 + growSec, 1]] });
    els.push({ id: `${id}-lab${i}`, type: "text", x: bx + bw / 2, y: y + h + 56, text: b.label, size: 34, fill: "#8a93a6", anchor: "middle" });
  });
  return els;
}

module.exports = { validateSpec, barChart };
