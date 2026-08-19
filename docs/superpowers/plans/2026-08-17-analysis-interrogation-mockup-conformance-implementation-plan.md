# Analysis and Interrogation Mockup Conformance Implementation Plan

> **For agentic workers:** use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this plan task-by-task. Each task follows TDD: establish a failing contract, implement the smallest change, rerun focused verification, then commit.

**Goal:** Bring the shipped Analysis and Interrogation scenes into visual conformance with the supplied handoffs without replacing their current gameplay architecture.

**Architecture:** Keep the current state/runtime seams. Add one compiler-derived Interrogation subject fallback portrait, make `.interrogation-stage.active` the single fitted Interrogation containing block, move one persistent backdrop and speaker-aware character art into that stage, stage-anchor both menu/testimony surfaces, keep Present engine-owned, preserve save-thumbnail direct asset composition, and reuse the existing packaged journeys for acceptance.

**Validated baseline:** `main` at `9b9640c38a4eb5f91c1333f3984b3029947e3926`.

**Spec:** `docs/superpowers/specs/2026-08-17-analysis-interrogation-mockup-conformance-design.md`

## Global constraints

- Preserve Analysis Rust evaluation, action tokens, whole-draft mutation, direct-manipulation target IDs, focus behavior, save restoration, callbacks, and authored Result Dialogue.
- Preserve Interrogation question/line IDs, challenge/present/withdraw/resume behavior, phase completion, save restoration, Case File ownership, Game Menu layering, typewriter, LOG/history, advance behavior, and authored dialogue portraits/expressions.
- No frontend subject alias table.
- No writer-facing portrait/standee metadata.
- No new raster assets or standee family.
- No generic HUD/layout/crop/geometry framework.
- No new dependencies.
- No screenshot-diff framework or committed raster baselines.
- No Present browse/preview/confirm state.
- No save schema/version/migration change.
- No Chapter 1 story rewrite.
- Keep visible labels/selectors including `xexam-challenge`, `反駁`, `退下`, `收回`, `完成訊問`, `比對推論`, and existing `data-analysis-*` hooks.
- `InterrogationStage` wraps all gameplay modes. Full-height/absolute Interrogation rules must be scoped to `.interrogation-stage.active` or the direct `.shell.interrogation-presentation > main > .interrogation-stage.active` relation.
- Never use `data-interrogation-mode="interrogation"` as the Interrogation fitted-lifetime selector; same-scene dialogue reports `mode.type === "dialogue"`.
- The stage art must prefer `Mode.Dialogue.current.portrait` when a current line provides one and fall back to `phase.subject.portrait` otherwise.
- The stage art's `CrossfadeImage` must carry `data-save-thumbnail-asset-role="portrait"`.
- Use `@lyra/shared` alpha-crop helpers; do not invent another crop implementation.
- Do not add `#[serde(default)]` to the new compiler-owned Rust subject portrait field.
- `ensureCaseFileViewport()` guarantees a viewport **at least** 1280×720; do not add exact-width/height assertions.
- Geometry observations in `analysis-beat85.e2e.ts` are collected during the functional journey and asserted in a following `it()`.
- Run the Svelte autofixer for every changed/new Svelte component.
- Do not hand-edit generated scene resources; use `bun run scenes:compile`.

---

## Delivery model: one implementation PR

Implement **Tasks 1–8 in one PR**. Keep the task-level commits and focused verification gates below, but do not split Interrogation and Analysis into separate pull requests.

The single PR has two internal checkpoints:

1. **Interrogation checkpoint after Task 5** — compiler/public wire, continuous stage, save-thumbnail-safe speaker art, Present geometry, CI routing, packaged capture proof, and manual Interrogation captures must be green before starting the Analysis visual work.
2. **Final checkpoint after Task 8** — Analysis visual conformance, packaged geometry, full regression, and the final cross-scene manual review complete the same PR.

Do not create an infrastructure-only PR or a follow-up Analysis PR for this slice.

---

# Interrogation canvas conformance

## Task 1: Derive a compiler-owned Interrogation subject portrait

**Files**

