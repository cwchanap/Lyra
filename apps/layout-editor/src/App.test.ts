// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import App from "./App.svelte";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { editorState } from "./lib/layout-store.svelte";
import type { CaseRecordProvenance } from "@lyra/scripts/compile-scenes/types";
import type {
  PublicAnalysisScene,
  WorkbenchIndex,
  WorkbenchSceneBundle,
} from "./lib/workbench-types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const workbenchIndex: WorkbenchIndex = {
  chapters: [
    {
      id: "chapter_1",
      title: "Rain Witness",
      summary: "Chapter One",
      scenes: [
        {
          id: "scene_1",
          type: "linear",
          sourcePath: "docs/stories_plan/chapter_1/scene_1.md",
          stageCapable: false,
        },
        {
          id: "investigation_scene_3",
          type: "investigation",
          sourcePath: "docs/stories_plan/chapter_1/investigation_scene_3.md",
          stageCapable: true,
        },
        {
          id: "interrogation_scene_2",
          type: "interrogation",
          sourcePath: "docs/stories_plan/chapter_1/interrogation_scene_2.md",
          stageCapable: true,
        },
        {
          id: "analysis_scene_8_5",
          type: "analysis",
          sourcePath: "docs/stories_plan/chapter_1/analysis_scene_8_5.md",
          stageCapable: true,
        },
      ],
    },
  ],
};

const SENTINEL_SPEAKER = "證人";

function linearBundle(lineText: string): WorkbenchSceneBundle {
  return {
    scene: {
      type: "linear",
      id: "scene_1",
      title: "First Rain",
      summary: "Fixture",
      queue: [
        { kind: "sceneTag", text: "場景：雨中辦公室" },
        { kind: "line", speaker: "相馬律", text: lineText, portrait: null },
        { kind: "action", text: "rain hits the blinds." },
        {
          kind: "line",
          speaker: "九条玲子",
          text: "second speaker line",
          portrait: null,
        },
      ],
      assetRefs: [],
    },
  };
}

// Shape mirrors the proven reader-projection fixtures: every dialogue carrier
// renders exactly one line whose text equals the compiler carrier ID.
const provenance = {
  sourceKind: "physical",
  representationLayer: "raw",
  proceduralStatus: "unspecified",
  completeness: "complete",
  confidence: "unverified",
  sourceGroupId: null,
  sourceLabel: null,
  proofCapabilities: [],
  supersedesRecordId: null,
} satisfies CaseRecordProvenance;

const line = (text: string) => ({
  kind: "line" as const,
  speaker: SENTINEL_SPEAKER,
  text,
  portrait: null,
});

const investigationBundle: WorkbenchSceneBundle = {
  scene: {
    type: "investigation",
    id: "investigation_scene_3",
    title: "Rainy Office",
    summary: "Fixture",
    intro: [line("intro")],
    assetRefs: [],
    sublocations: [
      {
        id: "lobby",
        label: "Lobby",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "場景：大廳",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        transitionDialogue: [line("sublocation:lobby:transition")],
        hotspots: [
          {
            id: "door",
            label: "Door",
            description: "A heavy door.",
            status: "unlocked",
            unlock: null,
            reveals: [
              { kind: "evidence", id: "door_log" },
              { kind: "topic", characterId: "npc1", topicId: "topic1" },
            ],
            evidenceSource: null,
            sceneSourcePrompt: null,
            inspectDialogue: [line("hotspot:door:inspect")],
            onReexamine: [line("hotspot:door:reexamine")],
            layout: null,
          },
        ],
        characters: [
          {
            id: "npc1",
            name: "Witness",
            role: "Witness",
            bio: "Saw something.",
            layout: null,
            topics: [
              {
                id: "topic1",
                label: "The door",
                status: "unlocked",
                unlock: null,
                reveals: [{ kind: "assertFact", factId: "fact_door" }],
                topicDialogue: [line("topic:npc1:topic1:dialogue")],
                onReexamine: [line("topic:npc1:topic1:reexamine")],
              },
            ],
          },
        ],
      },
    ],
    evidenceManifest: [
      {
        id: "door_log",
        name: "Door Log",
        description: "Access log.",
        details: "Detailed log.",
        imageAssetId: null,
        sourceSublocationId: "lobby",
        provenance,
        onCollect: [line("evidence:door_log:onCollect")],
        onReexamine: [line("evidence:door_log:onReexamine")],
      },
    ],
    statementManifest: [
      {
        id: "witness",
        speaker: "Witness",
        content: "I saw the door open.",
        provenance,
        onAcquire: [line("statement:witness:onAcquire")],
        onReexamine: [line("statement:witness:onReexamine")],
      },
    ],
    outro: { unlock: "auto", dialogue: [line("outro")] },
  },
};

