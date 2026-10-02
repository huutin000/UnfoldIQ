const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const { validateResearchBriefSemantics, validateClaimSemantics } = require("../../lib/research-quality-check.js");

const schemasDir = path.join(__dirname, "..", "..", "schemas");
const schemaFiles = [
  "scene-script.schema.json",
  "asset-manifest.schema.json",
  "audio-manifest.schema.json",
  "captions.schema.json",
  "video-spec.schema.json",
  "topic-discovery.schema.json",
  "topic-registry.schema.json",
  "research-brief.schema.json",
  "research-plan.schema.json",
  "creative-brief.schema.json",
  "source-index.schema.json",
  "evidence-state.schema.json",
  "story-handoff.schema.json",
  "content-mode.schema.json",
  "context-manifest.schema.json",
  "policy-snapshot.schema.json",
  "policy-review.schema.json",
  "provider-request.schema.json",
  "provider-result.schema.json",
  "continuity-registry.schema.json",
  "approved-local.schema.json",
  "duration-contract.schema.json",
  "flow-job.schema.json",
  "music-source.schema.json",
  "thumbnail-package.schema.json",
  "safety-prompt-adaptation.schema.json",
  "media-preflight.schema.json",
  "audio-mix-plan.schema.json",
  "render-input.schema.json",
  "render-plan.schema.json",
  "staging-manifest.schema.json",
  "pipeline-state.schema.json",
  "render-attempt.schema.json",
  "fix-plan.schema.json",
  "render-qa.schema.json",
  "visual-review.schema.json",
  "final-artifact.schema.json"
];

function createAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function loadSchema(file) {
  const content = fs.readFileSync(path.join(schemasDir, file), "utf8");
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

console.log("=== Schema Syntax Validation ===");
const ajvSyntax = createAjv();
for (const file of schemaFiles) {
  try {
    const schema = loadSchema(file);
    ajvSyntax.compile(schema);
    console.log(`✓ ${file}: Valid JSON Schema syntax`);
  } catch (e) {
    console.log(`✗ ${file}: INVALID - ${e.message}`);
    process.exit(1);
  }
}

console.log("\n=== Valid Instance Testing ===");

function testValid(name, file, instance) {
  const ajv = createAjv();
  try {
    const schema = loadSchema(file);
    const validate = ajv.compile(schema);
    const valid = validate(instance);
    console.log(valid ? `✓ ${name}: Valid instance accepted` : `✗ ${name}: ${JSON.stringify(validate.errors)}`);
    return valid;
  } catch (e) {
    console.log(`✗ ${name} validation error: ${e.message}`);
    return false;
  }
}

function testInvalid(name, file, instance) {
  const ajv = createAjv();
  try {
    const schema = loadSchema(file);
    const validate = ajv.compile(schema);
    const valid = validate(instance);
    console.log(!valid ? `✓ ${name}: Invalid instance rejected` : `✗ ${name}: Should have rejected invalid instance`);
    return !valid;
  } catch (e) {
    console.log(`✗ ${name} validation error: ${e.message}`);
    return false;
  }
}

let allPassed = true;

// Test scene-script
allPassed &= testValid("scene-script", "scene-script.schema.json", {
  version: "1.0.0", projectId: "test-project", platform: "youtube", topic: "Test Topic",
  scenes: [{ sceneId: "scene_001", order: 0, purpose: "hook", narration: "Welcome", visualIntent: "Close up", assetRequirement: "host image", emotionIntent: "curiosity", timing: { status: "PLANNED" } }]
});
allPassed &= testInvalid("scene-script (negative startMs)", "scene-script.schema.json", {
  version: "1.0.0", projectId: "test", platform: "youtube", topic: "Test",
  scenes: [{ sceneId: "scene_001", order: 0, purpose: "hook", narration: "test", visualIntent: "test", assetRequirement: "test", emotionIntent: "test", timing: { status: "MEASURED", startMs: -100 } }]
});

// Test asset-manifest
allPassed &= testValid("asset-manifest", "asset-manifest.schema.json", {
  version: "1.0.0", projectId: "test-project",
  assets: [{ assetId: "asset_001", type: "image", status: "READY", sourceType: "generated", path: "assets/generated/img_001.png", provenance: {}, rights: { status: "VERIFIED" } }]
});
allPassed &= testInvalid("asset-manifest (missing required)", "asset-manifest.schema.json", {
  version: "1.0.0", projectId: "test", assets: [{ assetId: "asset_001" }]
});

// Test audio-manifest
allPassed &= testValid("audio-manifest", "audio-manifest.schema.json", {
  version: "1.0.0", projectId: "test-project",
  tracks: [{ audioId: "audio_001", type: "voice", assetId: "asset_001", status: "READY" }]
});
allPassed &= testInvalid("audio-manifest (invalid type)", "audio-manifest.schema.json", {
  version: "1.0.0", projectId: "test",
  tracks: [{ audioId: "audio_001", type: "invalid-type", assetId: "asset_001", status: "READY" }]
});

// Test captions
allPassed &= testValid("captions", "captions.schema.json", {
  version: "1.0.0", projectId: "test-project", language: "en", timingSource: "STT",
  items: [{ captionId: "cap_001", startMs: 1000, endMs: 3000, text: "Hello world" }]
});
allPassed &= testInvalid("captions (missing required)", "captions.schema.json", {
  version: "1.0.0", projectId: "test", language: "en", timingSource: "STT",
  items: [{ captionId: "cap_001", startMs: 1000 }]
});

// Test media-preflight
allPassed &= testValid("media-preflight (valid READY)", "media-preflight.schema.json", {
  version: "1.0.0", projectId: "test-project", platform: "youtube",
  generatedAt: new Date().toISOString(), status: "READY",
  assets: [{ assetId: "asset_001", sceneId: "scene_001", type: "image", path: "assets/image/scene_001/img.png", exists: true, sourceProvider: "existing", provenanceStatus: "NOT_APPLICABLE", rightsStatus: "VERIFIED", continuityStatus: "NOT_APPLICABLE", structuralStatus: "VALID" }],
  timelineSummary: { assetCount: 1, readyCount: 1, requiredCount: 1, missingRequired: 0, voiceMeasured: false },
  blockingIssues: [],
  warnings: []
});
allPassed &= testInvalid("media-preflight (missing assets)", "media-preflight.schema.json", {
  version: "1.0.0", projectId: "test", platform: "youtube",
  generatedAt: new Date().toISOString(), status: "READY",
  timelineSummary: { assetCount: 0, readyCount: 0, requiredCount: 0, missingRequired: 0, voiceMeasured: false },
  blockingIssues: [],
  warnings: []
});
allPassed &= testInvalid("media-preflight (bad status)", "media-preflight.schema.json", {
  version: "1.0.0", projectId: "test", platform: "youtube",
  generatedAt: new Date().toISOString(), status: "DONE",
  assets: [{ assetId: "asset_001", sceneId: "scene_001", type: "image", path: "assets/x.png", exists: true, sourceProvider: "existing", provenanceStatus: "NOT_APPLICABLE", rightsStatus: "VERIFIED", continuityStatus: "NOT_APPLICABLE", structuralStatus: "VALID" }],
  timelineSummary: { assetCount: 1, readyCount: 1, requiredCount: 0, missingRequired: 0, voiceMeasured: false },
  blockingIssues: [],
  warnings: []
});

// Test audio-mix-plan
allPassed &= testValid("audio-mix-plan (valid PLANNED)", "audio-mix-plan.schema.json", {
  version: "1.0.0", projectId: "test-project",
  tracks: {
    voice: [{ clipId: "clip_v01", path: "assets/voice/s01/v.wav" }],
    music: [],
    sfx: []
  },
  status: "PLANNED"
});
allPassed &= testInvalid("audio-mix-plan (missing tracks)", "audio-mix-plan.schema.json", {
  version: "1.0.0", projectId: "test",
  status: "PLANNED"
});

// Test video-spec
allPassed &= testValid("video-spec", "video-spec.schema.json", {
  version: "1.0.0", project: { id: "test", slug: "test-video", title: "Test Video" }, platform: "youtube",
  composition: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9", durationMode: "content-driven" },
  scenes: [{ sceneId: "scene_001", order: 0, timing: { startMs: 0, endMs: 5000, status: "MEASURED" }, assetIds: ["asset_001"] }],
  globalStyle: {}, render: { compositionId: "main", outputName: "output" }
});
allPassed &= testInvalid("video-spec (width <= 0)", "video-spec.schema.json", {
  version: "1.0.0", project: { id: "test", slug: "test", title: "Test" }, platform: "youtube",
  composition: { width: 0, height: 1080, fps: 30, aspectRatio: "16:9", durationMode: "content-driven" },
  scenes: [{ sceneId: "scene_001", order: 0, timing: { startMs: 0, endMs: 5000, status: "MEASURED" }, assetIds: ["asset_001"] }],
  globalStyle: {}, render: { compositionId: "main", outputName: "output" }
});

// Test topic-registry
allPassed &= testValid("topic-registry (empty)", "topic-registry.schema.json", {
  version: 1, topics: []
});
allPassed &= testValid("topic-registry (valid topic)", "topic-registry.schema.json", {
  version: 1,
  topics: [{
    topicId: "TOPIC-001",
    canonicalTopic: "How Did Ancient Humans Protect Babies From Predators",
    niche: "Ancient Humans",
    subject: "Ancient Human Parenting",
    audienceQuestion: "How did ancient humans protect babies from predators?",
    angle: "Survival strategies and cooperative care",
    corePromise: "Reveal the cooperative strategies ancient humans used to protect infants",
    platforms: {
      youtube: { status: "PUBLISHED", projectId: "proj-001", publishedAt: "2025-01-15T10:00:00Z" }
    },
    createdAt: "2025-01-01T10:00:00Z",
    updatedAt: "2025-01-15T10:00:00Z"
  }]
});
allPassed &= testInvalid("topic-registry (invalid status)", "topic-registry.schema.json", {
  version: 1,
  topics: [{
    topicId: "TOPIC-002",
    canonicalTopic: "Test",
    niche: "Test",
    subject: "Test",
    audienceQuestion: "Test?",
    angle: "Test",
    corePromise: "Test",
    platforms: {
      youtube: { status: "INVALID_STATUS" }
    },
    createdAt: "2025-01-01T10:00:00Z",
    updatedAt: "2025-01-01T10:00:00Z"
  }]
});
allPassed &= testInvalid("topic-registry (missing canonical)", "topic-registry.schema.json", {
  version: 1,
  topics: [{
    topicId: "TOPIC-003",
    niche: "Test",
    subject: "Test",
    audienceQuestion: "Test?",
    angle: "Test",
    corePromise: "Test",
    platforms: { youtube: { status: "DISCOVERED" } },
    createdAt: "2025-01-01T10:00:00Z",
    updatedAt: "2025-01-01T10:00:00Z"
  }]
});

// Test topic-discovery
allPassed &= testValid("topic-discovery (NEW_TOPIC + ALLOW_NEW_TOPIC)", "topic-discovery.schema.json", {
  version: "1.0.0",
  platform: "tiktok",
  niche: "Ancient Humans",
  researchStatus: "PARTIALLY_VERIFIED",
  sources: [],
  candidates: [{
    candidateId: "CAND-001",
    topic: "How Ancient Humans Protected Babies From Predators",
    canonicalTopic: "How Did Ancient Humans Protect Babies From Predators",
    subject: "Ancient Human Parenting",
    audienceQuestion: "How did ancient humans protect babies from predators?",
    corePromise: "Reveal the cooperative strategies ancient humans used to protect infants",
    angle: "Survival strategies and cooperative care",
    audienceReason: "High curiosity about human origins and survival",
    evidenceSummary: "Archaeological evidence of cooperative childcare in early human groups",
    contentGapStatus: "SUPPORTED",
    storyPotential: 2,
    visualPotential: 2,
    productionNotes: "Can use illustrations and narration",
    rightsRisk: "Low - public domain knowledge",
    platformFit: 2,
    duplicateCheck: {
      classification: "NEW_TOPIC",
      decision: "ALLOW_NEW_TOPIC",
      rationale: "No existing topic in registry for this subject/angle on TikTok"
    },
    decision: "GO"
  }],
  selection: {
    status: "SELECTED",
    rationale: "Strong evidence, good platform fit, no duplicate",
    selectedCandidateId: "CAND-001"
  }
});
allPassed &= testValid("topic-discovery (SAME_TOPIC_SAME_ANGLE + BLOCK)", "topic-discovery.schema.json", {
  version: "1.0.0",
  platform: "tiktok",
  niche: "Ancient Humans",
  researchStatus: "PARTIALLY_VERIFIED",
  sources: [],
  candidates: [{
    candidateId: "CAND-002",
    topic: "How Ancient Humans Protected Babies From Predators",
    canonicalTopic: "How Did Ancient Humans Protect Babies From Predators",
    subject: "Ancient Human Parenting",
    audienceQuestion: "How did ancient humans protect babies from predators?",
    corePromise: "Reveal the cooperative strategies ancient humans used to protect infants",
    angle: "Survival strategies and cooperative care",
    audienceReason: "High curiosity about human origins",
    evidenceSummary: "Archaeological evidence",
    contentGapStatus: "SUPPORTED",
    storyPotential: 2,
    visualPotential: 2,
    productionNotes: "Can use illustrations",
    rightsRisk: "Low",
    platformFit: 2,
    duplicateCheck: {
      classification: "SAME_TOPIC_SAME_ANGLE",
      decision: "BLOCK",
      matchedTopicId: "TOPIC-001",
      matchedPlatforms: ["tiktok"],
      rationale: "Same topic and angle already published on TikTok"
    },
    decision: "HOLD"
  }],
  selection: {
    status: "BLOCKED",
    rationale: "Duplicate blocked by registry"
  }
});
allPassed &= testInvalid("topic-discovery (invalid duplicate classification)", "topic-discovery.schema.json", {
  version: "1.0.0",
  platform: "tiktok",
  niche: "Test",
  researchStatus: "NOT_VERIFIED",
  sources: [],
  candidates: [{
    candidateId: "CAND-003",
    topic: "Test",
    canonicalTopic: "Test",
    subject: "Test",
    audienceQuestion: "Test?",
    corePromise: "Test",
    angle: "Test",
    audienceReason: "Test",
    evidenceSummary: "Test",
    contentGapStatus: "UNKNOWN",
    storyPotential: 1,
    visualPotential: 1,
    productionNotes: "Test",
    rightsRisk: "Test",
    platformFit: 1,
    duplicateCheck: {
      classification: "INVALID_CLASS",
      decision: "ALLOW_NEW_TOPIC",
      rationale: "Test"
    },
    decision: "GO"
  }],
  selection: { status: "SELECTED", rationale: "Test" }
});
allPassed &= testInvalid("topic-discovery (missing duplicateCheck)", "topic-discovery.schema.json", {
  version: "1.0.0",
  platform: "tiktok",
  niche: "Test",
  researchStatus: "NOT_VERIFIED",
  sources: [],
  candidates: [{
    candidateId: "CAND-004",
    topic: "Test",
    canonicalTopic: "Test",
    subject: "Test",
    audienceQuestion: "Test?",
    corePromise: "Test",
    angle: "Test",
    audienceReason: "Test",
    evidenceSummary: "Test",
    contentGapStatus: "UNKNOWN",
    storyPotential: 1,
    visualPotential: 1,
    productionNotes: "Test",
    rightsRisk: "Test",
    platformFit: 1,
    decision: "GO"
  }],
  selection: { status: "SELECTED", rationale: "Test" }
});

// Test research-brief
allPassed &= testValid("research-brief (valid ancient humans)", "research-brief.schema.json", {
  version: "1.0.0",
  projectId: "test-ancient-humans",
  topic: "How Ancient Humans Protected Babies From Predators",
  niche: "Ancient Humans",
  researchDate: new Date().toISOString(),
  researchStatus: "READY",
  researchQuestions: {
    coreFactual: ["What predators threatened ancient human infants?", "What archaeological evidence exists for infant protection?"],
    interpretation: ["What do cut marks on infant bones indicate?", "Is there evidence of cooperative childcare?"],
    narrative: ["Why does this matter for understanding human evolution?"]
  },
  sources: [
    {
      sourceId: "SRC-001",
      title: "Schöningen Spears and Infant Protection",
      sourceType: "peer_reviewed",
      author: "Smith et al.",
      publisher: "Journal of Human Evolution",
      publicationDate: "2023-03-15",
      accessDate: "2025-01-15",
      verificationStatus: "VERIFIED",
      qualityNotes: "Peer-reviewed study of Schöningen spears"
    }
  ],
  claims: [
    {
      claimId: "CLM-001",
      statement: "Wooden spears from Schöningen dated to ~300k years ago show evidence of sophisticated hunting technology",
      claimClass: "DIRECT_EVIDENCE",
      sourceIds: ["SRC-001"],
      evidenceStatus: "SUPPORTED",
      scriptUse: "CAN_STATE"
    },
    {
      claimId: "CLM-002",
      statement: "Schöningen spears indicate cooperative hunting behavior in early humans",
      claimClass: "SCHOLARLY_INTERPRETATION",
      sourceIds: ["SRC-001"],
      evidenceStatus: "SUPPORTED",
      caveat: "Interpretation based on spear design and context; not direct observation",
      scriptUse: "STATE_WITH_CAVEAT"
    },
    {
      claimId: "CLM-003",
      statement: "Early humans used spears specifically to defend infants from predators",
      claimClass: "HYPOTHESIS",
      sourceIds: ["SRC-001"],
      evidenceStatus: "MIXED",
      scriptUse: "STATE_WITH_CAVEAT"
    }
  ],
  contradictions: [],
  openQuestions: ["Direct evidence of infant defense behavior is absent from archaeological record"],
  exampleCandidates: [
    {
      exampleId: "EX-001",
      type: "ARTIFACT",
      description: "Schöningen spears (8 wooden throwing spears, ~300k years old)",
      sourceIds: ["SRC-001"],
      relevance: "Demonstrates sophisticated wooden weapon technology available for defense",
      evidenceStatus: "SUPPORTED",
      usageNote: "Visual: show spear reconstruction; label as archaeological reconstruction"
    }
  ],
  handoff: {
    readyForStorytelling: true,
    materialUncertainties: ["No direct evidence of infant-specific defense behavior"],
    recommendedValueAngles: ["evidence_walkthrough", "expert_interpretation", "mechanism"]
  }
});
// Note: UNVERIFIED + CAN_STATE is SCHEMA-VALID but SEMANTICALLY INVALID.
// Layer 1 (JSON Schema) checks shape/type/required fields only.
// Layer 2 (lib/research-quality-check.js) enforces epistemic consistency at editorial gate.
// The semantic layer below MUST reject this combination.
  allPassed &= testValid("research-brief (UNVERIFIED + CAN_STATE - schema valid, semantic check at review)", "research-brief.schema.json", {
    version: "1.0.0",
    projectId: "test",
    topic: "Test",
    researchDate: new Date().toISOString(),
    researchStatus: "READY",
    researchQuestions: { coreFactual: [], interpretation: [], narrative: [] },
    sources: [{ sourceId: "SRC-001", title: "Test Source", sourceType: "general_web", verificationStatus: "NOT_VERIFIED", qualityNotes: "Test" }],
    claims: [
      {
        claimId: "CLM-001",
        statement: "Unverified claim",
        claimClass: "UNVERIFIED",
        sourceIds: ["SRC-001"],
        evidenceStatus: "UNSUPPORTED",
        scriptUse: "CAN_STATE"
      }
    ],
    handoff: { readyForStorytelling: true, materialUncertainties: [], recommendedValueAngles: [] }
  });

// Test content-mode
allPassed &= testValid("content-mode (valid historical-documentary)", "content-mode.schema.json", {
  version: "1.0.0",
  projectId: "test",
  platform: "youtube",
  topic: "Ancient Human Fire Use",
  modeId: "historical-documentary",
  modeLabel: "Historical Documentary",
  rationale: "Evidence-driven narrative with archaeological visual language",
  storyApproach: "Evidence → interpretation → implication",
  hookApproach: "Visual evidence → question → promise",
  visualLanguage: "Archaeological reconstruction style; earth tones; period-accurate artifacts",
  cameraAndMotionDirection: "Slow dolly; static artifact close-ups; minimal kinetic",
  voiceDirection: "Measured, authoritative, warm; emphasis on evidence phrasing",
  musicDirection: "Ambient, period-appropriate; low in mix; supports not leads",
  sfxDirection: "Subtle environmental; fire crackle, wind; no dramatic hits",
  pacingDirection: "Measured; linger on evidence; breathing room between claims",
  transitionDirection: "Slow crossfades; match cuts on artifacts; no hard cuts",
  typographyDirection: "Serif headings; clean sans body; minimal animation",
  captionDirection: "Burn-in bottom; 2 lines max; evidence labels",
  emotionalArcMode: "STRONG"
});
allPassed &= testValid("content-mode (valid technical-explainer)", "content-mode.schema.json", {
  version: "1.0.0",
  projectId: "test",
  platform: "youtube",
  topic: "React Server Components",
  modeId: "technical-explainer",
  modeLabel: "Technical Explainer",
  rationale: "Problem-solution structure with code demonstration",
  storyApproach: "Problem → explanation → demo → resolution",
  hookApproach: "Problem statement → live demo promise",
  visualLanguage: "Code editor, browser, diagrams; clean modern UI; syntax highlighting",
  cameraAndMotionDirection: "Screen capture; zoom on code; diagram animations",
  voiceDirection: "Instructional, clear, steady pace; emphasis on key concepts",
  musicDirection: "Minimal; optional subtle ambient; never leads",
  sfxDirection: "Subtle UI clicks; keyboard sounds; no dramatic effects",
  pacingDirection: "Steady instructional; pause for code reading; faster on boilerplate",
  transitionDirection: "Hard cuts between sections; smooth zoom on code",
  typographyDirection: "Monospace code; clean sans UI; syntax highlighting",
  captionDirection: "Code annotations; separate SRT; key terms highlighted",
  emotionalArcMode: "LIGHT"
});
allPassed &= testValid("content-mode (custom mode ID)", "content-mode.schema.json", {
  version: "1.0.0",
  projectId: "test",
  platform: "tiktok",
  topic: "Custom Topic",
  modeId: "my-custom-mode",
  modeLabel: "My Custom Mode",
  rationale: "Custom mode for unique topic",
  storyApproach: "Custom",
  hookApproach: "Custom",
  visualLanguage: "Custom",
  cameraAndMotionDirection: "Custom",
  voiceDirection: "Custom",
  musicDirection: "Custom",
  sfxDirection: "Custom",
  pacingDirection: "Custom",
  transitionDirection: "Custom",
  typographyDirection: "Custom",
  captionDirection: "Custom",
  emotionalArcMode: "ADAPTIVE"
});
allPassed &= testInvalid("content-mode (invalid emotionalArcMode)", "content-mode.schema.json", {
  version: "1.0.0",
  projectId: "test",
  platform: "youtube",
  topic: "Test",
  modeId: "test-mode",
  modeLabel: "Test",
  rationale: "Test",
  storyApproach: "Test",
  hookApproach: "Test",
  visualLanguage: "Test",
  cameraAndMotionDirection: "Test",
  voiceDirection: "Test",
  musicDirection: "Test",
  sfxDirection: "Test",
  pacingDirection: "Test",
  transitionDirection: "Test",
  typographyDirection: "Test",
  captionDirection: "Test",
  emotionalArcMode: "INVALID_MODE"
});
allPassed &= testInvalid("content-mode (missing visualLanguage)", "content-mode.schema.json", {
  version: "1.0.0",
  projectId: "test",
  platform: "youtube",
  topic: "Test",
  modeId: "test-mode",
  modeLabel: "Test",
  rationale: "Test",
  storyApproach: "Test",
  hookApproach: "Test",
  cameraAndMotionDirection: "Test",
  voiceDirection: "Test",
  musicDirection: "Test",
  sfxDirection: "Test",
  pacingDirection: "Test",
  transitionDirection: "Test",
  typographyDirection: "Test",
  captionDirection: "Test",
  emotionalArcMode: "LIGHT"
});

// Test context-manifest
allPassed &= testValid("context-manifest (valid stage 3A)", "context-manifest.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  stage: "3A",
  platform: "tiktok",
  generatedAt: new Date().toISOString(),
  required: ["AGENTS.md", "core/WORKFLOW.md", "core/CONTEXT_ROUTER.md", "core/TOPIC_DISCOVERY.md"],
  conditional: ["web/current discovery sources"],
  loaded: [{ path: "AGENTS.md", purpose: "Router", loadStatus: "LOADED" }],
  missingRequired: []
});
allPassed &= testInvalid("context-manifest (missing stage)", "context-manifest.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  platform: "tiktok",
  generatedAt: new Date().toISOString(),
  required: [],
  conditional: [],
  loaded: [],
  missingRequired: []
});

