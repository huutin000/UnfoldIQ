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
  "creative-memory.schema.json",
  "beat-map.schema.json",
  "scene-graph.schema.json",
  "shot-plan.schema.json",
  "prompt-package.schema.json",
  "production-decision.schema.json",
  "project-manifest.schema.json",
  "project-manifest-1.1.0.schema.json",
  "project-manifest-1.2.0.schema.json",
  "generation-history.schema.json",
  "recovery-state.schema.json",
  "telemetry.schema.json",
  "golden.schema.json",
  "governance.schema.json",
"project-manifest-1.3.0.schema.json",
  "project-manifest-1.4.0.schema.json",
  "project-manifest-1.5.0.schema.json",
  "final-spoken-script.schema.json",
  "final-spoken-script-1.1.0.schema.json",
  "spoken-humanization.schema.json",
  "evidence-fidelity-decision.schema.json",
  "naturalness-qa.schema.json",
  "narration-direction.schema.json",
  "pronunciation-profile.schema.json",
  "pronunciation-runtime-pass.schema.json",
  "tts-ready-plan.schema.json",
"voice-bible.schema.json",
  "voice-license-evidence.schema.json",
  "model-registry-snapshot.schema.json",
  "model-resolution.schema.json",
  "platform-adaptation.schema.json",
  "production-budget-plan.schema.json",
  "generation-cost-ledger.schema.json",
  "agent-instruction-set.schema.json",
  "instruction-sync.schema.json",
  "asset-record.schema.json",  "source-index.schema.json",
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

// Test production-decision (1G.5)
allPassed &= testValid("production-decision (valid editor motion)", "production-decision.schema.json", {
  version: "1.0.0", decisionId: "pd-0123456789ab", projectId: "test-project",
  sceneId: "sc-0123456789ab", shotId: "sh-0123456789ab",
  visualType: "MAP", recommendedOutputType: "EDITOR_MOTION", selectedOutputType: null,
  effectiveOutputType: "EDITOR_MOTION",
  visualModality: "MAP", modalityReasons: ["visualModality = MAP (location / movement through space)"],
  modalityConfidence: "HIGH", alternativeModalities: ["ATMOSPHERE"],
  beatLineage: { beatIds: ["bt-001"], narrativeRoles: ["EXPLANATION"], narrativePurpose: "explain the route", visualObjective: "EXPLAIN", shotPurpose: "DEMONSTRATE" },
  beatFingerprints: { "bt-001": "0123456789abcdef" }, referenceAssetIds: [], referenceVersions: {},
  renderMode: "REMOTION_MOTION", renderModeReasons: ["renderMode = REMOTION_MOTION: deterministic editor motion expresses the modality"], motionNeed: "MEDIUM", motionScore: 2,
  editorMotionViability: { viable: true, techniques: ["MAP_ROUTE", "PAN"], editorAlternativeQuality: "ADEQUATE" },
  generatedMotionValue: "NONE", referenceStrategy: "NONE",
  requiredCapabilities: ["IMAGE_GENERATION", "LANDSCAPE_OUTPUT"],
  requiredAssetRoles: ["PRIMARY_IMAGE", "MAP_BASE"],
  editorMotionPlan: { motionPlanId: "mp-0123456789ab", shotId: "sh-0123456789ab", techniques: ["MAP_ROUTE"] },
  decisionReasons: ["baseline EDITOR_MOTION for visualType MAP"],
  warnings: [], blockers: [], framing: "ILLUSTRATIVE", generationRisk: "NONE",
  costClass: "LOW", externalCostEstimate: "UNKNOWN",
  claimRefs: [], classificationRefs: [],
  sourceRefs: { shotId: "sh-0123456789ab", sceneId: "sc-0123456789ab", beatIds: ["bt-001"] },
  sourceFingerprints: { shot: "0123456789abcdef", scene: "abcdef0123456789", policyVersion: "visual-motion-policy-1.0.0" },
  platform: "youtube", contentClass: "FACTUAL", policyRef: "visual-motion-policy-1.0.0",
  selectedReason: null, overrideState: "NONE",
  fingerprint: "0123456789abcdef", status: "DECISION_READY",
});
allPassed &= testInvalid("production-decision (bad recommendation)", "production-decision.schema.json", {
  version: "1.0.0", decisionId: "pd-0123456789ab", projectId: "test-project",
  sceneId: "sc-0123456789ab", shotId: "sh-0123456789ab",
  visualType: "MAP", recommendedOutputType: "VEO_VIDEO",
  motionNeed: "LOW", referenceStrategy: "NONE",
  requiredCapabilities: ["IMAGE_GENERATION"], requiredAssetRoles: ["PRIMARY_IMAGE"],
  decisionReasons: ["x"],
  sourceRefs: { shotId: "sh-0123456789ab", sceneId: "sc-0123456789ab", beatIds: ["bt-001"] },
  sourceFingerprints: {}, fingerprint: "0123456789abcdef", status: "DECISION_READY",
});

