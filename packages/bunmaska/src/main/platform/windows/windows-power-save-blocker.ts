import type {
  NativeBlocker,
  PowerSaveBlockerBackend,
  PowerSaveBlockerType,
} from '../../api/power-save-blocker';
import { loadKernel32 } from './win32-ffi';

/**
 * Windows `powerSaveBlocker` backend (pure `bun:ffi`), the WinCairo peer of the
 * IOKit (macOS) and ScreenSaver-inhibit (Linux) backends. Windows exposes a
 * single per-thread execution state via `SetThreadExecutionState`, NOT a stack of
 * independent assertions — so this tracks every live blocker and re-applies the
 * COMBINED flags on each acquire/release: `ES_SYSTEM_REQUIRED` whenever any
 * blocker is held, plus `ES_DISPLAY_REQUIRED` when any of them is
 * `prevent-display-sleep`. `ES_CONTINUOUS` makes the state persist until changed.
 */

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
const ES_DISPLAY_REQUIRED = 0x00000002;

/** One live blocker; identity (the object) is the opaque native handle. */
type Entry = { readonly type: PowerSaveBlockerType };

const active = new Set<Entry>();

/** Re-apply the execution state for the current set of live blockers. */
const applyExecutionState = (): void => {
  let flags = ES_CONTINUOUS;
  if (active.size > 0) {
    flags |= ES_SYSTEM_REQUIRED;
    for (const entry of active) {
      if (entry.type === 'prevent-display-sleep') {
        flags |= ES_DISPLAY_REQUIRED;
        break;
      }
    }
  }
  // `>>> 0` makes the (signed) 0x80000000 bit an unsigned DWORD for the u32 arg.
  loadKernel32().symbols.SetThreadExecutionState(flags >>> 0);
};

export const windowsPowerSaveBlockerBackend: PowerSaveBlockerBackend = {
  acquire(type: PowerSaveBlockerType): NativeBlocker | null {
    const entry: Entry = { type };
    active.add(entry);
    applyExecutionState();
    return entry;
  },

  release(handle: NativeBlocker): void {
    active.delete(handle as Entry);
    applyExecutionState();
  },
};