const interrogationBundle: WorkbenchSceneBundle = {
  scene: {
    type: "interrogation",
    id: "interrogation_scene_2",
    title: "Night Inquiry",
    summary: "Fixture",
    intro: [line("intro")],
    assetRefs: [],
    phases: [
      {
        kind: "inquiry",
        id: "phase1",
        label: "First Round",
        subject: {
          id: "suspect",
          name: "Suspect",
          role: "Subject",
          bio: "Evasive.",
          portrait: null,
        },
        required: true,
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "場景：偵訊室",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        entryDialogue: [line("phase:phase1:entry")],
        complete: "auto",
        questions: [
          {
            id: "q1",
            label: "The alibi",
            status: "unlocked",
            required: true,
            unlock: null,
            reveals: [{ kind: "question", id: "q2" }],
            testimony: {
              onLoop: [line("question:q1:onLoop")],
              loopPrompt: [line("question:q1:loopPrompt")],
              defaultChallenge: [line("question:q1:defaultChallenge")],
              defaultWrong: [line("question:q1:defaultWrong")],
              wrongReply: [line("question:q1:wrongReply")],
              lines: [
                {
                  id: "l1",
                  label: "Fallback",
                  content: [line("question:q1:line:l1:content")],
                  contradiction: { kind: "evidence", id: "cctv" },
                  challenge: [line("question:q1:line:l1:challenge")],
                  onCorrect: [line("question:q1:line:l1:onCorrect")],
                  onWrongEvidence: [
                    line("question:q1:line:l1:onWrongEvidence"),
                  ],
                  reveals: [{ kind: "statement", id: "witness" }],
                },
              ],
            },
          },
        ],
      },
    ],
    evidenceManifest: [
      {
        id: "cctv",
        name: "CCTV Footage",
        description: "Camera recording.",
        details: "Timestamped frames.",
        imageAssetId: null,
        provenance,
        onCollect: [line("evidence:cctv:onCollect")],
        onReexamine: [line("evidence:cctv:onReexamine")],
      },
    ],
    statementManifest: [
      {
        id: "witness",
        speaker: "Witness",
        content: "He left at ten.",
        provenance,
        onAcquire: [line("statement:witness:onAcquire")],
        onReexamine: [line("statement:witness:onReexamine")],
      },
    ],
    outro: { unlock: "auto", dialogue: [line("outro")] },
  },
};

