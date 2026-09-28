import { describe, expect, test } from 'bun:test';
import { InvalidArgumentError } from '../../../../../src/common/errors';
import { toCdpInput } from '../../../../../src/main/platform/cef/cef-input';

describe('toCdpInput', () => {
  test('a mouse press is a single left-button click by default', () => {
    expect(toCdpInput({ type: 'mouseDown', x: 3, y: 4 })).toEqual({
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mousePressed', x: 3, y: 4, button: 'left', clickCount: 1 },
    });
  });

  test('a mouse move carries no button and no click', () => {
    const input = toCdpInput({ type: 'mouseMove', x: 1, y: 2, button: 'right' });
    expect(input.params).toMatchObject({ type: 'mouseMoved', button: 'none', clickCount: 0 });
  });

  test('keyDown is a raw key press that types nothing', () => {
    expect(toCdpInput({ type: 'keyDown', keyCode: 'a' }).params).toEqual({
      type: 'rawKeyDown',
      key: 'a',
      windowsVirtualKeyCode: 65,
    });
  });

  test('punctuation is never sent as the key its code point aliases (Delete, Left)', () => {
    for (const keyCode of ['.', '%', '!', '-', '(', 'é']) {
      expect(toCdpInput({ type: 'keyDown', keyCode }).params).toEqual({
        type: 'rawKeyDown',
        key: keyCode,
        windowsVirtualKeyCode: 0,
      });
    }
    expect(toCdpInput({ type: 'keyDown', keyCode: '7' }).params).toMatchObject({
      windowsVirtualKeyCode: 0x37,
    });
  });

  test('char types the character, including control keys and astral symbols', () => {
    expect(toCdpInput({ type: 'char', keyCode: 'Enter' }).params).toMatchObject({
      key: 'Enter',
      text: '\r',
    });
    expect(toCdpInput({ type: 'char', keyCode: 'Space' }).params).toMatchObject({
      key: ' ',
      text: ' ',
    });
    expect(toCdpInput({ type: 'char', keyCode: '😀' }).params).toMatchObject({ text: '😀' });
    expect(toCdpInput({ type: 'char', keyCode: 'Up' }).params).toMatchObject({
      key: 'ArrowUp',
      text: '',
    });
  });

  test('an unknown named key is rejected, not silently dropped', () => {
    expect(() => toCdpInput({ type: 'keyUp', keyCode: 'F99' })).toThrow(InvalidArgumentError);
  });
});
