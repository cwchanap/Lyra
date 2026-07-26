import type {
  ASTInterrogationScene,
  ASTInvestigationScene,
  DialogueItem,
} from "./types";
import type { SceneRecord } from "./validator";

/** The canonical authored-equivalent result for an exhausted re-examination. */
export const NO_NEW_FINDINGS_DIALOGUE = [
  { kind: "action", text: "（沒有新發現。）" },
] as const;

function defaultReexamination(
  dialogue: DialogueItem[] | null | undefined,
): DialogueItem[] {
  return dialogue !== undefined && dialogue !== null && dialogue.length > 0
    ? dialogue
    : [...NO_NEW_FINDINGS_DIALOGUE];
}

function materializeInventory<
  T extends ASTInvestigationScene | ASTInterrogationScene,
>(scene: T): T {
  return {
    ...scene,
    evidenceManifest: scene.evidenceManifest.map((evidence) => ({
      ...evidence,
      onReexamine: defaultReexamination(evidence.onReexamine),
    })),
    statementManifest: scene.statementManifest.map((statement) => ({
      ...statement,
      onReexamine: defaultReexamination(statement.onReexamine),
    })),
  };
}

/**
 * Clones the parser record and materializes the four closed resumable roles.
 * Source-location fields are copied with their owning AST records, and no
 * parser-owned AST object is modified in place.
 */
export function materializeSemanticDefaults(scene: SceneRecord): SceneRecord {
  if (scene.ast.kind === "linearScene")
    return { ...scene, ast: { ...scene.ast } };

  if (scene.ast.kind === "interrogationScene") {
    return { ...scene, ast: materializeInventory(scene.ast) };
  }

  const investigation = materializeInventory(scene.ast);
  return {
    ...scene,
    ast: {
      ...investigation,
      sublocations: investigation.sublocations.map((sublocation) => ({
        ...sublocation,
        hotspots: sublocation.hotspots.map((hotspot) => ({
          ...hotspot,
          onReexamine: defaultReexamination(hotspot.onReexamine),
        })),
        characters: sublocation.characters.map((character) => ({
          ...character,
          topics: character.topics.map((topic) => ({
            ...topic,
            onReexamine: defaultReexamination(topic.onReexamine),
          })),
        })),
      })),
    },
  };
}
