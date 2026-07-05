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
 * user knob. Empty until the real keypair is generated alongside the hosted
 * feed; the resolution order below fills in for dev/self-hosted in the meantime.
 */
export const RELEASE_ENGINE_PUBKEY = '';

/**
 * Resolve the public key to verify an engine artifact, in priority order:
 * the baked release anchor → a self-hosted feed key from `bunmaska.config`
 * (`engine.feed.publicKey`) → a dev/test `BUNMASKA_ENGINE_PUBKEY` env fallback.
 * Returns undefined when none is available. The env path is intentionally last
 * and undocumented — config + the baked anchor are the real sources (D041).
 */
export const resolveEnginePublicKey = (opts: {
  readonly feedPublicKey?: string | undefined;
  readonly env?: Record<string, string | undefined>;
}): string | undefined => {
  if (RELEASE_ENGINE_PUBKEY.length > 0) {
    return RELEASE_ENGINE_PUBKEY;
  }
  if (opts.feedPublicKey !== undefined && opts.feedPublicKey.length > 0) {
    return opts.feedPublicKey;
  }
  const env = opts.env ?? process.env;
  const envKey = env['BUNMASKA_ENGINE_PUBKEY'];
  return envKey !== undefined && envKey.length > 0 ? envKey : undefined;
};
