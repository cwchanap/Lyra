import { invoke } from "@tauri-apps/api/core";
import type {
  InvestigationLayoutSidecar,
  InvestigationSceneJson,
  RectLayout,
  SceneIndex,
  SpriteLayout,
} from "./layout-types";

type ProjectFile = {
  path: string;
  contents: string;
};

type EditorCommandError = {
  code: string;
  message: string;
};

export const editorState = $state<{
  chapters: SceneIndex | null;
  scene: InvestigationSceneJson | null;
  layout: InvestigationLayoutSidecar | null;
  scenePath: string | null;
  layoutPath: string | null;
  error: string | null;
}>({
  chapters: null,
  scene: null,
  layout: null,
  scenePath: null,
  layoutPath: null,
  error: null,
});

export async function loadChapters() {
  editorState.error = null;
  try {
    const file = await invoke<ProjectFile>("read_project_file", {
      path: "apps/game/src-tauri/resources/scenes/chapters.json",
    });
    editorState.chapters = JSON.parse(file.contents) as SceneIndex;
  } catch (error) {
    editorState.error = normalizeError(error);
  }
}

export async function loadInvestigationScene(scenePath: string) {
  editorState.error = null;

  try {
    const sceneFile = await invoke<ProjectFile>("read_project_file", {
      path: scenePath,
    });
    const scene = JSON.parse(sceneFile.contents) as InvestigationSceneJson;
    const layoutPath = await invoke<string>("resolve_layout_path", {
      scenePath,
    });
    editorState.scene = scene;
    editorState.scenePath = scenePath;
    editorState.layoutPath = layoutPath;

    try {
      const layoutFile = await invoke<ProjectFile>("read_project_file", {
        path: layoutPath,
      });
      editorState.layout = JSON.parse(
        layoutFile.contents,
      ) as InvestigationLayoutSidecar;
    } catch (error) {
      if (isEditorCommandError(error) && error.code === "notFound") {
        editorState.layout = {
          version: 1,
          sceneId: scene.id,
          sublocations: {},
        };
      } else {
        editorState.layout = null;
        editorState.error = normalizeError(error);
      }
    }
  } catch (error) {
    editorState.error = normalizeError(error);
  }
}

export async function saveLayout() {
  if (!editorState.layoutPath || !editorState.layout) return;

  editorState.error = null;
  try {
    await invoke("write_project_file", {
      path: editorState.layoutPath,
      contents: `${JSON.stringify(editorState.layout, null, 2)}\n`,
    });
  } catch (error) {
    editorState.error = normalizeError(error);
  }
}

export function setHotspotLayout(
  sublocationId: string,
  hotspotId: string,
  layout: RectLayout,
) {
  if (!editorState.layout) return;

  const sublocation = editorState.layout.sublocations[sublocationId] ?? {
    hotspots: {},
    characters: {},
  };

  editorState.layout = {
    ...editorState.layout,
    sublocations: {
      ...editorState.layout.sublocations,
      [sublocationId]: {
        hotspots: {
          ...sublocation.hotspots,
          [hotspotId]: clampRectLayout(layout),
        },
        characters: {
          ...sublocation.characters,
        },
      },
    },
  };
}

export function setCharacterLayout(
  sublocationId: string,
  characterId: string,
  layout: SpriteLayout,
) {
  if (!editorState.layout) return;

  const sublocation = editorState.layout.sublocations[sublocationId] ?? {
    hotspots: {},
    characters: {},
  };

  editorState.layout = {
    ...editorState.layout,
    sublocations: {
      ...editorState.layout.sublocations,
      [sublocationId]: {
        hotspots: {
          ...sublocation.hotspots,
        },
        characters: {
          ...sublocation.characters,
          [characterId]: clampSpriteLayout(layout),
        },
      },
    },
  };
}

function clampRectLayout(layout: RectLayout): RectLayout {
  return {
    kind: "rect",
    ...clampBox(layout),
  };
}

function clampSpriteLayout(layout: SpriteLayout): SpriteLayout {
  return {
    kind: "sprite",
    assetId: layout.assetId,
    ...clampBox(layout),
    anchor: "bottomCenter",
  };
}

function clampBox(layout: RectLayout | SpriteLayout) {
  const w = clamp(layout.w, 0.02, 1);
  const h = clamp(layout.h, 0.02, 1);

  return {
    x: clamp(layout.x, 0, 1 - w),
    y: clamp(layout.y, 0, 1 - h),
    w,
    h,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeError(error: unknown): string {
  if (isEditorCommandError(error)) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Editor command failed.";
}

function isEditorCommandError(error: unknown): error is EditorCommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as Partial<EditorCommandError>).code === "string" &&
    typeof (error as Partial<EditorCommandError>).message === "string"
  );
}
