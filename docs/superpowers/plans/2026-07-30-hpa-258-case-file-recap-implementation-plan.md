# HPA-258 Case File, Primary Objective, Authorizations, and Continue Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan in the numbered order below. Every task uses red-green-refactor checkpoints and an explicit commit boundary.

**Goal:** Replace the evidence-only Escape submenu with a spoiler-safe six-section Case File and primary-objective HUD, then add tokenizer-compatible authored scene summaries, save-envelope schema version 2, and shared Save/Continue recap presentation.

**Architecture:** PR A is deliberately save/content-compatible: Rust builds one immutable `StoryLocationIndex`, projects only acquired/revealed state into fallible spoiler-safe views, and Svelte derives Case File grouping and acquired-only successor navigation. PR B adds static scene summaries, advances only envelope/summary metadata to schema version 2 while retaining `SaveSnapshotV1`, migrates v1 without consulting current package prose, and reuses one text-only recap component in Save Browser and Continue.

**Tech Stack:** Bun 1.3.1, TypeScript, Vitest, SvelteKit SPA, Svelte 5 runes, Testing Library, Rust 2021, Serde, Cargo, Tauri 2, WebdriverIO packaged E2E.

## Normative Inputs

- Design: `docs/superpowers/specs/2026-07-30-hpa-258-case-file-objective-authorizations-continue-recap-design.md`
- Parent program design/plan: the detective gameplay system documents referenced by that design.
- HPA-255 global catalog/state, HPA-256 provenance/lineage, and HPA-392 persistence contracts as currently merged.
- Chapter 1 Final Writing Plan V3.7 and Story Bible V6.5 Canon Sync Patch for authored Chapter 1 recap copy.

## Plan Files and Mandatory Order

| Order | Plan | Scope |
| ---: | --- | --- |
| 1 | `2026-07-30-hpa-258-case-file-recap-implementation-plan-01-pr-a-runtime-public-views.md` | Tasks 1–3: immutable location index, acquired-record projection, origin-aware fallible story views |
| 2 | `2026-07-30-hpa-258-case-file-recap-implementation-plan-02-pr-a-case-file-ui.md` | Tasks 4–6: Case File types/model, accessible six-section shell, record/provenance/detail UI |
| 3 | `2026-07-30-hpa-258-case-file-recap-implementation-plan-03-pr-a-integration-hud-acceptance.md` | Tasks 7–9: replace menu, E2E anchors, primary-objective HUD, synthetic acceptance and PR A gate |
| 4 | `2026-07-30-hpa-258-case-file-recap-implementation-plan-04-pr-b-scene-summaries.md` | Tasks 10–12: shared tokenizer-compatible header parser, emitted/runtime summary, Chapter 1 backfill |
| 5 | `2026-07-30-hpa-258-case-file-recap-implementation-plan-05-pr-b-save-schema-v2.md` | Tasks 13–14: explicit v1 types, V2 envelope/summary, migration, storage/restore/coordinator integration |
| 6 | `2026-07-30-hpa-258-case-file-recap-implementation-plan-06-pr-b-recap-ui-acceptance.md` | Tasks 15–16: shared recap component, title Continue recap, compatibility evidence and PR B gate |

Do not begin plan 4 until PR A from plans 1–3 has merged and PR B is branched from updated `main`.

## Global Constraints

- Use strict TDD: add one focused failing behavior, run it and confirm the intended failure, implement the minimum production change, rerun focused tests, refactor only while green, then commit.
- Do not add a Case File persistence model, Case File IPC command, catalog fetch from Svelte, or production test-only mutation command.
- Rust owns catalog/state validity, locked-definition filtering, source-group resolution, acquisition/origin title resolution, and public redaction.
- Svelte may group, sort, label, and navigate public values. It must not infer hidden definitions, answer keys, mutation eligibility, or transitive support.
- Preserve HPA-256 redaction: `supersedesRecordId` stays kind-qualified and becomes null when its predecessor is unacquired. Never expose the full catalog successor index.
- Evidence and statement slugs may match across kinds; every selection/relation key must include kind.
- Facts remain conclusions and are never converted to `InventoryTarget`, presented as evidence, or re-examined.
- All-neutral legacy provenance renders no metadata rows, chips, “unspecified” copy, or hidden-lineage hints.
- Never display raw chapter/scene slugs or encoded relation IDs as player-facing fallback copy.
- `GameEngine::view()` stays fail-closed. Svelte’s malformed-link handling is only defensive fixture/stale-state protection.
- Build `StoryLocationIndex` once during new-game and restore candidate construction. Ordinary `view()` calls do no scene-file I/O or index rebuild.
- Keep Case File unavailable in `gameComplete`; keep re-examination enabled only in explore/interrogation.
- Escape, focus trapping, submenu step-back, persistence inert state, and acquisition-popup layering remain centralized in `GameShell` and the existing escape coordinator.
- PR A changes neither emitted scene semantics, `contentRevision`, `SAVE_SCHEMA_VERSION`, nor on-disk envelope shape. Existing saves remain compatible.
- PR B intentionally changes emitted scene semantics and `contentRevision`; this is expected pre-release incompatibility, not a migration defect.
- `SaveSnapshotV1` stays unchanged. V1 migration fills newly introduced recap-copy fields with null and never reads current packaged prose.
- Exact `contentRevision` validation occurs after schema migration and remains mandatory.
- Scene files author summary as `- **Summary:** ...`; dash-less chapter-manifest syntax is invalid in scene files.
- `summaryAuthored` is compiler-only audit state and is never emitted, hashed, serialized, or exposed.
- Backfill all 16 Chapter 1 manifested scenes; never hand-edit generated resource JSON.
- `@lyra/scene-types` remains the compiler/editor shared subset until the editor consumes scene summary; update repository guidance accordingly.
- HPA-258 synthetic fixtures cover populated Case File behavior. HPA-265/HPA-266 own real authored Chapter 1 populated packaged acceptance.
- Player-facing text and accessible labels use Traditional Chinese; decorative English labels may remain.
- Run commands from repository root through `rtk` where existing repository plans do so.

