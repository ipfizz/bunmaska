/**
 * `bunmaska keygen`: generates the Ed25519 update-signing pair that
 * `build --update-key` signs with and the runtime `autoUpdater` verifies against.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSigningKeyPair } from './engine-signature';

/** Fixed file names so docs and build flags can reference them verbatim. */
export const PRIVATE_KEY_FILE = 'update-signing-key.pem';
export const PUBLIC_KEY_FILE = 'update-public-key.pem';

export type KeygenIo = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

/** Write the key pair into `dir`; refuses to overwrite existing key files. */
export const runKeygen = (dir: string, io: KeygenIo): number => {
  const privatePath = join(dir, PRIVATE_KEY_FILE);
  const publicPath = join(dir, PUBLIC_KEY_FILE);
  for (const path of [privatePath, publicPath]) {
    if (existsSync(path)) {
      io.err(`bunmaska keygen: refusing to overwrite ${path}`);
      return 1;
    }
  }
  const pair = generateSigningKeyPair();
  mkdirSync(dir, { recursive: true });
  writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
  writeFileSync(publicPath, pair.publicKey);
  io.out(privatePath);
  io.out(publicPath);
  io.out(
    `Bake ${PUBLIC_KEY_FILE} into your app via autoUpdater.setFeedURL({ url, publicKey }); ` +
      `${PRIVATE_KEY_FILE} signs releases (build --update --update-key) and must never ship in the app.`,
  );
  return 0;
};
