# HPA-540 Pre-Release Save Compatibility Simplification Plan

## Goal

Implement the policy in:

- `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`

Leave Lyra with one current pre-release save format and one current StoryState snapshot so HPA-260 can add Chapter 1 analysis drafts without creating an internal migration chain or duplicate persistence model.

## Preconditions and order

1. Verify that no public release, tag, installer, or documented promise requires compatibility with an existing Lyra save format.
2. Merge and rebase on HPA-508 before final recap integration and test cleanup.
3. Merge HPA-540 before HPA-260.

Required order:

```text
HPA-508 -> HPA-540 -> HPA-260
```

If the release audit finds a real compatibility promise, stop and redesign the work around a released legacy module.

## Scope guard

This ticket changes compatibility policy, duplicate persistence representations, and development namespace selection only.

Do not include:

- `SaveCoordinator` decomposition;
- browser HTTP transport removal;
- compiler source-root cleanup;
- reveal-enum redesign;
- `SupportLineage` deletion;
- E2E suite restructuring;
- thumbnail renderer work;
- HPA-257 scope changes;
- Chapter 2 compatibility work.

## Workstream 1: policy and release audit

### Changes

- Keep the policy spec as the durable decision record.
- Link it from contributor/agent guidance and the save module.
- Record the release-audit result in the implementation PR.
- Keep the current serialized `schemaVersion` value; do not renumber for aesthetics.

### Checks

- No shipped-save compatibility promise exists.
- The repository guidance clearly separates backward compatibility from durability and restore correctness.
- HPA-260 is explicitly prohibited from creating `SaveEnvelopeV3`, `SaveSnapshotV2`, duplicate Analysis/StoryState DTOs, or a generic resumable-state framework.

## Workstream 2: isolate development save namespaces

### Target behavior

Use direct build-mode and identifier checks; do not add a `SaveRuntimeChannel` enum unless implementation evidence shows it is necessary.

```text
e2e feature
  -> keep existing validated temporary E2E root

non-e2e release + com.chanwaichan.lyra
  -> existing production saves root

non-e2e debug + com.chanwaichan.lyra.dev
  -> saves-dev/epoch-<DEVELOPMENT_SAVE_EPOCH>

any other combination
  -> typed unsafeSaveNamespace failure
```

Browser development reuses the same `development_save_root(base)` helper under its existing repository-local base. Moving to `saves-dev/epoch-<N>` is an intentional one-time reset: do not copy, migrate, or automatically delete the old directory.

### Likely files

- `apps/game/src-tauri/src/game/save/storage.rs`
- `apps/game/src-tauri/src/game/error.rs`
- `apps/game/src-tauri/src/lib.rs`
- `apps/game/src-tauri/tauri.dev.conf.json`
- `apps/game/src-tauri/examples/dev_engine_server.rs`
- existing save-path/config contract tests

### Acceptance checks

- Production, development, and E2E identifiers remain distinct.
- `bun run dev:game` loads the development config and selects the epoch root.
- A debug startup with the production identifier fails closed.
- A release build cannot select the development root.
- E2E root validation is unchanged.
- Bumping `DEVELOPMENT_SAVE_EPOCH` selects a clean namespace without migration or deletion.

## Workstream 3: one current format and one current StoryState snapshot

### A. Remove unshipped compatibility machinery

- Delete `SaveEnvelopeV1`, `SaveSummaryV1`, and the V1-to-V2 migration registry.
- Delete migration-only diagnostics, fixtures, TypeScript unions, and E2E branches that no longer have callers.
- Keep one strict current decoder and typed unsupported-format diagnostics.
- Do not retain an empty migration abstraction.

### B. Collapse StoryState persistence

Target flow:

```text
StoryState
  -> StoryStateSnapshot
  -> current SaveSnapshot
```

