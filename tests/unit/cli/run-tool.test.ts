import { describe, expect, test } from 'bun:test';
import { runTool } from '../../../src/cli/run-tool';

const tool = (script: string): string[] => [process.execPath, '-e', script];

describe('runTool', () => {
  test('resolves when the tool exits 0', async () => {
    await expect(runTool('ok', tool('process.exit(0)'))).resolves.toBeUndefined();
  });

  test("a failure carries the tool's stdout and stderr", async () => {
    const run = runTool(
      'notarytool',
      tool("console.log('id: 42 status: Invalid'); console.error('rejected'); process.exit(3)"),
    );
    await expect(run).rejects.toThrow(/notarytool failed \(exit 3\)[\s\S]*id: 42[\s\S]*rejected/);
  });
});
