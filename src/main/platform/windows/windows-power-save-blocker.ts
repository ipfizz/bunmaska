import type {
  NativeBlocker,
  PowerSaveBlockerBackend,
  PowerSaveBlockerType,
} from '../../api/power-save-blocker';
import { loadKernel32 } from './win32-ffi';

// SetThreadExecutionState is ONE per-thread state, not a stack of assertions: re-apply the
// combined flags of every live blocker on each acquire/release.

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
const ES_DISPLAY_REQUIRED = 0x00000002;

/** One live blocker; identity (the object) is the opaque native handle. */
type Entry = { readonly type: PowerSaveBlockerType };

const active = new Set<Entry>();

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
