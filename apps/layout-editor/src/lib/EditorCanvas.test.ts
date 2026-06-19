// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/svelte";
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
          evidenceSource: null,
          sceneSourcePrompt: null,
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

const sourceScene = {
  ...scene,
  id: "investigation_scene_sources",
  sublocations: [
    {
      ...scene.sublocations[0],
      hotspots: [
        {
          id: "visible-slip",
          label: "Visible slip",
          description: "A slip in plain sight.",
          evidenceSource: "visible",
          sceneSourcePrompt: "Place the torn receipt on the desk.",
          reveals: [{ kind: "evidence", id: "receipt" }],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "implied-clock",
          label: "Implied clock",
          description: "The clock suggests a timeline clue.",
          evidenceSource: "implied",
          sceneSourcePrompt: "Clock hands imply the contradiction.",
          reveals: [{ kind: "evidence", id: "clock" }],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "visible-folder",
          label: "Visible folder",
          description: "A folder with two related source records.",
          evidenceSource: "visible",
          sceneSourcePrompt: "Place the open folder on the desk.",
          reveals: [
            { kind: "evidence", id: "receipt" },
            { kind: "evidence", id: "clock" },
          ],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "implied-terminal",
          label: "Implied terminal",
          description: "A terminal gives access to two records.",
          evidenceSource: "implied",
          sceneSourcePrompt:
            "Show a terminal access point without readable final records.",
          reveals: [
            { kind: "evidence", id: "safe-note" },
            { kind: "evidence", id: "loose-thread" },
          ],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "hidden-safe",
          label: "Hidden safe",
          description: "The safe is behind the frame.",
          evidenceSource: "hidden",
          sceneSourcePrompt: null,
          reveals: [{ kind: "evidence", id: "safe-note" }],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "missing-source",
          label: "Missing source",
          description: "An evidence reveal without metadata.",
          evidenceSource: null,
          sceneSourcePrompt: null,
          reveals: [{ kind: "evidence", id: "loose-thread" }],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "ambient",
          label: "Ambient",
          description: "No evidence reveal.",
          evidenceSource: null,
          sceneSourcePrompt: null,
          reveals: [{ kind: "topic", characterId: "witness", topicId: "rain" }],
          inspectDialogue: [],
          layout: null,
        },
      ],
    },
  ],
  evidenceManifest: [
    {
      id: "receipt",
      name: "Receipt",
      description: "A torn receipt.",
      imageAssetId: "evidence.receipt",
      sourceSublocationId: null,
    },
    {
      id: "clock",
      name: "Clock",
      description: "Stopped clock.",
      imageAssetId: "evidence.clock",
      sourceSublocationId: null,
    },
    {
      id: "safe-note",
      name: "Safe note",
      description: "A note from the safe.",
      imageAssetId: "evidence.safe_note",
      sourceSublocationId: null,
    },
    {
      id: "loose-thread",
      name: "Loose thread",
      description: "Thread clue.",
      imageAssetId: "evidence.loose_thread",
      sourceSublocationId: null,
    },
  ],
} satisfies InvestigationSceneJson;

