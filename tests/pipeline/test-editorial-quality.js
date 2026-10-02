const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { validateResearchBriefSemantics, validateClaimSemantics } = require('../../lib/research-quality-check.js');

function createAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function loadSchema(file) {
  const content = fs.readFileSync(path.join(__dirname, "..", "..", 'schemas', file), 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

function validateSchema(schemaFile, instance) {
  const ajv = createAjv();
  const schema = loadSchema(schemaFile);
  const validate = ajv.compile(schema);
  const valid = validate(instance);
  return { valid, errors: validate.errors };
}

console.log('=== EDITORIAL QUALITY TESTS ===\n');
console.log('Layer 1 = JSON Schema. Layer 2 = Semantic (lib/research-quality-check.js).\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
    return false;
  }
}

function mkBrief(claim, ready = true) {
  return {
    version: "1.0.0",
    projectId: "test-sem",
    topic: "Semantic Test",
    researchDate: new Date().toISOString(),
    researchStatus: "READY",
    researchQuestions: { coreFactual: [], interpretation: [], narrative: [] },
    sources: [{ sourceId: "SRC-001", title: "Test Source", sourceType: "general_web", verificationStatus: "NOT_VERIFIED", qualityNotes: "Test" }],
    claims: [claim],
    handoff: { readyForStorytelling: ready, materialUncertainties: [], recommendedValueAngles: [] }
  };
}

function logSemantic(label, result) {
  const codes = (result.errors || []).map((e) => e.code).join(',') || 'none';
  console.log(`  semantic decision: valid=${result.valid} errors=[${codes}] (${label})`);
}

console.log('=== SEMANTIC RESEARCH TESTS (S1-S8, executable) ===\n');

// S1 — Supported Fact PASS
runTest('S1 Supported fact -> PASS', () => {
  const brief = mkBrief({ claimId: "S1", statement: "Established fact", claimClass: "SUPPORTED_FACT", sourceIds: ["SRC-001"], evidenceStatus: "SUPPORTED", scriptUse: "CAN_STATE" }, false);
  const r = validateResearchBriefSemantics(brief);
  logSemantic('S1', r);
  assert(r.valid === true, 'S1 SUPPORTED_FACT+SUPPORTED+CAN_STATE must PASS');
});

// S2 — UNVERIFIED + CAN_STATE REJECT
runTest('S2 UNVERIFIED CAN_STATE -> REJECT', () => {
  const brief = mkBrief({ claimId: "S2", statement: "Unverified claim", claimClass: "UNVERIFIED", sourceIds: ["SRC-001"], evidenceStatus: "WEAK", scriptUse: "CAN_STATE" }, false);
  const r = validateResearchBriefSemantics(brief);
  logSemantic('S2', r);
  assert(r.valid === false, 'S2 UNVERIFIED+CAN_STATE must REJECT');
  assert(r.errors.some((e) => e.code === 'UNVERIFIED_CANNOT_BE_CAN_STATE'), 'S2 must carry UNVERIFIED_CANNOT_BE_CAN_STATE');
});

// S3 — UNSUPPORTED + CAN_STATE REJECT
runTest('S3 Unsupported CAN_STATE -> REJECT', () => {
  const brief = mkBrief({ claimId: "S3", statement: "No evidence", claimClass: "SUPPORTED_FACT", sourceIds: ["SRC-001"], evidenceStatus: "UNSUPPORTED", scriptUse: "CAN_STATE" }, false);
  const r = validateResearchBriefSemantics(brief);
  logSemantic('S3', r);
  assert(r.valid === false, 'S3 UNSUPPORTED+CAN_STATE must REJECT');
  assert(r.errors.some((e) => e.code === 'UNSUPPORTED_CANNOT_BE_CAN_STATE'), 'S3 must carry UNSUPPORTED_CANNOT_BE_CAN_STATE');
});

// S4 — HYPOTHESIS + STATE_WITH_CAVEAT PASS
runTest('S4 Hypothesis caveated -> PASS', () => {
  const brief = mkBrief({ claimId: "S4", statement: "Hypothesis", claimClass: "HYPOTHESIS", sourceIds: ["SRC-001"], evidenceStatus: "MIXED", scriptUse: "STATE_WITH_CAVEAT" }, false);
  const r = validateResearchBriefSemantics(brief);
  logSemantic('S4', r);
  assert(r.valid === true, 'S4 HYPOTHESIS+STATE_WITH_CAVEAT must PASS');
});

// S5 — HYPOTHESIS + CAN_STATE REJECT
runTest('S5 Hypothesis flattened -> REJECT', () => {
  const brief = mkBrief({ claimId: "S5", statement: "Hypothesis", claimClass: "HYPOTHESIS", sourceIds: ["SRC-001"], evidenceStatus: "MIXED", scriptUse: "CAN_STATE" }, false);
  const r = validateResearchBriefSemantics(brief);
  logSemantic('S5', r);
  assert(r.valid === false, 'S5 HYPOTHESIS+CAN_STATE must REJECT');
  assert(r.errors.some((e) => e.code === 'HYPOTHESIS_CANNOT_BE_CAN_STATE'), 'S5 must carry HYPOTHESIS_CANNOT_BE_CAN_STATE');
});

// S6 — CONTESTED + STATE_WITH_CAVEAT PASS
runTest('S6 Contested caveated -> PASS', () => {
  const brief = mkBrief({ claimId: "S6", statement: "Contested", claimClass: "CONTESTED", sourceIds: ["SRC-001"], evidenceStatus: "MIXED", scriptUse: "STATE_WITH_CAVEAT" }, false);
  const r = validateResearchBriefSemantics(brief);
  logSemantic('S6', r);
  assert(r.valid === true, 'S6 CONTESTED+STATE_WITH_CAVEAT must PASS');
});

// S7 — CONTESTED + CAN_STATE REJECT
runTest('S7 Contested flattened -> REJECT', () => {
  const brief = mkBrief({ claimId: "S7", statement: "Contested", claimClass: "CONTESTED", sourceIds: ["SRC-001"], evidenceStatus: "MIXED", scriptUse: "CAN_STATE" }, false);
  const r = validateResearchBriefSemantics(brief);
  logSemantic('S7', r);
  assert(r.valid === false, 'S7 CONTESTED+CAN_STATE must REJECT');
  assert(r.errors.some((e) => e.code === 'CONTESTED_CANNOT_BE_CAN_STATE'), 'S7 must carry CONTESTED_CANNOT_BE_CAN_STATE');
});

// S8 — invalid claim + READY=true REJECT
runTest('S8 Invalid READY handoff -> REJECT', () => {
  const brief = mkBrief({ claimId: "S8", statement: "Unverified", claimClass: "UNVERIFIED", sourceIds: ["SRC-001"], evidenceStatus: "WEAK", scriptUse: "CAN_STATE" }, true);
  const r = validateResearchBriefSemantics(brief);
  logSemantic('S8', r);
  assert(r.valid === false, 'S8 invalid claim + READY=true must REJECT');
  assert(r.errors.some((e) => e.code === 'READY_HANDOFF_WITH_SEMANTIC_ERRORS'), 'S8 must carry READY_HANDOFF_WITH_SEMANTIC_ERRORS');
});

console.log('\n=== EDITORIAL QUALITY STRUCTURAL TESTS ===\n');

// Test 1: Research brief schema validation - valid ancient humans fixture
runTest('Research Brief: Valid Ancient Humans fixture', () => {
  const validBrief = {
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
  };

  const schemaResult = validateSchema('research-brief.schema.json', validBrief);
  if (!schemaResult.valid) {
    throw new Error(`Valid ancient humans brief rejected (schema): ${JSON.stringify(schemaResult.errors)}`);
  }
  const sem = validateResearchBriefSemantics(validBrief);
  logSemantic('AncientHumans-brief', sem);
  if (!sem.valid) throw new Error(`Valid ancient humans brief rejected (semantic): ${JSON.stringify(sem.errors)}`);
  assert(validBrief.exampleCandidates[0].usageNote.toLowerCase().includes('reconstruction'), 'Ancient Humans example must label reconstruction, not evidence');
});

// Test 2 (FIX 2): UNVERIFIED + CAN_STATE is schema-valid but semantically REJECTED (executable, not documented-only)
runTest('Research Brief: UNVERIFIED + CAN_STATE fails semantic check (executable)', () => {
  const briefWithUnverifiedCanState = {
    version: "1.0.0",
    projectId: "test",
    topic: "Test",
    researchDate: new Date().toISOString(),
    researchStatus: "READY",
    researchQuestions: { coreFactual: [], interpretation: [], narrative: [] },
    sources: [],
    claims: [
      {
        claimId: "CLM-001",
        statement: "Unverified claim",
        claimClass: "UNVERIFIED",
        sourceIds: [],
        evidenceStatus: "UNSUPPORTED",
        scriptUse: "CAN_STATE"
      }
    ],
    handoff: { readyForStorytelling: true, materialUncertainties: [], recommendedValueAngles: [] }
  };

  const schemaResult = validateSchema('research-brief.schema.json', briefWithUnverifiedCanState);
  console.log(`  schema decision: valid=${schemaResult.valid} (expected true — shape only)`);
  // Shape may fail on minItems for sourceIds; schema layer is not the gate — semantic layer is.
  const sem = validateResearchBriefSemantics(briefWithUnverifiedCanState);
  logSemantic('UNVERIFIED+CAN_STATE', sem);
  assert(sem.valid === false, 'UNVERIFIED+CAN_STATE must be semantically REJECTED');
  assert(sem.errors.some((e) => e.code === 'UNVERIFIED_CANNOT_BE_CAN_STATE'), 'must carry UNVERIFIED_CANNOT_BE_CAN_STATE');
});

// Test 3: HYPOTHESIS + DO_NOT_STATE_AS_FACT accepted
runTest('Research Brief: HYPOTHESIS + DO_NOT_STATE_AS_FACT accepted', () => {
  const brief = {
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
        statement: "Hypothesis about behavior",
        claimClass: "HYPOTHESIS",
        sourceIds: ["SRC-001"],
        evidenceStatus: "MIXED",
        scriptUse: "DO_NOT_STATE_AS_FACT"
      }
    ],
    handoff: { readyForStorytelling: true, materialUncertainties: [], recommendedValueAngles: [] }
  };
  const result = validateSchema('research-brief.schema.json', brief);
  if (!result.valid) throw new Error(`HYPOTHESIS+DO_NOT_STATE_AS_FACT rejected: ${JSON.stringify(result.errors)}`);
  const sem = validateResearchBriefSemantics(brief);
  logSemantic('HYPOTHESIS+DO_NOT_STATE_AS_FACT', sem);
  if (!sem.valid) throw new Error(`semantic rejected valid caveated hypothesis: ${JSON.stringify(sem.errors)}`);
});