## Locked Public Contracts

### PR A

```rust
pub(in crate::game) struct SceneLocationContextView {
    pub chapter_id: String,
    pub chapter_title: String,
    pub scene_id: String,
    pub scene_title: String,
}

pub(in crate::game) struct StoryLocationIndex { /* immutable package index */ }

impl InventoryView {
    fn from_inventory(
        catalog: &StoryCatalog,
        inventory: &Inventory,
        locations: &StoryLocationIndex,
    ) -> Result<Self, GameError>;
}

impl StoryStateView {
    fn from_catalog_state(
        catalog: &StoryCatalog,
        state: &StoryState,
        acquired_targets: &BTreeSet<InventoryTarget>,
        locations: &StoryLocationIndex,
    ) -> Result<Self, GameError>;
}
```

Evidence and statement views gain `acquisitionContext` and acquired-record-only `sourceGroup`; facts and authorizations gain `originContext`. No public successor field is added.

```ts
type CaseFileSection =
  | "objective" | "evidence" | "statements"
  | "facts" | "questions" | "authorizations";

type CaseFileKey =
  | `evidence:${string}` | `statement:${string}`
  | `fact:${string}` | `question:${string}`
  | `objective:${string}` | `authorization:${string}`;
```

### PR B

```ts
type ParsedSceneHeader = {
  title: string;
  summary: string;
  summaryAuthored: boolean;
  nextTokenIndex: number;
};
```

```rust
pub(crate) const SAVE_SCHEMA_VERSION: u32 = 2;

pub(crate) struct SaveSummaryV1 { /* exact current wire */ }
pub(crate) struct SaveSummaryV2 {
    pub chapter_id: String,
    pub chapter_title: String,
    pub chapter_summary: Option<String>,
    pub scene_id: String,
    pub scene_title: String,
    pub scene_summary: Option<String>,
    pub active_primary_objective_id: Option<String>,
    pub active_primary_objective_label: Option<String>,
    pub active_primary_objective_summary: Option<String>,
}

pub(crate) struct SaveEnvelopeV1 {
    pub summary: SaveSummaryV1,
    pub snapshot: SaveSnapshotV1,
    // existing fields unchanged
}

pub(crate) struct SaveEnvelopeV2 {
    pub summary: SaveSummaryV2,
    pub snapshot: SaveSnapshotV1,
    // existing fields unchanged except schemaVersion = 2
}
```

Both `SaveMetadataView.summary` and `ReadableSaveMetadataView.summary` expose V2 after decode/migration. `SaveCard` remains the only thumbnail owner.

## Delivery Gates

### PR A gate

Run focused tests at each task, then before review:

```bash
rtk bun run test
rtk bun run check
rtk bun run --cwd apps/game check:e2e
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
rtk bun run lint:all
rtk bun run test:e2e
```

PR A must state: existing saves and `contentRevision` remain compatible; real populated Chapter 1 packaged coverage is deferred to HPA-265/HPA-266.

### PR B gate

```bash
rtk bun run test:scripts
rtk bun run test
rtk bun run check:scripts
rtk bun run check
rtk bun run --cwd apps/game check:e2e
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
rtk bun run lint:all
rtk bun run scenes:compile
rtk bun run test:e2e
```

PR B must record evidence that: schema-v1 migration succeeds under a matching synthetic revision; an old-package save still fails exact content compatibility; new writes use schema 2; `SaveSnapshotV1` is unchanged; generated resources are not tracked.

## Final Acceptance Checklist

- [ ] Six fixed Case File sections; no generic archive registry or duplicate durable state.
- [ ] Locked definitions absent from public views, DOM, counts, accessible names, and relation maps.
- [ ] Neutral provenance visually unchanged.
- [ ] Evidence/statements show resolved acquisition titles, never raw slugs.
- [ ] Facts expose acquired direct record support only and cannot be presented/re-examined.
- [ ] Same-slug cross-kind records and cross-kind supersession chains do not collide.
- [ ] No public future successor or hidden-support/lineage flag.
- [ ] Case File focus, relation navigation, Back, Escape, inert, reset, and re-examination behavior covered.
- [ ] Primary-objective HUD appears only when an active primary exists.
- [ ] `StoryLocationIndex` is immutable, non-serialized, and absent from the hot view I/O path.
- [ ] Scene Summary syntax matches tokenizer/parser behavior; `summaryAuthored` stays internal.
- [ ] All 16 Chapter 1 scenes have authored summaries.
- [ ] `SaveSummaryV1` preserves exact v1 JSON; both metadata projections expose V2 after migration.
- [ ] Migration adds null recap copy without consulting package prose; `SaveSnapshotV1` stays unchanged.
- [ ] Exact content revision remains mandatory.
- [ ] Save Browser and Continue share text presentation; SaveCard alone owns thumbnails.
- [ ] Continue remains newest-written with no silent fallback.
- [ ] PR A is save-compatible; PR B intentionally changes content identity.
- [ ] Synthetic HPA-258 acceptance passes; real Chapter 1 populated packaged acceptance remains HPA-265/HPA-266.
