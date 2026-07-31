# HPA-258 PR A Rust-suite regression report

## Scope

This report covers the full Rust-suite regressions found during final verification of PR A at baseline `38c79f7be36f74c09c9b54cb15d3e475f94afff3`.

## Root cause

The failures had two test-harness causes introduced by Task 1's approved eager, immutable story-location index:

1. Direct in-memory `GameEngine` fixtures still installed `StoryLocationIndex::empty()`. Public view construction now resolves inventory and story origins through the retained index, so otherwise valid direct-engine tests failed with `storyLocationMissing` before reaching the behavior under test. The same gap caused acknowledgement tests to return `storyLocationMissing` before their intended persistence failure tokens.
2. Three tests packaged an invalid future scene or duplicate scene IDs and expected a later navigation/transition failure. Task 1 loads every packaged scene through the validating loader while constructing the index in `GameEngine::new_started`, so those package states are now rejected at startup and the old lazy-failure timing is unreachable.

No production indexing or fail-closed behavior was weakened. The fixture fix is a `cfg(test)` constructor that builds an index directly from in-memory `SceneJson` identities and performs no scene I/O.

## RED evidence

Representative exact tests on the baseline failed as follows:

- `game::tests::auto_phase_does_not_complete_without_manual_trigger`: `storyLocationMissing` for `chapter_1/manual_complete`.
- `game::save::coordinator::tests::acknowledgement::failed_acknowledgement_restores_event_and_preserves_prior_slot_file`: received `storyLocationMissing` instead of `saveReplaceFailed`.
- `game::command_tx::tests::failed_initial_silent_investigation_transition_rolls_back_inventory`: `new_started` returned `sceneValidationFailed` because the manifest declared interrogation while the JSON contained a linear scene.
- `game::command_tx::tests::failed_scene_advance_through_tag_only_prime_keeps_previous_dialogue_view`: the same eager `sceneValidationFailed` during `new_started`.
- `game::navigation::tests::scene_lookup_rejects_duplicate_scene_ids_as_ambiguous`: `new_started` returned `duplicateSceneTarget`.

Strict TDD for the fixture seam was recorded by adding `test_fixture_constructor_indexes_the_in_memory_scene_identity` and observing the expected compile failure: `no associated function or constant named for_test_scene found for StoryLocationIndex`.

The first broad `game::tests::` run after the one-scene fixture fix found one additional RED: `inventory_reexamine_keeps_the_acquisition_scene_kind_in_its_origin` failed with `storyLocationMissing` for its distinct acquisition source `chapter_1/investigation_scene_0`. The constructor was therefore generalized to accept all in-memory scenes needed by a fixture, and that test seeds both the current interrogation scene and its investigation acquisition source.

## Semantic test updates

The invalid-package tests now assert the reachable eager contract:

- `failed_scene_advance_through_tag_only_prime_keeps_previous_dialogue_view` became `startup_rejects_invalid_future_scene_before_tag_only_transition` and expects `sceneValidationFailed` from `new_started`.
- `failed_initial_silent_investigation_transition_rolls_back_inventory` became `startup_rejects_invalid_future_scene_before_silent_investigation_transition` and expects `sceneValidationFailed` from `new_started`.
- `scene_lookup_rejects_duplicate_scene_ids_as_ambiguous` became `duplicate_scene_ids_are_rejected_by_lookup_and_startup`; it retains the defense-in-depth direct lookup assertion and expects `duplicateSceneTarget` from `new_started`.

A valid-then-corrupt index seam was not added. Those three tests described package states that startup validation intentionally makes unreachable, while the existing transaction tests continue to cover rollback for reachable command failures.

## GREEN evidence

Exact representative reruns passed, including the fixture constructor, `auto_phase_does_not_complete_without_manual_trigger`, the failed-acknowledgement persistence test, the two renamed eager scene-validation tests, the renamed duplicate-scene test, and the acquisition-scene-kind test.

Focused groups passed:

- `story_location`: 8 passed.
- `command_tx`: 23 passed.
- `navigation`: 22 passed.
- `acknowledgement`: 23 passed.
- `game::tests::`: 59 passed.

Broad verification passed:

- `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`: 662 passed across 6 suites.
- `bun run lint:all`: passed ESLint, Prettier, Rust format checks, and Clippy with warnings denied. The layout-editor build script emitted the existing macOS `xcrun` temporary-directory warning, but the command exited successfully.
- `git diff --check`: recorded at the final verification gate.

## Remaining concerns

None identified in the Rust harness. The test-only constructor deliberately asserts on duplicate fixture scene IDs so invalid direct fixtures fail at construction, while production continues to return typed errors through `StoryLocationIndex::load`.
