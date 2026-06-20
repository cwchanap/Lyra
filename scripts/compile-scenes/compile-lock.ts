import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const LOCK_POLL_MS = 25;
const STALE_LOCK_MS = 5 * 60 * 1000;

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
        await rm(lockDir, { recursive: true, force: true });
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
  // Prefer PID liveness: a holder that is still running is never stale,
  // even if the lock directory's mtime is old (mtimes do not refresh while
  // a long compile runs).
  const ownerPid = await readOwnerPid(lockDir);
  if (ownerPid !== null && isProcessAlive(ownerPid)) {
    return false;
  }

  try {
    const info = await stat(lockDir);
    return Date.now() - info.mtimeMs > STALE_LOCK_MS;
  } catch (err) {
    if (isErrorCode(err, "ENOENT")) return false;
    throw err;
  }
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