// Test model-registry-snapshot (1G.6)
allPassed &= testValid("model-registry-snapshot (valid minimal)", "model-registry-snapshot.schema.json", {
  version: "1.0.0", snapshotId: "rs-test", createdAt: new Date().toISOString(),
  surfaces: [{ surfaceId: "S1", providerId: "p1", status: "UNKNOWN" }],
  models: [{
    modelId: "p1--m--1", providerId: "p1", surfaceId: "S1",
    capabilityRules: [{ capability: "VIDEO_GENERATION", support: "SUPPORTED", sourceRefs: ["src-1"] }],
    availability: "UNKNOWN",
  }],
  sources: [{ sourceId: "src-1", sourceType: "OFFICIAL_PROVIDER_DOC", retrievedAt: new Date().toISOString() }],
  fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("model-registry-snapshot (rule without provenance)", "model-registry-snapshot.schema.json", {
  version: "1.0.0", snapshotId: "rs-bad", createdAt: new Date().toISOString(),
  surfaces: [{ surfaceId: "S1", providerId: "p1" }],
  models: [{
    modelId: "p1--m--1", providerId: "p1", surfaceId: "S1",
    capabilityRules: [{ capability: "VIDEO_GENERATION", support: "SUPPORTED", sourceRefs: [] }],
    availability: "UNKNOWN",
  }],
  sources: [{ sourceId: "src-1", sourceType: "OFFICIAL_PROVIDER_DOC", retrievedAt: new Date().toISOString() }],
  fingerprint: "0123456789abcdef",
});

// Test model-resolution (1G.6)
allPassed &= testValid("model-resolution (valid provisional)", "model-resolution.schema.json", {
  version: "1.0.0", resolutionId: "mr-0123456789ab", projectId: "test", shotId: "sh-000000000001",
  renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION"],
  registrySnapshotRef: { snapshotId: "rs-test", fingerprint: "0123456789abcdef" },
  candidateModels: [], rejectedModels: [],
  selectionReasons: ["hard_requirement_fit: satisfies VIDEO_GENERATION"],
  warnings: ["RUNTIME_AVAILABILITY_NOT_VERIFIED"], blockers: [],
  capabilityFreshness: "FRESH", availabilityFreshness: "UNKNOWN", costFreshness: "UNKNOWN",
  costEstimate: { state: "UNKNOWN" }, resolutionKind: "VIDEO_MODEL",
  fingerprint: "0123456789abcdef", status: "PROVISIONAL",
});
allPassed &= testInvalid("model-resolution (bad render mode)", "model-resolution.schema.json", {
  version: "1.0.0", resolutionId: "mr-0123456789ab", projectId: "test", shotId: "sh-000000000001",
  renderMode: "VEO_TURBO", requiredCapabilities: [],
  registrySnapshotRef: { snapshotId: "rs-test", fingerprint: "0123456789abcdef" },
  selectionReasons: [], fingerprint: "0123456789abcdef", status: "BLOCKED",
});

// Test platform-adaptation (1G.7)
allPassed &= testValid("platform-adaptation (valid reframe)", "platform-adaptation.schema.json", {
  version: "1.0.0", adaptationId: "pa-0123456789ab", projectId: "test", shotId: "sh-000000000001",
  platformId: "TIKTOK", platformProfileVersion: "1.0.0",
  sourceCompositionId: "mc-0123456789ab", sourceFingerprint: "0123456789abcdef",
  targetAspectRatio: "9:16", action: "REFRAME",
  textPlan: {}, captionPlan: {}, graphicPlan: {},
  preservedIntent: ["visual modality MAP unchanged"], risks: [], warnings: [], blockers: [],
  regenerationDecision: "NOT_REQUIRED", regenerationReasons: [],
  fingerprint: "0123456789abcdef", status: "ADAPTED",
});
allPassed &= testInvalid("platform-adaptation (bad action)", "platform-adaptation.schema.json", {
  version: "1.0.0", adaptationId: "pa-0123456789ab", shotId: "sh-000000000001",
  platformId: "TIKTOK", sourceCompositionId: "mc-0123456789ab", sourceFingerprint: "x",
  targetAspectRatio: "9:16", action: "ROTATE",
  regenerationDecision: "NOT_REQUIRED",
  fingerprint: "0123456789abcdef", status: "ADAPTED",
});

// Test production-budget-plan (1G.8)
allPassed &= testValid("production-budget-plan (valid draft)", "production-budget-plan.schema.json", {
  version: "1.0.0", budgetPlanId: "bp-0123456789ab", projectId: "test", scopeId: "scope-1",
  hardBudget: { unit: "CREDITS", limit: 30 }, plannedItems: [],
  summary: { estimatedImages: 0, estimatedVeoShots: 0, estimatedVariants: 0, knownCredits: 0, exactTotalCredits: 0 },
  estimateState: "EXACT", fingerprint: "0123456789abcdef", status: "DRAFT",
});
allPassed &= testInvalid("production-budget-plan (missing hard budget)", "production-budget-plan.schema.json", {
  version: "1.0.0", budgetPlanId: "bp-0123456789ab", projectId: "test", scopeId: "scope-1",
  plannedItems: [], summary: {}, estimateState: "EXACT",
  fingerprint: "0123456789abcdef", status: "DRAFT",
});

// Test generation-cost-ledger (1G.8)
allPassed &= testValid("generation-cost-ledger (valid empty)", "generation-cost-ledger.schema.json", {
  version: "1.0.0", ledgerId: "cl-0123456789ab", projectId: "test", budgetPlanId: "bp-0123456789ab",
  entries: [], totals: { planned: 0, creditsObserved: 0 },
  reconciliationState: "RECONCILED", fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("generation-cost-ledger (negative credits)", "generation-cost-ledger.schema.json", {
  version: "1.0.0", ledgerId: "cl-0123456789ab", projectId: "test", budgetPlanId: "bp-0123456789ab",
  entries: [{ entryId: "le-1", attemptId: "a1", observationId: "o1", status: "SUCCEEDED", creditsObserved: -5, observedAt: new Date().toISOString(), fingerprint: "x" }],
  totals: { planned: 0, creditsObserved: -5 },
  reconciliationState: "RECONCILED", fingerprint: "0123456789abcdef",
});

// Test agent-instruction-set (1G.9)
allPassed &= testValid("agent-instruction-set (valid minimal)", "agent-instruction-set.schema.json", {
  version: "1.0.0", instructionSetId: "is-0123456789ab", projectId: "test",
  instructionVersion: "iv-0123456789ab",
  constraints: { characterIdentity: ["Lan keeps her ward uniform"] },
  referenceIds: ["ref-1"],
  referenceBindings: [{ referenceId: "ref-1", role: "CHARACTER_IDENTITY" }],
  compiledText: "PROJECT INVARIANTS:\n- Lan keeps her ward uniform",
  compiledFingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("agent-instruction-set (bad reference role)", "agent-instruction-set.schema.json", {
  version: "1.0.0", instructionSetId: "is-0123456789ab", projectId: "test",
  instructionVersion: "iv-0123456789ab", constraints: {},
  referenceIds: ["ref-1"], referenceBindings: [{ referenceId: "ref-1", role: "MOOD" }],
  compiledText: "x", compiledFingerprint: "0123456789abcdef",
});

// Test instruction-sync (1G.9)
allPassed &= testValid("instruction-sync (valid draft)", "instruction-sync.schema.json", {
  version: "1.0.0", syncId: "sy-0123456789ab", projectId: "test",
  instructionSetId: "is-0123456789ab", instructionVersion: "iv-0123456789ab",
  desiredFingerprint: "0123456789abcdef", syncStatus: "DRAFT",
});
allPassed &= testInvalid("instruction-sync (missing desired fingerprint)", "instruction-sync.schema.json", {
  version: "1.0.0", syncId: "sy-0123456789ab", projectId: "test",
  instructionSetId: "is-0123456789ab", instructionVersion: "iv-0123456789ab",
  syncStatus: "DRAFT",
});


allPassed &= testValid("instruction-sync (hands-free verified metadata)", "instruction-sync.schema.json", {
  version: "1.0.0", syncId: "sy-0123456789ab", projectId: "test",
  instructionSetId: "is-0123456789ab", instructionVersion: "iv-0123456789ab",
  desiredFingerprint: "0123456789abcdef", syncStatus: "VERIFIED",
  automationMode: "HANDS_FREE", writeTransport: "MAIN_WORLD_INPUT_SEQUENCE",
  operatorTextEntry: false, previousSyncRef: "sy-4f2e4f010241",
});
allPassed &= testInvalid("instruction-sync (bad previousSyncRef shape)", "instruction-sync.schema.json", {
  version: "1.0.0", syncId: "sy-0123456789ab", projectId: "test",
  instructionSetId: "is-0123456789ab", instructionVersion: "iv-0123456789ab",
  desiredFingerprint: "0123456789abcdef", syncStatus: "DRAFT",
  previousSyncRef: "not-a-sync-id",
});

// Test asset-record (1G.10)
allPassed &= testValid("asset-record (valid minimal)", "asset-record.schema.json", {
  version: "1.0.0", assetId: "as-0123456789ab", projectId: "test",
  type: "image", role: "BROLL", source: "migration",
  hash: { algo: "sha256", value: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
  bytes: 1024, createdAt: "2026-10-04T00:00:00.000Z",
});
allPassed &= testInvalid("asset-record (bad role + bad hash)", "asset-record.schema.json", {
  version: "1.0.0", assetId: "as-0123456789ab", projectId: "test",
  type: "image", role: "MOOD", source: "migration",
  hash: { algo: "sha256", value: "zzz" },
  bytes: 1024, createdAt: "2026-10-04T00:00:00.000Z",
});

// Test project-manifest (1H.1)
allPassed &= testValid("project-manifest (valid minimal)", "project-manifest.schema.json", {
  schemaVersion: "1.0.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 1, revision: 1, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
  artifacts: {}, providers: { selections: [] }, state: { status: "DRAFT" },
  lineage: {}, fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("project-manifest (bad status + bad fingerprint)", "project-manifest.schema.json", {
  schemaVersion: "1.0.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 1, revision: 1, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
  artifacts: {}, providers: { selections: [] }, state: { status: "SHIPPED" },
  lineage: {}, fingerprint: "zzz",
});

// Test project-manifest 1.1.0 (1H.2 history slot)
allPassed &= testValid("project-manifest-1.1.0 (history ref)", "project-manifest-1.1.0.schema.json", {
  schemaVersion: "1.1.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 3, revision: 3, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:01.000Z",
  artifacts: {}, providers: { selections: [] }, state: { status: "ACTIVE" },
  history: { historySchemaVersion: "1.0.0", ref: "history/history.json" },
  lineage: {}, fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("project-manifest-1.1.0 (undeclared field)", "project-manifest-1.1.0.schema.json", {
  schemaVersion: "1.1.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 3, revision: 3, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:01.000Z",
  artifacts: {}, providers: { selections: [] }, state: { status: "ACTIVE" },
  history: { historySchemaVersion: "1.0.0", ref: "history/history.json" },
  eventLog: [],
  lineage: {}, fingerprint: "0123456789abcdef",
});

// Test project-manifest 1.2.0 (1H.3 recovery slot)
allPassed &= testValid("project-manifest-1.2.0 (recovery ref)", "project-manifest-1.2.0.schema.json", {
  schemaVersion: "1.2.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 5, revision: 5, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:02.000Z",
  artifacts: {}, providers: { selections: [] }, state: { status: "ACTIVE" },
  history: { historySchemaVersion: "1.0.0", ref: "history/history.json" },
  recovery: { recoverySchemaVersion: "1.0.0", dagSchemaVersion: "1.0.0", ref: "recovery/" },
  lineage: {}, fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("project-manifest-1.2.0 (bad recovery shape)", "project-manifest-1.2.0.schema.json", {
  schemaVersion: "1.2.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 5, revision: 5, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:02.000Z",
  artifacts: {}, providers: { selections: [] }, state: { status: "ACTIVE" },
  history: { historySchemaVersion: "1.0.0", ref: "history/history.json" },
  recovery: { recoverySchemaVersion: "9.9.9", dagSchemaVersion: "1.0.0", ref: "recovery/" },
  lineage: {}, fingerprint: "0123456789abcdef",
});

// Test generation-history (1H.2)
allPassed &= testValid("generation-history (valid minimal)", "generation-history.schema.json", {
  schemaVersion: "1.0.0", projectId: "test", revision: 1,
  createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
  generations: {}, variants: {}, decisions: {}, locks: {}, fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("generation-history (bad decision value)", "generation-history.schema.json", {
  schemaVersion: "1.0.0", projectId: "test", revision: 1,
  createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
  generations: {}, variants: {},
  decisions: { "dec-0123456789ab": { decisionId: "dec-0123456789ab", targetType: "SHOT", targetId: "SH01", decision: "MAYBE", reason: "r", evidenceRefs: ["e"], decidedAt: "2026-10-05T00:00:00.000Z" } },
  locks: {}, fingerprint: "0123456789abcdef",
});

// Test telemetry + golden (1H.4/1H.5): these schema files organize multiple
// documents under definitions, so validate the referenced sub-schemas.
function testSubSchema(name, file, def, instance, expectValid) {
  const ajv = createAjv();
  try {
    const root = loadSchema(file);
    const validate = ajv.compile({ ...root, $ref: `#/definitions/${def}` });
    const valid = validate(instance);
    const pass = valid === expectValid;
    console.log(pass ? `✓ ${name}: as expected (valid=${valid})` : `✗ ${name}: expected valid=${expectValid}, got ${valid} ${JSON.stringify(validate.errors)}`);
    return pass;
  } catch (e) {
    console.log(`✗ ${name} validation error: ${e.message}`);
    return false;
  }
}
allPassed &= testSubSchema("telemetry eventsDoc (valid minimal)", "telemetry.schema.json", "eventsDoc", {
  schemaVersion: "1.0.0", projectId: "test", revision: 1,
  createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
  events: {}, fingerprint: "0123456789abcdef",
}, true);
allPassed &= testSubSchema("telemetry eventsDoc (bad severity)", "telemetry.schema.json", "eventsDoc", {
  schemaVersion: "1.0.0", projectId: "test", revision: 1,
  createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
  events: { "eve-0123456789ab": { eventId: "eve-0123456789ab", eventName: "QA", timestamp: "2026-10-05T00:00:00.000Z", severity: "LOUD", projectId: "test", retention: "DERIVED_REGENERABLE" } },
  fingerprint: "0123456789abcdef",
}, false);
allPassed &= testSubSchema("golden baseline (valid minimal)", "golden.schema.json", "baseline", {
  baselineId: "base-0123456789ab", goldenProjectId: "gold-t", goldenVersion: 1, version: 1,
  metrics: {}, createdAt: "2026-10-05T00:00:00.000Z", reason: "test",
}, true);
allPassed &= testSubSchema("golden baseline (missing reason)", "golden.schema.json", "baseline", {
  baselineId: "base-0123456789ab", goldenProjectId: "gold-t", goldenVersion: 1, version: 1,
  metrics: {}, createdAt: "2026-10-05T00:00:00.000Z",
}, false);

// Test project-manifest 1.3.0 (1H.6/1H.7 governance slot)
allPassed &= testValid("project-manifest-1.3.0 (governance ref)", "project-manifest-1.3.0.schema.json", {
  schemaVersion: "1.3.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 7, revision: 7, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:03.000Z",
  artifacts: {}, providers: { selections: [] }, state: { status: "ACTIVE" },
  history: { historySchemaVersion: "1.0.0", ref: "history/history.json" },
  recovery: { recoverySchemaVersion: "1.0.0", dagSchemaVersion: "1.0.0", ref: "recovery/" },
  governance: { provenanceSchemaVersion: "1.0.0", complianceSchemaVersion: "1.0.0", storageSchemaVersion: "1.0.0", ref: "governance/" },
  lineage: {}, fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("project-manifest-1.3.0 (undeclared governance field)", "project-manifest-1.3.0.schema.json", {
  schemaVersion: "1.3.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 7, revision: 7, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:03.000Z",
  artifacts: {}, providers: { selections: [] }, state: { status: "ACTIVE" },
  history: null, recovery: null,
  governance: { provenanceSchemaVersion: "1.0.0", complianceSchemaVersion: "1.0.0", storageSchemaVersion: "1.0.0", ref: "governance/", retentionYears: 7 },
  lineage: {}, fingerprint: "0123456789abcdef",
});

// Test project-manifest 1.4.0 (Phase 2.1 voiceBibleVersion slot)
allPassed &= testValid("project-manifest-1.4.0 (voiceBibleVersion slot)", "project-manifest-1.4.0.schema.json", {
  schemaVersion: "1.4.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 8, revision: 8, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:03.000Z",
  artifacts: { voiceBibleVersion: { version: "vb-0123456789ab", status: "VERIFIED", ref: "voice/voice-bible/vb-0123456789ab.json", detail: "v1" } },
  providers: { selections: [] }, state: { status: "ACTIVE" },
  history: null, recovery: null, governance: null,
  lineage: {}, fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("project-manifest-1.4.0 (voiceBible slot rejected at 1.3.0)", "project-manifest-1.3.0.schema.json", {
  schemaVersion: "1.3.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 8, revision: 8, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:03.000Z",
  artifacts: { voiceBibleVersion: { version: "vb-0123456789ab", status: "VERIFIED" } },
  providers: { selections: [] }, state: { status: "ACTIVE" },
  history: null, recovery: null, governance: null,
  lineage: {}, fingerprint: "0123456789abcdef",
});

// Test project-manifest 1.5.0 (Phase 2.2+2.3 pre-TTS slots)
allPassed &= testValid("project-manifest-1.5.0 (pre-TTS slots)", "project-manifest-1.5.0.schema.json", {
  schemaVersion: "1.5.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 9, revision: 9, createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:03.000Z",
  artifacts: {
    narrationDirectionVersion: { version: "nd-0123456789ab", status: "VERIFIED", ref: "voice/narration-direction/nd-0123456789ab.json", detail: "v1" },
    pronunciationProfileVersion: { version: "pron-0123456789ab", status: "VERIFIED", ref: "voice/pronunciation-profile/pron-0123456789ab.json", detail: "v1" },
    pronunciationRuntimePassVersion: { version: "prp-0123456789ab", status: "VERIFIED", ref: "voice/pronunciation-pass/prp-0123456789ab.json", detail: "v1" },
    ttsReadyPlanVersion: { version: "ttp-0123456789ab", status: "VERIFIED", ref: "voice/tts-ready-plan/ttp-0123456789ab.json", detail: "v1" },
  },
  providers: { selections: [] }, state: { status: "ACTIVE" },
  history: null, recovery: null, governance: null,
  lineage: {}, fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("project-manifest-1.5.0 (pre-TTS slot rejected at 1.4.0)", "project-manifest-1.4.0.schema.json", {
  schemaVersion: "1.4.0", manifestId: "pm-0123456789ab", projectId: "test",
  projectVersion: 9, revision: 9, createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:03.000Z",
  artifacts: { narrationDirectionVersion: { version: "nd-0123456789ab", status: "VERIFIED" } },
  providers: { selections: [] }, state: { status: "ACTIVE" },
  history: null, recovery: null, governance: null,
  lineage: {}, fingerprint: "0123456789abcdef",
});

// Test final-spoken-script (Phase 2 identity contract)
allPassed &= testValid("final-spoken-script (segments + identity)", "final-spoken-script.schema.json", {
  schemaVersion: "1.0.0", scriptArtifactId: "fss-phase223-validation", scriptVersion: 1, projectId: "test",
  language: "en-us", contentMode: null, contentClass: "FACTUAL",
  segments: [
    { segmentId: "S1", ordinal: 0, text: "First spoken segment." },
    { segmentId: "S2", ordinal: 1, text: "Second spoken segment.", beatRefs: ["B1"] },
  ],
  provenance: { source: "phase-2-validation-fixture", createdAt: "2026-10-06T00:00:00.000Z", productionScriptStatus: "NOT_APPLICABLE" },
  fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("final-spoken-script (empty text rejected)", "final-spoken-script.schema.json", {
  schemaVersion: "1.0.0", scriptArtifactId: "fss-phase223-validation", scriptVersion: 1, projectId: "test",
  language: "en-us", segments: [{ segmentId: "S1", ordinal: 0, text: "" }],
  fingerprint: "0123456789abcdef",
});

// Test narration-direction (Phase 2.2)
const ND_BASE = {
  schemaVersion: "1.0.0", narrationDirectionId: "nd-0123456789ab", version: 1, projectId: "test",
  scriptRef: { scriptArtifactId: "fss-phase223-validation", scriptVersion: 1 },
  voiceBibleRef: "vb-0123456789ab", language: "en-us",
  segments: [{
    segmentId: "S2", segmentOrdinal: 1, sourceTextHash: "0123456789abcdef",
    speakerId: null,
    emphasis: [{ text: "exactly", occurrence: 1, strength: "MODERATE" }],
    pauseIntent: [{ kind: "BEAT", afterText: "first clause.", occurrence: 1 }],
    energy: "ELEVATED", emotion: "CONFIDENT", paceIntent: "SLOWER", directionReason: "payoff beat",
  }],
  stats: { totalSegments: 4, directedSegments: 1, directionCoveragePercent: 25, emphasisCount: 1, explicitPauseCount: 1 },
  provenance: { source: "phase-2.2", createdAt: "2026-10-06T00:00:00.000Z", evidenceRefs: [] },
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("narration-direction (sparse direction)", "narration-direction.schema.json", ND_BASE);
allPassed &= testInvalid("narration-direction (bad emotion enum shape is free string but bad pause kind rejected)", "narration-direction.schema.json", {
  ...ND_BASE,
  segments: [{ ...ND_BASE.segments[0], pauseIntent: [{ kind: "SUPER_LONG", afterText: "x", occurrence: 1 }] }],
});
allPassed &= testInvalid("narration-direction (bad fingerprint rejected)", "narration-direction.schema.json", { ...ND_BASE, fingerprint: "nothex" });

// Test pronunciation-profile (Phase 2.3)
const PP_BASE = {
  schemaVersion: "1.0.0", pronunciationProfileId: "pron-0123456789ab", version: 1, projectId: null,
  language: "en-us",
  entries: [
    {
      entryId: "pe-0123456789ab", normalizedTerm: "kokoro", displayTerm: "Kokoro", language: "en-us", locale: null,
      category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "koh-koh-roh" }, acronymMode: null,
      scope: { level: "GLOBAL_LANGUAGE", projectId: null, scriptArtifactId: null, segmentId: null },
      source: "OPERATOR_OVERRIDE", quality: "VERIFIED", notes: null,
      provenance: { createdAt: "2026-10-06T00:00:00.000Z", origin: "operator approval", evidenceRefs: [] },
    },
    {
      entryId: "pe-0123456789ac", normalizedTerm: "nasa", displayTerm: "NASA", language: "en-us", locale: null,
      category: "ACRONYM", reading: { notation: "READ_AS", value: "N A S A" }, acronymMode: "LETTER_BY_LETTER",
      scope: { level: "GLOBAL_LANGUAGE", projectId: null, scriptArtifactId: null, segmentId: null },
      source: "CANONICAL_LEXICON", quality: "AUTO", notes: null,
      provenance: { createdAt: "2026-10-06T00:00:00.000Z", origin: null, evidenceRefs: [] },
    },
  ],
  provenance: { source: "phase-2.3", createdAt: "2026-10-06T00:00:00.000Z", evidenceRefs: [] },
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("pronunciation-profile (six-category capable entries)", "pronunciation-profile.schema.json", PP_BASE);
allPassed &= testInvalid("pronunciation-profile (ACRONYM without acronymMode rejected)", "pronunciation-profile.schema.json", {
  ...PP_BASE,
  entries: [{ ...PP_BASE.entries[1], acronymMode: null }],
});
allPassed &= testInvalid("pronunciation-profile (unknown category rejected)", "pronunciation-profile.schema.json", {
  ...PP_BASE,
  entries: [{ ...PP_BASE.entries[0], entryId: "pe-0123456789ad", category: "SOMEhow" }],
});

// Test pronunciation-runtime-pass (Phase 2.3)
const PRP_BASE = {
  schemaVersion: "1.0.0", pronunciationPassId: "prp-0123456789ab", version: 1, projectId: "test",
  scriptRef: { scriptArtifactId: "fss-phase223-validation", scriptVersion: 1 },
  voiceBibleRef: "vb-0123456789ab", profileRef: "pron-0123456789ab",
  provider: "local-kokoro", providerModel: "kokoro-v1", providerLanguageCode: "a",
  runtimeMode: "QUIET_PHONEMIZATION", language: "en-us",
  segments: [
    { segmentId: "S1", sourceTextHash: "0123456789abcdef", matchedEntries: [], compiledInputHash: "0123456789abcdef", runtimeGraphemeHash: "0123456789abcdef", runtimePhonemeHash: "0123456789abcdef", issues: [], status: "CLEAN" },
    { segmentId: "S3", sourceTextHash: "0123456789abcdee", matchedEntries: [{ entryId: "pe-0123456789ab", term: "Kokoro", applied: true, notAppliedReason: null }], compiledInputHash: "0123456789abcdea", runtimeGraphemeHash: "0123456789abcdea", runtimePhonemeHash: "0123456789abcdea", issues: [], status: "OVERRIDE_APPLIED" },
  ],
  provenance: { source: "phase-2.3-runtime-pass", createdAt: "2026-10-06T00:00:00.000Z", runtimeEvidenceRef: null, evidenceRefs: [] },
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("pronunciation-runtime-pass (clean + override segments)", "pronunciation-runtime-pass.schema.json", PRP_BASE);
allPassed &= testInvalid("pronunciation-runtime-pass (bad status rejected)", "pronunciation-runtime-pass.schema.json", {
  ...PRP_BASE,
  segments: [{ ...PRP_BASE.segments[0], status: "GUESSED" }],
});
allPassed &= testInvalid("pronunciation-runtime-pass (wrong runtimeMode rejected)", "pronunciation-runtime-pass.schema.json", { ...PRP_BASE, runtimeMode: "FULL_TTS" });

// Test tts-ready-plan (Phase 2.2+2.3 output)
const TTP_BASE = {
  schemaVersion: "1.0.0", ttsReadyPlanId: "ttp-0123456789ab", version: 1, projectId: "test",
  scriptRef: { scriptArtifactId: "fss-phase223-validation", scriptVersion: 1 },
  voiceBibleRef: "vb-0123456789ab", narrationDirectionRef: "nd-0123456789ab", pronunciationPassRef: "prp-0123456789ab",
  provider: "local-kokoro", providerModel: "kokoro-v1", language: "en-us", overall: "READY_FOR_TTS",
  productionTtsBlocked: false,
  segments: [
    { segmentId: "S1", sourceTextHash: "0123456789abcdef", speakerId: "narrator", directionRef: null, compiledTextHash: "0123456789abcdef", pronunciationStatus: "CLEAN", readyForTts: true, blockers: [] },
    { segmentId: "S3", sourceTextHash: "0123456789abcdee", speakerId: "narrator", directionRef: "nd-0123456789ab#v1", compiledTextHash: "0123456789abcdea", pronunciationStatus: "OVERRIDE_APPLIED", readyForTts: true, blockers: [] },
  ],
  provenance: { source: "phase-2.2-2.3", createdAt: "2026-10-06T00:00:00.000Z", productionScriptStatus: "CANONICAL", evidenceRefs: [] },
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("tts-ready-plan (ready)", "tts-ready-plan.schema.json", TTP_BASE);
allPassed &= testInvalid("tts-ready-plan (bad overall rejected)", "tts-ready-plan.schema.json", { ...TTP_BASE, overall: "MAYBE" });
allPassed &= testInvalid("tts-ready-plan (missing productionTtsBlocked rejected)", "tts-ready-plan.schema.json", (() => { const c = { ...TTP_BASE }; delete c.productionTtsBlocked; return c; })());
allPassed &= testInvalid("tts-ready-plan (audio path forbidden by shape)", "tts-ready-plan.schema.json", {
  ...TTP_BASE,
  segments: [{ ...TTP_BASE.segments[0], audioPath: "assets/audio/s1.wav" }],
});

// Test spoken-humanization (FIX PRE-2.4)
const SH_BASE = {
  schemaVersion: "1.0.0", humanizationId: "hum-0123456789ab", version: 1, projectId: "test",
  contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
  sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
  sourceTextHash: "0123456789abcdef", instructionVersion: "spoken-humanizer-1.0.0",
  segments: [{
    segmentId: "S1", sourceSegmentIds: ["B1"], sourceTextHash: "0123456789abcdef",
    sourceText: "Source text.", candidateSpokenText: "Candidate spoken text.",
    candidateTextHash: "0123456789abcdea", changeTypes: ["RHYTHM"], changeNotes: null,
  }],
  changeSummary: "bounded rewrite",
  provenance: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash", attempt: 1, createdAt: "2026-10-06T00:00:00.000Z", evidenceRefs: [] },
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("spoken-humanization (candidate contract)", "spoken-humanization.schema.json", SH_BASE);
allPassed &= testInvalid("spoken-humanization (unknown changeType rejected)", "spoken-humanization.schema.json", {
  ...SH_BASE,
  segments: [{ ...SH_BASE.segments[0], changeTypes: ["MAGIC_REWRITE"] }],
});
allPassed &= testInvalid("spoken-humanization (unbounded actorType rejected)", "spoken-humanization.schema.json", {
  ...SH_BASE,
  provenance: { ...SH_BASE.provenance, actorType: "WIZARD" },
});

// Test evidence-fidelity-decision (FIX PRE-2.4)
const FID_BASE = {
  schemaVersion: "1.0.0", decisionId: "fid-0123456789ab", version: 1, projectId: "test",
  contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
  sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
  humanizationRef: "hum-0123456789ab",
  checks: [{ checkId: "S1:NUMBER", segmentId: "S1", protectedItemType: "NUMBER", sourceValue: "300,000", candidateValue: "300,000", status: "PRESERVED", reason: null, evidenceRef: null }],
  issues: [],
  decision: "PASS",
  provenance: { createdAt: "2026-10-06T00:00:00.000Z", evidenceRefs: [] },
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("evidence-fidelity-decision (PASS)", "evidence-fidelity-decision.schema.json", FID_BASE);
allPassed &= testInvalid("evidence-fidelity-decision (bad decision rejected)", "evidence-fidelity-decision.schema.json", { ...FID_BASE, decision: "KINDA_OK" });
allPassed &= testInvalid("evidence-fidelity-decision (bad protectedItemType rejected)", "evidence-fidelity-decision.schema.json", {
  ...FID_BASE,
  checks: [{ ...FID_BASE.checks[0], protectedItemType: "VIBES" }],
});

// Test naturalness-qa (FIX PRE-2.4)
const NQA_BASE = {
  schemaVersion: "1.0.0", qaId: "nqa-0123456789ab", version: 1, projectId: "test",
  humanizationRef: "hum-0123456789ab",
  metrics: { sentenceCount: 3, sentenceLengthMean: 8.5, sentenceLengthVariance: 4.2, sentenceLengthDistribution: [7, 9, 10], repeatedTransitionPhrases: [], repeatedOpenings: [], repeatedRhetoricalPatterns: [], abstractLanguageFlags: [], summaryPhraseFlags: [], paragraphRhythmUniformity: null, cadenceUniformity: 0.2, redundancyFlags: [], awkwardSpokenPhrases: [] },
  issues: [{ code: "REPETITIVE_TRANSITION", segmentId: null, span: "so", detail: "3 sentences", blocking: true }],
  decision: "FAIL",
  provenance: { createdAt: "2026-10-06T00:00:00.000Z", evidenceRefs: [] },
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("naturalness-qa (explainable issues)", "naturalness-qa.schema.json", NQA_BASE);
allPassed &= testInvalid("naturalness-qa (unknown issue code rejected)", "naturalness-qa.schema.json", {
  ...NQA_BASE,
  issues: [{ code: "SOUNDS_ROBOTIC", segmentId: null, span: null, detail: null, blocking: true }],
});
allPassed &= testInvalid("naturalness-qa (missing blocking flag rejected)", "naturalness-qa.schema.json", {
  ...NQA_BASE,
  issues: [{ code: "SUMMARY_HEAVY", segmentId: null, span: null, detail: null }],
});

// Test final-spoken-script 1.1.0 (canonical lineage)
allPassed &= testValid("final-spoken-script-1.1.0 (canonical lineage)", "final-spoken-script-1.1.0.schema.json", {
  schemaVersion: "1.1.0", scriptArtifactId: "fss-canonical-test", scriptVersion: 1, projectId: "test",
  language: "en-us", contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
  segments: [{ segmentId: "S1", ordinal: 0, text: "Clean spoken text only." }],
  provenance: {
    source: "FIX PRE-2.4 chain", createdAt: "2026-10-06T00:00:00.000Z", productionScriptStatus: "CANONICAL",
    sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
    humanizationRef: "hum-0123456789ab", evidenceFidelityRef: "fid-0123456789ab", naturalnessQaRef: "nqa-0123456789ab",
  },
  fingerprint: "0123456789abcdef",
});
allPassed &= testInvalid("final-spoken-script-1.1.0 (fixture status NOT_APPLICABLE rejected at 1.1.0 const)", "final-spoken-script.schema.json", {
  schemaVersion: "1.1.0", scriptArtifactId: "fss-canonical-test", scriptVersion: 1, projectId: "test",
  language: "en-us", segments: [{ segmentId: "S1", ordinal: 0, text: "x" }],
  fingerprint: "0123456789abcdef",
});

// Test voice-bible (Phase 2.1)
const VOICE_BIBLE_VALID = {
  schemaVersion: "1.0.0", voiceBibleId: "vb-0123456789ab", version: 1,
  projectId: "test", channelId: null,
  language: "en-us", locale: "en-US",
  narrator: {
    personaId: "per-explainer-guide", displayName: "Guide",
    provider: "local-kokoro", model: "kokoro-v1", voiceId: "af_heart",
    speakingStyle: "measured explanatory narration",
    prosodyDefaults: {
      paceIntent: "MODERATE", energy: "BALANCED", pauseStyle: "NATURAL",
      sentenceFlow: "MEASURED", emphasisStyle: "SELECTIVE", emotionalBaseline: "WARM",
    },
    speedDefault: 1, pitchDefault: null, energyDefault: "BALANCED",
    emotionalRange: ["NEUTRAL", "CURIOSITY", "CONFIDENT"],
    prohibitedTraits: ["UNNATURALLY_SLOW_CINEMATIC", "OVERACTING"],
    persona: {
      personaId: "per-explainer-guide", role: "GUIDE",
      audience: "curious general viewers new to the topic", tone: "EXPLAINING",
      energy: "BALANCED", paceIntent: "MODERATE", warmth: "WARM",
      directness: "BALANCED", formality: "CONVERSATIONAL",
      storytellingStyle: "EXPLAINER",
      emotionalRange: ["NEUTRAL", "CURIOSITY", "CONFIDENT"],
      prohibitedDeliveryPatterns: ["UNNATURALLY_SLOW_CINEMATIC", "OVERACTING"],
      language: "en-us", notes: null,
    },
  },
  characterVoices: [], pronunciationProfileRef: "pron-ancient-humans",
  providerOptions: null,
  provenance: {
    source: "OPERATOR_APPROVED", createdAt: "2026-10-05T00:00:00.000Z",
    rights: { status: "PLATFORM_GENERATED", licenseType: "NOT_APPLICABLE", detail: null, cloning: false },
    evidenceRefs: ["providers/local/SETUP_KOKORO.md"], approvalRef: null,
  },
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("voice-bible (valid minimal identity + persona)", "voice-bible.schema.json", VOICE_BIBLE_VALID);
// §9: speedDefault is a provider rate factor; a measured wpm value must not fit.
allPassed &= testInvalid("voice-bible (speedDefault rejected as measured wpm)", "voice-bible.schema.json", {
  ...VOICE_BIBLE_VALID, narrator: { ...VOICE_BIBLE_VALID.narrator, speedDefault: 145 },
});
allPassed &= testInvalid("voice-bible (unknown schema key)", "voice-bible.schema.json", {
  ...VOICE_BIBLE_VALID, measuredSpeechRateWpm: 145,
});
allPassed &= testInvalid("voice-bible (uncontrolled emotional range value)", "voice-bible.schema.json", {
  ...VOICE_BIBLE_VALID,
  narrator: { ...VOICE_BIBLE_VALID.narrator, emotionalRange: ["VERY_SAD"] },
});
allPassed &= testInvalid("voice-bible (voice cloning structurally forbidden)", "voice-bible.schema.json", {
  ...VOICE_BIBLE_VALID,
  provenance: { ...VOICE_BIBLE_VALID.provenance, rights: { ...VOICE_BIBLE_VALID.provenance.rights, cloning: true } },
});
allPassed &= testInvalid("voice-bible (narrator required)", "voice-bible.schema.json", {
  schemaVersion: "1.0.0", voiceBibleId: "vb-0123456789ab", version: 1, language: "en-us",
  characterVoices: [], provenance: VOICE_BIBLE_VALID.provenance, fingerprint: "0123456789abcdef",
});

// Test voice-license-evidence (Phase 2.1 FIX 01): separate rights claims,
// VERIFIED only with an official quoted source, no collapsed licensed=true.
const LICENSE_EVIDENCE_VALID = {
  schemaVersion: "1.0.0", evidenceId: "lice-0123456789ab",
  provider: "local-kokoro", model: "kokoro-v1", retrievedAt: "2026-10-05T00:00:00.000Z",
  officialSource: {
    publisher: "hexgrad", url: "https://huggingface.co/hexgrad/Kokoro-82M",
    modelCardUrl: "https://huggingface.co/hexgrad/Kokoro-82M",
    licenseFileUrl: "https://github.com/hexgrad/kokoro/blob/main/LICENSE",
    quotedStatement: "With Apache-licensed weights, Kokoro can be deployed anywhere from production environments to personal projects.",
  },
  upstreamArtifact: { name: "Kokoro-82M", release: "v1.0", releaseDate: "2025-01-27", sha256: "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4", languageCount: 8, voiceCount: 54 },
  runtimeBinding: { runtimeLabel: "kokoro-v1", upstreamReleasePinned: false, installed: false, installRequirement: "pip install kokoro>=0.9.2", note: "internal label is not an upstream pin" },
  claims: {
    modelLicense: { status: "VERIFIED", licenseIdentifier: "Apache-2.0", scope: "model weights", basis: "official card declares apache-2.0", retrievedAt: "2026-10-05T00:00:00.000Z", evidenceRefs: ["https://huggingface.co/hexgrad/Kokoro-82M"] },
    voiceAssetRights: { status: "REVIEW_REQUIRED", licenseIdentifier: "Apache-2.0", scope: "voice .pt files", basis: "runtime not installed; exact bytes unverified", retrievedAt: "2026-10-05T00:00:00.000Z", evidenceRefs: ["https://huggingface.co/hexgrad/Kokoro-82M/tree/main/voices"] },
    outputUsageStatus: { status: "REVIEW_REQUIRED", licenseIdentifier: null, scope: "synthesized output", basis: "no separate output grant published", retrievedAt: "2026-10-05T00:00:00.000Z", evidenceRefs: ["https://huggingface.co/hexgrad/Kokoro-82M"] },
  },
  trainingDataDisclosure: [{ name: "Koniwa", license: "CC BY 3.0", url: "https://github.com/koniwa/koniwa" }],
  notAsserted: ["no separate voice-asset redistribution grant is stated"],
  evidenceRefs: ["https://huggingface.co/hexgrad/Kokoro-82M"],
  fingerprint: "0123456789abcdef",
};
allPassed &= testValid("voice-license-evidence (separate honest claims)", "voice-license-evidence.schema.json", LICENSE_EVIDENCE_VALID);
allPassed &= testInvalid("voice-license-evidence (claims collapsed to one status enum)", "voice-license-evidence.schema.json", {
  ...LICENSE_EVIDENCE_VALID, claims: { modelLicense: "VERIFIED", voiceAssetRights: "VERIFIED", outputUsageStatus: "VERIFIED" },
});
allPassed &= testInvalid("voice-license-evidence (invented license status)", "voice-license-evidence.schema.json", {
  ...LICENSE_EVIDENCE_VALID, claims: { ...LICENSE_EVIDENCE_VALID.claims, modelLicense: { ...LICENSE_EVIDENCE_VALID.claims.modelLicense, status: "APPROVED" } },
});
allPassed &= testInvalid("voice-license-evidence (non-official source url)", "voice-license-evidence.schema.json", {
  ...LICENSE_EVIDENCE_VALID, officialSource: { ...LICENSE_EVIDENCE_VALID.officialSource, url: "http://random-blog.example/kokoro" },
});
allPassed &= testInvalid("voice-license-evidence (bad sha256)", "voice-license-evidence.schema.json", {
  ...LICENSE_EVIDENCE_VALID, upstreamArtifact: { ...LICENSE_EVIDENCE_VALID.upstreamArtifact, sha256: "not-a-hash" },
});

// Test governance docs (1H.6/1H.7)
allPassed &= testSubSchema("governance provenanceVersion (valid minimal)", "governance.schema.json", "provenanceVersion", {
  provenanceId: "prov-0123456789ab", assetId: "as-1", provenanceVersion: 1, assetHash: null,
  originType: "GENERATED", rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "UNRESOLVED" },
  evidenceRefs: [], provenanceStatus: "MIGRATED", createdAt: "2026-10-05T00:00:00.000Z",
}, true);
allPassed &= testSubSchema("governance complianceDecision (valid minimal)", "governance.schema.json", "complianceDecision", {
  decisionId: "ccd-0123456789ab", projectId: "test", platform: "YOUTUBE", policyType: "AI_DISCLOSURE",
  policySnapshotId: "pol-0123456789ab", contentCharacteristics: { clearlyUnrealisticAnimation: true },
  decision: "AI_DISCLOSURE_NOT_REQUIRED", reason: "animation exception", evidenceRefs: [],
  decidedAt: "2026-10-05T00:00:00.000Z", freshness: "FRESH",
}, true);

console.log("\n=== Semantic Validation Layer (lib/research-quality-check.js) ===");
console.log("Layer 1 = JSON Schema (shape/type). Layer 2 = Semantic (epistemic consistency).\n");

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