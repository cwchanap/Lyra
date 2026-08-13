# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and accept the real Chapter 1 Beat 8.5 Classify → Order → Threshold scene, connect its request-readiness output to the existing KAGAMI hearing authorization, prove one packaged Save/Continue/grant path, and stop for human playtest acceptance.

**Architecture:** Reuse existing Analysis/compiler/runtime/UI, story state/reveal transactions, save/load, and the existing hearing. Add one optional interrogation-phase `Represented Authority` definition field plus one private authority-aware Rust context constructor. Event-1841..1844 remain four Analysis cards backed by one real `local_sequence_record`.

## Global Constraints

- Start from latest `main`.
- HPA-265 is the survivor for former HPA-262/263/264/266 scope.
- No Chapter 2 abstractions, new board kinds, second story-state owner, grant ledger, save migration, fake Event evidence records, or generic hint engine.
- Analysis completes `prepare_narrow_lock_request`; it never grants `narrow_lock_export`.
- Only the KAGAMI hearing gate grants `narrow_lock_export`.
- p4 requires `authorization:narrow_lock_export granted`.
- Old `scene_8_5.md` is deleted only after dialogue migration; its semantic re-audit references become explicitly historical.

---

### Task 0: Prove shared Order-card sources first

Change both checked-in Analysis fixtures so distinct card ids `event_1841`..`event_1844` all source the existing fixture `evidence:lock_sequence`, retaining four card ids, accepted order, and fixed anchor:

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`

Baseline and verify:

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS before and after. If RED, fix only the narrow shared-source bug before production authoring. Do not split production evidence as a workaround.

Commit fixture proof separately.

---

### Task 1: Add only missing incomplete-draft restore proofs

In `analysis_integration_tests.rs`, add exact `detached_restore()` checks for:

```rust
AnalysisDraft::Order {
    card_ids: vec!["event_1841".into(), "event_1843".into()],
}
```

and:

```rust
AnalysisDraft::Threshold {
    selected_card_ids: BTreeSet::from(["lock_sequence".into()]),
}
```

Continue existing correct flows afterward. Do not add another public-wire assertion. Re-run existing focused frontend Analysis tests + Rust cross-board acceptance.

---

### Task 2: Add represented authority through existing interrogation paths

Add optional Phase field:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Propagate Markdown → AST (`string | null`) → optional JSON → `validateStoryRevealTargets` → interrogation reachability nodes → Rust `InterrogationPhaseJson`.

Add Rust schema:

```rust
#[serde(default)]
represented_authority: Option<String>,
```

Tests cover ordinary grant rejection, matching Phase/Question/TestimonyLine grant validity, mismatch, a mandatory `authorization:<id> granted` gate satisfied by matching authority, Rust matching/missing/mismatched grant behavior, and replay idempotence.

Add one private `interrogation_story_context(...)` helper in `mod.rs`. It accepts the owning immutable `InterrogationPhaseJson` and reads `represented_authority` itself, so callers cannot accidentally omit authority. Route all interrogation story contexts through it:

- InterrogationPhase
- InquiryQuestion auto-break
- TestimonyLine On Correct
- InquiryQuestion post-correct reveals

Investigation and Analysis remain authority-null. Grep after editing to ensure no interrogation-origin raw context literal remains.

Update `.claude/skills/writing-interrogation-scene/SKILL.md`; do not edit the already-current Analysis skill.

Verification:

```bash
bun test packages/scripts/compile-scenes/parser-interrogation.test.ts packages/scripts/compile-scenes/validator.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes/emitter.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml authorization --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

---

### Task 3: Add minimal production catalog + truthful provenance

Create `docs/stories_plan/story_catalog.md` with only four Facts (each Summary/Details/`Category: chapter_1`), secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by `KAGAMI 證據摘要審查會主理`, and Source Groups `door_lock_fixed_record` / `victim_phone_device` with Summary.

Provenance:

```text
victim_phone_notification -> victim_phone_device, [time]
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
```

Door-lock records remain same-source.

This task is independently compilable: catalog definitions do not need producers merely because they exist; reachability errors apply when authored nodes require unreachable progress.

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS before `analysis_scene_8_5.md` exists. If definition-without-producer is unexpectedly rejected, investigate that regression; do not merge this task into authoring merely to hide it.

---

### Task 4: Author production `analysis_scene_8_5.md`

Replace manifest `scene_8_5.md` with Analysis. Preserve useful late-night/vending-machine/fatigue atmosphere only.

