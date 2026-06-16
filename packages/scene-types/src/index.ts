// =============================================================================
// packages/scene-types/src/index.ts
//
// Single source of truth for the scene-graph wire types shared between the
// compile pipeline (scripts/compile-scenes) and the layout editor
// (apps/layout-editor). Every type here is a value-type that is byte-identical
// on both sides and part of the emitted JSON contract — sharing it prevents
// silent drift (e.g. a fourth EvidenceSource variant compiling cleanly on one
// side and failing on the other).
//
// Deliberately NOT shared here:
//   - DialogueItem: the editor keeps a simplified rendering view (no assetCue,
//     simplified portrait, no expression) that is intentionally narrower than
//     the compiler's full AST/JSON DialogueItem. Merging would couple them.
//
// Consumers re-export these under their own preferred names where helpful:
//   - scripts/compile-scenes/types.ts        → ChaptersIndex as JSONChaptersIndex
//   - apps/layout-editor/src/lib/layout-types.ts → ChaptersIndex as SceneIndex
// =============================================================================

/**
 * How the in-scene source of a piece of evidence is presented before the
 * player inspects it. Authored on `Evidence Source:` hotspot metadata.
 */
export type EvidenceSource = "visible" | "implied" | "hidden";

/** Axis-aligned rectangle hotspot layout, in scene coordinates. */
export type RectLayout = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Anchored sprite (character standee) layout, in scene coordinates. */
export type SpriteLayout = {
  kind: "sprite";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: "bottomCenter";
};

/**
 * What a hotspot/character/topic/sublocation reveal can resolve to. The union
 * is identical for compiler AST/JSON and the editor's JSON view.
 */
export type RevealTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "topic"; characterId: string; topicId: string }
  | { kind: "hotspot"; id: string }
  | { kind: "sublocation"; id: string };

/** Author-checked-in layout sidecar for an investigation scene. */
export type InvestigationLayoutSidecar = {
  version: 1;
  sceneId: string;
  sublocations: Record<
    string,
    {
      hotspots: Record<string, RectLayout>;
      characters: Record<string, SpriteLayout>;
    }
  >;
};

/**
 * Top-level chapters index (`chapters.json`) written by the compiler and read
 * by both the runtime engine and the editor.
 */
export type ChaptersIndex = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: Array<{
      type: "linear" | "investigation" | "interrogation";
      file: string;
    }>;
  }>;
};
