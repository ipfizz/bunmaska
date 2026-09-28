import { describe, expect, test } from 'bun:test';
import { RELEASE_ENGINE_PUBKEY, resolveEnginePublicKey } from '../../../src/cli/engine-signature';

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
