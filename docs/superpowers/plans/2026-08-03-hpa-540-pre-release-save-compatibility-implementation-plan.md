# HPA-540 Pre-Release Save Compatibility Simplification Plan

## Goal

Implement the policy in:

- `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`

Leave Lyra with one current pre-release save format, one current StoryState snapshot, and one origin-owned story location model so HPA-260 can add Chapter 1 analysis drafts without an internal migration chain or duplicate persistence model.

## Preconditions and order

Re-run the release audit before deleting legacy decoding:

```bash
git tag --list
gh release list --repo cwchanap/Lyra
rg -n --hidden \
  'save compatibility|backward-compatible save|preserve player saves|released save schema|public build' \
  README.md CLAUDE.md docs .github apps packages
```

Current planning evidence:

```text
git tags: 0
GitHub releases: empty
no documented shipped-save compatibility promise outside HPA-540 planning/policy text
```

The `rg` command is a discovery aid, not a zero-match assertion. After PR #36 merges, it will legitimately find the HPA-540 policy, implementation plan, and any contributor-guidance pointer added for this policy. Classify every hit as one of:

- HPA-540 policy or implementation guidance;
- historical internal design text that never promised shipped compatibility;
- an actual public distribution or compatibility promise.

Only the third category blocks deletion. If it exists, stop and redesign the work around a released legacy module.

Required merge order:

```text
HPA-508 -> HPA-540 -> HPA-260
```

## Scope guard

This ticket changes compatibility policy, duplicate persistence/public-view representations, and the supported Tauri development identifier only.

Do not include `SaveCoordinator` decomposition, browser HTTP transport removal, compiler source-root cleanup, reveal-enum redesign, `SupportLineage` deletion, E2E suite restructuring, thumbnail renderer work, HPA-257 changes, or Chapter 2 compatibility work.

## Workstream 1: policy and repository guidance

### Changes

- Keep the policy spec as the durable decision record.
- Link it from contributor/agent guidance and the save module.
- Record the classified release-audit result in the implementation PR.
- Keep serialized `schemaVersion: 2`; do not renumber for aesthetics.
- Document the chosen current Rust naming boundary.

### Checks

- HPA-260 is explicitly prohibited from creating a new envelope/snapshot generation, duplicate Analysis/StoryState DTO, or generic resumable-state framework.
- The policy contains durable decisions; implementation-era regression checks remain in this plan.
- Known policy/self-documentation grep hits are not mistaken for a shipped compatibility promise.

## Workstream 2: isolate supported Tauri development saves

### Target behavior

Use the Tauri application identifier as the only development namespace mechanism.

```text
production identifier
  -> existing configured application-data/saves

development identifier: com.chanwaichan.lyra.dev
  -> its distinct configured application-data/saves

browser development
  -> existing repository-local save root, unchanged

e2e feature
  -> existing validated temporary E2E root, unchanged
```

Do not add:

- `DEVELOPMENT_SAVE_EPOCH`;
- a `SaveRuntimeChannel` enum;
- `saves-dev/epoch-N` path construction;
- a typed `unsafeSaveNamespace` startup failure;
- a debug-startup warning;
- a release-build-versus-development-identifier guard.

### Changes

- Edit `apps/game/src-tauri/tauri.dev.conf.json`, preserving existing keys, and set the top-level identifier to `com.chanwaichan.lyra.dev`.
- Keep normal non-E2E root resolution as `configured_app_data.join("saves")`; the different identifier supplies the different app-data base.
- Confirm the root `dev:game` flow and `apps/game` `dev:tauri` script continue loading `src-tauri/tauri.dev.conf.json`.
- Add or update only the existing config-contract test needed to protect that supported command.
- Document that old local saves created under an earlier identifier/root are left untouched and may be deleted manually.

### Likely files

- `apps/game/src-tauri/tauri.dev.conf.json`
- `apps/game/scripts/save-e2e-paths.test.mjs` or the existing equivalent config-contract test

