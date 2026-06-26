import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameStateView } from "$lib/state/types";
import {
  STORY_BEAT_SFX_TRIGGERS,
  assetIdForGameplaySfxEvent,
  inferGameplaySfxEvents,
  mappedGameplaySfxAssetIds,
  type GameplayCommandName,
} from "./sfx-events";

// Authored-content source roots, mirroring the compiler's source-root merge
// (see packages/scripts/compile-scenes.ts): a chapter may live in either
// static/stories_plan or docs/stories_plan, and a missing root is skipped.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);
const AUTHORED_ROOTS = ["static/stories_plan", "docs/stories_plan"];

function readAuthoredScene(chapterId: string, sceneFile: string): string {
  for (const root of AUTHORED_ROOTS) {
    const candidate = path.join(REPO_ROOT, root, chapterId, sceneFile);
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // Not in this root; try the next source root.
    }
  }
  throw new Error(
    `Authored scene not found in any source root: ${chapterId}/${sceneFile}`,
  );
}

// The runtime story-beat matcher (enteredStoryBeatSfx) does NOT couple to any
// occurrence of the substring in the authored Markdown: it gates on chapter id
// + scene kind + scene id AND requires the substring to appear in a dialogue
// beat whose kind matches the trigger's dialogueKind ("action" or "line"). A
// naive `content.includes(substring)` guard goes green even when the only match
// is a scene-setup tag or a differently-shaped line — e.g. "飯糰袋" appears both
// in interrogation_scene_10.md's scene-setup tag (line 5, a [場景：…] scene tag,
// never an action beat) and in the real action beat (line 360); deleting the
// action beat would silently kill the cue while the old guard stayed green.
//
// This helper mirrors the compiler tokenizer's beat classification
// (packages/scripts/compile-scenes/tokenizer.ts): action beats are [bracketed]
// blocks that are NOT scene tags (multi-line blocks are accumulated and
// newlines normalized), and line beats are **speaker**[expr]：text lines. The
// guard then asserts the substring lands on at least one beat of the trigger's
// kind, so removing the real beat fails CI.
const SCENE_TAG_PREFIX = "場景：";
const BRACKETED_RE = /^\[(.+?)\]\s*$/;
const DIALOGUE_RE = /^\*\*([^*]+)\*\*(?:\[([a-z][a-z0-9_]*)\])?：(.+?)\s*$/;