// Test policy-snapshot
allPassed &= testValid("policy-snapshot (valid youtube)", "policy-snapshot.schema.json", {
  version: "1.0.0",
  snapshotId: "SNAP-YT-001",
  platform: "youtube",
  categories: ["ai-transparency", "rights"],
  verifiedAt: new Date().toISOString(),
  verificationStatus: "SNAPSHOT_ONLY",
  sourceRefs: ["YT-AI-DISCLOSURE", "YT-COPYRIGHT"],
  normalizedRulesVersion: "2026-09-25.v1",
  rules: [{
    ruleId: "YT-AI-001",
    axis: "AI_TRANSPARENCY",
    category: "ai-transparency",
    summary: "Realistic GenAI depicting person/event/scene requires disclosure",
    decisionLogic: "realistic && (depictsRealPerson || altersRealFootage || generatesRealisticScene) => REQUIRED",
    sourceIds: ["YT-AI-DISCLOSURE"]
  }]
});
allPassed &= testInvalid("policy-snapshot (bad axis)", "policy-snapshot.schema.json", {
  version: "1.0.0",
  snapshotId: "SNAP-BAD",
  platform: "youtube",
  categories: ["ai-transparency"],
  verifiedAt: new Date().toISOString(),
  verificationStatus: "SNAPSHOT_ONLY",
  sourceRefs: ["YT-AI-DISCLOSURE"],
  normalizedRulesVersion: "2026-09-25.v1",
  rules: [{
    ruleId: "BAD-001",
    axis: "SINGLE_BOOLEAN",
    category: "ai-transparency",
    summary: "Collapsed axis must be rejected",
    decisionLogic: "policyPass => true",
    sourceIds: ["YT-AI-DISCLOSURE"]
  }]
});

