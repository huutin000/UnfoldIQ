# FLOW BRIDGE TRANSPORT DECISION (POST-PHASE-2, §8.1)

**Date:** 2026-10-07
**Decision:** **KEEP_AND_HARDEN** (Option A)
**Status:** FINAL for V1

## Current transport

Loopback-only HTTP (127.0.0.1, bind-guarded) between the UNFOLDIQ web app /
agent and the Flow Companion Bridge (`flow-companion/bridge/server.js`),
guarded by:

1. **NEW — trusted-device pairing** (`lib/device-pairing`): Ed25519
   DeviceIdentity with the private key protected by Windows DPAPI
   (CurrentUser scope) via `SecretStore`; challenge–nonce–signature
   proof-of-possession (single-use, 5-minute challenges); short-lived
   runtime sessions (15-minute TTL, memory-first); exact-origin allowlist
   (`FLOW_PAIRING_ORIGINS`); disconnect / revoke / rotate / corrupted-
   credential re-pair. Legacy `x-bridge-token` continues to work as the
   developer/recovery path only (spec §10) and is never required by the
   normal flow.
2. Pre-existing hardening retained: loopback bind assertion, origin
   validation, constant-time token compare, payload schema checks, secret
   stripping/redaction, narrow route allowlist.

## Native Messaging benchmark (Option B)

Chrome Native Messaging would add: native-host manifest registration per
extension ID, installer/register/unregister path, upgrade handling, Windows
architecture handling, 1MB message-size handling, stdout protocol
correctness. Benefit: host process started *by the browser* with
`allowed_origins` bound to the exact extension ID.

## Measured/real risk assessment

- The Bridge binds loopback only; a remote attacker cannot reach it.
- The realistic web-page attack surface (cross-site requests into
  localhost) is mitigated by exact-origin allowlist + proof-of-possession
  + short-lived sessions.
- The dominant real-world pain (user-managed token UX + plaintext-ish
  persistence) is solved by the pairing layer WITHOUT a transport change.
- Honest scope note: in this V1 the proof is signed by the Bridge's own
  OS-protected key (the Bridge *is* the trusted local device component);
  webpage receives only capability/session tokens. Extension-held keys are
  a future refinement if the threat model extends to hostile local pages
  beyond the origin allowlist.

## Migration cost (Native Messaging)

Estimated: new host binary/manifest + installer + extension changes +
full live re-validation of every Flow flow — days of work and a regression
surface across all completed live evidence, to gain a boundary that the
current loopback + origin-allowlist + DPAPI design already provides for V1.

## Decision reason

KEEP_AND_HARDEN delivers every §18 security gate item with a fraction of
the migration risk. Native Messaging remains a recorded option if a future
threat model requires browser-launched host processes.

## Deferred risks

- Extension-held key material (currently Bridge-held; OS-protected).
- Native Messaging not adopted — revisit if loopback ports are ever
  blocked by enterprise policy on target machines.
