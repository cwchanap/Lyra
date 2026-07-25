# Task 6 report — migrate existing scene runtimes

Status: **DONE**

Implementation commit:

- `3ce991a7b01d70a19644f0203a3cbef9721aabf8` — `feat: migrate runtime dialogue queues`

## Outcome

Linear, investigation, and interrogation runtimes now install and advance the
Task 5 segmented dialogue queue while preserving the public flattened
`QueueToken`, visible item order, scene-tag consumption, remaining count,
dialogue history, and transactional rollback behavior.

The migration includes:

- typed stable origins for linear bodies, investigation intro/outro and
  interactions, interrogation intro/outro, phase entry, questions, testimony
  lines, challenge replies, loops, and inventory acquisition/re-examination;
- one queue generation for composite trigger/reveal/acquisition dialogue, with
  authored body, `onCollect`, and `onAcquire` retained as ordered segments;
- explicit segment boundaries for testimony content and loop bridges without
  changing the flattened frontend cursor contract;
- source-scene-kind lookup for inventory re-examination, so an item acquired
  in an investigation keeps an `InvestigationInteraction` origin even when
  re-examined from an interrogation;
- deterministic engine-owned `（沒有新發現。）` fallback for only the four
  closed hotspot/topic/evidence/statement re-examination roles, shared by live
  installation and reconstruction;
- focused Task 7-only dead-code annotations rather than a module-wide
  suppression;
- required content-manifest fixtures for integration resources, closing the
  Task 4 test-fixture drift exposed by the full-playthrough gate;
- design and implementation-plan clarification that the fallback is outside
  the package bundle and incompatible changes require a save-schema or
  compatibility revision.

## TDD evidence

Characterization tests were added before the production migration for linear,
investigation, and interrogation public frames. The linear characterization
first exposed a missing test content manifest; after adding the test-local
manifest, all three passed against the pre-migration behavior.

The new runtime boundary tests were then added before changing the queue
producers. The composite test failed to compile because the old flat
`Vec<DialogueItem>`/`DialogueQueue` did not expose segment origins or
coordinates. After the migration, the linear/investigation stable-origin,
composite generation, interrogation phase/loop boundary, public-frame, and
closed fallback tests all passed.

A later review regression was also driven RED to GREEN:
`inventory_reexamine_keeps_the_acquisition_scene_kind_in_its_origin` initially
observed an incorrect current-mode `InterrogationPhase` origin; it now observes
the acquisition-source `InvestigationInteraction` origin.

## Verification

- `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::dialogue::tests --lib`
  — 17 passed.
- `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::scenes:: --lib`
  — 26 passed.
- `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml investigation_composite_queue_is_one_generation_with_body_collect_acquire_segments --lib`
  — 1 passed.
- `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::reveals::tests --lib`
  — 6 passed.
- `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml --test full_playthrough`
  — 8 passed.
- `rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml`
  — 240 passed across 6 suites.
- `cargo check --manifest-path apps/game/src-tauri/Cargo.toml`
  — passed without warnings.
- `cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all -- --check`
  — passed.
- `cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets -- -D warnings`
  — passed.
- Commit hook additionally ran
  `cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  — passed.
- `git diff --check` — passed.

The first focused full-playthrough run failed all 8 cases only because the two
integration fixture roots lacked the content manifest made mandatory by Task
4. Adding valid minimal fixture manifests resolved all 8 failures; no gameplay
behavior assertion failed.

## Concerns

None. Task 7 reconstruction adapters remain intentionally crate-private and
unused by production save/load code until their scheduled task.
