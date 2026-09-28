import { describe, expect, test } from 'bun:test';
import {
  DOM_READY_HANDLER_NAME,
  generateDomReadyScript,
} from '../../../../src/main/platform/dom-ready';

/** Run the script against a fake frame; returns the post count and the DOMContentLoaded hook. */
const runInFrame = (readyState: string, isTop = true) => {
  let posts = 0;
  let onLoaded: (() => void) | undefined;
  const win: Record<string, unknown> = {
    webkit: { messageHandlers: { [DOM_READY_HANDLER_NAME]: { postMessage: () => posts++ } } },
  };
  win['top'] = isTop ? win : {};
  const doc = {
    readyState,
    addEventListener: (_type: string, listener: () => void) => {
      onLoaded = listener;
    },
  };
  new Function('window', 'document', generateDomReadyScript())(win, doc);
  return { posts: () => posts, fireLoaded: () => onLoaded?.() };
};

describe('generateDomReadyScript', () => {
  test('posts at once when the document is past loading', () => {
    expect(runInFrame('complete').posts()).toBe(1);
  });

  test('posts on DOMContentLoaded while the document is loading', () => {
    const frame = runInFrame('loading');
    expect(frame.posts()).toBe(0);
    frame.fireLoaded();
    expect(frame.posts()).toBe(1);
  });

  test('a sub-frame never posts', () => {
    const frame = runInFrame('loading', false);
    frame.fireLoaded();
    expect(frame.posts()).toBe(0);
    expect(runInFrame('complete', false).posts()).toBe(0);
  });
});
