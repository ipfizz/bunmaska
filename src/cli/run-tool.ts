/** Run a build tool to completion; a non-zero exit throws with its stdout and stderr. */
export const runTool = async (
  label: string,
  argv: readonly string[],
  opts: { readonly cwd?: string } = {},
): Promise<void> => {
  const proc = Bun.spawn([...argv], {
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${label} failed (exit ${exitCode}):\n${stdout}${stderr}`);
  }
};