// Test policy-review
allPassed &= testValid("policy-review (valid pre-final)", "policy-review.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  platform: "youtube",
  gate: "PRE_FINAL",
  policySnapshotId: "SNAP-YT-001",
  policyVerification: "SNAPSHOT_ONLY",
  axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "REVIEW_REQUIRED", MONETIZATION_AD_SUITABILITY: "REVIEW_REQUIRED" },
  rights: { decision: "VERIFIED", sourceType: "ORIGINAL" },
  aiDisclosure: { decision: "REQUIRED", userAction: "Complete platform AI disclosure/label action before upload" },
  likeness: { decision: "NOT_APPLICABLE" },
  originality: { risk: "LOW_RISK" },
  reconstruction: { classification: "RECONSTRUCTION", labeledAsReconstruction: true },
  issues: [],
  handoff: { status: "PUBLISH_REVIEW_REQUIRED", requiredUserActions: ["Complete platform AI disclosure/label action before upload"] }
});
allPassed &= testInvalid("policy-review (missing axis)", "policy-review.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  platform: "youtube",
  gate: "PRE_FINAL",
  policySnapshotId: "SNAP-YT-001",
  policyVerification: "SNAPSHOT_ONLY",
  axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "PASS" },
  rights: { decision: "VERIFIED", sourceType: "ORIGINAL" },
  aiDisclosure: { decision: "NOT_REQUIRED" },
  likeness: { decision: "NOT_APPLICABLE" },
  originality: { risk: "LOW_RISK" },
  reconstruction: { classification: "NOT_APPLICABLE" },
  issues: [],
  handoff: { status: "PUBLISH_READY" }
});

// Test provider-request
allPassed &= testValid("provider-request (valid image)", "provider-request.schema.json", {
  version: "1.0.0",
  requestId: "REQ-001",
  projectId: "test-project",
  sceneId: "S01",
  capability: "image",
  input: { prompt: "TEST-ONLY prompt" },
  outputRequirements: { format: "png", width: 1920, height: 1080 },
  creativeContext: { contentModeSummary: "historical-documentary", creativeDirectionVersion: "cd-1", visualBibleVersion: "vb-1" },
  continuityContext: { requiredEntities: ["CHAR_MOTHER_01"], continuityStrictness: "STRICT" },
  attempt: 1
});
allPassed &= testInvalid("provider-request (bad capability)", "provider-request.schema.json", {
  version: "1.0.0",
  requestId: "REQ-002",
  projectId: "test-project",
  sceneId: "S01",
  capability: "hologram",
  input: {},
  outputRequirements: {}
});

// Test provider-result
allPassed &= testValid("provider-result (valid READY)", "provider-result.schema.json", {
  version: "1.0.0",
  requestId: "REQ-001",
  projectId: "test-project",
  sceneId: "S01",
  capability: "image",
  providerId: "existing",
  status: "READY",
  artifactPath: "assets/image/S01/existing.png",
  sourceType: "existing",
  provenanceNote: "Reused existing project artifact",
  rightsStatus: "NOT_APPLICABLE",
  costClass: "ZERO_LOCAL"
});
allPassed &= testInvalid("provider-result (bad status)", "provider-result.schema.json", {
  version: "1.0.0",
  requestId: "REQ-002",
  projectId: "test-project",
  sceneId: "S01",
  capability: "image",
  providerId: "existing",
  status: "DONE",
  sourceType: "existing",
  provenanceNote: "x",
  rightsStatus: "NOT_APPLICABLE",
  costClass: "ZERO_LOCAL"
});

