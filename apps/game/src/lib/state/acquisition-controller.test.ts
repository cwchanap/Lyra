import { describe, expect, it, vi } from "vitest";
import type { GameStateView, PendingAcquisitionView } from "./types";
import { createAcquisitionController } from "./acquisition-controller.svelte";

function acquisition(id = "event-1"): PendingAcquisitionView {
  return {
    id,
    recordKind: "evidence",
    recordId: "receipt",
    title: "咖啡收據",
    description: "收據上的時間被圈起。",
    details: "完整資料",
    imageAssetId: "evidence.receipt",
    createdByCommandId: 7,
    ordinal: 0,
  };
}

function state(
  pendingAcquisition: PendingAcquisitionView | null = acquisition(),
): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "第一章",
      summary: "",
      index: 0,
      total: 1,
    },
    scene: {
      kind: "investigation",
      id: "investigation_scene_1",
      title: "雨夜",
      summary: "",
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
    inventory: { evidence: [], statements: [] },
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: [],
    pendingAcquisition,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const gameState = { value: state() as GameStateView | null };
  const acknowledge =
    vi.fn<(eventId: string) => Promise<GameStateView | null>>();
  // The client contract applies the authoritative backend state before
  // resolving; the controller must never apply or queue state itself.
  acknowledge.mockImplementation(async () => {
    const next = state(null);
    gameState.value = next;
    return next;
  });
  const controller = createAcquisitionController({ gameState, acknowledge });
  return { acknowledge, controller, gameState };
}

describe("acquisition controller", () => {
  it("derives current and blocking from the authoritative game state", () => {
    const { controller, gameState } = setup();

    expect(controller.current).toEqual(acquisition());
    expect(controller.blocking).toBe(true);

    gameState.value = state(null);

    expect(controller.current).toBeNull();
    expect(controller.blocking).toBe(false);
  });

  it("dismisses by calling the acknowledgement exactly once for the exact event id", async () => {
    const { acknowledge, controller } = setup();

    await controller.dismissCurrent("event-1");

    expect(acknowledge).toHaveBeenCalledExactlyOnceWith("event-1");
    expect(controller.current).toBeNull();
    expect(controller.blocking).toBe(false);
    expect(controller.busy).toBe(false);
  });

  it("ignores a dismissal for a non-presented event id", async () => {
    const { acknowledge, controller } = setup();

    await controller.dismissCurrent("event-stale");

    expect(acknowledge).not.toHaveBeenCalled();
    expect(controller.current?.id).toBe("event-1");
  });

  it("sets busy while the acknowledgement is unresolved and prevents duplicate dispatch", async () => {
    const { acknowledge, controller, gameState } = setup();
    const acknowledgement = deferred<GameStateView | null>();
    acknowledge.mockImplementationOnce(async () => {
      const next = await acknowledgement.promise;
      gameState.value = next;
      return next;
    });

    const dismissal = controller.dismissCurrent("event-1");
    expect(controller.busy).toBe(true);

    await controller.dismissCurrent("event-1");
    expect(acknowledge).toHaveBeenCalledTimes(1);

    acknowledgement.resolve(state(null));
    await dismissal;

    expect(controller.busy).toBe(false);
    expect(controller.current).toBeNull();
  });

  it("reflects the authoritative applied state after success instead of a local queue", async () => {
    const { acknowledge, controller, gameState } = setup();
    // The backend response is authoritative: if it still presents an event,
    // the controller must keep showing it rather than assuming its own
    // dismissal cleared it.
    acknowledge.mockImplementationOnce(async () => {
      const next = state(acquisition("event-2"));
      gameState.value = next;
      return next;
    });

    await controller.dismissCurrent("event-1");

    expect(controller.current?.id).toBe("event-2");
    expect(controller.blocking).toBe(true);
    expect(controller.busy).toBe(false);
  });

  it("leaves the event visible after a command failure and permits another Continue", async () => {
    const { acknowledge, controller } = setup();
    // The client surfaces typed failures through gameState.error and resolves
    // null from the shared dispatch path.
    acknowledge.mockResolvedValueOnce(null);

    await controller.dismissCurrent("event-1");

    expect(controller.current?.id).toBe("event-1");
    expect(controller.blocking).toBe(true);
    expect(controller.busy).toBe(false);

    await controller.dismissCurrent("event-1");
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  it("absorbs an acknowledgement rejection, clears busy, and leaves the event visible", async () => {
    const { acknowledge, controller } = setup();
    acknowledge.mockRejectedValueOnce(new Error("backend unavailable"));

    // The controller must not propagate the rejection: the shared dispatch
    // path surfaces typed failures through gameState.error, and an unexpected
    // rejection (e.g. frame synchronization) is absorbed so the popup never
    // observes an unhandled rejected promise. Busy still resets via finally
    // and the event stays visible so the user can press Continue again.
    await expect(controller.dismissCurrent("event-1")).resolves.toBeUndefined();

    expect(controller.busy).toBe(false);
    expect(controller.current?.id).toBe("event-1");
  });

  it("clear invalidates an older in-flight generation so its late finally cannot clear a newer busy state", async () => {
    const { acknowledge, controller, gameState } = setup();
    const oldAcknowledgement = deferred<GameStateView | null>();
    const newAcknowledgement = deferred<GameStateView | null>();
    acknowledge
      .mockImplementationOnce(async () => {
        const next = await oldAcknowledgement.promise;
        gameState.value = next;
        return next;
      })
      .mockImplementationOnce(async () => {
        const next = await newAcknowledgement.promise;
        gameState.value = next;
        return next;
      });

    const oldDismissal = controller.dismissCurrent("event-1");
    expect(controller.busy).toBe(true);

    controller.clear();
    expect(controller.busy).toBe(false);

    const newDismissal = controller.dismissCurrent("event-1");
    expect(controller.busy).toBe(true);
    expect(acknowledge).toHaveBeenCalledTimes(2);

    oldAcknowledgement.resolve(state(null));
    await oldDismissal;

    // The old finally must not clear the newer attempt's busy state.
    expect(controller.busy).toBe(true);

    newAcknowledgement.resolve(state(null));
    await newDismissal;

    expect(controller.busy).toBe(false);
    expect(controller.current).toBeNull();
  });

  it("exposes no size, phase, retry, cancel, or bypass API", () => {
    const { controller } = setup();

    expect("size" in controller).toBe(false);
    expect("phase" in controller).toBe(false);
    expect("retry" in controller).toBe(false);
    expect("cancel" in controller).toBe(false);
    expect("continueWithoutSaving" in controller).toBe(false);
  });
});