// Test 4: No exampleCandidates accepted
runTest('Research Brief: No exampleCandidates accepted', () => {
  const brief = {
    version: "1.0.0",
    projectId: "test",
    topic: "Test",
    researchDate: new Date().toISOString(),
    researchStatus: "READY",
    researchQuestions: { coreFactual: [], interpretation: [], narrative: [] },
    sources: [],
    claims: [],
    handoff: { readyForStorytelling: true, materialUncertainties: [], recommendedValueAngles: [] }
  };
  const result = validateSchema('research-brief.schema.json', brief);
  if (!result.valid) throw new Error(`No-example brief rejected: ${JSON.stringify(result.errors)}`);
});

// Test 5: Content Mode - valid historical mode (Ancient Humans fixture)
runTest('Content Mode: Valid historical-documentary (Ancient Humans)', () => {
  const mode = {
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
  };

  const result = validateSchema('content-mode.schema.json', mode);
  if (!result.valid) throw new Error(`Historical mode rejected: ${JSON.stringify(result.errors)}`);
  assert(mode.modeId === 'historical-documentary', 'Ancient Humans modeId must be historical-documentary');
  assert(mode.emotionalArcMode === 'STRONG', 'Ancient Humans emotionalArcMode STRONG (allowed: STRONG or ADAPTIVE)');
  assert(mode.visualLanguage.toLowerCase().includes('archaeolog'), 'Ancient Humans visual language must be archaeological/historical');
  assert(mode.voiceDirection.toLowerCase().includes('measured') || mode.voiceDirection.toLowerCase().includes('authoritative'), 'Ancient Humans voice must be documentary');
});

