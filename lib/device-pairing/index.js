"use strict";

/**
 * POST-PHASE-2 B2/B4/B5 — Trusted-device pairing (UNFOLDIQ CORE).
 *
 * Replaces "bearer token as a user concept" with:
 *   DEVICE IDENTITY (Ed25519 keypair; private key OS-protected via SecretStore)
 * + PROOF OF POSSESSION (challenge nonce signed by the device key)
 * + SHORT-LIVED RUNTIME SESSION (memory-first, bounded TTL).
 *
 * The webpage receives a capability/session token — never the private
 * secret. Challenges are cryptographically random, single-use and
 * short-lived (replay/stale rejected). Disconnect closes the session but
 * keeps trust; Revoke blocks reconnect until explicit re-approval; Rotate
 * invalidates old proof material.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { createSecretStore, randomToken } = require("./secret-store.js");

const SCHEMA_VERSION = "1.0.0";
const CONTRACT_VERSION = "pairing-v1";
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TRUST_FILE = "trusted-device.json";
const SECRET_KEY = "device-private-key";

const ERRORS = {
  ORIGIN_REJECTED: "origin is not in the exact allowlist",
  NOT_PAIRED: "no trusted device — explicit approval required",
  TRUST_REVOKED: "trusted device revoked — re-pair required",
  DEVICE_MISMATCH: "deviceId does not match the trusted device",
  NONCE_INVALID: "challenge nonce unknown, expired or already used (replay rejected)",
  PROOF_INVALID: "proof-of-possession signature verification failed",
  CREDENTIAL_CORRUPTED: "device credential corrupted or unreadable — re-pair required",
  SESSION_INVALID: "runtime session unknown or expired",
  ORIGIN_MISMATCH: "origin does not match the trusted device origin",
  ALREADY_PAIRED: "trusted device already exists — revoke first to re-pair",
};

function exactOriginAllowed(origin, allowedOrigins) {
  if (!origin || !Array.isArray(allowedOrigins)) return false;
  return allowedOrigins.includes(origin);
}

function canonicalProof(deviceId, nonce, origin) {
  return `${CONTRACT_VERSION}|${deviceId}|${nonce}|${origin}`;
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Pairing manager. stateDir holds the trust record (public metadata);
 * secretStore holds the OS-protected private key. Sessions are memory-first.
 */