// Test continuity-registry
allPassed &= testValid("continuity-registry (valid locked)", "continuity-registry.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  visualBibleVersion: "vb-1",
  entities: [{
    entityId: "CHAR_MOTHER_01",
    type: "CHARACTER",
    name: "Test mother",
    description: "TEST-ONLY character",
    lockStatus: "LOCKED",
    referenceAssets: [{ assetId: "REF-MASTER", path: "continuity/characters/master.png", role: "MASTER", status: "APPROVED" }],
    attributes: {}
  }],
  relationships: [],
  lockStatus: "LOCKED"
});
allPassed &= testInvalid("continuity-registry (bad entity type)", "continuity-registry.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  visualBibleVersion: "vb-1",
  entities: [{
    entityId: "X-01",
    type: "VEHICLE",
    name: "x",
    description: "x",
    lockStatus: "DRAFT",
    referenceAssets: [],
    attributes: {}
  }],
  relationships: [],
  lockStatus: "DRAFT"
});

// Test approved-local
allPassed &= testValid("approved-local (valid library)", "approved-local.schema.json", {
  version: "1.0.0",
  assets: [{ assetId: "LIB-001", path: "assets/approved-local/music/x.wav", type: "music", rightsStatus: "VERIFIED" }]
});
allPassed &= testInvalid("approved-local (missing rights)", "approved-local.schema.json", {
  version: "1.0.0",
  assets: [{ assetId: "LIB-002", path: "assets/approved-local/music/y.wav", type: "music" }]
});

// Test duration-contract
allPassed &= testValid("duration-contract (valid FIT)", "duration-contract.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  platform: "youtube",
  durationMode: "FLEXIBLE_TARGET",
  userTarget: { minMs: 480000, preferredMs: 600000, maxMs: 720000 },
  contentCapacity: { status: "SUFFICIENT", recommendedMinMs: 540000, recommendedMaxMs: 660000, basis: "core claims + mechanism + walkthrough", coverage: "TEST-ONLY" },
  workingDuration: { minMs: 540000, preferredMs: 600000, maxMs: 660000, derivedFrom: "target-capacity-overlap", confidence: "HIGH" },
  scriptBudget: { estimatedWordsMin: 1300, estimatedWordsMax: 1650, estimatedNarrationMs: 600000, speakingRateAssumption: "140-160 wpm", rateSource: "content-mode default", timingStatus: "PLANNED" },
  policy: { allowScopeExpansion: false, fillerForbidden: true },
  status: "FIT"
});
allPassed &= testInvalid("duration-contract (bad mode)", "duration-contract.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  platform: "youtube",
  durationMode: "EXACT_SECONDS",
  contentCapacity: { status: "SUFFICIENT", recommendedMinMs: 540000, recommendedMaxMs: 660000, basis: "x", coverage: "x" },
  workingDuration: { minMs: 540000, preferredMs: 600000, maxMs: 660000, derivedFrom: "x", confidence: "HIGH" },
  scriptBudget: { estimatedWordsMin: 1, estimatedWordsMax: 2, estimatedNarrationMs: 600000, speakingRateAssumption: "x", rateSource: "x", timingStatus: "PLANNED" },
  policy: { allowScopeExpansion: false, fillerForbidden: true },
  status: "FIT"
});

// Test scene-script duration references (additive; existing instances still pass)
allPassed &= testValid("scene-script (with duration refs)", "scene-script.schema.json", {
  version: "1.0.0", projectId: "test-project", platform: "youtube", topic: "Test Topic",
  durationContractVersion: "1.0.0",
  workingDurationMs: { minMs: 540000, preferredMs: 600000, maxMs: 660000 },
  scriptTimingSummary: { estimatedNarrationMs: 600000, timingStatus: "PLANNED" },
  scenes: [{ sceneId: "scene_001", order: 0, purpose: "hook", narration: "Welcome", visualIntent: "Close up", assetRequirement: "host image", emotionIntent: "curiosity", timing: { status: "PLANNED" } }]
});

// Test video-spec duration separation (target vs estimated vs measured actual)
allPassed &= testValid("video-spec (measured with target+estimated)", "video-spec.schema.json", {
  version: "1.0.0", project: { id: "test", slug: "test-video", title: "Test Video" }, platform: "youtube",
  composition: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9", durationMode: "content-driven", targetDurationMs: 600000, estimatedDurationMs: 590000, durationMs: 479000, durationSource: "MEASURED_TIMELINE" },
  scenes: [{ sceneId: "scene_001", order: 0, timing: { startMs: 0, endMs: 5000, status: "MEASURED" }, assetIds: ["asset_001"] }],
  globalStyle: {}, render: { compositionId: "main", outputName: "output" }
});
allPassed &= testInvalid("video-spec (measured source without durationMs)", "video-spec.schema.json", {
  version: "1.0.0", project: { id: "test", slug: "test", title: "Test" }, platform: "youtube",
  composition: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9", durationMode: "content-driven", durationSource: "MEASURED_TIMELINE" },
  scenes: [{ sceneId: "scene_001", order: 0, timing: { startMs: 0, endMs: 5000, status: "MEASURED" }, assetIds: ["asset_001"] }],
  globalStyle: {}, render: { compositionId: "main", outputName: "output" }
});

// Test flow-job
allPassed &= testValid("flow-job (valid video)", "flow-job.schema.json", {
  version: "1.0.0",
  jobId: "FLOW-S05-A01",
  requestId: "REQ-001",
  projectId: "test-project",
  sceneId: "S05",
  capability: "video",
  mode: "ASSISTED_APPROVAL",
  prompt: "TEST-ONLY prompt",
  platform: "youtube",
  flowProject: { mode: "REUSE", displayName: "UNFOLDIQ — test-project" },
  outputRequirements: { aspectRatio: "16:9" },
  creativeContext: { contentModeSummary: "historical-documentary" },
  continuityContext: { strictness: "STRICT", requiredEntities: ["CHAR_MOTHER_01"], referenceAssetIds: ["REF_MOTHER_MASTER"] },
  expectedOutputPath: "assets/video/S05/S05_attempt-01.mp4",
  status: "PREPARED",
  attempt: 1
});
allPassed &= testInvalid("flow-job (bad mode)", "flow-job.schema.json", {
  version: "1.0.0",
  jobId: "FLOW-X",
  requestId: "REQ-002",
  projectId: "test-project",
  sceneId: "S05",
  capability: "video",
  mode: "FULL_AUTO",
  prompt: "TEST-ONLY prompt",
  platform: "youtube",
  flowProject: { mode: "REUSE" },
  outputRequirements: {},
  creativeContext: {},
  expectedOutputPath: "assets/video/S05/S05_attempt-01.mp4",
  status: "PREPARED",
  attempt: 1
});

