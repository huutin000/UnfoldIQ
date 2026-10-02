const {
  loadRegistry,
  saveRegistry,
  evaluateDuplicateDecision,
  canMarkPublished,
  upsertTopic,
  setPlatformStatus,
  ACTIVE_COVERAGE_STATUSES,
} = require('../../lib/topic-registry-check.js');

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, "..", "..", 'projects', 'TOPIC_REGISTRY.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

function resetRegistry() {
  saveRegistry({ version: 1, topics: [] });
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  resetRegistry();
  try {
    fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    return false;
  }
}

console.log('=== TOPIC REGISTRY DECISION TESTS ===\n');

let passed = 0;
let failed = 0;

// Case A: YouTube=PUBLISHED, TikTok absent, target=TikTok, same topic+same angle
// Expected: ALLOW_CROSS_PLATFORM
passed += runTest('Case A: ALLOW_CROSS_PLATFORM', () => {
  upsertTopic({
    topicId: 'TOPIC-001',
    canonicalTopic: 'How Ancient Humans Protected Babies',
    niche: 'Ancient Humans',
    subject: 'Ancient Human Parenting',
    audienceQuestion: 'How did ancient humans protect babies?',
    angle: 'Cooperative care and tool use',
    corePromise: 'Reveal cooperative strategies',
    platforms: {
      youtube: { status: 'PUBLISHED', projectId: 'proj-001', publishedAt: '2025-01-15T10:00:00Z' }
    },
    createdAt: '2025-01-01T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z'
  });

  const result = evaluateDuplicateDecision({
    classification: 'SAME_TOPIC_SAME_ANGLE',
    matchedTopic: loadRegistry().topics[0],
    targetPlatform: 'tiktok'
  });

  assert(result.decision === 'ALLOW_CROSS_PLATFORM', `Expected ALLOW_CROSS_PLATFORM, got ${result.decision}`);
});

// Case B: TikTok=PUBLISHED, target=TikTok, same topic+same angle
// Expected: BLOCK
passed += runTest('Case B: BLOCK target PUBLISHED', () => {
  upsertTopic({
    topicId: 'TOPIC-002',
    canonicalTopic: 'How Ancient Humans Protected Babies',
    niche: 'Ancient Humans',
    subject: 'Ancient Human Parenting',
    audienceQuestion: 'How did ancient humans protect babies?',
    angle: 'Cooperative care and tool use',
    corePromise: 'Reveal cooperative strategies',
    platforms: {
      tiktok: { status: 'PUBLISHED', projectId: 'proj-002', publishedAt: '2025-02-15T10:00:00Z' }
    },
    createdAt: '2025-02-01T10:00:00Z',
    updatedAt: '2025-02-15T10:00:00Z'
  });

  const result = evaluateDuplicateDecision({
    classification: 'SAME_TOPIC_SAME_ANGLE',
    matchedTopic: loadRegistry().topics[0],
    targetPlatform: 'tiktok'
  });

  assert(result.decision === 'BLOCK', `Expected BLOCK, got ${result.decision}`);
});

// Case B2: TikTok=RENDERED, target=TikTok, same topic+same angle
// Expected: BLOCK (RENDERED is active coverage)
passed += runTest('Case B2: BLOCK target RENDERED', () => {
  upsertTopic({
    topicId: 'TOPIC-003',
    canonicalTopic: 'How Ancient Humans Protected Babies',
    niche: 'Ancient Humans',
    subject: 'Ancient Human Parenting',
    audienceQuestion: 'How did ancient humans protect babies?',
    angle: 'Cooperative care and tool use',
    corePromise: 'Reveal cooperative strategies',
    platforms: {
      tiktok: { status: 'RENDERED', projectId: 'proj-003', renderedAt: '2025-03-15T10:00:00Z' }
    },
    createdAt: '2025-03-01T10:00:00Z',
    updatedAt: '2025-03-15T10:00:00Z'
  });

  const result = evaluateDuplicateDecision({
    classification: 'SAME_TOPIC_SAME_ANGLE',
    matchedTopic: loadRegistry().topics[0],
    targetPlatform: 'tiktok'
  });

  assert(result.decision === 'BLOCK', `Expected BLOCK for RENDERED, got ${result.decision}`);
});

