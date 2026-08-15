import type {
  DialogueItem,
  InterrogationPhaseView,
  Mode,
  SceneView,
} from "$lib/state/types";

export function isInterrogationPresentationActive(
  scene: SceneView,
  mode: Mode,
): boolean {
  return (
    scene.kind === "interrogation" &&
    (mode.type === "interrogation" ||
      (mode.type === "dialogue" && mode.crossExamLineId !== null))
  );
}

export function currentInterrogationPhase(
  scene: SceneView,
): InterrogationPhaseView | null {
  if (scene.kind !== "interrogation") return null;

  return (
    scene.visiblePhases.find((phase) => phase.id === scene.currentPhaseId) ??
    null
  );
}

export function brokenQuestionProgress(phase: InterrogationPhaseView | null): {
  broken: number;
  total: number;
} {
  const total = phase?.questions.length ?? 0;
  const broken =
    phase?.questions.filter((question) => question.broken).length ?? 0;

  return { broken, total };
}

export function interrogationLineText(items: DialogueItem[]): string {
  return items
    .filter((item) => item.kind === "line" || item.kind === "action")
    .map((item) => item.text)
    .join("");
}
