import { describe, expect, it } from "vitest";
import type { DialogueHistoryEntry, GameStateView } from "$lib/state/types";
import {
  drainEnterToMap,
  journeyProgressToken,
  observeJourneyProgress,
  proveSceneQueueEntry,
  type EnterDrainHooks,
  type JourneyWaitUntil,
} from "./journey-enter-drain";
import type { FocusOwnerRequirement } from "./focus-probe";

/**
 * These tests drive the IDENTICAL drain orchestration WebDriver runs in
 * production-journey.e2e.ts — not a mirrored helper — with scripted state
 * machines behind the injected seams: read outcomes, per-Enter effects,
 * and waitUntil timeouts behave exactly like the real calls.
 */

const OUTRO_TITLE = "調查序盤";
const SCENE2_TITLE = "委託與程序入口 — 三宅母親求助";

function historyEntry(
  id: number,
  sceneTitle: string,
  text = `line ${id}`,
): DialogueHistoryEntry {
  return {
    id,
    kind: "line",
    speaker: "A",
    text,
    chapterTitle: "chapter",
    sceneTitle,
  };
}

function dialogueState(options: {
  sceneId?: string;
  sceneTitle?: string;
  cursor?: number;
  remaining?: number;
  queueGen?: number;
  history?: DialogueHistoryEntry[];
  pendingAcquisition?: GameStateView["pendingAcquisition"];
}): GameStateView {
  const {
    sceneId = "investigation_scene_1",
    sceneTitle = OUTRO_TITLE,
    cursor = 1,
    remaining = 0,
    queueGen = 1,
    history = [],
    pendingAcquisition = null,
  } = options;
  return {
    chapter: { id: "chapter_1", title: "t", summary: "", index: 0, total: 1 },
    scene: {
      kind: "linear",
      id: sceneId,
      title: sceneTitle,
      summary: "",
      index: 0,
      total: 1,
    },
    mode: {
      type: "dialogue",
      current: { kind: "line", speaker: "A", text: "line" },
      queueRemaining: remaining,
      sceneTag: null,
      queueToken: { sceneId, queueGen, cursor },
      crossExamLineId: null,
      promptFeedback: null,
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: history,
    pendingAcquisition,
  };
}

function exploreState(): GameStateView {
  return {
    ...dialogueState({ sceneId: "map_wrapper", sceneTitle: "map" }),
    scene: {
      kind: "investigation",
      id: "map_wrapper",
      title: "map",
      summary: "",
      index: 0,
      total: 1,
      currentSublocationId: null,
      map: {
        id: "map_01",
        backgroundAssetId: null,
        regions: [],
        nodes: [],
      },
      visibleSublocations: [],
    },
    mode: {
      type: "explore",
      sublocationId: null,
      presentFeedback: null,
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
  };
}

type FakeWorld = {
  index: number;
  readCalls: number;
  reads: ("ok" | "fail")[];
  current(): GameStateView;
  atLastFrame(): boolean;
  advance(): void;
  reveal(): void;
  /** The Enter effect assigned per test: advance one item or reveal. */
  onEnter: () => void;
  readState(): Promise<GameStateView>;
};

/** A scripted world: `frames[index]` is the currently displayed state; an
 * Enter advance steps index forward, a reveal leaves it unchanged. Read
 * outcomes come from `reads` ("ok" returns the current frame, "fail"
 * throws) once the script is exhausted reads succeed. */
function fakeWorld(
  frames: GameStateView[],
  reads: ("ok" | "fail")[] = [],
): FakeWorld {
  const world: FakeWorld = {
    index: 0,
    readCalls: 0,
    reads,
    current(): GameStateView {
      const frame = frames[this.index];
      if (frame === undefined) throw new Error("world exhausted");
      return frame;
    },
    atLastFrame(): boolean {
      return this.index === frames.length - 1;
    },
    advance() {
      if (!this.atLastFrame()) this.index += 1;
    },
    reveal() {},
    onEnter() {
      this.advance();
    },
    async readState(): Promise<GameStateView> {
      const outcome = this.reads[this.readCalls] ?? "ok";
      this.readCalls += 1;
      if (outcome === "fail") throw new Error("get_state failed");
      return this.current();
    },
  };
  return world;
}

/** WDIO-faithful waitUntil: poll the condition; a truthy result resolves,
 * exhausting the polls rejects exactly like a real timeout. */
function fakeWaitUntil(maxPolls = 4): JourneyWaitUntil {
  return async (condition) => {
    for (let poll = 0; poll < maxPolls; poll += 1) {
      if (await condition()) return true;
    }
    throw new Error("waitUntil timeout");
  };
}

type ProbeCall = {
  label: string;
  requirement: FocusOwnerRequirement;
  diagnostics?: Record<string, unknown>;
};

function fakeHooks(world: FakeWorld) {
  const sent: string[] = [];
  const probes: ProbeCall[] = [];
  const verifiedCounts: number[] = [];
  const acked: string[] = [];
  const hooks: EnterDrainHooks = {
    readState: () => world.readState(),
    pause: async () => {},
    waitUntil: fakeWaitUntil(),
    sendEnter: async () => {
      sent.push("Enter");
      world.onEnter();
    },
    acknowledgeAcquisition: async (current) => {
      acked.push(current.id);
    },
    mapMounted: async () => world.atLastFrame(),
    probeHook: async (label, requirement, diagnostics) => {
      probes.push({ label, requirement, diagnostics });
    },
    verifyKeyDelivery: async (sentEnters) => {
      verifiedCounts.push(sentEnters);
    },
    captureStallProbe: async (label) => ({
      activeElementDescriptor: `stalled:${label}`,
      screenshotPath: `/tmp/${label}.png`,
    }),
    commandSettled: async () => true,
    renderedItemSettled: async () => true,
  };
  return { sent, probes, verifiedCounts, acked, hooks };
}

const DRAIN = {
  sceneId: "scene_2",
  cap: 40,
  transportName: "testEnter",
};

describe("drainEnterToMap", () => {
  it("sends NO second Enter when the post-Enter state cannot be observed, then fails inconclusively", async () => {
    // The reviewed bug: Enter advanced into scene_2's first item while every
    // get_state read failed — treating that as "unchanged" sends a second
    // Enter that walks past the authored entry.
    const world = fakeWorld(
      [
        dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] }),
        dialogueState({
          sceneId: "scene_2",
          sceneTitle: SCENE2_TITLE,
          cursor: 1,
          remaining: 4,
          queueGen: 7,
          history: [
            historyEntry(1, OUTRO_TITLE),
            historyEntry(2, SCENE2_TITLE),
          ],
        }),
        exploreState(),
      ],
      // loop read ok; every read inside the progress wait + arbiter fails.
      ["ok", "fail", "fail", "fail", "fail", "fail", "fail"],
    );
    const { sent, probes, hooks } = fakeHooks(world);
    await expect(drainEnterToMap({ ...DRAIN, hooks })).rejects.toThrow(
      /unobservable.*inconclusive|inconclusive/,
    );
    expect(sent).toHaveLength(1);
    expect(probes.map((probe) => probe.label)).not.toContain("scene_2-first");
  });

  it("permits exactly one retry Enter on PROVEN unchanged, then credits the real entry", async () => {
    const world = fakeWorld([
      dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] }),
      dialogueState({
        sceneId: "scene_2",
        sceneTitle: SCENE2_TITLE,
        cursor: 1,
        remaining: 0,
        queueGen: 7,
        history: [historyEntry(1, OUTRO_TITLE), historyEntry(2, SCENE2_TITLE)],
      }),
      exploreState(),
    ]);
    // First Enter only reveals (no state change); the retry advances.
    let enters = 0;
    world.onEnter = () => {
      enters += 1;
      if (enters === 1) world.reveal();
      else world.advance();
    };
    const { sent, probes, verifiedCounts, hooks } = fakeHooks(world);
    await drainEnterToMap({ ...DRAIN, hooks });
    // reveal Enter, retry Enter, scene_2-last advance Enter.
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const first = probes.find((probe) => probe.label === "scene_2-first");
    expect(first).toBeDefined();
    expect(first?.requirement.requireKeyboardModality).toBe(true);
    expect(first?.diagnostics?.sceneEntry).toMatchObject({
      sceneId: "scene_2",
      queueToken: { sceneId: "scene_2", queueGen: 7, cursor: 1 },
      entry: { id: 2 },
    });
    expect(verifiedCounts).toEqual([sent.length]);
  });

  it("refuses to credit a later item as scene_2's first when the entry was never observed", async () => {
    const world = fakeWorld([
      // First observed scene_2 state is already at cursor 2 and history
      // shows BOTH scene_2 items — the authored entry was skipped.
      dialogueState({
        sceneId: "scene_2",
        sceneTitle: SCENE2_TITLE,
        cursor: 2,
        remaining: 3,
        queueGen: 7,
        history: [
          historyEntry(1, OUTRO_TITLE),
          historyEntry(2, SCENE2_TITLE),
          historyEntry(3, SCENE2_TITLE),
        ],
      }),
      exploreState(),
    ]);
    const { sent, probes, hooks } = fakeHooks(world);
    await expect(drainEnterToMap({ ...DRAIN, hooks })).rejects.toThrow(
      /authored entry was not observed/,
    );
    expect(probes.map((probe) => probe.label)).not.toContain("scene_2-first");
    // The failure fires before any Enter is sent for that state.
    expect(sent).toHaveLength(0);
  });

  it("drains first/middle/last probes in order and gates the map on verified key delivery", async () => {
    const scene2 = (cursor: number, remaining: number) =>
      dialogueState({
        sceneId: "scene_2",
        sceneTitle: SCENE2_TITLE,
        cursor,
        remaining,
        queueGen: 7,
        history: [
          historyEntry(1, OUTRO_TITLE),
          ...Array.from({ length: cursor }, (_, index) =>
            historyEntry(2 + index, SCENE2_TITLE),
          ),
        ],
      });
    const world = fakeWorld([
      dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] }),
      scene2(1, 4),
      scene2(2, 3),
      scene2(3, 2),
      scene2(4, 1),
      scene2(5, 0),
      exploreState(),
    ]);
    const { sent, probes, verifiedCounts, hooks } = fakeHooks(world);
    const result = await drainEnterToMap({ ...DRAIN, hooks });
    expect(result.sentEnters).toBe(sent.length);
    expect(probes.map((probe) => probe.label)).toEqual([
      "scene_2-first",
      "scene_2-middle",
      "scene_2-last",
      "map-pending",
    ]);
    expect(verifiedCounts).toEqual([sent.length]);
  });

  it("sends no retry when the first Enter commits during settlement, then drains normally", async () => {
    // The reviewed race: a get_state read can return the pre-commit token
    // while the Enter's advance is still in flight — "unchanged" alone is
    // not proof of a reveal-only Enter. Here every Enter stays pending
    // until commandSettled commits it, so the settlement re-read must
    // classify late progress instead of sending a blind retry.
    const world = fakeWorld([
      dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] }),
      dialogueState({
        sceneId: "scene_2",
        sceneTitle: SCENE2_TITLE,
        cursor: 1,
        remaining: 0,
        queueGen: 7,
        history: [historyEntry(1, OUTRO_TITLE), historyEntry(2, SCENE2_TITLE)],
      }),
      exploreState(),
    ]);
    let pending = false;
    world.onEnter = () => {
      pending = true;
    };
    let settleCalls = 0;
    const { sent, probes, hooks } = fakeHooks(world);
    hooks.commandSettled = async () => {
      settleCalls += 1;
      if (pending) {
        world.advance();
        pending = false;
      }
      return true;
    };
    await drainEnterToMap({ ...DRAIN, hooks });
    // Two loop-sent Enters total; neither iteration sent a blind retry.
    expect(sent).toHaveLength(2);
    expect(settleCalls).toBe(2);
    expect(probes.map((probe) => probe.label)).toContain("scene_2-first");
  });

  it("fails inconclusively without a retry when the command channel never settles", async () => {
    const world = fakeWorld([
      dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] }),
      exploreState(),
    ]);
    world.onEnter = () => {};
    const { sent, hooks } = fakeHooks(world);
    hooks.commandSettled = async () => false;
    await expect(drainEnterToMap({ ...DRAIN, hooks })).rejects.toThrow(
      /unsettled.*inconclusive|inconclusive/,
    );
    expect(sent).toHaveLength(1);
  });

  it("fails inconclusively when the rendered line never matches the packaged item", async () => {
    const world = fakeWorld([
      dialogueState({
        sceneId: "scene_2",
        sceneTitle: SCENE2_TITLE,
        cursor: 1,
        remaining: 4,
        queueGen: 7,
        history: [historyEntry(1, OUTRO_TITLE), historyEntry(2, SCENE2_TITLE)],
      }),
      exploreState(),
    ]);
    const { sent, probes, hooks } = fakeHooks(world);
    hooks.renderedItemSettled = async () => false;
    await expect(drainEnterToMap({ ...DRAIN, hooks })).rejects.toThrow(
      /could not verify the rendered line.*inconclusive/,
    );
    expect(probes.map((probe) => probe.label)).not.toContain("scene_2-first");
    expect(sent).toHaveLength(0);
  });

  it("fails inconclusively when the retry Enter's state is also unobservable", async () => {
    const world = fakeWorld(
      [
        dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] }),
        dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] }),
        exploreState(),
      ],
      // loop ok; first wait reads fail; arbiter fails? No — keep first
      // outcome "unchanged" by letting reads succeed (including the
      // settlement re-read), then fail everything after the retry.
      [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "fail",
        "fail",
        "fail",
        "fail",
        "fail",
      ],
    );
    // First Enter reveals (unchanged); retry Enter's reads all fail.
    let enters = 0;
    world.onEnter = () => {
      enters += 1;
      world.reveal();
    };
    const { sent, hooks } = fakeHooks(world);
    await expect(drainEnterToMap({ ...DRAIN, hooks })).rejects.toThrow(
      /inconclusive/,
    );
    expect(sent).toHaveLength(2);
    expect(enters).toBe(2);
  });
});

