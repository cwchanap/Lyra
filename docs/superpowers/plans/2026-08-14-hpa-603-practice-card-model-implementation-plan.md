# HPA-603 Practice-Card Model Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Practice cards consistently authored-static at runtime while preserving the existing Investigation → Analysis contextual binding as a compiler-only authoring contract.

**Architecture:** Remove the dead Investigation Practice set and its save field, keep `RevealTarget::Practice` as an explicit runtime no-op, and stop compiler reachability from treating Practice as a progress atom. Preserve the dedicated one-to-one Practice binding validator and immediate Investigation → Analysis adjacency rule. Evidence/Statement Analysis availability remains unchanged.

**Tech Stack:** Rust/Tauri game runtime and persistence, TypeScript scene compiler/validator/reachability, Vitest, Bun.

## Global Constraints

- Practice is authored-static Analysis material; do not restore Analysis-side acquisition state.
- `practice:<id>` Investigation markers remain legal authored syntax and compile-time context bindings.
- Practice markers never enter Case File, `StoryState`, or save progression.
- Evidence/Statement Analysis cards remain inventory/reachability gated.
- Keep the existing one-to-one Practice binding validator and Investigation → Analysis adjacency rule.
- No save migration/V2 DTO/backward-compatibility shim.
- No Practice-specific `mustAtoms` rule or broader may-vs-must redesign.
- No new E2E suite, renderer registry, parser family, or Chapter 2 abstraction.
- Keep production Chapter 1 P1 content unchanged.

**Design:** `docs/superpowers/specs/2026-08-14-hpa-603-practice-card-model-design.md`

---

### Task 1: Remove dead runtime and save Practice acquisition state

**Files:**
- Modify: `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify: `apps/game/src-tauri/src/game/reveals.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/navigation.rs`
- Test: existing Rust tests in those modules

**Interfaces:**
- Consumes: current `RevealTarget::Practice` wire variant and current authored-static `AnalysisCardSource::Practice` behavior.
- Produces: Investigation runtime/save state with no Practice acquisition field; Practice reveal execution as an explicit no-op; navigation test language matching authored-static availability.

- [ ] **Step 1: Write a semantic red test for the save wire**

In the existing save-schema test module, serialize the **current pre-change** Investigation snapshot including the field that exists on `main`:

```rust
let value = serde_json::to_value(SceneProgressSnapshot::Investigation {
    intro_played: false,
    outro_played: false,
    current_sublocation_id: None,
    inspected_hotspot_ids: vec![],
    discussed_topic_ids: vec![],
    entered_sublocation_ids: vec![],
    unlocked_overrides: vec![],
    practice_card_ids: vec![],
})
.unwrap();

assert!(value.get("practiceCardIds").is_none());
```

This is deliberately different from constructing the post-change enum shape. The test must compile on current `main` and fail on the assertion because `practiceCardIds: []` is currently serialized.

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema
```

Expected: FAIL because `practiceCardIds` is present in the serialized object.

- [ ] **Step 2: Remove `InvestigationSceneState` Practice acquisition state**

In `apps/game/src-tauri/src/game/scenes/investigation.rs`:

- remove `BTreeSet` from the import if no longer needed;
- remove `InvestigationSceneState.practice_card_ids`;
- remove its `from_json` initialization;
- remove `record_practice_card()`;
- remove the stale comment claiming Practice cards are copied to the next Analysis scene;
- update the module's test struct literals to the smaller state shape.

Do **not** add a replacement field in Analysis, `StoryState`, inventory, or navigation.

- [ ] **Step 3: Make Practice reveal execution an explicit no-op**

In `apps/game/src-tauri/src/game/reveals.rs`, replace:

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

- [ ] **Step 4: Remove Practice IDs from every current save snapshot construction**

In `apps/game/src-tauri/src/game/save/schema.rs`, remove:

```rust
#[serde(default)]
practice_card_ids: Vec<String>,
```

from `SceneProgressSnapshot::Investigation`.

Then update every known current-format construction/pattern:

- `save/capture.rs`: remove `practice_card_ids: scene.practice_card_ids.iter().cloned().collect()`;
- `save/restore.rs`: remove `practice_card_ids` from the Investigation pattern and remove the state assignment;
- `save/storage.rs`: remove `practice_card_ids: Vec::new()` from the discovery/load test fixture;
- `scenes/investigation.rs`: remove the field from local test literals.

After deleting the enum field, update the Step 1 test constructor to the smaller post-change shape while keeping:

```rust
assert!(value.get("practiceCardIds").is_none());
```

Do not add a migration, compatibility alias, `skip_serializing`, V2 snapshot, or repair path.

- [ ] **Step 5: Rename the stale navigation transfer test**

