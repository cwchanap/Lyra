# HPA-603 Practice-Card Model Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Implement task-by-task and keep the scope narrow.

**Goal:** Make Practice cards authored-static at runtime, preserve one-to-one Investigation → Analysis context binding, and guarantee that the bound tutorial interaction is actually completed before the predecessor exits.

**Architecture:** Delete dead Practice acquisition/save state; keep `RevealTarget::Practice` as a runtime no-op; remove Practice atoms from reachability; extend the existing `validatePracticeCardBindings` pass with one small guaranteed-context rule. Do not restore acquisition, add `mustAtoms`, or create a new validator/reachability subsystem.

**Tech Stack:** Rust/Tauri runtime + save model, TypeScript scene compiler/validator/reachability, Vitest, Bun.

**Design:** `docs/superpowers/specs/2026-08-14-hpa-603-practice-card-model-design.md`

## Global constraints

- Practice is authored-static Analysis material.
- `practice:<id>` is a compile-time context marker, not inventory or StoryState.
- Keep the existing Practice wire variant and one-to-one binding validator.
- Keep direct Investigation → Analysis adjacency.
- A valid Practice marker must be on an initially-unlocked hotspot/topic under an initially-unlocked sublocation, and its Investigation predecessor must use an auto outro.
- Reject Practice markers on sublocation entry, locked carriers/parents, or expression-gated predecessors in HPA-603.
- Evidence/Statement Analysis gating remains unchanged.
- No save migration/V2 DTO/compatibility shim.
- No Practice-specific `mustAtoms`, new reachability pass, or second validator pass.
- No new E2E suite, parser family, registry, or Chapter 2 abstraction.
- Keep production Chapter 1 P1 content unchanged.

---

## Task 1: Remove dead runtime and save Practice acquisition state

**Files:**
- Modify: `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify: `apps/game/src-tauri/src/game/reveals.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/navigation.rs`

### Step 1: Add a semantic red save-wire test

In the existing save-schema test module, construct the **current pre-change** Investigation snapshot including `practice_card_ids` and assert that serialized JSON does not contain `practiceCardIds`:

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

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema
```

Expected: **FAIL semantically**, because the current DTO emits `practiceCardIds: []`. The test must compile before implementation.

### Step 2: Delete Investigation Practice state

In `scenes/investigation.rs`:

- remove `practice_card_ids` from `InvestigationSceneState`;
- remove its initialization;
- remove `record_practice_card()`;
- remove now-unused `BTreeSet` import if applicable;
- update all local test struct literals;
- remove stale comments about copying Practice cards to Analysis.

Do not add replacement state anywhere else.

### Step 3: Make Practice reveal handling an explicit no-op

In `reveals.rs`, replace the current writer:

```rust
RevealTarget::Practice { id } => {
    scene.record_practice_card(id);
}
```

with an explicit no-op:

```rust
RevealTarget::Practice { .. } => {
    // Compiler-only context marker for the immediately following
    // authored-static Analysis Practice card.
}
```

Do not route Practice through `AcquisitionCtx`, inventory, Case File, `StoryState`, or save state.

### Step 4: Remove every current-format `practice_card_ids` construction/pattern

Update all known baseline occurrences, including test literals rather than relying on the final grep to discover compile failures:

- `scenes/investigation.rs`
  - state field;
  - initialization;
  - `record_practice_card()`;
  - local test literal(s).
- `reveals.rs`
  - Practice writer call.
- `save/schema.rs`
  - `SceneProgressSnapshot::Investigation.practice_card_ids`.
- `save/capture.rs`
  - production snapshot capture;
  - expected `SceneProgressSnapshot::Investigation` test literal around the existing capture round-trip/assertion.
- `save/restore.rs`
  - Investigation pattern binding;
  - assignment back into scene state;
  - test snapshot literal used by rejection/restore tests.
- `save/storage.rs`
  - discovery/load test snapshot literal.

After deleting the field, update Step 1's test constructor to the smaller post-change variant but keep:

```rust
assert!(value.get("practiceCardIds").is_none());
```

Do not add `serde(alias)`, `skip_serializing`, a V2 sibling DTO, migration, or repair path. Old local dev saves may fail loudly because the current DTO uses `deny_unknown_fields`.

### Step 5: Rename stale navigation transfer semantics

Rename:

```text
direct_investigation_to_analysis_transfers_revealed_card_and_accepts_submission
```

to:

```text
direct_investigation_to_analysis_accepts_authored_static_practice_card
```

