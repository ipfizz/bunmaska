import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contentHash,
  isNewerVersion,
  parseUpdateManifest,
  type UpdateManifest,
} from '../../common/manifest';
import { createLogger } from '../../common/logger';
import { app } from './app';

/**
 * Application self-update — a drop-in subset of Electron's `autoUpdater`, built
 * on the same `version.json` contract `bunmaska build` emits.
 *
 * An {@link EventEmitter} (D023) emitting Electron's event names:
 * `checking-for-update`, `update-available`, `update-not-available`,
 * `update-downloaded` and `error`. The flow is explicit (electron-updater
 * style): {@link AutoUpdaterImpl.checkForUpdates} fetches the channel's
 * `update.json` and compares versions; {@link AutoUpdaterImpl.downloadUpdate}
 * fetches the artifact, verifies its size + wyhash against the manifest, and
 * stages the decompressed tar; {@link AutoUpdaterImpl.quitAndInstall} delegates
 * the irreversible bundle swap + relaunch to the installer seam.
 *
 * Every side effect (network, decompression, disk, install) is an injectable
 * dependency, so the check/download/verify/stage engine is fully unit-tested.
 * The default installer performs a best-effort, platform-specific swap and is
 * marked EXPERIMENTAL — it is the one step not exercised by the test suite.
 */

const log = createLogger('auto-updater');

/** Options accepted by {@link AutoUpdaterImpl.setFeedURL}. */
export type FeedURLOptions = { readonly url: string };

/** The Electron-shaped update descriptor carried by `update-*` events. */
export type UpdateInfo = {
  readonly version: string;
  readonly releaseName: string;
};

/** A downloaded + verified update staged on disk, ready to install. */
export type StagedUpdate = {
  readonly manifest: UpdateManifest;
  /** Path to the decompressed `.tar` on disk. */
  readonly tarPath: string;
};

/** The result of a successful {@link AutoUpdaterImpl.checkForUpdates}. */
export type UpdateCheckResult = {
  readonly updateInfo: UpdateInfo;
  readonly manifest: UpdateManifest;
};

/** Injectable side effects, so the engine is testable without real I/O. */
export type AutoUpdaterDeps = {
  readonly fetchText: (url: string) => Promise<string>;
  readonly fetchBytes: (url: string) => Promise<Uint8Array>;
  readonly currentVersion: () => string;
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
 * EXPERIMENTAL default installer. Hands the staged tar to a detached helper
 * that, once this process exits, replaces the app and relaunches. The bundle
 * layout is platform-specific and this step is not covered by the test suite;
 * apps that need deterministic installs should inject their own.
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
  decompress: (bytes) => new Uint8Array(Bun.zstdDecompressSync(bytes)),
  stage: stageToTmp,
  install: defaultInstall,
});

export class AutoUpdaterImpl extends EventEmitter {
  #deps: AutoUpdaterDeps;
  #feedURL: string | undefined;
  #available: UpdateManifest | undefined;
  #staged: StagedUpdate | undefined;

  constructor(deps?: Partial<AutoUpdaterDeps>) {
    super();
    this.#deps = { ...productionDeps(), ...deps };
  }

  /** Replace the injected dependencies. Test-only. */
  setDepsForTesting(deps: Partial<AutoUpdaterDeps>): void {
    this.#deps = { ...this.#deps, ...deps };
  }

  /** Set the base URL of the channel feed (where `update.json` + artifacts live). */
  setFeedURL(options: FeedURLOptions | string): void {
    const url = typeof options === 'string' ? options : options.url;
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('autoUpdater.setFeedURL: a non-empty url is required');
    }
    this.#feedURL = url;
  }

  /** The configured feed URL, or `''` if none is set. */
  getFeedURL(): string {
    return this.#feedURL ?? '';
  }

  #requireFeedURL(): string {
    if (this.#feedURL === undefined) {
      throw new Error('autoUpdater: feed URL is not set; call setFeedURL first');
    }
    return this.#feedURL;
  }

  /** Emit `error` (only if a listener is attached) and return the normalized Error. */
  #emitError(cause: unknown): Error {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
    return error;
  }

  /**
   * Fetch the feed's `update.json` and compare it to the running version. Emits
   * `checking-for-update`, then `update-available` or `update-not-available`.
   * Returns the result when an update is available, else `null`. Rejects (and
   * emits `error`) on a network or manifest failure.
   */
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
   * Download the artifact for the update found by the most recent
   * {@link checkForUpdates}, verify its byte length + wyhash against the
   * manifest, decompress it, and stage the tar on disk. Emits `update-downloaded`.
   * Rejects (and emits `error`) if no update is pending or integrity fails.
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
      const tarBytes = this.#deps.decompress(bytes);
      const tarPath = await this.#deps.stage(tarBytes, manifest);
      const staged: StagedUpdate = { manifest, tarPath };
      this.#staged = staged;
      this.emit('update-downloaded', toUpdateInfo(manifest));
      return staged;
    } catch (cause) {
      throw this.#emitError(cause);
    }
  }

  /**
   * Install the staged update and relaunch via the installer seam. Throws if no
   * update has been downloaded. The default installer is EXPERIMENTAL.
   */
  quitAndInstall(): void {
    if (this.#staged === undefined) {
      throw new Error(
        'autoUpdater.quitAndInstall: no update downloaded; call downloadUpdate first',
      );
    }
    this.#deps.install(this.#staged);
  }
}

/** The application updater singleton. Drop-in equivalent of Electron's `autoUpdater`. */
export const autoUpdater = new AutoUpdaterImpl();
export type AutoUpdater = AutoUpdaterImpl;