In `apps/game/src-tauri/src/game/navigation.rs`, rename:

```text
direct_investigation_to_analysis_transfers_revealed_card_and_accepts_submission
```

to:

```text
direct_investigation_to_analysis_accepts_authored_static_practice_card
```

Keep its behavior: inspect the tutorial hotspot, advance into Analysis, select the authored Practice card, and submit successfully.

Reword expectation strings such as:

```text
"the transferred practice card should be selectable"
```

to authored-static language such as:

```text
"the authored practice card should be selectable"
```

This test must not inspect a transferred ID set because no such state exists after this task.

- [ ] **Step 6: Run focused Rust tests**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::capture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage
cargo test --manifest-path apps/game/src-tauri/Cargo.toml direct_investigation_to_analysis_accepts_authored_static_practice_card
cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::analysis
```

Expected: PASS, including `validate_draft_availability_accepts_practice_cards_without_inventory`.

- [ ] **Step 7: Verify no Rust-side dead state literal remains**

Run:

```bash
rg "practice_card_ids|record_practice_card" apps/game/src-tauri/src/game
```

Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add \
  apps/game/src-tauri/src/game/scenes/investigation.rs \
  apps/game/src-tauri/src/game/reveals.rs \
  apps/game/src-tauri/src/game/save/schema.rs \
  apps/game/src-tauri/src/game/save/capture.rs \
  apps/game/src-tauri/src/game/save/restore.rs \
  apps/game/src-tauri/src/game/save/storage.rs \
  apps/game/src-tauri/src/game/navigation.rs
git commit -m "fix: remove dead practice-card runtime state"
```

---

### Task 2: Align compiler reachability with authored-static Practice cards

**Files:**
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`

**Interfaces:**
- Consumes: normalized Analysis scenes and existing Practice binding validation.
- Produces: no Practice reachability effects/prerequisites; unchanged Evidence/Statement reachability gating.

- [ ] **Step 1: Replace the Investigation-side stale Practice reachability expectation**

In `packages/scripts/compile-scenes/reachability.test.ts`, replace the current test named:

```text
models P1-local practice reveals as analysis prerequisites
```

with:

```text
treats P1-local practice reveals as contextual markers without reachability effects
```

Keep the same Investigation fixture and change the expected hotspot effects to only the hotspot-completion atom:

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

Expected: FAIL because `effectsFromInvestigationReveals` still emits `practice:p1_receipt_reprint`.

- [ ] **Step 2: Add a Practice-only Analysis test through the real normalized Analysis path**

Do **not** use the local `buildNodes(chapters, scenes)` helper for this assertion; it supplies an empty Analysis registry and cannot create Analysis board nodes.

Add a small `practiceAnalysisFixture()` beside `analysisChapterFixture()` that follows the same pipeline:

```text
parse Investigation source with one practice:p1_context marker
parse Practice-only Analysis source
-> createAnalysisDefinitionRegistryFromScenes(analysisScenes)
-> compileCaseRecordCorpus(catalog, scenes)
-> validateAnalysisScenes(...)
-> buildReachabilityNodes({
     chapters,
     scenes,
     catalog,
     analysisRegistry,
     analysisScenes,
     normalizedAnalysisScenes: normalized.value,
   })
```

Use a valid **Practice-only classify board** (or Practice-only threshold with neutral provenance requirements). Do not mix Practice and Case File cards.

The preceding Investigation must contain exactly one matching:

```markdown
- **Reveals:** [practice:p1_context]
```

The Analysis scene must contain one card:

```markdown
- **Source:** practice:p1_context
```

Find the resulting Analysis board node and assert:

```ts
expect(practiceBoard.implicitPrerequisites).toEqual([]);
```

Expected before implementation: FAIL because `buildAnalysisNodes` currently creates `practice:p1_context` as an implicit prerequisite.

- [ ] **Step 3: Pin Evidence/Statement gating through the existing Analysis fixture**

Use the existing `analysisChapterFixture()` rather than inventing a mixed threshold. It already runs the full normalized Analysis path and its `narrow_request_basis` threshold contains:

```text
evidence:lock_sequence
evidence:phone_notification
statement:manager_timing
```

Find the `board:narrow_request_basis` node and assert its implicit prerequisite atoms contain exactly those Case File sources (order-normalized in the test as appropriate):

```ts
expect(
  narrowRequest.implicitPrerequisites.map((predicate) => predicate.atom).sort(),
).toEqual([
  "evidence:lock_sequence",
  "evidence:phone_notification",
  "statement:manager_timing",
]);
```

This assertion must stay green before and after the implementation. It guards against accidentally removing Evidence/Statement gating while filtering Practice.

- [ ] **Step 4: Stop Practice reveals from producing reachability atoms**

In `effectsFromInvestigationReveals`, split Practice from Evidence/Statement:

```ts
case "evidence":
case "statement":
  return [addAtomEffect(`${target.kind}:${target.id}`, targetIndex)];
