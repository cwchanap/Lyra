# Analysis and Interrogation Mockup Conformance Design

**Date:** 2026-08-17  
**Review revision:** 2026-08-18  
**Status:** Proposed  
**Validated against:** `main` at `9b9640c38a4eb5f91c1333f3984b3029947e3926`

## Design sources of truth

The supplied handoffs remain the visual references for this correction:

- `Analysis Workbench v3.dc.html`
- `Interrogation Redesign.dc.html`
- their supplied preview images

The shipped HPA-621 Analysis workbench and Interrogation redesign remain the behavioral baseline. This slice corrects visual composition, layout ownership, and the minimum presentation-data gap required by the handoffs. It does not replace the current gameplay architecture.

## Problem

The two scenes diverge for different reasons.

### Analysis

The Analysis architecture is already the right shape:

- `GameShell` owns the fitted presentation viewport;
- `AnalysisWorkbench` owns rail/header/workspace/footer;
- board components own board-local interaction only;
- Rust owns answer checking and completion;
- direct manipulation, semantic fallbacks, focus, persistence, and authored Result Dialogue already work.

The remaining mismatch is visual:

- the desktop rail flexes instead of matching 248px;
- board content is not capped at the handoff's 960px working area;
- Classify and Order use different visual ratios;
- cards and panels use a separate hard-coded blue-grey language instead of Lyra's noir typography/tokens;
- record cards lack the clipped silhouette and strong status markers from the handoff;
- semantic fallback controls are visually as prominent as the direct-manipulation workflow.

This is a frontend conformance gap, not a runtime/state-model problem.

### Interrogation

The shipped Interrogation flow is behaviorally correct, but the visual composition is split across independent owners:

- `GameShell` owns a fixed objective HUD;
- `InterrogationStage` owns a separate subject/progress row;
- `InterrogationView` owns the question record;
- `DialogueBox` owns a viewport-fixed dialogue frame, per-line portrait, LOG, advance, and challenge controls;
- `SceneBackdrop` is instantiated separately by the dialogue and interrogation branches;
- `InterrogationEvidenceTray` owns Present.

The handoff instead reads as one continuous scene canvas: one backdrop, one subject/speaker art layer, one compact HUD, one bottom interaction spine, a taller testimony panel, a large external rebut control, and a wider Present tray.

There are four non-CSS gaps:

1. `isInterrogationPresentationActive()` currently stays active for dialogue only when `crossExamLineId` is present, so intro/bridge/result/outro dialogue can flash normal chapter chrome;
2. `SubjectView` has no compiler-owned subject portrait reference;
3. a subject-standard-only stage would suppress the shipped per-line speaker portrait behavior for roughly half of Chapter 1 Interrogation dialogue;
4. a new `CrossfadeImage` inside the save-thumbnail root must participate in the existing direct asset-composition contract, or save thumbnails can rasterize/settle it incorrectly.

## Goals

1. Match Analysis v3 composition closely at the existing desktop target.
2. Make Interrogation one continuous stage-owned visual composition across menu, same-scene dialogue, testimony, Present, result dialogue, and phase transitions.
3. Add one compiler-owned, manifest-visible fallback portrait to `SubjectView` without new writer syntax or raster requirements.
4. Preserve current per-line dialogue speaker/expression behavior by moving that behavior into the stage art while Interrogation presentation is active.
5. Preserve save-thumbnail composition for the new stage portrait.
6. Pin small packaged geometry invariants so behavior-only tests cannot hide another layout drift.
7. Deliver the complete Analysis + Interrogation conformance slice in **one implementation PR**, using an internal Interrogation checkpoint before Analysis visual work rather than separate PR boundaries.

## Non-goals

- No Analysis Rust evaluator, draft, action-token, command, save, or schema changes.
- No Interrogation state-machine, contradiction, completion, command, or save changes.
- No new standee family or raster generation requirement.
- No frontend subject-ID alias map.
- No writer-facing portrait/standee metadata.
- No generic layout/HUD framework.
- No third-party UI dependency.
- No screenshot-diff framework or committed raster baselines.
- No replacement Case File.
- No Present browse/preview/confirmation state.
- No client-derived correctness, composure, health, or verdict mechanics.
- No Chapter 1 story/content rewrite.
- No infrastructure-only or Analysis-follow-up PR for this planned slice.

