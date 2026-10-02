# UNFOLDIQ Policy Router (STEP 09 V2)

## The 4 Axes (never collapse into one boolean)

| Axis | Question |
|---|---|
| `PLATFORM_ALLOWEDNESS` | Can this content be uploaded/kept under Community Guidelines? |
| `RIGHTS` | Do we have a valid basis to use visuals/audio/text/likeness? |
| `AI_TRANSPARENCY` | Does the platform require AI/altered-content disclosure? |
| `MONETIZATION_AD_SUITABILITY` | Is the content potentially advertiser/monetization eligible? |

Each axis decides independently: `PASS` | `REVIEW_REQUIRED` | `BLOCKED` | `NOT_APPLICABLE`.

Example (valid — axes stay separate):

```text
PLATFORM_ALLOWEDNESS = PASS
RIGHTS = PASS
AI_TRANSPARENCY = REQUIRED (user label/disclosure action)
MONETIZATION_AD_SUITABILITY = REVIEW_REQUIRED
```

## Dynamic Category Detection

Select relevant categories from topic, research brief, content mode, script,
scene/asset plan, and platform. Conditional categories include:

- violence / graphic content
- child safety
- medical / health misinformation
- dangerous activity
- self-harm
- hate / harassment
- regulated goods
- drugs
- adult/sensitive content
- public figures
- misinformation
- elections/civic integrity
- impersonation
- privacy
- AI-generated/edited media
- unoriginal/reused content
- copyright/IP

Do NOT load every detailed policy page for every video. Route, don't blanket-load.

## Category Routing Examples

### Ancient Humans (e.g. historical-documentary)
Core: rights, AI transparency, reconstruction, originality.
Conditional: violence / young-person distress if scenes require; graphic/death content; advertiser-friendly policy.

### React Tutorial (e.g. technical-explainer)
Core: rights, AI transparency if relevant, originality.
Normally do NOT load: violence, medical, self-harm.

### Medical Topic
Add: health/medical misinformation, harmful advice, platform-specific health rules.

### News
Add as relevant: misinformation, public figures, synthetic media, violence/sensitive events, advertiser suitability.

## Freshness Rules

- Official current sources override normalized snapshots.
- Never claim `LIVE_VERIFIED` without live verification.
- Stale or snapshot-only critical policy → `PUBLISH_REVIEW_REQUIRED`, never silent current-policy claims.
- See `lib/policy-state-check.js` for the executable freshness model.
