# Video Production Agent Context Gate

## Purpose

Every Agent task that can directly or indirectly affect video/content output
must pass this gate before execution.

## Canonical Sources

1. YOUTUBE_PROMPT_FILE_BASED_INTEGRATION_HANDOFF.md
2. YOUTUBE_9_PROMPTS_V2_AUDIT_AND_REWRITE.md
3. YOUTUBE_9_PROMPTS_V2_CLEAN.md
4. YOUTUBE_POLICY_MONETIZATION_GATE.md

## Trigger

The gate is required for:
- research
- niche/competitor analysis
- strategy
- idea generation/validation
- packaging
- title/thumbnail
- script
- scene/shot planning
- Visual Bible / Visual Blueprint
- image or motion prompt
- generation
- voice/narration content
- asset sourcing / rights
- production review
- pre-publish QA
- metadata/publish
- analytics/V2
- regeneration
- any technical change that changes production logic or video output

The gate is not required for purely unrelated technical maintenance such as
CSS spacing, backup tooling, or unrelated logging, unless that change modifies
production behavior or output.

## Required Preflight Output

VIDEO_AFFECTING_TASK: YES / NO

WORKFLOW_STAGE:
- RESEARCH
- STRATEGY
- IDEA
- PACKAGING
- SCRIPT
- PRODUCTION
- QA
- PUBLISH
- MEASURE
- GENERATION
- OTHER

RELEVANT_PROMPT:
- #1 ... #9
- NONE

RELEVANT_POLICY:
- only materially relevant policy categories

PROJECT_CONTEXT:
- LOADED
- NOT_REQUIRED
- MISSING

HUMAN_GATE_REQUIRED:
- YES
- NO

PROVENANCE_REQUIRED:
- YES
- NO

## Runtime Rule

Consult the full governance bundle for governance understanding.

For an actual LLM task, load:
- one relevant prompt;
- required project/user context;
- only materially relevant policy sections.

Do not inject all nine prompts and the entire policy into every request.

## Failure Rule

If VIDEO_AFFECTING_TASK = YES and the canonical governance bundle cannot be
read or required project context is missing:

STOP
MISSING_REQUIRED_PRODUCTION_CONTEXT

Do not guess missing governance.

## Human Control

Human approval remains required for:
- final script approval/lock;
- high-cost generation unless user has explicitly authorized an automation policy;
- rights/policy-sensitive uncertainty;
- final publication decision.
