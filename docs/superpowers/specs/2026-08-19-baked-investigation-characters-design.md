# Baked Investigation Characters Design

**Date:** 2026-08-19  
**Status:** Approved  
**Scope:** Chapter 1 investigation scenes with placed character standees

## Context

Investigation scenes currently render character standees over separately authored
backgrounds. The standee layout is expressed as a normalized rectangle, but it
does not share the background's perspective, furniture scale, occlusion, or
lighting. This makes characters appear implausibly large or small—for example,
a standing character can read as the same height as a nearby table even when
the scene prose places them seated behind it.

An approved visual spike for Chapter 1 Investigation Scene 9 demonstrated that
baking 北見修一 into the interview-room background produces materially better
scale, posture, lighting, and table occlusion. The character must remain an
interactive investigation target, so productionizing the approach requires a
layout contract that separates interaction geometry from sprite rendering.

The same audit also found that 神谷澪 and 早坂茜 are visually too similar. The
asset-generation guidance needs durable identity constraints so every portrait
character has a distinct silhouette, face and hair treatment, outfit, palette,
and identifying prop.

## Goals

- Bake all placed Chapter 1 investigation characters into their backgrounds at
  perspective-correct scale.
- Keep every baked character independently clickable, hoverable, and accessible.
- Preserve the existing sprite layout path for scenes and tools that still need
  separately rendered standees.
- Keep evidence props and hotspot interaction regions readable and unobscured.
- Give all portrait-mode characters durable, mutually distinct visual identities.
- Make 神谷澪 immediately distinguishable from 早坂茜 in face, silhouette,
  hairstyle, outfit, palette, and accessories.
- Preserve exact production background dimensions and semantic asset IDs.

## Non-goals

- Removing standee support from the runtime, compiler, editor, or asset catalog.
- Baking non-interactive dialogue portraits into scene backgrounds.
- Changing investigation dialogue, evidence semantics, or progression.
- Redesigning investigation hotspot geometry beyond adjustments required to keep
  interactions aligned with regenerated imagery.
- Regenerating portraits that already pass the visual-identity audit.

## Considered Approaches

### 1. Add a baked character layout variant (selected)

Add a semantic `kind: "baked"` layout containing only normalized interaction
geometry. The compiler emits it, the runtime renders an interactive target
without an image, and the editor displays and edits the region over the baked
background.

This accurately represents authored intent and avoids loading or registering an
unused standee asset.

### 2. Add a visibility flag to sprite layouts

An optional flag could suppress the sprite while retaining the existing
`assetId`. This minimizes type changes but leaves a misleading, unused asset
reference and couples interaction-only geometry to sprite semantics.

### 3. Use transparent standee images

Transparent placeholder sprites would avoid a schema change, but they hide the
intent, keep unnecessary asset work in the pipeline, and make missing or stale
art harder to diagnose. This approach is rejected.

## Layout Contract

Character layout becomes an additive tagged union:

```ts
type CharacterLayout = SpriteLayout | BakedCharacterLayout;

type BakedCharacterLayout = {
  kind: "baked";
  x: number;
  y: number;
  w: number;
  h: number;
};
```

`SpriteLayout` remains unchanged. A baked layout has no `assetId` or `anchor`
because the background owns the pixels and the rectangle owns only interaction
geometry. The sidecar format remains version 1 because this is an additive
variant and existing files retain their meaning.

The compiler will:

- accept normalized finite geometry for `kind: "baked"`;
- reject missing or invalid geometry;
- emit the tagged variant unchanged;
- avoid registering standee, portrait, evidence, or background references from
  a baked character layout;
- preserve current validation and enrichment behavior for `kind: "sprite"`.

The Rust schema and frontend view types will mirror the tagged union. The
runtime will render the same semantic button, label, hover highlight, dialog
state, and disabled behavior for both variants. Only sprite layouts resolve and
render an image. Baked layouts render the interaction treatment over pixels
already present in the background.

The layout editor will render a visibly identified baked interaction region over
the background. Users can select, move, and resize it using the existing
normalized geometry controls. Sprite-specific asset preview and alpha-crop work
will run only for sprite layouts.

## Scene and Asset Scope

Seven production backgrounds will contain baked characters:

