# Acquisition Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a blocking, sequential popup for every newly acquired evidence record or statement before the resulting dialogue can be advanced.

**Architecture:** Keep the feature frontend-only. A pure detector compares the previous and next `GameStateView`, a small Svelte controller queues notifications, the existing game-client dispatch boundary enqueues them after successful commands, and one page-level modal renders above an inert gameplay subtree. The popup reuses the existing story-asset resolver and Escape coordinator, so no Rust, IPC, compiler, authored-story, or asset-catalog changes are needed.

**Tech Stack:** Svelte 5 runes, TypeScript, SvelteKit static SPA, Tauri 2 IPC client, Vitest, Testing Library for Svelte, Playwright, Bun 1.3.1, RTK command wrapper.

## Global Constraints

- Keep the feature frontend-only: do not modify Rust engine state, `GameStateView`, Tauri commands, scene Markdown, compiler code, generated resources, or asset catalogs.
- A missing previous state is hydration and must not replay existing inventory.
- For mixed acquisitions, render new evidence in next-state array order, then new statements in next-state array order.
- Show one blocking popup per item; never merge evidence or statements into a batch.
- Continue, Enter, Space, or Escape dismisses exactly one item; backdrop clicks do not dismiss.
- The popup must claim Escape continuously across a multi-item queue so the game menu cannot open between items.
- Evidence copy is `EVIDENCE ACQUIRED` / `物證取得`; statement copy is `STATEMENT ACQUIRED` / `證言取得`; the action is `CONTINUE / 繼續`.
- Evidence uses `description`, not `details`; statements use their full `content` in a bounded scrollable region.
- Null evidence image IDs use `placeholderForStoryAsset("evidence")`; missing files use `placeholderForMissingStoryAsset`.
- Use a 180 ms opacity/scale entrance and disable it under `prefers-reduced-motion: reduce`.
- Do not add audio assets or change gameplay-audio inference/playback.
- Use Svelte 5 runes and event attributes, not legacy `export let` or `on:` syntax.
- Prefix repository shell commands with `rtk`.

## File Structure

### Create

- `apps/game/src/lib/state/acquisition-notifications.ts` — pure inventory-diff detector and notification wire type.
- `apps/game/src/lib/state/acquisition-notifications.test.ts` — detector ordering, hydration, duplicate, and reset coverage.
- `apps/game/src/lib/state/acquisition-controller.svelte.ts` — reactive queue controller with keyed dismissal.
- `apps/game/src/lib/state/acquisition-controller.test.ts` — queue sequencing, append, stale-key, and clear coverage.
- `apps/game/src/lib/components/AcquisitionPopup.svelte` — accessible blocking modal, asset fallback, focus, Escape, responsive styling, and motion behavior.
- `apps/game/src/lib/components/AcquisitionPopup.test.ts` — evidence/statement rendering, assets, focus, input, Escape, and motion coverage.

### Modify

- `apps/game/src/lib/state/game-client.svelte.ts:1-235` — infer/enqueue acquisitions at the successful command boundary and clear them on state-reset paths.
- `apps/game/src/lib/state/game-client-source.test.ts:1-482` — mock the new detector/controller and pin success, failure, isolation, and clear behavior.
- `apps/game/src/routes/+page.svelte:1-319` — capture return focus before inerting gameplay, mount one popup, and clear the controller on page teardown.
- `apps/game/src/routes/page.test.ts` — behavioral integration for inert gameplay, sequential Escape, Enter isolation, and focus restoration.
- `apps/game/src/routes/page-source.test.ts` — pin the page-level modal/inert ownership boundary.
- `apps/game/e2e/app.spec.ts:1-340` — prove evidence-first/statement-second popups, input blocking, and inventory continuity in the built SPA.

---

### Task 1: Pure Acquisition Detector

**Files:**
- Create: `apps/game/src/lib/state/acquisition-notifications.ts`
- Create: `apps/game/src/lib/state/acquisition-notifications.test.ts`

**Interfaces:**
- Consumes: `GameStateView`, `EvidenceRecord`, and `StatementRecord` from `apps/game/src/lib/state/types.ts`.
- Produces: `AcquisitionNotification` and `inferAcquisitionNotifications(previous: GameStateView | null, next: GameStateView): AcquisitionNotification[]`.

- [ ] **Step 1: Write the failing detector tests**

