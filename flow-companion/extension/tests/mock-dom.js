"use strict";

/**
 * Minimal mock DOM for Flow adapter tests (STEP 10B).
 * Supports querySelector/querySelectorAll over a canned selector→element map.
 */

class FakeElement {
  constructor({ tag = "div", attrs = {}, value = "", src = "", children = [] } = {}) {
    this.tag = tag;
    this.attrs = attrs;
    this.value = value;
    this.src = src;
    this.children = children;
    this.clicked = 0;
  }
  get tagName() {
    return String(this.tag || "").toUpperCase();
  }
  click() {
    this.clicked += 1;
  }
  getAttribute(name) {
    return this.attrs[name] || null;
  }
}

class FakeDocument {
  constructor(map = {}) {
    this.map = map; // selector string → FakeElement | FakeElement[]
  }
  querySelector(selector) {
    const v = this.map[selector];
    if (Array.isArray(v)) return v[0] || null;
    return v || null;
  }
  querySelectorAll(selector) {
    const v = this.map[selector];
    if (Array.isArray(v)) return v;
    return v ? [v] : [];
  }
  // POST-v1E.2D: visibility snapshots walk registered elements.
  contains(el) {
    for (const v of Object.values(this.map)) {
      const arr = Array.isArray(v) ? v : [v];
      if (arr.includes(el)) return true;
    }
    return false;
  }
}

module.exports = { FakeElement, FakeDocument };
