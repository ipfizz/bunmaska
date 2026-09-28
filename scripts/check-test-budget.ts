/**
 * Runs `bun test` for one leg and fails on a failing test or on pass/skip counts
 * outside the leg's budget, so a suite that silently stops registering fails CI.
 * Rules: CONTRIBUTING, "The budget gate". Usage: `bun scripts/check-test-budget.ts [leg]`.
 */
import { platform } from 'node:os';

type Leg = {
  readonly minPass: number;
  readonly maxSkip: number;
  readonly paths?: readonly string[];
  readonly timeoutMs?: number;
};

type Counts = { readonly pass: number; readonly skip: number; readonly fail: number };

/**
 * Full-suite legs by `os.platform()`, within ~5% of measured runs on the beta-review merge
 * (darwin 1850/103, linux 1724/110) plus the 79 Windows tests now registered as skips (darwin
 * 185 skips, linux 189), and `windows-scoped`, the suite `validate:windows` runs (222/15).
 * ponytail: counts only; a per-OS file floor would catch a few files vanishing in the headroom.
 */
export const LEGS: Readonly<Record<string, Leg>> = {
  darwin: { minPass: 1742, maxSkip: 194 },
  linux: { minPass: 1637, maxSkip: 198 },
  // ponytail: unmeasured; the full suite is not path-portable to Windows yet.
  win32: { minPass: 1197, maxSkip: 130 },
  'windows-scoped': {
    minPass: 210,
    maxSkip: 16,
    paths: ['tests/unit/main/platform/windows', 'tests/integration/windows'],
    timeoutMs: 60000,
  },
};

/** Read bun's summary from its stderr; the last summary line wins, and bun omits `skip` at zero. */
export const parseCounts = (stderr: string): Counts => {
  const count = (label: string, missing: number): number => {
    const last = [...stderr.matchAll(new RegExp(`^\\s*(\\d+) ${label}\\s*$`, 'gm'))].at(-1)?.[1];
    return last === undefined ? missing : Number(last);
  };
  return {
    pass: count('pass', Number.NaN),
    skip: count('skip', 0),
    fail: count('fail', Number.NaN),
  };
};

/** Why a run breaks `leg`'s budget; empty when it holds. */
export const budgetProblems = (leg: Leg, counts: Counts, exitCode: number | null): string[] => {
  const { pass, skip, fail } = counts;
  const problems: string[] = [];
  if (exitCode !== 0) problems.push(`the test run exited ${exitCode}`);
  if (Number.isNaN(pass) || Number.isNaN(fail)) {
    problems.push('could not parse the pass/fail counts from the test output');
  }
  if (fail > 0) problems.push(`${fail} test(s) failed`);
  if (pass < leg.minPass) {
    problems.push(`only ${pass} tests passed (< ${leg.minPass}) - did a suite stop registering?`);
  }
  if (skip > leg.maxSkip) {
    problems.push(`${skip} tests skipped (> ${leg.maxSkip}) - did a suite get gated off?`);
  }
  return problems;
};

if (import.meta.main) {
  const name = process.argv[2] ?? platform();
  const leg = LEGS[name];
  if (leg === undefined) {
    process.stderr.write(
      `test budget: no leg "${name}" (known: ${Object.keys(LEGS).join(', ')})\n`,
    );
    process.exit(1);
  }
  const timeout = String(leg.timeoutMs ?? 30000);
  const proc = Bun.spawn([process.execPath, 'test', '--timeout', timeout, ...(leg.paths ?? [])], {
    stdout: 'inherit',
    stderr: 'pipe',
  });
  // Streamed, not buffered: a CI timeout on a hung test must still show how far the run got.
  let stderr = '';
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr) {
    process.stderr.write(chunk);
    stderr += decoder.decode(chunk, { stream: true });
  }
  const exitCode = await proc.exited;
  const counts = parseCounts(stderr);
  const problems = budgetProblems(leg, counts, exitCode);
  process.stdout.write(
    `\ntest budget [${name}]: pass=${counts.pass} skip=${counts.skip} fail=${counts.fail} ` +
      `(min pass ${leg.minPass}, max skip ${leg.maxSkip})\n`,
  );
  if (problems.length > 0) {
    process.stdout.write(`TEST BUDGET FAILED:\n  - ${problems.join('\n  - ')}\n`);
    process.exit(1);
  }
  process.stdout.write('test budget OK\n');
}
