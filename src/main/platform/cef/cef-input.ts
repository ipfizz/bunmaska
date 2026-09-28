import { InvalidArgumentError } from '../../../common/errors';
import type { NativeInputEvent } from '../native';

/** Electron key names -> DOM `key` + Windows virtual-key code (CDP wants both). */
const NAMED_KEYS = new Map<string, readonly [string, number]>([
  ['Backspace', ['Backspace', 0x08]],
  ['Tab', ['Tab', 0x09]],
  ['Enter', ['Enter', 0x0d]],
  ['Return', ['Enter', 0x0d]],
  ['Escape', ['Escape', 0x1b]],
  ['Space', [' ', 0x20]],
  ['PageUp', ['PageUp', 0x21]],
  ['PageDown', ['PageDown', 0x22]],
  ['End', ['End', 0x23]],
  ['Home', ['Home', 0x24]],
  ['Left', ['ArrowLeft', 0x25]],
  ['Up', ['ArrowUp', 0x26]],
  ['Right', ['ArrowRight', 0x27]],
  ['Down', ['ArrowDown', 0x28]],
  ['Delete', ['Delete', 0x2e]],
]);

const TEXT_OF_NAMED = new Map<string, string>([
  ['Enter', '\r'],
  ['Tab', '\t'],
  [' ', ' '],
]);

/** A CDP `Input.*` call equivalent to one Electron input event. */
export type CdpInput = {
  readonly method: 'Input.dispatchMouseEvent' | 'Input.dispatchKeyEvent';
  readonly params: Readonly<Record<string, unknown>>;
};

const resolveKey = (keyCode: string): readonly [string, number] => {
  const named = NAMED_KEYS.get(keyCode);
  if (named !== undefined) {
    return named;
  }
  if ([...keyCode].length === 1) {
    return [keyCode, keyCode.toUpperCase().charCodeAt(0)];
  }
  throw new InvalidArgumentError(`sendInputEvent: unsupported keyCode ${JSON.stringify(keyCode)}`);
};

/**
 * Map an Electron input event to CDP. `keyDown` is a raw key press (no text),
 * `char` types, `keyUp` releases, matching Electron's keyDown/char/keyUp recipe.
 */
export const toCdpInput = (event: NativeInputEvent): CdpInput => {
  switch (event.type) {
    case 'mouseDown':
    case 'mouseUp':
    case 'mouseMove':
      return {
        method: 'Input.dispatchMouseEvent',
        params: {
          type:
            event.type === 'mouseDown'
              ? 'mousePressed'
              : event.type === 'mouseUp'
                ? 'mouseReleased'
                : 'mouseMoved',
          x: event.x,
          y: event.y,
          button: event.type === 'mouseMove' ? 'none' : (event.button ?? 'left'),
          clickCount: event.type === 'mouseMove' ? 0 : 1,
        },
      };
    case 'keyDown':
    case 'keyUp': {
      const [key, code] = resolveKey(event.keyCode);
      return {
        method: 'Input.dispatchKeyEvent',
        params: {
          type: event.type === 'keyDown' ? 'rawKeyDown' : 'keyUp',
          key,
          windowsVirtualKeyCode: code,
        },
      };
    }
    case 'char': {
      const [key, code] = resolveKey(event.keyCode);
      const text = TEXT_OF_NAMED.get(key) ?? ([...key].length === 1 ? key : '');
      return {
        method: 'Input.dispatchKeyEvent',
        params: { type: 'char', key, text, unmodifiedText: text, windowsVirtualKeyCode: code },
      };
    }
  }
};
