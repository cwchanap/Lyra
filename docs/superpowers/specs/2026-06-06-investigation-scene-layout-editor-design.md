# Investigation Scene Layout Editor Design

**Date:** 2026-06-06
**Status:** Approved design draft

## Goal

Investigation scenes should behave like a typical detective game: the player
clicks objects and people directly on the scene instead of using text lists as
the primary interaction surface. The feature must keep story Markdown
writer-owned while giving visual layout a dedicated drag-and-resize authoring
workflow.

## Decisions

- Keep the distributed game free of editor-only code.
- Build a separate developer Tauri app for scene layout editing.
- Store layout in sidecar files beside authored investigation Markdown.
- Use compiled scene JSON as the editor's source of truth.
- Merge sidecar layout into runtime JSON during scene compilation.
- Let the game consume compiled layout only; it should not read sidecars or
  expose editor commands.

## Architecture

The long-term shape is two Tauri apps with shared contracts:

- **Game app:** the existing Lyra runtime. It consumes compiled scene JSON,
  compiled layout data, assets, and manifests. It contains no layout editor UI,
  dev routes, or filesystem write commands.
- **Editor app:** a developer-only Tauri/Svelte app. It loads compiled scene
  data, backgrounds, asset manifests, and layout sidecars; lets the developer
  drag and resize hotspots and people; then writes sidecar JSON.
- **Shared contract package:** when the repo moves toward a monorepo, shared
  layout schema, scene target types, normalized-coordinate helpers, and asset
  path helpers should live outside either app.

The current repo can adopt the contract incrementally before a full monorepo
split. The first implementation should add sidecar validation and game
consumption, then add the editor app as the dedicated authoring surface.

## Layout Sidecar Contract

Each investigation scene may have one sidecar file:

```text
docs/stories_plan/chapter_1/investigation_scene_3.md
docs/stories_plan/chapter_1/investigation_scene_3.layout.json
```

The sidecar is editor-owned and keyed by sublocation ID:

```json
{
  "version": 1,
  "sceneId": "investigation_scene_3",
  "sublocations": {
    "cafe_counter": {
      "hotspots": {
        "receipt": {
          "kind": "rect",
          "x": 0.42,
          "y": 0.58,
          "w": 0.08,
          "h": 0.05
        }
      },
      "characters": {
        "hayasaka_akane": {
          "kind": "sprite",
          "assetId": "portrait.hayasaka_akane.standard",
          "x": 0.72,
          "y": 0.16,
          "w": 0.18,
          "h": 0.72,
          "anchor": "bottomCenter"
        }
      }
    }
  }
}
```

Coordinates are normalized to the background plate, not viewport pixels. The
game maps them onto the rendered background so the same layout works across
desktop window sizes.

## Compiler Merge And Validation

The scene compiler reads the Markdown scene and optional sidecar, validates the
sidecar against the parsed scene, then emits runtime JSON with layout attached
to sublocation hotspots and characters.

Validation rules:

- `sceneId` must match the investigation scene ID.
- Every sidecar sublocation key must exist in the scene.
- Every hotspot key must exist in that sublocation.
- Every character key must exist in that sublocation.
- `x`, `y`, `w`, and `h` must be finite normalized numbers.
- Rectangles must have positive size and remain within sensible normalized
  bounds.
- Character sprite asset IDs must resolve through the existing portrait asset
  path convention and asset manifest.
- If a sidecar exists, malformed layout is a compile error.
- Missing layout entries are allowed during transition. Missing hotspots or
  characters fall back to the text interface until placed.

The authoring Markdown remains minimal: dialogue, scene tags, story metadata,
hotspots, characters, evidence, statements, and unlock/reveal logic. Layout
coordinates do not belong in Markdown.

## Editor Workflow

The editor uses compiled scene JSON as the source of truth, not Markdown:

1. Run or trigger `bun run scenes:compile`.
2. Load `apps/game/src-tauri/resources/scenes/chapters.json`.
3. Load the selected investigation scene JSON.
4. Load the generated asset manifest and existing sidecar if present.
5. Show one sublocation at a time over its resolved background asset.
6. Show all compiled visible targets for that sublocation:
   - hotspots as draggable and resizable hit rectangles;
   - characters as draggable and resizable transparent portrait sprites.
7. Save sidecar JSON beside the authored investigation Markdown.
8. Recompile to merge layout into runtime scene JSON.

Background prompts should include clue objects that are meant to be clicked.
Those environmental objects are baked into the background image; the sidecar
defines hit regions over them. People should use separate transparent portrait
or scene-sprite assets so they remain movable and reusable.

## Game Runtime And UI

The game receives layout only through compiled runtime data. Explore mode
renders a layered scene surface:

1. current sublocation background;
2. placed character sprites;
3. hotspot hit regions;
4. hover and focus affordances for placed targets;
5. dialogue box when a click triggers investigation or topic dialogue;
6. text fallback panels for unplaced targets and accessibility.

Interaction behavior:

- Clicking a placed hotspot calls the existing `inspect_hotspot(hotspotId)`.
- Clicking a placed character opens a compact topic picker for that character.
- Selecting a topic calls the existing `interview_topic(characterId, topicId)`.
- Rust remains authoritative for locked and hidden targets. Targets filtered out
  of the view are not rendered.
- In-flight actions and active dialogue disable scene clicks.

The existing text lists should not disappear immediately. During migration they
act as fallback for unplaced targets and as an accessibility path. Once all
targets in a scene are placed, the visual scene surface becomes the primary
interaction model.

## Error Handling

Compiler errors should name the sidecar file, scene ID, sublocation ID, and
target ID when possible. Runtime should treat compiled layout as trusted, but
the frontend should still tolerate missing image files with the existing
placeholder strategy.

The editor should prevent invalid writes where practical: clamp coordinates,
prevent zero-size regions, and warn before saving layout for targets that no
longer exist in compiled scene data.

## Testing And Verification

Focused verification should cover:

- sidecar parser and validator tests in the scene compiler;
- compiler merge tests proving layout appears in emitted investigation JSON;
- Rust serde/view tests for hotspot and character layout fields;
- Svelte component tests for normalized coordinate mapping and fallback
  behavior;
- a browser-safe smoke test that clicks a placed hotspot through the visual
  scene surface;
- `bun run scenes:compile`, focused Vitest coverage, and `bun run check` before
  claiming frontend/runtime work complete.

## Non-Goals

- Bundling editor UI or write commands into the production game.
- Adopting Phaser or Phaser Editor as the layout source of truth.
- Moving all Lyra code into a monorepo in the first implementation.
- Authoring layout coordinates in investigation Markdown.
- Generating exact art automatically from layout files. The sidecar aligns hit
  regions and sprites after assets exist or placeholders are visible.