- Modify `packages/scripts/compile-scenes/types.ts`
- Modify `packages/scripts/compile-scenes/parser-interrogation.ts`
- Modify `packages/scripts/compile-scenes/parser-interrogation.test.ts`
- Modify `packages/scripts/compile-scenes/assets/enrich.ts`
- Modify `packages/scripts/compile-scenes/assets/enrich.test.ts`
- Modify `packages/scripts/compile-scenes/emitter.ts`
- Modify `packages/scripts/compile-scenes/emitter.test.ts`

**Contract**

- `ASTSubject.portrait: PortraitRef | null`
- `JSONSubject.portrait: PortraitRef | null`
- parser sets `portrait: null`; no authoring syntax
- enrichment resolves subject display name through existing `characters.yaml`
- enabled portrait subjects require the existing `standard` expression
- registered ref is `portrait.<characterId>.standard`
- asset ref + manifest entry are produced
- disabled assets explicitly clear the field
- no generic error-code-injection helper

### Steps

- [ ] Add parser/emitter tests expecting `portrait: null` before enrichment and the concrete `PortraitRef` after enrichment/emission.
- [ ] Add enrichment tests for `三宅蒼太` proving subject portrait, scene asset ref, and manifest entry.
- [ ] Add disabled-assets coverage proving `stripPhase()` returns `subject.portrait = null`.
- [ ] Add one unknown-subject and one missing-standard fixture; both use the focused code `assetUnknownInterrogationSubject`.
- [ ] Run focused script tests and observe failure.
- [ ] Extend `ASTSubject`/`JSONSubject` and return `portrait: null` from `parseSubject()`.
- [ ] Extract only a successful registration helper, for example:

```ts
function registerPortraitRef(input: {
  characterId: string;
  expression: string;
  prompt: string;
  subjectPrompt: string;
  context: EnrichContext;
}): PortraitRef
```

`enrichLine()` keeps its current lookup/default-expression/error handling. Replace only its existing `addRef` / `putRequest` / `PortraitRef` construction with this helper.

- [ ] Add a small `enrichInterrogationSubject(subject, context)` that performs subject-specific lookup/standard validation and then calls `registerPortraitRef()`.
- [ ] In `enrichInterrogationPhase()`, replace the subject with the enriched subject.
- [ ] In `stripPhase()`, explicitly set `subject: { ...phase.subject, portrait: null }`.
- [ ] Emit `subject.portrait` unchanged.
- [ ] Run:

```bash
bun run test:scripts -- \
  packages/scripts/compile-scenes/parser-interrogation.test.ts \
  packages/scripts/compile-scenes/assets/enrich.test.ts \
  packages/scripts/compile-scenes/emitter.test.ts
bun run check:scripts
bun run scenes:compile
```

- [ ] Commit:

```bash
git add packages/scripts/compile-scenes
git commit -m "feat: derive interrogation subject portraits"
```

## Task 2: Project the portrait through Rust and the frontend wire

**Files**

- Modify `apps/game/src-tauri/src/game/schema.rs`
- Modify `apps/game/src-tauri/src/game/view.rs`
- Modify `apps/game/src-tauri/src/game/mod.rs`
- Modify focused Rust Interrogation public-view tests
- Modify `apps/game/src/lib/state/types.ts`
- Update affected frontend fixtures constructing `SubjectView`

**Contract**

Use the existing Rust type name:

```rust
SubjectJson {
    // existing fields
    portrait: Option<PortraitRefJson>,
}

SubjectView {
    // existing fields
    portrait: Option<PortraitRefJson>,
}
```

`view.rs` already imports schema atoms; add `PortraitRefJson` to that import list rather than inventing a parallel view type.

Do **not** add `#[serde(default)]` to `SubjectJson.portrait`.

### Steps

- [ ] Add a failing Rust test `public_interrogation_subject_preserves_compiled_portrait` with a concrete `PortraitRefJson` and an explicit null fixture.
- [ ] Run the focused test and observe failure.
- [ ] Add `portrait: Option<PortraitRefJson>` to `SubjectJson` and `SubjectView`.
- [ ] Add `PortraitRefJson` to `view.rs`'s existing `crate::game::schema::{...}` import.
- [ ] In `game/mod.rs` Interrogation projection, copy `portrait: subject.portrait.clone()`.
- [ ] In TypeScript, add `SubjectView.portrait: PortraitRef | null` and update fixtures.
- [ ] Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  public_interrogation_subject_preserves_compiled_portrait
bun run --cwd apps/game test -- \
  src/lib/interrogation/presentation.test.ts \
  src/lib/components/InterrogationStage.test.ts \
  src/lib/components/InterrogationView.test.ts