case "practice":
  return [];
```

Add a short comment that Practice is validated by `validatePracticeCardBindings` and is not runtime progress.

Leave `inboundTargetsFromInvestigationReveals` unchanged; it already returns `[]` for Practice.

- [ ] **Step 5: Stop Practice cards from requiring reachability atoms**

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

Do not change the emitted prerequisite shape for Evidence or Statement.

- [ ] **Step 6: Run focused compiler tests**

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/reachability.test.ts
bun run test:scripts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  packages/scripts/compile-scenes/reachability.ts \
  packages/scripts/compile-scenes/reachability.test.ts
git commit -m "fix: align practice cards with static reachability"
```

---

### Task 3: Clarify the binding contract where both sides are authored

**Files:**
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/validator.test.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-analysis-scene/SKILL.md`

**Interfaces:**
- Consumes: unchanged `practice:<id>` parser/wire syntax and immediate predecessor relationship.
- Produces: one consistent authoring contract: Investigation marker ↔ immediately following Analysis Practice source, with no acquisition language.

- [ ] **Step 1: Pin binding semantics in validator tests**

Keep the existing diagnostic codes so downstream tooling does not churn:

- `practiceCardSourceDuplicate`
- `practiceCardSourceUnbound`
- `practiceRevealUnbound`

Update focused message assertions so diagnostics describe contextual binding rather than runtime collection.

The tests must continue to reject:

1. a Practice card with no predecessor marker;
2. the same marker ID authored more than once for the next Analysis board;
3. a predecessor marker with no Practice card in the immediately following Analysis scene.

For the missing-marker diagnostic, assert wording equivalent to:

```text
Practice card "p1_context" must be bound exactly once by a practice:p1_context marker in the immediately preceding investigation scene.
```

For duplicate markers, assert that the message says the card is bound more than once, not “revealed/collected” more than once.

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/validator.test.ts
```

Expected: FAIL only on the new wording assertions; structural behavior is already present.

- [ ] **Step 2: Rewrite `validatePracticeCardBindings` language without adding another pass**

In `packages/scripts/compile-scenes/validator.ts`:

- change the function comment from “bridge/collection” semantics to “compile-time context binding” semantics;
- rename local `collected` / `collectors` variables to `bindings` / `markers` (or equivalent) so implementation names do not preserve the rejected model;
- change messages such as “must be revealed exactly once” to “must be bound exactly once by a matching `practice:<id>` marker in the immediately preceding investigation”;
- replace “collection source” with “context marker/binding”;
- keep the same maps, manifest adjacency lookup, and one-to-one validation flow.

Do not add `mustAtoms`, another validator pass, or runtime-path checks.

- [ ] **Step 3: Reword the end-to-end compiler binding test**

In `packages/scripts/compile-scenes.test.ts`, rename:

```text
rejects a practice card that is not collected by its owning tutorial
```

to:

```text
rejects a practice card without an immediate predecessor binding
```

Reword its comment and fixture summary away from “tutorial collection”, “owning tutorial”, and “Prologue Notebook” acquisition semantics. Preserve the actual assertion:

```ts
expect(result.errors.map((error) => error.code)).toContain(
  "practiceCardSourceUnbound",
);
```

The test remains a compile-time authoring-contract test; do not turn it into a runtime availability test.

- [ ] **Step 4: Correct the Rust schema comment**

Update the `RevealTarget::Practice` comment in `apps/game/src-tauri/src/game/schema.rs` to state:

- tutorial-only;
- never Case File inventory;
- compiler validates its exact immediate predecessor binding;
- runtime reveal handling is a no-op because the following Analysis card is authored-static.

Do not remove the wire variant in HPA-603.

- [ ] **Step 5: Update the Investigation authoring skill**

In `.claude/skills/writing-investigation-scene/SKILL.md`, update all relevant author/parser guidance, not only one example:

1. In the top author/parser-facing prefix list, add `practice:` as a legal special marker while keeping the five ordinary local target kinds distinct.
2. In `Reveal / unlock syntax`, change “A list of things this trigger collects/unlocks” to language that also permits context markers.
3. Add a reveal-table row:

```text
practice:<id> | Compile-time context marker for a Practice card in the immediately following Analysis scene. No inventory/StoryState acquisition and no On Collect/On Acquire dialogue.
```

4. In `ID namespace rules`, keep the five ordinary local kinds on the same-file rule and add an explicit Practice exception:

```text
practice:<id> does not resolve in the Investigation file. The compiler binds it to a Practice card source in the immediately following Analysis scene.
```

