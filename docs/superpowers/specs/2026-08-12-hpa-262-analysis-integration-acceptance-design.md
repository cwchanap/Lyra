# HPA-262 Analysis Integration Acceptance Design

## Status

Planning only. HPA-262 is now an integration/acceptance closure ticket over the already-shipped HPA-259 compiler, HPA-260 Rust runtime, and HPA-261 workbench. It must not reimplement those layers or prematurely author production Beat 8.5 content owned by HPA-265.

## Why this is the next actionable task

HPA-262 is High priority and all of its listed prerequisite blockers are now complete. It is the next gate in the Chapter 1-first roadmap and currently blocks both HPA-264 (hearing-granted authorization) and HPA-265 (real Beat 8.5 authoring/iteration).

HPA-123 has been lowered to Medium and its planning PR closed. HPA-603 is a real latent practice-card contract inconsistency, but the current P1 Auto outro requires all four unlocked practice-producing hotspots before scene exit, so it does not block the current happy-path Chapter 1 vertical slice. HPA-262 therefore has higher immediate product value.

## Current baseline

### HPA-259 already owns compiler/schema correctness

The checked-in Chapter-1-shaped fixture under:

```text
packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/
```

already compiles a three-board Analysis scene with:

1. `evidence_packages` — Classify;
2. `local_event_sequence` — Order;
3. `narrow_request_basis` — Threshold.

The compiler owns hidden accepted answers, card-source references, fixed-anchor validation, threshold proof/source constraints, story reveals, reachability, and content hashing.

HPA-262 does not add a fourth validation layer.

### HPA-260 already owns runtime and persistence

`apps/game/src-tauri/src/game/analysis_integration_tests.rs` already proves the fixture can:

- progress Classify -> Order -> Threshold;
- persist and restore a partial Classify draft exactly;
- reject replay/mutation of completed boards;
- keep completed boards readable;
- keep wrong Threshold submissions non-durable;
- apply correct story facts/objective outputs;
- save/restore during final result dialogue;
- complete the Analysis scene and enter its successor;
- keep accepted answers out of public/save JSON.

The generic runtime, action-token fencing, board availability, story effects, and autosave behavior are not HPA-262 work unless this acceptance pass exposes a real defect.

### HPA-261 already owns workbench interaction

The frontend has focused Classify, Order, Threshold, AnalysisCard, and AnalysisWorkbench tests using typed Chapter-1-shaped fixtures. Pointer/keyboard parity, unavailable/read-only states, provenance presentation, Order anchors, and Threshold selection behavior are already unit-tested.

HPA-262 should reuse those tests, not build another UI harness.

### Production Chapter 1 intentionally still uses linear Beat 8.5

`docs/stories_plan/chapter_1/chapter.md` still references:

```text
scene_8_5.md
```

There is no production `docs/stories_plan/chapter_1/analysis_scene_8_5.md` yet. The compiler fixture IDs such as `miyake_call_record`, `event_1841`, and `lock_sequence` are fixture records, not current production record IDs.

Copying the fixture into production would force HPA-262 to invent/remap story evidence and dialogue, which belongs to HPA-265.

## Ownership decision

The dependency cycle is resolved without changing the roadmap:

- **HPA-262:** certify the stable cross-layer Analysis platform against the existing Chapter-1-shaped acceptance fixture;
- **HPA-264:** connect the proven `prepare_narrow_lock_request` output to hearing-granted authorization;
- **HPA-265:** author and iterate the real production Beat 8.5 using the accepted contracts.

Therefore HPA-262 does **not** modify `docs/stories_plan/chapter_1/**`.

## Goals

1. Close the remaining acceptance gaps not already proven by HPA-259/260/261.
2. Prove representative incomplete drafts for **all three board kinds** survive exact current-format capture/restore.
3. Pin the Rust public wire for Classify, Order, and Threshold so the manually typed frontend union cannot silently drift.
4. Reuse the existing frontend pointer/keyboard tests as the UI acceptance layer.
5. Re-run the existing P1 packaged production journey as a regression smoke that the real Tauri/frontend Analysis route remains wired.
6. Produce enough acceptance evidence to mark HPA-262 complete and unblock HPA-264/HPA-265.

## Non-goals

- No production Beat 8.5 authoring or `chapter.md` change.
- No Chapter 2 work.
- No new Analysis board kinds.
- No evaluator, provenance solver, renderer registry, or frontend store.
- No new generic serialization framework or schema generator.
- No duplicate Tauri E2E suite.
- No HPA-603 practice-card model repair.
- No HPA-601 must-reachability repair.
- No HPA-264 hearing authorization behavior.
- No HPA-265 content/pacing iteration.

## Acceptance gap analysis