// Test safety-prompt-adaptation
allPassed &= testValid("safety-adaptation (valid Level 2)", "safety-prompt-adaptation.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  sceneId: "S05",
  jobId: "FLOW-S05-A01",
  refusalClass: "MINOR_SAFETY",
  originalPrompt: "TEST-ONLY original prompt",
  adaptedPrompt: "TEST-ONLY distant non-graphic reframe preserving intent",
  originalSceneIntent: "the group protects vulnerable members from danger",
  preservedClaims: ["CLM-001"],
  preservedContinuity: ["CHAR_MOTHER_01"],
  removedOrChangedElements: ["direct depiction → silhouette/distance"],
  adaptationLevel: 2,
  reason: "MINOR_SAFETY: Level 2 INDIRECT_VISUALIZATION",
  policyDecision: "ALLOW_ADAPTED_RETRY",
  attempt: 2,
  requiresApproval: true
});
allPassed &= testInvalid("safety-adaptation (bad decision)", "safety-prompt-adaptation.schema.json", {
  version: "1.0.0",
  projectId: "test-project",
  sceneId: "S05",
  jobId: "FLOW-S05-A01",
  refusalClass: "MINOR_SAFETY",
  originalPrompt: "TEST-ONLY original prompt",
  adaptedPrompt: "TEST-ONLY adapted prompt",
  originalSceneIntent: "test intent",
  preservedClaims: [],
  preservedContinuity: [],
  removedOrChangedElements: [],
  adaptationLevel: 2,
  reason: "x",
  policyDecision: "EVADE_FILTER",
  attempt: 2,
  requiresApproval: true
});

// Test render-input
allPassed &= testValid("render-input (valid step12 fixture)", "render-input.schema.json",
  require("../../tests/fixtures/render-input-step12.json"));
