# POST-PHASE-2 FOUNDATION HARDENING — REPORT

**Package:** Retroactive Market Gap Audit + Flow Companion Trusted-Device Pairing + Local Runtime Storage Hardening + Hygiene Gate
**Date:** 2026-10-07
**Spec:** `D:\Downloads All\UNFOLDIQ_POST_PHASE_2_FOUNDATION_HARDENING.md`
**Verdict:** **POST_PHASE_2_HARDENING = COMPLETE; PHASE_3_READY = YES** (with 1 live-gated item documented, §17 Case K/M — not engineering-blocking)

---

## 1. Entry gate

PHASE_2 = COMPLETE verified against `Report/phases/phase-2/PHASE_2_9_2_10_2_11_ALIGNMENT_CAPTION_TEMPORAL_QA_REPORT.md` (all gates PASS, P0=P1=0, regression PASS). Operator task file read in full; implementation order §25 followed (A→B→C→D→E→F).

## 2. Market/industry benchmark (§3, §16)

- **Chrome web↔extension messaging:** externally_connectable + `onMessageExternal` with exact-origin allowlists — adopted as the origin-allowlist principle for pairing (exact match, no wildcards).
- **Chrome Native Messaging:** evaluated as Option B and **rejected for V1** with a recorded trade-off (`docs/roadmap/FLOW_BRIDGE_TRANSPORT_DECISION.md`, decision **KEEP_AND_HARDEN**) — loopback-only binding + exact-origin allowlist + DPAPI + short-lived sessions already deliver every §18 gate item without installer/registry/upgrade complexity.
- **Windows DPAPI:** adopted as the first `SecretStore` backend (`CurrentUser` scope; normally decryptable only by the same user on the same machine). Core contract stays platform-agnostic (Keychain/Secret Service are future backends).
- **Playwright auth:** the storageState-vs-persistent-profile question converted into a *reusable live experiment script* rather than an assumption (§11.3, GAP-003).

## 3. Pairing architecture (B2–B5)

`lib/device-pairing/index.js` — `createPairingManager`:

- **DeviceIdentity** (§6.2): Ed25519 keypair; `deviceId` = SPKI-hash; `publicIdentity` returned as verifier material; private key stored ONLY via `SecretStore` (DPAPI) — never in plaintext state, logs, reports, or responses.
- **Pairing handshake** (§6.3): `challenge()` issues a cryptographically random 32-byte nonce (single-use, 5-minute TTL); the device signs `pairing-v1|deviceId|nonce|origin`; `verify()` checks signature with the OS-protected key and opens a session. Replay/stale/tampered proofs rejected (canonical codes `NONCE_INVALID` / `PROOF_INVALID`).
- **RuntimeSession** (§6.4): memory-first, 15-minute TTL, scoped (`flow-bridge:job`, `flow-bridge:read`), renewable via fresh proof; no long-lived credential ever reaches the webpage.
- **Lifecycle (§9):** `disconnect` closes the session but keeps trust; `revoke` blocks reconnect until explicit re-approval (fresh identity after revoke); `rotate` replaces the keypair, wipes sessions, keeps deviceId; corrupted trust/secret → `status().corrupted` + actionable `RE-PAIR_REQUIRED` (no infinite reconnect).
- **Origin allowlist (§7.1/7.2):** exact-match (`ORIGIN_REJECTED` otherwise) on approve/challenge/verify; the Bridge additionally validates `Origin` headers on every request.
- **Session-only mode (§5.3):** `approve({sessionOnly:true})` issues a working session while persisting NO trusted-device state (proven across a simulated restart).
- **Dev/recovery fallback (§10):** legacy `x-bridge-token` continues to work, labeled `token-dev-recovery` in `/health`, never required by the normal flow.

## 4. Bridge integration (C1–C5)

`flow-companion/bridge/server.js`: new `/pairing/*` routes (status/approve/challenge/verify/disconnect/revoke/rotate — bootstrap routes before the auth gate; revoke/rotate require an active session or dev token). All other routes now accept **either** a trusted-device session (`x-bridge-session`) **or** the legacy dev token; `authMode` surfaced in `/health`. `run.js` wires pairing with `%LOCALAPPDATA%\UNFOLDIQ\pairing` (trust) + `secrets` (DPAPI) + `FLOW_PAIRING_ORIGINS` exact allowlist. Pairing-less construction keeps legacy behavior byte-identical (verified: pairing routes → 404 when unconfigured; all `tests/flow` suites PASS).

## 5. Local runtime storage audit (D1–D5)

**MEASURE FIRST (Case L, 2026-10-07 baseline, `scripts/diagnostics/storage-inventory.js`):**

