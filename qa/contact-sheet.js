"use strict";
// qa/contact-sheet.js — STEP-13 Branch C.
// Contact sheet WITHOUT canvas/native deps: a deterministic, viewable HTML
// file (grid of <img> thumbnails with timestamps + labels). Rationale: the
// repo forbids installs and native modules; an HTML grid is fully sufficient
// as review evidence (viewable in any browser, stable byte output for the
// same inputs) while ffmpeg-tile composition would re-encode evidence and
// need font/scale plumbing. No uploads, no network.

var fs = require("fs");
var path = require("path");

function escHtml(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileUrl(p) {
  var abs = path.resolve(p);
  return "file:///" + abs.split(path.sep).join("/").replace(/ /g, "%20");
}

function buildContactSheet(args) {
  args = args || {};
  var samples = Array.isArray(args.samples) ? args.samples : [];
  var outPath = args.outPath;
  var columns = args.columns !== undefined && args.columns !== null
    ? Math.max(1, Math.min(8, Math.floor(Number(args.columns)) || 4)) : 4;
  if (!outPath || typeof outPath !== "string") throw new Error("buildContactSheet: outPath required");
  var sheetPath = /\.html?$/i.test(outPath) ? outPath : outPath + ".html";
  fs.mkdirSync(path.dirname(path.resolve(sheetPath)), { recursive: true });

  var cells = samples.map(function (s, i) {
    s = s || {};
    var label = typeof s.label === "string" && s.label.length > 0 ? s.label : ("sample-" + (i + 1));
    var ts = s.timestampMs !== undefined ? s.timestampMs : "?";
    var img = s.framePath
      ? '<img src="' + escHtml(fileUrl(s.framePath)) + '" alt="' + escHtml(label) + '" style="max-width:100%;display:block"/>'
      : '<div style="padding:24px;color:#888">missing frame</div>';
    return '<figure style="margin:0;border:1px solid #ccc;padding:4px">' + img +
      "<figcaption>" + escHtml(label) + " @ " + escHtml(String(ts)) + "ms" +
      (s.method ? " [" + escHtml(s.method) + "]" : "") + "</figcaption></figure>";
  }).join("\n");

  var html = "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">" +
    "<title>UNFOLDIQ contact sheet</title></head>\n<body>\n" +
    "<h1>UNFOLDIQ contact sheet (" + samples.length + " frames)</h1>\n" +
    '<div style="display:grid;grid-template-columns:repeat(' + columns + ",1fr);gap:8px\">\n" +
    cells + "\n</div>\n</body></html>\n";
  fs.writeFileSync(sheetPath, html, "utf8");
  return { sheetPath: sheetPath, count: samples.length };
}

module.exports = {
  buildContactSheet: buildContactSheet
};
