import { describe, expect, test } from 'bun:test';
import { inputEventToMessage } from '../../../../../src/main/platform/windows/windows-input';

// Win32 message constants mirrored here for readable assertions.
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONDOWN = 0x0204;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_CHAR = 0x0102;

describe('inputEventToMessage', () => {
  test('packs mouse coordinates into the LPARAM (low word x, high word y)', () => {
    expect(inputEventToMessage({ type: 'mouseMove', x: 0x0123, y: 0x0456 })).toEqual({
      message: WM_MOUSEMOVE,
      wParam: 0n,
      lParam: 0x04560123n,
    });
  });

  test('rounds and masks coordinates to 16-bit words', () => {
    expect(inputEventToMessage({ type: 'mouseMove', x: 12.7, y: 8.2 })?.lParam).toBe(
      (8n << 16n) | 13n,
    );
  });

  test('a left mouseDown is WM_LBUTTONDOWN with the MK_LBUTTON wParam', () => {
    const msg = inputEventToMessage({ type: 'mouseDown', x: 10, y: 20 });
    expect(msg?.message).toBe(WM_LBUTTONDOWN);
    expect(msg?.wParam).toBe(1n);
  });

  test('the button option selects the right message', () => {
    expect(inputEventToMessage({ type: 'mouseDown', x: 1, y: 1, button: 'right' })?.message).toBe(
      WM_RBUTTONDOWN,
    );
  });

  test('a mouseUp holds no buttons (wParam 0)', () => {
    const msg = inputEventToMessage({ type: 'mouseUp', x: 5, y: 5 });
    expect(msg?.message).toBe(WM_LBUTTONUP);
    expect(msg?.wParam).toBe(0n);
  });

  test('a named key maps to its virtual-key code (Escape)', () => {
    expect(inputEventToMessage({ type: 'keyDown', keyCode: 'Escape' })).toEqual({
      message: WM_KEYDOWN,
      wParam: 0x1bn,
      lParam: 0x1n,
    });
    expect(inputEventToMessage({ type: 'keyUp', keyCode: 'Escape' })).toEqual({
      message: WM_KEYUP,
      wParam: 0x1bn,
      lParam: 0xc0000001n,
    });
  });

  test('a single letter maps to its VK code, case-insensitively', () => {
    const code = BigInt('A'.charCodeAt(0));
    expect(inputEventToMessage({ type: 'keyDown', keyCode: 'a' })?.wParam).toBe(code);
    expect(inputEventToMessage({ type: 'keyDown', keyCode: 'A' })?.wParam).toBe(code);
  });

  test('a char event emits WM_CHAR with the character code', () => {
    const msg = inputEventToMessage({ type: 'char', keyCode: 'x' });
    expect(msg?.message).toBe(WM_CHAR);
    expect(msg?.wParam).toBe(BigInt('x'.charCodeAt(0)));
  });

  test('a char event for a control-producing named key uses its control code, not its first letter', () => {
    // 'Enter' must type a carriage return (0x0d), NOT 'E' (0x45).
    expect(inputEventToMessage({ type: 'char', keyCode: 'Enter' })?.wParam).toBe(0x0dn);
    expect(inputEventToMessage({ type: 'char', keyCode: 'Tab' })?.wParam).toBe(0x09n);
    expect(inputEventToMessage({ type: 'char', keyCode: 'Space' })?.wParam).toBe(0x20n);
    expect(inputEventToMessage({ type: 'char', keyCode: 'Backspace' })?.wParam).toBe(0x08n);
  });

  test('a char event for a non-character named key produces no character (undefined)', () => {
    // Arrows / navigation keys type nothing.
    expect(inputEventToMessage({ type: 'char', keyCode: 'Left' })).toBeUndefined();
    expect(inputEventToMessage({ type: 'char', keyCode: 'Home' })).toBeUndefined();
    expect(inputEventToMessage({ type: 'char', keyCode: 'Delete' })).toBeUndefined();
    expect(inputEventToMessage({ type: 'char', keyCode: '' })).toBeUndefined();
  });

  test('an unmapped key is a no-op (undefined)', () => {
    expect(inputEventToMessage({ type: 'keyDown', keyCode: 'F13' })).toBeUndefined();
  });
});