## Visual conformance contract

The handoffs are binding for composition and hierarchy, not prototype implementation details.

### Analysis desktop contract

At a CSS viewport **at least** 1280×720:

| Surface | Contract |
| --- | --- |
| Workbench | fills `GameShell > main` without body scrolling |
| Analysis rail | 248px wide, full-height, independently scrollable if needed |
| Board content | centered, max 960px |
| Classify | pool / groups ratio approximately 1 : 1.4 |
| Order | timeline / pending ratio approximately 1.3 : 1 |
| Threshold | responsive card grid, 240px minimum column |
| Cards | clipped detective-record silhouette |
| Typography | Lyra display / impact / serif tokens visibly used |
| Accent language | crimson/cyan scene emphasis; Analysis blue stays a scoped information accent |
| Fallback controls | visible, keyboard-accessible, visually secondary |
| Footer | utilities/feedback/submit remain reachable at 720px height |

The Analysis rail stays Analysis-specific. It does not become another Case File surface.

### Interrogation desktop contract

At a CSS viewport **at least** 1280×720, with 1280×800 as a secondary manual comparison:

| Surface | Contract |
| --- | --- |
| Stage | `.interrogation-stage.active` fills `GameShell > main` and is the only fitted Interrogation containing block |
| Backdrop | one stage-owned `SceneBackdrop` instance survives menu ↔ dialogue mode flips |
| Character art | stage-owned portrait layer, lower than HUD/interaction, visually near full-height |
| Character choice | current dialogue line portrait when available; otherwise current phase subject's compiled `standard` portrait |
| Art crop | non-transparent alpha bounds are bottom/left anchored; transparent padding is not treated as the visible silhouette |
| Left HUD | objective + subject/role/progress in one coordinated stack |
| Right HUD | compact Case File action; no duplicate fixed shell objective |
| Question record | stage-absolute, bottom-centered, max 1000px |
| Dialogue frame | stage-absolute, bottom-centered, max 1000px |
| Shared bottom spine | question/dialogue records use the same containing block and ~28px bottom inset |
| Dialogue panel | minimum 196px high |
| Rebut control | approximately 128×128px, outside clipped panel |
| Present tray | max 900px, existing Present-only semantics |
| Continuity | same-scene dialogue never flashes normal chapter chrome or refades the backdrop from empty |

Below the existing 720px compact breakpoint, art may lower opacity/hide and controls may stack, but actions must remain visible and focusable.

## Production behavior that remains authoritative

| Prototype idea | Production decision |
| --- | --- |
| Analysis sample evaluator | Rust remains authoritative |
| HTML5 drag-and-drop | existing Pointer Events + semantic fallbacks |
| Analysis result modal | authored Result Dialogue |
| Interrogation evidence browser | existing `GameShell` Case File |
| Present select/confirm state | immediate engine callback |
| Prototype composure | existing broken / total progress |
| Prototype verdict logic | engine-authored dialogue |
| second atmosphere system | no; reuse current atmosphere/backdrop |

## Compiler-owned subject portrait

Extend Interrogation subject data with one immutable presentation field:

```ts
type SubjectView = {
  id: string;
  name: string;
  role: string;
  bio: string;
  portrait: PortraitRef | null;
};
```

No new writer syntax is introduced.

Pipeline:

1. parser creates `ASTSubject.portrait = null`;
2. asset enrichment resolves `subject.name` via the existing `characters.yaml` display-name map;
3. it selects `standard`;
4. the existing successful portrait-registration path adds `portrait.<characterId>.standard` to scene refs and the manifest;
5. emitter writes it into compiled Interrogation JSON;
6. Rust `SubjectJson` loads it as `Option<PortraitRefJson>`;
7. Rust `SubjectView` forwards the same `PortraitRefJson`;
8. TypeScript mirrors it as `PortraitRef | null`.

Do not add `#[serde(default)]` to the new compiler-owned field. Generated scene resources are rebuilt from source; stale JSON should fail loudly in this pre-1.0 project.

### Asset-enrichment seam

Do not build a helper that accepts error-code strings.