- Embed the existing dedicated `StoryStateSnapshot` directly in the current save snapshot.
- Remove the parallel save-specific StoryState snapshot family.
- Remove `story_snapshot_to_v1` / `story_snapshot_from_v1` identity conversions.
- Remove `ResumableStateAdapter` unless the implementation demonstrates at least two current production implementations with materially different behavior.
- Keep strict validation and deterministic ordering; do not serialize mutable runtime objects directly.

### C. Use origin as the location authority

- Remove duplicated persisted chapter/scene fields from fact and authorization progress.
- Derive those locations from `AssertionOrigin` when building views and validating state.
- Keep `SceneEvent` and `AnalysisBoard` origins.
- Remove the unshipped `Migration` origin and migration-only helpers/tests.
- Continue resolving origins against packaged scene/block/board definitions during restore.

### D. Keep recap additive and non-authoritative

Fold recap work into this workstream; it is not a separate feature phase.

- Add explicit Serde defaults to optional recap-copy fields where needed.
- Do not reconstruct absent recap prose.
- Preserve validated titles/labels when safe; render no prose when optional copy is absent.
- Preserve HPA-508 completion-aware spoiler rules.
- Present-but-mismatched recap copy remains invalid.

### E. Replace the representative fixture without key-order surgery

- Generate `current-representative.json` through the current Rust encoder or a Rust test helper.
- Validate the fixture by decoding it and comparing semantic typed values.
- Do not use Python to reconstruct JSON declaration order.
- Do not treat JSON object key order as a compatibility requirement before the first shipped schema.
- Keep deterministic encoder coverage where useful, but avoid a byte-exact golden assertion whose only signal is field order.

### Likely files

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
- current save fixtures and frontend/E2E mirrors

### Acceptance checks

- Only one current envelope and snapshot family remains active.
- `SaveSnapshot` contains one `StoryStateSnapshot` representation.
- StoryState round-trip preserves facts, questions, objectives, authorizations, support sets, first origins, and active primary objective.
- Public case-file and authorization views remain equivalent after location deduplication.
- Unsupported formats remain discoverable as typed invalid/incompatible saves.
- Missing recap prose does not affect restore and cannot expose unfinished-scene outcomes.
- Existing current manual/autosave flows still pass capture, atomic write, discovery, detached restore, exact recapture, and public-view validation.

## Workstream 4: HPA-260 handoff and final verification

### Handoff

Update HPA-260 implementation notes to require:

- `Analysis` is added to the current scene-progress snapshot;
- classify/order/threshold drafts use the current save model;
- accepted outputs use `AssertionOrigin::AnalysisBoard`;
- no new envelope/snapshot version or internal migration;
- no duplicate StoryState/Analysis DTO or generic adapter;
- deterministic checkpoints provide deep analysis states across builds.

### Focused verification during implementation

Run the smallest relevant tests after each logical change, especially:

- save-root resolution and config-contract tests;
- StoryState snapshot/capture/restore tests;
- current decoder/discovery tests;
- recap spoiler-safety tests after rebasing HPA-508;
- current frontend/E2E fixture type checks.

Do not repeat the near-full matrix after every substep.

### Final verification gate

Run once after all changes are integrated:

```bash
bun run check:scripts
bun run check
bun run --cwd apps/game check:e2e
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run test
bun run lint:all
bun run --cwd apps/game test:e2e:save
```

If packaged save E2E is unavailable in the execution environment, record the exact missing prerequisite and run the remaining complete gate; do not claim packaged verification passed.

## Suggested PR slices

These are review boundaries, not a required commit ritual:

1. Policy/guidance plus namespace isolation.
2. One current decoder plus StoryState/origin simplification and recap defaults.
3. Frontend/E2E mirror cleanup, fixture regeneration, HPA-260 handoff, and final verification fixes.

## Completion evidence

The implementation PR should include:

- the release-audit result;
- the final namespace map and fail-closed behavior;
- a list of removed V1/migration and duplicate StoryState surfaces;
- confirmation that no durability/restore invariant was relaxed;
- focused and final verification results;
- confirmation that HPA-260 can add current Analysis state without a migration or duplicate DTO.