Create `apps/game/src/lib/state/acquisition-notifications.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  EvidenceRecord,
  GameStateView,
  StatementRecord,
} from "./types";
import { inferAcquisitionNotifications } from "./acquisition-notifications";

function evidence(id: string): EvidenceRecord {
  return {
    id,
    name: `Evidence ${id}`,
    description: `Description ${id}`,
    details: `Details ${id}`,
    imageAssetId: null,
    onReexamine: null,
    collectedInChapterId: "chapter_1",
    collectedInSceneId: "investigation_scene_1",
  };
}

function statement(id: string): StatementRecord {
  return {
    id,
    speaker: `Speaker ${id}`,
    content: `Statement ${id}`,
    onReexamine: null,
    acquiredInChapterId: "chapter_1",
    acquiredInSceneId: "investigation_scene_1",
  };
}

function state(
  evidenceRecords: EvidenceRecord[] = [],
  statementRecords: StatementRecord[] = [],
): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "Chapter 1",
      summary: "",
      index: 0,
      total: 1,
    },
    scene: {
      kind: "investigation",
      id: "investigation_scene_1",
      title: "Investigation",
      index: 0,
      total: 1,
      currentSublocationId: "main",
      visibleSublocations: [],
    },
    mode: {
      type: "explore",
      sublocationId: "main",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: {
      evidence: evidenceRecords,
      statements: statementRecords,
    },
    dialogueHistory: [],
  };
}

describe("inferAcquisitionNotifications", () => {
  it("treats a missing previous state as hydration", () => {
    expect(
      inferAcquisitionNotifications(null, state([evidence("existing")], [])),
    ).toEqual([]);
  });

  it("returns new evidence before new statements while preserving array order", () => {
    const previous = state([evidence("known")], [statement("known")]);
    const next = state(
      [evidence("known"), evidence("photo"), evidence("receipt")],
      [statement("known"), statement("alibi"), statement("timeline")],
    );

    expect(inferAcquisitionNotifications(previous, next)).toEqual([
      {
        key: "evidence:photo",
        kind: "evidence",
        record: next.inventory.evidence[1],
      },
      {
        key: "evidence:receipt",
        kind: "evidence",
        record: next.inventory.evidence[2],
      },
      {
        key: "statement:alibi",
        kind: "statement",
        record: next.inventory.statements[1],
      },
      {
        key: "statement:timeline",
        kind: "statement",
        record: next.inventory.statements[2],
      },
    ]);
  });

  it("deduplicates repeated next-state IDs", () => {
    const duplicate = evidence("receipt");
    const notifications = inferAcquisitionNotifications(
      state(),
      state([duplicate, duplicate], []),
    );

    expect(notifications.map((notification) => notification.key)).toEqual([
      "evidence:receipt",
    ]);
  });

  it("ignores unchanged records, removals, and reset-to-empty transitions", () => {
    const previous = state([evidence("receipt")], [statement("alibi")]);

    expect(inferAcquisitionNotifications(previous, previous)).toEqual([]);
    expect(
      inferAcquisitionNotifications(previous, state([], [statement("alibi")])),
    ).toEqual([]);
    expect(inferAcquisitionNotifications(previous, state())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the detector tests to verify they fail**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/acquisition-notifications.test.ts
```

Expected: FAIL because `./acquisition-notifications` does not exist.

- [ ] **Step 3: Implement the pure detector**

Create `apps/game/src/lib/state/acquisition-notifications.ts`:

```ts
import type {
  EvidenceRecord,
  GameStateView,
  StatementRecord,
} from "./types";

export type AcquisitionNotification =
  | {
      key: string;
      kind: "evidence";
      record: EvidenceRecord;
    }
  | {
      key: string;
      kind: "statement";
      record: StatementRecord;
    };

export function inferAcquisitionNotifications(
  previous: GameStateView | null,
  next: GameStateView,
): AcquisitionNotification[] {
  if (!previous) return [];

  const notifications: AcquisitionNotification[] = [];
  const knownEvidenceIds = new Set(
    previous.inventory.evidence.map((record) => record.id),
  );
  const knownStatementIds = new Set(
    previous.inventory.statements.map((record) => record.id),
  );

  for (const record of next.inventory.evidence) {
    if (knownEvidenceIds.has(record.id)) continue;
    knownEvidenceIds.add(record.id);
    notifications.push({
      key: `evidence:${record.id}`,
      kind: "evidence",
      record,
    });
  }

  for (const record of next.inventory.statements) {
    if (knownStatementIds.has(record.id)) continue;
    knownStatementIds.add(record.id);
    notifications.push({
      key: `statement:${record.id}`,
      kind: "statement",
      record,
    });
  }

  return notifications;
}
```

- [ ] **Step 4: Run the detector tests to verify they pass**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/acquisition-notifications.test.ts
```

Expected: PASS with 4 tests.

- [ ] **Step 5: Commit the detector**

```bash
rtk git add apps/game/src/lib/state/acquisition-notifications.ts apps/game/src/lib/state/acquisition-notifications.test.ts
rtk git commit -m "feat(game): detect acquired inventory items"
```

---

### Task 2: Reactive Acquisition Queue

**Files:**
- Create: `apps/game/src/lib/state/acquisition-controller.svelte.ts`
- Create: `apps/game/src/lib/state/acquisition-controller.test.ts`

**Interfaces:**
- Consumes: `AcquisitionNotification` from Task 1.
- Produces: `createAcquisitionController()` and singleton `acquisitionController` with `current`, `blocking`, `size`, `enqueue`, `dismissCurrent`, and `clear`.

- [ ] **Step 1: Write the failing controller tests**

Create `apps/game/src/lib/state/acquisition-controller.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AcquisitionNotification } from "./acquisition-notifications";
import { createAcquisitionController } from "./acquisition-controller.svelte";

function notification(
  key: string,
  name: string,
): AcquisitionNotification {
  const id = key.replace("evidence:", "");
  return {
    key,
    kind: "evidence",
    record: {
      id,
      name,
      description: `${name} description`,
      details: "",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "investigation_scene_1",
    },
  };
}

describe("createAcquisitionController", () => {
  it("queues and dismisses notifications sequentially", () => {
    const controller = createAcquisitionController();
    const first = notification("evidence:first", "First");
    const second = notification("evidence:second", "Second");

    controller.enqueue([first, second]);

    expect(controller.blocking).toBe(true);
    expect(controller.size).toBe(2);
    expect(controller.current).toEqual(first);
    expect(controller.dismissCurrent(first.key)).toBe(true);
    expect(controller.current).toEqual(second);
    expect(controller.dismissCurrent(second.key)).toBe(true);
    expect(controller.current).toBeNull();
    expect(controller.blocking).toBe(false);
  });

  it("appends new notifications behind the active item", () => {
    const controller = createAcquisitionController();
    const first = notification("evidence:first", "First");
    const second = notification("evidence:second", "Second");

    controller.enqueue([first]);
    controller.enqueue([second]);

    expect(controller.current).toEqual(first);
    expect(controller.size).toBe(2);
  });

  it("ignores stale dismissal keys", () => {
    const controller = createAcquisitionController();
    const first = notification("evidence:first", "First");
    const second = notification("evidence:second", "Second");
    controller.enqueue([first, second]);

    expect(controller.dismissCurrent("evidence:stale")).toBe(false);
    expect(controller.current).toEqual(first);
    expect(controller.size).toBe(2);
  });

  it("clears the complete queue", () => {
    const controller = createAcquisitionController();
    controller.enqueue([
      notification("evidence:first", "First"),
      notification("evidence:second", "Second"),
    ]);

    controller.clear();

    expect(controller.current).toBeNull();
    expect(controller.size).toBe(0);
    expect(controller.blocking).toBe(false);
  });
});
```

- [ ] **Step 2: Run the controller tests to verify they fail**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/acquisition-controller.test.ts
```

