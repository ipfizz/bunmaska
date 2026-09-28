import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import { registerUriScheme } from '../../../../../src/main/platform/linux/webkit-uri-scheme';

describe.skipIf(currentPlatform() === 'linux')('registerUriScheme off Linux', () => {
  test('throws UnsupportedPlatformError instead of touching a missing WebKitGTK', () => {
    expect(() => registerUriScheme('app', null)).toThrow(UnsupportedPlatformError);
  });
});
