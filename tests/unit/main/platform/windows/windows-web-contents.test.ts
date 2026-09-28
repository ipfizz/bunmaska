import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { type LogRecord, resetLogger, setLogSink } from '../../../../../src/common/logger';
import { protocol } from '../../../../../src/main/api/protocol';
import { WindowsWebContents } from '../../../../../src/main/platform/windows/windows-web-contents';
import { WindowsWebView } from '../../../../../src/main/platform/windows/windows-webkit-view';

/** A WindowsWebContents over a stub view (the real one needs WinCairo). */
const createContents = () => {
  const evaluated: string[] = [];
  const stubView = { evaluateJavaScript: (code: string) => evaluated.push(code) };
  const create = spyOn(WindowsWebView, 'create').mockImplementation(
    () => stubView as unknown as WindowsWebView,
  );
  const contents = new WindowsWebContents(0n, 800, 600);
  const options = create.mock.calls[0]?.[0];
  if (options === undefined) {
    throw new Error('WindowsWebView.create was not called');
  }
  return { contents, options, evaluated };
};

const collectWarnings = (): string[] => {
  const warnings: string[] = [];
  setLogSink((record: LogRecord) => {
    if (record.level === 'warn') {
      warnings.push(record.message);
    }
  });
  return warnings;
};

afterEach(() => {
  mock.restore();
  resetLogger();
  protocol.clearForTesting();
});

describe('WindowsWebContents', () => {
  test('setWindowOpenHandler warns that the handler is never called', () => {
    const warnings = collectWarnings();
    const { contents } = createContents();
    contents.setWindowOpenHandler(() => undefined);
    expect(warnings).toEqual([expect.stringContaining('setWindowOpenHandler')]);
  });

  test('warns when protocol.handle schemes are registered, since none are served', () => {
    protocol.handle('myapp', () => ({ data: 'hi' }));
    const warnings = collectWarnings();
    createContents();
    expect(warnings).toEqual([expect.stringContaining('myapp')]);
  });

  test('does not warn about schemes when none are registered', () => {
    const warnings = collectWarnings();
    createContents();
    expect(warnings).toEqual([]);
  });
});