Expected: FAIL because `./acquisition-controller.svelte` does not exist.

- [ ] **Step 3: Implement the controller**

Create `apps/game/src/lib/state/acquisition-controller.svelte.ts`:

```ts
import type { AcquisitionNotification } from "./acquisition-notifications";

export type AcquisitionController = {
  readonly current: AcquisitionNotification | null;
  readonly blocking: boolean;
  readonly size: number;
  enqueue: (notifications: readonly AcquisitionNotification[]) => void;
  dismissCurrent: (expectedKey: string) => boolean;
  clear: () => void;
};

export function createAcquisitionController(): AcquisitionController {
  const queue = $state<AcquisitionNotification[]>([]);

  return {
    get current() {
      return queue[0] ?? null;
    },
    get blocking() {
      return queue.length > 0;
    },
    get size() {
      return queue.length;
    },
    enqueue(notifications) {
      queue.push(...notifications);
    },
    dismissCurrent(expectedKey) {
      if (queue[0]?.key !== expectedKey) return false;
      queue.shift();
      return true;
    },
    clear() {
      queue.splice(0, queue.length);
    },
  };
}

export const acquisitionController = createAcquisitionController();
```

- [ ] **Step 4: Run the controller and detector tests**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/acquisition-controller.test.ts src/lib/state/acquisition-notifications.test.ts
```

Expected: PASS with 8 tests.

- [ ] **Step 5: Commit the controller**

```bash
rtk git add apps/game/src/lib/state/acquisition-controller.svelte.ts apps/game/src/lib/state/acquisition-controller.test.ts
rtk git commit -m "feat(game): queue acquisition notifications"
```

---

### Task 3: Game-Client Acquisition Dispatch

**Files:**
- Modify: `apps/game/src/lib/state/game-client.svelte.ts:1-235`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts:1-482`

**Interfaces:**
- Consumes: `inferAcquisitionNotifications(previous, next)` from Task 1 and `acquisitionController.enqueue/clear` from Task 2.
- Produces: successful gameplay commands enqueue acquisitions once; `resetGame`, `jumpToScene`, and `returnToMainMenu` clear pending acquisitions.

- [ ] **Step 1: Add failing game-client integration tests**

Extend the hoisted mock object in `game-client-source.test.ts`:

```ts
const mocks = vi.hoisted(() => ({
  acquisitionClear: vi.fn(),
  acquisitionEnqueue: vi.fn(),
  inferAcquisitionNotifications: vi.fn(),
  inferGameplaySfxEvents: vi.fn(),
  invoke: vi.fn(),
  playGameplaySfxEvent: vi.fn(),
}));
```

Add these module mocks below the existing audio mocks:

```ts
vi.mock("./acquisition-notifications", () => ({
  inferAcquisitionNotifications: mocks.inferAcquisitionNotifications,
}));

vi.mock("./acquisition-controller.svelte", () => ({
  acquisitionController: {
    enqueue: mocks.acquisitionEnqueue,
    clear: mocks.acquisitionClear,
  },
}));
```

Reset the new mocks in the existing `beforeEach`:

```ts
mocks.acquisitionClear.mockReset();
mocks.acquisitionEnqueue.mockReset();
mocks.inferAcquisitionNotifications.mockReset().mockReturnValue([]);
```

Add this test beside the successful SFX dispatch case:

```ts
it("commits a successful state and enqueues inferred acquisitions once", async () => {
  const previous = state("previous");
  const next = state("next");
  const notification = {
    key: "evidence:receipt",
    kind: "evidence" as const,
    record: {
      id: "receipt",
      name: "Receipt",
      description: "Timestamp circled.",
      details: "",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_next",
    },
  };
  const client = await loadGameClient(previous);
  mocks.invoke.mockResolvedValueOnce(next);
  mocks.inferAcquisitionNotifications.mockReturnValueOnce([notification]);
  mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);

  await client.inspectHotspot("receipt");

  expect(client.gameState.value).toBe(next);
  expect(mocks.inferAcquisitionNotifications).toHaveBeenCalledExactlyOnceWith(
    previous,
    next,
  );
  expect(mocks.acquisitionEnqueue).toHaveBeenCalledExactlyOnceWith([
    notification,
  ]);
});
```

Add these assertions to the existing rejected-command test:

```ts
expect(mocks.inferAcquisitionNotifications).not.toHaveBeenCalled();
expect(mocks.acquisitionEnqueue).not.toHaveBeenCalled();
```

Add a contract-drift isolation test:

```ts
it("keeps the committed state when acquisition inference throws", async () => {
  const previous = state("previous");
  const next = state("next");
  const client = await loadGameClient(previous);
  mocks.invoke.mockResolvedValueOnce(next);
  mocks.inferAcquisitionNotifications.mockImplementationOnce(() => {
    throw new Error("inventory contract drift");
  });
  mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(client.inspectHotspot("receipt")).resolves.toBeUndefined();

  expect(client.gameState.value).toBe(next);
  expect(mocks.acquisitionEnqueue).not.toHaveBeenCalled();
  expect(mocks.inferGameplaySfxEvents).toHaveBeenCalledExactlyOnceWith(
    previous,
    next,
    "inspect_hotspot",
  );
  expect(warnSpy).toHaveBeenCalledWith(
    "[AcquisitionPopup] inference failed for inspect_hotspot",
    expect.any(Error),
  );
  warnSpy.mockRestore();
});
```

