# UNFOLDIQ Topic Registry

## A. Purpose

Registry helps agent know:

- if topic was previously discovered
- if topic was selected
- if video was rendered
- if topic was published on which platform
- if new topic is truly new or just wording change
- if same topic with new angle is allowed

Registry is NOT an analytics system.

---

## B. Active Coverage Definition (MANDATORY)

The following statuses constitute **active coverage** on a target platform and block accidental duplicate production:

- `SELECTED` — topic chosen for production
- `IN_PRODUCTION` — production has started
- `RENDERED` — final video artifact rendered (blocks accidental duplicate production even if not published)
- `PUBLISHED` — user confirmed manual upload

The following statuses do NOT automatically block:

- `DISCOVERED` — candidate appeared but not selected
- `ABANDONED` — not continuing on that platform

**`RENDERED != PUBLISHED`** — Render evidence alone does not constitute publication.

However, **same topic + same angle already `RENDERED` on target platform MUST block** agent from accidentally creating another duplicate production run.

---

## B. Canonical Fingerprint

Duplicate check is NOT just title/topic string comparison.

Each topic has semantic fingerprint based on:

- `canonicalTopic`
- `subject`
- `audienceQuestion`
- `angle`
- `corePromise`
- optional `timeScope`

Example: two sentences

- `How Did Ancient Humans Protect Babies From Predators?`
- `How Prehistoric Parents Kept Infants Safe From Wild Animals`

may be same topic + same angle despite wording difference.

---

## C. Duplicate Classification

Each candidate after registry check classified as one of:

### `EXACT_DUPLICATE`
Canonical topic/fingerprint nearly identical to existing entry.

### `SAME_TOPIC_SAME_ANGLE`
Subject same and audience question/angle/core promise essentially same.

### `SAME_TOPIC_NEW_ANGLE`
Subject same but question/angle/core promise materially different.

### `NEW_TOPIC`
No material overlap with topic registry.

### `REVISIT_UPDATE`
Old topic with legitimate reason to revisit:
- new evidence
- material current development
- updated discovery
- changed law/product/event
- intentional follow-up/part 2
- user explicitly asks for update/revisit

Do NOT use `REVISIT_UPDATE` just to bypass duplicate gate.

---

## D. Duplicate Decision

After classification:

### `BLOCK`
Use when:
- `EXACT_DUPLICATE` already covered on target platform; OR
- `SAME_TOPIC_SAME_ANGLE` already covered on target platform.

### `ALLOW_CROSS_PLATFORM`
Use when:
- topic already made/published on other platform
- but target platform NOT covered
- adaptation reasonable for target platform

Example:
```
YouTube: PUBLISHED
TikTok: not covered
```
→ TikTok still allowed.

### `ALLOW_NEW_ANGLE`
Use for `SAME_TOPIC_NEW_ANGLE` when angle/value substantively different.

### `ALLOW_NEW_TOPIC`
Use for `NEW_TOPIC`.

### `ALLOW_REVISIT`
Use for `REVISIT_UPDATE` with explicit material reason.

### `REVISE`
Use when topic has high overlap but can revise angle/promise for substantive variation.

---

## E. Platform Coverage Rules

Do NOT apply rule: `done YouTube → ban TikTok`.

Check coverage PER PLATFORM.

Example:

| YouTube | TikTok | Candidate for TikTok |
|---------|--------|---------------------|
| PUBLISHED | not covered | ALLOW_CROSS_PLATFORM |
| PUBLISHED | PUBLISHED | BLOCK same topic+angle |
| RENDERED | not covered | REVIEW / ALLOW if target not covered |
| ABANDONED | not covered | ALLOW or REVISE |
| not covered | not covered | ALLOW_NEW_TOPIC |

Same topic + same angle only blocked when target platform already covered or user doesn't want repeat.

---

## F. Topic Lifecycle Status

Registry supports per-platform status:

- `DISCOVERED`
- `SELECTED`
- `IN_PRODUCTION`
- `RENDERED`
- `PUBLISHED`
- `ABANDONED`

