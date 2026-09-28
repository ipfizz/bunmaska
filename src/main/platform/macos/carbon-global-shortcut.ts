import { JSCallback, type Pointer, ptr } from 'bun:ffi';
import type { GlobalShortcutBackend } from '../../api/global-shortcut';
import { parseAccelerator } from '../../api/accelerator';
import { currentPlatform } from '../../../common/platform';
import { loadCarbonFFI } from './carbon-ffi';
import { carbonModifierMask, macVirtualKeyCode } from './carbon-keymap';

/**
 * macOS `globalShortcut` backend via Carbon `RegisterEventHotKey`.
 *
 * - ONE process-wide event handler is installed lazily for
 *   `kEventClassKeyboard` / `kEventHotKeyPressed`. Its `JSCallback` is retained
 *   for the process lifetime (it is NEVER closed inside its own invocation — see
 *   the JSCallback-lifecycle SIGSEGV note).
 * - Each registration gets a unique numeric id; we pack `{ signature, id }` into
 *   the `EventHotKeyID` u64 (the verified struct-by-value workaround) and keep an
 *   `id -> callback` map. When the handler fires it reads the fired id back from
 *   the event's `kEventParamHotKeyID` parameter and dispatches that callback.
 *
 * Returns `false` from `register` when the accelerator's key is not in the
 * US-layout virtual-key table or when Carbon refuses the grab (non-`noErr`).
 */

const SIGNATURE = 0x53414d42; // 'SAMB'

const KEYBOARD_EVENT_CLASS = 0x6b657962; // 'keyb'
const K_EVENT_HOT_KEY_PRESSED = 6;
const K_EVENT_PARAM_HOT_KEY_ID = 0x686b6964; // 'hkid'
const TYPE_EVENT_HOT_KEY_ID = 0x686b6964; // 'hkid'
const NO_ERR = 0;
const EVENT_NOT_HANDLED_ERR = -9874;

type Registration = {
  readonly id: number;
  readonly hotKeyRef: bigint;
  readonly callback: () => void;
};

const byAccelerator = new Map<string, Registration>();
const byId = new Map<number, () => void>();
let nextId = 1;

// The single app event handler's JSCallback, retained for the process lifetime.
// It is intentionally never closed (closing a JSCallback from within its own
// invocation crashes; this one outlives every registration anyway).
let handlerCallback: JSCallback | undefined;
let handlerInstalled = false;

/** The fired hot key's id, or undefined when the event is not one of ours. */
const readFiredId = (event: Pointer | null): number | undefined => {
  const carbon = loadCarbonFFI();
  const out = new Uint8Array(8);
  const rc = carbon.symbols.GetEventParameter(
    event,
    K_EVENT_PARAM_HOT_KEY_ID,
    TYPE_EVENT_HOT_KEY_ID,
    null,
    8,
    null,
    ptr(out),
  );
  if (rc !== NO_ERR) {
    return undefined;
  }
  // EventHotKeyID { OSType signature; UInt32 id }: signature is the low 4 bytes, id the high 4.
  const view = new DataView(out.buffer);
  return view.getUint32(0, true) === SIGNATURE ? view.getUint32(4, true) : undefined;
};

/** Install the one shared Carbon event handler. Idempotent; false if Carbon refused it. */
const ensureHandler = (): boolean => {
  if (handlerInstalled) {
    return true;
  }
  const carbon = loadCarbonFFI();
  handlerCallback ??= new JSCallback(
    (_callRef: Pointer | null, event: Pointer | null): number => {
      const id = readFiredId(event);
      const callback = id === undefined ? undefined : byId.get(id);
      if (callback === undefined) {
        return EVENT_NOT_HANDLED_ERR; // leave other hot-key users' events alone
      }
      try {
        callback();
      } catch (error) {
        // A throw must not unwind into Carbon; surface it as an ordinary uncaught error.
        queueMicrotask(() => {
          throw error;
        });
      }
      return NO_ERR;
    },
    { args: ['ptr', 'ptr'], returns: 'i32' },
  );

  // EventTypeSpec { UInt32 eventClass; UInt32 eventKind } passed by reference.
  const typeList = new Uint32Array([KEYBOARD_EVENT_CLASS, K_EVENT_HOT_KEY_PRESSED]);
  const handlerRefOut = new BigInt64Array(1);
  handlerInstalled =
    carbon.symbols.InstallEventHandler(
      carbon.symbols.GetApplicationEventTarget(),
      handlerCallback.ptr,
      1,
      ptr(typeList),
      null,
      ptr(handlerRefOut),
    ) === NO_ERR;
  return handlerInstalled;
};

const register = (accelerator: string, callback: () => void): boolean => {
  const parsed = parseAccelerator(accelerator, 'macos');
  if (parsed === undefined) {
    return false;
  }
  const keyCode = macVirtualKeyCode(parsed.key);
  if (keyCode === undefined || !ensureHandler()) {
    return false;
  }

  const carbon = loadCarbonFFI();
  const id = nextId;
  nextId += 1;
  const packed = BigInt(SIGNATURE) | (BigInt(id) << 32n);
  const outRef = new BigInt64Array(1);
  const rc = carbon.symbols.RegisterEventHotKey(
    keyCode,
    carbonModifierMask(parsed),
    packed,
    carbon.symbols.GetApplicationEventTarget(),
    0,
    ptr(outRef),
  );
  const hotKeyRef = outRef[0];
  if (rc !== NO_ERR || hotKeyRef === undefined || hotKeyRef === 0n) {
    return false;
  }
  byId.set(id, callback);
  byAccelerator.set(accelerator, { id, hotKeyRef, callback });
  return true;
};

const unregister = (accelerator: string): void => {
  const registration = byAccelerator.get(accelerator);
  if (registration === undefined) {
    return;
  }
  byAccelerator.delete(accelerator);
  byId.delete(registration.id);
  loadCarbonFFI().symbols.UnregisterEventHotKey(Number(registration.hotKeyRef) as Pointer);
};

/** @internal */
export const registeredHotKeyId = (accelerator: string): number | undefined =>
  byAccelerator.get(accelerator)?.id;

const unregisterAll = (): void => {
  for (const accelerator of [...byAccelerator.keys()]) {
    unregister(accelerator);
  }
};

/** macOS is supported whenever we are actually on macOS (Carbon is always present). */
const isSupported = (): boolean => currentPlatform() === 'macos';

export const macosGlobalShortcutBackend: GlobalShortcutBackend = {
  isSupported,
  register,
  unregister,
  unregisterAll,
};