Add a reset lifecycle test:

```ts
it("clears pending acquisitions before resetting the game", async () => {
  const client = await loadGameClient(state("previous"));
  const next = state("reset");
  mocks.invoke.mockResolvedValueOnce(next);
  mocks.inferGameplaySfxEvents.mockReturnValueOnce([]);

  await client.resetGame();

  expect(mocks.acquisitionClear).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("reset_game", undefined);
});
```

Add `expect(mocks.acquisitionClear).toHaveBeenCalledTimes(1)` to the successful
`jumpToScene` and `returnToMainMenu` tests. Add
`expect(mocks.acquisitionClear).not.toHaveBeenCalled()` to the in-flight
`returnToMainMenu` no-op test.

- [ ] **Step 2: Run the game-client tests to verify they fail**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected: FAIL because the game client does not import, infer, enqueue, or clear acquisition notifications.

- [ ] **Step 3: Wire acquisition inference into successful commands**

Add these imports to `game-client.svelte.ts`:

```ts
import { acquisitionController } from "./acquisition-controller.svelte";
import { inferAcquisitionNotifications } from "./acquisition-notifications";
```

Add this helper immediately before `dispatchGameCommand`:

```ts
function enqueueAcquisitions(
  previous: GameStateView | null,
  next: GameStateView,
  command: GameplayCommandName,
) {
  try {
    acquisitionController.enqueue(
      inferAcquisitionNotifications(previous, next),
    );
  } catch (error) {
    console.warn(
      `[AcquisitionPopup] inference failed for ${command}`,
      error,
    );
  }
}
```

Inside the successful `if (v)` block, place acquisition enqueueing immediately
after `gameState.value = v` and before SFX inference:

```ts
gameState.value = v;
enqueueAcquisitions(previous, v, command);
```

Update reset, main-menu, and scene-jump functions exactly as follows:

```ts
export async function resetGame() {
  acquisitionController.clear();
  await dispatchGameCommand("reset_game", undefined, true);
}

export function returnToMainMenu() {
  if (gameState.inFlight) return;
  acquisitionController.clear();
  gameState.value = null;
  gameState.error = null;
  gameState.loading = false;
}

export async function jumpToScene(chapterId: string, sceneId: string) {
  acquisitionController.clear();
  await dispatchStateCommand("jump_to_scene", { chapterId, sceneId }, true);
}
```

- [ ] **Step 4: Run state tests and type checking**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/acquisition-notifications.test.ts src/lib/state/acquisition-controller.test.ts src/lib/state/game-client-source.test.ts
rtk bun run check
```

Expected: all focused tests PASS and `svelte-check` reports 0 errors and 0 warnings.

- [ ] **Step 5: Commit game-client integration**

```bash
rtk git add apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/state/game-client-source.test.ts
rtk git commit -m "feat(game): enqueue acquisition popups from commands"
```

---

### Task 4: Acquisition Popup Component

**Files:**
- Create: `apps/game/src/lib/components/AcquisitionPopup.svelte`
- Create: `apps/game/src/lib/components/AcquisitionPopup.test.ts`

**Interfaces:**
- Consumes: `notification: AcquisitionNotification`, `returnFocusTo: HTMLElement | null`, and `onContinue(key: string): boolean`. The callback returns `true` while another queued item still needs the same Escape claim.
- Produces: one accessible modal with evidence/statement variants, asset fallback, continuous Escape ownership, focus trapping, keyed content transitions, and focus restoration on final unmount.

- [ ] **Step 1: Write failing component tests**

Create `apps/game/src/lib/components/AcquisitionPopup.test.ts` with fixtures for
one evidence notification and one statement notification. Cover these exact
behaviors:

```ts
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type { AcquisitionNotification } from "$lib/state/acquisition-notifications";
import AcquisitionPopup from "./AcquisitionPopup.svelte";

const testDir = dirname(fileURLToPath(import.meta.url));

const evidenceNotification: AcquisitionNotification = {
  key: "evidence:receipt",
  kind: "evidence",
  record: {
    id: "receipt",
    name: "咖啡收據",
    description: "收據上的時間被圈起。",
    details: "不應顯示的詳細資料",
    imageAssetId: "evidence.receipt_component_test",
    onReexamine: null,
    collectedInChapterId: "chapter_1",
    collectedInSceneId: "investigation_scene_1",
  },
};

const statementNotification: AcquisitionNotification = {
  key: "statement:alibi",
  kind: "statement",
  record: {
    id: "alibi",
    speaker: "若月",
    content: "我一直在店內。",
    onReexamine: null,
    acquiredInChapterId: "chapter_1",
    acquiredInSceneId: "investigation_scene_1",
  },
};

afterEach(() => {
  cleanup();
  resetEscapeCoordinator();
});

