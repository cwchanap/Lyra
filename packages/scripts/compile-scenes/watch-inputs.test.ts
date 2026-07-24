import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { watch } from "chokidar";
import { describe, expect, it } from "vitest";
import {
  compileScenesWatchInputs,
  isCompileScenesWatchPath,
} from "./watch-inputs";

type WatchEvent = "add" | "change" | "unlink";

let forcedMtimeMs = Date.now() + 60_000;

function advanceMtime(path: string): void {
  forcedMtimeMs += 1_000;
  const forcedTime = new Date(forcedMtimeMs);
  utimesSync(path, forcedTime, forcedTime);
}

function waitForReady(
  watcher: ReturnType<typeof watch>,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for Chokidar ready.")),
      timeoutMs,
    );
    watcher.once("ready", () => {
      clearTimeout(timeout);
      resolveReady();
    });
  });
}

function createEventRecorder(timeoutMs = 10_000) {
  const observed = new Set<string>();
  const waiters = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timeout: Timer }
  >();
  const keyFor = (event: string, path: string) => `${event}\0${path}`;

  return {
    record(event: string, path: string) {
      const key = keyFor(event, path);
      const waiter = waiters.get(key);
      if (waiter) {
        clearTimeout(waiter.timeout);
        waiters.delete(key);
        waiter.resolve();
      } else {
        observed.add(key);
      }
    },
    waitFor(event: WatchEvent, path: string): Promise<void> {
      const key = keyFor(event, path);
      if (observed.delete(key)) return Promise.resolve();

      return new Promise((resolveEvent, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(key);
          reject(new Error(`Timed out waiting for ${event} ${path}.`));
        }, timeoutMs);
        waiters.set(key, {
          resolve: resolveEvent,
          reject,
          timeout,
        });
      });
    },
    dispose() {
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("Event recorder disposed."));
      }
      waiters.clear();
    },
  };
}

async function exerciseFileLifecycle(
  path: string,
  watchRoot: string,
  recorder: ReturnType<typeof createEventRecorder>,
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });

  const added = recorder.waitFor("add", path);
  writeFileSync(path, "initial\n");
  // Chokidar's polling backend only rescans a directory when its size changes
  // or its mtime strictly increases. Its fs.watchFile poller can also capture
  // its baseline just after `ready`, so keep advancing both the watched root
  // and the file's direct parent until one poll observes a later timestamp.
  const signalAdd = () => {
    advanceMtime(watchRoot);
    if (dirname(path) !== watchRoot) advanceMtime(dirname(path));
  };
  signalAdd();
  const addRetry = setInterval(signalAdd, 100);
  try {
    await added;
  } finally {
    clearInterval(addRetry);
  }

  const changed = recorder.waitFor("change", path);
  let revision = 0;
  const mutate = () => {
    revision += 1;
    appendFileSync(path, `changed ${revision}\n`);
    const futureTime = new Date(Date.now() + 5_000 + revision * 1_000);
    utimesSync(path, futureTime, futureTime);
  };
  mutate();
  const changeRetry = setInterval(mutate, 100);
  try {
    await changed;
  } finally {
    clearInterval(changeRetry);
  }

  const unlinked = recorder.waitFor("unlink", path);
  rmSync(path);
  const signalUnlink = () => advanceMtime(dirname(path));
  signalUnlink();
  const unlinkRetry = setInterval(signalUnlink, 100);
  try {
    await unlinked;
  } finally {
    clearInterval(unlinkRetry);
  }
}

describe("isCompileScenesWatchPath", () => {
  const sourceRoots = ["/repo/static/stories_plan", "/repo/docs/stories_plan"];
  const assetConfigRoot = "/repo/static/assets/config";

  it.each([
    "/repo/static/stories_plan/story_catalog.md",
    "/repo/docs/stories_plan/story_catalog.md",
    "/repo/static/stories_plan/chapter_1/scene_0.md",
    "/repo/docs/stories_plan/chapter_20/interrogation_scene_3.md",
    "/repo/static/stories_plan/chapter_1/investigation_scene_2.layout.json",
    "/repo/static/assets/config/audio.yaml",
    "/repo/static/assets/config/nested/characters.yaml",
  ])("accepts supported compiler input %s", (path) => {
    expect(isCompileScenesWatchPath(path, sourceRoots, assetConfigRoot)).toBe(
      true,
    );
  });

  it.each([
    "/repo/static/stories_plan/notes.md",
    "/repo/static/stories_plan/chapter_notes/scene_0.md",
    "/repo/static/stories_plan/chapter_1/nested/scene_0.md",
    "/repo/static/stories_plan/chapter_1/scene_0.json",
    "/repo/static/stories_plan/chapter_1/scene_0.md.bak",
    "/repo/static/stories_plan/unrelated/story_catalog.md",
    "/repo/static/assets/config/audio.yml",
    "/repo/static/assets/config/readme.md",
    "/repo/static/assets/config-other/audio.yaml",
    "/repo/outside/chapter_1/scene_0.md",
  ])("rejects unrelated path %s", (path) => {
    expect(isCompileScenesWatchPath(path, sourceRoots, assetConfigRoot)).toBe(
      false,
    );
  });
});

describe("compile scene watch integration", () => {
  it("observes add/change/unlink for catalogs, chapter inputs, layouts, and asset YAML after ready", async () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "lyra-scene-watch-"));
    const sourceRoots = [
      resolve(tempRoot, "static/stories_plan"),
      resolve(tempRoot, "docs/stories_plan"),
    ];
    const assetConfigRoot = resolve(tempRoot, "static/assets/config");
    for (const root of [...sourceRoots, assetConfigRoot]) {
      mkdirSync(root, { recursive: true });
    }

    const recorder = createEventRecorder();
    const watcher = watch(
      compileScenesWatchInputs(sourceRoots, assetConfigRoot),
      {
        ignoreInitial: true,
        // Polling keeps the real integration test deterministic in
        // sandboxed/macOS runners where native fsevents can exhaust watcher
        // handles independently of the process's high file-descriptor limit.
        usePolling: true,
        interval: 25,
      },
    ).on("all", (event, path) => {
      if (isCompileScenesWatchPath(path, sourceRoots, assetConfigRoot)) {
        recorder.record(event, path);
      }
    });

    try {
      await waitForReady(watcher);

      const lifecycles = [
        {
          path: resolve(sourceRoots[0]!, "story_catalog.md"),
          watchRoot: sourceRoots[0]!,
        },
        {
          path: resolve(sourceRoots[1]!, "story_catalog.md"),
          watchRoot: sourceRoots[1]!,
        },
        {
          path: resolve(sourceRoots[0]!, "chapter_1/scene_0.md"),
          watchRoot: sourceRoots[0]!,
        },
        {
          path: resolve(
            sourceRoots[1]!,
            "chapter_2/investigation_scene_1.layout.json",
          ),
          watchRoot: sourceRoots[1]!,
        },
        {
          path: resolve(assetConfigRoot, "nested/audio.yaml"),
          watchRoot: assetConfigRoot,
        },
      ];
      for (const { path, watchRoot } of lifecycles) {
        await exerciseFileLifecycle(path, watchRoot, recorder);
      }
    } finally {
      recorder.dispose();
      await watcher.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
