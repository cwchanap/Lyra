import { invoke } from "@tauri-apps/api/core";
import type { InvestigationLayoutSidecar } from "@lyra/scene-types";
import type { WorkbenchIndex, WorkbenchSceneBundle } from "./workbench-types";

/**
 * Loads the workbench chapter and scene index via Tauri IPC.
 */
export const loadWorkbenchIndex = () =>
  invoke<WorkbenchIndex>("load_workbench_index");

/**
 * Loads a compiled scene bundle via Tauri IPC.
 */
export const loadSceneBundle = (chapterId: string, sceneId: string) =>
  invoke<WorkbenchSceneBundle>("load_scene_bundle", { chapterId, sceneId });

/**
 * Loads an investigation scene layout sidecar via Tauri IPC, returning null if not found.
 */
export const loadInvestigationLayout = (chapterId: string, sceneId: string) =>
  invoke<InvestigationLayoutSidecar | null>("load_investigation_layout", {
    chapterId,
    sceneId,
  });

/**
 * Saves an investigation scene layout sidecar via Tauri IPC.
 */
export const saveInvestigationLayout = (
  chapterId: string,
  sceneId: string,
  layout: InvestigationLayoutSidecar,
) => invoke<void>("save_investigation_layout", { chapterId, sceneId, layout });