function createPairingManager({
  stateDir,
  secretStore,
  allowedOrigins,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  challengeTtlMs = DEFAULT_CHALLENGE_TTL_MS,
  now = () => Date.now(),
  events = [],
} = {}) {
  if (!stateDir) throw new Error("STATE_DIR_REQUIRED");
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new Error("ORIGIN_ALLOWLIST_REQUIRED");
  const store = secretStore || createSecretStore({ backend: "memory" });
  fs.mkdirSync(stateDir, { recursive: true });
  const trustFile = path.join(stateDir, TRUST_FILE);
  const challenges = new Map(); // nonce → { deviceId, origin, expiresAt }
  const sessions = new Map(); // sessionToken → session

  function recordEvent(type, attrs) {
    events.push({ type, at: new Date().toISOString(), ...attrs });
  }

  function readTrust() {
    if (!fs.existsSync(trustFile)) return { ok: true, trust: null };
    try {
      const trust = JSON.parse(fs.readFileSync(trustFile, "utf8"));
      if (!trust || trust.deviceId === undefined) return { ok: true, trust: null, corrupted: true };
      return { ok: true, trust };
    } catch {
      return { ok: true, trust: null, corrupted: true };
    }
  }

  function writeTrustAtomic(trust) {
    const tmp = `${trustFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(trust, null, 2), "utf8");
    fs.renameSync(tmp, trustFile);
  }

  function generateIdentity() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const deviceId = `dev-${sha256Hex(publicKey.export({ type: "spki", format: "der" })).slice(0, 12)}`;
    const put = store.put(SECRET_KEY, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    if (!put.ok) throw new Error("SECRET_STORE_PUT_FAILED");
    return {
      deviceId,
      publicIdentity: publicKey.export({ type: "spki", format: "pem" }).toString(),
      createdAt: new Date().toISOString(),
    };
  }

  function loadPrivateKey() {
    const got = store.get(SECRET_KEY);
    if (!got.ok) return { ok: false, code: got.code };
    try {
      return { ok: true, key: crypto.createPrivateKey(got.value) };
    } catch {
      return { ok: false, code: "CREDENTIAL_CORRUPTED" };
    }
  }

  return {
    CONTRACT_VERSION,
    SCHEMA_VERSION,
    /** Non-secret pairing status for UI. */
    status() {
      const r = readTrust();
      const trust = r.trust;
      if (r.corrupted || (trust && !store.get(SECRET_KEY).ok)) {
        return { paired: false, corrupted: true, actionable: "RE-PAIR_REQUIRED: credential corrupted — approve again to re-pair" };
      }
      return {
        paired: !!trust && !trust.revokedAt,
        ...(trust ? { deviceId: trust.deviceId, origin: trust.origin, trustedSince: trust.createdAt, rotatedAt: trust.rotatedAt || null } : {}),
        authModes: ["device-session", "token-dev-recovery"],
        contractVersion: CONTRACT_VERSION,
      };
    },

    /**
     * The one explicit product-level approval. Idempotent for the same
     * origin; a second approve for a DIFFERENT origin requires revoke first.
     * sessionOnly:true issues a session WITHOUT persisting trust (§5.3).
     */
    approve({ origin, sessionOnly = false }) {
      if (!exactOriginAllowed(origin, allowedOrigins)) {
        recordEvent("PAIR_APPROVE_REJECTED", { reason: "ORIGIN_REJECTED", origin });
        return { ok: false, code: "ORIGIN_REJECTED" };
      }
      const r = readTrust();
      if (r.corrupted) {
        // Recovery path (§9/Case I): corrupted credential → fresh identity.
        store.delete(SECRET_KEY);
      } else if (r.trust && !r.trust.revokedAt) {
        if (r.trust.origin === origin) {
          // Idempotent: same trusted device — just open a new session.
          const s = this.openSession({ deviceId: r.trust.deviceId, origin });
          return { ok: true, ...s, alreadyPaired: true };
        }
        return { ok: false, code: "ALREADY_PAIRED" };
      }
      const identity = generateIdentity();
      const trust = {
        version: SCHEMA_VERSION,
        deviceId: identity.deviceId,
        publicIdentity: identity.publicIdentity,
        origin,
        createdAt: identity.createdAt,
      };
      if (!sessionOnly) writeTrustAtomic(trust);
      recordEvent("PAIR_APPROVED", { deviceId: trust.deviceId, origin, sessionOnly });
      const s = this.openSession({ deviceId: trust.deviceId, origin });
      return { ok: true, ...s, deviceId: trust.deviceId, publicIdentity: trust.publicIdentity };
    },

    /** Challenge for proof-of-possession. Cryptographically random, single-use. */
    challenge({ deviceId, origin }) {
      if (!exactOriginAllowed(origin, allowedOrigins)) return { ok: false, code: "ORIGIN_REJECTED" };
      const r = readTrust();
      if (r.corrupted) return { ok: false, code: "CREDENTIAL_CORRUPTED" };
      const trust = r.trust;
      if (!trust || trust.revokedAt) return { ok: false, code: "NOT_PAIRED" };
      if (trust.deviceId !== deviceId) return { ok: false, code: "DEVICE_MISMATCH" };
      const nonce = crypto.randomBytes(32).toString("hex");
      challenges.set(nonce, { deviceId, origin, expiresAt: now() + challengeTtlMs });
      return { ok: true, nonce, expiresAt: new Date(now() + challengeTtlMs).toISOString() };
    },

    /** Verify proof-of-possession → short-lived RuntimeSession. */
    verify({ deviceId, nonce, signature, origin }) {
      if (!exactOriginAllowed(origin, allowedOrigins)) return { ok: false, code: "ORIGIN_REJECTED" };
      const r = readTrust();
      if (r.corrupted) return { ok: false, code: "CREDENTIAL_CORRUPTED" };
      const trust = r.trust;
      if (!trust || trust.revokedAt) return { ok: false, code: trust && trust.revokedAt ? "TRUST_REVOKED" : "NOT_PAIRED" };
      if (trust.deviceId !== deviceId) return { ok: false, code: "DEVICE_MISMATCH" };
      if (origin !== trust.origin) return { ok: false, code: "ORIGIN_MISMATCH" };
      const challenge = challenges.get(nonce);
      if (!challenge || challenge.expiresAt < now()) {
        challenges.delete(nonce);
        return { ok: false, code: "NONCE_INVALID" };
      }
      if (challenge.deviceId !== deviceId || challenge.origin !== origin) {
        return { ok: false, code: "NONCE_INVALID" };
      }
      challenges.delete(nonce); // single-use — replay rejected
      const pk = loadPrivateKey();
      if (!pk.ok) return { ok: false, code: pk.code === "SECRET_NOT_FOUND" ? "CREDENTIAL_CORRUPTED" : pk.code };
      let valid = false;
      try {
        valid = crypto.verify(null, Buffer.from(canonicalProof(deviceId, nonce, origin)), pk.key, Buffer.from(signature, "base64"));
      } catch {
        valid = false;
      }
      if (!valid) {
        recordEvent("PAIR_VERIFY_REJECTED", { deviceId, reason: "PROOF_INVALID" });
        return { ok: false, code: "PROOF_INVALID" };
      }
      const s = this.openSession({ deviceId, origin });
      recordEvent("PAIR_VERIFIED", { deviceId, sessionId: s.sessionId });
      return { ok: true, ...s };
    },

    /** Memory-first short-lived session (§6.4). */
    openSession({ deviceId, origin }) {
      const sessionToken = randomToken(32);
      const session = {
        sessionId: sessionToken,
        deviceId,
        origin,
        createdAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + sessionTtlMs).toISOString(),
        scopes: ["flow-bridge:job", "flow-bridge:read"],
      };
      sessions.set(sessionToken, session);
      return { sessionToken, sessionId: session.sessionId, expiresAt: session.expiresAt, scopes: session.scopes };
    },

    validateSession({ sessionToken }) {
      const s = sessionToken && sessions.get(sessionToken);
      if (!s) return { ok: false, code: "SESSION_INVALID" };
      if (s.expiresAtMs && s.expiresAtMs < now()) {
        sessions.delete(sessionToken);
        return { ok: false, code: "SESSION_INVALID" };
      }
      const exp = Date.parse(s.expiresAt);
      if (Number.isFinite(exp) && exp < now()) {
        sessions.delete(sessionToken);
        return { ok: false, code: "SESSION_INVALID" };
      }
      return { ok: true, session: s };
    },

    /** Close the current runtime session; trusted identity remains (§9). */
    disconnect({ sessionToken }) {
      const had = sessions.delete(sessionToken);
      recordEvent("DISCONNECT", { hadSession: !!had });
      return { ok: true, trustedDeviceRetained: !!readTrust().trust && !readTrust().trust.revokedAt };
    },

    /** Revoke trust: future reconnect blocked until new approval (§9). */
    revoke({ sessionToken } = {}) {
      const r = readTrust();
      if (r.trust && !r.trust.revokedAt) {
        writeTrustAtomic({ ...r.trust, revokedAt: new Date().toISOString() });
      }
      for (const [tok, s] of sessions) {
        if (!sessionToken || tok === sessionToken) sessions.delete(tok);
      }
      recordEvent("TRUST_REVOKED", {});
      return { ok: true };
    },

    /** Rotate credential: new keypair, same deviceId context; old proofs die. */
    rotate() {
      const r = readTrust();
      if (!r.trust || r.trust.revokedAt) return { ok: false, code: "NOT_PAIRED" };
      const identity = generateIdentity();
      writeTrustAtomic({ ...r.trust, publicIdentity: identity.publicIdentity, rotatedAt: new Date().toISOString(), keyCreatedAt: identity.createdAt });
      for (const tok of sessions.keys()) sessions.delete(tok);
      recordEvent("CREDENTIAL_ROTATED", { deviceId: r.trust.deviceId });
      return { ok: true, deviceId: r.trust.deviceId, rotatedAt: r.trust.rotatedAt };
    },

    /** Sign a proof with the OS-protected device key (device-side operation; used by selfTest/tests). */
    signProof({ deviceId, nonce, origin }) {
      const pk = loadPrivateKey();
      if (!pk.ok) return { ok: false, code: pk.code === "SECRET_NOT_FOUND" ? "CREDENTIAL_CORRUPTED" : pk.code };
      try {
        const signature = crypto.sign(null, Buffer.from(canonicalProof(deviceId, nonce, origin)), pk.key).toString("base64");
        return { ok: true, signature };
      } catch (e) {
        return { ok: false, code: "PROOF_SIGN_FAILED", message: String(e.message).slice(0, 120) };
      }
    },

    /** True when the device can prove possession (self-test for diagnostics). */
    selfTest(origin) {
      const st = this.status();
      if (!st.paired) return { ok: false, code: st.corrupted ? "CREDENTIAL_CORRUPTED" : "NOT_PAIRED" };
      const c = this.challenge({ deviceId: st.deviceId, origin: origin || st.origin });
      if (!c.ok) return c;
      const sig = this.signProof({ deviceId: st.deviceId, nonce: c.nonce, origin: origin || st.origin });
      if (!sig.ok) return sig;
      const v = this.verify({ deviceId: st.deviceId, nonce: c.nonce, signature: sig.signature, origin: origin || st.origin });
      return v.ok ? { ok: true, sessionId: v.sessionId, sessionToken: v.sessionToken } : v;
    },

    _sessions: sessions,
    _trustFile: trustFile,
  };
}

module.exports = {
  SCHEMA_VERSION,
  CONTRACT_VERSION,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_CHALLENGE_TTL_MS,
  ERRORS,
  createPairingManager,
  canonicalProof,
};