`enrichLine()` keeps its existing dialogue-specific validation and error codes. Extract only the successful operation that registers/returns a `PortraitRef` after the caller has already resolved a character/expression.

Subject enrichment performs its own narrow validation and uses one subject-specific error code, `assetUnknownInterrogationSubject`, for unresolved subject identity or missing required standard portrait.

`stripPhase()` explicitly sets `subject.portrait = null` when assets are disabled.

## Stage character-art policy

The compiler-owned subject portrait is a **fallback**, not a replacement for current dialogue portraits.

`InterrogationStage` derives the active art reference as:

```ts
mode.type === "dialogue" &&
mode.current.kind === "line" &&
mode.current.portrait !== null
  ? mode.current.portrait
  : phase?.subject.portrait ?? null
```

Consequences:

- subject testimony keeps authored expression changes;
- 相馬律 / 早坂茜 / 黑瀨徹 dialogue shows the actual current speaker instead of leaving the witness on screen;
- action/narration/portraitless dialogue falls back to the current phase subject standard;
- `DialogueBox` can suppress its own portrait during Interrogation presentation without losing speaker identity;
- ordinary non-Interrogation `DialogueBox` remains unchanged.

No second speaker/portrait state model is introduced; this simply reuses `Mode.Dialogue.current.portrait` that already drives `DialogueBox` today.

## Alpha crop and anchor

Portrait policy assets are 768×1024 transparent half-body images, so scaling the raw rectangle to near-full-height would make transparent padding part of the layout and can visibly misalign the character.

Reuse the existing shared helpers:

- `alphaBoundsFromImageData`
- `cropVariablesForAlphaBounds`

`InterrogationSubjectArt` computes alpha bounds on image load, then positions/scales the actual `<img>` so the **visible alpha silhouette** is bottom/left anchored to the stage art target. Do not invent a second crop utility.

The crop implementation must keep the role-tagged `<img>`'s own `getBoundingClientRect()` representative of the final transformed image, because save-thumbnail direct composition maps that rectangle back to the thumbnail canvas.

No new full-body standee is required in this slice.

## Save-thumbnail contract

`CrossfadeImage` always emits `data-save-crossfade-layer`. The thumbnail pipeline waits for current crossfade winners before capture. It also treats `data-save-thumbnail-asset-role="background|portrait"` specially: role-tagged assets are excluded from the DOM SVG snapshot and then composited as real image layers.

Therefore the stage art's `CrossfadeImage` must include:

```ts
dataAttributes={{
  "save-thumbnail-asset-role": "portrait",
}}
```

and its image class includes `portrait` plus an Interrogation-specific class so the existing capture-proof portrait selectors can continue to observe it.

This is a shipped save-feature contract, not decorative metadata.

Focused unit coverage belongs in `thumbnail-capture.test.ts`, and packaged proof belongs in the existing `capture-proof` suite. The packaged proof should capture a question/testimony state, not rely on the Present tray being part of thumbnails.

## Interrogation presentation lifetime

Use the same scene-owned dialogue rule as Analysis:

```ts
scene.kind === "interrogation" &&
  (mode.type === "interrogation" ||
    (mode.type === "dialogue" && mode.queueToken.sceneId === scene.id))
```

Do not key lifetime to `crossExamLineId`.

This covers intro, phase entry, testimony, challenge lead-in, wrong/correct response, phase transition, and same-scene outro dialogue.

## Existing wrapper constraint

`InterrogationStage` already wraps the complete gameplay mode chain, including Analysis. New full-height/absolute rules must therefore be scoped to `.interrogation-stage.active` or the direct `.shell.interrogation-presentation > main > .interrogation-stage.active` relation.

Never key Interrogation fitting to `data-interrogation-mode="interrogation"`; same-scene dialogue reports `mode.type === "dialogue"`.

The inactive wrapper remains harmless for Explore, Analysis, Game Complete, and ordinary dialogue.

## GameShell ownership

`GameShell` continues to own:

- `GameAtmosphere`;
- Game Menu;
- Case File submenu;
- persistence/top-layer UI;
- Escape routing;
- inert state.

It gains `interrogation-presentation` beside `analysis-presentation` so shell/main become fitted. It removes the separate fixed `.interrogation-objective`; the current primary objective is passed to `InterrogationStage` and rendered once there.

