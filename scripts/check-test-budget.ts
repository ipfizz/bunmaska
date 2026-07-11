/**
 * Runs the test suite once and gates on its shape, so a suite that SILENTLY stops
 * registering (a broken `hasEngine` probe, a wrong `currentPlatform()` guard, a
 * module-level `if` that drops to zero tests) fails CI instead of passing green.
 *
 * It asserts, per OS: zero failures, at least `minPass` passing tests (a big drop
 * means a whole suite vanished), and no more than `maxSkip` skips (a jump means a
 * suite that should run got gated off). Bounds are deliberately generous for now —
 * they catch a catastrophic regression without false-failing normal per-OS
 * variation; ratchet them tighter as each leg's real numbers settle.
 */
import { platform } from 'node:os';

type Budget = { minPass: number; maxSkip: number };

const BUDGETS: Record<string, Budget> = {
  win32: { minPass: 1200, maxSkip: 130 },
  darwin: { minPass: 1200, maxSkip: 130 },
  linux: { minPass: 1200, maxSkip: 130 },
};

const budget = BUDGETS[platform()] ?? { minPass: 1000, maxSkip: 200 };

const proc = Bun.spawnSync(['bun', 'test', '--timeout', '30000'], {
  stdout: 'pipe',
  stderr: 'pipe',
});
const out = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
process.stdout.write(out);

const num = (label: string): number => {
  // bun prints e.g. " 1524 pass" / " 75 skip" / " 0 fail"
  const match = out.match(new RegExp(`(\\d+)\\s+${label}`));
  return match?.[1] ? Number(match[1]) : Number.NaN;
};

const pass = num('pass');
const skip = num('skip');
const fail = num('fail');

const problems: string[] = [];
if (proc.exitCode !== 0) problems.push(`the test run exited ${proc.exitCode}`);
if (Number.isNaN(pass) || Number.isNaN(skip) || Number.isNaN(fail)) {
  problems.push('could not parse pass/skip/fail counts from the test output');
}
if (fail > 0) problems.push(`${fail} test(s) failed`);
if (pass < budget.minPass) {
  problems.push(`only ${pass} tests passed (< ${budget.minPass}) — did a suite stop registering?`);
}
if (skip > budget.maxSkip) {
  problems.push(`${skip} tests skipped (> ${budget.maxSkip}) — did a suite get gated off?`);
}

process.stdout.write(
  `\ntest budget [${platform()}]: pass=${pass} skip=${skip} fail=${fail} ` +
    `(min pass ${budget.minPass}, max skip ${budget.maxSkip})\n`,
);
if (problems.length > 0) {
  process.stdout.write(`TEST BUDGET FAILED:\n  - ${problems.join('\n  - ')}\n`);
  process.exit(1);
}
process.stdout.write('test budget OK\n');
