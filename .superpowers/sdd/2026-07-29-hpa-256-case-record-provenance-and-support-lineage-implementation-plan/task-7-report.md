# Task 7 Report — Enforce scene/catalog integrity at load and acquisition

## Status

Complete. Investigation/interrogation records are compared to the validated
catalog at every production scene-load boundary and again before acquisition.
Acquisition is fallible and validates before inventory/event/ordinal mutation;
internal inventory records retain an exact immutable provenance copy.

## Literal inventory

The required command was run before any edit and again after implementation:

```text
rtk rg -n \
  'EvidenceJson \{|StatementJson \{|EvidenceRecord \{|StatementRecord \{' \
  apps/game/src-tauri
```

Both runs found 69 occurrences across the same complete path set:

```text
apps/game/src-tauri/src/game/acquisition.rs                                      4
apps/game/src-tauri/src/game/command_tx.rs                                       9
apps/game/src-tauri/src/game/mod.rs                                             27
apps/game/src-tauri/src/game/navigation.rs                                       1
apps/game/src-tauri/src/game/reveals.rs                                          2
apps/game/src-tauri/src/game/save/capture.rs                                     6
apps/game/src-tauri/src/game/save/coordinator/tests/acknowledgement.rs           2
apps/game/src-tauri/src/game/save/restore.rs                                     5
apps/game/src-tauri/src/game/schema.rs                                           2
apps/game/src-tauri/src/game/state.rs                                            6
apps/game/src-tauri/src/game/test_support.rs                                     5
```

Every `EvidenceJson`/`StatementJson` Rust literal retains explicit provenance.
Every `EvidenceRecord`/`StatementRecord` literal now has explicit provenance;
production construction in `Inventory::add_*_from_def` copies the definition
value. Focused test helpers use deliberate neutral or exact non-neutral
provenance. No broad `Default` was added to a complete record type.

## Files

- `game/provenance.rs`
  - Added the single-record exact comparison and the required shared
    `validate_scene_records_against_catalog`.
- `game/loader.rs`
  - Added the catalog-aware loader and retained only a `#[cfg(test)]`,
    clearly named pre-catalog decoder for reference/parser tests.
  - Added chapter, scene, and provenance mismatch tests plus neutral/full
    matching tests.
- `game/navigation.rs`, `game/mod.rs`
  - Threaded `StoryCatalog` through startup, advance, jump, scene lookup,
    navigation-index construction, debug grant-all, inventory dialogue origin,
    and packaged acquisition lookup.
  - Changed duplicate chapter resolution in `packaged_acquisition_scene` from
    the reserved `acquisitionDefinitionMismatch` code to the established
    `duplicateChapterTarget` code.
- `game/dialogue_queue.rs`, `game/save/capture.rs`,
  `game/save/restore.rs`
  - Made dialogue-origin, capture, and restore definition loading
    catalog-aware.
- `game/acquisition.rs`, `game/reveals.rs`
  - Added the catalog to `AcquisitionCtx`, made evidence/statement acquisition
    and reveal helpers fallible, propagated errors, and covered pre-mutation
    atomicity plus exact provenance copying.
- `game/state.rs`
  - Added immutable provenance to both internal inventory record types and
    copied it separately from acquisition chapter/scene.
- `game/command_tx.rs`, `game/test_support.rs`,
  `game/save/coordinator/tests/acknowledgement.rs`
  - Updated explicit record literals and aligned focused fixture catalogs.
- `tests/fixtures/scenes/story_catalog.json`,
  `tests/fixtures/full_scenes/story_catalog.json`
  - Aligned active v2 catalog indexes with the packaged scene manifests.

`game/scenes/investigation.rs` and `game/scenes/interrogation.rs` required no
edit: they own scene-local progress only; all acquisition entry points are in
`GameEngine`/`reveals`, and all definition installation is centralized through
the catalog-aware navigation loader.

## RED

The required commands were run after adding the tests and before production
implementation:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::loader::tests -- --nocapture
cargo test: 11 errors, 0 warnings (1 crates)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::acquisition::tests -- --nocapture
cargo test: 11 errors, 0 warnings (1 crates)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::reveals::tests -- --nocapture
cargo test: 11 errors, 0 warnings (1 crates)
```

The intended errors were: missing `load_scene_with_catalog`; missing
`AcquisitionCtx.catalog`; acquisition still returning `bool`; reveals still
returning `Vec`; and missing provenance on `EvidenceRecord`/`StatementRecord`.
This directly demonstrated the mismatch, atomicity/fallibility, propagation,
and immutable-copy gaps.

The first cross-suite run after production implementation exposed only
catalog-fixture drift:

```text
test result: FAILED. 585 passed; 18 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.08s
```

All 18 failures were active test scenes containing records while their catalog
was empty, plus one capture test that cloned a record-bearing chapter under a
second chapter ID. The catalogs were aligned; the capture fixture now duplicates
only its linear scene, preserving its same-scene-ID-across-chapters test intent.

## GREEN

Required focused commands after the final edits:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::state::tests -- --nocapture
cargo test: 1 passed, 621 filtered out (5 suites, 0.00s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::acquisition::tests -- --nocapture
cargo test: 8 passed, 614 filtered out (5 suites, 0.00s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::reveals::tests -- --nocapture
cargo test: 7 passed, 615 filtered out (5 suites, 0.00s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::navigation::tests -- --nocapture
cargo test: 21 passed, 601 filtered out (5 suites, 0.02s)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::loader::tests -- --nocapture
cargo test: 11 passed, 611 filtered out (5 suites, 0.01s)
```

Final completion gate:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test: 622 passed (6 suites, 1.23s)

cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
exit 0

cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.35s

git diff --check
exit 0
```

## Self-review

- Confirmed exact comparison uses typed `InventoryTarget`, acquisition chapter,
  owning scene ID, and complete `CaseRecordProvenance` equality.
- Confirmed missing or opposite-kind catalog identity maps to
  `caseRecordDefinitionMismatch`; linear scenes are unaffected.
- Confirmed the low-level decoder is `#[cfg(test)]` and every non-test scene
  load reaches `load_scene_with_catalog`.
- Confirmed startup, advance, jump, navigation index, packaged acquisition,
  debug grant-all, dialogue-origin, capture, and restore routes all carry the
  validated catalog.
- Confirmed acquisition validates before `add_*_from_def`, event insertion, or
  ordinal increment; the failing test retains a seeded event and ordinal.
- Confirmed valid evidence and statement acquisitions preserve exact
  non-neutral provenance while keeping acquisition origin fields separate.
- Confirmed every reveal caller propagates `?`, so command transactions retain
  their existing rollback behavior.
- Confirmed all 69 constructor-family occurrences were re-audited after edits,
  production constructors stay explicit, and no complete record gained a
  misleading broad default.
- Confirmed `acquisitionDefinitionMismatch` remains reserved for pending-event
  kind versus owning-scene disagreement; duplicate packaged chapter identity
  now returns `duplicateChapterTarget`.

## Concerns

No unresolved Task 7 concerns. The debug grant-all route intentionally remains
best-effort for unreadable scenes, but any scene it does expose or acquire from
has already passed the same catalog-aware loader.
