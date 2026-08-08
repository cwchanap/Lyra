// =============================================================================
// packages/scene-types/src/index.ts
//
// Single source of truth for the byte-identical scene-graph subset shared
// between the compile pipeline (packages/scripts/compile-scenes) and the
// layout editor (apps/layout-editor). It does not own the full runtime scene
// JSON; every type here is a value-type needed on both sides of this subset,
// preventing silent drift (e.g. a fourth EvidenceSource variant compiling
// cleanly on one side and failing on the other).
//
// Deliberately NOT shared here:
//   - DialogueItem: the editor keeps a simplified rendering view (no assetCue,
//     simplified portrait, no expression) that is intentionally narrower than
//     the compiler's full AST/JSON DialogueItem. Merging would couple them.
//
// Consumers re-export these under their own preferred names where helpful:
//   - packages/scripts/compile-scenes/types.ts        → ChaptersIndex as JSONChaptersIndex
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
  /**
   * A tutorial-only card kept outside the global Case File. Practice cards
   * are scoped by compiler validation to one downstream analysis board.
   */
  | { kind: "practice"; id: string }
  | { kind: "topic"; characterId: string; topicId: string }
  | { kind: "hotspot"; id: string }
  | { kind: "sublocation"; id: string };

/**
 * A pair of hotspot IDs within one sublocation whose rect overlap the author
 * has declared intentional (e.g. a deliberately layered/nested target). The
 * compiler's `layoutHotspotOverlap` warning is suppressed for listed pairs so
 * the warning keeps signal for unintentional overlaps. Both IDs must exist in
 * the same sublocation's `hotspots`; the pair is unordered.
 */
export type IntentionalHotspotOverlap = {
  hotspots: readonly [string, string];
};

/** Author-checked-in layout sidecar for an investigation scene. */
export type InvestigationLayoutSidecar = {
  version: 1;
  sceneId: string;
  sublocations: Record<
    string,
    {
      hotspots: Record<string, RectLayout>;
      characters: Record<string, SpriteLayout>;
      intentionalOverlaps?: ReadonlyArray<IntentionalHotspotOverlap>;
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
      type: "linear" | "investigation" | "interrogation" | "analysis";
      file: string;
    }>;
  }>;
};
