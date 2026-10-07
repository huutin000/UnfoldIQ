"use strict";

/**
 * PHASE 1G.9 FIX 03 — main-world instruction write.
 *
 * FIX 02 live rounds proved that isolated-world writes (execCommand and
 * synthetic events) update the DOM but never survive Flow's Done/save: the
 * page framework's own state never accepts the value. This module closes
 * that gap with the least-privileged escalation the task contract allows:
 * a single, hard-coded function executed in the page's MAIN world through
 * chrome.scripting.executeScript({ world: "MAIN" }).
 *
 * `instructionMainWorldWrite` is self-contained on purpose: MV3 serializes
 * `func` via toString() and runs it in the page world, so it may reference
 * browser globals only — no outer-scope identifiers. It is NOT an arbitrary
 * code executor (§9): it can only locate the instruction editor through the
 * exact verified selector, write the given text through the editor's real
 * page-side contract, and return bounded, non-secret acknowledgement
 * evidence. No network, no storage, no cookies, no credentials, no scraping.
 *
 * Node-testable: the function touches only globals (document, Event,
 * InputEvent, HTMLTextAreaElement, HTMLInputElement), so suites stub them.
 */

const MAIN_WORLD_WRITE_VERSION = "fix03-mw1";

/**
 * Main-world write entry. `spec` = { selector, index, text }.
 * Returns a plain JSON result (must survive structured cloning):
 *   { ok, code, writePath, appStateAck, ackBasis, valueLength,
 *     propsValueLength, fingerprint, version }
 */