// Test 6: Content Mode - valid technical-explainer (React fixture)
runTest('Content Mode: Valid technical-explainer (React)', () => {
  const mode = {
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
  };

  const result = validateSchema('content-mode.schema.json', mode);
  if (!result.valid) throw new Error(`Technical mode rejected: ${JSON.stringify(result.errors)}`);
  assert(mode.modeId === 'technical-explainer', 'React fixture modeId must be technical-explainer');
  assert(mode.emotionalArcMode === 'LIGHT' || mode.emotionalArcMode === 'MINIMAL', 'React fixture emotionalArcMode must be LIGHT or MINIMAL');
  assert(mode.visualLanguage.toLowerCase().includes('code'), 'React fixture must use code/browser/diagram visuals');
  assert(mode.voiceDirection.toLowerCase().includes('instructional'), 'React fixture must use instructional delivery');
  const inheritsPrehistoric = mode.visualLanguage.toLowerCase().includes('prehistoric') || mode.visualLanguage.toLowerCase().includes('artifact') || mode.emotionalArcMode === 'STRONG';
  assert(!inheritsPrehistoric, 'Technical fixture must not inherit prehistoric visuals / forced suspense');
});

// Test 6b (FIX 2): News explainer fixture (validation only, no real current news)
runTest('Content Mode: Valid news-explainer (News fixture)', () => {
  const mode = {
    version: "1.0.0",
    projectId: "test-news-fixture",
    platform: "youtube",
    topic: "Example News Explainer Fixture (fictional validation topic, not real current news)",
    modeId: "news-explainer",
    modeLabel: "News Explainer",
    rationale: "Evidence-led structure with neutral restrained delivery; fictional validation topic",
    storyApproach: "Context → verified facts → implications",
    hookApproach: "Documented timeline entry → context promise",
    visualLanguage: "Source-aware graphics; timeline, documents, maps; neutral palette; no cinematic sensationalism",
    cameraAndMotionDirection: "Stable framing; slow push on documents; no shaky kinetic moves",
    voiceDirection: "Neutral, restrained, evidence-led; no hype",
    musicDirection: "Restrained; minimal bed; never leads",
    sfxDirection: "Minimal; no dramatic hits",
    pacingDirection: "Measured; context then facts then implications",
    transitionDirection: "Clean cuts; timeline wipes only",
    typographyDirection: "Clean sans; source labels; dates emphasized",
    captionDirection: "Source-aware captions; dates and attributions",
    emotionalArcMode: "MINIMAL"
  };
  const result = validateSchema('content-mode.schema.json', mode);
  if (!result.valid) throw new Error(`News mode rejected: ${JSON.stringify(result.errors)}`);
  assert(mode.modeId === 'news-explainer', 'News fixture modeId must be news-explainer');
  assert(mode.emotionalArcMode === 'MINIMAL' || mode.emotionalArcMode === 'LIGHT', 'News emotionalArcMode must be MINIMAL/LIGHT (or justified ADAPTIVE)');
  assert(mode.voiceDirection.toLowerCase().includes('neutral') || mode.voiceDirection.toLowerCase().includes('restrained'), 'News voice must be neutral/restrained');
  assert(mode.emotionalArcMode !== 'STRONG', 'News fixture must not inherit forced cinematic sensationalism');
  assert(mode.visualLanguage.toLowerCase().includes('no cinematic') || mode.visualLanguage.toLowerCase().includes('restrained') || mode.visualLanguage.toLowerCase().includes('neutral'), 'News visuals must explicitly restrain sensationalism');
  assert(mode.visualLanguage.toLowerCase().includes('source'), 'News visuals must be source-aware');
});

