import { invoke } from "@tauri-apps/api/core";
import type {
  InvestigationLayoutSidecar,
  InvestigationSceneJson,
  SceneIndex,
} from "./layout-types";

type ProjectFile = {
  path: string;
  contents: string;
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
      path: "src-tauri/resources/scenes/chapters.json",
    });
    editorState.chapters = JSON.parse(file.contents) as SceneIndex;
  } catch (error) {
    editorState.error = normalizeError(error);
  }
}

export async function loadInvestigationScene(scenePath: string) {
  editorState.error = null;
  const layoutPath = layoutPathForScene(scenePath);

  try {
    const sceneFile = await invoke<ProjectFile>("read_project_file", {
      path: scenePath,
    });
    const scene = JSON.parse(sceneFile.contents) as InvestigationSceneJson;
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
    } catch {
      editorState.layout = {
        version: 1,
        sceneId: scene.id,
        sublocations: {},
      };
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

function layoutPathForScene(scenePath: string) {
  return scenePath
    .replace("src-tauri/resources/scenes/", "docs/stories_plan/")
    .replace(/\.json$/, ".layout.json");
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Editor command failed.";
}
