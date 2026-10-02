const fs = require('fs');
const path = require('path');

function loadRegistry() {
  const registryPath = path.join(__dirname, "..", 'projects', 'TOPIC_REGISTRY.json');
  if (!fs.existsSync(registryPath)) {
    return { version: 1, topics: [] };
  }
  const content = fs.readFileSync(registryPath, 'utf8');
  return JSON.parse(content);
}

function saveRegistry(registry) {
  const registryPath = path.join(__dirname, "..", 'projects', 'TOPIC_REGISTRY.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

const ACTIVE_COVERAGE_STATUSES = new Set([
  'SELECTED',
  'IN_PRODUCTION',
  'RENDERED',
  'PUBLISHED'
]);

function getActiveCoverage(topic, platform) {
  const platformData = topic.platforms?.[platform];
  if (!platformData) return null;
  if (ACTIVE_COVERAGE_STATUSES.has(platformData.status)) {
    return platformData.status;
  }
  return null;
}

function hasActiveCoverage(topic, platform) {
  return getActiveCoverage(topic, platform) !== null;
}

function hasCrossPlatformCoverage(topic, targetPlatform) {
  for (const [platform, data] of Object.entries(topic.platforms || {})) {
    if (platform !== targetPlatform && ACTIVE_COVERAGE_STATUSES.has(data.status)) {
      return platform;
    }
  }
  return null;
}

function evaluateDuplicateDecision(input) {
  const {
    classification,
    matchedTopic,
    targetPlatform,
    revisitReason,
  } = input;

  const registry = loadRegistry();

  if (!matchedTopic) {
    switch (classification) {
      case 'NEW_TOPIC':
        return { decision: 'ALLOW_NEW_TOPIC', rationale: 'No existing topic match in registry' };
      case 'REVISIT_UPDATE':
        return {
          decision: revisitReason && revisitReason.trim() ? 'ALLOW_REVISIT' : 'REVISE',
          rationale: revisitReason ? 'Material revisit reason provided' : 'No material reason for revisit'
        };
      default:
        return { decision: 'REVISE', rationale: 'Unknown classification without matched topic' };
    }
  }

  const activeOnTarget = hasActiveCoverage(matchedTopic, targetPlatform);
  const crossPlatform = hasCrossPlatformCoverage(matchedTopic, targetPlatform);

  switch (classification) {
    case 'EXACT_DUPLICATE':
    case 'SAME_TOPIC_SAME_ANGLE':
      if (activeOnTarget) {
        return {
          decision: 'BLOCK',
          rationale: `Topic already has active coverage (${activeOnTarget}) on target platform ${targetPlatform}`
        };
      }
      if (crossPlatform) {
        return {
          decision: 'ALLOW_CROSS_PLATFORM',
          rationale: `Topic covered on ${crossPlatform} but not on target platform ${targetPlatform}`
        };
      }
      return {
        decision: 'REVISE',
        rationale: 'Matched topic exists but no active coverage on any platform; requires revision to differentiate'
      };

    case 'SAME_TOPIC_NEW_ANGLE':
      if (activeOnTarget) {
        return {
          decision: 'ALLOW_NEW_ANGLE',
          rationale: 'Materially different angle on same topic; target platform has active coverage but angle is substantively different'
        };
      }
      return {
        decision: 'ALLOW_NEW_ANGLE',
        rationale: 'Materially different angle; no active coverage on target platform'
      };

    case 'NEW_TOPIC':
      return {
        decision: 'ALLOW_NEW_TOPIC',
        rationale: 'No material overlap with existing registry topics'
      };

    case 'REVISIT_UPDATE':
      return {
        decision: revisitReason && revisitReason.trim() ? 'ALLOW_REVISIT' : 'REVISE',
        rationale: revisitReason ? 'Material revisit reason provided' : 'No material reason for revisit'
      };

    default:
      return {
        decision: 'REVISE',
        rationale: `Unknown classification: ${classification}`
      };
  }
}

function canMarkPublished(input) {
  const {
    targetPlatform,
    explicitConfirmation,
    publishingEvidence,
    currentStatus,
  } = input;

  if (currentStatus === 'PUBLISHED') {
    return { canPublish: true, reason: 'Already marked as published' };
  }

  if (explicitConfirmation === true) {
    return { canPublish: true, reason: 'Explicit user confirmation provided' };
  }

  if (publishingEvidence && typeof publishingEvidence === 'string' && publishingEvidence.trim()) {
    return { canPublish: true, reason: 'Publishing evidence provided' };
  }

  if (currentStatus === 'RENDERED') {
    return {
      canPublish: false,
      reason: 'RENDERED status alone does not constitute publication; requires explicit confirmation or publishing evidence'
    };
  }

  return {
    canPublish: false,
    reason: 'Insufficient evidence for publication; requires explicit confirmation or publishing evidence'
  };
}

function upsertTopic(topicData) {
  const registry = loadRegistry();
  const existingIndex = registry.topics.findIndex(t => t.topicId === topicData.topicId);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    registry.topics[existingIndex] = {
      ...registry.topics[existingIndex],
      ...topicData,
      updatedAt: now,
    };
  } else {
    registry.topics.push({
      ...topicData,
      createdAt: topicData.createdAt || now,
      updatedAt: now,
    });
  }

  saveRegistry(registry);
  return registry;
}

function setPlatformStatus(topicId, platform, status, metadata = {}) {
  const registry = loadRegistry();
  const topic = registry.topics.find(t => t.topicId === topicId);
  if (!topic) {
    throw new Error(`Topic ${topicId} not found in registry`);
  }

  const now = new Date().toISOString();
  const platformData = topic.platforms?.[platform] || {};

  topic.platforms = {
    ...topic.platforms,
    [platform]: {
      ...platformData,
      status,
      ...metadata,
      updatedAt: now,
    },
  };

  topic.updatedAt = now;
  saveRegistry(registry);
  return registry;
}

module.exports = {
  loadRegistry,
  saveRegistry,
  evaluateDuplicateDecision,
  canMarkPublished,
  upsertTopic,
  setPlatformStatus,
  ACTIVE_COVERAGE_STATUSES,
  getActiveCoverage,
  hasActiveCoverage,
  hasCrossPlatformCoverage,
};