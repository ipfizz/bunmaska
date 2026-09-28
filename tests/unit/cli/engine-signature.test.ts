import { describe, expect, test } from 'bun:test';
import { RELEASE_ENGINE_PUBKEY, resolveEnginePublicKey } from '../../../src/cli/engine-signature';

describe('resolveEnginePublicKey', () => {
  test('a real release key is baked in as the official-feed trust anchor', () => {
    expect(RELEASE_ENGINE_PUBKEY).toContain('BEGIN PUBLIC KEY');
  });

  test('a self-hosted config feed key wins over the baked anchor', () => {
    expect(resolveEnginePublicKey({ feedPublicKey: 'CONFIG-KEY' })).toBe('CONFIG-KEY');
  });

  test('falls back to the baked anchor when no self-hosted feed key is set', () => {
    expect(resolveEnginePublicKey({})).toBe(RELEASE_ENGINE_PUBKEY);
    expect(resolveEnginePublicKey({ feedPublicKey: '' })).toBe(RELEASE_ENGINE_PUBKEY);
  });
});
