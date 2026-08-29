import type {
  CharacterLayout,
  InvestigationLayoutSidecar,
  InvestigationSceneJson,
  RectLayout,
} from "./layout-types";
import { clampCharacterLayout, clampRectLayout } from "./layout-geometry";
import {
  loadInvestigationLayout,
  loadSceneBundle,
  saveInvestigationLayout,
} from "./workbench-api";

type EditorCommandError = {
  code: string;
  message: string;
};

export const editorState = $state<{
  scene: InvestigationSceneJson | null;
  layout: InvestigationLayoutSidecar | null;
  chapterId: string | null;
  sceneId: string | null;
  error: string | null;
}>({
  scene: null,
  layout: null,
  chapterId: null,
  sceneId: null,
  error: null,
});

let loadSceneGeneration = 0;

/**
 * Clears Stage state and cancels any in-flight loadInvestigationScene so a
 * late bundle cannot repopulate the stage with the wrong scene.
 */
export function clearStage() {
  loadSceneGeneration += 1;
  editorState.scene = null;
  editorState.layout = null;
  editorState.chapterId = null;
  editorState.sceneId = null;
  editorState.error = null;
}

export async function loadInvestigationScene(
  chapterId: string,
  sceneId: string,
) {
  const generation = ++loadSceneGeneration;
  // Clear the previous scene immediately so a pending save during this load
  // cannot persist the previous scene's layout under the next scene's ids.
  // The bundle fetch below sets scene/chapterId/sceneId before its own layout
  // fetch awaits, which would otherwise leave the new ids paired with the old
  // layout for the duration of that second await.
  editorState.scene = null;
  editorState.layout = null;
  editorState.chapterId = null;
  editorState.sceneId = null;
  editorState.error = null;

  try {
    const bundle = await loadSceneBundle(chapterId, sceneId);
    if (generation !== loadSceneGeneration) return;
    const scene = bundle.scene;
    if (scene.type !== "investigation") {
      editorState.scene = null;
      editorState.layout = null;
      editorState.chapterId = null;
      editorState.sceneId = null;
      editorState.error = `Stage is available for investigation scenes only. (scene "${sceneId}" is type "${scene.type}")`;
      return;
    }

    // The compiled bundle is a superset of the editor's narrower rendering
    // view (see layout-types.ts); the backend already validated that the
    // payload matches the manifest's investigation scene.
    editorState.scene = scene as InvestigationSceneJson;
    editorState.chapterId = chapterId;
    editorState.sceneId = sceneId;

    try {
      const layout = await loadInvestigationLayout(chapterId, sceneId);
      if (generation !== loadSceneGeneration) return;
      editorState.layout = layout ?? {
        version: 1,
        sceneId: scene.id,
        sublocations: {},
      };
    } catch (error) {
      if (generation !== loadSceneGeneration) return;
      editorState.layout = null;
      editorState.error = normalizeError(error);
    }
  } catch (error) {
    if (generation !== loadSceneGeneration) return;
    editorState.scene = null;
    editorState.layout = null;
    editorState.chapterId = null;
    editorState.sceneId = null;
    editorState.error = normalizeError(error);
  }
}

export async function saveLayout() {
  if (!editorState.chapterId || !editorState.sceneId || !editorState.layout)
    return;

  editorState.error = null;
  try {
    await saveInvestigationLayout(
      editorState.chapterId,
      editorState.sceneId,
      editorState.layout,
    );
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
        ...sublocation,
        hotspots: {
          ...sublocation.hotspots,
          [hotspotId]: clampRectLayout(layout),
        },
      },
    },
  };
}

export function setCharacterLayout(
  sublocationId: string,
  characterId: string,
  layout: CharacterLayout,
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
        ...sublocation,
        characters: {
          ...sublocation.characters,
          [characterId]: clampCharacterLayout(layout),
        },
      },
    },
  };
}

export function normalizeError(error: unknown): string {
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
