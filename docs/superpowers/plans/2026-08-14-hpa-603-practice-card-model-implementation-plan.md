# HPA-603 Practice-Card Model Consolidation Implementation Plan

> **For coding agent:** Execute this plan task-by-task with tests first. Do not reintroduce Analysis-side Practice acquisition state.

**Goal:** Make Practice cards consistently authored-static at runtime while preserving the existing Investigation → Analysis contextual binding as a compiler-only authoring contract.

**Architecture:** Remove the dead Investigation Practice set and its save field, keep `RevealTarget::Practice` as an explicit runtime no-op, and stop compiler reachability from treating Practice as a progress atom. Preserve the dedicated one-to-one Practice binding validator and immediate Investigation → Analysis adjacency rule. Evidence/Statement Analysis availability remains unchanged.

**Tech stack:** Rust/Tauri game runtime and persistence, TypeScript scene compiler/validator/reachability, Vitest, Bun.

**Design:** `docs/superpowers/specs/2026-08-14-hpa-603-practice-card-model-design.md`

---

## Task 1: Remove dead runtime and save Practice acquisition state

**Files:**
- Modify: `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify: `apps/game/src-tauri/src/game/reveals.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Test: `apps/game/src-tauri/src/game/save/schema.rs`
- Test: existing Rust tests in the touched save/runtime modules

### Step 1: Add a failing save-wire test that rejects Practice persistence

Add a focused test beside the save schema tests that serializes an Investigation snapshot and proves the current-format wire has no `practiceCardIds` member.

Use the existing snapshot constructors/helpers in `save/schema.rs`; the assertion should be equivalent to:

```rust
let value = serde_json::to_value(SceneProgressSnapshot::Investigation {
    intro_played: false,
    outro_played: false,
    current_sublocation_id: None,
    inspected_hotspot_ids: vec![],
    discussed_topic_ids: vec![],
    entered_sublocation_ids: vec![],
    unlocked_overrides: vec![],
}).unwrap();

assert!(value.get("practiceCardIds").is_none());
```

If the enum serialization wraps fields under the existing tag, inspect the serialized object at the current location rather than introducing a helper solely for this assertion.

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema
```

Expected: FAIL before the implementation because `SceneProgressSnapshot::Investigation` still requires/emits `practice_card_ids`.

### Step 2: Delete the Investigation acquisition set

In `apps/game/src-tauri/src/game/scenes/investigation.rs`:

- remove `BTreeSet` from the import;
- remove `InvestigationSceneState.practice_card_ids`;
- remove its `from_json` initialization;
- remove `record_practice_card()`;
- remove/update the stale comment claiming cards are copied to the next Analysis scene;
- update any struct literals in the same module/tests.

Do **not** add a replacement field elsewhere.

### Step 3: Make Practice reveal execution an explicit no-op

In `apps/game/src-tauri/src/game/reveals.rs`, replace the mutation:

```rust
RevealTarget::Practice { id } => {
    scene.record_practice_card(id);
}
```

with:

```rust
RevealTarget::Practice { .. } => {
    // Compiler-only contextual binding for the immediately following
    // Analysis Practice card. Practice availability is authored-static.
}
```

Do not route it through `AcquisitionCtx` or `StoryState`.

### Step 4: Remove Practice IDs from the current save snapshot

In `apps/game/src-tauri/src/game/save/schema.rs`, remove:

```rust
#[serde(default)]
practice_card_ids: Vec<String>,
```

from `SceneProgressSnapshot::Investigation`.

In `save/capture.rs`, remove the emitted field:

```rust
practice_card_ids: scene.practice_card_ids.iter().cloned().collect(),
```

In `save/restore.rs`:

- remove `practice_card_ids` from the Investigation snapshot pattern;
- remove the assignment rebuilding `scene.practice_card_ids`.

Do not add a migration, compatibility alias, `skip_serializing`, V2 snapshot, or repair path. Existing local pre-release saves may become invalid.

### Step 5: Run focused Rust tests

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::capture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::analysis
```

Expected: PASS, including the existing test that Practice cards are available without inventory.

### Step 6: Commit