Do not change `resolve_save_root`, browser-development root selection, `lib.rs`, or E2E root validation merely to support the identifier override; current non-E2E root resolution already uses the configured application-data base.

### Acceptance checks

- The supported Tauri development command uses `com.chanwaichan.lyra.dev`.
- Production keeps `com.chanwaichan.lyra` and existing player-facing save paths.
- Browser-development and E2E paths remain unchanged.
- No epoch, runtime-channel abstraction, startup warning, or new namespace error is added.
- Stale development saves remain loud through the existing strict parser and `contentRevision` checks.

## Workstream 3: one current format and one current StoryState model

### A. Remove unshipped compatibility machinery

Delete:

- `SaveEnvelopeV1`;
- `SaveSummaryV1`;
- `SAVE_SCHEMA_VERSION_V1`;
- the redundant `SAVE_SCHEMA_VERSION_V2` alias;
- `save/migrations.rs` and its registry/conversion tests;
- `dispatch_current`, `migrate_to_current`, `decode_summary_by_version`, and migration-only helpers;
- the `missingSaveSchemaMigration` diagnostic if no non-migration caller remains;
- the legacy V1 representative fixture and migration-only tests.

Keep only `SAVE_SCHEMA_VERSION: u32 = 2` and one strict current parser.

Rename the storage helper from migration language to current-format language, for example:

```text
migrate_and_validate_envelope -> parse_and_validate_envelope
```

Do not retain an empty migration module or registry.

### B. Preserve exact unsupported-format discovery behavior

For a file whose `schemaVersion` is not current:

- classify the slot as invalid with `unsupportedSaveSchemaVersion`;
- do not decode or expose a recap/summary using an unknown schema;
- retain only independently validated top-level metadata already supported by discovery, such as canonical save ID, valid timestamp/display name, and independently valid thumbnail state;
- do not attempt restore or normalization.

Add focused discovery tests covering current, unsupported, malformed, and content-revision-incompatible files.

### C. Apply the explicit current Rust naming decision

Rename current top-level types and helpers that HPA-540/HPA-260 directly touch:

```text
SaveEnvelopeV2           -> SaveEnvelope
SaveSummaryV2            -> SaveSummary
SaveSnapshotV1           -> SaveSnapshot
SceneProgressSnapshotV1  -> SceneProgressSnapshot
CapturedCheckpointV2     -> CapturedCheckpoint
capture_checkpoint_v2    -> capture_checkpoint
capture_scene_progress_v1 -> capture_scene_progress
```

Keep serialized field names and `schemaVersion: 2` unchanged.

Do not broaden this into a rename of every lower-level `*V1` dialogue-history, thumbnail, acquisition, inventory, or override record.

### D. Collapse StoryState persistence

Target flow:

```text
StoryState
  -> StoryStateSnapshot
  -> SaveSnapshot
```

- Embed the existing `StoryStateSnapshot` directly in `SaveSnapshot`.
- Remove the parallel save-specific StoryState snapshot family.
- Remove `story_snapshot_to_v1` / `story_snapshot_from_v1` field-for-field conversions.
- Remove `ResumableStateAdapter`; its single production implementation does not justify a trait.
- Keep strict `deny_unknown_fields`, semantic validation, deterministic collections, and mutable-runtime separation.
- Remove `#[allow(dead_code)]` from snapshot/origin helpers that acquire real production callers.

### E. Use origin as the sole persisted and public location authority

Remove:

- `AssertionOrigin::Migration`;
- migration-origin test helpers and restore branches;
- stored `asserted_in_chapter_id` / `asserted_in_scene_id` fields;
- stored `granted_in_chapter_id` / `granted_in_scene_id` fields;
- their snapshot equivalents.

Change:

```rust
AssertionOrigin::derived_location(
    &self,
) -> Result<(String, String), String>
```

