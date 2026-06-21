import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type LockOwner = { pid: number; createdAt: string };

const LOCK_POLL_MS = 25;
const STALE_LOCK_MS = 5 * 60 * 1000;
// Hard cap on lock age regardless of recorded PID liveness. If the OS
// recycles a dead holder's PID for an unrelated long-lived process, the
// PID-alive check alone would treat the lock as fresh forever and never
// reach the mtime fallback. This cap reaps such locks. No legitimate single
// compile should hold the lock this long; 30 min is generous for dev tooling.
const MAX_LOCK_MS = 30 * 60 * 1000;

export async function withCompileLock<T>(
  outputRoot: string,
  callback: () => T | Promise<T>,
): Promise<T> {
  const lockDir = `${outputRoot}.compile.lock`;
  const owner = await acquireLock(lockDir);

  // Best-effort cleanup on Ctrl-C / kill while we hold the lock. Node does NOT
  // run `finally` blocks on signal termination by default, so without this a
  // Ctrl-C'd compile leaves the lock directory on disk and the next compile
  // blocks for up to STALE_LOCK_MS (5 min) until the dead-PID staleness check
  // reaps it. We release, then exit with the conventional 128 + signum code.
  // Listeners are removed in the finally below so watch mode (which re-enters
  // this on every recompile) does not leak handlers.
  const onSignal = (signal: NodeJS.Signals): void => {
    void releaseLock(lockDir, owner).finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    return await callback();
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await releaseLock(lockDir, owner);
  }
}