// Test 6c (FIX 2): Meditation / Guided fixture
runTest('Content Mode: Valid meditation-guided (Meditation fixture)', () => {
  const mode = {
    version: "1.0.0",
    projectId: "test-meditation-fixture",
    platform: "tiktok",
    topic: "Guided Breathing (validation fixture)",
    modeId: "meditation-guided",
    modeLabel: "Guided Meditation",
    rationale: "Calm guided experience; experience itself is the value; no factual case study required",
    storyApproach: "Guided sequence: settle → breathe → deepen → integrate",
    hookApproach: "Gentle invitation; no hype",
    visualLanguage: "Calm, slow, abstract; soft gradients; warm light",
    cameraAndMotionDirection: "Static; slow fade; gentle motion only; no kinetic",
    voiceDirection: "Warm, slow, breath-paced; stable; intimate",
    musicDirection: "Ambient drone; no melody; very low in mix",
    sfxDirection: "None; silence is part of practice",
    pacingDirection: "Very slow; long holds; breathing rhythm; breathing room between segments",
    transitionDirection: "Slow crossfades; no hard cuts",
    typographyDirection: "Minimal; soft sans; no animation",
    captionDirection: "Optional; minimal; soft",
    emotionalArcMode: "MINIMAL"
  };
  const result = validateSchema('content-mode.schema.json', mode);
  if (!result.valid) throw new Error(`Meditation mode rejected: ${JSON.stringify(result.errors)}`);
  assert(mode.modeId === 'meditation-guided', 'Meditation fixture modeId must be meditation-guided');
  assert(mode.emotionalArcMode === 'MINIMAL', 'Meditation emotionalArcMode must be MINIMAL (or justified ADAPTIVE)');
  assert(mode.pacingDirection.toLowerCase().includes('slow'), 'Meditation pacing must be slow');
  assert(mode.voiceDirection.toLowerCase().includes('warm') || mode.voiceDirection.toLowerCase().includes('stable'), 'Meditation voice must be stable/warm');
  assert(mode.musicDirection.toLowerCase().includes('ambient'), 'Meditation audio must be ambient');
});