describe("EditorCanvas", () => {
  it("shows evidence source badges and highlights missing source metadata", () => {
    const { container } = render(EditorCanvas, {
      scene: sourceScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const visible = container.querySelector(".target.hotspot.source-visible");
    const implied = container.querySelector(".target.hotspot.source-implied");
    const hidden = container.querySelector(".target.hotspot.source-hidden");
    const missing = container.querySelector(".target.hotspot.missing-source");
    const ambient = Array.from(
      container.querySelectorAll(".target.hotspot"),
    ).find((target) => target.textContent?.includes("Ambient"));

    expect(visible).toBeInTheDocument();
    expect(implied).toBeInTheDocument();
    expect(hidden).toBeInTheDocument();
    expect(missing).toBeInTheDocument();
    expect(ambient).toBeInTheDocument();
    expect(within(visible as HTMLElement).getByText("visible")).toHaveClass(
      "source-badge",
    );
    expect(within(implied as HTMLElement).getByText("implied")).toHaveClass(
      "source-badge",
    );
    expect(within(hidden as HTMLElement).getByText("hidden")).toHaveClass(
      "source-badge",
    );
    expect(
      within(missing as HTMLElement).getByText("missing source"),
    ).toHaveClass("source-badge");
    expect(missing).toHaveClass("missing-source");
    expect(
      (ambient as HTMLElement).querySelector(".source-badge"),
    ).not.toBeInTheDocument();
  });

  it("preserves missing source attention styling when revealed with boxes hidden", async () => {
    const user = userEvent.setup();
    const { container } = render(EditorCanvas, {
      scene: sourceScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const toggle = screen.getByRole("button", {
      name: "Toggle placement boxes",
    });
    const missing = container.querySelector(".target.hotspot.missing-source");

    expect(missing).toBeInTheDocument();
    await user.click(toggle);
    await user.click(missing as HTMLElement);

    expect(container.querySelector(".plate")).toHaveClass("hide-boxes");
    expect(missing).toHaveClass("revealed");
    expect(missing).toHaveClass("missing-source");
    expect((missing as HTMLElement).className).toContain("border-[#f07f5f]");
    expect((missing as HTMLElement).className).toContain(
      "shadow-[inset_0_0_0_1px_rgb(240_127_95_/_60%)]",
    );
  });

  it("keeps evidence previews and counts out of hotspot boxes", () => {
    const { container } = render(EditorCanvas, {
      scene: sourceScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    expect(container.querySelector(".hotspot-preview")).not.toBeInTheDocument();
    expect(container.querySelector(".evidence-chip")).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll(".target.hotspot")).some((target) =>
        target.textContent?.includes("Visible folder"),
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll(".target.hotspot")).some((target) =>
        target.textContent?.includes("Implied terminal"),
      ),
    ).toBe(true);
  });

  it("opens a right-click evidence menu for a multi-evidence hotspot", async () => {
    const { container } = render(EditorCanvas, {
      scene: sourceScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const folder = Array.from(
      container.querySelectorAll(".target.hotspot"),
    ).find((target) => target.textContent?.includes("Visible folder"));

    expect(folder).toBeInTheDocument();
    await fireEvent.contextMenu(folder as HTMLElement, {
      clientX: 240,
      clientY: 160,
    });

    const menu = screen.getByRole("menu", {
      name: "Evidence for Visible folder",
    });
    expect(within(menu).getByText("Receipt")).toBeInTheDocument();
    expect(within(menu).getByText("receipt")).toBeInTheDocument();
    expect(within(menu).getByText("Clock")).toBeInTheDocument();
    expect(within(menu).getByText("clock")).toBeInTheDocument();
    expect(within(menu).getByText("visible")).toBeInTheDocument();
  });

  it("replaces the right-click evidence menu when another hotspot is opened", async () => {
    const { container } = render(EditorCanvas, {
      scene: sourceScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const folder = Array.from(
      container.querySelectorAll(".target.hotspot"),
    ).find((target) => target.textContent?.includes("Visible folder"));
    const terminal = Array.from(
      container.querySelectorAll(".target.hotspot"),
    ).find((target) => target.textContent?.includes("Implied terminal"));

    await fireEvent.contextMenu(folder as HTMLElement, {
      clientX: 240,
      clientY: 160,
    });
    expect(
      screen.getByRole("menu", { name: "Evidence for Visible folder" }),
    ).toBeInTheDocument();

    await fireEvent.contextMenu(terminal as HTMLElement, {
      clientX: 300,
      clientY: 200,
    });

    expect(
      screen.queryByRole("menu", { name: "Evidence for Visible folder" }),
    ).not.toBeInTheDocument();
    const menu = screen.getByRole("menu", {
      name: "Evidence for Implied terminal",
    });
    expect(within(menu).getByText("Safe note")).toBeInTheDocument();
    expect(within(menu).getByText("safe-note")).toBeInTheDocument();
    expect(within(menu).getByText("Loose thread")).toBeInTheDocument();
    expect(within(menu).getByText("loose-thread")).toBeInTheDocument();
    expect(within(menu).getByText("implied")).toBeInTheDocument();
  });

  it("does not open a right-click evidence menu for hotspots without evidence", async () => {
    const { container } = render(EditorCanvas, {
      scene: sourceScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const ambient = Array.from(
      container.querySelectorAll(".target.hotspot"),
    ).find((target) => target.textContent?.includes("Ambient"));

    await fireEvent.contextMenu(ambient as HTMLElement, {
      clientX: 240,
      clientY: 160,
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lists every correlated evidence item in hotspot control titles", () => {
    render(EditorCanvas, {
      scene: sourceScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const targetControls = screen.getByLabelText("Target controls");

    expect(
      within(targetControls).getByRole("button", { name: "Visible folder" }),
    ).toHaveAttribute(
      "title",
      "A folder with two related source records.\nSource: visible\nPrompt: Place the open folder on the desk.\nEvidence: Receipt (receipt), Clock (clock)",
    );
  });

  it("includes evidence source metadata in hotspot control titles", () => {
    render(EditorCanvas, {
      scene: sourceScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const targetControls = screen.getByLabelText("Target controls");

    expect(
      within(targetControls).getByRole("button", { name: "Visible slip" }),
    ).toHaveAttribute(
      "title",
      "A slip in plain sight.\nSource: visible\nPrompt: Place the torn receipt on the desk.\nEvidence: Receipt (receipt)",
    );
    expect(
      within(targetControls).getByRole("button", { name: "Missing source" }),
    ).toHaveAttribute(
      "title",
      "An evidence reveal without metadata.\nSource: missing source\nEvidence: Loose thread (loose-thread)",
    );
  });

  it("keeps a visible item box shown while dragging it", async () => {
    const onHotspotLayoutChange = vi.fn();
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange,
      onCharacterLayoutChange: vi.fn(),
    });

    const plate = container.querySelector(".plate") as HTMLElement;
    const hotspot = container.querySelector(".target.hotspot") as HTMLElement;
    vi.spyOn(plate, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => {},
    } as DOMRect);

    await fireEvent.pointerDown(hotspot, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    await fireEvent.pointerMove(plate, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });
    await fireEvent.pointerUp(plate, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });

    expect(onHotspotLayoutChange).toHaveBeenCalled();
    const lastCall = onHotspotLayoutChange.mock.calls.at(-1)!;
    const [subId, hotId, newLayout] = lastCall;
    expect(subId).toBe("office");
    expect(hotId).toBe("desk");
    // Default layout is x:0.4, y:0.4, w:0.12, h:0.1
    // Moved by dx=40/1000=0.04, dy=20/1000=0.02
    expect(newLayout.x).toBeCloseTo(0.44, 5);
    expect(newLayout.y).toBeCloseTo(0.42, 5);
    expect(newLayout.w).toBeCloseTo(0.12, 5);
    expect(newLayout.h).toBeCloseTo(0.1, 5);
    expect(hotspot).not.toHaveClass("box-hidden");
  });

  it("keeps a revealed item box shown while dragging it with global boxes hidden", async () => {
    const user = userEvent.setup();
    const onHotspotLayoutChange = vi.fn();
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange,
      onCharacterLayoutChange: vi.fn(),
    });

    const plate = container.querySelector(".plate") as HTMLElement;
    const toggle = screen.getByRole("button", {
      name: "Toggle placement boxes",
    });
    const hotspot = container.querySelector(".target.hotspot") as HTMLElement;
    vi.spyOn(plate, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => {},
    } as DOMRect);

    await user.click(toggle);
    await user.click(hotspot);
    expect(hotspot).toHaveClass("revealed");

    await fireEvent.pointerDown(hotspot, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    await fireEvent.pointerMove(plate, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });
    await fireEvent.pointerUp(plate, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });

    expect(onHotspotLayoutChange).toHaveBeenCalled();
    expect(hotspot).toHaveClass("revealed");
  });

  it("shows an individually hidden item box when dragging it", async () => {
    const user = userEvent.setup();
    const onHotspotLayoutChange = vi.fn();
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange,
      onCharacterLayoutChange: vi.fn(),
    });

    const plate = container.querySelector(".plate") as HTMLElement;
    const hotspot = container.querySelector(".target.hotspot") as HTMLElement;
    vi.spyOn(plate, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => {},
    } as DOMRect);

    await user.click(hotspot);
    expect(hotspot).toHaveClass("box-hidden");

    await fireEvent.pointerDown(hotspot, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    await fireEvent.pointerMove(plate, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });
    await fireEvent.pointerUp(plate, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });

    expect(onHotspotLayoutChange).toHaveBeenCalled();
    expect(hotspot).not.toHaveClass("box-hidden");
  });

  it("reveals an untoggled portrait box when dragging it with global boxes hidden", async () => {
    const user = userEvent.setup();
    const onCharacterLayoutChange = vi.fn();
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange,
    });

    const plate = container.querySelector(".plate") as HTMLElement;
    const toggle = screen.getByRole("button", {
      name: "Toggle placement boxes",
    });
    const character = container.querySelector(
      ".target.character",
    ) as HTMLElement;
    vi.spyOn(plate, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => {},
    } as DOMRect);

    await user.click(toggle);
    expect(character).not.toHaveClass("revealed");

    await fireEvent.pointerDown(character, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    await fireEvent.pointerMove(plate, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });
    await fireEvent.pointerUp(plate, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });

    expect(onCharacterLayoutChange).toHaveBeenCalled();
    expect(character).toHaveClass("revealed");
  });

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

  it("reveals only the clicked hidden item or portrait box until the canvas is clicked", async () => {
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
    const hotspot = container.querySelector(".target.hotspot");
    const character = container.querySelector(".target.character");

    await user.click(toggle);
    expect(plate?.classList.contains("hide-boxes")).toBe(true);

    await user.click(hotspot!);
    expect(plate?.classList.contains("hide-boxes")).toBe(true);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(hotspot).toHaveClass("revealed");
    expect(character).not.toHaveClass("revealed");

    await user.click(plate!);
    expect(hotspot).not.toHaveClass("revealed");
    expect(character).not.toHaveClass("revealed");

    await user.click(character!);
    expect(plate?.classList.contains("hide-boxes")).toBe(true);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(character).toHaveClass("revealed");
    expect(hotspot).not.toHaveClass("revealed");
  });

  it("toggles an individual item or portrait box while global boxes are visible", async () => {
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
    const hotspot = container.querySelector(".target.hotspot");
    const character = container.querySelector(".target.character");

    expect(plate?.classList.contains("hide-boxes")).toBe(false);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(hotspot!);
    expect(plate?.classList.contains("hide-boxes")).toBe(false);
    expect(hotspot).toHaveClass("box-hidden");
    expect(character).not.toHaveClass("box-hidden");

    await user.click(hotspot!);
    expect(hotspot).not.toHaveClass("box-hidden");

    await user.click(character!);
    expect(character).toHaveClass("box-hidden");
    expect(hotspot).not.toHaveClass("box-hidden");
  });

  it("replaces manual position controls with individual box toggles in a six-column grid", () => {
    const source = editorCanvasSource;

    expect(source).toContain("toggleTargetBox");
    expect(source).toContain("grid-cols-6");
    expect(source).not.toContain("Move hotspot");
    expect(source).not.toContain("Move character");
    expect(source).not.toContain("nudge(");
    expect(source).not.toContain("control-row");
  });

  it("uses target names as box toggle button titles and moves descriptions into tooltips", () => {
    render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    expect(screen.queryByText("A paper slip.")).not.toBeInTheDocument();
    const targetControls = screen.getByLabelText("Target controls");

    expect(
      within(targetControls).getByRole("button", { name: "Desk" }),
    ).toHaveAttribute("title", "A paper slip.");
    expect(
      within(targetControls).getByRole("button", { name: "Witness" }),
    ).toHaveAttribute("title", "Saw something.");
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

  it("removes the character frame when placement boxes are hidden", async () => {
    const user = userEvent.setup();
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    const toggle = screen.getByRole("button", {
      name: "Toggle placement boxes",
    });
    await user.click(toggle);

    const characterTarget = container.querySelector(".target.character");
    expect(characterTarget).toHaveClass("border-transparent");
    expect(characterTarget).toHaveClass("bg-transparent");
    expect(characterTarget).toHaveClass("overflow-visible");
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

  it("resolves evidence sprite layout to evidence asset path", () => {
    const evidenceSpriteScene = {
      ...scene,
      id: "investigation_scene_evidence_sprite",
      sublocations: [
        {
          ...scene.sublocations[0],
          characters: [
            {
              id: "witness",
              name: "Witness",
              role: "Witness",
              bio: "Saw something.",
              layout: {
                kind: "sprite",
                assetId: "evidence.knife",
                x: 0.5,
                y: 0.3,
                w: 0.15,
                h: 0.4,
                anchor: "bottomCenter",
              },
              topics: [],
            },
          ],
        },
      ],
    } satisfies InvestigationSceneJson;

    const { container } = render(EditorCanvas, {
      scene: evidenceSpriteScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    expect(container.querySelector(".character-preview")).toHaveAttribute(
      "src",
      "/assets/evidence/knife.png",
    );
  });

  it("resolves background sprite layout to background asset path", () => {
    const bgSpriteScene = {
      ...scene,
      id: "investigation_scene_bg_sprite",
      sublocations: [
        {
          ...scene.sublocations[0],
          characters: [
            {
              id: "witness",
              name: "Witness",
              role: "Witness",
              bio: "Saw something.",
              layout: {
                kind: "sprite",
                assetId: "background.chapter_1.crime_scene",
                x: 0.5,
                y: 0.3,
                w: 0.3,
                h: 0.5,
                anchor: "bottomCenter",
              },
              topics: [],
            },
          ],
        },
      ],
    } satisfies InvestigationSceneJson;

    const { container } = render(EditorCanvas, {
      scene: bgSpriteScene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange: vi.fn(),
    });

    expect(container.querySelector(".character-preview")).toHaveAttribute(
      "src",
      "/assets/backgrounds/chapter_1/crime_scene.png",
    );
  });

  it("loads alpha crop variables for character previews", () => {
    expect(editorCanvasSource).toContain("loadCharacterCrop");
    expect(editorCanvasSource).toContain("cropVariablesForAlphaBounds");
    expect(editorCanvasSource).toContain("character-preview-crop");
  });

  it("moves a character box and reports updated coordinates", async () => {
    const onCharacterLayoutChange = vi.fn();
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange: vi.fn(),
      onCharacterLayoutChange,
    });

    const plate = container.querySelector(".plate") as HTMLElement;
    const character = container.querySelector(
      ".target.character",
    ) as HTMLElement;
    vi.spyOn(plate, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => {},
    } as DOMRect);

    await fireEvent.pointerDown(character, {
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    await fireEvent.pointerMove(plate, {
      pointerId: 1,
      clientX: 250,
      clientY: 230,
    });
    await fireEvent.pointerUp(plate, {
      pointerId: 1,
      clientX: 250,
      clientY: 230,
    });

    expect(onCharacterLayoutChange).toHaveBeenCalled();
    const lastCall = onCharacterLayoutChange.mock.calls.at(-1)!;
    const [, , newLayout] = lastCall;
    // Default character layout is x:0.66, y:0.14, w:0.18, h:0.76
    // Moved by dx=50/1000=0.05, dy=30/1000=0.03
    expect(newLayout.x).toBeCloseTo(0.71, 5);
    expect(newLayout.y).toBeCloseTo(0.17, 5);
    expect(newLayout.w).toBeCloseTo(0.18, 5);
    expect(newLayout.h).toBeCloseTo(0.76, 5);
  });

  it("resizes a hotspot from the se handle and reports clamped coordinates", async () => {
    const onHotspotLayoutChange = vi.fn();
    const { container } = render(EditorCanvas, {
      scene,
      layout,
      sublocationId: "office",
      onHotspotLayoutChange,
      onCharacterLayoutChange: vi.fn(),
    });

    const plate = container.querySelector(".plate") as HTMLElement;
    const seHandle = container.querySelector(
      ".target.hotspot .resize-handle.se",
    ) as HTMLElement;
    vi.spyOn(plate, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => {},
    } as DOMRect);

    await fireEvent.pointerDown(seHandle, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    await fireEvent.pointerMove(plate, {
      pointerId: 1,
      clientX: 160,
      clientY: 140,
    });
    await fireEvent.pointerUp(plate, {
      pointerId: 1,
      clientX: 160,
      clientY: 140,
    });

    expect(onHotspotLayoutChange).toHaveBeenCalled();
    const lastCall = onHotspotLayoutChange.mock.calls.at(-1)!;
    const [, , newLayout] = lastCall;
    // Default hotspot layout is x:0.4, y:0.4, w:0.12, h:0.1
    // Resized se by dx=60/1000=0.06, dy=40/1000=0.04
    expect(newLayout.x).toBeCloseTo(0.4, 5);
    expect(newLayout.y).toBeCloseTo(0.4, 5);
    expect(newLayout.w).toBeCloseTo(0.18, 5);
    expect(newLayout.h).toBeCloseTo(0.14, 5);
  });
});