// PublicAnalysisScene excludes threshold/accepted/progression runtime state;
// the satisfies check fails if a fixture ever smuggles those fields in.
const analysisScene = {
  type: "analysis",
  id: "analysis_scene_8_5",
  title: "Analysis",
  summary: "Fixture",
  intro: [line("intro")],
  outro: [line("outro")],
  boards: [
    {
      kind: "classify",
      common: {
        id: "classify_board",
        label: "Classify Board",
        prompt: "Sort the cards.",
        cards: [
          {
            id: "card_a",
            label: "Card A",
            source: { kind: "evidence", id: "door_log" },
            summary: "Card A summary.",
          },
        ],
        resultDialogue: [line("board:classify_board:result")],
        feedback: {
          incomplete: "Incomplete classify.",
          incorrect: "Incorrect classify.",
          hint: "Classify hint.",
        },
      },
      groups: [
        { id: "g1", label: "Group One", description: "Group One description." },
      ],
    },
    {
      kind: "order",
      common: {
        id: "order_board",
        label: "Order Board",
        prompt: "Order the cards.",
        cards: [
          {
            id: "anchor_card",
            label: "Anchor Card",
            source: { kind: "statement", id: "witness" },
            summary: "Anchor card summary.",
          },
        ],
        resultDialogue: [line("board:order_board:result")],
        feedback: {
          incomplete: "Incomplete order.",
          incorrect: "Incorrect order.",
          hint: null,
        },
      },
      fixedAnchors: [{ cardId: "anchor_card", position: 1 }],
    },
    {
      kind: "threshold",
      common: {
        id: "threshold_board",
        label: "Threshold Board",
        prompt: "Pick enough cards.",
        cards: [
          {
            id: "card_t",
            label: "Card T",
            source: { kind: "practice", id: "practice_1" },
            summary: "Threshold card summary.",
          },
        ],
        resultDialogue: [line("board:threshold_board:result")],
        feedback: {
          incomplete: "Incomplete threshold.",
          incorrect: "Incorrect threshold.",
          hint: null,
        },
      },
    },
  ],
} satisfies PublicAnalysisScene;

const analysisBundle: WorkbenchSceneBundle = { scene: analysisScene };

const bundlesBySceneId: Record<string, WorkbenchSceneBundle> = {
  scene_1: linearBundle("first linear line"),
  investigation_scene_3: investigationBundle,
  interrogation_scene_2: interrogationBundle,
  analysis_scene_8_5: analysisBundle,
};

const existingLayout = {
  version: 1,
  sceneId: "investigation_scene_3",
  sublocations: {},
};

function mockBackend() {
  mockInvoke.mockImplementation(async (command: string, args?: InvokeArgs) => {
    switch (command) {
      case "load_workbench_index":
        return workbenchIndex;
      case "load_scene_bundle": {
        const sceneId =
          (args as { sceneId?: string } | undefined)?.sceneId ?? "";
        const bundle = bundlesBySceneId[sceneId];
        if (!bundle) {
          throw new Error(`unexpected scene bundle request: ${sceneId}`);
        }
        return bundle;
      }
      case "load_investigation_layout":
        return existingLayout;
      case "save_investigation_layout":
        return undefined;
      default:
        throw new Error(`unexpected invoke: ${command}`);
    }
  });
}

function sceneListLabels(): string[] {
  const list = screen.getByLabelText("Story workbench scenes");
  return Array.from(list.querySelectorAll("button strong")).map(
    (label) => label.textContent ?? "",
  );
}

async function selectSceneByLabel(label: string) {
  const user = userEvent.setup();
  const scene = await screen.findByText(label);
  await user.click(scene.closest("button")!);
}

function invokedCommands(): string[] {
  return mockInvoke.mock.calls.map(([command]) => command);
}