describe("AcquisitionPopup", () => {
  it("renders evidence copy, description, and resolved image without details", async () => {
    const { container } = render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue: vi.fn(() => false),
    });

    expect(screen.getByRole("dialog", { name: "物證取得" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByText("EVIDENCE ACQUIRED")).toBeInTheDocument();
    expect(screen.getByText("咖啡收據")).toBeInTheDocument();
    expect(screen.getByText("收據上的時間被圈起。")).toBeInTheDocument();
    expect(screen.queryByText("不應顯示的詳細資料")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector("img.evidence-image")).toHaveAttribute(
        "src",
        "/assets/evidence/receipt_component_test.png",
      );
    });
  });

  it("uses a generic evidence placeholder for a null image ID", async () => {
    const noImage = {
      ...evidenceNotification,
      record: { ...evidenceNotification.record, imageAssetId: null },
    };
    const { container } = render(AcquisitionPopup, {
      notification: noImage,
      returnFocusTo: null,
      onContinue: vi.fn(() => false),
    });

    await waitFor(() => {
      expect(container.querySelector("img.evidence-image")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("falls back when a resolved evidence image emits an error", async () => {
    const { container } = render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue: vi.fn(() => false),
    });
    const image = await waitFor(() => {
      const result = container.querySelector("img.evidence-image");
      expect(result).toBeInTheDocument();
      return result as HTMLImageElement;
    });

    image.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(container.querySelector("img.evidence-image")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("renders statement copy, speaker, content, and no raster image", () => {
    const { container } = render(AcquisitionPopup, {
      notification: statementNotification,
      returnFocusTo: null,
      onContinue: vi.fn(() => false),
    });

    expect(screen.getByRole("dialog", { name: "證言取得" })).toBeInTheDocument();
    expect(screen.getByText("STATEMENT ACQUIRED")).toBeInTheDocument();
    expect(screen.getByText("若月")).toBeInTheDocument();
    expect(screen.getByText("我一直在店內。")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector(".statement-seal")).toBeInTheDocument();
  });

  it("focuses Continue, traps Tab, and forwards the current key", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => false);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
  });

  it("dismisses from a pointer click", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => false);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });

    await user.click(
      screen.getByRole("button", { name: "CONTINUE / 繼續" }),
    );

    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
  });

  it("dismisses from Space on the focused native button", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => false);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.keyboard(" ");

    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
  });

  it("routes Escape through the coordinator and releases on the final item", async () => {
    const onContinue = vi.fn(() => false);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });

    await waitFor(() => {
      expect(closeTopmostEscapeClaim()).toBe(true);
    });
    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
    expect(closeTopmostEscapeClaim()).toBe(false);
  });

  it("does not dismiss from a backdrop click", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => false);
    const { container } = render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });

    await user.click(container.querySelector(".acquisition-scrim")!);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("restores a connected focus target after unmount", async () => {
    const target = document.createElement("button");
    document.body.append(target);
    target.focus();
    const result = render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: target,
      onContinue: vi.fn(() => false),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "CONTINUE / 繼續" })).toHaveFocus();
    });
    result.unmount();
    await waitFor(() => expect(target).toHaveFocus());
    target.remove();
  });

  it("disables the entrance animation for reduced motion", () => {
    const source = readFileSync(
      join(testDir, "AcquisitionPopup.svelte"),
      "utf8",
    );
    expect(source).toContain("animation: acquisition-enter 180ms ease-out both");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).toContain("animation: none");
    expect(source).toContain("max-height: min(220px, 32dvh)");
    expect(source).toContain("overflow-y: auto");
    expect(source).toContain("!cancelled && notification.key === key");
    expect(source).toContain("if (target?.isConnected) target.focus()");
  });
});
```

- [ ] **Step 2: Run the popup tests to verify they fail**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/components/AcquisitionPopup.test.ts
```

Expected: FAIL because `AcquisitionPopup.svelte` does not exist.

- [ ] **Step 3: Implement the popup behavior and markup**

Create `apps/game/src/lib/components/AcquisitionPopup.svelte` with this script
and markup:

```svelte
<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import {
    placeholderForMissingStoryAsset,
    placeholderForStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import type { AcquisitionNotification } from "$lib/state/acquisition-notifications";
  import { claimEscape } from "$lib/state/escape-coordinator";

  let {
    notification,
    returnFocusTo = null,
    onContinue,
  }: {
    notification: AcquisitionNotification;
    returnFocusTo?: HTMLElement | null;
    onContinue: (key: string) => boolean;
  } = $props();

  let continueButton: HTMLButtonElement | undefined = $state();
  let evidenceImage: ResolvedStoryAsset | null = $state(null);
  let focusTarget: HTMLElement | null = null;
  let releaseEscapeClaim: (() => void) | null = null;

  const heading = $derived(
    notification.kind === "evidence" ? "物證取得" : "證言取得",
  );
  const eyebrow = $derived(
    notification.kind === "evidence"
      ? "EVIDENCE ACQUIRED"
      : "STATEMENT ACQUIRED",
  );
  const title = $derived(
    notification.kind === "evidence"
      ? notification.record.name
      : notification.record.speaker,
  );
  const description = $derived(
    notification.kind === "evidence"
      ? notification.record.description
      : notification.record.content,
  );

  $effect(() => {
    const key = notification.key;
    let cancelled = false;
    if (notification.kind !== "evidence") {
      evidenceImage = null;
      return;
    }

    const assetId = notification.record.imageAssetId;
    if (!assetId) {
      evidenceImage = placeholderForStoryAsset("evidence");
      return;
    }

    evidenceImage = null;
    resolveStoryAsset(assetId, "evidence")
      .then((asset) => {
        if (!cancelled && notification.key === key) {
          evidenceImage = asset ?? placeholderForStoryAsset("evidence");
        }
      })
      .catch(() => {
        if (!cancelled && notification.key === key) {
          evidenceImage = placeholderForMissingStoryAsset(assetId, "evidence");
        }
      });

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    void notification.key;
    void tick().then(() => continueButton?.focus());
  });

  function dismissCurrent() {
    const remainsOpen = onContinue(notification.key);
    if (!remainsOpen) {
      releaseEscapeClaim?.();
      releaseEscapeClaim = null;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    continueButton?.focus();
  }

  function handleImageError() {
    if (!evidenceImage || evidenceImage.placeholder) return;
    evidenceImage = placeholderForMissingStoryAsset(
      evidenceImage.assetId,
      "evidence",
    );
  }

  onMount(() => {
    focusTarget = returnFocusTo;
    releaseEscapeClaim = claimEscape(dismissCurrent);
    void tick().then(() => continueButton?.focus());
  });

  onDestroy(() => {
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;
    const target = focusTarget;
    void tick().then(() => {
      if (target?.isConnected) target.focus();
    });
  });
</script>

<div class="acquisition-scrim">
  {#key notification.key}
    <section
      class="acquisition-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="acquisition-heading"
      aria-describedby="acquisition-description"
      onkeydown={handleKeydown}
    >
      <header>
        <p class="eyebrow">{eyebrow}</p>
        <h2 id="acquisition-heading">{heading}</h2>
      </header>

      <div class="acquisition-body">
        <div class="visual" aria-hidden="true">
          {#if notification.kind === "evidence" && evidenceImage}
            <img
              class="evidence-image"
              src={evidenceImage.url}
              alt=""
              onerror={handleImageError}
            />
          {:else if notification.kind === "statement"}
            <div class="statement-seal">證</div>
          {/if}
        </div>

        <div class="copy">
          <p class="item-title">{title}</p>
          <p
            id="acquisition-description"
            class:statement-content={notification.kind === "statement"}
          >
            {description}
          </p>
        </div>
      </div>

      <button
        bind:this={continueButton}
        class="continue-button"
        type="button"
        onclick={dismissCurrent}
      >
        CONTINUE / 繼續
      </button>
    </section>
  {/key}
</div>
```

