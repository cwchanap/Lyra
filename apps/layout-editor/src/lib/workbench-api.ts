import { invoke } from "@tauri-apps/api/core";
import type { InvestigationLayoutSidecar } from "@lyra/scene-types";
import type { WorkbenchIndex, WorkbenchSceneBundle } from "./workbench-types";

export const loadWorkbenchIndex = () =>
  invoke<WorkbenchIndex>("load_workbench_index");

export const loadSceneBundle = (chapterId: string, sceneId: string) =>
  invoke<WorkbenchSceneBundle>("load_scene_bundle", { chapterId, sceneId });

export const loadInvestigationLayout = (chapterId: string, sceneId: string) =>
  invoke<InvestigationLayoutSidecar | null>("load_investigation_layout", {
    chapterId,
    sceneId,
  });

export const saveInvestigationLayout = (
  chapterId: string,
  sceneId: string,
  layout: InvestigationLayoutSidecar,
) => invoke<void>("save_investigation_layout", { chapterId, sceneId, layout });