// Case C: SAME_TOPIC_NEW_ANGLE
// Expected: ALLOW_NEW_ANGLE
passed += runTest('Case C: ALLOW_NEW_ANGLE', () => {
  upsertTopic({
    topicId: 'TOPIC-004',
    canonicalTopic: 'How Ancient Humans Protected Babies',
    niche: 'Ancient Humans',
    subject: 'Ancient Human Parenting',
    audienceQuestion: 'How did ancient humans protect babies?',
    angle: 'Cooperative care and tool use',
    corePromise: 'Reveal cooperative strategies',
    platforms: {
      tiktok: { status: 'PUBLISHED', projectId: 'proj-004', publishedAt: '2025-04-15T10:00:00Z' }
    },
    createdAt: '2025-04-01T10:00:00Z',
    updatedAt: '2025-04-15T10:00:00Z'
  });

  const result = evaluateDuplicateDecision({
    classification: 'SAME_TOPIC_NEW_ANGLE',
    matchedTopic: loadRegistry().topics[0],
    targetPlatform: 'tiktok'
  });

  assert(result.decision === 'ALLOW_NEW_ANGLE', `Expected ALLOW_NEW_ANGLE, got ${result.decision}`);
});

// Case D: REVISIT_UPDATE with material reason
// Expected: ALLOW_REVISIT
passed += runTest('Case D: ALLOW_REVISIT with material reason', () => {
  upsertTopic({
    topicId: 'TOPIC-005',
    canonicalTopic: 'Ancient Human Fire Use',
    niche: 'Ancient Humans',
    subject: 'Fire mastery timeline',
    audienceQuestion: 'When did humans master fire?',
    angle: 'Early controlled fire evidence',
    corePromise: 'Reveal earliest fire use',
    platforms: {
      youtube: { status: 'PUBLISHED', projectId: 'proj-005', publishedAt: '2024-12-15T10:00:00Z' }
    },
    createdAt: '2024-12-01T10:00:00Z',
    updatedAt: '2024-12-15T10:00:00Z'
  });

  const result = evaluateDuplicateDecision({
    classification: 'REVISIT_UPDATE',
    matchedTopic: loadRegistry().topics[0],
    targetPlatform: 'youtube',
    revisitReason: 'New archaeological dating from 2024 pushes controlled fire evidence back by 200k years'
  });

  assert(result.decision === 'ALLOW_REVISIT', `Expected ALLOW_REVISIT, got ${result.decision}`);
});

// Case D2: REVISIT_UPDATE without material reason
// Expected: REVISE
passed += runTest('Case D2: REVISE without material reason', () => {
  upsertTopic({
    topicId: 'TOPIC-006',
    canonicalTopic: 'Ancient Human Migration',
    niche: 'Ancient Humans',
    subject: 'Out of Africa timeline',
    audienceQuestion: 'When did humans leave Africa?',
    angle: 'Single wave migration',
    corePromise: 'Explain migration timeline',
    platforms: {
      tiktok: { status: 'PUBLISHED', projectId: 'proj-006', publishedAt: '2025-01-15T10:00:00Z' }
    },
    createdAt: '2025-01-01T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z'
  });

  const result = evaluateDuplicateDecision({
    classification: 'REVISIT_UPDATE',
    matchedTopic: loadRegistry().topics[0],
    targetPlatform: 'tiktok',
    revisitReason: ''
  });

  assert(result.decision === 'REVISE', `Expected REVISE, got ${result.decision}`);
});

// Case E: RENDERED does not mark PUBLISHED
// Expected: canMarkPublished = false
passed += runTest('Case E: RENDERED does not auto-mark PUBLISHED', () => {
  const result = canMarkPublished({
    targetPlatform: 'tiktok',
    explicitConfirmation: false,
    publishingEvidence: '',
    currentStatus: 'RENDERED'
  });

  assert(result.canPublish === false, `Expected canPublish=false for RENDERED without confirmation`);
  assert(result.reason.includes('RENDERED'), 'Reason should mention RENDERED');
});

