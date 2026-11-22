/**
 * Resolve the pid of THIS WebDriver session's packaged e2e app, or throw.
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
 *    a dead earlier run (reparented to launchd/init) or a concurrent run's
 *    app has a foreign parent and is rejected. If the launcher itself has
 *    died, the worker is likewise reparented (currentPpid 1), parent-based
 *    ownership is unprovable, and selection aborts before choosing a target.
 *
 * `selectE2eAppProcessId` parses macOS `ps -axo pid=,ppid=,comm=` output
 * (comm is the full executable path there). On Linux `ps comm` is only a
 * basename, so the caller resolves each candidate's executable from
 * `/proc/<pid>/exe` and hands `{pid, ppid, executablePath}` entries to the
 * shared `selectOwnedE2eAppProcessId` — the exact-path and parent-ownership
 * rules are identical on both platforms.
 */
export function selectOwnedE2eAppProcessId({
  entries,
  expectedExecutablePath,
  currentPid,
  currentPpid,
}) {
  if (currentPpid <= 1) {
    throw new Error(
      `WDIO launcher pid ${currentPpid} is invalid — this worker is orphaned (reparented to launchd), so parent-based session ownership cannot be proven; refusing to select a trusted-key target`,
    );
  }
  const pathMatches = entries.filter(
    (entry) => entry.executablePath === expectedExecutablePath,
  );

  if (pathMatches.length === 0) {
    throw new Error(
      `no process is running the configured e2e binary ${expectedExecutablePath}; the test app may have exited — refusing to send trusted keys to a guessed process`,
    );
  }

  const ownedMatches = pathMatches.filter(
    (match) => match.ppid === currentPid || match.ppid === currentPpid,
  );
  if (ownedMatches.length === 0) {
    if (pathMatches.length === 1) {
      const [{ pid, ppid }] = pathMatches;
      throw new Error(
        `configured e2e binary pid ${pid} (parent ${ppid}) is not owned by this WebDriver session (worker ${currentPid}, launcher ${currentPpid}); refusing to send trusted keys to an unrelated or orphaned process`,
      );
    }
    const found = pathMatches
      .map((match) => `${match.pid} (parent ${match.ppid})`)
      .join(", ");
    throw new Error(
      `none of the ${pathMatches.length} processes running the configured e2e binary ${expectedExecutablePath} [${found}] are owned by this WebDriver session (worker ${currentPid}, launcher ${currentPpid}); refusing to send trusted keys to unrelated or orphaned processes`,
    );
  }
  if (ownedMatches.length !== 1) {
    throw new Error(
      `expected exactly one process running the configured e2e binary ${expectedExecutablePath} owned by this WebDriver session, found ${ownedMatches.length} [${ownedMatches.map((match) => match.pid).join(", ")}]; refusing to send trusted keys on guesses`,
    );
  }

  return ownedMatches[0].pid;
}

export function selectE2eAppProcessId({
  psOutput,
  expectedExecutablePath,
  currentPid,
  currentPpid,
}) {
  const entries = [];
  for (const line of psOutput.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const [, pidText, ppidText, executablePath] = match;
    entries.push({
      pid: Number(pidText),
      ppid: Number(ppidText),
      executablePath,
    });
  }
  return selectOwnedE2eAppProcessId({
    entries,
    expectedExecutablePath,
    currentPid,
    currentPpid,
  });
}
