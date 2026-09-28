/**
 * Detached Ed25519 signatures: the only authenticity check on engine and app-update feeds.
 * The wyhash content hash beside them is a corruption check, never trust.
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

/** Whether `pem` parses as an Ed25519 public key (a mangled PEM would otherwise fail every verify). */
export const isEd25519PublicKey = (pem: string): boolean => {
  try {
    return createPublicKey(pem).asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
};

/** Sign artifact bytes with a PEM private key; returns a base64 detached signature. */
export const signArtifact = (privateKeyPem: string, message: Uint8Array): string =>
  sign(null, message, createPrivateKey(privateKeyPem)).toString('base64');

/** Verify a base64 signature over `message`; false (never a throw) for a bad key, sig or mismatch. */
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
