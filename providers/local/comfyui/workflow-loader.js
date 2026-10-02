"use strict";

/**
 * ComfyUI workflow registry loader (STEP-10C Branch A).
 * Registry-driven, no network.
 */

const fs = require("fs");
const path = require("path");

const VALID_CAPABILITIES = ["image", "video"];

function defaultProjectRoot() {
  return path.join(__dirname, "..", "..", "..");
}

function registryPath(projectRoot) {
  return path.join(projectRoot || defaultProjectRoot(), "providers", "local", "comfyui", "workflow-registry.yaml");
}

function validateWorkflow(entry) {
  if (!entry || typeof entry !== "object") throw new Error("INVALID_WORKFLOW_ENTRY");
  const required = [
    "workflowId",
    "capability",
    "displayName",
    "workflowPath",
    "enabled",
    "requiredModels",
    "hardwareRequirements",
    "supportedAspectRatios",
    "parameterBindings",
    "outputNode",
  ];
  for (const k of required) {
    if (entry[k] === undefined || entry[k] === null) {
      throw new Error(`WORKFLOW_MISSING_FIELD: ${k} (${entry.workflowId || "unknown"})`);
    }
  }
  if (typeof entry.workflowId !== "string" || entry.workflowId.length === 0) {
    throw new Error("WORKFLOW_MISSING_FIELD: workflowId");
  }
  if (!VALID_CAPABILITIES.includes(entry.capability)) {
    throw new Error(`WORKFLOW_UNKNOWN_CAPABILITY: ${entry.capability}`);
  }
  if (typeof entry.workflowPath !== "string" || entry.workflowPath.length === 0) {
    throw new Error("WORKFLOW_MISSING_FIELD: workflowPath");
  }
  if (path.isAbsolute(entry.workflowPath)) {
    throw new Error(`WORKFLOW_PATH_ABSOLUTE_REJECTED: ${entry.workflowPath}`);
  }
  const norm = path.posix.normalize(entry.workflowPath.split(path.sep).join("/"));
  if (norm === ".." || norm.startsWith("../") || norm.includes("/../") || norm.includes("..\\")) {
    throw new Error(`WORKFLOW_PATH_TRAVERSAL_REJECTED: ${entry.workflowPath}`);
  }
  if (typeof entry.workflowPath === "string" && entry.workflowPath.includes("..")) {
    const segs = entry.workflowPath.split(/[\\/]/);
    if (segs.includes("..")) throw new Error(`WORKFLOW_PATH_TRAVERSAL_REJECTED: ${entry.workflowPath}`);
  }
  if (!Array.isArray(entry.requiredModels)) throw new Error("WORKFLOW_MISSING_FIELD: requiredModels");
  if (typeof entry.hardwareRequirements !== "object") throw new Error("WORKFLOW_MISSING_FIELD: hardwareRequirements");
  if (!Array.isArray(entry.supportedAspectRatios)) throw new Error("WORKFLOW_MISSING_FIELD: supportedAspectRatios");
  if (typeof entry.parameterBindings !== "object") throw new Error("WORKFLOW_MISSING_FIELD: parameterBindings");
  if (typeof entry.outputNode !== "string" || entry.outputNode.length === 0) {
    throw new Error("WORKFLOW_MISSING_FIELD: outputNode");
  }
  return true;
}

function loadRegistry(projectRoot) {
  const yaml = require("js-yaml");
  const rp = registryPath(projectRoot);
  const raw = fs.readFileSync(rp, "utf8");
  const doc = yaml.load(raw) || {};
  const server =
    doc.server && typeof doc.server === "object"
      ? { host: doc.server.host || "127.0.0.1", port: doc.server.port || 8188 }
      : { host: "127.0.0.1", port: 8188 };
  const workflows = Array.isArray(doc.workflows) ? doc.workflows : [];
  for (const w of workflows) validateWorkflow(w);
  return { server, workflows, registryFile: rp };
}

function getWorkflow(id, projectRoot) {
  const reg = loadRegistry(projectRoot);
  const found = reg.workflows.find((w) => w.workflowId === id) || null;
  return found;
}

function listWorkflows(opts, projectRoot) {
  const o = opts || {};
  const reg = loadRegistry(typeof o.projectRoot === "string" ? o.projectRoot : projectRoot);
  let list = reg.workflows.slice();
  if (o.capability) list = list.filter((w) => w.capability === o.capability);
  if (o.enabledOnly === true) list = list.filter((w) => w.enabled === true);
  return list;
}

module.exports = { loadRegistry, getWorkflow, listWorkflows, validateWorkflow, VALID_CAPABILITIES };
