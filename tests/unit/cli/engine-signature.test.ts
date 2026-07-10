import { describe, expect, test } from 'bun:test';
import {
  generateSigningKeyPair,
  RELEASE_ENGINE_PUBKEY,
  resolveEnginePublicKey,
  signArtifact,
  verifyArtifact,
} from '../../../src/cli/engine-signature';

const bytes = new TextEncoder().encode('a pretend engine tarball');

describe('Ed25519 engine signatures', () => {
  test('a freshly signed artifact verifies against its public key', () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const sig = signArtifact(privateKey, bytes);
    expect(verifyArtifact(publicKey, bytes, sig)).toBe(true);
  });

  test('tampered bytes fail verification', () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const sig = signArtifact(privateKey, bytes);
    const tampered = new TextEncoder().encode('a pretend engine tarball.');
    expect(verifyArtifact(publicKey, tampered, sig)).toBe(false);
  });

  test('a signature from a different key fails', () => {
    const a = generateSigningKeyPair();
    const b = generateSigningKeyPair();
    const sig = signArtifact(a.privateKey, bytes);
    expect(verifyArtifact(b.publicKey, bytes, sig)).toBe(false);
  });

  test('garbage signature / key returns false, never throws', () => {
    const { publicKey } = generateSigningKeyPair();
    expect(verifyArtifact(publicKey, bytes, 'not-base64-or-a-sig')).toBe(false);
    expect(verifyArtifact('not a pem', bytes, 'AAAA')).toBe(false);
  });
});

describe('resolveEnginePublicKey (self-hosted config → baked anchor → dev env)', () => {
  test('a real release key is baked in as the official-feed trust anchor', () => {
    expect(RELEASE_ENGINE_PUBKEY).toContain('BEGIN PUBLIC KEY');
  });

  test('a self-hosted config feed key wins over the baked anchor', () => {
    expect(resolveEnginePublicKey({ feedPublicKey: 'CONFIG-KEY', env: {} })).toBe('CONFIG-KEY');
  });

  test('falls back to the baked anchor when no self-hosted feed key is set', () => {
    expect(resolveEnginePublicKey({ env: {} })).toBe(RELEASE_ENGINE_PUBKEY);
  });

  test('the baked anchor beats a dev/test env key (env cannot override the anchor)', () => {
    expect(resolveEnginePublicKey({ env: { BUNMASKA_ENGINE_PUBKEY: 'ENV-KEY' } })).toBe(
      RELEASE_ENGINE_PUBKEY,
    );
  });

  test('config feed key takes precedence over everything', () => {
    expect(
      resolveEnginePublicKey({
        feedPublicKey: 'CONFIG-KEY',
        env: { BUNMASKA_ENGINE_PUBKEY: 'ENV-KEY' },
      }),
    ).toBe('CONFIG-KEY');
  });
});