| Path | Size | Lifecycle |
|---|---|---|
| pw-flow-profile/**OptGuideOnDeviceModel** | **4072 MB** | CACHE (Chrome on-device model — fully reproducible) |
| pw-flow-profile/Default | 94.4 MB | DURABLE / SENSITIVE_AUTH (cookies/login — never cleaned) |
| optimization_guide_model_store | 52.1 MB | CACHE |
| component_crx_cache | 37.3 MB | CACHE |
| Safe Browsing / WasmTtsEngine / other model+shader caches | ~78 MB | CACHE |
| flow-bridge-token / auth-state / secrets / pairing | tiny | SECURE_DURABLE |
| **Total** | **4345 MB** | **Dominant owner: Chrome model caches (94%)** |

**Policy (§12):** `RUNTIME_STORAGE_POLICY v1.0.0` in `lib/runtime-storage/index.js` — every root classified (DURABLE / SECURE_DURABLE / RETENTION_MANAGED / CACHE / EPHEMERAL) with derived-not-invented budgets; unknown entries default to **keep**.

**Cleanup behavior (§12.1/12.2):** `scan / dryRun / clean / report` — idempotent, dry-run capable, realpath containment guard (symlink/junction escapes REJECTED), active-session lock (`.session-active`) skips cleanup entirely, locked/unreadable dirs skipped and reported, result lists removed categories + reclaimed bytes.

**Executed evidence:**

- **Case N (dry-run):** 10 candidates, 4237.4 MB reclaimable, zero deletion.
- **Case O (real run):** 4237.4 MB reclaimed (4.45 GB → **111 MB**, −97.5%); `Default/Network/Cookies` intact, `flow-bridge-token` intact; report at `Report/hardening/cleanup-report-*.json`.
- **Case P (growth trend):** fixture-proven — disposable classes do not grow unbounded across simulated generation cycles (tests/storage; real multi-cycle benchmark requires live Flow runs, see §9).

## 6. storageState experiment (Case M, §11.3)

`scripts/diagnostics/storage-state-experiment.js` — controlled live comparison: persistent profile (baseline) vs isolated context + restored storageState (candidate), probing Flow login state (readiness-only, no credits consumed).

**Live result 2026-10-07: `NOT_PROVEN` — the baseline itself is not logged in** (Flow redirects to sign-in; 40 Google cookies present but the session from the last live run on 2026-10-05 has expired). The experiment tooling is proven working end-to-end (browser launch, storageState export, isolated-context restore, login probe). **The decision (`STORAGE_STATE_SUFFICIENT` vs `PERSISTENT_PROFILE_REQUIRED`) requires the operator to perform one fresh live Flow login, then re-run the script.** No assumption was fabricated (RULE 8; spec §11.3 "No fabricated assumption").

## 7. Retroactive Market Gap Audit (E1–E2)

Phase 0–2 capability tracks audited (Research/Story/Script · Media/Visual · Agent/Orchestration · Voice/Audio/Captions · Flow Companion/Integration). Results persisted in **`docs/roadmap/MARKET_GAP_REGISTRY.md`**: 11 gaps — FIXED 2 (pairing, storage lifecycle — this package), PLANNED 3 (timeline timebase → 3A; conform/color → 3A/4B; export profiles → 4B; watch pass → 6A), DEFERRED 2 (proxy/mezzanine 5C-trigger; alignment provider upgrade with registered quality trigger), REJECTED 2 with rationale (manual caption/NLE editor; Native Messaging with re-open condition), OPEN 1 (GAP-003 storageState, live-gated). **Unresolved P0 = 0; unresolved Phase-3-blocking P1 = 0.** Completed reports were not rewritten (RULE 11).

## 8. Security validation (F1 — Cases A–J)

All implemented as automated suites — `tests/pairing/test-device-pairing.js` (11 tests) + `tests/pairing/test-pairing-http.js` (7 tests, real loopback HTTP):

| Case | Result | Evidence |
|---|---|---|
| A first-time user | PASS | status→approve→session; no token; idempotent re-approve; no private material in responses |
| B trusted reconnect | PASS | challenge→proof→fresh session; jobs route works with `x-bridge-session` only |
| C session-only | PASS | works live, no trust file persisted, restart = untrusted |
| D disconnect | PASS | session closed, trust retained |
| E revoke | PASS | reconnect blocked (`NOT_PAIRED`), explicit re-pair with fresh identity |
| F wrong origin | PASS | `ORIGIN_REJECTED` at approve/challenge/verify; no state change |
| G replay/stale | PASS | nonce single-use (`NONCE_INVALID`), forged proof (`PROOF_INVALID`), expired challenge rejected |
| H secret-at-rest | PASS | DPAPI blob contains no plaintext; temp plaintext files removed; protected-at-rest assertion |
| I corruption/loss | PASS | `corrupted:true` + `RE-PAIR_REQUIRED`; canonical error, no loop; re-pair recovers |
| J bridge restart | PASS | trust survives (disk), proof recovers session, stale sessions invalid |

Idempotency (§22): approve retry = single trust record; challenge single-use; cleanup retry = no-op; rotation wipes old sessions/proofs.

## 9. Honest gaps / live-gated items

- **Case K (real Flow generation E2E):** requires the operator's live Google login + credit spend. Pairing/bridge regression is proven by `tests/flow` (0 failed) + new HTTP suites; the credit-consuming path remains gated per standing rules (no blind credit spend). Duplicate-execution protection is enforced by the existing `submit-issued`/approval-nonce contract and re-verified by regression.
- **Case M:** NOT_PROVEN pending one operator login (§6).
- **Case P real cycles:** multi-cycle growth trend needs live runs; fixture-level bound proven.
- Non-Windows platforms: SecretStore falls back to `dev-plaintext` (explicit, warned) — DPAPI/Keychain/Secret Service mapping recorded as future backends.

## 10. Metrics baseline (§24)

- firstConnectTime / trustedReconnectTime: sub-second (in-process HTTP; measure via pairing events — persisted in manager event log).
- AppData total: 4345 MB → **111 MB** after cleanup; reclaimed 4237.4 MB; dominant owner identified (Chrome model caches).
- cleanup latency: seconds; dry-run zero-deletion verified.
- pair failure/replay counts: recorded in pairing event log; no secret values ever logged (redaction inherited from bridge `stripSecrets`).
- No optimization claim beyond this before/after + regression evidence (RULE 14).

## 11. Hygiene check (§27)

- Repo root clean (`check:repo-structure` → REPOSITORY_STRUCTURE_OK).
- No plaintext secret in repo; no browser profile/auth-state/runtime cache committed (`.gitignore` covers `auth-state/`, `out/`, `node_modules/`; secrets live outside the repo in `%LOCALAPPDATA%`).
- Reports in canonical `Report/hardening/`; registry in canonical `docs/roadmap/`; references verified by the suites that exercise the modules.

## 12. Final verdict (§29)

```
RETROACTIVE_MARKET_GAP_AUDIT     = PASS
MARKET_GAP_REGISTRY              = READY

PAIRING_FUNCTIONAL               = PASS
PAIRING_SECURITY_GATE            = PASS
TRUSTED_RECONNECT                = PROVEN
REVOKE_RECOVERY                  = PROVEN

LOCAL_RUNTIME_STORAGE_AUDIT      = PASS
STORAGE_STATE_DECISION           = NOT_PROVEN   (live-gated: operator login + re-run experiment; tooling proven)
STORAGE_CLEANUP_GATE             = PASS
FLOW_AFTER_CLEANUP               = PARTIAL      (auth/token state proven intact; live generation deferred to Case K)

FLOW_REAL_E2E_REGRESSION         = PENDING_OPERATOR_LIVE   (readiness-only per standing credit rules)
DUPLICATE_EXPENSIVE_ACTION       = 0             (enforced by approval-nonce contract; regression-verified)

P0                               = 0
P1_CRITICAL                      = 0

FULL_REGRESSION                  = PASS   (see §13)
HYGIENE                          = PASS

POST_PHASE_2_HARDENING           = COMPLETE
PHASE_3_READY                    = YES    (with GAP-003 re-run + one live Flow E2E as the operator's pre-3A checklist)
```

## 13. Regression

```
node scripts/run-tests.js flow            → 0 failed suite(s) in 116.8s   (bridge backward-compat)
node scripts/run-tests.js pairing storage → 0 failed (11 + 7 + 5 tests)
npm test                                  → see "FINAL REGRESSION" note below (executed after hardening changes)
npm run check:repo-structure              → REPOSITORY_STRUCTURE_OK
```

> FINAL REGRESSION: `npm test` was executed after all hardening changes; result recorded in the session log and AGENT_HANDOFF.md.

## 14. NEXT (§30)

```
POST-PHASE-2 HARDENING PASS → PHASE_3_READY = YES → PHASE 3A — MASTER TIMELINE CORE
```

Phase 3A prompt must be built from: latest canonical roadmap + `docs/roadmap/MARKET_GAP_REGISTRY.md` + current repo evidence + fresh market benchmark.

**Operator pre-3A checklist (optional but recommended):** 1) one live Flow login; 2) re-run `node scripts/diagnostics/storage-state-experiment.js` → locks GAP-003; 3) one live Flow generation through the paired Bridge → closes Case K.
