import { describe, expect, it } from "vitest";
import type { AcquisitionNotification } from "./acquisition-notifications";
import { createAcquisitionController } from "./acquisition-controller.svelte";

function notification(key: string, name: string): AcquisitionNotification {
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
