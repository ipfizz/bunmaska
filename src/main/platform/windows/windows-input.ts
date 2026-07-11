import type { MouseButton, NativeInputEvent } from '../native';
import { loadUser32 } from './win32-ffi';

/**
 * Trusted input synthesis for the Windows backend — the WinCairo peer of CDP's
 * `Input.dispatchMouseEvent`/`dispatchKeyEvent`.
 *
 * WinCairo WebKit's WKView hosts itself in an HWND whose window procedure turns
 * native Win32 input messages into engine-level `PlatformMouseEvent`s, so the page
 * sees `isTrusted === true` — exactly what a script-dispatched `element.click()`
 * (which is `isTrusted === false`) cannot produce. We POST (not send) the message
 * to the view's specific HWND: a posted message targets that window without
 * requiring it to be focused or foregrounded, so input lands on a HIDDEN window
 * and never steals the user's focus.
 *
 * The event→message mapping is a pure function ({@link inputEventToMessage}) so it
 * unit-tests with no FFI; {@link postWindowsInputEvent} is the thin side-effecting
 * wrapper. Coordinates are client pixels relative to the view's top-left (low word
 * x, high word y of LPARAM); per-monitor DPI scaling is a follow-up — at 100% scale
 * logical and client pixels coincide.
 */

const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONDOWN = 0x0204;
const WM_RBUTTONUP = 0x0205;
const WM_MBUTTONDOWN = 0x0207;
const WM_MBUTTONUP = 0x0208;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_CHAR = 0x0102;

/** WPARAM button bits for a *BUTTONDOWN message (which buttons are currently down). */
const MK_LBUTTON = 0x0001;
const MK_RBUTTON = 0x0002;
const MK_MBUTTON = 0x0010;

/** LPARAM for a key-up: repeat count 1 + bit 30 (was down) + bit 31 (transition). */
const KEYUP_LPARAM = 0xc0000001n;
/** LPARAM for a key-down / char: repeat count 1, key not previously down. */
const KEYDOWN_LPARAM = 0x00000001n;

/** A single Win32 window message to post: `(message, wParam, lParam)`. */
export type WindowMessage = {
  readonly message: number;
  readonly wParam: bigint;
  readonly lParam: bigint;
};

/** Pack a client (x, y) into a Win32 mouse-message LPARAM (low word x, high word y). */
const mouseLParam = (x: number, y: number): bigint =>
  (BigInt(Math.round(y) & 0xffff) << 16n) | BigInt(Math.round(x) & 0xffff);

/** The *BUTTONDOWN message + its pressed-button WPARAM bit for a mouse button. */
const buttonDown = (button: MouseButton): { readonly message: number; readonly mk: number } => {
  switch (button) {
    case 'right':
      return { message: WM_RBUTTONDOWN, mk: MK_RBUTTON };
    case 'middle':
      return { message: WM_MBUTTONDOWN, mk: MK_MBUTTON };
    default:
      return { message: WM_LBUTTONDOWN, mk: MK_LBUTTON };
  }
};

/** The *BUTTONUP message for a mouse button (WPARAM is 0 — no button still held). */
const buttonUp = (button: MouseButton): number => {
  switch (button) {
    case 'right':
      return WM_RBUTTONUP;
    case 'middle':
      return WM_MBUTTONUP;
    default:
      return WM_LBUTTONUP;
  }
};

/** Named keys whose VK code IS the character they type (WM_CHAR-producing). */
const CHAR_PRODUCING_VK = new Set<number>([0x08, 0x09, 0x0d, 0x1b, 0x20]); // BS, Tab, Enter, Esc, Space

/** Win32 virtual-key codes for the non-printable keys we map by Electron key name. */
const NAMED_VIRTUAL_KEYS = new Map<string, number>([
  ['Backspace', 0x08],
  ['Tab', 0x09],
  ['Enter', 0x0d],
  ['Return', 0x0d],
  ['Escape', 0x1b],
  ['Space', 0x20],
  ['PageUp', 0x21],
  ['PageDown', 0x22],
  ['End', 0x23],
  ['Home', 0x24],
  ['Left', 0x25],
  ['Up', 0x26],
  ['Right', 0x27],
  ['Down', 0x28],
  ['Delete', 0x2e],
]);