Keep the `SceneEvent` and `AnalysisBoard` enum variants and their wire/public-view
shapes so HPA-260 can introduce the package-backed board registry without a
schema change. Two origin kinds are temporarily **rejected** from story-state
mutation, snapshot capture, and restore until their package-backed registries
exist; they are not validated against packaged definitions and are not
persisted:

- `AssertionOrigin::AnalysisBoard` is rejected by
  `ensure_origin_kind_is_persistable` and by the restore-time
  `AnalysisBoard` branch until HPA-260 adds a package-backed board registry.
- `AssertionOrigin::SceneEvent` with `block_kind: StoryEvent` is rejected by
  `ensure_origin_kind_is_persistable` and by the restore-time `StoryEvent`
  block-kind branch until a package-backed story-event registry exists.

The remaining `SceneEvent` block kinds (Sublocation, Hotspot, Topic,
InterrogationPhase, InquiryQuestion, TestimonyLine) continue to be validated
against current packaged scene/block definitions and accepted as before.

The public view should not repeat the same location three ways. Remove:

- `FactView.assertedInChapterId`;
- `FactView.assertedInSceneId`;
- `AuthorizationView.grantedInChapterId`;
- `AuthorizationView.grantedInSceneId`.

Use `originContext.location` as the public location source.

Because `Migration` is gone, replace the one-variant tagged origin-context union with a direct object:

```ts
export type OriginContextView = {
  originKind: "sceneEvent" | "analysisBoard";
  location: SceneLocationContextView;
};
```

Mirror that simplification in Rust. Remove migration branches and “imported progress” presentation from:

- `apps/game/src-tauri/src/game/story/view.rs`;
- `apps/game/src/lib/state/types.ts`;
- `CaseFileFactDetail.svelte`;
- `CaseFileAuthorizationDetail.svelte`;
- affected integration tests, component tests, case-file model fixtures, and test harnesses.

Before completion, search and classify every remaining active-code match:

```bash
rg -n \
  'AssertionOrigin::Migration|type: "migration"|originContext\.type|assertedInChapterId|assertedInSceneId|grantedInChapterId|grantedInSceneId' \
  apps/game/src-tauri/src apps/game/src apps/game/e2e-tauri
```

Historical docs may retain old design records; current runtime/UI/test code may not retain dead migration/public-location branches.

### F. Keep recap additive and non-authoritative

Fold recap work into current-format cleanup; it is not a separate feature phase.

- Add explicit Serde defaults to optional recap-copy fields where needed.
- Do not reconstruct absent recap prose.
- Preserve validated titles/labels when safe; render no prose when optional copy is absent.
- Preserve HPA-508 completion-aware spoiler rules.
- Present-but-mismatched recap copy remains invalid.

### G. Replace the representative fixture without key-order machinery

- Generate `current-representative.json` through the current Rust encoder or a Rust test helper.
- Validate it by decoding and comparing semantic typed values.
- Do not use Python to reconstruct JSON declaration order.
- Do not treat JSON object key order as a pre-release compatibility contract.
- Keep a byte-level assertion only if it protects a deliberate on-disk property other than object-key order.

### H. Limit save-version frontend/E2E edits to the actual surface

Known save-version sites:

1. `apps/game/e2e-tauri/save-fixtures.ts`
   - remove the `SaveE2eSaveEnvelopeV1 | SaveE2eSaveEnvelopeV2` union;
   - retain one current envelope type.
2. `apps/game/src/lib/persistence/types.test.ts`
   - change the representative valid metadata fixture from `schemaVersion: 1` to the current value.
3. `apps/game/e2e-tauri/save-seed.e2e.ts`
   - verify it compiles against the single current fixture type;
   - do not add migration behavior where no migration-specific branch exists.

`apps/game/src/lib/persistence/types.ts` already exposes `schemaVersion: number`; no production persistence-view redesign is planned.

After HPA-508 is rebased, remove only additional tests proven to exist solely for V1-to-V2 migration.

### Likely runtime/UI files

