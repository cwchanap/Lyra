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
    expect(assetIdForGameplaySfxEvent("ui:new-game")).toBeNull();
    expect(assetIdForGameplaySfxEvent("ui:menu-confirm")).toBe(
      "audio.sfx.sfx_dialogue_proceed_tick",
    );
    expect(
      assetIdForGameplaySfxEvent("investigation:hotspot-inspected"),
    ).toBeNull();
    expect(
      assetIdForGameplaySfxEvent("interrogation:question-answered"),
    ).toBeNull();
  });
});

describe("inferGameplaySfxEvents", () => {
  it("does not dispatch generic dialogue feedback after ordinary dialogue advances", () => {
    const previous = state({
      scene: { kind: "linear", id: "scene_2", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: { kind: "line", speaker: "相馬律", text: "先確認時間。" },
        queueRemaining: 2,
        sceneTag: null,
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        queueToken: { sceneId: "scene_2", queueGen: 1, cursor: 4 },
      },
    });
    const next = state({
      scene: { kind: "linear", id: "scene_2", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: { kind: "line", speaker: "早坂朱音", text: "好。" },
        queueRemaining: 1,
        sceneTag: null,
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        queueToken: { sceneId: "scene_2", queueGen: 1, cursor: 5 },
      },
    });

    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual(
      [],
    );
  });

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

  it("dispatches the USB hook on the exact chapter 1 insert action beat", () => {
    const previous = state({
      scene: { kind: "linear", id: "scene_11", title: "", index: 0, total: 1 },
    });
    const next = state({
      scene: { kind: "linear", id: "scene_11", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: {
          kind: "action",
          text: "他把隨身碟插上筆電。螢幕跳出一行目錄。",
        },
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

  it("does not replay the USB hook on later dialogue under the sticky office-night scene tag", () => {
    const previous = state({
      scene: { kind: "linear", id: "scene_11", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: {
          kind: "action",
          text: "他把隨身碟插上筆電。螢幕跳出一行目錄。",
        },
        queueRemaining: 4,
        sceneTag: "相馬事務所，夜晚。",
        backgroundAssetId: "background.chapter_1.scene_11.office_night",
        bgm: null,
        bgs: null,
        queueToken: { sceneId: "scene_11", queueGen: 2, cursor: 4 },
      },
    });
    const next = state({
      scene: { kind: "linear", id: "scene_11", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: { kind: "line", speaker: "旁白", text: "裡頭只有一個檔案。" },
        queueRemaining: 3,
        sceneTag: "相馬事務所，夜晚。",
        backgroundAssetId: "background.chapter_1.scene_11.office_night",
        bgm: null,
        bgs: null,
        queueToken: { sceneId: "scene_11", queueGen: 2, cursor: 5 },
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual(
      [],
    );
  });

  it("dispatches the rice-ball hook on the exact chapter 1 outro action beat", () => {
    const previous = state({
      scene: {
        kind: "interrogation",
        id: "interrogation_scene_10",
        title: "",
        index: 0,
        total: 1,
        currentPhaseId: null,
        visiblePhases: [],
      },
      mode: {
        type: "dialogue",
        current: {
          kind: "line",
          speaker: "神谷澪",
          text: "北見修一，指認成立。",
        },
        queueRemaining: 4,
        sceneTag: null,
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        queueToken: {
          sceneId: "interrogation_scene_10",
          queueGen: 5,
          cursor: 12,
        },
      },
    });
    const next = state({
      scene: {
        kind: "interrogation",
        id: "interrogation_scene_10",
        title: "",
        index: 0,
        total: 1,
        currentPhaseId: null,
        visiblePhases: [],
      },
      mode: {
        type: "dialogue",
        current: {
          kind: "action",
          text: "旁聽席上，三宅母親把膝上那只飯糰袋輕輕抱緊了一下，沒有出聲。",
        },
        queueRemaining: 3,
        sceneTag: null,
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        queueToken: {
          sceneId: "interrogation_scene_10",
          queueGen: 5,
          cursor: 13,
        },
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual([
      "story:rice-ball-bag",
    ]);
  });

  it("dispatches the coffee backflush hook on the exact chapter 1 dialogue beat", () => {
    const previous = state({
      scene: {
        kind: "investigation",
        id: "investigation_scene_7",
        title: "",
        index: 0,
        total: 1,
        currentSublocationId: "inner",
        visibleSublocations: [],
      },
      mode: {
        type: "dialogue",
        current: {
          kind: "action",
          text: "相馬律問起店長那晚有沒有聽見聲響。",
        },
        queueRemaining: 2,
        sceneTag: null,
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        queueToken: {
          sceneId: "investigation_scene_7",
          queueGen: 3,
          cursor: 20,
        },
      },
    });
    const next = state({
      scene: {
        kind: "investigation",
        id: "investigation_scene_7",
        title: "",
        index: 0,
        total: 1,
        currentSublocationId: "inner",
        visibleSublocations: [],
      },
      mode: {
        type: "dialogue",
        current: {
          kind: "line",
          speaker: "黑瀨徹",
          text: "店長說，他聽到一聲悶響。但那台機器 backflush 的時候，也常那樣。",
        },
        queueRemaining: 1,
        sceneTag: null,
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        queueToken: {
          sceneId: "investigation_scene_7",
          queueGen: 3,
          cursor: 21,
        },
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual([
      "story:coffee-backflush",
    ]);
  });

  it("does not replay the coffee backflush hook for repeated inner exploration state", () => {
    const previous = state({
      scene: {
        kind: "investigation",
        id: "investigation_scene_7",
        title: "",
        index: 0,
        total: 1,
        currentSublocationId: "inner",
        visibleSublocations: [],
      },
      mode: {
        type: "explore",
        sublocationId: "inner",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      },
    });
    const next = state({
      scene: {
        kind: "investigation",
        id: "investigation_scene_7",
        title: "",
        index: 0,
        total: 1,
        currentSublocationId: "inner",
        visibleSublocations: [],
      },
      mode: {
        type: "explore",
        sublocationId: "inner",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual(
      [],
    );
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
