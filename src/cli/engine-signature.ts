/**
 * The engine-feed trust layer for `bunmaska engine install <url>`: a published
 * engine ships a `.sig` (base64 Ed25519 signature over the artifact bytes) that
 * the CLI verifies against a public key baked into the release before extracting
 * anything. The signature primitive itself lives in `common/signature.ts` (it is
 * shared with the auto-updater); this module owns only how the ENGINE public key
 * is resolved. Same spirit as Tauri's minisign; the exact wire format can follow.
 */

export {
  generateSigningKeyPair,
  signArtifact,
  verifyArtifact,
  type SigningKeyPair,
} from '../common/signature';

/**
 * The Bunmaska release engine-signing public key — the **baked-in trust anchor**
 * (D041). It is public (not a secret) and is verified automatically, with no
 * user knob. The matching private key lives only in the release owner's secret
 * store and signs every engine on the official feed.
 */
export const RELEASE_ENGINE_PUBKEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA9YGBi1+rnrTL0i7pap8uxxhMqNxJFucR7+qbOxe192w=\n-----END PUBLIC KEY-----\n';

/**
 * Resolve the public key to verify an engine artifact, in priority order:
 * a self-hosted feed key from `bunmaska.config` (`engine.feed.publicKey`) → the
 * baked release anchor → a dev/test `BUNMASKA_ENGINE_PUBKEY` env fallback. The
 * explicit self-hosted key wins so a private mirror uses its own key; otherwise
 * the baked anchor verifies the official feed. The env path is a dev-only last
 * resort that CANNOT override the anchor (D041).
 */
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
  const env = opts.env ?? process.env;
  const envKey = env['BUNMASKA_ENGINE_PUBKEY'];
  return envKey !== undefined && envKey.length > 0 ? envKey : undefined;
};