describe("Lyra Story Workbench shell", () => {
  beforeEach(() => {
    editorState.scene = null;
    editorState.layout = null;
    editorState.chapterId = null;
    editorState.sceneId = null;
    editorState.error = null;
    vi.clearAllMocks();
    mockBackend();
  });

  it("shows Reader and Stage controls together now that the Reader is functional", async () => {
    render(App);

    expect(
      await screen.findByRole("heading", {
        name: "Lyra Story Workbench",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reader" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByText("Select a scene to read.")).toBeInTheDocument();
  });

  it("lists one scene of every type in exact manifest order", async () => {
    render(App);

    await waitFor(() =>
      expect(sceneListLabels()).toEqual([
        "Scene 1",
        "Investigation Scene 3",
        "Interrogation Scene 2",
        "Analysis Scene 8.5",
      ]),
    );
  });

  it("renders the linear scene through the Reader", async () => {
    render(App);
    await selectSceneByLabel("Scene 1");

    expect(
      await screen.findByRole("heading", { name: "First Rain" }),
    ).toBeInTheDocument();
    expect(screen.getByText("場景：雨中辦公室")).toBeInTheDocument();
    expect(screen.getByText("相馬律: first linear line")).toBeInTheDocument();
    expect(screen.getByText("rain hits the blinds.")).toBeInTheDocument();
    expect(
      screen.getByText("docs/stories_plan/chapter_1/scene_1.md"),
    ).toBeInTheDocument();
    expect(invokedCommands()).not.toContain("load_investigation_layout");
  });

  it("renders the investigation scene through the Reader", async () => {
    render(App);
    await selectSceneByLabel("Investigation Scene 3");

    expect(
      await screen.findByRole("heading", { name: "Rainy Office" }),
    ).toBeInTheDocument();
    expect(screen.getByText("證人: hotspot:door:inspect")).toBeInTheDocument();
    expect(screen.getByText("Reveals evidence: door_log")).toBeInTheDocument();
    expect(screen.getByText("Asserts fact: fact_door")).toBeInTheDocument();
    expect(
      screen.getByText("docs/stories_plan/chapter_1/investigation_scene_3.md"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "docs/stories_plan/chapter_1/investigation_scene_3.md#door",
      ),
    ).toBeInTheDocument();
    expect(invokedCommands()).not.toContain("load_investigation_layout");
  });

  it("renders interrogation labels through the Reader after expanding branches", async () => {
    const user = userEvent.setup();
    render(App);
    await selectSceneByLabel("Interrogation Scene 2");

    expect(
      await screen.findByText("證人: question:q1:line:l1:content"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Press")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expanded branches" }));

    expect(screen.getByText("Fallback")).toBeInTheDocument();
    expect(screen.getByText("Press")).toBeInTheDocument();
    expect(screen.getByText("Correct Present")).toBeInTheDocument();
    expect(screen.getByText("Wrong Present")).toBeInTheDocument();
  });

  it("renders public analysis content through the Reader", async () => {
    render(App);
    await selectSceneByLabel("Analysis Scene 8.5");

    expect(
      await screen.findByRole("heading", { name: "Analysis" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sort the cards.")).toBeInTheDocument();
    expect(screen.getByText("Incomplete classify.")).toBeInTheDocument();
    expect(screen.getByText("Classify hint.")).toBeInTheDocument();
    expect(screen.getByText("Group One description.")).toBeInTheDocument();
    expect(screen.getByText("Card A summary.")).toBeInTheDocument();
    expect(
      screen.getByText("Fixed card anchor_card at position 1"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("證人: board:classify_board:result"),
    ).toBeInTheDocument();
  });

  it("filters cues and speakers in the Reader", async () => {
    const user = userEvent.setup();
    render(App);
    await selectSceneByLabel("Scene 1");

    await user.click(screen.getByRole("button", { name: "Dialogue only" }));
    expect(screen.queryByText("rain hits the blinds.")).not.toBeInTheDocument();
    expect(screen.queryByText("場景：雨中辦公室")).not.toBeInTheDocument();
    expect(screen.getByText("相馬律: first linear line")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dialogue + cues" }));
    expect(screen.getByText("rain hits the blinds.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Speaker"), "九条玲子");
    expect(
      screen.queryByText("相馬律: first linear line"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("九条玲子: second speaker line"),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Speaker"), "All speakers");
    expect(screen.getByText("相馬律: first linear line")).toBeInTheDocument();
  });

  it("expands branches and searches Reader text", async () => {
    const user = userEvent.setup();
    render(App);
    await selectSceneByLabel("Interrogation Scene 2");

    expect(
      await screen.findByText("證人: phase:phase1:entry"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("證人: question:q1:loopPrompt"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expanded branches" }));
    expect(
      screen.getByText("證人: question:q1:loopPrompt"),
    ).toBeInTheDocument();

    const searchBox = screen.getByLabelText("Search loaded Reader text");
    await user.type(searchBox, "ONLOOP");
    expect(screen.getByText("證人: question:q1:onLoop")).toBeInTheDocument();
    expect(
      screen.queryByText("證人: question:q1:loopPrompt"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("First Round")).toBeInTheDocument();
    expect(
      screen.queryByText("證人: phase:phase1:entry"),
    ).not.toBeInTheDocument();

    await user.clear(searchBox);
    expect(screen.getByText("證人: phase:phase1:entry")).toBeInTheDocument();
  });

  it("refresh reloads the current bundle and stale responses cannot win", async () => {
    let resolveFirst!: (bundle: WorkbenchSceneBundle) => void;
    let resolveSecond!: (bundle: WorkbenchSceneBundle) => void;
    const firstLoad = new Promise<WorkbenchSceneBundle>((resolve) => {
      resolveFirst = resolve;
    });
    const secondLoad = new Promise<WorkbenchSceneBundle>((resolve) => {
      resolveSecond = resolve;
    });
    let bundleCalls = 0;
    mockInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "load_workbench_index":
          return workbenchIndex;
        case "load_scene_bundle": {
          bundleCalls += 1;
          return bundleCalls === 1 ? firstLoad : secondLoad;
        }
        default:
          throw new Error(`unexpected invoke: ${command}`);
      }
    });

    const user = userEvent.setup();
    render(App);
    await selectSceneByLabel("Scene 1");

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    resolveSecond(linearBundle("new text"));
    expect(await screen.findByText("相馬律: new text")).toBeInTheDocument();

    resolveFirst(linearBundle("old text"));
    expect(await screen.findByText("相馬律: new text")).toBeInTheDocument();
    expect(screen.queryByText("相馬律: old text")).not.toBeInTheDocument();
    expect(bundleCalls).toBe(2);
  });

  it("shows the truthful Stage placeholder without loading a layout when a non-investigation scene is staged", async () => {
    const user = userEvent.setup();
    render(App);
    await selectSceneByLabel("Interrogation Scene 2");

    await user.click(screen.getByRole("button", { name: "Stage" }));

    expect(
      screen.getByText("Stage is available for investigation scenes only."),
    ).toBeInTheDocument();
    expect(invokedCommands()).not.toContain("load_investigation_layout");
  });

  it("loads an investigation scene into Stage by chapter/scene ids", async () => {
    const user = userEvent.setup();
    render(App);
    await selectSceneByLabel("Investigation Scene 3");

    expect(invoke).toHaveBeenCalledWith("load_scene_bundle", {
      chapterId: "chapter_1",
      sceneId: "investigation_scene_3",
    });

    await user.click(screen.getByRole("button", { name: "Stage" }));

    expect(invoke).toHaveBeenCalledWith("load_investigation_layout", {
      chapterId: "chapter_1",
      sceneId: "investigation_scene_3",
    });
    expect(
      await screen.findByRole("heading", { name: "Rainy Office" }),
    ).toBeInTheDocument();
  });

  it("saves the loaded investigation layout by ids with a confirmation toast", async () => {
    const user = userEvent.setup();
    render(App);
    await selectSceneByLabel("Investigation Scene 3");
    await user.click(screen.getByRole("button", { name: "Stage" }));

    const saveButton = await screen.findByRole("button", {
      name: "Save Layout",
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_investigation_layout", {
        chapterId: "chapter_1",
        sceneId: "investigation_scene_3",
        layout: existingLayout,
      }),
    );
    expect(screen.getByText("Layout saved")).toBeInTheDocument();
    expect(within(screen.getByRole("status")).getByText("Layout saved"));
  });
});