async function acquireLock(lockDir: string): Promise<LockOwner> {
  await mkdir(dirname(lockDir), { recursive: true });

  let warnedWaiting = false;
  for (;;) {
    try {
      await mkdir(lockDir);
    } catch (err) {
      if (!isErrorCode(err, "EEXIST")) throw err;
      // Someone else holds the lock. Reap it if stale, otherwise wait.
      if (await isStaleLock(lockDir)) {
        // reapStaleLock atomically claims the stale lock via rename, so if it
        // succeeds the directory is free now and we retry mkdir immediately
        // rather than sleeping. Sleeping would widen the window in which
        // another process can reacquire the lock before us, needlessly
        // delaying our own acquisition.
        await reapStaleLock(lockDir);
        continue;
      }
      // The poll loop is otherwise silent, which is indistinguishable from a
      // hang during a long wait. Warn once (per acquire) so the operator knows
      // a compile is queued behind another holder, then keep polling quietly.
      if (!warnedWaiting) {
        const holderPid = await readOwnerPid(lockDir);
        console.warn(
          `[compile-scenes] waiting on compile lock held by ${
            holderPid !== null ? `pid ${holderPid}` : "an unknown process"
          }...`,
        );
        warnedWaiting = true;
      }
      await sleep(LOCK_POLL_MS);
      continue;
    }

    // We created the directory; now persist the owner metadata. If the write
    // fails, roll back the directory so we don't leave an orphaned lock that
    // looks real to every subsequent acquirer.
    const owner: LockOwner = {
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    try {
      await writeFile(
        resolve(lockDir, "owner.json"),
        `${JSON.stringify(owner, null, 2)}\n`,
      );
      return owner;
    } catch (err) {
      await rm(lockDir, { recursive: true, force: true });
      throw err;
    }
  }
}

// Atomically claim a stale lock by renaming it to a private directory, then
// remove our private copy. Only one process can win the rename; any competitor
// (or the original holder's cleanup) sees ENOENT and simply retries mkdir.
// This closes the check-then-delete TOCTOU window that a plain `rm(lockDir)`
// opened: between our staleness check and removal, a third process could have
// reaped the stale lock and acquired a fresh one, and our rm would have
// destroyed that fresh holder's lock.
async function reapStaleLock(lockDir: string): Promise<void> {
  const reapDir = `${lockDir}.reaping.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  try {
    await rename(lockDir, reapDir);
  } catch (err) {
    // Another reaper already claimed it, or the holder cleaned up. Either way
    // the lock directory is gone from our perspective; fall through and retry.
    if (isErrorCode(err, "ENOENT")) return;
    throw err;
  }
  await rmQuiet(reapDir);
}

// Only remove the lock if we still own it. If a long-running compile exceeded
// MAX_LOCK_MS and another process reaped + reacquired our lock while our
// callback was still running, the on-disk owner no longer matches our token.
// Deleting the directory in that case would destroy the new holder's lock, so
// we leave it alone and exit without removing anything.
async function releaseLock(lockDir: string, owner: LockOwner): Promise<void> {
  const current = await readOwner(lockDir);
  if (current !== null && ownersMatch(current, owner)) {
    // rmQuiet: a removal failure here (EPERM/EBUSY on Windows when something
    // holds the dir open) must not mask the real compile result propagating
    // out of withCompileLock's finally. Warn and move on; the stale-lock
    // reaper cleans the orphan once the holder's PID is gone.
    await rmQuiet(lockDir);
  }
}

export async function isStaleLock(lockDir: string): Promise<boolean> {
  let mtimeMs: number;
  try {
    const info = await stat(lockDir);
    mtimeMs = info.mtimeMs;
  } catch (err) {
    if (isErrorCode(err, "ENOENT")) return false;
    throw err;
  }

  const ageMs = Date.now() - mtimeMs;

  // Prefer PID liveness: a holder that is still running is never stale based
  // on mtime alone (mtimes do not refresh while a long compile runs). But
  // guard against PID reuse: if the lock is older than MAX_LOCK_MS, the
  // recorded PID was likely recycled for an unrelated process, so reap it
  // rather than waiting forever.
  const ownerPid = await readOwnerPid(lockDir);
  if (ownerPid !== null && isProcessAlive(ownerPid)) {
    return ageMs > MAX_LOCK_MS;
  }

  return ageMs > STALE_LOCK_MS;
}

async function readOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    const raw = await readFile(resolve(lockDir, "owner.json"), "utf8");
    const owner = JSON.parse(raw) as { pid?: unknown; createdAt?: unknown };
    if (typeof owner.pid === "number" && typeof owner.createdAt === "string") {
      return { pid: owner.pid, createdAt: owner.createdAt };
    }
    // Well-formed JSON but the owner fields are missing or the wrong type
    // (e.g. a partial write). Return null so callers fall through to the
    // mtime check rather than treating the lock as fresh. Genuinely malformed
    // JSON (a parse throw) and a missing file (ENOENT) are both handled by
    // the catch below, which also returns null.
    return null;
  } catch {
    // ENOENT (no owner.json yet) or a SyntaxError (truncated/garbage JSON):
    // treat as "no usable owner" so staleness falls back to mtime. Any other
    // read error is lumped in rather than aborting the release/reap path.
    return null;
  }
}

async function readOwnerPid(lockDir: string): Promise<number | null> {
  const owner = await readOwner(lockDir);
  return owner === null ? null : owner.pid;
}

function ownersMatch(a: LockOwner, b: LockOwner): boolean {
  return a.pid === b.pid && a.createdAt === b.createdAt;
}

function isProcessAlive(pid: number): boolean {
  // PID reuse is handled by the MAX_LOCK_MS hard cap in isStaleLock: even if
  // the OS recycles `pid` for an unrelated long-lived process, the lock is
  // reaped once it exceeds the cap. We do NOT narrow the check to the
  // holder's command line or start time because that would add
  // platform-specific fragility for negligible benefit.
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = process exists but not ours to signal.
    return isErrorCode(err, "EPERM");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

// rm({force:true}) suppresses ENOENT but not EPERM/EBUSY (real on Windows when
// something holds the directory open). A removal failure in the release or
// reap path must not propagate out of withCompileLock's finally and mask the
// real compile result/error, so we warn and swallow. The orphaned dir is
// harmless: the stale-lock reaper cleans it once the holder's PID is gone.
async function rmQuiet(target: string): Promise<void> {
  try {
    await rm(target, { recursive: true, force: true });
  } catch (err) {
    console.warn(
      `[compile-scenes] failed to remove ${target}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function isErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}