allPassed &= testInvalid("render-input (empty scenes)", "render-input.schema.json", {
  version: "1.0.0", projectId: "test", platform: "youtube",
  composition: { id: "UNFOLDIQVideo", width: 640, height: 360, fps: 30, durationMs: 1000, durationInFrames: 30, background: "#000000", outputName: "test" },
  timeline: { actualTimelineEndMs: 1000, sources: [] },
  scenes: [],
  assets: { A1: { assetId: "A1", type: "image", stagedPath: "unfoldiq/test/h/img.png", staticFilePath: "unfoldiq/test/h/img.png" } },
  audio: { voice: [], music: [], sfx: [], generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO" },
  captions: { mode: "NONE", items: [] },
  visualSystem: { background: "#0b0e14", foreground: "#f5f7fa", muted: "#8a93a6", accent: "#4da3ff", fontFamily: "system-ui, sans-serif", titleSize: 64, bodySize: 32, captionSize: 28, cornerRadius: 8, spacing: 16, overlayOpacity: 0.55 },
  provenance: { preflightVersion: "1.0.0", timelineHash: "a", assetManifestHash: "b", audioMixHash: "c", captionsHash: "d", visualBibleVersion: "vb-1", continuityRegistryVersion: "1.0.0", durationContractVersion: "1.0.0", platformProfileVersion: "1.0.0", remotionVersions: {} },
  status: "READY"
});

// Test render-plan
allPassed &= testValid("render-plan (valid minimal)", "render-plan.schema.json", {
  version: "1.0.0", projectId: "test", platform: "youtube",
  generatedAt: new Date().toISOString(),
  composition: { id: "UNFOLDIQVideo", width: 640, height: 360, fps: 30, durationMs: 1000, durationInFrames: 30, background: "#000000", outputName: "test" },
  scenes: [{ sceneId: "s1", startFrame: 0, endFrame: 30, layers: [{ layerId: "s1_bg", kind: "BACKGROUND", startFrame: 0, endFrame: 30 }] }],
  audioTracks: { voice: [], music: [], sfx: [] },
  captionTrack: { mode: "NONE", frames: [] },
  assetMap: { A1: { assetId: "A1", stagedPath: "unfoldiq/test/h/img.png", staticFilePath: "unfoldiq/test/h/img.png" } },
  styleTokens: {},
  validation: { preflightStatus: "READY", timelineStatus: "MEASURED", checks: [{ name: "render-input-check", status: "READY" }] },
  planHash: "0123456789abcdef",
  status: "READY"
});
allPassed &= testInvalid("render-plan (missing planHash)", "render-plan.schema.json", {
  version: "1.0.0", projectId: "test", platform: "youtube",
  generatedAt: new Date().toISOString(),
  composition: { id: "UNFOLDIQVideo", width: 640, height: 360, fps: 30, durationMs: 1000, durationInFrames: 30, background: "#000000", outputName: "test" },
  scenes: [{ sceneId: "s1", startFrame: 0, endFrame: 30, layers: [{ layerId: "s1_bg", kind: "BACKGROUND", startFrame: 0, endFrame: 30 }] }],
  audioTracks: { voice: [], music: [], sfx: [] },
  captionTrack: { mode: "NONE", frames: [] },
  assetMap: { A1: { assetId: "A1", stagedPath: "unfoldiq/test/h/img.png", staticFilePath: "unfoldiq/test/h/img.png" } },
  styleTokens: {},
  validation: { preflightStatus: "READY", timelineStatus: "MEASURED", checks: [] },
  status: "READY"
});

// Test staging-manifest
allPassed &= testValid("staging-manifest (valid single entry)", "staging-manifest.schema.json", {
  version: "1.0.0", projectId: "test",
  generatedAt: new Date().toISOString(),
  root: "remotion/public/unfoldiq",
  entries: [{ assetId: "A1", sourcePath: "assets/img.png", stagedPath: "unfoldiq/test/ab12cd34/img.png", staticFilePath: "unfoldiq/test/ab12cd34/img.png", contentHash: "ab12", size: 10, type: "image" }]
});
allPassed &= testInvalid("staging-manifest (missing entries)", "staging-manifest.schema.json", {
  version: "1.0.0", projectId: "test",
  generatedAt: new Date().toISOString(),
  root: "remotion/public/unfoldiq"
});

// Test pipeline-state
allPassed &= testValid("pipeline-state (valid NEW skeleton)", "pipeline-state.schema.json", {
  version: "1.0.0", projectId: "test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  status: "NEW", currentStage: null, inputFingerprint: null, checkpoints: {}, attempts: [], qa: null,
  issues: [], blockers: [], history: [{ at: new Date().toISOString(), event: "STATE_INITIALIZED" }]
});
allPassed &= testInvalid("pipeline-state (bad status)", "pipeline-state.schema.json", {
  version: "1.0.0", projectId: "test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  status: "DONE", currentStage: null, inputFingerprint: null, checkpoints: {}, attempts: [], qa: null,
  issues: [], blockers: [], history: []
});

// Test render-attempt
allPassed &= testValid("render-attempt (valid PENDING)", "render-attempt.schema.json", {
  attemptId: "attempt-001", projectId: "test", number: 1,
  inputFingerprint: { fingerprintId: "0123456789abcdef" }, renderPlanHash: "abcdef0123456789",
  startedAt: new Date().toISOString(), status: "PENDING",
  outputPath: "render/attempts/attempt-001/output.mp4", renderConfig: { codec: "h264", concurrency: 2 },
  progress: { fraction: 0, renderedFrames: 0, encodedFrames: 0, stitchStage: "PENDING", updatedAt: new Date().toISOString() },
  artifacts: []
});
allPassed &= testInvalid("render-attempt (bad attemptId)", "render-attempt.schema.json", {
  attemptId: "001", projectId: "test", number: 1,
  inputFingerprint: {}, renderPlanHash: "abc",
  startedAt: new Date().toISOString(), status: "PENDING",
  outputPath: "render/attempts/attempt-001/output.mp4", renderConfig: {},
  progress: { fraction: 0, renderedFrames: 0, encodedFrames: 0, stitchStage: "PENDING", updatedAt: new Date().toISOString() },
  artifacts: []
});

// Test fix-plan
allPassed &= testValid("fix-plan (valid SAFE_AUTOMATIC)", "fix-plan.schema.json", {
  version: "1.0.0", projectId: "test", attemptId: "attempt-001",
  issues: [{ issueId: "ISS-001", category: "CAPTION_READABILITY", severity: "WARNING", status: "OPEN", note: "caption too long" }],
  actions: [{ actionId: "ACT-001", type: "REGROUP_CAPTIONS", target: "captionTrack", reason: "line length", reversible: true }],
  riskClass: "SAFE_AUTOMATIC", requiresApproval: false, createdAt: new Date().toISOString()
});
allPassed &= testInvalid("fix-plan (bad riskClass)", "fix-plan.schema.json", {
  version: "1.0.0", projectId: "test", attemptId: "attempt-001",
  issues: [], actions: [],
  riskClass: "AUTO", requiresApproval: false, createdAt: new Date().toISOString()
});

// Test render-qa
allPassed &= testValid("render-qa (valid PASS)", "render-qa.schema.json", {
  version: "1.0.0", projectId: "test", attemptId: "attempt-001", generatedAt: new Date().toISOString(),
  checks: [{ check: "duration", result: "PASS", detail: "within tolerance" }],
  summary: { pass: 1, fail: 0, review: 0, unknown: 0 },
  duration: { expectedMs: 1000, actualMs: 1005, deltaMs: 5, toleranceMs: 100, result: "PASS" },
  status: "PASS", reviewState: "MACHINE_CHECKED"
});
allPassed &= testInvalid("render-qa (bad check result)", "render-qa.schema.json", {
  version: "1.0.0", projectId: "test", attemptId: "attempt-001", generatedAt: new Date().toISOString(),
  checks: [{ check: "duration", result: "OK", detail: "x" }],
  summary: { pass: 1, fail: 0, review: 0, unknown: 0 },
  duration: { expectedMs: 1000, actualMs: 1000, deltaMs: 0, toleranceMs: 100, result: "PASS" },
  status: "PASS", reviewState: "MACHINE_CHECKED"
});

// Test visual-review
allPassed &= testValid("visual-review (valid APPROVE)", "visual-review.schema.json", {
  version: "1.0.0", projectId: "test", attemptId: "attempt-001", reviewer: "agent",
  reviewedAt: new Date().toISOString(), decision: "APPROVE", issues: []
});
allPassed &= testInvalid("visual-review (bad reviewer)", "visual-review.schema.json", {
  version: "1.0.0", projectId: "test", attemptId: "attempt-001", reviewer: "robot",
  reviewedAt: new Date().toISOString(), decision: "APPROVE", issues: []
});

// Test final-artifact
allPassed &= testValid("final-artifact (valid accepted)", "final-artifact.schema.json", {
  version: "1.0.0", projectId: "test", acceptedAttemptId: "attempt-001",
  outputPath: "render/attempts/attempt-001/output.mp4", sizeBytes: 12345,
  checksum: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  durationMs: 1000, width: 640, height: 360, fps: 30, codec: "h264",
  audio: { present: true, streams: 1 }, captions: {},
  renderPlanHash: "abcdef0123456789", inputFingerprint: { fingerprintId: "0123456789abcdef" },
  qaStatus: "PASS", generatedAt: new Date().toISOString(),
  provenance: { platformProfileVersion: "1.0.0", remotionVersions: {} }
});
allPassed &= testInvalid("final-artifact (bad checksum)", "final-artifact.schema.json", {
  version: "1.0.0", projectId: "test", acceptedAttemptId: "attempt-001",
  outputPath: "render/attempts/attempt-001/output.mp4", sizeBytes: 12345,
  checksum: "zzz",
  durationMs: 1000, width: 640, height: 360, fps: 30, codec: "h264",
  audio: { present: true }, captions: {},
  renderPlanHash: "abcdef0123456789", inputFingerprint: {},
  qaStatus: "PASS", generatedAt: new Date().toISOString(),
  provenance: { platformProfileVersion: "1.0.0", remotionVersions: {} }
});

// Test creative-brief (V6 lightweight delta)
allPassed &= testValid("creative-brief (valid minimal)", "creative-brief.schema.json", {
  version: "1.0.0", briefId: "cb-001", audience: "general", platform: "youtube"
});
allPassed &= testValid("creative-brief (valid full)", "creative-brief.schema.json", {
  version: "1.0.0", briefId: "cb-002", projectId: "p1", audience: "beginners",
  knowledgeLevel: "beginner", platform: "tiktok", videoType: "explainer",
  targetDuration: "60-90s", viewerPromise: "understand X", primaryLearningGoal: "grasp X",
  contentDensity: "balanced"
});
allPassed &= testInvalid("creative-brief (bad platform)", "creative-brief.schema.json", {
  version: "1.0.0", briefId: "cb-003", audience: "general", platform: "reels"
});

// Test research-plan creativeBriefRef (V6 additive link, backward compatible)
allPassed &= testValid("research-plan (with creativeBriefRef)", "research-plan.schema.json", {
  version: "1.0.0", projectId: "p1", topic: "T", researchGoal: "Establish documented evidence for T.",
  contentClass: "FACTUAL", criticalQuestions: ["What is documented about T?"],
  creativeBriefRef: { briefId: "cb-002", briefHash: "abcdef123456", briefVersion: "1.0.0" }
});
allPassed &= testInvalid("research-plan (bad creativeBriefRef)", "research-plan.schema.json", {
  version: "1.0.0", projectId: "p1", topic: "T", researchGoal: "Establish documented evidence for T.",
  contentClass: "FACTUAL", criticalQuestions: ["What is documented about T?"],
  creativeBriefRef: { briefId: "cb-002" }
});

// Test source-index
allPassed &= testValid("source-index (valid record)", "source-index.schema.json", {
  version: "1.0.0", projectId: "p1",
  sources: [{
    sourceId: "src-0123456789ab", requestedUrl: "https://example.com/a",
    canonicalUrl: "https://example.com/a", finalUrl: "https://example.com/a",
    retrievedAt: new Date().toISOString(), sourceType: "UNKNOWN",
    independenceStatus: "UNKNOWN", contentHash: "abc12345", currentVersionHash: "abc12345",
    versions: [{ contentHash: "abc12345", retrievedAt: new Date().toISOString(), rawContentRef: "research/sources/src-0123456789ab/v-abc12345.md" }],
    acquisitionRoute: "crawl4ai-direct", acquisitionWarnings: []
  }]
});
allPassed &= testInvalid("source-index (bad sourceId)", "source-index.schema.json", {
  version: "1.0.0", projectId: "p1",
  sources: [{
    sourceId: "nope", requestedUrl: "https://example.com/a",
    canonicalUrl: "https://example.com/a", finalUrl: "https://example.com/a",
    retrievedAt: new Date().toISOString(), sourceType: "UNKNOWN",
    independenceStatus: "UNKNOWN", contentHash: "abc12345", currentVersionHash: "abc12345",
    versions: [{ contentHash: "abc12345", retrievedAt: new Date().toISOString(), rawContentRef: "r" }],
    acquisitionRoute: "crawl4ai-direct", acquisitionWarnings: []
  }]
});

// Test evidence-state (claims / contradictions / unknowns / sufficiency files)
allPassed &= testValid("evidence-state (claims file)", "evidence-state.schema.json", {
  version: "1.0.0", projectId: "p1",
  claims: [{
    claimId: "clm-0123456789ab", claim: "X is documented.",
    claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED",
    corroborationStatus: "SINGLE_SOURCE", materiality: "medium",
    supportingEvidence: [{ sourceId: "src-0123456789ab", contentHash: "abc12345", excerpt: "short locator text" }]
  }]
});
allPassed &= testValid("evidence-state (sufficiency file)", "evidence-state.schema.json", {
  version: "1.0.0", projectId: "p1",
  evaluation: { decision: "NEEDS_MORE_RESEARCH", rationale: "one critical question open", policyVersion: "1.0.0", evaluatedAt: new Date().toISOString() }
});
allPassed &= testInvalid("evidence-state (bad claim enum)", "evidence-state.schema.json", {
  version: "1.0.0", projectId: "p1",
  claims: [{
    claimId: "clm-0123456789ab", claim: "X.", claimClass: "PROVEN_FACT",
    evidenceStatus: "SUPPORTED", corroborationStatus: "SINGLE_SOURCE", materiality: "low"
  }]
});

// Test story-handoff (pack / policy / brief / draft / audit files)
allPassed &= testValid("story-handoff (pack file)", "story-handoff.schema.json", {
  packId: "pack-0123456789ab", packVersion: "1.0.0", packHash: "abcdef1234567890",
  contentClass: "FACTUAL", generatedAt: new Date().toISOString(),
  verifiedFacts: [{
    claimId: "clm-0123456789ab", statement: "X is documented.",
    sourceIds: ["src-0123456789ab"], contentHashes: ["abc12345"],
    evidenceStatus: "SUPPORTED", corroborationStatus: "MULTI_SOURCE_CONFIRMED", claimClass: "SUPPORTED_FACT",
  }],
  sourceRefs: [{ sourceId: "src-0123456789ab", url: "https://example.com/a", sourceType: "OFFICIAL", independenceStatus: "INDEPENDENT", contentHash: "abc12345" }],
});
allPassed &= testValid("story-handoff (draft + audit files)", "story-handoff.schema.json", {
  draftId: "drf-0123456789ab", draftVersion: "1.0.0", contentClass: "FACTUAL",
  narrativeBriefRef: { briefId: "nb-001" }, generatedAt: new Date().toISOString(),
  sections: [{ sectionId: "hook", draftText: "Why does this matter?", claimRefs: ["clm-0123456789ab"] }],
});
allPassed &= testValid("story-handoff (narrative file)", "story-handoff.schema.json", {
  briefId: "nb-0123456789ab", briefVersion: "1.0.0", contentClass: "FACTUAL",
  coreViewerQuestion: "Why?", editorialAngle: "Angle.",
  narrativeProgression: [{ stepId: "hook", purpose: "open", claimIds: [] }],
  selectedClaimIds: [],
});
allPassed &= testInvalid("story-handoff (draft empty sections)", "story-handoff.schema.json", {
  draftId: "drf-0123456789ab", draftVersion: "1.0.0", contentClass: "FACTUAL",
  narrativeBriefRef: { briefId: "nb-001" }, sections: [],
});

console.log("\n=== Semantic Validation Layer (lib/research-quality-check.js) ===");console.log("Layer 1 = JSON Schema (shape/type). Layer 2 = Semantic (epistemic consistency).\n");

function testSemantic(name, briefOrClaim, expectValid, isBrief = true) {
  const result = isBrief
    ? validateResearchBriefSemantics(briefOrClaim)
    : validateClaimSemantics(briefOrClaim);
  const pass = result.valid === expectValid;
  const codes = (result.errors || []).map((e) => e.code).join(",") || "none";
  console.log(
    pass
      ? `✓ ${name}: semantic valid=${result.valid} (expected ${expectValid}) errors=[${codes}]`
      : `✗ ${name}: semantic valid=${result.valid} (expected ${expectValid}) errors=[${codes}]`
  );
  return pass;
}

function mkBrief(claim, ready = true) {
  return {
    version: "1.0.0",
    projectId: "test-sem",
    topic: "Semantic Test",
    researchDate: new Date().toISOString(),
    researchStatus: "READY",
    researchQuestions: { coreFactual: [], interpretation: [], narrative: [] },
    sources: [{ sourceId: "SRC-001", title: "T", sourceType: "general_web", verificationStatus: "NOT_VERIFIED", qualityNotes: "T" }],
    claims: [claim],
    handoff: { readyForStorytelling: ready, materialUncertainties: [], recommendedValueAngles: [] },
  };
}

// S1 SUPPORTED_FACT + SUPPORTED + CAN_STATE -> PASS
allPassed &= testSemantic("S1 Supported fact", mkBrief({ claimId: "S1", statement: "Established fact", claimClass: "SUPPORTED_FACT", sourceIds: ["SRC-001"], evidenceStatus: "SUPPORTED", scriptUse: "CAN_STATE" }, false), true);
// S2 UNVERIFIED + CAN_STATE -> REJECT
allPassed &= testSemantic("S2 UNVERIFIED CAN_STATE", mkBrief({ claimId: "S2", statement: "Unverified", claimClass: "UNVERIFIED", sourceIds: ["SRC-001"], evidenceStatus: "WEAK", scriptUse: "CAN_STATE" }, false), false);
// S3 SUPPORTED_FACT + UNSUPPORTED + CAN_STATE -> REJECT
allPassed &= testSemantic("S3 Unsupported CAN_STATE", mkBrief({ claimId: "S3", statement: "No evidence", claimClass: "SUPPORTED_FACT", sourceIds: ["SRC-001"], evidenceStatus: "UNSUPPORTED", scriptUse: "CAN_STATE" }, false), false);
// S4 HYPOTHESIS + STATE_WITH_CAVEAT -> PASS
allPassed &= testSemantic("S4 Hypothesis caveated", mkBrief({ claimId: "S4", statement: "Hypothesis", claimClass: "HYPOTHESIS", sourceIds: ["SRC-001"], evidenceStatus: "MIXED", scriptUse: "STATE_WITH_CAVEAT" }, false), true);
// S5 HYPOTHESIS + CAN_STATE -> REJECT
allPassed &= testSemantic("S5 Hypothesis flattened", mkBrief({ claimId: "S5", statement: "Hypothesis", claimClass: "HYPOTHESIS", sourceIds: ["SRC-001"], evidenceStatus: "MIXED", scriptUse: "CAN_STATE" }, false), false);
// S6 CONTESTED + STATE_WITH_CAVEAT -> PASS
allPassed &= testSemantic("S6 Contested caveated", mkBrief({ claimId: "S6", statement: "Contested", claimClass: "CONTESTED", sourceIds: ["SRC-001"], evidenceStatus: "MIXED", scriptUse: "STATE_WITH_CAVEAT" }, false), true);
// S7 CONTESTED + CAN_STATE -> REJECT
allPassed &= testSemantic("S7 Contested flattened", mkBrief({ claimId: "S7", statement: "Contested", claimClass: "CONTESTED", sourceIds: ["SRC-001"], evidenceStatus: "MIXED", scriptUse: "CAN_STATE" }, false), false);
// S8 invalid claim + READY=true -> REJECT (R5)
allPassed &= testSemantic("S8 Invalid READY handoff", mkBrief({ claimId: "S8", statement: "Unverified", claimClass: "UNVERIFIED", sourceIds: ["SRC-001"], evidenceStatus: "WEAK", scriptUse: "CAN_STATE" }, true), false);
// S8b: same invalid claim but READY=false -> still claim-invalid (valid=false), proves R5 is handoff gate not the only gate
allPassed &= testSemantic("S8b Invalid non-READY brief still invalid", mkBrief({ claimId: "S8b", statement: "Unverified", claimClass: "UNVERIFIED", sourceIds: ["SRC-001"], evidenceStatus: "WEAK", scriptUse: "CAN_STATE" }, false), false);

console.log("\n=== All Schema Validations Complete ===");
if (!allPassed) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");