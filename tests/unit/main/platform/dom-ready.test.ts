import { describe, expect, test } from 'bun:test';
import {
  DOM_READY_HANDLER_NAME,
  generateDomReadyScript,
} from '../../../../src/main/platform/dom-ready';

describe('generateDomReadyScript', () => {
  test('posts to the dom-ready handler on DOMContentLoaded', () => {
    const script = generateDomReadyScript();
    expect(script).toContain(`messageHandlers.${DOM_READY_HANDLER_NAME}.postMessage`);
    expect(script).toContain('DOMContentLoaded');
  });

  test('fires immediately when the document is already past loading', () => {
    expect(generateDomReadyScript()).toContain("document.readyState === 'loading'");
  });
});
