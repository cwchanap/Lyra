import { invoke } from "@tauri-apps/api/core";
import type {
  InvestigationLayoutSidecar,
  InvestigationSceneJson,
  RectLayout,
  SceneIndex,
  SpriteLayout,
} from "./layout-types";
import { clampRectLayout, clampSpriteLayout } from "./layout-geometry";
import {
  moveEvidenceRevealInScene,
  updateEvidenceAssignmentInMarkdown,
} from "./evidence-assignment";

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
  storyScenePath: string | null;
  storySceneContents: string | null;
  error: string | null;
}>({
  chapters: null,
  scene: null,
  layout: null,
  scenePath: null,
  layoutPath: null,
  storyScenePath: null,
  storySceneContents: null,
  error: null,
});

let loadChaptersGeneration = 0;

export async function loadChapters() {
  const generation = ++loadChaptersGeneration;
  editorState.error = null;
  try {
    const file = await invoke<ProjectFile>("read_project_file", {
      path: "apps/game/src-tauri/resources/scenes/chapters.json",
    });
    if (generation !== loadChaptersGeneration) return;
    editorState.chapters = JSON.parse(file.contents) as SceneIndex;
  } catch (error) {
    if (generation !== loadChaptersGeneration) return;
    editorState.chapters = null;
    editorState.error = normalizeError(error);
  }
}

let loadSceneGeneration = 0;

export async function loadInvestigationScene(scenePath: string) {
  const generation = ++loadSceneGeneration;
  editorState.error = null;

  try {
    const sceneFile = await invoke<ProjectFile>("read_project_file", {
      path: scenePath,
    });
    if (generation !== loadSceneGeneration) return;
    const scene = JSON.parse(sceneFile.contents) as InvestigationSceneJson;
    const layoutPath = await invoke<string>("resolve_layout_path", {
      scenePath,
    });
    if (generation !== loadSceneGeneration) return;
    const storyScenePath = await invoke<string>("resolve_story_scene_path", {
      scenePath,
    });
    if (generation !== loadSceneGeneration) return;
    const storySceneFile = await invoke<ProjectFile>("read_project_file", {
      path: storyScenePath,
    });
    if (generation !== loadSceneGeneration) return;
    editorState.scene = scene;
    editorState.scenePath = scenePath;
    editorState.layoutPath = layoutPath;
    editorState.storyScenePath = storyScenePath;
    editorState.storySceneContents = storySceneFile.contents;

    try {
      const layoutFile = await invoke<ProjectFile>("read_project_file", {
        path: layoutPath,
      });
      if (generation !== loadSceneGeneration) return;
      editorState.layout = JSON.parse(
        layoutFile.contents,
      ) as InvestigationLayoutSidecar;
    } catch (error) {
      if (generation !== loadSceneGeneration) return;
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
    if (generation !== loadSceneGeneration) return;
    editorState.scene = null;
    editorState.scenePath = null;
    editorState.layout = null;
    editorState.layoutPath = null;
    editorState.storyScenePath = null;
    editorState.storySceneContents = null;
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

export async function assignEvidenceToHotspot(
  evidenceId: string,
  hotspotId: string | null,
) {
  if (
    !editorState.scene ||
    !editorState.storyScenePath ||
    editorState.storySceneContents === null
  ) {
    return;
  }

  const scene = editorState.scene;
  const storyScenePath = editorState.storyScenePath;
  const storySceneContents = editorState.storySceneContents;

  editorState.error = null;
  try {
    const result = updateEvidenceAssignmentInMarkdown(storySceneContents, {
      evidenceId,
      hotspotId,
    });
    if (!result.changed) return;

    await invoke("write_story_scene_file", {
      path: storyScenePath,
      contents: result.contents,
    });

    if (
      editorState.scene !== scene ||
      editorState.storyScenePath !== storyScenePath ||
      editorState.storySceneContents !== storySceneContents
    ) {
      return;
    }

    editorState.storySceneContents = result.contents;
    editorState.scene = moveEvidenceRevealInScene(scene, evidenceId, hotspotId);
  } catch (error) {
    if (
      editorState.scene !== scene ||
      editorState.storyScenePath !== storyScenePath ||
      editorState.storySceneContents !== storySceneContents
    ) {
      return;
    }

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