| HPA-262 concern | Current `main` | HPA-262 action |
| --- | --- | --- |
| Classify/Order/Threshold authored contract | Covered by HPA-259 fixture/compiler tests | Reuse |
| Full three-board Rust lifecycle | Covered by `analysis_integration_tests.rs` | Reuse |
| Partial Classify exact restore | Covered | Reuse |
| Partial Order exact restore | Not explicitly proven in the cross-board acceptance flow | Add focused acceptance checkpoint |
| Partial Threshold exact restore | Not explicitly proven in the cross-board acceptance flow | Add focused acceptance checkpoint |
| Completed board reopening/read-only | Covered | Reuse |
| Wrong submit does not reveal outputs | Covered | Reuse |
| Exactly-once story effects | Covered by completed-board replay rejection and story snapshot | Reuse / strengthen only if audit finds a gap |
| Rust Classify/Order/Threshold public JSON shape | Rust serialization is exercised, but no concise three-kind contract assertion pins the complete public union | Add one Rust wire-contract assertion |
| Frontend three-kind union/rendering | Covered by typed fixtures and HPA-261 component tests | Reuse |
| Pointer + keyboard | Covered by board/workbench tests | Reuse |
| Packaged Tauri route still works | P1 Threshold production journey already exercises Analysis route | Re-run existing journey; do not add a second suite |
| Real production Beat 8.5 | Not authored | HPA-265, explicitly out of scope |

## Selected design

### 1. Extend the existing Rust acceptance flow, not production code

The main implementation target is:

```text
apps/game/src-tauri/src/game/analysis_integration_tests.rs
```

The existing fixture-driven acceptance test remains the single story-shaped cross-board lifecycle. Add exact restore checkpoints at the first meaningful incomplete state of the two board kinds not yet covered.

#### Partial Order checkpoint

After Classify is complete and `local_event_sequence` is active:

```rust
AnalysisDraft::Order {
    card_ids: vec!["event_1841".into(), "event_1843".into()],
}
```

Use a valid partial sequence that preserves the fixed first anchor but is not complete. Capture, detach/restore, and assert the draft is byte/typed-equivalent through the existing `detached_restore()` helper before continuing with the correct order.

#### Partial Threshold checkpoint

After Order is complete and `narrow_request_basis` is active, save a one-card incomplete draft:

```rust
AnalysisDraft::Threshold {
    selected_card_ids: BTreeSet::from(["lock_sequence".into()]),
}
```

Capture, detach/restore, assert exact draft persistence, then continue into the existing wrong/correct submission path.

This gives one exact save-resume proof for each board kind without adding another save test matrix.

### 2. Add one concise Rust public-wire contract assertion

Use the same fixture and `serde_json::to_value(engine.view())` to pin only the fields the frontend contract depends on for all three variants:

- `scene.kind == "analysis"`;
- `activeBoardId` / `actionToken` camelCase shape;
- each `visibleBoards[*].kind` is `classify | order | threshold`;
- Classify exposes `groups` + Classify draft;
- Order exposes `fixedAnchors` + Order draft;
- Threshold exposes `minimumSelected`, `selectedCardIds` + Threshold draft;
- cards expose `source.kind`, `available`, source label/summary fields;
- feedback state uses `incomplete | incorrect` only;
- accepted-answer fields never appear.

Do **not** create a checked-in generated JSON schema or cross-language codegen. The existing TypeScript types and HPA-261 typed fixtures already pin the frontend side; this Rust assertion pins the producer side cheaply.

If the assertion reveals a real Rust/TypeScript mismatch, fix that mismatch narrowly. Otherwise HPA-262 should remain test-only.

### 3. Reuse existing frontend acceptance

HPA-262 should run, not duplicate, the existing focused frontend tests:

- `analysis-boundary.test.ts`;
- `AnalysisWorkbench.test.ts`;
- `ClassifyBoard.test.ts`;
- `OrderBoard.test.ts`;
- `ThresholdBoard.test.ts`.

These already use the same Chapter-1-shaped board IDs and typed public-view contract introduced by HPA-261.

No new Svelte component or fixture family is planned.

### 4. Reuse the current packaged P1 journey

The real production Chapter 1 currently contains the P1 Threshold Analysis tutorial. Re-run the existing packaged `production-journey` as the integration smoke for:

```text
Svelte workbench -> Tauri command -> Rust Analysis runtime -> next scene
```

It does not need to prove all three board kinds; the fixture-driven Rust + frontend tests already own those variants until HPA-265 authors production Beat 8.5.

Do not create a synthetic packaged-app resource switch or test-only Tauri scene loader solely to make all three fixture boards appear in E2E.

## Expected implementation diff

Default expected code diff:

- `apps/game/src-tauri/src/game/analysis_integration_tests.rs`

Potentially no production code at all.

Only if fresh acceptance exposes a real mismatch may a narrowly related existing Rust/frontend boundary file change. Any production change requires a concrete failing acceptance test first.

No story/compiler/UI component change is expected.

## Verification

Focused:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage --all-features
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts src/lib/components/analysis/AnalysisWorkbench.test.ts src/lib/components/analysis/ClassifyBoard.test.ts src/lib/components/analysis/OrderBoard.test.ts src/lib/components/analysis/ThresholdBoard.test.ts
```

Contract/compiler regression:

```bash
bun run scenes:compile
bun run test:scripts
```

Packaged regression:

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite production-journey
```

Final repository gates:

```bash
bun run test
bun run check
bun run lint:all
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

## Completion / handoff

After implementation evidence is green:

1. mark HPA-262 Done;
2. leave production `scene_8_5.md` unchanged;
3. unblock HPA-264 and HPA-265;
4. HPA-264 may rely on the fixture-proven `prepare_narrow_lock_request` completion contract;
5. HPA-265 may then create the real production `analysis_scene_8_5.md` and iterate content without reopening platform architecture.