## Stage-owned backdrop

While Interrogation presentation is active, `InterrogationStage` owns exactly one `SceneBackdrop` instance outside the mode-specific child branch.

It derives backdrop props from the current mode:

- dialogue: `sceneTag` + `backgroundAssetId` from `Mode.Dialogue`;
- interrogation menu: `sceneTag = null` + `backgroundAssetId` from `Mode.Interrogation`.

The same component instance receives prop updates across mode flips, allowing `CrossfadeImage` to preserve/crossfade the current background instead of remounting from empty.

Outside active Interrogation presentation, the existing page-level backdrop paths remain for ordinary dialogue and Analysis. Do not globally rewrite backdrop ownership for unrelated modes.

## InterrogationStage ownership

`.interrogation-stage.active` is the single Interrogation layout containing block. It owns:

- stage-owned `SceneBackdrop`;
- stage character art;
- objective / subject / phase / progress HUD;
- Case File action;
- the coordinate system for question/testimony surfaces;
- engine-owned Present tray;
- Present focus-return bookkeeping.

It remains a visual scaffold, not a state machine.

## InterrogationView

`InterrogationView` remains phase-menu-only:

- current questions;
- broken states;
- `onAsk(questionId)`;
- runtime-gated `完成訊問`;
- no-current-phase copy.

Its root becomes the stage-absolute bottom question record. It gains no objective, portrait, inventory, or browse state.

## DialogueBox

`DialogueBox` keeps queue/typewriter/history/advance/challenge/withdraw behavior.

It gains `interrogationStageActive?: boolean`.

Ordinary path:

- wrapper remains `position: fixed` exactly as today;
- portrait resolver/crossfade remains unchanged.

Interrogation path:

- wrapper switches to `position: absolute`;
- nearest positioned ancestor is `.interrogation-stage.active`;
- width uses `min(1000px, calc(100% - 56px))`;
- bottom is 28px, matching `InterrogationView`;
- component-owned portrait is suppressed because stage art now follows `mode.current.portrait`;
- panel min-height is 196px;
- existing `xexam-challenge` becomes the external 128px ring;
- `退下`, LOG, advance, hold/click/keyboard/programmatic semantics remain unchanged.

History remains an overlay concern. Its current fixed overlay may remain as long as the fitted stage shares the viewport bottom and existing focus/Escape behavior stays intact.

## InterrogationEvidenceTray

Present lifecycle stays engine-owned. Only presentation changes:

- max desktop width 900px;
- denser record grid;
- existing evidence imagery/statement seals;
- current testimony target remains visible;
- existing focus trap, Escape claim, top-layer suspension, Game Menu, `收回`, and direct engine callbacks remain.

No preview pane or confirm step.

## Analysis presentation

`AnalysisWorkbench` stays the owner of navigation, heading, focus reconciliation, utility/footer actions, feedback, and submit.

Use scoped Analysis variables at the workbench root while reusing global Lyra tokens for scene identity and typography.

Desktop geometry:

- workbench columns: `248px minmax(0, 1fr)`;
- board content frame: `min(960px, 100%)`;
- Classify: `1fr 1.4fr`;
- Order: `1.3fr 1fr`;
- Threshold: `repeat(auto-fill, minmax(240px, 1fr))`;
- cards gain clipped record geometry;
- fallback buttons remain native/visible but visually secondary.

No draft transform, drop-target ID, focus key, visible label, or callback signature changes.

### Analysis wrapper selector normalization

The current Analysis shell rule targets the shared wrapper with `data-interrogation-mode="analysis"`. Do not copy that data-mode idiom into new code.

Because `active` is specifically the Interrogation presentation flag, **do not literally use `.active` for Analysis**. During the Analysis tasks, normalize the existing rule to the shell-owned structural context:

```css
.shell.analysis-presentation
  > main
  > :global(.interrogation-stage) { ... }
```

`analysis-presentation` already proves the context; the extra mode data attribute is unnecessary. This removes the mixed idiom without changing `InterrogationStage.active` semantics.

## Accessibility and responsive behavior

