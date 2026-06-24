import { describe, expect, it } from "vitest";
import type { GameStateView } from "$lib/state/types";
import {
  assetIdForGameplaySfxEvent,
  inferGameplaySfxEvents,
  type GameplayCommandName,
} from "./sfx-events";

function state(overrides: Partial<GameStateView> = {}): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "Chapter",
      summary: "",
      index: 0,
      total: 1,
    },
    scene: {
      kind: "investigation",
      id: "investigation_scene_7",
      title: "",
      index: 0,
      total: 1,
      currentSublocationId: "back_door",
      visibleSublocations: [],
    },
    mode: {
      type: "explore",
      sublocationId: "back_door",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
    ...overrides,
  };
}

describe("SFX event mapping", () => {
  it("maps existing Chapter 1 story beat hooks to generated SFX", () => {
    expect(assetIdForGameplaySfxEvent("story:anonymous-message")).toBe(
      "audio.sfx.sfx_anonymous_message_buzz",
    );
    expect(assetIdForGameplaySfxEvent("story:rice-ball-bag")).toBe(
      "audio.sfx.sfx_rice_ball_bag_crinkle",
    );
    expect(assetIdForGameplaySfxEvent("story:coffee-backflush")).toBe(
      "audio.sfx.sfx_coffee_machine_backflush",
    );
    expect(assetIdForGameplaySfxEvent("story:usb-insert")).toBe(
      "audio.sfx.sfx_usb_insert_chime",
    );
  });

  it("leaves generic events silent unless they have a meaningful match", () => {
    expect(
      assetIdForGameplaySfxEvent("investigation:hotspot-inspected"),
    ).toBeNull();
    expect(
      assetIdForGameplaySfxEvent("interrogation:question-answered"),
    ).toBeNull();
  });
});

describe("inferGameplaySfxEvents", () => {
  it("dispatches the anonymous-message hook when entering chapter 1 investigation scene 7", () => {
    const previous = state({
      scene: { kind: "linear", id: "scene_6", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: { kind: "action", text: "" },
        queueRemaining: 0,
        sceneTag: null,
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        queueToken: { sceneId: "scene_6", queueGen: 1, cursor: 0 },
      },
    });
    const next = state();
    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual([
      "story:anonymous-message",
    ]);
  });

  it("dispatches the USB hook when entering the chapter 1 office-night scene tag", () => {
    const previous = state({
      scene: { kind: "linear", id: "scene_11", title: "", index: 0, total: 1 },
    });
    const next = state({
      scene: { kind: "linear", id: "scene_11", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: { kind: "sceneTag", text: "相馬事務所，夜晚。" },
        queueRemaining: 0,
        sceneTag: "相馬事務所，夜晚。",
        backgroundAssetId: "background.chapter_1.scene_11.office_night",
        bgm: null,
        bgs: null,
        queueToken: { sceneId: "scene_11", queueGen: 2, cursor: 4 },
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual([
      "story:usb-insert",
    ]);
  });

  it("dispatches acquired-evidence only when inventory grows", () => {
    const previous = state();
    const next = state({
      inventory: {
        evidence: [
          {
            id: "amemiya_message_thumb",
            name: "雨宮匿名訊息縮圖",
            description: "",
            details: "",
            imageAssetId: null,
            onReexamine: null,
            collectedInChapterId: "chapter_1",
            collectedInSceneId: "investigation_scene_7",
          },
        ],
        statements: [],
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "inspect_hotspot")).toEqual([
      "investigation:hotspot-inspected",
      "investigation:evidence-acquired",
    ]);
  });

  it("does not dispatch success SFX without a next state", () => {
    expect(inferGameplaySfxEvents(state(), null, "inspect_hotspot")).toEqual(
      [],
    );
  });

  it("accepts all command names used by the state client", () => {
    const names: GameplayCommandName[] = [
      "start_game",
      "reset_game",
      "advance_dialogue",
      "inspect_hotspot",
      "interview_topic",
      "enter_sublocation",
      "reexamine_evidence",
      "reexamine_statement",
      "answer_interrogation_question",
      "press_testimony_statement",
      "present_testimony_item",
    ];
    expect(names).toContain("present_testimony_item");
  });
});