describe("observeJourneyProgress", () => {
  const token = journeyProgressToken(
    dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] }),
  );

  it("reports progressed when the token changes", async () => {
    const next = dialogueState({
      sceneId: "scene_2",
      sceneTitle: SCENE2_TITLE,
      queueGen: 7,
      history: [historyEntry(1, OUTRO_TITLE), historyEntry(2, SCENE2_TITLE)],
    });
    const outcome = await observeJourneyProgress({
      token,
      timeoutMs: 10,
      waitUntil: fakeWaitUntil(),
      readState: async () => next,
    });
    expect(outcome).toBe("progressed");
  });

  it("reports progressed on the arbiter read when polls failed but the state did advance", async () => {
    const next = dialogueState({
      sceneId: "scene_2",
      sceneTitle: SCENE2_TITLE,
      queueGen: 7,
    });
    let calls = 0;
    const outcome = await observeJourneyProgress({
      token,
      timeoutMs: 10,
      waitUntil: fakeWaitUntil(),
      readState: async () => {
        calls += 1;
        if (calls <= 4) throw new Error("get_state failed");
        return next;
      },
    });
    expect(outcome).toBe("progressed");
  });

  it("reports unchanged only when a successful read proves the same token", async () => {
    const same = dialogueState({ history: [historyEntry(1, OUTRO_TITLE)] });
    const outcome = await observeJourneyProgress({
      token,
      timeoutMs: 10,
      waitUntil: fakeWaitUntil(),
      readState: async () => same,
    });
    expect(outcome).toBe("unchanged");
  });

  it("reports unknown when no read ever succeeds", async () => {
    const outcome = await observeJourneyProgress({
      token,
      timeoutMs: 10,
      waitUntil: fakeWaitUntil(),
      readState: async () => {
        throw new Error("get_state failed");
      },
    });
    expect(outcome).toBe("unknown");
  });
});