function beatsOfKind(
  content: string,
  dialogueKind: "action" | "line",
): string[] {
  const lines = content.split(/\r?\n/);
  const beats: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed.length === 0) continue;

    // Multi-line bracketed block: starts with "[" but does not close on this
    // line — accumulate until the closing "]" (tokenizer.ts:106-135).
    if (trimmed.startsWith("[") && !trimmed.endsWith("]")) {
      let accumulated = trimmed;
      while (i + 1 < lines.length && !accumulated.includes("]")) {
        i++;
        const nextTrimmed = (lines[i] ?? "").trim();
        if (nextTrimmed.length === 0) continue;
        accumulated += "\n" + nextTrimmed;
      }
      const multiMatch = /^\[(.+?)\]\s*$/s.exec(accumulated);
      if (multiMatch) {
        const inner = (multiMatch[1] ?? "").replace(/\n/g, " ");
        if (dialogueKind === "action" && !inner.startsWith(SCENE_TAG_PREFIX)) {
          beats.push(inner);
        }
      }
      continue;
    }

    const bracketed = BRACKETED_RE.exec(trimmed);
    if (bracketed) {
      const inner = bracketed[1] ?? "";
      if (dialogueKind === "action" && !inner.startsWith(SCENE_TAG_PREFIX)) {
        beats.push(inner);
      }
      continue;
    }

    const dialogue = DIALOGUE_RE.exec(trimmed);
    if (dialogue && dialogueKind === "line") {
      beats.push(dialogue[3] ?? "");
    }
  }
  return beats;
}

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

  it("lists every asset id that maps to a real SFX asset", () => {
    // The list drives first-gesture preloading (preloadKnownGameplaySfx), so it
    // must contain exactly the mapped asset ids and no nulls/duplicates.
    const ids = mappedGameplaySfxAssetIds();
    expect(ids).toEqual(
      expect.arrayContaining([
        "audio.sfx.sfx_dialogue_proceed_tick",
        "audio.sfx.sfx_anonymous_message_buzz",
        "audio.sfx.sfx_rice_ball_bag_crinkle",
        "audio.sfx.sfx_coffee_machine_backflush",
        "audio.sfx.sfx_usb_insert_chime",
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
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

  it("dispatches acquired-statement only when the statement inventory grows", () => {
    const previous = state();
    const next = state({
      inventory: {
        evidence: [],
        statements: [
          {
            id: "stmt_1",
            speaker: "黑瀨徹",
            content: "我那天晚上在店裡。",
            onReexamine: null,
            acquiredInChapterId: "chapter_1",
            acquiredInSceneId: "investigation_scene_7",
          },
        ],
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "interview_topic")).toEqual([
      "investigation:topic-discussed",
      "investigation:statement-acquired",
    ]);
  });

  it("dispatches phase-entered when the interrogation phase changes", () => {
    const interrogation = (phaseId: string) =>
      state({
        scene: {
          kind: "interrogation",
          id: "interrogation_scene_1",
          title: "",
          index: 0,
          total: 1,
          currentPhaseId: phaseId,
          visiblePhases: [],
        },
        mode: {
          type: "interrogation",
          phaseId,
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        },
      });
    expect(
      inferGameplaySfxEvents(
        interrogation("inquiry"),
        interrogation("testimony"),
        "answer_interrogation_question",
      ),
    ).toEqual([
      "interrogation:question-answered",
      "interrogation:phase-entered",
    ]);
  });

  it("dispatches testimony-pressed for the press command", () => {
    expect(
      inferGameplaySfxEvents(state(), state(), "press_testimony_statement"),
    ).toEqual(["interrogation:testimony-pressed"]);
  });

  it("emits a ui:new-game event on start_game", () => {
    const neutral = state({
      scene: {
        kind: "investigation",
        id: "investigation_scene_1",
        title: "",
        index: 0,
        total: 1,
        currentSublocationId: "main",
        visibleSublocations: [],
      },
    });
    expect(inferGameplaySfxEvents(null, neutral, "start_game")).toEqual([
      "ui:new-game",
    ]);
  });

  it("emits a ui:reset event on reset_game", () => {
    const neutral = state({
      scene: {
        kind: "investigation",
        id: "investigation_scene_1",
        title: "",
        index: 0,
        total: 1,
        currentSublocationId: "main",
        visibleSublocations: [],
      },
    });
    expect(inferGameplaySfxEvents(null, neutral, "reset_game")).toEqual([
      "ui:reset",
    ]);
  });

  it("does not dispatch success SFX without a next state", () => {
    expect(inferGameplaySfxEvents(state(), null, "inspect_hotspot")).toEqual(
      [],
    );
  });

  it("covers every GameplayCommandName the state client can dispatch", () => {
    // Compile-time exhaustiveness: a Record<GameplayCommandName, ...> object
    // literal errors if a command is added to the union (missing key) or
    // removed (excess property), so this stays in lockstep with the source of
    // truth rather than silently passing a trivial contains() check.
    const exhaustive: Record<GameplayCommandName, true> = {
      start_game: true,
      reset_game: true,
      advance_dialogue: true,
      inspect_hotspot: true,
      interview_topic: true,
      enter_sublocation: true,
      reexamine_evidence: true,
      reexamine_statement: true,
      answer_interrogation_question: true,
      press_testimony_statement: true,
      present_testimony_item: true,
    };
    const names = Object.keys(exhaustive) as GameplayCommandName[];

    // Every union member is listed exactly once.
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("present_testimony_item");
    expect(names).toHaveLength(11);
  });
});

describe("story-beat SFX substring coupling (authored-content drift guard)", () => {
  // The Chapter 1 story-beat SFX matchers (enteredStoryBeatSfx, driven by
  // STORY_BEAT_SFX_TRIGGERS) intentionally couple a cue to a specific
  // authored dialogue substring. That coupling is an accepted v1 trade-off
  // documented in sfx-events.ts, but it is fragile: if a writer edits one of
  // these lines, the cue silently stops firing at runtime. This guard reads
  // the authored Markdown and fails CI if a coupled substring disappears, so
  // the drift surfaces at build time instead of silently breaking the
  // shipped SFX.
  //
  // The cases are derived from STORY_BEAT_SFX_TRIGGERS so the test checks
  // exactly the substrings the runtime matchers use: if a developer changes
  // a matcher substring, this guard reads the new value against the authored
  // Markdown and fails if the authored line drifted out of sync.
  // The runtime matcher gates on chapter id + scene kind + scene id AND the
  // substring appearing in a beat of the trigger's dialogueKind. The guard
  // checks exactly that shape: the substring must land on at least one beat of
  // the matching kind (an action bracket beat, or a **speaker**：line beat), so
  // a scene-setup tag or an unrelated line cannot keep the guard green after
  // the real beat is edited away.
  it.each(
    STORY_BEAT_SFX_TRIGGERS.map((trigger) => ({
      chapterId: trigger.chapterId,
      sceneFile: `${trigger.sceneId}.md`,
      substring: trigger.substring,
      dialogueKind: trigger.dialogueKind,
      event: trigger.event,
    })),
  )(
    "authored $chapterId/$sceneFile still carries $substring on a $dialogueKind beat the $event matcher couples to",
    ({ chapterId, sceneFile, substring, dialogueKind, event }) => {
      const content = readAuthoredScene(chapterId, sceneFile);
      const beats = beatsOfKind(content, dialogueKind);
      const matched = beats.some((text) => text.includes(substring));
      expect(
        matched,
        `expected authored ${chapterId}/${sceneFile} to carry "${substring}" on a ${dialogueKind} beat — the shape the ${event} matcher couples to in STORY_BEAT_SFX_TRIGGERS; a scene-setup tag or differently-shaped line no longer counts. If the coupled beat was rewritten, update the trigger substring`,
      ).toBe(true);
    },
  );

  // Regression guard for the guard itself: the previous content.includes()
  // check stayed green when the only occurrence of the substring was a
  // scene-setup tag (e.g. "飯糰袋" in interrogation_scene_10.md's [場景：…]
  // line) rather than the action beat the runtime matcher couples to. Verify
  // beatsOfKind excludes scene tags and only matches the dialogue kind, so the
  // failure mode (deleting the real beat while the tag remains) would now fail
  // CI instead of silently shipping a dead cue.
  it("beatsOfKind excludes scene-setup tags and only matches the dialogue kind", () => {
    const sceneTagOnly = [
      "# Scene",
      "",
      "[場景：旁聽席上，三宅母親膝上放著飯糰袋。]",
      "**相馬律**：開始吧。",
    ].join("\n");
    expect(beatsOfKind(sceneTagOnly, "action")).toEqual([]);
    expect(
      beatsOfKind(sceneTagOnly, "action").some((t) => t.includes("飯糰袋")),
    ).toBe(false);

    const withActionBeat = [
      "# Scene",
      "",
      "[場景：旁聽席上，三宅母親膝上放著飯糰袋。]",
      "[旁聽席上，三宅母親把膝上那只飯糰袋輕輕抱緊了一下。]",
    ].join("\n");
    expect(
      beatsOfKind(withActionBeat, "action").some((t) => t.includes("飯糰袋")),
    ).toBe(true);

    // A line beat must not be misread as an action beat, and vice versa.
    const lineBeat = "**黑瀨徹**：那台機器 backflush 的時候，也常那樣。";
    expect(beatsOfKind(lineBeat, "line")).toEqual([
      "那台機器 backflush 的時候，也常那樣。",
    ]);
    expect(beatsOfKind(lineBeat, "action")).toEqual([]);
  });
});