function instructionMainWorldWrite(spec) {
  var s = spec || {};
  var desired = typeof s.text === "string" ? s.text : "";
  var selector = typeof s.selector === "string" ? s.selector : "";
  var index = typeof s.index === "number" && s.index >= 0 ? s.index : 0;
  var result = {
    ok: false,
    code: null,
    writePath: null,
    appStateAck: false,
    ackBasis: null,
    valueLength: 0,
    propsValueLength: null,
    valueMatches: false,
    fingerprint: null,
    version: "fix03-mw1",
  };
  function readValue(el) {
    if (el && typeof el.value === "string") return el.value;
    if (el && typeof el.innerText === "string" && el.innerText) return el.innerText;
    if (el && typeof el.textContent === "string") return el.textContent;
    return "";
  }
  function ownNames(el) {
    try {
      return Object.getOwnPropertyNames(el) || [];
    } catch (e) {
      return [];
    }
  }
  function reactPropsOf(el) {
    var names = ownNames(el);
    for (var i = 0; i < names.length; i++) {
      if (names[i].indexOf("__reactProps$") === 0) {
        try {
          var p = el[names[i]];
          if (p && typeof p === "object") return p;
        } catch (e) { /* keep scanning */ }
      }
    }
    return null;
  }
  function fingerprintOf(el) {
    var names = ownNames(el);
    var fp = { reactProps: false, reactFiber: false, reactListening: false, valueTracker: false, lexical: false, ngVersion: null };
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (n.indexOf("__reactProps$") === 0) fp.reactProps = true;
      else if (n.indexOf("__reactFiber$") === 0) fp.reactFiber = true;
      else if (n.indexOf("_reactListening") === 0) fp.reactListening = true;
      else if (n === "_valueTracker") fp.valueTracker = true;
      else if (n.indexOf("__lexical") === 0) fp.lexical = true;
    }
    try {
      fp.ngVersion = document.documentElement.getAttribute("ng-version");
    } catch (e) { /* non-fatal */ }
    return fp;
  }
  function settle() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 60);
    }).then(function () {
      return new Promise(function (resolve) {
        setTimeout(resolve, 60);
      });
    });
  }
  function dispatchInput(el, data) {
    try {
      if (typeof InputEvent === "function") {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: data }));
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      if (typeof Event === "function") el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (e) { /* best-effort */ }
  }
  function dispatchChange(el) {
    try {
      if (typeof Event === "function") el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { /* best-effort */ }
  }
  function nativeSetter(el) {
    try {
      var ctor = el.tagName === "TEXTAREA"
        ? (typeof HTMLTextAreaElement !== "undefined" ? HTMLTextAreaElement : null)
        : el.tagName === "INPUT"
          ? (typeof HTMLInputElement !== "undefined" ? HTMLInputElement : null)
          : null;
      if (!ctor || !ctor.prototype) return null;
      var desc = Object.getOwnPropertyDescriptor(ctor.prototype, "value");
      return desc && typeof desc.set === "function" ? desc.set : null;
    } catch (e) {
      return null;
    }
  }
  // Strategy A — page-world native setter + input/change. This is the real
  // framework contract for controlled editors: the event reaches the page's
  // own root listeners (React etc.), and the framework's props/state are the
  // acknowledgement — not the DOM value.
  async function writeViaInputSequence(el) {
    try { el.focus(); } catch (e) { /* best-effort */ }
    var setter = nativeSetter(el);
    if (setter) setter.call(el, desired);
    else el.value = desired;
    dispatchInput(el, desired);
    dispatchChange(el);
    await settle();
    var props = reactPropsOf(el);
    if (props && typeof props.value === "string") {
      return { ack: props.value === desired, basis: "REACT_PROPS" };
    }
    return { ack: false, basis: "NO_FRAMEWORK_ACK" };
  }
  // Strategy B — page-world document.execCommand("insertText"): the BROWSER
  // emits the input events, the closest automation gets to real keystrokes.
  // Acknowledged by framework props when present, else by the value re-read
  // (browser-emitted events are trusted, so a surviving value is meaningful).
  async function writeViaExecCommand(el) {
    if (typeof document === "undefined" || !document || typeof document.execCommand !== "function") {
      return { ack: false, basis: "EXECCOMMAND_UNAVAILABLE" };
    }
    try { el.focus(); } catch (e) { /* best-effort */ }
    try { if (typeof el.select === "function") el.select(); } catch (e) { /* best-effort */ }
    var wrote = false;
    try {
      wrote = document.execCommand("insertText", false, desired) === true;
    } catch (e) {
      wrote = false;
    }
    if (!wrote) return { ack: false, basis: "EXECCOMMAND_REJECTED" };
    await settle();
    var props = reactPropsOf(el);
    if (props && typeof props.value === "string") {
      return { ack: props.value === desired, basis: "REACT_PROPS" };
    }
    return { ack: readValue(el) === desired, basis: "BROWSER_INPUT_EVENTS" };
  }
  try {
    if (!selector || !desired) {
      result.code = "SPEC_INVALID";
      return Promise.resolve(result);
    }
    var editors = [];
    try {
      editors = Array.prototype.slice.call(document.querySelectorAll(selector));
    } catch (e) {
      result.code = "SELECTOR_INVALID";
      return Promise.resolve(result);
    }
    var editor = editors[index];
    if (!editor) {
      result.code = "EDITOR_NOT_FOUND";
      return Promise.resolve(result);
    }
    result.fingerprint = fingerprintOf(editor);
    return writeViaInputSequence(editor).then(function (a) {
      if (a.ack) {
        result.ok = true;
        result.writePath = "MAIN_WORLD_INPUT_SEQUENCE";
        result.appStateAck = true;
        result.ackBasis = a.basis;
      } else {
        return writeViaExecCommand(editor).then(function (b) {
          if (b.ack) {
            result.ok = true;
            result.writePath = "MAIN_WORLD_EXEC_COMMAND";
            result.appStateAck = true;
            result.ackBasis = b.basis;
          } else {
            result.writePath = "MAIN_WORLD_INPUT_SEQUENCE";
            result.appStateAck = false;
            result.ackBasis = b.basis || a.basis || "NO_FRAMEWORK_ACK";
          }
          return result;
        });
      }
      return result;
    }).then(function () {
      var v = readValue(editor);
      result.valueLength = v.length;
      result.valueMatches = v === desired;
      var props = reactPropsOf(editor);
      result.propsValueLength = props && typeof props.value === "string" ? props.value.length : null;
      return result;
    });
  } catch (e) {
    result.code = "MAIN_WORLD_WRITE_FAILED";
    return Promise.resolve(result);
  }
}

if (typeof self !== "undefined") {
  // MV3 service worker global (loaded via importScripts) so service-worker.js
  // can pass the function object to chrome.scripting.executeScript.
  self.InstructionMainWorldWrite = { WRITE_VERSION: MAIN_WORLD_WRITE_VERSION, write: instructionMainWorldWrite };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MAIN_WORLD_WRITE_VERSION, instructionMainWorldWrite };
}
