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
  loadChapters,
  loadInvestigationScene,
  assignEvidenceToHotspot,
} from "./layout-store.svelte";

const mockInvoke = vi.mocked(invoke);

function resetState() {
  editorState.chapters = null;
  editorState.scene = null;
  editorState.layout = null;
  editorState.scenePath = null;
  editorState.layoutPath = null;
  editorState.storyScenePath = null;
  editorState.storySceneContents = null;
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
      expect(stored!.anchor).toBe("bottomCenter");
      expect(stored!.x).toBeGreaterThanOrEqual(0);
      expect(stored!.y).toBeGreaterThanOrEqual(0);
      expect(stored!.w).toBeGreaterThanOrEqual(0.025);
      expect(stored!.x + stored!.w).toBeLessThanOrEqual(1);
      expect(stored!.y + stored!.h).toBeLessThanOrEqual(1);
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
        .mockResolvedValueOnce(
          "docs/stories_plan/chapter_1/investigation_scene_1.md",
        )
        .mockResolvedValueOnce({
          path: "docs/stories_plan/chapter_1/investigation_scene_1.md",
          contents: "# Scene\n",
        })
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
        .mockResolvedValueOnce(
          "docs/stories_plan/chapter_1/investigation_scene_existing.md",
        )
        .mockResolvedValueOnce({
          path: "docs/stories_plan/chapter_1/investigation_scene_existing.md",
          contents: "# Scene\n",
        })
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

    it("clears stale scene state when outer read fails", async () => {
      // First, populate state with a successful load
      const sceneJson = {
        type: "investigation",
        id: "scene_ok",
        title: "OK Scene",
        intro: [],
        sublocations: [],
        evidenceManifest: [],
      };
      mockInvoke
        .mockResolvedValueOnce({
          path: "scenes/scene_ok.json",
          contents: JSON.stringify(sceneJson),
        })
        .mockResolvedValueOnce("layouts/scene_ok.layout.json")
        .mockResolvedValueOnce(
          "docs/stories_plan/chapter_1/investigation_scene_ok.md",
        )
        .mockResolvedValueOnce({
          path: "docs/stories_plan/chapter_1/investigation_scene_ok.md",
          contents: "# Scene\n",
        })
        .mockResolvedValueOnce({
          path: "layouts/scene_ok.layout.json",
          contents: JSON.stringify({
            version: 1,
            sceneId: "scene_ok",
            sublocations: {},
          }),
        });

      await loadInvestigationScene("scenes/scene_ok.json");
      expect(editorState.scene?.id).toBe("scene_ok");
      expect(editorState.layoutPath).toBe("layouts/scene_ok.layout.json");
      expect(editorState.error).toBeNull();

      // Now fail a subsequent load — stale state must be cleared
      mockInvoke.mockRejectedValueOnce({
        code: "notFound",
        message: "Scene missing",
      });

      await loadInvestigationScene("scenes/missing.json");

      expect(editorState.error).toBe("Scene missing");
      expect(editorState.scene).toBeNull();
      expect(editorState.scenePath).toBeNull();
      expect(editorState.layout).toBeNull();
      expect(editorState.layoutPath).toBeNull();
      expect(editorState.storyScenePath).toBeNull();
      expect(editorState.storySceneContents).toBeNull();
    });
  });

  describe("assignEvidenceToHotspot", () => {
    it("writes authored markdown and updates the in-memory scene reveals", async () => {
      editorState.storyScenePath =
        "docs/stories_plan/chapter_1/investigation_scene_1.md";
      editorState.storySceneContents = `# Investigation

## Sublocation: Office {#office}

### Hotspot: Desk {#desk}
- **Description:** Desk.
- **Reveals:** [evidence:receipt]

### Hotspot: Terminal {#terminal}
- **Description:** Terminal.
`;
      editorState.scene = {
        type: "investigation",
        id: "investigation_scene_1",
        title: "Test",
        intro: [],
        sublocations: [
          {
            id: "office",
            label: "Office",
            sceneTag: "Office",
            backgroundAssetId: null,
            transitionDialogue: [],
            hotspots: [
              {
                id: "desk",
                label: "Desk",
                description: "Desk.",
                evidenceSource: null,
                sceneSourcePrompt: null,
                reveals: [{ kind: "evidence", id: "receipt" }],
                inspectDialogue: [],
                layout: null,
              },
              {
                id: "terminal",
                label: "Terminal",
                description: "Terminal.",
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
        evidenceManifest: [
          {
            id: "receipt",
            name: "Receipt",
            description: "Receipt clue.",
            imageAssetId: null,
          },
        ],
      };
      mockInvoke.mockResolvedValueOnce(undefined);

      await assignEvidenceToHotspot("receipt", "terminal");

      expect(mockInvoke).toHaveBeenCalledWith("write_story_scene_file", {
        path: "docs/stories_plan/chapter_1/investigation_scene_1.md",
        contents: expect.stringContaining(
          "### Hotspot: Terminal {#terminal}\n- **Description:** Terminal.\n- **Reveals:** [evidence:receipt]",
        ),
      });
      expect(editorState.storySceneContents).toContain(
        "### Hotspot: Terminal {#terminal}\n- **Description:** Terminal.\n- **Reveals:** [evidence:receipt]",
      );
      expect(editorState.scene.sublocations[0].hotspots[0].reveals).toEqual([]);
      expect(editorState.scene.sublocations[0].hotspots[1].reveals).toEqual([
        { kind: "evidence", id: "receipt" },
      ]);
    });
  });

  describe("loadChapters", () => {
    it("clears stale chapters on read failure", async () => {
      // First, populate with a successful load
      mockInvoke.mockResolvedValueOnce({
        path: "chapters.json",
        contents: JSON.stringify({
          chapters: [{ id: "ch1", title: "Chapter 1", scenes: [] }],
        }),
      });

      await loadChapters();
      expect(editorState.chapters).not.toBeNull();
      expect(editorState.error).toBeNull();

      // Now fail a refresh — stale chapters must be cleared
      mockInvoke.mockRejectedValueOnce({
        code: "notFound",
        message: "File gone",
      });

      await loadChapters();

      expect(editorState.error).toBe("File gone");
      expect(editorState.chapters).toBeNull();
    });
  });
});
