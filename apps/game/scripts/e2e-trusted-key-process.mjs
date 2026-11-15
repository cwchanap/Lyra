/**
 * Resolve the pid of THIS WebDriver session's packaged e2e app from
 * `ps -axo pid=,ppid=,comm=` output, or throw.
 *
 * Two binding conditions, both required, so OS-level trusted keys can never
 * reach a look-alike or unrelated process:
 *
 * 1. The executable path must EQUAL the configured e2e binary path (the same
 *    `resolveE2eBinaryPath` value wdio.conf.ts hands to tauri-service). A dev
 *    binary (`target/debug/lyra`), another checkout's e2e binary, or any path
 *    merely containing "target-e2e" does not match.
 * 2. The process must have been spawned by this run: its parent is either the
 *    worker running the specs (`currentPid`, per-worker spawn) or the worker's
 *    parent — the WDIO launcher process that onPrepare spawns the app from
 *    (`currentPpid`, the observed embedded-provider topology). An orphan from
 *    a dead earlier run (reparented to launchd) or a concurrent run's app has
 *    a foreign parent and is rejected.
 */
export function selectE2eAppProcessId({
  psOutput,
  expectedExecutablePath,
  currentPid,
  currentPpid,
}) {
  const matches = [];
  for (const line of psOutput.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const [, pidText, ppidText, executablePath] = match;
    if (executablePath === expectedExecutablePath) {
      matches.push({ pid: Number(pidText), ppid: Number(ppidText) });
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `no process is running the configured e2e binary ${expectedExecutablePath}; the test app may have exited — refusing to send trusted keys to a guessed process`,
    );
  }
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one process running the configured e2e binary ${expectedExecutablePath}, found ${matches.length} [${matches.map((match) => match.pid).join(", ")}]; refusing to send trusted keys on guesses`,
    );
  }

  const [{ pid, ppid }] = matches;
  if (ppid !== currentPid && ppid !== currentPpid) {
    throw new Error(
      `configured e2e binary pid ${pid} (parent ${ppid}) is not owned by this WebDriver session (worker ${currentPid}, launcher ${currentPpid}); refusing to send trusted keys to an unrelated or orphaned process`,
    );
  }
  return pid;
}