Keep its behavioral path unchanged: inspect the tutorial hotspot, enter Analysis, select the Practice card, submit successfully.

Reword assertion text such as “transferred practice card” to “authored practice card”. Do not inspect or recreate a transferred ID set.

### Step 6: Run focused Rust tests

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::schema
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::capture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage
cargo test --manifest-path apps/game/src-tauri/Cargo.toml direct_investigation_to_analysis_accepts_authored_static_practice_card
cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::analysis
```

Expected: PASS, including the existing Practice-without-inventory Analysis availability test.

### Step 7: Exhaustive dead-state guard

```bash
rg "practice_card_ids|record_practice_card" apps/game/src-tauri/src/game
```

Expected: no matches.

### Step 8: Commit

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

## Task 2: Align compiler reachability with authored-static Practice cards

**Files:**
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`

### Step 1: Replace the stale Investigation Practice reachability expectation

Replace the existing test:

```text
models P1-local practice reveals as analysis prerequisites
```

with:

```text
treats P1-local practice reveals as contextual markers without reachability effects
```

Keep the same Investigation fixture and change the hotspot effect expectation so it contains only the hotspot-completion atom, not `practice:p1_receipt_reprint`.

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/reachability.test.ts
```

Expected: FAIL because `effectsFromInvestigationReveals` still emits the Practice atom.

### Step 2: Add an inline-source Practice-only classify fixture through the real Analysis path

Do **not** use `buildNodes(chapters, scenes)`; it supplies an empty Analysis registry and cannot produce Analysis board nodes.

Do **not** add fixture files for this test. Keep the source inline in `reachability.test.ts` so the test cost stays local.

Add a helper such as `practiceAnalysisFixture()` beside `analysisChapterFixture()` using inline Markdown strings:

- minimal Investigation source with one initially-unlocked hotspot and `Reveals: [practice:p1_context]`;
- minimal Practice-only **classify** Analysis source with one `practice:p1_context` card and one accepted group;
- no threshold board, so provenance-neutrality rules are irrelevant to this reachability test.

Run the same normalized pipeline used by production Analysis tests:

```text
parseInvestigationScene(inline source)
parseAnalysisScene(inline source)
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

The matching Investigation marker is present for realism, but note in the test/helper comment that `validatePracticeCardBindings` is **not** part of this reachability-unit path; the assertion is specifically about Analysis node prerequisites.

Find the Practice board node and assert:

```ts
expect(practiceBoard.implicitPrerequisites).toEqual([]);
```

Expected before implementation: FAIL because `buildAnalysisNodes` currently adds `practice:p1_context`.

### Step 3: Pin Evidence/Statement gating with the existing real fixture

Reuse `analysisChapterFixture()` and its existing Case File board `narrow_request_basis`.

Assert that its prerequisites still contain:

```text
evidence:lock_sequence
evidence:phone_notification
statement:manager_timing
```

This assertion must be green before and after the change. It is a regression guard for the filtering edit, not a new red test.

### Step 4: Stop Practice reveals from producing reachability atoms

In `effectsFromInvestigationReveals`:

```ts
case "evidence":
case "statement":
  return [addAtomEffect(`${target.kind}:${target.id}`, targetIndex)];
case "practice":
  return [];
```

Leave `inboundTargetsFromInvestigationReveals` unchanged; it already ignores Practice.

### Step 5: Stop Practice cards from requiring reachability atoms

In `buildAnalysisNodes`, filter Practice sources from implicit prerequisites while preserving Evidence/Statement exactly:

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

### Step 6: Run focused compiler tests

```bash
bunx vitest run packages/scripts/compile-scenes/reachability.test.ts
bun run test:scripts
```

Expected: PASS.

### Step 7: Commit

```bash
git add \
  packages/scripts/compile-scenes/reachability.ts \
  packages/scripts/compile-scenes/reachability.test.ts
git commit -m "fix: align practice cards with static reachability"
```

---

## Task 3: Enforce guaranteed tutorial context and clarify binding language

