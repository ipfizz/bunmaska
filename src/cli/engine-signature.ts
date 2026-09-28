/** The baked release trust anchor for the official engine feed (D042); public, never a user knob. */
export const RELEASE_ENGINE_PUBKEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA9YGBi1+rnrTL0i7pap8uxxhMqNxJFucR7+qbOxe192w=\n-----END PUBLIC KEY-----\n';

/** A self-hosted `engine.feed.publicKey` wins, else the baked anchor (D042). */
export const resolveEnginePublicKey = (opts: {
  readonly feedPublicKey?: string | undefined;
  readonly env?: Record<string, string | undefined>;
}): string | undefined => {
  if (opts.feedPublicKey !== undefined && opts.feedPublicKey.length > 0) {
    return opts.feedPublicKey;
  }
  if (RELEASE_ENGINE_PUBKEY.length > 0) {
    return RELEASE_ENGINE_PUBKEY;
  }
  const env = opts.env ?? process.env; // ponytail: dead while the anchor is baked; drop with engine-command's env
  const envKey = env['BUNMASKA_ENGINE_PUBKEY'];
  return envKey !== undefined && envKey.length > 0 ? envKey : undefined;
};
