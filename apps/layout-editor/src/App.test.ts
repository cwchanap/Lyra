// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import App from "./App.svelte";
import appSource from "./App.svelte?raw";
import { editorState } from "./lib/layout-store.svelte";
import type { WorkbenchIndex } from "./lib/workbench-types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

const workbenchIndex: WorkbenchIndex = {
  chapters: [
    {
      id: "chapter_1",
      title: "Rain Witness",
      summary: "Chapter One",
      scenes: [
        { id: "scene_1", type: "linear", sourcePath: "", stageCapable: false },
        {
          id: "investigation_scene_3",
          type: "investigation",
          sourcePath: "",
          stageCapable: true,
        },
        {
          id: "interrogation_scene_2",
          type: "interrogation",
          sourcePath: "",
          stageCapable: true,
        },
        {
          id: "analysis_scene_8_5",
          type: "analysis",
          sourcePath: "",
          stageCapable: true,
        },
      ],
    },
  ],
};

const investigationBundle = {
  scene: {
    type: "investigation",
    id: "investigation_scene_3",
    title: "Rainy Office",
    intro: [],
    sublocations: [
      {
        id: "office",
        label: "Office",
        sceneTag: "Rainy office",
        backgroundAssetId: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "desk",
            label: "Desk",
            description: "A paper slip.",
            evidenceSource: null,
            sceneSourcePrompt: null,
            reveals: [],
            inspectDialogue: [],
            layout: null,
          },
        ],
        characters: [],
      },
    ],
    evidenceManifest: [],
  },
};

const existingLayout = {
  version: 1,
  sceneId: "investigation_scene_3",
  sublocations: {},
};

function mockBackend() {
  mockInvoke.mockImplementation(async (command: string) => {
    switch (command) {
      case "load_workbench_index":
        return workbenchIndex;
      case "load_scene_bundle":
        return investigationBundle;
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

  it("renders the branded shell with a Stage area and no Reader control", async () => {
    render(App);

    expect(
      await screen.findByRole("heading", {
        name: "Lyra Story Workbench",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Stage")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reader/i }),
    ).not.toBeInTheDocument();
    expect(appSource).not.toContain("Reader");
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

  it("does not call layout load when a non-investigation scene is selected", async () => {
    const user = userEvent.setup();
    render(App);

    const scene = await screen.findByText("Interrogation Scene 2");
    await user.click(scene.closest("button")!);

    expect(
      screen.getByText("Stage is available for investigation scenes only."),
    ).toBeInTheDocument();
    const commands = mockInvoke.mock.calls.map(([command]) => command);
    expect(commands).not.toContain("load_scene_bundle");
    expect(commands).not.toContain("load_investigation_layout");
  });

  it("loads an investigation scene into Stage by chapter/scene ids", async () => {
    const user = userEvent.setup();
    render(App);

    const scene = await screen.findByText("Investigation Scene 3");
    await user.click(scene.closest("button")!);

    expect(invoke).toHaveBeenCalledWith("load_scene_bundle", {
      chapterId: "chapter_1",
      sceneId: "investigation_scene_3",
    });
    expect(invoke).toHaveBeenCalledWith("load_investigation_layout", {
      chapterId: "chapter_1",
      sceneId: "investigation_scene_3",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Rainy Office" }),
      ).toBeInTheDocument(),
    );
  });

  it("saves the loaded investigation layout by ids with a confirmation toast", async () => {
    const user = userEvent.setup();
    render(App);

    const scene = await screen.findByText("Investigation Scene 3");
    await user.click(scene.closest("button")!);

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