- Existing native controls/ARIA labels remain.
- Character art is decorative and `aria-hidden`; speaker/subject text remains semantic.
- Art layers never receive pointer events or focus.
- Present retains focus trap/`claimEscape`.
- `prefers-reduced-motion` remains respected by Crossfade/charge behavior.
- At ≤720px, art may fade/hide, HUD stacks, the rebut ring moves below the panel, and record grids collapse without clipping actions.

## Verification strategy

### Focused unit/component tests

Prove:

- compiler subject portrait is manifest-visible and stripped to null when assets are disabled;
- Rust public wire forwards `PortraitRefJson` without save changes;
- same-scene Interrogation dialogue remains presentation-active;
- objective appears once;
- stage backdrop survives mode rerender without a new component instance;
- stage art prefers current dialogue portrait and falls back to subject standard;
- stage art applies alpha-crop variables and carries `data-save-thumbnail-asset-role="portrait"`;
- thumbnail capture excludes the role-tagged art from the DOM SVG and treats it as a portrait asset layer;
- DialogueBox ordinary portrait behavior is unchanged and Interrogation portrait duplication is suppressed;
- Present callbacks/focus/Escape remain;
- Analysis interaction/focus/draft behavior remains.

### Packaged geometry

Reuse `analysis-beat85.e2e.ts` and `ensureCaseFileViewport()`.

Important: `ensureCaseFileViewport()` guarantees **at least** 1280×720, not exact equality. All assertions must therefore be stage-relative, ratio-based, or upper/lower bounds. Never assert `window.innerWidth === 1280` or `innerHeight === 720`.

The existing functional journey remains one `it()`. Geometry observations are collected into module-scoped snapshots during that journey using a local nullable `elementRect()` helper. A following `it()` performs geometry assertions. A pure geometry drift therefore reports as geometry failure rather than aborting the functional journey mid-flight.

Interrogation assertions:

- active stage edges match `GameShell main` within ~2px;
- art target exists, is inside stage, has left inset in the intended band, and occupies a near-full-height band;
- question/dialogue records are ≤1004px and centered relative to the stage;
- question/dialogue bottom insets differ by ≤4px;
- dialogue panel ≥194px;
- rebut ring ≥124×124px;
- Present tray ≤904px and remains inside viewport.

Analysis assertions in the same PR after the Interrogation checkpoint:

- rail 248px ±2px;
- content ≤962px;
- Classify ratio near 1:1.4;
- Order ratio near 1.3:1;
- footer/workbench fit the viewport.

### Packaged thumbnail proof

Extend the existing `capture-proof` suite with one Interrogation subject/speaker-art capture path. It must prove a produced thumbnail contains the current stage portrait and does not fail crossfade settlement/direct composition.

Do not create another E2E suite.

### CI risk routing

Future changes to `InterrogationStage.svelte`, `InterrogationView.svelte`, `InterrogationEvidenceTray.svelte`, or `InterrogationSubjectArt.svelte` must select the existing gameplay/production/analysis-beat85 suites rather than smoke only.

Add `apps/game/src/lib/components/Interrogation*.svelte` to the existing `gameplay` risk rule and pin it in `select-e2e-suites.test.mjs`.

### Manual visual evidence

All visual evidence belongs to the **same implementation PR**.

At the internal Interrogation checkpoint after the Interrogation tasks, capture at 1280×720:

1. Interrogation question menu;
2. Interrogation testimony + rebut ring;
3. Interrogation Present tray;
4. optional 1280×800 testimony comparison.

After the Analysis tasks, capture Analysis Classify at 1280×720 and perform the final cross-scene comparison against the earlier Interrogation captures.

No raster baselines are committed.

## Delivery model: one implementation PR

The implementation is intentionally consolidated into one PR because the two surfaces share `GameShell`, `+page.svelte`, `analysis-beat85.e2e.ts`, and final visual acceptance. Splitting them would create an artificial merge boundary around files and acceptance evidence that are already coupled by the handoff-conformance goal.

The one PR contains:

### Interrogation checkpoint

- compiler-derived subject fallback portrait;
- Rust/TS public projection;
- scene-owned presentation predicate;
- active-only fitted stage;
- stage-owned backdrop;
- speaker-following/fallback stage art;
- alpha crop/anchor;
- save-thumbnail asset-role + capture proof;
- one HUD/objective;
- stage-anchored question/testimony/rebut;
- Present restyle;
- CI risk routing;
- packaged Interrogation geometry and manual Interrogation captures.