5. In parser-validation guarantees, describe the immediate predecessor/next Analysis binding instead of implying every reveal resolves inside the same Investigation JSON.

Do not change Evidence/Statement/topic/hotspot/sublocation behavior.

- [ ] **Step 6: Update every stale Practice sentence in the Analysis authoring skill**

In `.claude/skills/writing-analysis-scene/SKILL.md`, search the whole file for:

```bash
rg -n "practice|revealed|collected|collection|owning tutorial|transfer" .claude/skills/writing-analysis-scene/SKILL.md
```

Rewrite every Practice-specific sentence that carries acquisition semantics. In particular:

- the `Practice-card binding and threshold provenance` section must say each `practice:<id>` **source is context-bound exactly once** by the immediately preceding Investigation marker;
- “Tell the writer ... reveal locations” becomes “binding marker locations”;
- the self-check must say every Practice card is **bound exactly once**, not “revealed exactly once”;
- keep threshold no-mixing/provenance-neutral rules unchanged;
- state explicitly that Practice cards are available when their board is available and the marker is not a runtime gate.

`.agents/skills` is a symlink to `.claude/skills`; edit only `.claude/skills`.

- [ ] **Step 7: Run focused compiler/skill and production content checks**

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/validator.test.ts
bunx vitest run packages/scripts/compile-scenes.test.ts
bun run scenes:compile
bun run test:scripts
```

Expected: PASS with `docs/stories_plan/chapter_1/investigation_scene_p1.md` and `analysis_scene_p1_5.md` unchanged.

- [ ] **Step 8: Commit**

```bash
git add \
  packages/scripts/compile-scenes/validator.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  packages/scripts/compile-scenes.test.ts \
  apps/game/src-tauri/src/game/schema.rs \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-analysis-scene/SKILL.md
git commit -m "docs: clarify practice-card binding semantics"
```

---

### Task 4: Verify the consolidated model

**Files:**
- No additional product files expected.
- Linear: HPA-603 and already-canceled HPA-601.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: verified HPA-603 implementation with HPA-601 remaining obsolete.

- [ ] **Step 1: Verify no dead Practice acquisition state remains**

Run:

```bash
rg "practice_card_ids|record_practice_card" apps/game/src-tauri/src/game
```

Expected: no matches.

Check the remaining Practice semantics:

```bash
rg -n 'Practice|practice' \
  apps/game/src-tauri/src/game/scenes/analysis.rs \
  apps/game/src-tauri/src/game/reveals.rs \
  apps/game/src-tauri/src/game/schema.rs \
  packages/scripts/compile-scenes/validator.ts \
  packages/scripts/compile-scenes/reachability.ts \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-analysis-scene/SKILL.md
```

Expected:

- Analysis availability still says Practice is always available;
- reveal handler has one explicit no-op;
- schema/compiler/skills describe contextual binding;
- reachability does not produce or require `practice:<id>` progress atoms.

- [ ] **Step 2: Run repository verification floor**

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

- [ ] **Step 3: Confirm HPA-601 remains superseded**

HPA-601 has already been canceled during planning because its premise depends on Practice acquisition gating. Verify it remains Canceled and related to HPA-603.

Do not reopen it and do not implement its proposed Practice-specific `mustAtoms` validation.

- [ ] **Step 4: Final implementation commit only if verification required fixes**

If verification exposes a real HPA-603 regression, fix only that regression and commit the touched files explicitly. Do not create a no-op/empty verification commit.

---

## Final acceptance checklist

- [ ] One Practice model exists: authored-static runtime + compiler contextual binding.
- [ ] `InvestigationSceneState` has no Practice acquisition state.
- [ ] Investigation save snapshots/storage fixtures have no Practice IDs.
- [ ] `RevealTarget::Practice` is an explicit no-op at runtime.
- [ ] Analysis Practice availability remains always true.
- [ ] the direct Investigation → Analysis test describes authored-static availability, not transfer.
- [ ] compiler reachability neither produces nor requires Practice atoms.
- [ ] Practice-only Analysis has no Practice prerequisite through the real normalized Analysis path.
- [ ] Evidence/Statement Analysis prerequisites remain reachability-gated through the same real path.
- [ ] `validatePracticeCardBindings` still enforces exact immediate-predecessor context binding.
- [ ] validator and compile-integration wording no longer encode collection/acquisition semantics.
- [ ] Investigation and Analysis authoring skills describe one consistent binding contract.
- [ ] Chapter 1 P1 source files require no rewrite.
- [ ] no save migration or compatibility layer is introduced.
- [ ] no new E2E suite, validator pass, Practice must-path rule, or Analysis subsystem is introduced.
- [ ] HPA-601 remains retired as obsolete.