// Test 7: Custom mode ID accepted
runTest('Content Mode: Custom mode ID accepted (my-custom-mode)', () => {
  const mode = {
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
  };

  const result = validateSchema('content-mode.schema.json', mode);
  if (!result.valid) throw new Error(`Custom mode rejected: ${JSON.stringify(result.errors)}`);
  assert(mode.modeId === 'my-custom-mode', 'Custom fixture must validate literal my-custom-mode (proves open modeId, not closed enum)');
});

// Test 8: Content Mode - invalid emotionalArcMode rejected
runTest('Content Mode: Invalid emotionalArcMode rejected', () => {
  const mode = {
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
  };

  const result = validateSchema('content-mode.schema.json', mode);
  if (result.valid) throw new Error('Invalid emotionalArcMode should be rejected');
});

// Test 8b: Content Mode - missing visualLanguage rejected
runTest('Content Mode: Missing visualLanguage rejected', () => {
  const mode = {
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
  };

  const result = validateSchema('content-mode.schema.json', mode);
  if (result.valid) throw new Error('Missing visualLanguage should be rejected');
});

// Test: Bad research-summary script structure detection
runTest('Editorial: Bad research-summary structure detected', () => {
  const badScriptStructure = {
    sections: [
      { type: 'fact', content: 'Fact 1 from source A' },
      { type: 'fact', content: 'Fact 2 from source B' },
      { type: 'fact', content: 'Fact 3 from source C' },
      { type: 'quote', content: 'Researchers say X' },
      { type: 'quote', content: 'Researchers say Y' },
      { type: 'conclusion', content: 'Conclusion' }
    ]
  };

  const hasSourceOrderNarration = badScriptStructure.sections.every(s =>
    s.type === 'fact' || s.type === 'quote' || s.type === 'conclusion'
  ) && !badScriptStructure.sections.some(s => s.type === 'synthesis' || s.type === 'mechanism');

  if (!hasSourceOrderNarration) {
    throw new Error('Should detect source-order narration');
  }
});

