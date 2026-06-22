import { describe, expect, test } from 'bun:test';
import {
  createWebFrame,
  type WebFrameDocument,
  type WebFrameElement,
} from '../../../src/renderer/api/web-frame';

/**
 * webFrame is proven WITHOUT a renderer: a minimal MockDocument stands in for
 * `document`, capturing created `<style>` elements and the documentElement's
 * `style.zoom`. executeJavaScript is driven through a scope-injected
 * `globalThis` whose `eval` is the real one, so completion values/throws are
 * exercised for real (the unit-under-test is never reimplemented here).
 */

/** A fake element capturing the bits webFrame touches. */
class MockElement implements WebFrameElement {
  textContent = '';
  readonly style: { zoom: string } = { zoom: '' };
  readonly attributes = new Map<string, string>();
  parent: MockElement | undefined;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: MockElement): void {
    child.parent = this;
    this.children.push(child);
  }

  removeChild(child: MockElement): void {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parent = undefined;
    }
  }

  readonly children: MockElement[] = [];
}

/** A minimal `document` with a head and a documentElement carrying style.zoom. */
class MockDocument implements WebFrameDocument {
  readonly documentElement = new MockElement();
  readonly head = new MockElement();
  readonly created: MockElement[] = [];

  createElement(tagName: string): MockElement {
    const element = new MockElement();
    element.setAttribute('__tag', tagName);
    this.created.push(element);
    return element;
  }
}

const makeWebFrame = (doc: MockDocument = new MockDocument()) =>
  createWebFrame({ document: doc, globalThis });

describe('webFrame.executeJavaScript', () => {
  test("resolves '1 + 1' to 2", async () => {
    await expect(makeWebFrame().executeJavaScript('1 + 1')).resolves.toBe(2);
  });

  test("resolves 'Promise.resolve(\"hi\")' to 'hi'", async () => {
    await expect(makeWebFrame().executeJavaScript('Promise.resolve("hi")')).resolves.toBe('hi');
  });

  test('rejects when the code throws', async () => {
    await expect(makeWebFrame().executeJavaScript('throw new Error("x")')).rejects.toThrow(/x/);
  });
});

describe('webFrame.insertCSS / removeInsertedCSS', () => {
  test('returns a key and appends a style element carrying the css', () => {
    const doc = new MockDocument();
    const frame = makeWebFrame(doc);
    const key = frame.insertCSS('body { color: red; }');
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
    const style = doc.head.children[0];
    expect(style).toBeDefined();
    expect(style?.attributes.get('__tag')).toBe('style');
    expect(style?.textContent).toBe('body { color: red; }');
  });

  test('removeInsertedCSS removes the previously inserted style element', () => {
    const doc = new MockDocument();
    const frame = makeWebFrame(doc);
    const key = frame.insertCSS('a {}');
    expect(doc.head.children.length).toBe(1);
    frame.removeInsertedCSS(key);
    expect(doc.head.children.length).toBe(0);
  });

  test('removeInsertedCSS with an unknown key is a no-op', () => {
    const doc = new MockDocument();
    const frame = makeWebFrame(doc);
    frame.insertCSS('a {}');
    expect(() => frame.removeInsertedCSS('nope')).not.toThrow();
    expect(doc.head.children.length).toBe(1);
  });

  test('two inserts get distinct keys', () => {
    const frame = makeWebFrame();
    const k1 = frame.insertCSS('a {}');
    const k2 = frame.insertCSS('b {}');
    expect(k1).not.toBe(k2);
  });

  test('falls back to documentElement when there is no head', () => {
    const doc = new MockDocument() as MockDocument & { head?: MockElement };
    const headless = {
      documentElement: doc.documentElement,
      createElement: doc.createElement.bind(doc),
    };
    const frame = createWebFrame({ document: headless, globalThis });
    frame.insertCSS('a {}');
    expect(doc.documentElement.children.length).toBe(1);
  });
});

describe('webFrame zoom factor', () => {
  test('getZoomFactor returns 1 by default', () => {
    expect(makeWebFrame().getZoomFactor()).toBe(1);
  });

  test('setZoomFactor sets documentElement.style.zoom and getZoomFactor reads it back', () => {
    const doc = new MockDocument();
    const frame = makeWebFrame(doc);
    frame.setZoomFactor(2);
    expect(doc.documentElement.style.zoom).toBe('2');
    expect(frame.getZoomFactor()).toBe(2);
  });

  test('ignores a zoom factor of 0 (keeps the current factor)', () => {
    const frame = makeWebFrame();
    frame.setZoomFactor(1.5);
    frame.setZoomFactor(0);
    expect(frame.getZoomFactor()).toBe(1.5);
  });

  test('ignores a negative zoom factor', () => {
    const frame = makeWebFrame();
    frame.setZoomFactor(1.5);
    frame.setZoomFactor(-3);
    expect(frame.getZoomFactor()).toBe(1.5);
  });

  test('ignores a non-finite zoom factor', () => {
    const frame = makeWebFrame();
    frame.setZoomFactor(1.5);
    frame.setZoomFactor(Number.NaN);
    expect(frame.getZoomFactor()).toBe(1.5);
  });
});

describe('webFrame zoom level', () => {
  test('getZoomLevel returns 0 by default', () => {
    expect(makeWebFrame().getZoomLevel()).toBe(0);
  });

  test('setZoomLevel(1) gives a zoom factor of ~1.2', () => {
    const frame = makeWebFrame();
    frame.setZoomLevel(1);
    expect(frame.getZoomFactor()).toBeCloseTo(1.2, 5);
  });

  test('setZoomFactor(1.44) gives a zoom level of ~2', () => {
    const frame = makeWebFrame();
    frame.setZoomFactor(1.44);
    expect(frame.getZoomLevel()).toBeCloseTo(2, 5);
  });

  test('zoom level round-trips through setZoomLevel/getZoomLevel', () => {
    const frame = makeWebFrame();
    frame.setZoomLevel(-2.5);
    expect(frame.getZoomLevel()).toBeCloseTo(-2.5, 5);
  });
});