**Files:**
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/validator.test.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-analysis-scene/SKILL.md`

### Step 1: Add a real behavioral red test for non-guaranteed Practice context

Do **not** add tests that pin exact diagnostic prose. Existing Practice tests correctly assert diagnostic codes/IDs; keep that style.

Add a table-driven validator test around the existing `mkInvestigationScene()` helper. Use a bound Practice card in the immediately following Analysis scene, then vary only the predecessor context.

Reject these cases with a focused code such as:

```text
practiceRevealContextNotGuaranteed
```

Cases:

1. Practice marker on a hotspot with `Status: locked`;
2. Practice marker on an unlocked hotspot whose parent sublocation is `Status: locked`;
3. Practice marker on sublocation `Reveals:` itself;
4. Practice marker on an otherwise valid unlocked hotspot, but predecessor `outro.unlock` is an expression rather than `auto`.

Also keep/add one valid control:

- Practice marker on an initially-unlocked hotspot under an initially-unlocked sublocation with auto outro → no `practiceRevealContextNotGuaranteed`.

A topic case does not need a separate exhaustive suite if implementation shares the same carrier-status path, but add one if the helper makes it cheap.

Run:

```bash
bunx vitest run packages/scripts/compile-scenes/validator.test.ts
```

Expected: invalid cases FAIL before implementation because current binding validation checks ID/adjacency only.

### Step 2: Extend `forEachPracticeReveal` instead of adding another pass

Keep `validatePracticeCardBindings` as the sole Practice validator.

Extend the visitor metadata from only `{ sourceFile, line }` to enough carrier context, for example:

```ts
type PracticeRevealLocation = {
  sourceFile: string;
  line: number;
  carrierKind: "sublocation" | "hotspot" | "topic";
  carrierInitiallyUnlocked: boolean;
  parentSublocationInitiallyUnlocked: boolean;
};
```

Populate it while walking the existing AST:

- sublocation marker: `carrierKind = "sublocation"`;
- hotspot marker: carrier status from hotspot, parent status from sublocation;
- topic marker: carrier status from topic, parent status from sublocation.

Do not invoke reachability or construct a second traversal.

### Step 3: Reject Practice bindings that cannot be guaranteed by auto completion

Inside the existing Practice binding validation flow, a marker is guaranteed only when:

```text
scene.outro.unlock === "auto"
AND carrierKind is hotspot or topic
AND carrierInitiallyUnlocked
AND parentSublocationInitiallyUnlocked
```

If the marker is otherwise correctly bound but fails this rule, emit `practiceRevealContextNotGuaranteed` at the marker location.

Why the rule is this narrow:

- auto outro only requires currently-unlocked hotspots/topics;
- it skips locked sublocations entirely;
- it does not independently require sublocation entry;
- expression-gated outros may exit before unrelated unlocked interactions are completed.

Do not generalize this into conditional-carrier proof. A future story need can expand the contract later.

### Step 4: Reword implementation names/comments without prose-pinning tests

In `validatePracticeCardBindings`:

- rename `collected` / `collectors` to `bindings` / `markers` (or equivalent);
- rewrite comments from collection/bridge language to compile-time context binding;
- reword diagnostic messages away from “collected/revealed before Analysis” toward “bound by a matching `practice:` marker”.

Keep existing codes:

- `practiceCardSourceDuplicate`
- `practiceCardSourceUnbound`
- `practiceRevealUnbound`

Add only the new behavioral context-guarantee code above.

Do **not** assert exact wording in `validator.test.ts`. Message wording remains free to improve without breaking behavioral tests.

### Step 5: Reword the end-to-end compiler test, preserving its code assertion

Rename:

```text
rejects a practice card that is not collected by its owning tutorial
```

to:

```text
rejects a practice card without an immediate predecessor binding
```

Rewrite fixture comments/player summary away from “collection source”, “owning tutorial”, and “Prologue Notebook” acquisition semantics.

Keep the actual behavioral assertion:

```ts
expect(result.errors.map((error) => error.code)).toContain(
  "practiceCardSourceUnbound",
);
```

### Step 6: Correct the Rust wire comment

In `apps/game/src-tauri/src/game/schema.rs`, document `RevealTarget::Practice` as:

- tutorial-only context marker;
- never Case File inventory;
- compiler-bound to the immediately following Analysis Practice source;
- guaranteed by the predecessor authoring rule;
- runtime reveal handling is a no-op because Analysis availability is authored-static.

Do not remove the wire variant.

### Step 7: Update the Investigation authoring skill

In `.claude/skills/writing-investigation-scene/SKILL.md`, update all relevant guidance:

- add `practice:` as a legal **special** marker distinct from the five ordinary same-file reveal targets;
- change generic “collects/unlocks” wording so a reveal list may also contain a Practice context marker;
- add a `practice:<id>` reveal-table row explaining no inventory/StoryState/On Collect/On Acquire effect;
- exclude Practice from the “all local reveals resolve in this same scene file” rule;
- state the exact guaranteed-context contract:
  - predecessor outro must be auto;
  - marker must be on an initially-unlocked hotspot/topic;
  - parent sublocation must be initially unlocked;
  - Practice marker on sublocation entry is not supported by the current contract;
- keep Evidence/Statement/topic/hotspot/sublocation semantics unchanged.

### Step 8: Update the Analysis authoring skill

Search the full file for stale Practice acquisition language:

```bash
rg -n "practice|revealed|collected|collection|owning tutorial|transfer" \
  .claude/skills/writing-analysis-scene/SKILL.md
