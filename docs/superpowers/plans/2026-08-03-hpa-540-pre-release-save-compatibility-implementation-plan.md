# HPA-540 Pre-Release Save Compatibility Simplification Plan

## Goal

Implement the policy in:

- `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`

Leave Lyra with one current pre-release save format and one current StoryState snapshot so HPA-260 can add Chapter 1 analysis drafts without creating an internal migration chain or duplicate persistence model.

## Preconditions and order

Re-run the release audit before deleting legacy decoding:

```bash
git tag --list
gh release list --repo cwchanap/Lyra
rg -n --hidden \
  'save compatibility|backward-compatible save|preserve player saves|released save schema|public build' \
  README.md CLAUDE.md docs .github apps packages
```

Current expected result, based on the planning review:

```text
git tags: 0
GitHub releases: empty
no documented shipped-save compatibility promise
```

If the audit finds a real compatibility promise, stop and redesign the work around a released legacy module.

Required merge order:

```text
HPA-508 -> HPA-540 -> HPA-260
```

## Scope guard

This ticket changes compatibility policy, duplicate persistence representations, and the supported Tauri development identifier only.

Do not include `SaveCoordinator` decomposition, browser HTTP transport removal, compiler source-root cleanup, reveal-enum redesign, `SupportLineage` deletion, E2E suite restructuring, thumbnail renderer work, HPA-257 changes, or Chapter 2 compatibility work.

## Workstream 1: policy and repository guidance

### Changes

- Keep the policy spec as the durable decision record.
- Link it from contributor/agent guidance and the save module.
- Record the concrete release-audit result in the implementation PR.
- Keep serialized `schemaVersion: 2`; do not renumber for aesthetics.
- Document the chosen Rust naming boundary:
  - rename active top-level current types to `SaveEnvelope`, `SaveSummary`, `SaveSnapshot`, and `SceneProgressSnapshot`;
  - use `StoryStateSnapshot` directly;
  - do not broadly rename lower-level `*V1` records unless functional work already touches them.

### Checks

- HPA-260 is explicitly prohibited from creating a new envelope/snapshot generation, duplicate Analysis/StoryState DTO, or generic resumable-state framework.
- The policy does not enumerate implementation-era regression invariants that belong in this plan.

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
- a release-build-versus-development-identifier guard.

### Changes

- Edit `apps/game/src-tauri/tauri.dev.conf.json`, preserving existing keys, and set the top-level identifier to `com.chanwaichan.lyra.dev`.
- Keep the normal non-E2E save root as `configured_app_data.join("saves")`; the different identifier supplies the different app-data base.
- Confirm `bun run dev:game` and the game package's Tauri development script load `tauri.dev.conf.json`.
- In debug builds only, optionally emit a clear startup warning when the production identifier is loaded. The warning must not introduce a new error type or block startup.
- Document manual cleanup of the development `saves/` directory after breaking changes.

### Likely files

- `apps/game/src-tauri/tauri.dev.conf.json`
- `apps/game/src-tauri/src/lib.rs` only if adding the debug warning
- existing package/config contract tests

Do not change browser-development or E2E root resolution unless a current test demonstrates that the identifier change requires it.

### Acceptance checks

- The supported Tauri development command uses `com.chanwaichan.lyra.dev`.
- Production keeps `com.chanwaichan.lyra` and existing player-facing save paths.
- Browser-development and E2E paths remain unchanged.
- A plain debug startup using the production identifier still runs; if a warning is implemented, it is visible and tested only as needed.
- Stale development saves remain fail-closed through the existing strict parser and `contentRevision` checks.

## Workstream 3: one current format and one current StoryState snapshot

### A. Remove unshipped compatibility machinery

- Delete `SaveEnvelopeV1`, `SaveSummaryV1`, `SAVE_SCHEMA_VERSION_V1`, and the V1-to-V2 migration registry.
- Delete migration-only diagnostics, the legacy V1 fixture, and tests that only characterize the unshipped transition.
- Keep one strict current decoder and typed unsupported-format diagnostics.
- Do not retain an empty migration abstraction.

### B. Apply the explicit Rust naming decision

Because the top-level types are already being edited, rename:

```text
SaveEnvelopeV2       -> SaveEnvelope
SaveSummaryV2        -> SaveSummary
SaveSnapshotV1       -> SaveSnapshot
SceneProgressSnapshotV1 -> SceneProgressSnapshot
```

