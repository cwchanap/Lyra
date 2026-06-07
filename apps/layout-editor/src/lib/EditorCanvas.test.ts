// @vitest-environment jsdom

import { render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditorCanvas from "./EditorCanvas.svelte";
import editorCanvasSource from "./EditorCanvas.svelte?raw";
import type {
  InvestigationLayoutSidecar,
  InvestigationSceneJson,
} from "./layout-types";

const scene = {
  type: "investigation",
  id: "investigation_scene_1",
  title: "Test scene",
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
          reveals: [],
          inspectDialogue: [],
          layout: null,
        },
      ],
      characters: [
        {
          id: "witness",
          name: "Witness",
          role: "Witness",
          bio: "Saw something.",
          layout: null,
          topics: [],
        },
      ],
    },
  ],
  evidenceManifest: [],
} satisfies InvestigationSceneJson;

const expressionScene = {
  ...scene,
  id: "investigation_scene_expression",
  sublocations: [
    {
      ...scene.sublocations[0],
      transitionDialogue: [
        {
          kind: "line",
          speaker: "店長高瀨",
          text: "很累。",
          portrait: { assetId: "portrait.takase_manager.tired" },
        },
      ],
      characters: [
        {
          id: "takase",
          name: "店長高瀨",
          role: "店長",
          bio: "Tired manager.",
          layout: null,
          topics: [],
        },
      ],
    },
  ],
} satisfies InvestigationSceneJson;

const layout = {
  version: 1,
  sceneId: "investigation_scene_1",
  sublocations: {},
} satisfies InvestigationLayoutSidecar;

describe("EditorCanvas", () => {
  it("toggles placement boxes without removing canvas targets", async () => {
    const user = userEvent.setup();
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const plate = container.querySelector(".plate");
    const toggle = screen.getByRole("button", {
      name: "Toggle placement boxes",
    });

    expect(plate?.classList.contains("hide-boxes")).toBe(false);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".character-preview")).toHaveAttribute(
      "src",
      "/assets/standees/witness/standard.png",
    );

    await user.click(toggle);

    expect(plate?.classList.contains("hide-boxes")).toBe(true);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector(".target.hotspot")).toBeInTheDocument();
    expect(container.querySelector(".target.character")).toBeInTheDocument();
  });

  it("shows hotspot descriptions in the editor target controls", () => {
    render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    expect(screen.getByText("A paper slip.")).toBeInTheDocument();
  });

  it("renders edge and corner resize handles for each placement target", () => {
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    expect(
      container.querySelectorAll(".target.hotspot .resize-handle"),
    ).toHaveLength(8);
    expect(
      container.querySelectorAll(".target.character .resize-handle"),
    ).toHaveLength(8);
    expect(
      container.querySelector(".target.character .resize-handle.nw"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".target.character .resize-handle.se"),
    ).toBeInTheDocument();
  });

  it("removes the character frame when placement boxes are hidden", () => {
    expect(editorCanvasSource).toContain(".hide-boxes .target.character");
    expect(editorCanvasSource).toContain(".hide-boxes .character-preview");
  });

  it("uses standard standees for default character placement", () => {
    const { container } = render(EditorCanvas, {
      scene: expressionScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    expect(container.querySelector(".character-preview")).toHaveAttribute(
      "src",
      "/assets/standees/takase_manager/standard.png",
    );
  });

  it("loads alpha crop variables for character previews", () => {
    expect(editorCanvasSource).toContain("loadCharacterCrop");
    expect(editorCanvasSource).toContain("cropVariablesForAlphaBounds");
    expect(editorCanvasSource).toContain("character-preview-crop");
  });
});