describe("proveSceneQueueEntry", () => {
  const base = () =>
    dialogueState({
      sceneId: "scene_2",
      sceneTitle: SCENE2_TITLE,
      cursor: 1,
      remaining: 4,
      queueGen: 7,
      history: [
        historyEntry(1, OUTRO_TITLE),
        historyEntry(2, SCENE2_TITLE, "三宅蒼太的母親，坐在相馬對面。"),
      ],
    });

  it("returns the observed entry identity for a genuinely first-observed item", () => {
    const proof = proveSceneQueueEntry(base());
    expect(proof.queueToken).toEqual({
      sceneId: "scene_2",
      queueGen: 7,
      cursor: 1,
    });
    expect(proof.entry.id).toBe(2);
    expect(proof.entry.text).toContain("三宅蒼太的母親");
  });

  it("rejects when more than one scene item was already shown", () => {
    const state = base();
    state.dialogueHistory.push(historyEntry(3, SCENE2_TITLE));
    expect(() => proveSceneQueueEntry(state)).toThrow(
      /authored entry was not observed/,
    );
  });

  it("rejects when the displayed queue belongs to another scene", () => {
    const state = base();
    if (state.mode.type !== "dialogue") throw new Error("unreachable");
    state.mode.queueToken = {
      sceneId: "investigation_scene_1",
      queueGen: 2,
      cursor: 1,
    };
    expect(() => proveSceneQueueEntry(state)).toThrow(
      /queue owned by investigation_scene_1/,
    );
  });
});
