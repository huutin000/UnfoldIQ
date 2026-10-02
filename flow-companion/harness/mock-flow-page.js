"use strict";

/**
 * Mock Flow page scenarios (STEP 10B harness).
 * Each scenario builds a FakeDocument exercising one adapter path:
 * full page, missing prompt, modes, references, frames, results,
 * delayed results, multiple cards, changed DOM (selectors gone).
 */

const { FakeDocument, FakeElement } = require("../extension/tests/mock-dom");
const { SELECTORS } = require("../extension/src/content/flow-page-adapter");

const S = (key) => SELECTORS[key].selector;

function el(opts = {}) {
  return new FakeElement(opts);
}

function fullPage({ results = [] } = {}) {
  const map = {
    [S("PROMPT_INPUT")]: el({ tag: "textarea", value: "" }),
    [S("GENERATE_BUTTON")]: el({ tag: "button" }),
    [S("MODE_IMAGE")]: el({ tag: "button" }),
    [S("MODE_VIDEO")]: el({ tag: "button" }),
    [S("ASPECT_CONTROL")]: el({ tag: "select", value: "16:9" }),
    [S("LENGTH_CONTROL")]: el({ tag: "select", value: "8s" }),
    [S("REFERENCE_INPUT")]: el({ tag: "input" }),
    [S("START_FRAME_INPUT")]: el({ tag: "input" }),
    [S("END_FRAME_INPUT")]: el({ tag: "input" }),
    [S("RESULT_CONTAINER")]: el({ tag: "div" }),
  };
  if (results.length > 0) {
    map[S("RESULT_MEDIA")] = results.map((src) => el({ tag: "img", src, attrs: { src } }));
  }
  return new FakeDocument(map);
}

function missingPrompt() {
  const doc = fullPage();
  delete doc.map[S("PROMPT_INPUT")];
  return doc;
}

function changedDom() {
  // Simulates a Flow UI revamp: none of the known controls match.
  return new FakeDocument({
    ".new-ui-composer": el({ tag: "div" }),
  });
}

module.exports = { fullPage, missingPrompt, changedDom, S };
