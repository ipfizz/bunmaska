import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ArtifactOs,
  contentHash,
  isNewerVersion,
  parseUpdateManifest,
  type UpdateManifest,
} from '../../common/manifest';
import { createLogger } from '../../common/logger';
import { type Arch, currentArch as hostArch, currentPlatform } from '../../common/platform';
import { verifyArtifact } from '../../common/signature';
import { app } from './app';

/**
 * Application self-update — a drop-in subset of Electron's `autoUpdater`, built
 * on the same `version.json` contract `bunmaska build` emits.
 *
 * An {@link EventEmitter} (D023) emitting Electron's event names:
 * `checking-for-update`, `update-available`, `update-not-available`,
 * `update-downloaded` and `error`. The feed must be https. The default installer
 * is EXPERIMENTAL — it is the one step not exercised by the test suite.
 */

const log = createLogger('auto-updater');

export type FeedURLOptions = {
  readonly url: string;
  /**
   * PEM Ed25519 public key that every downloaded artifact's detached `.sig` must
   * verify against. Required to download — unsigned updates are refused. This is
   * the app publisher's own release key (baked into the app), not a Bunmaska key.
   */
  readonly publicKey?: string;
  /** If set, a manifest whose `channel` differs is rejected (channel confusion). */
  readonly channel?: string;
};

/**
 * Caps guarding the decompression step against a zip bomb: a tiny signed-looking
 * artifact that expands to gigabytes and OOMs the process. The compressed cap is
 * checked against the declared size before any fetch; the decompressed cap after.
 */
export const MAX_COMPRESSED_ARTIFACT_BYTES = 512 * 1024 * 1024;
export const MAX_DECOMPRESSED_TAR_BYTES = 2 * 1024 * 1024 * 1024;

/** The zip-bomb guard: throws if a byte length exceeds `max`. */
export const assertSizeWithin = (length: number, max: number, what: string): void => {
  if (length > max) {
    throw new Error(`autoUpdater: ${what} exceeds the ${max}-byte limit (got ${length})`);
  }
};

/** http is refused for any host but these — dev feeds served from localhost. */
const LOCAL_FEED_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Transport-secure: https anywhere, http only on localhost. */
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
  /** Path to the decompressed `.tar` on disk. */
  readonly tarPath: string;
};

export type UpdateCheckResult = {
  readonly updateInfo: UpdateInfo;
  readonly manifest: UpdateManifest;
};

export type AutoUpdaterDeps = {
  readonly fetchText: (url: string) => Promise<string>;
  readonly fetchBytes: (url: string) => Promise<Uint8Array>;
  readonly currentVersion: () => string;
  readonly currentOs: () => ArtifactOs;
  readonly currentArch: () => Arch;
  readonly decompress: (bytes: Uint8Array) => Uint8Array;
  readonly stage: (tarBytes: Uint8Array, manifest: UpdateManifest) => Promise<string>;
  readonly install: (staged: StagedUpdate) => void;
};

const joinUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const toUpdateInfo = (manifest: UpdateManifest): UpdateInfo => ({
  version: manifest.version,
  releaseName: manifest.name,
});

const httpFetchText = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`autoUpdater: GET ${url} failed (${response.status})`);
  }
  return response.text();
};

const httpFetchBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`autoUpdater: GET ${url} failed (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

const stageToTmp = async (tarBytes: Uint8Array, manifest: UpdateManifest): Promise<string> => {
  const tarPath = join(tmpdir(), `bunmaska-update-${manifest.hash}.tar`);
  writeFileSync(tarPath, tarBytes);
  return tarPath;
};

/**
 * Default installer: stages the tar and quits. It does NOT swap the bundle or
 * relaunch — the atomic swap is platform-specific and unimplemented, so an app
 * that needs a real install must inject its own `install`.
 */
const defaultInstall = (staged: StagedUpdate): void => {
  log.warn('autoUpdater.quitAndInstall: using the experimental default installer');
  log.warn(`staged update for ${staged.manifest.version} at ${staged.tarPath}`);
  app.quit();
};

const productionDeps = (): AutoUpdaterDeps => ({
  fetchText: httpFetchText,
  fetchBytes: httpFetchBytes,
  currentVersion: () => app.getVersion(),
  currentOs: currentPlatform,
  currentArch: hostArch,
  decompress: (bytes) => new Uint8Array(Bun.zstdDecompressSync(bytes)),
  stage: stageToTmp,
  install: defaultInstall,
});

export class AutoUpdaterImpl extends EventEmitter {
  #deps: AutoUpdaterDeps;
  #feedURL: string | undefined;
  #publicKey: string | undefined;
  #channel: string | undefined;
  #available: UpdateManifest | undefined;
  #staged: StagedUpdate | undefined;

  constructor(deps?: Partial<AutoUpdaterDeps>) {
    super();
    this.#deps = { ...productionDeps(), ...deps };
  }

  /** @internal */
  setDepsForTesting(deps: Partial<AutoUpdaterDeps>): void {
    this.#deps = { ...this.#deps, ...deps };
  }

  /**
   * Base URL of the channel feed, where `update.json` + artifacts live. Must be
   * https (http only for localhost) so a plaintext MITM cannot serve a malicious
   * feed.
   */
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
        'autoUpdater: no update public key configured; pass { publicKey } to setFeedURL — unsigned updates are refused',
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

  /** Returns `null` when no newer version is offered. Rejects on network/manifest failure. */
  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    const feedURL = this.#requireFeedURL();
    this.emit('checking-for-update');
    let manifest: UpdateManifest;
    try {
      const text = await this.#deps.fetchText(joinUrl(feedURL, 'update.json'));
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
    if (!isNewerVersion(manifest.version, this.#deps.currentVersion())) {
      this.#available = undefined;
      this.emit('update-not-available', toUpdateInfo(manifest));
      return null;
    }
    this.#available = manifest;
    this.emit('update-available', toUpdateInfo(manifest));
    return { updateInfo: toUpdateInfo(manifest), manifest };
  }

  /**
   * Download, verify and stage the update found by the most recent
   * {@link checkForUpdates}.
   *
   * The signature — not the wyhash — is what makes an update trustworthy: a
   * feed/MITM controls the manifest, so its size + hash are self-referential;
   * only the publisher's key can produce a valid `.sig`.
   */
  async downloadUpdate(): Promise<StagedUpdate> {
    const feedURL = this.#requireFeedURL();
    const manifest = this.#available;
    if (manifest === undefined) {
      throw this.#emitError(
        new Error('autoUpdater.downloadUpdate: no update available; call checkForUpdates first'),
      );
    }
    try {
      const publicKey = this.#requirePublicKey();
      assertSizeWithin(manifest.size, MAX_COMPRESSED_ARTIFACT_BYTES, 'compressed artifact');
      const bytes = await this.#deps.fetchBytes(joinUrl(feedURL, manifest.artifact));
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
      const signature = (
        await this.#deps.fetchText(joinUrl(feedURL, `${manifest.artifact}.sig`))
      ).trim();
      if (!verifyArtifact(publicKey, bytes, signature)) {
        throw new Error('autoUpdater: artifact signature verification failed');
      }
      const tarBytes = this.#deps.decompress(bytes);
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

  /** Throws if no update has been downloaded. The default installer is EXPERIMENTAL. */
  quitAndInstall(): void {
    if (this.#staged === undefined) {
      throw new Error(
        'autoUpdater.quitAndInstall: no update downloaded; call downloadUpdate first',
      );
    }
    this.#deps.install(this.#staged);
  }
}

/** The application updater singleton — Electron's `autoUpdater`. */
export const autoUpdater = new AutoUpdaterImpl();
export type AutoUpdater = AutoUpdaterImpl;
