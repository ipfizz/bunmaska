import { describe, expect, it } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  registerAllSchemes,
  registerUriScheme,
  resetUriSchemeRegistryForTesting,
  setUriSchemeDispatcherForTesting,
  URI_SCHEME_CB_DEF,
} from '../../../../../src/main/platform/linux/webkit-uri-scheme';

/**
 * Host-safe unit tests for the Linux URI-scheme module.
 *
 * The native serve path needs a real WebKitGTK process, so the round-trip is
 * proven by the CI-gated Linux integration test. Here we assert the module's
 * exported seam, the callback ABI shape (pure JS), and that registration refuses
 * to run off Linux (every FFI entry throws {@link UnsupportedPlatformError}).
 */

describe('URI_SCHEME_CB_DEF', () => {
  it('declares the WebKitURISchemeRequestCallback shape (request, user_data) -> void', () => {
    expect(URI_SCHEME_CB_DEF.args).toEqual(['ptr', 'ptr']);
    expect(URI_SCHEME_CB_DEF.returns).toBe('void');
  });
});

describe('exports', () => {
  it('exposes the registration + test seam functions', () => {
    expect(typeof registerUriScheme).toBe('function');
    expect(typeof registerAllSchemes).toBe('function');
    expect(typeof setUriSchemeDispatcherForTesting).toBe('function');
    expect(typeof resetUriSchemeRegistryForTesting).toBe('function');
  });

  it('setUriSchemeDispatcherForTesting accepts a fake and a reset', () => {
    expect(() => setUriSchemeDispatcherForTesting(() => undefined)).not.toThrow();
    expect(() => setUriSchemeDispatcherForTesting(undefined)).not.toThrow();
  });
});

if (currentPlatform() !== 'linux') {
  describe('registerUriScheme off Linux', () => {
    it('throws UnsupportedPlatformError (FFI is Linux-only)', () => {
      expect(() => registerUriScheme('app', null)).toThrow(UnsupportedPlatformError);
    });

    it('registerAllSchemes is a no-op when no schemes are registered', () => {
      // protocol has no schemes here; the loop body never runs, so no FFI.
      expect(() => registerAllSchemes(null)).not.toThrow();
    });
  });
}