- [ ] **Step 4: Add complete dossier styling**

Append this style block to `AcquisitionPopup.svelte`:

```svelte
<style>
  .acquisition-scrim {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    padding: 28px;
    background: rgba(4, 5, 10, 0.78);
  }

  .acquisition-card {
    width: min(760px, calc(100vw - 56px));
    max-height: min(620px, calc(100dvh - 56px));
    box-sizing: border-box;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 22px;
    padding: 28px;
    overflow: hidden;
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--crimson);
    background: rgba(12, 13, 22, 0.99);
    color: var(--bone);
    box-shadow: 0 28px 90px rgba(0, 0, 0, 0.7);
    animation: acquisition-enter 180ms ease-out both;
  }

  header,
  .copy {
    min-width: 0;
  }

  h2,
  p {
    margin: 0;
  }

  .eyebrow,
  .continue-button {
    font-family: var(--impact);
    letter-spacing: 0.2em;
  }

  .eyebrow {
    margin-bottom: 8px;
    color: var(--crimson);
    font-size: 11px;
  }

  h2 {
    font-family: var(--display-jp);
    font-size: clamp(26px, 4vw, 40px);
    font-weight: 400;
    letter-spacing: 0.08em;
  }

  .acquisition-body {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
    gap: 26px;
    align-items: center;
  }

  .visual {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.035);
  }

  .evidence-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .statement-seal {
    width: 62%;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: 2px solid var(--cyan);
    color: var(--cyan);
    font-family: var(--display-jp);
    font-size: clamp(52px, 9vw, 84px);
    transform: rotate(-4deg);
    box-shadow: inset 0 0 0 8px rgba(67, 205, 213, 0.06);
  }

  .copy {
    display: grid;
    gap: 14px;
  }

  .item-title {
    color: var(--bone);
    font-family: var(--display-jp);
    font-size: clamp(22px, 3vw, 32px);
    overflow-wrap: anywhere;
  }

  #acquisition-description {
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 16px;
    line-height: 1.75;
    overflow-wrap: anywhere;
  }

  #acquisition-description.statement-content {
    max-height: min(220px, 32dvh);
    overflow-y: auto;
  }

  .continue-button {
    justify-self: end;
    min-width: 190px;
    min-height: 44px;
    padding: 11px 18px;
    border: 1px solid var(--rule-strong);
    background: var(--crimson-soft);
    color: var(--bone);
    cursor: pointer;
  }

  .continue-button:hover,
  .continue-button:focus-visible {
    border-color: var(--crimson);
    background: rgba(174, 28, 49, 0.3);
    outline: 2px solid var(--cyan);
    outline-offset: 3px;
  }

  @keyframes acquisition-enter {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (max-width: 640px) {
    .acquisition-scrim {
      padding: 18px;
    }

    .acquisition-card {
      width: calc(100vw - 36px);
      max-height: calc(100dvh - 36px);
      gap: 16px;
      padding: 20px;
    }

    .acquisition-body {
      grid-template-columns: 1fr;
      gap: 16px;
    }

    .visual {
      width: min(210px, 55vw);
      justify-self: center;
    }

    .continue-button {
      width: 100%;
      justify-self: stretch;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .acquisition-card {
      animation: none;
    }
  }
</style>
```

- [ ] **Step 5: Run component tests and type checking**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/components/AcquisitionPopup.test.ts
rtk bun run check
```

Expected: popup tests PASS and `svelte-check` reports 0 errors and 0 warnings.

- [ ] **Step 6: Commit the popup component**

```bash
rtk git add apps/game/src/lib/components/AcquisitionPopup.svelte apps/game/src/lib/components/AcquisitionPopup.test.ts
rtk git commit -m "feat(game): add acquisition popup component"
```

---

### Task 5: Page-Level Blocking and Layer Coordination

**Files:**
- Modify: `apps/game/src/routes/+page.svelte:1-319`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/src/routes/page-source.test.ts`

**Interfaces:**
- Consumes: singleton `acquisitionController` from Task 2 and `AcquisitionPopup` from Task 4.
- Produces: one page-owned modal above a `data-gameplay-root` inert subtree; captures the previously focused element before inert is applied; keeps Escape claimed until the queue is empty.