The branch does **not** merge here. Those checks are simply the internal gate before continuing.

### Final Analysis checkpoint

- 248px rail / 960px content frame;
- Classify/Order ratios;
- scoped visual tokens/typography;
- clipped cards/state treatment;
- compact semantic fallback controls;
- Analysis shared-wrapper selector normalization;
- Analysis geometry assertions;
- full regression and manual Analysis capture;
- final cross-scene comparison using the Interrogation evidence already attached to the same PR.

No second implementation PR and no infrastructure-only PR are planned for this slice.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| new art breaks save thumbnails | role-tag the Crossfade image, unit-test capture separation, run `capture-proof` |
| subject art shows wrong speaker | prefer `mode.current.portrait`, fallback to compiled subject standard |
| transparent portrait looks tiny/misaligned | reuse shared alpha bounds/crop variables; geometry-check target |
| backdrop flashes on mode flip | stage owns one persistent SceneBackdrop instance |
| Analysis wrapper is accidentally fitted as Interrogation | scope to `.interrogation-stage.active`; retain shell-owned Analysis context |
| dialogue/menu drift apart | both use stage-absolute bottom spine; compare insets in packaged geometry test |
| future Interrogation-only PR runs smoke only | extend existing gameplay E2E risk rule |
| stale generated JSON silently loads | no serde default on compiler-owned portrait field |
| new visual testing becomes expensive | one existing journey + one existing capture-proof suite; no screenshot framework |
| single PR becomes hard to review | retain task-level commits and require the Interrogation checkpoint before starting Analysis; reviewer can inspect the two logical halves without a merge boundary |

## Expected implementation surface

### Compiler/runtime

- `packages/scripts/compile-scenes/types.ts`
- `packages/scripts/compile-scenes/parser-interrogation.ts`
- `packages/scripts/compile-scenes/parser-interrogation.test.ts`
- `packages/scripts/compile-scenes/assets/enrich.ts`
- `packages/scripts/compile-scenes/assets/enrich.test.ts`
- `packages/scripts/compile-scenes/emitter.ts`
- `packages/scripts/compile-scenes/emitter.test.ts`
- `apps/game/src-tauri/src/game/schema.rs`
- `apps/game/src-tauri/src/game/view.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- `apps/game/src/lib/state/types.ts`

### Interrogation frontend / persistence acceptance

- `apps/game/src/lib/interrogation/presentation.ts`
- `apps/game/src/lib/interrogation/presentation.test.ts`
- `apps/game/src/lib/components/GameShell.svelte`
- `apps/game/src/lib/components/GameShell.test.ts`
- `apps/game/src/lib/components/InterrogationSubjectArt.svelte` (new)
- `apps/game/src/lib/components/InterrogationSubjectArt.test.ts` (new)
- `apps/game/src/lib/components/InterrogationStage.svelte`
- `apps/game/src/lib/components/InterrogationStage.test.ts`
- `apps/game/src/lib/components/InterrogationView.svelte`
- `apps/game/src/lib/components/InterrogationView.test.ts`
- `apps/game/src/lib/components/DialogueBox.svelte`
- `apps/game/src/lib/components/DialogueBox.test.ts`
- `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`
- `apps/game/src/routes/+page.svelte`
- `apps/game/src/routes/page.test.ts`
- `apps/game/src/lib/persistence/thumbnail-capture.test.ts`
- `apps/game/e2e-tauri/capture-proof.e2e.ts`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- `apps/game/scripts/select-e2e-suites.mjs`
- `apps/game/scripts/select-e2e-suites.test.mjs`

### Analysis frontend

- `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- `apps/game/src/lib/components/analysis/AnalysisCard.test.ts`
- `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`
- `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- `apps/game/src/lib/components/analysis/OrderBoard.test.ts`
- `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`
- `apps/game/src/lib/components/GameShell.svelte`
- `apps/game/src/lib/components/GameShell.test.ts`

No authored story Markdown, save schema/migration, new command, dependency, generated raster baseline, or new E2E suite is expected.