```

Rewrite every Practice-specific stale sentence. The skill must say:

- Practice cards are authored-static tutorial cards;
- each source is context-bound exactly once by the immediately preceding Investigation marker;
- the marker must satisfy the auto/unlocked guaranteed-context rule;
- the marker is not a runtime availability gate;
- Practice cards are available whenever their board is available;
- threshold no-mixing/provenance-neutral rules remain unchanged.

`.agents/skills` is a symlink to `.claude/skills`; edit only `.claude/skills`.

### Step 9: Run focused validator/compiler/content checks

```bash
bunx vitest run packages/scripts/compile-scenes/validator.test.ts
bunx vitest run packages/scripts/compile-scenes.test.ts
bun run scenes:compile
bun run test:scripts
```

Expected:

- new invalid context cases are rejected;
- existing binding tests still pass by code/structure, without prose-pinning;
- production `investigation_scene_p1.md` + `analysis_scene_p1_5.md` compile unchanged because all current Practice markers are unlocked hotspots under an unlocked sublocation and the predecessor outro is auto.

### Step 10: Commit

```bash
git add \
  packages/scripts/compile-scenes/validator.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  packages/scripts/compile-scenes.test.ts \
  apps/game/src-tauri/src/game/schema.rs \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-analysis-scene/SKILL.md
git commit -m "fix: guarantee practice-card tutorial context"
```

---

## Task 4: Verify the consolidated model

### Step 1: Verify dead runtime acquisition state is gone

```bash
rg "practice_card_ids|record_practice_card" apps/game/src-tauri/src/game
```

Expected: no matches.

### Step 2: Verify remaining Practice language and semantics

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

- Analysis Practice availability is still authored-static;
- runtime reveal handler is a no-op;
- validator/skills describe binding + guaranteed context;
- reachability has no Practice progress atom/prerequisite path.

### Step 3: Run repository verification floor

```bash
bun run scenes:compile
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run check
bun run lint:all
bun run test
```

Do not add a new HPA-603 packaged E2E suite. If an existing Chapter 1 E2E is part of normal repository commands, let it run through that existing policy.

### Step 4: Confirm HPA-601 remains canceled

HPA-601 remains obsolete because Practice is not a runtime acquisition gate. Do not reopen it and do not implement its Practice-specific `mustAtoms` proposal.

Document in Linear that HPA-603 now carries a narrower authoring-coherence guard: bound Practice context must be guaranteed by auto + initially-unlocked hotspot/topic semantics.

### Step 5: Final implementation commit only if verification exposes a real regression

Fix only HPA-603 regressions discovered by verification. Do not create an empty verification commit.

---

## Final acceptance checklist

- [ ] Practice availability is authored-static; no runtime acquisition gate exists.
- [ ] `InvestigationSceneState` has no Practice acquisition set/method.
- [ ] current save DTO/capture/restore/storage/test literals contain no Practice IDs.
- [ ] `RevealTarget::Practice` remains on the wire and is an explicit runtime no-op.
- [ ] navigation test language describes authored-static availability, not transfer.
- [ ] `validatePracticeCardBindings` remains the single Practice validator.
- [ ] one-to-one immediate predecessor binding remains strict.
- [ ] Practice marker context is guaranteed: auto outro + unlocked hotspot/topic + unlocked parent sublocation.
- [ ] expression-outro, locked carrier/parent, and sublocation-entry Practice markers are rejected.
- [ ] validator tests assert behavior/codes, not exact diagnostic prose.
- [ ] Practice reveals emit no reachability atom.
- [ ] Practice Analysis cards require no reachability atom.
- [ ] inline-source Practice-only classify test exercises the normalized Analysis path.
- [ ] existing Case File fixture proves Evidence/Statement prerequisites remain.
- [ ] both authoring skills describe one consistent binding + guaranteed-context contract.
- [ ] Chapter 1 P1 compiles unchanged.
- [ ] HPA-601 remains canceled; no `mustAtoms` rule is added.
- [ ] no migration, second validator pass, new E2E suite, parser/registry, or Chapter 2 abstraction is introduced.