- [ ] **Step 1: Add failing page integration tests**

In `page.test.ts`, import the controller:

```ts
import { acquisitionController } from "$lib/state/acquisition-controller.svelte";
import type { AcquisitionNotification } from "$lib/state/acquisition-notifications";
```

Add global cleanup beside the existing helpers:

```ts
beforeEach(() => {
  acquisitionController.clear();
});

afterEach(() => {
  acquisitionController.clear();
});
```

Add these notification fixtures:

```ts
const acquiredEvidence: AcquisitionNotification = {
  key: "evidence:receipt",
  kind: "evidence",
  record: {
    id: "receipt",
    name: "咖啡收據",
    description: "收據上的時間被圈起。",
    details: "",
    imageAssetId: null,
    onReexamine: null,
    collectedInChapterId: "chapter_1",
    collectedInSceneId: "scene_1",
  },
};

const acquiredStatement: AcquisitionNotification = {
  key: "statement:alibi",
  kind: "statement",
  record: {
    id: "alibi",
    speaker: "若月",
    content: "我一直在店內。",
    onReexamine: null,
    acquiredInChapterId: "chapter_1",
    acquiredInSceneId: "scene_1",
  },
};
```

Add a new describe block:

```ts
describe("+page acquisition popup integration", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
    seedGameState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    acquisitionController.clear();
    gameState.value = null;
    gameState.error = null;
    gameState.loading = false;
    gameState.inFlight = false;
  });

  it("inerts gameplay and restores focus after the final acknowledgement", async () => {
    const user = userEvent.setup();
    const { container } = render(Page);
    const dialogueButton = screen.getByRole("button", { name: "推進對話" });
    dialogueButton.focus();

    acquisitionController.enqueue([acquiredEvidence]);

    const popup = await screen.findByRole("dialog", { name: "物證取得" });
    const gameplayRoot = container.querySelector("[data-gameplay-root]")!;
    expect(gameplayRoot).toHaveAttribute("inert");
    expect(
      within(popup).getByRole("button", { name: "CONTINUE / 繼續" }),
    ).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "物證取得" })).toBeNull();
      expect(gameplayRoot).not.toHaveAttribute("inert");
      expect(dialogueButton).toHaveFocus();
    });
    expect(
      mocks.fetch.mock.calls.some(([url]) =>
        String(url).endsWith("/advance_dialogue"),
      ),
    ).toBe(false);
  });

  it("keeps Escape on the popup until a multi-item queue is empty", async () => {
    const user = userEvent.setup();
    render(Page);
    acquisitionController.enqueue([acquiredEvidence, acquiredStatement]);

    await screen.findByRole("dialog", { name: "物證取得" });
    await user.keyboard("{Escape}");

    expect(
      await screen.findByRole("dialog", { name: "證言取得" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "證言取得" })).toBeNull();
    });
    expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();

    await user.keyboard("{Escape}");
    expect(
      await screen.findByRole("dialog", { name: "遊戲選單" }),
    ).toBeInTheDocument();
  });

  it("clears queued acquisitions when the page unmounts", () => {
    const result = render(Page);
    acquisitionController.enqueue([acquiredEvidence, acquiredStatement]);
    expect(acquisitionController.blocking).toBe(true);

    result.unmount();

    expect(acquisitionController.blocking).toBe(false);
    expect(acquisitionController.size).toBe(0);
  });
});
```

Add this source-level test to `page-source.test.ts`:

```ts
describe("+page acquisition popup ownership", () => {
  it("mounts one popup outside an inert gameplay root", () => {
    const source = pageSource();

    expect(source).toContain('data-gameplay-root=""');
    expect(source).toContain("inert={acquisitionController.blocking}");
    expect(source).toContain("<AcquisitionPopup");
    expect(source).toContain("notification={acquisitionController.current}");
  });
});
```

- [ ] **Step 2: Run page tests to verify they fail**

Run:

```bash
rtk bun run --cwd apps/game test src/routes/page.test.ts src/routes/page-source.test.ts
```

Expected: FAIL because the page does not mount the popup or inert gameplay.

- [ ] **Step 3: Add page state, focus capture, and lifecycle cleanup**

Add these imports to `+page.svelte`:

```ts
import AcquisitionPopup from "$lib/components/AcquisitionPopup.svelte";
import { acquisitionController } from "$lib/state/acquisition-controller.svelte";
```

Replace the existing Svelte import with:

```ts
import { onDestroy, untrack } from "svelte";
```

Add this state and pre-effect after the existing page state declarations:

```ts
let acquisitionReturnFocus = $state<HTMLElement | null>(null);
let acquisitionWasBlocking = false;

$effect.pre(() => {
  const blocking = acquisitionController.blocking;
  if (blocking && !acquisitionWasBlocking) {
    const active = document.activeElement;
    acquisitionReturnFocus = active instanceof HTMLElement ? active : null;
  }
  acquisitionWasBlocking = blocking;
});

onDestroy(() => {
  acquisitionController.clear();
});

function handleAcquisitionContinue(key: string) {
  acquisitionController.dismissCurrent(key);
  return acquisitionController.blocking;
}
```

- [ ] **Step 4: Mount the popup outside an inert gameplay wrapper**

Immediately after `{#if gameState.value}`, insert:

```svelte
  <div
    class="gameplay-root"
    data-gameplay-root=""
    inert={acquisitionController.blocking}
  >
```

Immediately after the existing `</GameShell>`, insert the wrapper close and
popup branch:

```svelte
  </div>
  {#if acquisitionController.current}
    <AcquisitionPopup
      notification={acquisitionController.current}
      returnFocusTo={acquisitionReturnFocus}
      onContinue={handleAcquisitionContinue}
    />
  {/if}
```