- `apps/game/src-tauri/src/game/save/schema.rs`
- `apps/game/src-tauri/src/game/save/migrations.rs` (delete)
- `apps/game/src-tauri/src/game/save/mod.rs`
- `apps/game/src-tauri/src/game/save/capture.rs`
- `apps/game/src-tauri/src/game/save/restore.rs`
- `apps/game/src-tauri/src/game/save/storage.rs`
- `apps/game/src-tauri/src/game/story/state.rs`
- `apps/game/src-tauri/src/game/story/mutations.rs`
- `apps/game/src-tauri/src/game/story/view.rs`
- `apps/game/src-tauri/src/game/test_support.rs`
- `apps/game/src/lib/state/types.ts`
- `apps/game/src/lib/components/case-file/CaseFileFactDetail.svelte`
- `apps/game/src/lib/components/case-file/CaseFileAuthorizationDetail.svelte`
- affected case-file tests/harnesses and the concrete save fixture/test files above

## Workstream 4: HPA-260 handoff and verification

### Handoff

Update HPA-260 implementation notes to require:

- `Analysis` is added to `SceneProgressSnapshot`;
- classify/order/threshold drafts use the current save model;
- accepted outputs use `AssertionOrigin::AnalysisBoard`;
- HPA-260 adds the package-backed board registry and removes the temporary
  `AnalysisBoard` rejection from `ensure_origin_kind_is_persistable` and the
  restore-time `AnalysisBoard` branch so the origin becomes persistable and
  restore-validated against that registry;
- the temporary `SceneEvent` with `block_kind: StoryEvent` rejection is **not**
  lifted by HPA-260; it awaits a separate package-backed story-event registry;
- no new envelope/snapshot generation or internal migration;
- no duplicate StoryState/Analysis DTO or generic adapter;
- deterministic checkpoints provide deep analysis states across builds.

### Focused verification during implementation

Run the smallest relevant tests after each logical change, especially:

- Tauri development config-contract tests;
- StoryState snapshot/mutation/view tests;
- current save parser/discovery/restore tests;
- case-file origin/location component and model tests;
- recap spoiler-safety tests after rebasing HPA-508;
- the concrete frontend/E2E save fixture consumers above.

Do not repeat the near-full matrix after every substep.

### Final acceptance and regression checklist

The implementation must preserve:

- atomic staged writes and directory synchronization;
- strict bounded parsing and typed diagnostics;
- thumbnail sidecar ownership and graceful capture failure;
- exact `contentRevision` gating;
- detached restore before live-session replacement;
- exact restore/recapture equality and final public-view validation;
- exhaustive `GameEngine` capture classification;
- session-generation and durable-revision stale-write guards;
- serialized writer, autosave debounce, and flush behavior;
- acquisition acknowledgement durability and rollback;
- stale manual overwrite/delete protection;
- corruption and incompatible-save discovery behavior;
- production slot counts, commands, events, and player-facing save flows;
- HPA-257 monotonic unlock and fixed-point reachability behavior.

Run one complete final gate after integration:

```bash
git diff --check
bun run check:scripts
bun run check
bun run --cwd apps/game check:e2e
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run test
bun run lint:all
bun run --cwd apps/game test:e2e:save
```

If packaged save E2E is unavailable, record the exact missing prerequisite and do not claim it passed.

## Suggested PR slices

These are review boundaries, not required commits:

1. Policy/guidance plus development identifier isolation.
2. One current parser plus current naming, StoryState/origin/public-view simplification, and recap defaults.
3. Concrete UI/E2E cleanup, fixture regeneration, HPA-260 handoff, and final verification fixes.

## Completion evidence

The implementation PR should include:

- the classified release-audit result;
- confirmation that Tauri dev uses a separate identifier without an epoch, warning, or hard startup guard;
- a list of removed V1/migration, duplicate StoryState, duplicate location, and public migration-origin surfaces;
- the final current Rust naming outcome;
- focused and final verification results;
- confirmation that no durable-write or restore invariant was relaxed.
