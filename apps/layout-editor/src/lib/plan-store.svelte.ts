import { normalizeError } from "./layout-store.svelte";
import { projectPlanWorkspace, type PlanWorkspace } from "./plan-workspace";
import { loadPlanWorkspace } from "./workbench-api";

export type PlanSurface = "overview" | "document";

export const planState = $state({
  workspace: null as PlanWorkspace | null,
  error: null as string | null,
  loading: false,
  surface: "overview" as PlanSurface,
  selectedDocumentId: "story-bible",
  selectedAnchor: null as string | null,
});

// One generation counter fences every in-flight load: a stale success, error,
// or finally write from a superseded refreshPlan() must never touch state.
let loadGeneration = 0;

export async function ensurePlanLoaded(): Promise<void> {
  if (planState.workspace !== null || planState.loading) return;
  await refreshPlan();
}

export async function refreshPlan(): Promise<void> {
  const generation = ++loadGeneration;
  planState.loading = true;
  planState.error = null;
  try {
    const payload = await loadPlanWorkspace();
    if (generation !== loadGeneration) return;
    const workspace = projectPlanWorkspace(payload);
    planState.workspace = workspace;
    reconcileSelection(workspace);
  } catch (error) {
    if (generation !== loadGeneration) return;
    planState.error = normalizeError(error);
  } finally {
    if (generation === loadGeneration) planState.loading = false;
  }
}

/**
 * Keeps the selection only when the refreshed workspace still owns it;
 * otherwise falls back to Story Bible / no anchor.
 */
function reconcileSelection(workspace: PlanWorkspace): void {
  const document = workspace.documents.find(
    (candidate) => candidate.id === planState.selectedDocumentId,
  );
  if (!document) {
    planState.selectedDocumentId = "story-bible";
    planState.selectedAnchor = null;
    return;
  }
  if (
    planState.selectedAnchor !== null &&
    !document.headings.some(
      (heading) => heading.anchor === planState.selectedAnchor,
    )
  ) {
    planState.selectedAnchor = null;
  }
}

export function showPlanOverview(): void {
  planState.surface = "overview";
}

export function selectPlanDocument(id: string): void {
  planState.selectedDocumentId = id;
  planState.selectedAnchor = null;
  planState.surface = "document";
}

export function selectPlanHeading(id: string, anchor: string): void {
  planState.selectedDocumentId = id;
  planState.selectedAnchor = anchor;
  planState.surface = "document";
}

/** Source actions (e.g. Aoba rows) jump straight to a document heading. */
export function navigatePlanSource(id: string, anchor: string | null): void {
  if (anchor === null) {
    selectPlanDocument(id);
    return;
  }
  selectPlanHeading(id, anchor);
}