| Scene | Sublocation / background | Baked character(s) |
| --- | --- | --- |
| Investigation 1 | `office` | 早坂茜 |
| Investigation 3 | `front` | 店長高瀨, 片瀨美咲 |
| Investigation 7 | `back_door` | 黑瀨徹 |
| Investigation 7 | `inner` | 黑瀨徹 |
| Investigation 8 | `office_corner` | 店長高瀨 |
| Investigation 8 | `fixed_panel` | 黑瀨徹 |
| Investigation 9 | `confront_kitami` | 北見修一 |

These correspond to eight independently editable and clickable character
regions. Existing background asset IDs and paths remain stable, and each final
PNG remains exactly 1920×1080.

Each image will be produced as an edit of its existing background. Generation
must preserve the room geometry, lighting direction, evidence props, and visual
landmarks used by hotspots. Character scale, posture, depth, and occlusion will
follow scene prose and furniture perspective rather than the old standee box.

For repeated characters, the same visual identity and outfit will be used across
all appearances. Scene 3's two characters must remain visually separated and
independently clickable. No face, hand, clothing, or accessory may cover an
evidence prop or materially reduce hotspot readability.

## Character Identity Contract

`docs/stories_plan/characters.md` will gain a visual-identity matrix for all 13
portrait-mode characters. Each entry defines:

- silhouette, build, and posture;
- face shape and hair treatment;
- signature outfit and palette;
- identifying prop or accessory;
- explicit contrasts with the most visually similar character.

Matching `visualPrompt` guidance in
`static/assets/config/characters.yaml` will encode the same constraints for
future generation.

The current 早坂茜 design remains the practical defense-attorney anchor: sturdy
grounded build, practical navy structured jacket over a casual off-white inner
layer, looser tied hair, warm leather document bag, and a direct procedural
stance.

神谷澪 will be regenerated with a distinct prosecutor identity: lean angular
silhouette and face, sharply controlled tied-back hair, cool graphite longline
or double-breasted suit with precise lapels, high-neck ivory blouse, restrained
silver accent, rigid vertical posture, and no document bag. The result must not
reuse 早坂's facial structure, warm palette, casual inner layer, practical
silhouette, or accessories.

Portraits that already pass the identity audit will not be regenerated merely
for stylistic churn. Their documented identity and generation prompts will be
strengthened so later expressions remain consistent.

## Failure Handling

Generated candidates are audit artifacts until they pass visual inspection.
Production backgrounds will not be replaced by a candidate that:

- changes important room geometry or removes a visual landmark;
- obscures evidence or makes a hotspot misleading;
- places a character at implausible scale, depth, posture, or occlusion;
- drifts from the character's documented outfit and identity;
- makes one character resemble another;
- introduces inconsistent facial features or clothing across repeated scenes;
- changes the 1920×1080 output contract.

Rejected candidates will be regenerated or edited while the current production
asset remains available in version control.

## Verification

Automated coverage will include:

- compiler parsing tests for valid and invalid baked layouts;
- emitter tests for the baked JSON shape;
- asset-enrichment tests proving baked layouts register no sprite asset;
- Rust schema deserialization tests for the new variant;
- runtime component tests proving baked characters remain interactive while no
  portrait or standee is resolved or rendered;
- editor geometry, store, and canvas tests proving baked regions remain
  selectable, movable, resizable, and visible over the background.

The final verification set will run focused tests first, followed by scene
compilation, script type-checking, frontend checks, relevant Rust tests, and the
broader test set appropriate to the touched packages.

Visual QA will produce a contact sheet and interaction-region overlays for all
seven backgrounds. Each image will be checked for identity, outfit continuity,
perspective, evidence visibility, interaction alignment, and exact dimensions.

## Migration and Compatibility

All eight in-scope character placements will migrate from `kind: "sprite"` to
`kind: "baked"`. Existing sprite layouts elsewhere continue to compile and
render unchanged. Standee assets remain valid catalog content for other uses;
the migration does not delete them.

The corrected 北見修一 standee retains his canonical thin metal-frame glasses
and consistent office-worker outfit even though the migrated investigation
placement no longer renders it. This keeps the reusable character asset aligned
with scene canon.