```

- [ ] Verify persistence paths are untouched:

```bash
git diff -- \
  apps/game/src-tauri/src/game/save \
  apps/game/src-tauri/src/game/save.rs \
  apps/game/src/lib/persistence
```

- [ ] Commit:

```bash
git add apps/game/src-tauri/src/game/schema.rs \
  apps/game/src-tauri/src/game/view.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src/lib/state/types.ts \
  apps/game/src/lib/interrogation \
  apps/game/src/lib/components/*test.ts
git commit -m "feat: expose interrogation subject portraits"
```

## Task 3: Make Interrogation a continuous, thumbnail-safe stage

**Files**

- Modify `apps/game/src/lib/interrogation/presentation.ts`
- Modify `apps/game/src/lib/interrogation/presentation.test.ts`
- Modify `apps/game/src/lib/components/GameShell.svelte`
- Modify `apps/game/src/lib/components/GameShell.test.ts`
- Create `apps/game/src/lib/components/InterrogationSubjectArt.svelte`
- Create `apps/game/src/lib/components/InterrogationSubjectArt.test.ts`
- Modify `apps/game/src/lib/components/InterrogationStage.svelte`
- Modify `apps/game/src/lib/components/InterrogationStage.test.ts`
- Modify `apps/game/src/routes/+page.svelte`
- Modify `apps/game/src/routes/page.test.ts`
- Modify `apps/game/src/lib/persistence/thumbnail-capture.test.ts`
- Modify `apps/game/scripts/select-e2e-suites.mjs`
- Modify `apps/game/scripts/select-e2e-suites.test.mjs`
- Plan packaged proof changes in existing `apps/game/e2e-tauri/capture-proof.e2e.ts` for Task 5

### 3.1 Presentation lifetime

- [ ] Add failing tests that same-scene dialogue with `crossExamLineId: null` is active and dialogue from another scene is inactive.
- [ ] Change predicate to:

```ts
scene.kind === "interrogation" &&
  (mode.type === "interrogation" ||
    (mode.type === "dialogue" && mode.queueToken.sceneId === scene.id))
```

### 3.2 Fitted shell/stage and one objective

- [ ] Add tests proving `GameShell` suppresses ordinary chapter chrome/objective when `interrogationPresentation` is active.
- [ ] Add `class:interrogation-presentation` beside Analysis presentation.
- [ ] Share shell/main fitted rules between Analysis and Interrogation, but target the Interrogation direct child specifically with `.interrogation-stage.active`.
- [ ] Remove fixed `.interrogation-objective` markup/CSS from `GameShell`.
- [ ] Pass `activePrimaryObjective` into `InterrogationStage` and render `PrimaryObjectiveHud` exactly once there.

### 3.3 Stage-owned backdrop

- [ ] Add a stage test that rerenders `mode.type="interrogation"` → same-scene `dialogue` and asserts the same `[data-save-thumbnail-layout="backdrop"]` DOM node survives the rerender.
- [ ] Import/render one `SceneBackdrop` inside the active stage, outside the mode-specific child snippet.
- [ ] Derive its props from `mode` (`Dialogue.sceneTag/backgroundAssetId` or `Interrogation.backgroundAssetId`).
- [ ] In `+page.svelte`, do not mount another `SceneBackdrop` for active Interrogation dialogue/menu; preserve existing ordinary-dialogue and Analysis backdrop paths.

### 3.4 Speaker-aware subject art

`InterrogationStage` derives:

```ts
const activePortrait =
  mode.type === "dialogue" &&
  mode.current.kind === "line" &&
  mode.current.portrait !== null
    ? mode.current.portrait
    : phase?.subject.portrait ?? null;
```

- [ ] Add tests for subject standard fallback, subject expression change, and non-subject speaker swap.
- [ ] `InterrogationSubjectArt` accepts a `PortraitRef | null`; it does not derive character identity itself.
- [ ] Resolve through existing story-asset helpers and use existing missing-asset placeholder behavior.
- [ ] Render a stable wrapper `data-interrogation-subject-art` and decorative `CrossfadeImage`.
- [ ] Include `imageClass="portrait interrogation-subject-portrait"` (or equivalent preserving the `portrait` compatibility class).
- [ ] Include:

```ts
dataAttributes={{
  "save-thumbnail-asset-role": "portrait",
}}
```

### 3.5 Alpha crop / anchor

- [ ] Import `alphaBoundsFromImageData` and `cropVariablesForAlphaBounds` from `@lyra/shared`.
- [ ] On successful image load, calculate alpha bounds once per asset and produce crop variables.
- [ ] Scale/position the actual role-tagged `<img>` so the non-transparent silhouette is bottom/left anchored; transparent padding must not define the apparent stage size.
- [ ] Keep the image's final transformed `getBoundingClientRect()` meaningful for direct thumbnail composition.
- [ ] Add component tests using a synthetic image/canvas fixture to prove crop variables are applied and the no-bounds fallback remains safe.

### 3.6 Thumbnail capture contract

- [ ] Add `InterrogationSubjectArt` component coverage for `data-save-thumbnail-asset-role="portrait"` and `data-save-crossfade-layer` presence after resolution.
- [ ] Extend `thumbnail-capture.test.ts` with a capture root containing a role-tagged crossfade portrait. Prove the role-tagged image is excluded from the DOM SVG layer and classified as a direct `portrait` asset layer rather than rasterized as ordinary UI.
- [ ] Do not change thumbnail-capture production code unless the focused test exposes a real incompatibility; the expected implementation is correct tagging/reuse.

### 3.7 Future CI routing

Add the existing component family to the current `gameplay` E2E risk rule:

```js
"apps/game/src/lib/components/Interrogation*.svelte",
```

- [ ] Add selector-contract tests proving a Stage/View/Tray/SubjectArt-only change selects `smoke`, `gameplay`, `production-journey`, and `analysis-beat85` instead of smoke only.
- [ ] Run:

```bash
bun run --cwd apps/game test:e2e:ci-contracts
```

Note: editing `select-e2e-suites.mjs` itself is an E2E-infrastructure change, so the single implementation PR is expected to select the full registry. This is acceptable; no new suite is introduced.

### 3.8 Focused verification

Run Svelte autofixer for:

- `GameShell.svelte`
- `InterrogationSubjectArt.svelte`
- `InterrogationStage.svelte`
- `+page.svelte`

Then run:

```bash
bun run --cwd apps/game test -- \
  src/lib/interrogation/presentation.test.ts \
  src/lib/components/GameShell.test.ts \
  src/lib/components/InterrogationSubjectArt.test.ts \
  src/lib/components/InterrogationStage.test.ts \
  src/lib/persistence/thumbnail-capture.test.ts \
  src/routes/page.test.ts
bun run --cwd apps/game check
bun run --cwd apps/game test:e2e:ci-contracts
```

- [ ] Commit:

```bash
git add apps/game/src/lib/interrogation \
  apps/game/src/lib/components/GameShell* \
  apps/game/src/lib/components/InterrogationSubjectArt* \
  apps/game/src/lib/components/InterrogationStage* \
  apps/game/src/routes/+page.svelte \
  apps/game/src/routes/page.test.ts \
  apps/game/src/lib/persistence/thumbnail-capture.test.ts \
  apps/game/scripts/select-e2e-suites.mjs \
  apps/game/scripts/select-e2e-suites.test.mjs
git commit -m "feat: add continuous interrogation stage"
```

## Task 4: Stage-anchor the question record, testimony frame, and rebut ring

**Files**

- Modify `apps/game/src/lib/components/InterrogationView.svelte`
- Modify `apps/game/src/lib/components/InterrogationView.test.ts`
- Modify `apps/game/src/lib/components/DialogueBox.svelte`
- Modify `apps/game/src/lib/components/DialogueBox.test.ts`
- Modify `apps/game/src/routes/+page.svelte`
- Modify `apps/game/src/routes/page.test.ts`

### Steps

- [ ] Add stable `data-interrogation-question-record` to the question record and preserve all question/canComplete/no-phase behavior tests.
- [ ] Add optional `interrogationStageActive?: boolean` to `DialogueBox`.
- [ ] Add tests proving:
  - ordinary path still renders per-line portrait/expression;
  - active Interrogation path suppresses DialogueBox's own portrait;
  - stage (Task 3) still receives/follows the current line portrait;
  - `data-interrogation-dialogue-frame` exists;
  - line progress, `xexam-challenge`, and `退下` remain;
  - pointer hold/direct click/keyboard behavior remains one invocation.
- [ ] Recompose `InterrogationView` as the stage-absolute bottom record:

```css
.interrogation {
  position: absolute;
  left: 50%;
  bottom: 28px;
  width: min(1000px, calc(100% - 56px));
  transform: translateX(-50%);
  max-height: calc(100% - 250px);
  overflow: auto;
}
```

- [ ] On `DialogueBox` ordinary path, leave `.wrapper { position: fixed; ... }` unchanged.
- [ ] On active Interrogation path, add a modifier class and switch only that path to:

```css
.wrapper.interrogation-stage-dialogue {
  --dialogue-width: min(1000px, calc(100% - 56px));
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
}
```

- [ ] Interrogation `.box` minimum height: 196px.
- [ ] Move the existing `xexam-challenge` visually outside the clipped panel and size desktop ring to 128×128px; at ≤720px place actions below and keep ≥64px touch target.
- [ ] Do not change challenge timing/suppression/callback code.
- [ ] Wire `interrogationStageActive={interrogationPresentationActive}` at the existing single `DialogueBox` call site.
- [ ] Autofix changed Svelte files.
- [ ] Run focused component/page tests and `bun run --cwd apps/game check`.
- [ ] Commit `feat: conform interrogation record layout`.

## Task 5: Present surface + packaged Interrogation geometry and capture proof

**Files**

- Modify `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- Modify `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`
- Modify `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Modify `apps/game/e2e-tauri/capture-proof.e2e.ts`

### 5.1 Present visual-only restyle

- [ ] Add stable `data-interrogation-present-tray`.
- [ ] Change desktop width to `min(900px, calc(100vw - 48px))`.
- [ ] Use a denser visual grid (`repeat(auto-fit, minmax(150px, 1fr))` or the equivalent matching the handoff).
- [ ] Preserve current testimony target, evidence images, statement treatment, direct `onPresent`, `收回`, Game Menu, focus trap, Escape claim, top-layer suspension, and disabled state.
- [ ] Do not add local selection or confirmation.

### 5.2 Geometry observations do not abort the journey

`analysis-beat85.e2e.ts` currently has one long functional `it()`. Keep it functional.

Add module-scoped nullable snapshots, e.g.:

```ts
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const geometry: {
  menu?: { stage: Rect; main: Rect; art: Rect; record: Rect };
  testimony?: { stage: Rect; main: Rect; art: Rect; frame: Rect; box: Rect; challenge: Rect };
  present?: { stage: Rect; tray: Rect };
} = {};
```

Add a local nullable `elementRect(selector)` that returns `null` instead of throwing when the geometry target is missing. During the existing functional journey, collect snapshots at the correct states but **do not assert geometry there**.

Add a following test:

```ts
it("matches the Interrogation mockup geometry contract", () => {
  // assertions over collected snapshots
});
```

If a visual hook/size drifts, the geometry test fails without cutting the functional journey short.

### 5.3 Viewport rule

At suite start call `ensureCaseFileViewport()`.

Document in the test comment that it guarantees `>= 1280×720`, not equality. Assertions must be relative/bounded.

### 5.4 Geometry acceptance

Menu state:

- active stage and `main` edges differ by ≤2px;
- art target exists, remains inside stage, has intended left inset, and height is in a near-full-stage band (target roughly 88%–100% of stage height at desktop);
- question record ≤1004px and centered relative to stage;
- record bottom inset is near 28px.

Testimony state:

- stage/main still align;
- art target still satisfies bounds after speaker/expression change;
- dialogue frame ≤1004px and centered relative to stage;
- dialogue box height ≥194px;
- challenge ring ≥124×124px;
- dialogue bottom inset differs from question-record inset by ≤4px.

Present state:

- tray ≤904px;
- tray remains inside viewport.

Do not assert exact 1280/720 window dimensions.

### 5.5 Packaged thumbnail proof

Extend the existing `capture-proof` spec, not a new suite.

Add one focused Interrogation capture path that:

1. enters a stable question/testimony dialogue state with a known current speaker portrait;
2. triggers an actual thumbnail capture through the existing capture-proof/manual capture path (do not rely on the Present tray being included in thumbnails);
3. proves the visible stage image is `img.portrait[data-save-thumbnail-asset-role="portrait"]` and is the current crossfade winner;
4. proves the capture completes as available and the pixel/reference check matches the current portrait rather than an old/leaving layer;
5. exercises a speaker or expression transition so the current winner, not the previous stage portrait, is captured.

Reuse existing capture-proof helpers/selectors where possible. Do not build another pixel-analysis framework.

### 5.6 Focused/packaged verification

- [ ] Autofix `InterrogationEvidenceTray.svelte`.
- [ ] Run component tests and E2E TypeScript check.
- [ ] Run:

```bash
node apps/game/scripts/build-e2e.mjs
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
node apps/game/scripts/run-save-e2e.mjs --suite capture-proof
```

- [ ] Because Task 3 changes `select-e2e-suites.mjs`, run the CI-contract tests and the full local E2E registry at the Interrogation checkpoint:

```bash
bun run --cwd apps/game test:e2e:ci-contracts
bun run test:e2e
```

### 5.7 Interrogation visual checkpoint inside the same PR

Before starting Task 6, capture and attach to the **same implementation PR**:

1. Interrogation question menu at 1280×720 target;
2. Interrogation testimony + 128px rebut ring at 1280×720 target;
3. Interrogation Present tray at 1280×720 target;
4. optional 1280×800 testimony comparison against the handoff.

Do not defer these captures to the final Analysis review; they are the internal gate before continuing in the same PR.

- [ ] Commit Present/E2E acceptance: `test: pin interrogation mockup geometry`.

This completes the Interrogation checkpoint. Continue with Task 6 on the same branch and pull request.

---

# Analysis visual conformance

## Task 6: Conform Analysis host geometry and scoped tokens

**Files**

- Modify `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- Modify `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Modify `apps/game/src/lib/components/GameShell.svelte`
- Modify `apps/game/src/lib/components/GameShell.test.ts`

### Steps

- [ ] Add stable `data-analysis-rail` and `data-analysis-content-frame` hooks without changing behavior.
- [ ] Set desktop workbench columns to `248px minmax(0, 1fr)`.
- [ ] Add centered content frame `width: min(960px, 100%); margin-inline: auto` around board workspace content.
- [ ] Keep footer persistent/reachable at the fitted height.
- [ ] Define scoped workbench variables for Analysis blue/panel/rule while reusing global Lyra bone/crimson/cyan/typography tokens.
- [ ] Keep current narrow-screen single-column behavior.

### Normalize the existing shared-wrapper selector

Current Analysis GameShell CSS targets:

```css
.interrogation-stage[data-interrogation-mode="analysis"]
```

Do not literally replace this with `.active`: `active` is the Interrogation presentation flag and is false during Analysis.

Instead use the already authoritative shell context:

```css
.shell.analysis-presentation
  > main
  > :global(.interrogation-stage) { ... }
```

and the analogous direct-child `.analysis-workbench` rule.

This removes the mixed data-mode idiom without broadening Interrogation `active` semantics.

- [ ] Autofix and run `AnalysisWorkbench.test.ts`, `GameShell.test.ts`, and game check.
- [ ] Commit `feat: conform analysis workbench geometry`.

## Task 7: Conform Analysis cards and board composition

**Files**

- Modify `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- Modify `apps/game/src/lib/components/analysis/AnalysisCard.test.ts`
- Modify `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- Modify `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`
- Modify `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- Modify `apps/game/src/lib/components/analysis/OrderBoard.test.ts`
- Modify `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- Modify `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`

### Steps

- [ ] Add presentation-only stable hooks if needed; do not change current `data-analysis-card-id` / drop-target hooks.
- [ ] `AnalysisCard`: clipped silhouette, compact source/status hierarchy, crimson/cyan state treatment, Lyra typography.
- [ ] `ClassifyBoard`: desktop `1fr 1.4fr`, clipped group panels/markers, compact Assign/Remove fallbacks.
- [ ] `OrderBoard`: desktop `1.3fr 1fr`, stronger timeline/anchor hierarchy, compact Add/Up/Down fallbacks.
- [ ] `ThresholdBoard`: `repeat(auto-fill, minmax(240px, 1fr))`, compact provenance/status display, preserve standard progress semantics.
- [ ] Do not change card selection, pointer draft transforms, fixed anchors, whole-draft callbacks, focus keys, read-only rules, submit semantics, or labels.
- [ ] Autofix all four Svelte components.
- [ ] Run focused Analysis component tests plus game check.
- [ ] Commit `feat: conform analysis board visuals`.

## Task 8: Add Analysis geometry to the existing packaged acceptance and finish regression

**Files**

- Modify `apps/game/e2e-tauri/analysis-beat85.e2e.ts`

The same functional journey and following geometry `it()` introduced by Task 5 remain. Add Analysis snapshots collected during the existing board journey, then add assertions to the geometry test.

### Analysis geometry assertions

- [ ] rail width 248px ±2px;
- [ ] content frame ≤962px and centered in workspace;
- [ ] Classify pool/groups width ratio approximates 1:1.4 within a small tolerance;
- [ ] Order timeline/pending ratio approximates 1.3:1;
- [ ] workbench/footer remain inside viewport;
- [ ] no exact `innerWidth === 1280` / `innerHeight === 720` assertion.

### Verification

Run focused Analysis tests, game checks, then:

```bash
node apps/game/scripts/build-e2e.mjs
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
bun run check
bun run test
```

Because Task 3 changes the E2E selector itself, run the full packaged E2E registry before the single implementation PR is marked ready:

```bash
bun run test:e2e
```

### Final manual acceptance in the same PR

- [ ] capture Analysis Classify at the 1280×720 target;
- [ ] compare against `Analysis Workbench v3` handoff;
- [ ] re-open the Task 5 Interrogation captures for the final cross-scene consistency check;
- [ ] confirm both Analysis and Interrogation acceptance evidence is attached to the same PR;
- [ ] do not commit raster baselines.

- [ ] Commit `test: pin analysis mockup geometry`.

---

## Final acceptance checklist

### Interrogation

- [ ] same-scene dialogue remains presentation-active;
- [ ] `.interrogation-stage.active` fills `GameShell > main` and inactive wrapper remains harmless;
- [ ] one stage-owned backdrop survives menu/testimony transitions;
- [ ] objective appears exactly once;
- [ ] compiler fallback portrait is manifest-visible, uses `PortraitRefJson` in Rust, and has no serde default;
- [ ] stage art follows current line portrait/expression and falls back to phase subject standard;
- [ ] stage art uses shared alpha crop/anchor;
- [ ] stage art carries `data-save-thumbnail-asset-role="portrait"` and capture proof succeeds;
- [ ] DialogueBox does not duplicate the portrait on active Interrogation path;
- [ ] question/testimony share the stage-relative bottom spine;
- [ ] dialogue panel ≥196px target; rebut ring ~128px; Present tray ~900px;
- [ ] Present focus/Escape/Game Menu/direct engine callback behavior is unchanged;
- [ ] future `Interrogation*.svelte` changes select the existing gameplay/production/analysis-beat85 E2E suites;
- [ ] Interrogation manual captures were reviewed at the Task 5 checkpoint in this PR.

### Analysis

- [ ] rail 248px;
- [ ] content max 960px;
- [ ] Classify ratio ~1:1.4;
- [ ] Order ratio ~1.3:1;
- [ ] cards/panels use clipped Lyra visual language;
- [ ] semantic fallbacks remain accessible and behaviorally unchanged;
- [ ] shared wrapper CSS no longer relies on `data-interrogation-mode="analysis"`;
- [ ] existing interaction/focus/persistence tests pass;
- [ ] Analysis manual capture is reviewed before this same PR is marked ready.

### Single-PR delivery

- [ ] Tasks 1–8 are on one implementation branch and one pull request;
- [ ] the Task 5 Interrogation checkpoint passed before Analysis visual work continued;
- [ ] the final PR contains both Interrogation and Analysis acceptance evidence;
- [ ] no follow-up PR is required merely to finish the planned Analysis half.

### Scope

- [ ] no save schema/migration;
- [ ] no authored story change;
- [ ] no new raster asset family;
- [ ] no new command/dependency;
- [ ] no replacement Case File/Present state;
- [ ] no screenshot-baseline infrastructure;
- [ ] no new E2E suite.
