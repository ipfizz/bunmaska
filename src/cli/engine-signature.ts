/**
 * Ed25519 detached signatures for engine artifacts — the trust layer for
 * `bunmaska engine install <url>`. A published engine ships a `.sig` (base64
 * Ed25519 signature over the artifact bytes); the CLI verifies it against a
 * public key baked into the release before extracting anything. Same spirit as
 * Tauri's minisign; kept to plain Ed25519 (node:crypto) so it is dependency-free
 * and trivially testable. The exact minisign wire format can be adopted later.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/**
 * The Bunmaska release engine-signing public key — the **baked-in trust anchor**
 * (D041). It is public (not a secret) and is verified automatically, with no
 * user knob. Empty until the real keypair is generated alongside the hosted
 * feed; the resolution order below fills in for dev/self-hosted in the meantime.
 */
export const RELEASE_ENGINE_PUBKEY = '';

/** A PEM-encoded Ed25519 key pair (SPKI public, PKCS8 private). */
export type SigningKeyPair = {
  readonly publicKey: string;
  readonly privateKey: string;
};

/**
 * Resolve the public key to verify an engine artifact, in priority order:
 * the baked release anchor → a self-hosted feed key from `bunmaska.config`
 * (`engine.feed.publicKey`) → a dev/test `BUNMASKA_ENGINE_PUBKEY` env fallback.
 * Returns undefined when none is available. The env path is intentionally last
 * and undocumented — config + the baked anchor are the real sources (D041).
 */
export const resolveEnginePublicKey = (opts: {
  readonly feedPublicKey?: string | undefined;
  readonly env?: Record<string, string | undefined>;
}): string | undefined => {
  if (RELEASE_ENGINE_PUBKEY.length > 0) {
    return RELEASE_ENGINE_PUBKEY;
  }
  if (opts.feedPublicKey !== undefined && opts.feedPublicKey.length > 0) {
    return opts.feedPublicKey;
  }
  const env = opts.env ?? process.env;
  const envKey = env['BUNMASKA_ENGINE_PUBKEY'];
  return envKey !== undefined && envKey.length > 0 ? envKey : undefined;
};

/** Generate an Ed25519 signing key pair (release tooling + tests). */
export const generateSigningKeyPair = (): SigningKeyPair => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

/** Sign artifact bytes with a PEM private key; returns a base64 detached signature. */
export const signArtifact = (privateKeyPem: string, message: Uint8Array): string =>
  sign(null, message, createPrivateKey(privateKeyPem)).toString('base64');

/**
 * Verify a base64 Ed25519 signature over `message` against a PEM public key.
 * Returns false (never throws) on any bad key, malformed signature, or mismatch.
 */
export const verifyArtifact = (
  publicKeyPem: string,
  message: Uint8Array,
  signatureBase64: string,
): boolean => {
  try {
    return verify(
      null,
      message,
      createPublicKey(publicKeyPem),
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
};
