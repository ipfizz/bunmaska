/**
 * Subprocess fixture: call `session.defaultSession.clearStorageData()` against a
 * real WinCairo engine and confirm it resolves. The clear's cookie + fetch-cache
 * removals are asynchronous in WebKit and signal completion via callbacks that
 * fire on the cooperative Win32 pump — so the fixture drives the pump while the
 * Promise is in flight, exactly as a real app's run loop would. Prints
 * `CLEAR_OK` on resolution.
 *
 * Run in a fresh Bun process (not under bun:test): loading WebKit2.dll spins up
 * the engine's threads, which do not coexist with the test-runner host. Requires
 * BUNMASKA_WEBKIT_PATH to point at a WinCairo engine directory.
 */
import { session } from '../../../../src/main/api/session';
import { createWindowsDrain } from '../../../../src/main/platform/windows/windows-run-loop';

let done = false;
let failed: unknown;
session.defaultSession
  .clearStorageData()
  .then(() => {
    done = true;
  })
  .catch((error) => {
    failed = error;
    done = true;
  });

const drain = createWindowsDrain();
const deadline = Date.now() + 20000;
while (!done && Date.now() < deadline) {
  drain();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

if (done && failed === undefined) {
  process.stdout.write('CLEAR_OK\n');
  process.exit(0);
}
process.stdout.write(failed !== undefined ? `CLEAR_FAIL ${String(failed)}\n` : 'CLEAR_TIMEOUT\n');
process.exit(1);
