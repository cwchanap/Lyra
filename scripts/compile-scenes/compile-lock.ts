import { mkdir, rm, stat, writeFile } from "node:fs/promises";
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
      if (!isErrorCode(err, "EEXIST")) throw err;
    }

    if (await isStaleLock(lockDir)) {
      await rm(lockDir, { recursive: true, force: true });
      continue;
    }

    await sleep(LOCK_POLL_MS);
  }
}

async function isStaleLock(lockDir: string): Promise<boolean> {
  try {
    const info = await stat(lockDir);
    return Date.now() - info.mtimeMs > STALE_LOCK_MS;
  } catch (err) {
    if (isErrorCode(err, "ENOENT")) return false;
    throw err;
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