Meaning:

### DISCOVERED
Candidate appeared but not selected.

### SELECTED
Chosen for video production.

### IN_PRODUCTION
Production started.

### RENDERED
Final video artifact rendered.

### PUBLISHED
User confirmed manual upload on that platform.

### ABANDONED
Not continuing topic on that platform.

UNFOLDIQ does NOT auto-mark `PUBLISHED` just because video rendered.

`PUBLISHED` only set when:
- user explicitly confirms; OR
- future real publishing integration provides evidence.

---

## G. Registry Update Rules

### When Topic Discovery Creates Candidates
Do NOT persist all candidates if only temporary exploration.

Persist only when:
- candidate `SELECTED`; OR
- project intentionally keeps `DISCOVERED` history.

Default Step 08:
- persist selected topic
- NOT required to save all rejected candidates

### When Selected
Target platform status: `SELECTED`

### When Production Starts
Status: `IN_PRODUCTION`

### After Final Render
Status: `RENDERED`

### After User Self-Uploads
User may request:
```
Mark TOPIC-0001 as published on TikTok.
```
Agent updates: `PUBLISHED` and `publishedAt` if user/evidence provides.

---

## H. Semantic Similarity Strategy

Step 08 does NOT integrate embeddings API.

Dedup check current approach:

1. normalized exact comparison
2. canonical field comparison
3. agent semantic comparison on:
   - subject
   - audienceQuestion
   - angle
   - corePromise
   - timeScope
4. platform coverage

Do NOT hard-code similarity threshold like `0.85`.

Future enhancement may use embeddings/vector search when registry grows.

Future options documentation:

- OpenAI embeddings: `https://developers.openai.com/api/docs/guides/embeddings`
- OpenAI semantic retrieval: `https://developers.openai.com/api/docs/guides/retrieval`

Embeddings may support semantic similarity even with different wording, but Step 08 does NOT call API.

---

## I. YouTube Repetition Note

Topic deduplication is NOT only to avoid repetitive viewer experience.

YouTube official monetization guidance emphasizes monetized content must be original/authentic and NOT mass-produced/repetitive with minimal variation.

Official source: `https://support.google.com/youtube/answer/1311392`

Registry is internal production guardrail, NOT guarantee of monetization compliance.

---

## J. Executable Module & Tests

**Decision Logic Module:** `lib/topic-registry-check.js`

Exports:
- `evaluateDuplicateDecision(input)` — evaluates duplicate decision per rules in Section D
- `canMarkPublished(input)` — publish transition guard per Section A
- `upsertTopic(topicData)` — creates/updates registry entry
- `setPlatformStatus(topicId, platform, status, metadata)` — updates platform status
- `loadRegistry()` / `saveRegistry(registry)` — registry persistence

**Test Suite:** `tests/topic/test-topic-registry.js`

Run: `node tests/topic/test-topic-registry.js`

Tests cover all decision cases:
- Case A: `ALLOW_CROSS_PLATFORM` (YouTube=PUBLISHED, TikTok absent → TikTok allowed)
- Case B: `BLOCK` target PUBLISHED (same topic+angle on target platform)
- Case B2: `BLOCK` target RENDERED (RENDERED blocks accidental duplicate)
- Case C: `ALLOW_NEW_ANGLE` (same topic, materially different angle)
- Case D: `ALLOW_REVISIT` with material reason
- Case D2: `REVISE` without material reason
- Case E: `RENDERED` does not auto-mark `PUBLISHED` (`canMarkPublished=false`)
- Case E2: `RENDERED` + explicit confirmation → `canMarkPublished=true`
- Case F: `ALLOW_NEW_TOPIC` (no existing match)
- `EXACT_DUPLICATE` cross-platform allowed
- Publish transition guards (explicit confirmation, publishing evidence, already PUBLISHED)
- `REVISIT_UPDATE` without reason → `REVISE`

Run with: `node tests/topic/test-topic-registry.js`
Exit code non-zero on any failure.