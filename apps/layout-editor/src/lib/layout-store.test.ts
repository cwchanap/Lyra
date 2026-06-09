// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RectLayout, SpriteLayout } from "./layout-types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  editorState,
  setHotspotLayout,
  setCharacterLayout,
  loadInvestigationScene,
} from "./layout-store.svelte";

const mockInvoke = vi.mocked(invoke);

function resetState() {
  editorState.chapters = null;
  editorState.scene = null;
  editorState.layout = null;
  editorState.scenePath = null;
  editorState.layoutPath = null;
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
    it("sets a character layout and clamps values", () => {
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

  describe("loadInvestigationScene", () => {
    it("synthesizes empty layout when sidecar file is not found", async () => {
      const sceneJson = {
        type: "investigation",
        id: "scene_new",
        title: "New Scene",
        intro: [],
        sublocations: [],
        evidenceManifest: [],
      };

      mockInvoke
        .mockResolvedValueOnce({
          path: "scenes/scene_new.json",
          contents: JSON.stringify(sceneJson),
        })
        .mockResolvedValueOnce("layouts/scene_new.layout.json")
        .mockRejectedValueOnce({ code: "notFound", message: "Not found" });

      await loadInvestigationScene("scenes/scene_new.json");

      expect(editorState.error).toBeNull();
      expect(editorState.scene?.id).toBe("scene_new");
      expect(editorState.layout).toEqual({
        version: 1,
        sceneId: "scene_new",
        sublocations: {},
      });
    });

    it("loads existing layout from sidecar file", async () => {
      const sceneJson = {
        type: "investigation",
        id: "scene_existing",
        title: "Existing Scene",
        intro: [],
        sublocations: [],
        evidenceManifest: [],
      };

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
        .mockResolvedValueOnce({
          path: "scenes/scene_existing.json",
          contents: JSON.stringify(sceneJson),
        })
        .mockResolvedValueOnce("layouts/scene_existing.layout.json")
        .mockResolvedValueOnce({
          path: "layouts/scene_existing.layout.json",
          contents: JSON.stringify(existingLayout),
        });

      await loadInvestigationScene("scenes/scene_existing.json");

      expect(editorState.error).toBeNull();
      expect(editorState.layout).toEqual(existingLayout);
    });

    it("surfaces non-notFound errors", async () => {
      mockInvoke.mockRejectedValueOnce({
        code: "permissionDenied",
        message: "Access denied",
      });

      await loadInvestigationScene("scenes/bad.json");

      expect(editorState.error).toBe("Access denied");
      expect(editorState.layout).toBeNull();
    });
  });
});
