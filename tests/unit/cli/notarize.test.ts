import { describe, expect, test } from 'bun:test';
import { buildDittoArgs, notarizeApp } from '../../../src/cli/notarize';

const CREDS = { appleId: 'dev@example.com', teamId: 'TEAM123', password: 'app-pw' };

describe('buildDittoArgs', () => {
  test('zips with -c -k --keepParent as notarytool requires', () => {
    expect(buildDittoArgs('/out/My App.app', '/out/My App.app.zip')).toEqual([
      'ditto',
      '-c',
      '-k',
      '--keepParent',
      '/out/My App.app',
      '/out/My App.app.zip',
    ]);
  });
});

describe('notarizeApp', () => {
  test('runs ditto, then notarytool submit --wait on the ZIP, then staples the app', async () => {
    const calls: string[][] = [];
    await notarizeApp('/out/My App.app', CREDS, async (_label, argv) => {
      calls.push(argv);
    });
    expect(calls).toEqual([
      ['ditto', '-c', '-k', '--keepParent', '/out/My App.app', '/out/My App.app.zip'],
      [
        'xcrun',
        'notarytool',
        'submit',
        '/out/My App.app.zip',
        '--apple-id',
        'dev@example.com',
        '--team-id',
        'TEAM123',
        '--password',
        'app-pw',
        '--wait',
      ],
      ['xcrun', 'stapler', 'staple', '/out/My App.app'],
    ]);
  });

  test('a failed submission propagates and never staples', async () => {
    const labels: string[] = [];
    const failing = async (label: string, _argv: string[]): Promise<void> => {
      labels.push(label);
      if (label === 'notarytool') {
        throw new Error('Invalid credentials');
      }
    };
    await expect(notarizeApp('/out/My App.app', CREDS, failing)).rejects.toThrow(
      /Invalid credentials/,
    );
    expect(labels).toEqual(['ditto', 'notarytool']);
  });
});
