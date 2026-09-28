import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { type LogRecord, resetLogger, setLogSink } from '../../../../../src/common/logger';
import { protocol } from '../../../../../src/main/api/protocol';
import { WindowsWebContents } from '../../../../../src/main/platform/windows/windows-web-contents';
import { WindowsWebView } from '../../../../../src/main/platform/windows/windows-webkit-view';

/** A WindowsWebContents over a stub view (the real one needs WinCairo). */
const createContents = (frame?: boolean) => {
  const evaluated: string[] = [];
  const stubView = { evaluateJavaScript: (code: string) => evaluated.push(code) };
  const create = spyOn(WindowsWebView, 'create').mockImplementation(
    () => stubView as unknown as WindowsWebView,
  );
  const contents = new WindowsWebContents(0n, 800, 600, undefined, frame);
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
  for (const scheme of protocol.getRegisteredSchemes()) {
    protocol.unhandle(scheme);
  }
});

describe('WindowsWebContents', () => {
  test('setWindowOpenHandler warns that the handler is never called', () => {
    const warnings = collectWarnings();
    const { contents } = createContents();
    contents.setWindowOpenHandler(() => undefined);
    expect(warnings).toEqual([expect.stringContaining('setWindowOpenHandler')]);
  });

  test('openDevTools warns that no inspector opens', () => {
    const warnings = collectWarnings();
    const { contents } = createContents();
    contents.openDevTools();
    expect(warnings).toEqual([expect.stringContaining('openDevTools')]);
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

  test('exec results settle only by the unguessable execId the wrapper posts', async () => {
    const { contents, options, evaluated } = createContents();
    const exec = options.messageHandlers.find((handler) => handler.name === 'bunmaskaExec');
    const pending = contents.executeJavaScript('1 + 1');
    const execId = Number(/execId: (\d+)/.exec(evaluated.at(-1) ?? '')?.[1]);
    for (const body of ['null', '1', JSON.stringify({ execId: 1, ok: true, result: 'forged' })]) {
      expect(() => exec?.onMessage(body)).not.toThrow();
    }
    exec?.onMessage(JSON.stringify({ execId, ok: true, result: 2 }));
    expect(await pending).toBe(2);
  });

  test('only a frameless window gets the title-bar controls, as Electron ignores them framed', () => {
    const hasControls = (frame?: boolean): boolean => {
      const { options } = createContents(frame);
      mock.restore();
      return options.userScripts.some((source) => source.includes('--app-region'));
    };
    expect(hasControls(undefined)).toBe(false);
    expect(hasControls(true)).toBe(false);
    expect(hasControls(false)).toBe(true);
  });
});
