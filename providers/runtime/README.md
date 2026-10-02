# UNFOLDIQ Universal Provider Runtime (STEP 10A)

Vendor-neutral asset generation. Core workflow never knows vendor details:

```text
Asset Requirement → Provider Request → Resolver → Adapter
→ Persistent Artifact → Provider Result
```

## Modules

| File | Role |
|---|---|
| `registry.js` | Dynamic provider registration (`registerProvider`/`getProvider`/`listProviders`). No vendor logic. |
| `resolver.js` | Priority → cost → availability → execute → validate. BLOCKED never bypassed. Bounded transient retry. Fingerprint reuse. |
| `artifact-store.js` | Project-scoped paths, traversal guard, atomic writes, fingerprint index. |
| `request-fingerprint.js` | Material-input SHA-256 fingerprint for idempotency. |
| `cost-policy.js` | `ZERO_LOCAL`…`PAID` classes; paid cloud disabled by default. |
| `errors.js` | `ProviderError` with `transient`/`permanent`/`policy`/`unavailable` classes. |
| `adapters/existing.js` | Reuse project artifacts (READY only if valid). |
| `adapters/approved-local.js` | Pre-cleared library (`assets/approved-local.json`). UNKNOWN/UNVERIFIED rights never READY. |
| `adapters/agent-native.js` | Bridge contract only; default `NOT_AVAILABLE` without injected bridge. |
| `adapters/external-handoff.js` | Persistent `projects/<projectId>/handoff/<requestId>.json`; returns `HANDOFF_REQUIRED`. |

## Status Model

`READY` (persistent artifact + structural validation) · `FAILED` (technical) ·
`BLOCKED` (policy/rights/validation) · `NOT_AVAILABLE` · `HANDOFF_REQUIRED` ·
`AWAITING_USER_APPROVAL` (quota/credit or external action needs user approval).

## Notes

- Step 10A registers only the 4 foundation adapters. Flow/local/cloud vendor
  adapters arrive in 10B/10C via `registerProvider` without resolver changes.
- Provider requests carry normalized summaries only — never full Markdown docs,
  never image binary/base64, never secrets.