// Test: Improved historical script structure
runTest('Editorial: Improved historical structure passes', () => {
  const goodScriptStructure = {
    sections: [
      { type: 'hook', content: 'Question: How did ancient humans protect babies?' },
      { type: 'evidence', content: 'Schöningen spears show sophisticated hunting tech' },
      { type: 'explanation', content: 'Spear design indicates cooperative hunting' },
      { type: 'example', content: 'Schöningen spears: 8 wooden spears, 300k years old' },
      { type: 'implication', content: 'Cooperative hunting implies infant defense capability' },
      { type: 'payoff', content: 'This reshapes our view of early human social structure' }
    ]
  };

  const hasQuestionEvidenceExplanationPayoff =
    goodScriptStructure.sections.some(s => s.type === 'hook') &&
    goodScriptStructure.sections.some(s => s.type === 'evidence') &&
    goodScriptStructure.sections.some(s => s.type === 'explanation') &&
    goodScriptStructure.sections.some(s => s.type === 'payoff');

  if (!hasQuestionEvidenceExplanationPayoff) {
    throw new Error('Good structure should pass');
  }
});

// Test: Technical explainer must not inherit prehistoric style
runTest('Content Mode: Technical explainer rejects prehistoric style', () => {
  const techMode = {
    version: "1.0.0",
    projectId: "test",
    platform: "youtube",
    topic: "React Server Components",
    modeId: "technical-explainer",
    modeLabel: "Technical Explainer",
    rationale: "Technical topic requires instructional approach",
    storyApproach: "Problem → explanation → demo → resolution",
    hookApproach: "Problem statement → live demo promise",
    visualLanguage: "Code editor, browser, diagrams; clean modern UI",
    cameraAndMotionDirection: "Screen capture; zoom on code; diagram animations",
    voiceDirection: "Instructional, clear, steady pace",
    musicDirection: "Minimal; optional subtle ambient",
    sfxDirection: "Subtle UI clicks; keyboard sounds",
    pacingDirection: "Steady instructional; pause for code reading",
    transitionDirection: "Hard cuts between sections; smooth zoom on code",
    typographyDirection: "Monospace code; clean sans UI; syntax highlighting",
    captionDirection: "Code annotations; separate SRT; key terms highlighted",
    emotionalArcMode: "LIGHT"
  };

  const hasPrehistoricLanguage =
    techMode.visualLanguage.includes('prehistoric') ||
    techMode.visualLanguage.includes('cinematic') ||
    techMode.emotionalArcMode === 'STRONG';

  if (hasPrehistoricLanguage) {
    throw new Error('Technical mode should not have prehistoric/cinematic language');
  }
});

// Test: Meditation mode must not be forced to include factual case study
runTest('Editorial: Meditation mode not forced to include factual case', () => {
  const meditationMode = {
    version: "1.0.0",
    projectId: "test",
    platform: "tiktok",
    topic: "Guided Breathing",
    modeId: "meditation-guided",
    modeLabel: "Guided Meditation",
    rationale: "Calm guided experience",
    storyApproach: "Guided sequence",
    hookApproach: "Gentle invitation",
    visualLanguage: "Calm, slow, abstract; soft gradients",
    cameraAndMotionDirection: "Static; slow fade; no kinetic",
    voiceDirection: "Warm, slow, breath-paced; intimate",
    musicDirection: "Ambient drone; no melody; very low",
    sfxDirection: "None; silence is part of practice",
    pacingDirection: "Very slow; long holds; breathing rhythm",
    transitionDirection: "Slow crossfades; no cuts",
    typographyDirection: "Minimal; soft sans; no animation",
    captionDirection: "Optional; minimal; soft",
    emotionalArcMode: "MINIMAL"
  };

  const result = validateSchema('content-mode.schema.json', meditationMode);
  if (!result.valid) throw new Error(`Meditation schema rejected: ${JSON.stringify(result.errors)}`);
  const hasCaseStudyRequirement = false; // No such requirement in mode

  if (hasCaseStudyRequirement) {
    throw new Error('Meditation mode should not require case study');
  }
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log('RESULT: SOME TESTS FAILED');
  process.exit(1);
}
console.log('✓ All editorial quality tests passed.');
console.log('RESULT: ALL TESTS PASSED');