/**
 * Resolve an Electron `keyCode` to a Win32 virtual-key code. Named keys come from
 * {@link NAMED_VIRTUAL_KEYS}; a single ASCII letter/digit shares its codepoint with
 * the VK code. Returns `undefined` for anything we do not map.
 */
const virtualKey = (keyCode: string): number | undefined => {
  const named = NAMED_VIRTUAL_KEYS.get(keyCode);
  if (named !== undefined) {
    return named;
  }
  if (keyCode.length === 1) {
    const code = keyCode.toUpperCase().charCodeAt(0);
    const isDigit = code >= 0x30 && code <= 0x39;
    const isLetter = code >= 0x41 && code <= 0x5a;
    if (isDigit || isLetter) {
      return code;
    }
  }
  return undefined;
};

/**
 * Map a synthesized {@link NativeInputEvent} to the single Win32 window message
 * that delivers it, or `undefined` for a key we do not map (a lenient no-op,
 * matching Electron). Pure — the unit-testable core of the input path.
 */
export const inputEventToMessage = (event: NativeInputEvent): WindowMessage | undefined => {
  switch (event.type) {
    case 'mouseMove':
      return { message: WM_MOUSEMOVE, wParam: 0n, lParam: mouseLParam(event.x, event.y) };
    case 'mouseDown': {
      const { message, mk } = buttonDown(event.button ?? 'left');
      return { message, wParam: BigInt(mk), lParam: mouseLParam(event.x, event.y) };
    }
    case 'mouseUp':
      return {
        message: buttonUp(event.button ?? 'left'),
        wParam: 0n,
        lParam: mouseLParam(event.x, event.y),
      };
    case 'char': {
      // A named key types its control code (Enter -> CR) or nothing (arrows); a
      // single character types itself. Never the first letter of a key NAME.
      const named = NAMED_VIRTUAL_KEYS.get(event.keyCode);
      const charCode =
        named !== undefined
          ? CHAR_PRODUCING_VK.has(named)
            ? named
            : undefined
          : event.keyCode.length === 1
            ? event.keyCode.charCodeAt(0)
            : undefined;
      return charCode === undefined
        ? undefined
        : { message: WM_CHAR, wParam: BigInt(charCode), lParam: KEYDOWN_LPARAM };
    }
    case 'keyDown': {
      const vk = virtualKey(event.keyCode);
      return vk === undefined
        ? undefined
        : { message: WM_KEYDOWN, wParam: BigInt(vk), lParam: KEYDOWN_LPARAM };
    }
    case 'keyUp': {
      const vk = virtualKey(event.keyCode);
      return vk === undefined
        ? undefined
        : { message: WM_KEYUP, wParam: BigInt(vk), lParam: KEYUP_LPARAM };
    }
    default:
      return undefined;
  }
};

/** Keyboard messages must bypass the pump's queue (see below). */
const KEYBOARD_MESSAGES = new Set<number>([WM_KEYDOWN, WM_KEYUP, WM_CHAR]);

/**
 * Post a synthesized {@link NativeInputEvent} to a WKView's `hwnd` so WinCairo
 * WebKit delivers it as a trusted DOM event. Unmapped keys are silently ignored.
 *
 * Mouse messages are POSTed (async, no focus steal). Keyboard messages are SENT
 * directly to the view's native WndProc: a POSTed WM_KEYDOWN would pass through
 * the pump's `TranslateMessage`, which synthesizes a SECOND, real-keyboard-state
 * WM_CHAR — doubling and corrupting the typed text. SendMessageW skips the queue.
 */
export const postWindowsInputEvent = (hwnd: bigint, event: NativeInputEvent): void => {
  const msg = inputEventToMessage(event);
  if (msg === undefined) {
    return;
  }
  const user32 = loadUser32().symbols;
  if (KEYBOARD_MESSAGES.has(msg.message)) {
    user32.SendMessageW(hwnd, msg.message, msg.wParam, msg.lParam);
  } else {
    user32.PostMessageW(hwnd, msg.message, msg.wParam, msg.lParam);
  }
};
