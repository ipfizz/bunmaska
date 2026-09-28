/** The baked release trust anchor for the official engine feed (D042); public, never a user knob. */
export const RELEASE_ENGINE_PUBKEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA9YGBi1+rnrTL0i7pap8uxxhMqNxJFucR7+qbOxe192w=\n-----END PUBLIC KEY-----\n';

/** A self-hosted `engine.feed.publicKey` wins, else the baked anchor (D042). */
export const resolveEnginePublicKey = (opts: {
  readonly feedPublicKey?: string | undefined;
}): string => opts.feedPublicKey || RELEASE_ENGINE_PUBKEY;
