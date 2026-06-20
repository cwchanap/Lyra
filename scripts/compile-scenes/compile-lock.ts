import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
  await acquireLock(lockDir);
  try {
    return await callback();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function acquireLock(lockDir: string): Promise<void> {
  await mkdir(dirname(lockDir), { recursive: true });

  for (;;) {
    try {
      await mkdir(lockDir);
    } catch (err) {
      if (!isErrorCode(err, "EEXIST")) throw err;
      // Someone else holds the lock. Reap it if stale, otherwise wait.
      if (await isStaleLock(lockDir)) {
        // We just removed a stale lock, so the directory is free now.
        // Retry mkdir immediately rather than sleeping: sleeping would widen
        // the window in which another process can reacquire the lock before
        // us, needlessly delaying our own acquisition (and, on a narrow race,
        // letting a fresh holder's lock be deleted by a third reaper).
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      await sleep(LOCK_POLL_MS);
      continue;
    }

    // We created the directory; now persist the owner metadata. If the write
    // fails, roll back the directory so we don't leave an orphaned lock that
    // looks real to every subsequent acquirer.
    try {
      await writeFile(
        resolve(lockDir, "owner.json"),
        `${JSON.stringify(
          {
            pid: process.pid,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      return;
    } catch (err) {
      await rm(lockDir, { recursive: true, force: true });
      throw err;
    }
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

async function readOwnerPid(lockDir: string): Promise<number | null> {
  try {
    const raw = await readFile(resolve(lockDir, "owner.json"), "utf8");
    const owner = JSON.parse(raw) as { pid?: unknown };
    return typeof owner.pid === "number" ? owner.pid : null;
  } catch (err) {
    if (isErrorCode(err, "ENOENT")) return null;
    // Malformed owner.json: fall through to the mtime check rather than
    // treating the lock as fresh.
    return null;
  }
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

function isErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}