- [ ] **Step 5: Run page, popup, and state tests**

Run:

```bash
rtk bun run --cwd apps/game test src/routes/page.test.ts src/routes/page-source.test.ts src/lib/components/AcquisitionPopup.test.ts src/lib/state/acquisition-controller.test.ts src/lib/state/game-client-source.test.ts
rtk bun run check
```

Expected: all focused tests PASS and `svelte-check` reports 0 errors and 0 warnings.

- [ ] **Step 6: Commit page integration**

```bash
rtk git add apps/game/src/routes/+page.svelte apps/game/src/routes/page.test.ts apps/game/src/routes/page-source.test.ts
rtk git commit -m "feat(game): block gameplay for acquisition popups"
```

---

### Task 6: Browser Flow and Final Verification

**Files:**
- Modify: `apps/game/e2e/app.spec.ts:1-340`

**Interfaces:**
- Consumes: completed detector, controller, game-client, component, and page integration from Tasks 1-5.
- Produces: built-SPA proof that mixed acquisitions display sequentially, popup input does not advance dialogue, Escape does not open the menu prematurely, and inventory remains available afterward.

- [ ] **Step 1: Extend the mocked inspected state with a statement**

In `inspectedView.inventory.statements`, replace the empty array with:

```ts
statements: [
  {
    id: "witness_timeline",
    speaker: "證人",
    content: "我在十一點前看見桌上的咖啡仍冒著熱氣。",
    onReexamine: null,
    acquiredInChapterId: "chapter_1",
    acquiredInSceneId: "investigation_scene_1",
  },
],
```

- [ ] **Step 2: Replace the inventory test with the complete acquisition flow**

Replace the existing test named `inspects a hotspot and shows inventory` with:

```ts
test("shows sequential acquisition popups before dialogue and inventory", async ({
  page,
}) => {
  await startFromMenu(page);
  await advanceDialogue(page);
  await page.getByRole("button", { name: /桌子/ }).click();

  const evidencePopup = page.getByRole("dialog", { name: "物證取得" });
  await expect(evidencePopup).toBeVisible();
  await expect(evidencePopup.getByText("還熱的咖啡")).toBeVisible();
  await expect(
    evidencePopup.getByRole("button", { name: "CONTINUE / 繼續" }),
  ).toBeFocused();

  await page.keyboard.press("Enter");

  const statementPopup = page.getByRole("dialog", { name: "證言取得" });
  await expect(statementPopup).toBeVisible();
  await expect(statementPopup.getByText("證人")).toBeVisible();
  await expect(statementPopup).toContainText(
    "我在十一點前看見桌上的咖啡仍冒著熱氣。",
  );
  await expect(page.getByRole("dialog", { name: "遊戲選單" })).toHaveCount(0);

  await page.keyboard.press("Escape");

  await expect(statementPopup).toBeHidden();
  await expect(page.getByRole("dialog", { name: "遊戲選單" })).toHaveCount(0);
  await expect(page.getByText("還是熱的。")).toBeVisible();

  await page.keyboard.press("Escape");
  const gameMenu = page.getByRole("dialog", { name: "遊戲選單" });
  await expect(gameMenu).toBeVisible();
  await gameMenu.getByRole("button", { name: /物證/ }).click();

  const evidenceMenu = page.getByRole("dialog", { name: "物證檔案" });
  await expect(evidenceMenu.getByText("還熱的咖啡")).toBeVisible();
  await expect(evidenceMenu.getByText("證人")).toBeVisible();
});
```

This proves the Enter used for evidence acknowledgement did not advance the
underlying dialogue: `還是熱的。` is still the active line after the statement
popup closes.

- [ ] **Step 3: Pin the failed-command no-popup path**

Add this assertion to the existing `surfaces command errors in the banner`
test after the alert assertion:

```ts
await expect(
  page.getByRole("dialog", { name: /取得/ }),
).toHaveCount(0);
```

- [ ] **Step 4: Run all focused unit and component tests**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/acquisition-notifications.test.ts src/lib/state/acquisition-controller.test.ts src/lib/state/game-client-source.test.ts src/lib/components/AcquisitionPopup.test.ts src/routes/page.test.ts src/routes/page-source.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Run the focused browser flow**

Run:

```bash
rtk bun run --cwd apps/game test:e2e e2e/app.spec.ts
```

Expected: the App shell Playwright suite PASSes, including the sequential acquisition flow and failed-command no-popup assertion.

- [ ] **Step 6: Run the broader frontend verification**

Run:

```bash
rtk bun run --cwd apps/game test
rtk bun run check
rtk proxy git diff --check
```

Expected: all game Vitest tests PASS, `svelte-check` reports 0 errors and 0 warnings, and `git diff --check` prints no errors.

- [ ] **Step 7: Commit the browser coverage**

```bash
rtk git add apps/game/e2e/app.spec.ts
rtk git commit -m "test(game): cover acquisition popup flow"
```

## Completion Checklist

- [ ] `git status --short` shows no unexpected or generated files.
- [ ] The detector emits nothing for hydration, unchanged state, removals, or reset-to-empty.
- [ ] Mixed acquisitions appear evidence-first and preserve order within each type.
- [ ] Each click, Enter, Space, or Escape dismisses one keyed item.
- [ ] Escape remains claimed between queued items and reaches `GameShell` only after the final popup closes.
- [ ] Gameplay is inert and dialogue does not advance under the popup.
- [ ] Focus returns only when the saved target still exists.
- [ ] Evidence null/missing image paths and statement scroll behavior are covered.
- [ ] No Rust, scene, compiler, generated resource, asset catalog, or audio files changed.
- [ ] Focused Vitest, full game Vitest, focused Playwright, `bun run check`, and `git diff --check` all pass.
