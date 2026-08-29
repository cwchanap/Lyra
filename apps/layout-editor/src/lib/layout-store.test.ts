// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CharacterLayout, RectLayout, SpriteLayout } from "./layout-types";
import type { WorkbenchSceneBundle } from "./workbench-types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  clearStage,
  editorState,
  setHotspotLayout,
  setCharacterLayout,
  saveLayout,
  loadInvestigationScene,
} from "./layout-store.svelte";

const mockInvoke = vi.mocked(invoke);

function investigationBundleScene(id: string, title = id) {
  return {
    type: "investigation",
    id,
    title,
    summary: "",
    intro: [],
    assetRefs: [],
    sublocations: [],
    evidenceManifest: [],
  };
}

function bundleWithScene(scene: Record<string, unknown>): WorkbenchSceneBundle {
  return { scene: scene as unknown as WorkbenchSceneBundle["scene"] };
}

function resetState() {
  editorState.scene = null;
  editorState.layout = null;
  editorState.chapterId = null;
  editorState.sceneId = null;
  editorState.error = null;
}

describe("layout-store", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  describe("setHotspotLayout", () => {
    it("sets a hotspot layout on an existing sublocation", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {
          office: { hotspots: {}, characters: {} },
        },
      };

      const layout: RectLayout = {
        kind: "rect",
        x: 0.2,
        y: 0.3,
        w: 0.15,
        h: 0.1,
      };

      setHotspotLayout("office", "desk", layout);

      expect(editorState.layout?.sublocations.office.hotspots.desk).toEqual({
        kind: "rect",
        x: 0.2,
        y: 0.3,
        w: 0.15,
        h: 0.1,
      });
    });

    it("creates a new sublocation entry when none exists", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {},
      };

      setHotspotLayout("lobby", "door", {
        kind: "rect",
        x: 0.5,
        y: 0.5,
        w: 0.1,
        h: 0.1,
      });

      expect(editorState.layout?.sublocations.lobby).toBeDefined();
      expect(
        editorState.layout?.sublocations.lobby.hotspots.door,
      ).toBeDefined();
    });

    it("preserves existing characters when setting a hotspot", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {
          office: {
            hotspots: {},
            characters: {
              witness: {
                kind: "sprite",
                assetId: "standee.witness.standard",
                x: 0.5,
                y: 0.2,
                w: 0.2,
                h: 0.6,
                anchor: "bottomCenter",
              },
            },
          },
        },
      };

      setHotspotLayout("office", "desk", {
        kind: "rect",
        x: 0.1,
        y: 0.1,
        w: 0.1,
        h: 0.1,
      });

      expect(
        editorState.layout?.sublocations.office.characters.witness,
      ).toBeDefined();
    });

    it("does nothing when layout is null", () => {
      editorState.layout = null;

      setHotspotLayout("office", "desk", {
        kind: "rect",
        x: 0.5,
        y: 0.5,
        w: 0.1,
        h: 0.1,
      });

      expect(editorState.layout).toBeNull();
    });
  });

  describe("setCharacterLayout", () => {
    it("sets a character layout", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {
          office: { hotspots: {}, characters: {} },
        },
      };

      const layout: SpriteLayout = {
        kind: "sprite",
        assetId: "standee.witness.standard",
        x: 0.6,
        y: 0.2,
        w: 0.18,
        h: 0.76,
        anchor: "bottomCenter",
      };

      setCharacterLayout("office", "witness", layout);

      const stored = editorState.layout?.sublocations.office.characters.witness;
      expect(stored).toEqual(layout);
    });

    it("stores a baked character layout without sprite fields", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {
          office: { hotspots: {}, characters: {} },
        },
      };

      const layout = {
        kind: "baked",
        x: 0.42,
        y: 0.18,
        w: 0.2,
        h: 0.7,
      } satisfies CharacterLayout;

      setCharacterLayout("office", "witness", layout);

      expect(
        editorState.layout?.sublocations.office.characters.witness,
      ).toStrictEqual(layout);
      expect(
        editorState.layout?.sublocations.office.characters.witness,
      ).not.toHaveProperty("assetId");
      expect(
        editorState.layout?.sublocations.office.characters.witness,
      ).not.toHaveProperty("anchor");
    });

    it("clamps out-of-range values when setting a character layout", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {
          office: { hotspots: {}, characters: {} },
        },
      };

      const outOfRange: SpriteLayout = {
        kind: "sprite",
        assetId: "standee.witness.standard",
        x: -0.5,
        y: 1.5,
        w: 0.0,
        h: 2.0,
        anchor: "bottomCenter",
      };

      setCharacterLayout("office", "witness", outOfRange);

      const stored = editorState.layout?.sublocations.office.characters.witness;
      expect(stored).not.toBeNull();
      expect(stored?.kind).toBe("sprite");
      if (stored?.kind !== "sprite") throw new Error("Expected sprite layout");
      expect(stored.anchor).toBe("bottomCenter");
      expect(stored.x).toBeGreaterThanOrEqual(0);
      expect(stored.y).toBeGreaterThanOrEqual(0);
      expect(stored.w).toBeGreaterThanOrEqual(0.025);
      expect(stored.x + stored.w).toBeLessThanOrEqual(1);
      expect(stored.y + stored.h).toBeLessThanOrEqual(1);
    });

    it("preserves existing hotspots when setting a character", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {
          office: {
            hotspots: {
              desk: { kind: "rect", x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
            },
            characters: {},
          },
        },
      };

      setCharacterLayout("office", "witness", {
        kind: "sprite",
        assetId: "standee.witness.standard",
        x: 0.5,
        y: 0.2,
        w: 0.2,
        h: 0.6,
        anchor: "bottomCenter",
      });

      expect(
        editorState.layout?.sublocations.office.hotspots.desk,
      ).toBeDefined();
    });
  });

  describe("intentionalOverlaps preservation", () => {
    it("setHotspotLayout preserves intentionalOverlaps on the edited sublocation", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {
          office: {
            hotspots: {
              a: { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
              b: { kind: "rect", x: 0.15, y: 0.15, w: 0.2, h: 0.2 },
            },
            characters: {},
            intentionalOverlaps: [{ hotspots: ["a", "b"] }],
          },
        },
      };

      setHotspotLayout("office", "a", {
        kind: "rect",
        x: 0.05,
        y: 0.05,
        w: 0.2,
        h: 0.2,
      });

      expect(
        editorState.layout?.sublocations.office.intentionalOverlaps,
      ).toEqual([{ hotspots: ["a", "b"] }]);
    });

    it("setCharacterLayout preserves intentionalOverlaps on the edited sublocation", () => {
      editorState.layout = {
        version: 1,
        sceneId: "scene_1",
        sublocations: {
          office: {
            hotspots: {
              a: { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
              b: { kind: "rect", x: 0.15, y: 0.15, w: 0.2, h: 0.2 },
            },
            characters: {},
            intentionalOverlaps: [{ hotspots: ["a", "b"] }],
          },
        },
      };

      setCharacterLayout("office", "witness", {
        kind: "sprite",
        assetId: "standee.witness.standard",
        x: 0.5,
        y: 0.2,
        w: 0.2,
        h: 0.6,
        anchor: "bottomCenter",
      });

      expect(
        editorState.layout?.sublocations.office.intentionalOverlaps,
      ).toEqual([{ hotspots: ["a", "b"] }]);
    });

    it("round-trips a sidecar with intentionalOverlaps through load + edit + save shape", async () => {
      const existingLayout = {
        version: 1,
        sceneId: "scene_overlap",
        sublocations: {
          office: {
            hotspots: {
              a: { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
              b: { kind: "rect", x: 0.15, y: 0.15, w: 0.2, h: 0.2 },
            },
            characters: {},
            intentionalOverlaps: [{ hotspots: ["a", "b"] }],
          },
        },
      };

      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("scene_overlap")),
        )
        .mockResolvedValueOnce(existingLayout);

      await loadInvestigationScene("chapter_1", "scene_overlap");

      expect(editorState.error).toBeNull();
      expect(
        editorState.layout?.sublocations.office.intentionalOverlaps,
      ).toEqual([{ hotspots: ["a", "b"] }]);

      // Edit a hotspot — the opt-out must survive the rebuild.
      setHotspotLayout("office", "a", {
        kind: "rect",
        x: 0.05,
        y: 0.05,
        w: 0.2,
        h: 0.2,
      });

      expect(
        editorState.layout?.sublocations.office.intentionalOverlaps,
      ).toEqual([{ hotspots: ["a", "b"] }]);
      expect(editorState.layout?.sublocations.office.hotspots.a.x).toBe(0.05);
    });
  });

  describe("loadInvestigationScene", () => {
    it("loads bundle and layout by chapter/scene ids", async () => {
      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("investigation_scene_3")),
        )
        .mockResolvedValueOnce({
          version: 1,
          sceneId: "investigation_scene_3",
          sublocations: {},
        });

      await loadInvestigationScene("chapter_1", "investigation_scene_3");

      expect(invoke).toHaveBeenCalledWith("load_scene_bundle", {
        chapterId: "chapter_1",
        sceneId: "investigation_scene_3",
      });
      expect(invoke).toHaveBeenCalledWith("load_investigation_layout", {
        chapterId: "chapter_1",
        sceneId: "investigation_scene_3",
      });
      expect(editorState.error).toBeNull();
      expect(editorState.chapterId).toBe("chapter_1");
      expect(editorState.sceneId).toBe("investigation_scene_3");
      expect(editorState.scene?.id).toBe("investigation_scene_3");
    });

    it("synthesizes empty layout when the sidecar is absent", async () => {
      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("scene_new", "New Scene")),
        )
        .mockResolvedValueOnce(null);

      await loadInvestigationScene("chapter_1", "scene_new");

      expect(editorState.error).toBeNull();
      expect(editorState.scene?.id).toBe("scene_new");
      expect(editorState.layout).toEqual({
        version: 1,
        sceneId: "scene_new",
        sublocations: {},
      });
    });

    it("loads existing layout sidecar", async () => {
      const existingLayout = {
        version: 1,
        sceneId: "scene_existing",
        sublocations: {
          office: {
            hotspots: {
              desk: { kind: "rect", x: 0.2, y: 0.3, w: 0.15, h: 0.1 },
            },
            characters: {},
          },
        },
      };

      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("scene_existing")),
        )
        .mockResolvedValueOnce(existingLayout);

      await loadInvestigationScene("chapter_1", "scene_existing");

      expect(editorState.error).toBeNull();
      expect(editorState.layout).toEqual(existingLayout);
    });

    it("rejects a non-investigation bundle without loading a layout", async () => {
      mockInvoke.mockResolvedValueOnce(
        bundleWithScene({ type: "interrogation", id: "interrogation_scene_2" }),
      );

      await loadInvestigationScene("chapter_1", "interrogation_scene_2");

      expect(editorState.error).toContain(
        "Stage is available for investigation scenes only.",
      );
      expect(editorState.scene).toBeNull();
      expect(editorState.layout).toBeNull();
      expect(editorState.chapterId).toBeNull();
      expect(editorState.sceneId).toBeNull();
      expect(invoke).not.toHaveBeenCalledWith("load_investigation_layout", {
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_2",
      });
    });

    it("surfaces layout load failures", async () => {
      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("scene_bad")),
        )
        .mockRejectedValueOnce({
          code: "permissionDenied",
          message: "Access denied",
        });

      await loadInvestigationScene("chapter_1", "scene_bad");

      expect(editorState.error).toBe("Access denied");
      expect(editorState.layout).toBeNull();
    });

    it("clearStage cancels an in-flight load so a late bundle cannot repopulate the stage", async () => {
      let resolveBundle!: (bundle: WorkbenchSceneBundle) => void;
      mockInvoke.mockImplementationOnce(
        () =>
          new Promise<WorkbenchSceneBundle>((resolve) => {
            resolveBundle = resolve;
          }),
      );

      const pending = loadInvestigationScene("chapter_1", "scene_slow");
      clearStage();
      resolveBundle(bundleWithScene(investigationBundleScene("scene_slow")));
      await pending;

      expect(editorState.scene).toBeNull();
      expect(editorState.layout).toBeNull();
      expect(editorState.chapterId).toBeNull();
      expect(editorState.sceneId).toBeNull();
      expect(editorState.error).toBeNull();
      // The cancelled load must not proceed to its layout fetch either.
      expect(invoke).not.toHaveBeenCalledWith("load_investigation_layout", {
        chapterId: "chapter_1",
        sceneId: "scene_slow",
      });
    });

    it("clears stale scene state when the bundle load fails", async () => {
      // First, populate state with a successful load
      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("scene_ok")),
        )
        .mockResolvedValueOnce({
          version: 1,
          sceneId: "scene_ok",
          sublocations: {},
        });

      await loadInvestigationScene("chapter_1", "scene_ok");
      expect(editorState.scene?.id).toBe("scene_ok");
      expect(editorState.error).toBeNull();

      // Now fail a subsequent load — stale state must be cleared
      mockInvoke.mockRejectedValueOnce({
        code: "notFound",
        message: "Scene missing",
      });

      await loadInvestigationScene("chapter_1", "scene_missing");

      expect(editorState.error).toBe("Scene missing");
      expect(editorState.scene).toBeNull();
      expect(editorState.chapterId).toBeNull();
      expect(editorState.sceneId).toBeNull();
      expect(editorState.layout).toBeNull();
    });

    it("clears the previous scene before the next scene's ids are applied so saveLayout during a pending load cannot persist the old layout under the new ids", async () => {
      // Load scene A fully and give it a detectable layout.
      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("scene_a")),
        )
        .mockResolvedValueOnce({
          version: 1,
          sceneId: "scene_a",
          sublocations: {
            office: {
              hotspots: {
                desk: { kind: "rect", x: 0.2, y: 0.3, w: 0.15, h: 0.1 },
              },
              characters: {},
            },
          },
        });
      await loadInvestigationScene("chapter_1", "scene_a");
      expect(editorState.sceneId).toBe("scene_a");
      expect(editorState.layout).not.toBeNull();

      // Start loading scene B; hold its layout fetch pending so we can probe
      // the window between the bundle resolving and the layout resolving.
      let resolveLayoutB!: (value: unknown) => void;
      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("scene_b")),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveLayoutB = resolve;
            }),
        );

      const pending = loadInvestigationScene("chapter_1", "scene_b");

      // The previous scene's state is cleared synchronously at load start,
      // before any await, so a save during the pending load has nothing to
      // persist and never reaches the save command.
      expect(editorState.scene).toBeNull();
      expect(editorState.layout).toBeNull();
      expect(editorState.chapterId).toBeNull();
      expect(editorState.sceneId).toBeNull();

      // Let the bundle resolve and the layout fetch be issued.
      await Promise.resolve();
      await Promise.resolve();

      // Even after the bundle resolves and scene_b's ids are applied, the
      // previous layout must not be present, so saveLayout is a no-op.
      await saveLayout();
      expect(invoke).not.toHaveBeenCalledWith(
        "save_investigation_layout",
        expect.objectContaining({
          chapterId: "chapter_1",
          sceneId: "scene_b",
        }),
      );

      // Finish the load; scene_b populates the stage with its own layout.
      resolveLayoutB({ version: 1, sceneId: "scene_b", sublocations: {} });
      await pending;
      expect(editorState.sceneId).toBe("scene_b");
      expect(editorState.layout).toEqual({
        version: 1,
        sceneId: "scene_b",
        sublocations: {},
      });
    });
  });

  describe("saveLayout", () => {
    it("saves the current layout by selected chapter/scene ids", async () => {
      const layout = {
        version: 1,
        sceneId: "investigation_scene_3",
        sublocations: {
          office: {
            hotspots: {
              desk: { kind: "rect", x: 0.2, y: 0.3, w: 0.15, h: 0.1 },
            },
            characters: {},
          },
        },
      };
      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("investigation_scene_3")),
        )
        .mockResolvedValueOnce(layout);

      await loadInvestigationScene("chapter_1", "investigation_scene_3");
      await saveLayout();

      expect(invoke).toHaveBeenCalledWith("save_investigation_layout", {
        chapterId: "chapter_1",
        sceneId: "investigation_scene_3",
        layout,
      });
      expect(editorState.error).toBeNull();
    });

    it("surfaces save failures", async () => {
      const layout = {
        version: 1,
        sceneId: "investigation_scene_3",
        sublocations: {},
      };
      mockInvoke
        .mockResolvedValueOnce(
          bundleWithScene(investigationBundleScene("investigation_scene_3")),
        )
        .mockResolvedValueOnce(layout)
        .mockRejectedValueOnce({ code: "writeFailed", message: "Disk full" });

      await loadInvestigationScene("chapter_1", "investigation_scene_3");
      await saveLayout();

      expect(editorState.error).toBe("Disk full");
    });

    it("does nothing without a loaded scene", async () => {
      await saveLayout();

      expect(invoke).not.toHaveBeenCalledWith(
        "save_investigation_layout",
        expect.anything(),
      );
    });
  });
});