Keep serialized field names and `schemaVersion: 2` unchanged.

Do not broaden this into a rename of every lower-level `*V1` structure.

### C. Collapse StoryState persistence

Target flow:

```text
StoryState
  -> StoryStateSnapshot
  -> SaveSnapshot
```

- Embed `StoryStateSnapshot` directly in `SaveSnapshot`.
- Remove the parallel save-specific StoryState snapshot family.
- Remove `story_snapshot_to_v1` / `story_snapshot_from_v1` field-for-field conversions.
- Remove `ResumableStateAdapter`; its single production implementation does not justify a trait.
- Keep strict validation and deterministic ordering; do not serialize mutable runtime objects directly.

### D. Use origin as the location authority

- Remove `AssertionOrigin::Migration` and migration-only helpers/tests.
- Keep `SceneEvent` and `AnalysisBoard`.
- Change `AssertionOrigin::derived_location` from:

```rust
Result<(Option<String>, Option<String>), String>
```

to:

```rust
Result<(String, String), String>
```

- Remove duplicated asserted/granted chapter and scene fields from fact and authorization progress/snapshots.
- Derive location from `first_origin` for public views and validation.
- Continue resolving origins against packaged scene/block/board definitions during restore.

The existing dead-code `derived_location` implementation is evidence that this derivation was already built ahead of its first caller; HPA-540 should activate and simplify it rather than introduce another representation.

### E. Keep recap additive and non-authoritative

Fold recap work into this workstream; it is not a separate feature phase.

- Add explicit Serde defaults to optional recap-copy fields where needed.
- Do not reconstruct absent recap prose.
- Preserve validated titles/labels when safe; render no prose when optional copy is absent.
- Preserve HPA-508 completion-aware spoiler rules.
- Present-but-mismatched recap copy remains invalid.

### F. Replace the representative fixture without key-order machinery

- Generate `current-representative.json` through the current Rust encoder or a Rust test helper.
- Validate it by decoding and comparing semantic typed values.
- Do not use Python to reconstruct JSON declaration order.
- Do not treat JSON object key order as a pre-release compatibility contract.

### G. Limit frontend/E2E edits to the actual surface

Known current sites:

1. `apps/game/e2e-tauri/save-fixtures.ts`
   - remove the `SaveE2eSaveEnvelopeV1 | SaveE2eSaveEnvelopeV2` union;
   - retain one current envelope type.
2. `apps/game/src/lib/persistence/types.test.ts`
   - change the representative valid metadata fixture from `schemaVersion: 1` to the current value.
3. `apps/game/e2e-tauri/save-seed.e2e.ts`
   - verify it compiles against the single current fixture type;
   - do not add migration behavior if no migration-specific branch exists.

`apps/game/src/lib/persistence/types.ts` already exposes `schemaVersion: number`; no production frontend type redesign is planned.

After HPA-508 is rebased, remove only additional tests proven to exist solely for V1-to-V2 migration. Do not perform a broad frontend search-and-redesign exercise.

### Likely runtime files

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
- the concrete fixture/test files listed above

## Workstream 4: HPA-260 handoff and verification

### Handoff

Update HPA-260 implementation notes to require:

- `Analysis` is added to `SceneProgressSnapshot`;
- classify/order/threshold drafts use the current save model;
- accepted outputs use `AssertionOrigin::AnalysisBoard`;
- no new envelope/snapshot generation or internal migration;
- no duplicate StoryState/Analysis DTO or generic adapter;
- deterministic checkpoints provide deep analysis states across builds.

### Focused verification during implementation

Run the smallest relevant tests after each logical change, especially:

- Tauri development config-contract tests;
- StoryState snapshot/capture/restore tests;
- current decoder/discovery tests;
- recap spoiler-safety tests after rebasing HPA-508;
- the concrete frontend/E2E fixture consumers above.

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
2. One current decoder plus top-level naming, StoryState/origin simplification, and recap defaults.
3. Concrete frontend/E2E cleanup, fixture regeneration, HPA-260 handoff, and final verification fixes.

## Completion evidence

The implementation PR should include:

- the concrete release-audit result;
- confirmation that Tauri dev uses a separate identifier without an epoch or hard startup guard;
- a list of removed V1/migration and duplicate StoryState surfaces;
- confirmation that `derived_location` is non-optional after removing `Migration`;
- the final Rust naming outcome;
- focused and final verification results;
- confirmation that no durable-write or restore invariant was relaxed.