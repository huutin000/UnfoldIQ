# Policy Snapshots

Snapshots store **normalized policy state + source metadata**, not full scraped
copies of webpages (do not store scraped copies unless needed and lawful).

Each snapshot validates against `schemas/policy-snapshot.schema.json` and carries:

- `snapshotId`, `platform`, `categories[]`
- `verifiedAt`, `verificationStatus` (`LIVE_VERIFIED` | `SNAPSHOT_ONLY` | `NOT_VERIFIED`)
- `sourceRefs[]`, optional `observedUpdateDate`, `normalizedRulesVersion`
- `rules[]` with per-rule `axis`, `category`, `summary`, `decisionLogic`, `sourceIds[]`

Freshness is evaluated by `lib/policy-state-check.js` against the configurable
project value `policyMaxAgeDays` (a PROJECT DEFAULT, not a platform fact).
A file merely existing never proves currentness.

No snapshots are checked in yet. When the agent live-verifies an official source,
it records a snapshot here and appends verified changes to `policy/CHANGELOG.md`.
