import { invoke } from "@tauri-apps/api/core";
import type { AiReviewTransportPayload } from "./ai-review";
import type { InvestigationLayoutSidecar } from "@lyra/scene-types";
import type {
  ApplyWorkbenchSourceEditRequest,
  ApplyWorkbenchSourceEditResult,
  FocusedEditSourceDocument,
  SourceDocumentId,
} from "./focused-edit";
import type {
  WorkbenchAssetWorkspacePayload,
  WorkbenchIndex,
  WorkbenchPlanWorkspacePayload,
  WorkbenchSceneBundle,
} from "./workbench-types";

export const loadWorkbenchIndex = () =>
  invoke<WorkbenchIndex>("load_workbench_index");

export const loadPlanWorkspace = () =>
  invoke<WorkbenchPlanWorkspacePayload>("load_plan_workspace");

export const loadSceneBundle = (chapterId: string, sceneId: string) =>
  invoke<WorkbenchSceneBundle>("load_scene_bundle", { chapterId, sceneId });

export const loadAssetWorkspace = () =>
  invoke<WorkbenchAssetWorkspacePayload>("load_asset_workspace");

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

export const loadWorkbenchSourceDocument = (
  sourceDocumentId: SourceDocumentId,
) =>
  invoke<FocusedEditSourceDocument>("load_workbench_source_document", {
    sourceDocumentId,
  });

export const applyWorkbenchSourceEdit = (
  request: ApplyWorkbenchSourceEditRequest,
) =>
  invoke<ApplyWorkbenchSourceEditResult>("apply_workbench_source_edit", {
    request,
  });

/**
 * Native AI review transport. No provider key exists anywhere in Lyra: the
 * webview sends only the TS-built model-semantic payload, the native side
 * shells out to the configured review agent CLI (default `claude`, no key
 * crosses IPC), and the webview receives only the parsed result/error data.
 */
export const runAiReview = (payload: AiReviewTransportPayload) =>
  invoke<unknown>("run_ai_review", { payload });