Boards:

1. Classify `evidence_packages`: real records grouped into small lies / earlier third party / lock chronology; output first two facts.
2. Order `local_event_sequence`: 1841 → 1844, fixed 1841@1, every card source `evidence:local_sequence_record`; output merge-time fact.
3. Threshold `narrow_request_basis`: three provenance records, 2 selected / 2 source groups / `[time, order]` / no procedural-status restriction / source group required; output final fact + complete request objective; one same-source Incorrect Selection.

Outro says request prepared, identity unresolved, clip unavailable.

Delete `scene_8_5.md`. Add a concise supersession note near the top of `semantic-content-reaudit.md` stating its `scene_8_5.md` findings are historical pre-HPA-265 findings; preserve the historical audit itself.

```bash
bun run scenes:compile
bun run test:scripts
```

---

### Task 5: Hearing confirmation + load-bearing authorization

Keep p1–p4 proof order/contradictions but make them concise formal confirmation. Keep p5+ unchanged.

Gate:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

Correct gate:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

p4 uses actual Markdown grammar:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

Do not write normalized JSON spelling `authorization_granted:narrow_lock_export`.

Compiler/Rust acceptance proves objective absent → grant impossible; wrong evidence → no grant/clip; correct gate → grant+clip atomic; p4 unavailable before authorization and reachable after; replay/restore no duplicate effects.

---

### Task 6: Focused packaged Beat 8.5 smoke + canonical CI ownership

Do not expand `production-journey.e2e.ts`.

Add `chapter-1-analysis-beat-85-ready` checkpoint using existing packaged definitions/`AcquisitionCtx`, presentation-event clearing for the test seed, and test-only scene jump.

Add `analysis-beat85` immediately after `production-journey` in:

- `E2E_SUITE_IDS`
- gameplay chain
- `story-and-compiler` risk rule (`["smoke", "gameplay", "production-journey", "analysis-beat85"]`)

Update registry + selector tests.

Focused path:

```text
ready checkpoint
-> Classify
-> Order
-> one-card Threshold draft
-> Save -> Title -> Continue once
-> exact draft restored
-> Threshold complete
-> debug jump to hearing retaining state
-> p1-p3
-> gate
-> narrow_lock_export + approved_clip
-> p4 reachable
```

Stop there.

```bash
bun test apps/game/scripts/e2e-suite-registry.test.mjs apps/game/scripts/select-e2e-suites.test.mjs
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

---

## Human acceptance gate

After Tasks 0–6 are green, stop for human Beat 8.5 → hearing playtest. Evaluate board clarity, detective feel/pacing, p1–p4 repetition, same-source feedback, Save/Continue confidence, keyboard usability, and thumbnail value. If no concrete misunderstanding appears, richer hints are not needed. If one appears, prefer authored copy/existing Hint/one exact Incorrect Selection before runtime semantics. No empty commit.

---

### Task 7: Final verification

```bash
bun run scenes:compile
bun run test:scripts
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts src/lib/components/analysis/AnalysisWorkbench.test.ts src/lib/components/analysis/ClassifyBoard.test.ts src/lib/components/analysis/OrderBoard.test.ts src/lib/components/analysis/ThresholdBoard.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun test apps/game/scripts/e2e-suite-registry.test.mjs apps/game/scripts/select-e2e-suites.test.mjs
cd apps/game && node scripts/build-e2e.mjs && node scripts/run-save-e2e.mjs --suite analysis-beat85 && cd ../..
bun run test
bun run check
bun run lint:all
```

Final assertions: shared-source proof happened first; canonical Analysis scene only; historical audit note present; four facts + request objective; no grant before hearing; exact-once grant + clip; p4 authorization-gated; Case File authority shown; proof order retained; Rust Order/Threshold restores green; one packaged Threshold Save → Title → Continue; `analysis-beat85` in gameplay chain + story/compiler risk; `production-journey` stays narrow.

Mark HPA-265 Done only after automated evidence + human acceptance. HPA-262/263/264/266 remain Duplicate.

## Stop conditions

Stop and re-review if shared-source support needs a deep model change, production boards alter culprit/proof order, represented authority needs mutable state, authorization cannot remain atomic, p4 cannot use existing authorization predicate, E2E checkpoint requires a production seed API, or HPA-603/HPA-601 becomes a real blocker. No stop condition authorizes Chapter 2 abstractions or a generic redesign.
