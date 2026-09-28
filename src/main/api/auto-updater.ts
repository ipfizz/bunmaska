import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ArtifactOs,
  contentHash,
  isNewerVersion,
  parseUpdateManifest,
  type UpdateManifest,
} from '../../common/manifest';
import { type Arch, currentArch as hostArch, currentPlatform } from '../../common/platform';
import { isEd25519PublicKey, verifyArtifact } from '../../common/signature';
import { app } from './app';
import { DEFAULT_APP_VERSION } from './app-metadata';
import { defaultInstall } from './update-installer';

export type FeedURLOptions = {
  readonly url: string;
  /**
   * PEM Ed25519 key that `update.json.sig` and `<artifact>.sig` must verify against;
   * required to download. The publisher's own release key, not a Bunmaska key.
   */
  readonly publicKey?: string;
  /** If set, a manifest whose `channel` differs is rejected (channel confusion). */
  readonly channel?: string;
};

/** Sanity bounds on publisher-signed input; the download itself is capped at the signed size. */
export const MAX_COMPRESSED_ARTIFACT_BYTES = 512 * 1024 * 1024;
export const MAX_DECOMPRESSED_TAR_BYTES = 2 * 1024 * 1024 * 1024;

export const assertSizeWithin = (length: number, max: number, what: string): void => {
  if (length > max) {
    throw new Error(`autoUpdater: ${what} exceeds the ${max}-byte limit (got ${length})`);
  }
};

const LOCAL_FEED_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

const isSecureFeedUrl = (parsed: URL): boolean =>
  parsed.protocol === 'https:' ||
  (parsed.protocol === 'http:' && LOCAL_FEED_HOSTS.has(parsed.hostname));

/** Carried by the `update-*` events. */
export type UpdateInfo = {
  readonly version: string;
  readonly releaseName: string;
};

export type StagedUpdate = {
  readonly manifest: UpdateManifest;
  /** The decompressed `.tar`, alone in a private dir the default installer also writes into. */
  readonly tarPath: string;
};

export type UpdateCheckResult = {
  readonly updateInfo: UpdateInfo;
  readonly manifest: UpdateManifest;
};

export type AutoUpdaterDeps = {
  readonly fetchText: (url: string) => Promise<string>;
  /** Rejects once the body passes `maxBytes`, without buffering the rest. */
  readonly fetchBytes: (url: string, maxBytes: number) => Promise<Uint8Array>;
  readonly currentVersion: () => string;
  readonly currentOs: () => ArtifactOs;
  readonly currentArch: () => Arch;
  readonly decompress: (bytes: Uint8Array) => Promise<Uint8Array>;
  readonly stage: (tarBytes: Uint8Array, manifest: UpdateManifest) => Promise<string>;
  readonly install: (staged: StagedUpdate) => void;
};

const joinUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const toUpdateInfo = (manifest: UpdateManifest): UpdateInfo => ({
  version: manifest.version,
  releaseName: manifest.name,
});

/** update.json and a `.sig` are a few hundred bytes; a body past this is hostile. */
const MAX_FEED_TEXT_BYTES = 64 * 1024;