// Case E2: RENDERED + explicit confirmation
// Expected: canMarkPublished = true
passed += runTest('Case E2: RENDERED + explicit confirmation allows publish', () => {
  const result = canMarkPublished({
    targetPlatform: 'tiktok',
    explicitConfirmation: true,
    publishingEvidence: '',
    currentStatus: 'RENDERED'
  });

  assert(result.canPublish === true, `Expected canPublish=true with explicit confirmation`);
});

// Case F: NEW_TOPIC
// Expected: ALLOW_NEW_TOPIC
passed += runTest('Case F: ALLOW_NEW_TOPIC', () => {
  // No existing topic in registry
  const result = evaluateDuplicateDecision({
    classification: 'NEW_TOPIC',
    matchedTopic: null,
    targetPlatform: 'tiktok'
  });

  assert(result.decision === 'ALLOW_NEW_TOPIC', `Expected ALLOW_NEW_TOPIC, got ${result.decision}`);
});

// Additional test: EXACT_DUPLICATE with cross-platform
passed += runTest('Case: EXACT_DUPLICATE cross-platform allowed', () => {
  resetRegistry();
  upsertTopic({
    topicId: 'TOPIC-007',
    canonicalTopic: 'Neanderthal Art',
    niche: 'Ancient Humans',
    subject: 'Neanderthal symbolic behavior',
    audienceQuestion: 'Did Neanderthals make art?',
    angle: 'Cave paintings and ornaments',
    corePromise: 'Reveal Neanderthal symbolic capacity',
    platforms: {
      youtube: { status: 'PUBLISHED', projectId: 'proj-007', publishedAt: '2025-05-15T10:00:00Z' }
    },
    createdAt: '2025-05-01T10:00:00Z',
    updatedAt: '2025-05-15T10:00:00Z'
  });

  const result = evaluateDuplicateDecision({
    classification: 'EXACT_DUPLICATE',
    matchedTopic: loadRegistry().topics[0],
    targetPlatform: 'tiktok'
  });

  assert(result.decision === 'ALLOW_CROSS_PLATFORM', `Expected ALLOW_CROSS_PLATFORM for EXACT_DUPLICATE, got ${result.decision}`);
});

// Test canMarkPublished with explicit confirmation
passed += runTest('canMarkPublished: explicit confirmation', () => {
  const result = canMarkPublished({
    targetPlatform: 'tiktok',
    explicitConfirmation: true,
    publishingEvidence: '',
    currentStatus: 'RENDERED'
  });
  assert(result.canPublish === true, 'Explicit confirmation should allow publish');
});

// Test canMarkPublished with publishing evidence
passed += runTest('canMarkPublished: publishing evidence', () => {
  const result = canMarkPublished({
    targetPlatform: 'tiktok',
    explicitConfirmation: false,
    publishingEvidence: 'https://tiktok.com/@user/video/12345',
    currentStatus: 'RENDERED'
  });
  assert(result.canPublish === true, 'Publishing evidence should allow publish');
});

// Test canMarkPublished already PUBLISHED
passed += runTest('canMarkPublished: already published', () => {
  const result = canMarkPublished({
    targetPlatform: 'tiktok',
    explicitConfirmation: false,
    publishingEvidence: '',
    currentStatus: 'PUBLISHED'
  });
  assert(result.canPublish === true, 'Already published should return true');
});

// Test REVISIT_UPDATE without reason
passed += runTest('REVISIT_UPDATE without reason -> REVISE', () => {
  resetRegistry();
  upsertTopic({
    topicId: 'TOPIC-008',
    canonicalTopic: 'Test Topic',
    niche: 'Test',
    subject: 'Test',
    audienceQuestion: 'Test?',
    angle: 'Test',
    corePromise: 'Test',
    platforms: { youtube: { status: 'DISCOVERED' } },
    createdAt: '2025-01-01T10:00:00Z',
    updatedAt: '2025-01-01T10:00:00Z'
  });

  const result = evaluateDuplicateDecision({
    classification: 'REVISIT_UPDATE',
    matchedTopic: loadRegistry().topics[0],
    targetPlatform: 'youtube',
    revisitReason: ''
  });
  assert(result.decision === 'REVISE', `Expected REVISE for empty revisit reason, got ${result.decision}`);
});

console.log(`\n=== SUMMARY ===`);
console.log(`Total tests: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
console.log('\n✓ ALL TESTS PASSED');