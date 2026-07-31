# HPA-258 PR B Save Schema V2 — Implementation Tasks 13–14

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Follow the parent plan `2026-07-30-hpa-258-case-file-recap-implementation-plan.md`, execute these tasks in order, verify each red test fails for the intended reason, and commit only after the focused green commands pass.

## Task 13: Introduce save-envelope schema v2 and a real v1 migration

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/migrations.rs`
- Create or modify focused migration tests in those modules
- Modify: `apps/game/src-tauri/src/game/error.rs` only if existing migration errors need wiring, not new semantics

**Interfaces:**
- Consumes: existing `SaveEnvelopeV1`, `SaveSnapshotV1`, and version-envelope parsing.
- Produces: `SaveSummaryV1`, `SaveSummaryV2`, `SaveEnvelopeV2`, and `migrate_to_current(...)` for Task 14.

- [ ] **Step 1: Freeze exact v1 JSON before renaming**

Add a golden unit test serializing the current envelope and compare the complete JSON value. Rename `SaveSummary` to `SaveSummaryV1`; rerun and prove the wire is identical.

- [ ] **Step 2: Write failing migration tests**

Assert v1→v2 preserves all envelope fields and `SaveSnapshotV1`, while setting exactly:

```rust
chapter_summary: None,
scene_summary: None,
active_primary_objective_summary: None,
```

Assert v2 passes through unchanged, version 3 returns `unsupportedSaveSchemaVersion`, and a registry entry with a missing 1→2 link returns `missingSaveSchemaMigration`.

- [ ] **Step 3: Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::migrations -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema -- --nocapture
```

- [ ] **Step 4: Implement version-specific decode and migration**

`schema.rs` owns strict version-specific structs. `migrations.rs` owns:

```rust
pub(crate) fn migrate_to_current(bytes: &[u8]) -> Result<SaveEnvelopeV2, GameError>;
```

Read a minimal schema-version envelope first; decode v1 or v2 with `deny_unknown_fields`; transform v1 without any `CurrentDefinitions` parameter or package lookup.

- [ ] **Step 5: Keep schema and content compatibility separate**

Migration returns a structurally current envelope preserving the original `content_revision`. Exact package compatibility remains a later restore/discovery validation step.

- [ ] **Step 6: Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::migrations -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema -- --nocapture
rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml -- -D warnings
```

- [ ] **Step 7: Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/save/schema.rs \
  apps/game/src-tauri/src/game/save/migrations.rs \
  apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: migrate saves to schema version two"
```

---

## Task 14: Write/read/restore V2 envelopes and recap summaries

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/save/coordinator.rs`
- Modify coordinator tests under `apps/game/src-tauri/src/game/save/coordinator/tests/`
- Modify storage/restore tests and fixtures
- Modify: `apps/game/e2e-tauri/save-fixtures.ts`

**Interfaces:**
- Consumes: V2 types/migration from Task 13 and chapter/scene/objective summaries from Task 11.
- Produces: V2 disk writes, migrated V2 discovery metadata, transactional V2 restore.

- [ ] **Step 1: Write failing capture tests**

Assert a new checkpoint contains chapter summary, scene summary, and active-objective summary. Assert no-active-objective yields all three objective fields null. Rename `CapturedCheckpointV1`/`capture_checkpoint_v1` to V2/current names consistently.

- [ ] **Step 2: Write failing storage/discovery tests**

Cover:

- new writes contain `schemaVersion: 2`;
- valid v1 fixture migrates and exposes `SaveSummaryV2` with null new copy;
- readable invalid v1 metadata exposes `Option<SaveSummaryV2>` after migration;
- public valid metadata reports schema version 2;
- migration with matching synthetic revision succeeds;
- old-package revision still fails exact compatibility after migration;
- manual/autosave selection ordering is unchanged.

- [ ] **Step 3: Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::capture -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator -- --nocapture
```

- [ ] **Step 4: Move write paths to `SaveEnvelopeV2`**

Update `SlotWriteRequest`, prepared writes, coordinator checkpoints, and committed outcomes to V2. Serialize only V2 for new writes. Keep thumbnail descriptors and opaque save IDs unchanged.

- [ ] **Step 5: Migrate before validate/restore**

Discovery and load call `migrate_to_current` first, then current V2 validation, then exact `contentRevision`, then candidate reconstruction. Restore continues to use `SaveSnapshotV1` and exact recapture.

- [ ] **Step 6: Update both public metadata projections**

Set:

```rust
SaveMetadataView.summary: SaveSummaryV2,
ReadableSaveMetadataView.summary: Option<SaveSummaryV2>,
```

Do not add fallback strings to missing summary fields.

- [ ] **Step 7: Update E2E fixtures**

`save-fixtures.ts` must generate schema-v2 envelopes with explicit nullable recap fields and keep one frozen schema-v1 fixture for migration coverage.

- [ ] **Step 8: Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save -- --nocapture
rtk bun run --cwd apps/game check:e2e
rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml -- -D warnings
```

- [ ] **Step 9: Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/save \
  apps/game/e2e-tauri/save-fixtures.ts
rtk git commit -m "feat: persist authored save recaps"
```

---