/** The body of a feed GET, read with a running byte cap; a redirect off https is refused. */
export const readFeedResponse = async (
  response: Response,
  url: string,
  maxBytes: number,
): Promise<Uint8Array> => {
  if (!response.ok) {
    throw new Error(`autoUpdater: GET ${url} failed (${response.status})`);
  }
  if (response.url !== '' && !isSecureFeedUrl(new URL(response.url))) {
    throw new Error(`autoUpdater: GET ${url} was redirected to insecure ${response.url}`);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.length;
    assertSizeWithin(total, maxBytes, `GET ${url}`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const httpFetchText = async (url: string): Promise<string> =>
  new TextDecoder().decode(await readFeedResponse(await fetch(url), url, MAX_FEED_TEXT_BYTES));

const httpFetchBytes = async (url: string, maxBytes: number): Promise<Uint8Array> =>
  readFeedResponse(await fetch(url), url, maxBytes);

/** Fire-and-forget callers (Electron's pattern) get failures via `error`; awaiters still reject. */
const markHandled = <T>(promise: Promise<T>): Promise<T> => {
  promise.catch(() => undefined);
  return promise;
};

/** A fresh 0700 dir: a guessable name in a shared /tmp lets another user swap the verified tar. */
export const stageToTmp = async (tarBytes: Uint8Array): Promise<string> => {
  const tarPath = join(mkdtempSync(join(tmpdir(), 'bunmaska-update-')), 'update.tar');
  await Bun.write(tarPath, tarBytes);
  return tarPath;
};

const productionDeps = (): AutoUpdaterDeps => ({
  fetchText: httpFetchText,
  fetchBytes: httpFetchBytes,
  currentVersion: () => app.getVersion(),
  currentOs: currentPlatform,
  currentArch: hostArch,
  // Async zstd runs on Bun's threadpool; a sync decompress would freeze the pumped main thread.
  decompress: async (bytes) => new Uint8Array(await Bun.zstdDecompress(bytes)),
  stage: stageToTmp,
  install: defaultInstall,
});

export class AutoUpdaterImpl extends EventEmitter {
  readonly #deps: AutoUpdaterDeps;
  #feedURL: string | undefined;
  #publicKey: string | undefined;
  #channel: string | undefined;
  #available: { readonly manifest: UpdateManifest; readonly text: string } | undefined;
  #staged: StagedUpdate | undefined;

  constructor(deps?: Partial<AutoUpdaterDeps>) {
    super();
    this.#deps = { ...productionDeps(), ...deps };
  }

  /** Base URL of the channel feed; https only, except http on localhost for dev. */
  setFeedURL(options: FeedURLOptions | string): void {
    const opts = typeof options === 'string' ? { url: options } : options;
    if (typeof opts.url !== 'string' || opts.url.length === 0) {
      throw new Error('autoUpdater.setFeedURL: a non-empty url is required');
    }
    let parsed: URL;
    try {
      parsed = new URL(opts.url);
    } catch {
      throw new Error(`autoUpdater.setFeedURL: invalid url ${JSON.stringify(opts.url)}`);
    }
    if (!isSecureFeedUrl(parsed)) {
      throw new Error(
        `autoUpdater.setFeedURL: refusing a non-HTTPS feed url ${JSON.stringify(opts.url)} (https is required; http is allowed only for localhost)`,
      );
    }
    if (opts.publicKey !== undefined && !isEd25519PublicKey(opts.publicKey)) {
      throw new Error(
        'autoUpdater.setFeedURL: publicKey is not a PEM Ed25519 public key (use the update-public-key.pem from bunmaska keygen)',
      );
    }
    this.#feedURL = opts.url;
    if (opts.publicKey !== undefined) {
      this.#publicKey = opts.publicKey;
    }
    if (opts.channel !== undefined) {
      this.#channel = opts.channel;
    }
  }

  /** `''` if none is set. */
  getFeedURL(): string {
    return this.#feedURL ?? '';
  }

  #requireFeedURL(): string {
    if (this.#feedURL === undefined) {
      throw new Error('autoUpdater: feed URL is not set; call setFeedURL first');
    }
    return this.#feedURL;
  }

  #requirePublicKey(): string {
    if (this.#publicKey === undefined || this.#publicKey.length === 0) {
      throw new Error(
        'autoUpdater: no update public key configured; pass { publicKey } to setFeedURL (unsigned updates are refused)',
      );
    }
    return this.#publicKey;
  }

  /** Emits `error` only when a listener is attached, so an un-listened emit cannot throw. */
  #emitError(cause: unknown): Error {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
    return error;
  }

  /** Throws unless `<url>.sig` is a valid publisher signature over `message`. */
  async #verifySignature(
    publicKey: string,
    url: string,
    message: Uint8Array,
    what: string,
  ): Promise<void> {
    const signature = (await this.#deps.fetchText(`${url}.sig`)).trim();
    if (!verifyArtifact(publicKey, message, signature)) {
      throw new Error(`autoUpdater: ${what} signature verification failed`);
    }
  }

  /** Returns `null` when no newer version is offered. Rejects on network/manifest failure. */
  checkForUpdates(): Promise<UpdateCheckResult | null> {
    return markHandled(this.#check());
  }

  async #check(): Promise<UpdateCheckResult | null> {
    const feedURL = this.#requireFeedURL();
    this.emit('checking-for-update');
    const currentVersion = this.#deps.currentVersion();
    if (currentVersion === DEFAULT_APP_VERSION) {
      throw this.#emitError(
        new Error(
          `autoUpdater: the running app's version is unknown (${DEFAULT_APP_VERSION}), so every update would reinstall forever; set "version" in package.json`,
        ),
      );
    }
    let text: string;
    let manifest: UpdateManifest;
    try {
      text = await this.#deps.fetchText(joinUrl(feedURL, 'update.json'));
      manifest = parseUpdateManifest(text);
    } catch (cause) {
      throw this.#emitError(cause);
    }
    const os = this.#deps.currentOs();
    const arch = this.#deps.currentArch();
    if (manifest.os !== os || manifest.arch !== arch) {
      throw this.#emitError(
        new Error(
          `autoUpdater: update targets ${manifest.os}/${manifest.arch}, not this ${os}/${arch} build`,
        ),
      );
    }
    if (this.#channel !== undefined && manifest.channel !== this.#channel) {
      throw this.#emitError(
        new Error(
          `autoUpdater: update is on channel "${manifest.channel}", not the configured "${this.#channel}"`,
        ),
      );
    }
    if (!isNewerVersion(manifest.version, currentVersion)) {
      this.#available = undefined;
      this.emit('update-not-available', toUpdateInfo(manifest));
      return null;
    }
    this.#available = { manifest, text };
    this.emit('update-available', toUpdateInfo(manifest));
    return { updateInfo: toUpdateInfo(manifest), manifest };
  }

  /**
   * Download, verify and stage the update from the last {@link checkForUpdates}.
   * Trust comes only from the two signatures, never the wyhash (see `common/signature.ts`).
   */
  downloadUpdate(): Promise<StagedUpdate> {
    return markHandled(this.#download());
  }

  async #download(): Promise<StagedUpdate> {
    const feedURL = this.#requireFeedURL();
    const available = this.#available;
    if (available === undefined) {
      throw this.#emitError(
        new Error('autoUpdater.downloadUpdate: no update available; call checkForUpdates first'),
      );
    }
    const { manifest } = available;
    try {
      const publicKey = this.#requirePublicKey();
      // Authenticates every field checkForUpdates acted on (version, os/arch, channel, name).
      await this.#verifySignature(
        publicKey,
        joinUrl(feedURL, 'update.json'),
        new TextEncoder().encode(available.text),
        'update.json',
      );
      assertSizeWithin(manifest.size, MAX_COMPRESSED_ARTIFACT_BYTES, 'compressed artifact');
      const bytes = await this.#deps.fetchBytes(joinUrl(feedURL, manifest.artifact), manifest.size);
      if (bytes.length !== manifest.size) {
        throw new Error(
          `autoUpdater: artifact size mismatch (expected ${manifest.size}, got ${bytes.length})`,
        );
      }
      const actualHash = contentHash(bytes);
      if (actualHash !== manifest.hash) {
        throw new Error(
          `autoUpdater: artifact hash mismatch (expected ${manifest.hash}, got ${actualHash})`,
        );
      }
      await this.#verifySignature(
        publicKey,
        joinUrl(feedURL, manifest.artifact),
        bytes,
        'artifact',
      );
      const tarBytes = await this.#deps.decompress(bytes);
      assertSizeWithin(tarBytes.length, MAX_DECOMPRESSED_TAR_BYTES, 'decompressed update');
      const tarPath = await this.#deps.stage(tarBytes, manifest);
      const staged: StagedUpdate = { manifest, tarPath };
      this.#staged = staged;
      this.emit('update-downloaded', toUpdateInfo(manifest));
      return staged;
    } catch (cause) {
      throw this.#emitError(cause);
    }
  }

  /** Throws if nothing is downloaded, or if the installer refuses this app's layout. */
  quitAndInstall(): void {
    if (this.#staged === undefined) {
      throw new Error(
        'autoUpdater.quitAndInstall: no update downloaded; call downloadUpdate first',
      );
    }
    this.#deps.install(this.#staged);
  }
}

/** Electron's `autoUpdater` singleton. */
export const autoUpdater = new AutoUpdaterImpl();
export type AutoUpdater = AutoUpdaterImpl;
