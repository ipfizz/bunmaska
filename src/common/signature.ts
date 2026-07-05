/**
 * Detached Ed25519 signatures over artifact bytes — the shared trust primitive
 * for BOTH the engine feed (`cli/engine-signature.ts`) and the app auto-updater
 * (`main/api/auto-updater.ts`). Plain `node:crypto` Ed25519, dependency-free and
 * trivially testable: a `.sig` is the base64 signature over the raw bytes, and
 * the corresponding public key is a baked/configured trust anchor. This is what
 * makes an update authentic — a content hash (wyhash) is only a corruption check.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/** A PEM-encoded Ed25519 key pair (SPKI public, PKCS8 private). */
export type SigningKeyPair = {
  readonly publicKey: string;
  readonly privateKey: string;
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