```bash
git add \
  apps/game/src-tauri/src/game/scenes/investigation.rs \
  apps/game/src-tauri/src/game/reveals.rs \
  apps/game/src-tauri/src/game/save/schema.rs \
  apps/game/src-tauri/src/game/save/capture.rs \
  apps/game/src-tauri/src/game/save/restore.rs
git commit -m "fix: remove dead practice-card runtime state"
```

---

## Task 2: Align compiler reachability with authored-static Practice cards

**Files:**
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`

### Step 1: Replace the stale Practice reachability test

In `packages/scripts/compile-scenes/reachability.test.ts`, replace the existing test:

```text
models P1-local practice reveals as analysis prerequisites
```

with a test named:

```text
treats P1-local practice reveals as contextual markers without reachability effects
```

Keep the same Investigation fixture and assert the Practice reveal no longer emits `practice:p1_receipt_reprint`:

```ts
expect(nodes[1]!.effects).toEqual([
  {
    kind: "addAtom",
    atom: "hotspot:chapter_1@investigation_scene_1@receipt",
    targetIndex: -1,
  },
]);
```

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/reachability.test.ts
```

Expected: FAIL because current `effectsFromInvestigationReveals` still publishes the Practice atom.

### Step 2: Add a mixed Analysis-source reachability test

Use the existing `parseAnalysisScene` / `buildNodes` helpers in `reachability.test.ts` to build an Analysis board containing:

- one `practice:p1_context` card;
- one `evidence:real_record` card.

Assert the Analysis board node has only the Evidence prerequisite:

```ts
expect(analysisBoardNode.implicitPrerequisites).toEqual([
  { predicate: "atom", atom: "evidence:real_record" },
]);
```

This test must fail before implementation because current `buildAnalysisNodes` turns every card source into an implicit prerequisite.

Do not weaken Evidence/Statement gating to make the test pass.

### Step 3: Stop Practice reveals from producing reachability atoms

In `effectsFromInvestigationReveals`, split Practice from Evidence/Statement:

```ts
case "evidence":
case "statement":
  return [addAtomEffect(`${target.kind}:${target.id}`, targetIndex)];
case "practice":
  return [];
```

Add a short comment that Practice is validated by `validatePracticeCardBindings` and is not runtime progress.

### Step 4: Stop Practice cards from requiring reachability atoms

In `buildAnalysisNodes`, filter the implicit card prerequisites:

```ts
implicitPrerequisites: uniquePredicates(
  board.common.cards.flatMap((card) =>
    card.source.kind === "practice"
      ? []
      : [
          {
            predicate: "atom" as const,
            atom: `${card.source.kind}:${card.source.id}`,
          },
        ],
  ),
),
```

Evidence and Statement remain exactly as before.

### Step 5: Run focused compiler tests

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/reachability.test.ts
bun run test:scripts
```

Expected: PASS.

### Step 6: Commit

```bash
git add \
  packages/scripts/compile-scenes/reachability.ts \
  packages/scripts/compile-scenes/reachability.test.ts
git commit -m "fix: align practice cards with static reachability"
```

---

## Task 3: Clarify the compile-time Practice binding contract

**Files:**
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/validator.test.ts`
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `.claude/skills/writing-analysis-scene/SKILL.md`

### Step 1: Pin binding semantics in validator tests

Keep the existing diagnostic codes so downstream tooling does not churn:

- `practiceCardSourceDuplicate`
- `practiceCardSourceUnbound`
- `practiceRevealUnbound`

Update/add focused assertions so the diagnostics describe contextual binding rather than runtime collection. The required behavior remains:

```text
next Analysis Practice card <-> exactly one marker in immediately preceding Investigation
```

The tests must still reject:

1. a Practice card with no predecessor marker;
2. the same marker ID authored more than once for the next board;
3. a predecessor marker with no Practice card in the immediately following Analysis scene.

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/validator.test.ts
```

Expected: fail only where the new wording/assertions have not yet been applied; structural behavior should already be green.

### Step 2: Rewrite stale validator language without adding another pass

In `validatePracticeCardBindings`:

- change the function comment from “bridge/collection” semantics to “compile-time context binding” semantics;
- change messages such as “must be revealed exactly once ... before analysis” to “must be bound exactly once by a `practice:` marker in the immediately preceding investigation”;
- keep the same maps, adjacency lookup, and one-to-one validation flow.

Do not add must-path checks. Practice is no longer a runtime prerequisite.

### Step 3: Correct the Rust schema comment

Update the `RevealTarget::Practice` comment in `apps/game/src-tauri/src/game/schema.rs` to state:

- tutorial-only;
- never Case File inventory;
- compiler validates its immediate predecessor binding;
- runtime reveal handling is a no-op because the following Analysis card is authored-static.

Do not remove the wire variant in HPA-603.

### Step 4: Update the Analysis authoring skill

In `.claude/skills/writing-analysis-scene/SKILL.md`, update only the Practice-card guidance:

```text
Practice cards are authored-static tutorial cards.
Each practice:<id> source must be context-bound exactly once by a matching
practice:<id> marker in the immediately preceding Investigation scene.
The marker is not an acquisition gate and never enters Case File/StoryState.
```

Keep the current Chapter 1 source grammar and immediate adjacency requirement.

### Step 5: Run compiler and production content checks

Run:

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS with `docs/stories_plan/chapter_1/investigation_scene_p1.md` and `analysis_scene_p1_5.md` unchanged.

### Step 6: Commit

```bash
git add \
  packages/scripts/compile-scenes/validator.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  apps/game/src-tauri/src/game/schema.rs \
  .claude/skills/writing-analysis-scene/SKILL.md
git commit -m "docs: clarify practice-card binding semantics"
```

---

## Task 4: Verify the consolidated model and retire the obsolete follow-up

**Files:**
- No additional product files expected.
- Linear: HPA-603, HPA-601.

### Step 1: Verify no dead Practice acquisition state remains

Run:

```bash
rg "practice_card_ids|record_practice_card" apps/game/src-tauri/src/game
```

Expected: no matches.

Check the remaining Practice semantics:

```bash
rg 'Practice|practice' \
  apps/game/src-tauri/src/game/scenes/analysis.rs \
  apps/game/src-tauri/src/game/reveals.rs \
  apps/game/src-tauri/src/game/schema.rs \
  packages/scripts/compile-scenes/validator.ts \
  packages/scripts/compile-scenes/reachability.ts
```

Expected:

- Analysis availability still says Practice is always available;
- reveal handler has one explicit no-op;
- schema/compiler describe contextual binding;
- reachability has no `practice:<id>` progress atom path.

### Step 2: Run repository verification floor

Run:

```bash
bun run scenes:compile
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run check
bun run lint:all
bun run test
```

Do not add a new HPA-603 packaged E2E suite. If an existing Chapter 1 E2E runs as part of normal repository policy, let it run through the existing command; HPA-265 already owns the packaged Analysis journey.

Expected: all commands pass.

### Step 3: Close HPA-601 as superseded

Once implementation is green, update HPA-601 to Canceled/Superseded with a short note:

```text
Superseded by HPA-603. Practice cards are authored-static at runtime;
practice:<id> investigation markers are compile-time contextual bindings, not
acquisition prerequisites. Therefore an optional marker cannot soft-lock the
following Analysis board, and no Practice-specific must-path reachability rule
is required.
```

Do not implement HPA-601's proposed `mustAtoms` validation after HPA-603.

### Step 4: Final implementation commit only if verification required fixes

If verification exposes a real HPA-603 regression, fix only that regression and commit the touched files explicitly. Do not create a no-op/empty verification commit.

---

## Final acceptance checklist

- [ ] One Practice model exists: authored-static runtime + compiler contextual binding.
- [ ] `InvestigationSceneState` has no Practice acquisition state.
- [ ] Investigation save snapshots have no Practice IDs.
- [ ] `RevealTarget::Practice` is an explicit no-op at runtime.
- [ ] Analysis Practice availability remains always true.
- [ ] compiler reachability neither produces nor requires Practice atoms.
- [ ] Evidence/Statement Analysis prerequisites remain reachability-gated.
- [ ] `validatePracticeCardBindings` still enforces exact immediate-predecessor context binding.
- [ ] Chapter 1 P1 source files require no rewrite.
- [ ] no save migration or compatibility layer is introduced.
- [ ] no new E2E suite or Analysis subsystem is introduced.
- [ ] HPA-601 is retired as obsolete after implementation.
