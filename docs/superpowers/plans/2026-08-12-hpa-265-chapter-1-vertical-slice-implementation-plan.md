# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and accept the real Chapter 1 Beat 8.5 Classify → Order → Threshold scene, connect its request-readiness output to the existing KAGAMI hearing authorization, prove one packaged Save/Continue/grant path, and stop for human playtest acceptance.

**Architecture:** Reuse existing Analysis/compiler/runtime/UI, story state/reveal transactions, save/load, and the existing hearing. Add one optional interrogation-phase `Represented Authority` definition field plus one private authority-aware Rust context constructor. Production Event-1841..1844 remain four Analysis cards backed by one real `local_sequence_record`.

## Global Constraints

- Start implementation from latest `main`.
- HPA-265 is the survivor for former HPA-262/263/264/266 scope.
- No Chapter 2 abstractions, new board kinds, second story-state owner, grant ledger, save migration, fake Event evidence records, or generic hint engine.
- Analysis may complete `prepare_narrow_lock_request`; it never grants `narrow_lock_export`.
- Only the existing KAGAMI hearing gate grants `narrow_lock_export`.
- p4 requires `authorization:narrow_lock_export granted`.
- Old `scene_8_5.md` is deleted only after useful dialogue migration; its semantic re-audit references become explicitly historical.

---

### Task 0: Prove shared Order-card sources before production authoring

**Files:**
- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`

Change the four Order-card ids `event_1841`..`event_1844` in both fixtures to share the existing fixture source `evidence:lock_sequence`, retaining four distinct card ids, accepted order, and fixed anchor.

Run before and after:

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

Expected: PASS. If RED, fix only the narrow shared-source bug before production authoring. Do not split production evidence to work around it.

Commit:

```bash
git add packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json
git commit -m "test(analysis): prove shared card source support"
```

---

### Task 1: Add only missing incomplete-draft restore proofs

**File:** `apps/game/src-tauri/src/game/analysis_integration_tests.rs`

Add exact detached restore checks for:

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

Continue the existing correct flows after each restore. Do not add another public-wire assertion; current Rust/frontend tests already pin board variants and answer-key redaction.

Regression:

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage \
  --all-features -- --nocapture
```

---

### Task 2: Add represented authority through existing interrogation paths

**Files:** compiler interrogation types/parser/emitter/validator/reachability, Rust `schema.rs` / `mod.rs`, focused tests, `.claude/skills/writing-interrogation-scene/SKILL.md`.

Add optional Phase authoring field:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Compiler contract:

```text
Markdown
-> AST representedAuthority: string | null
-> optional JSON representedAuthority?: string
-> validateStoryRevealTargets
-> interrogation reachability nodes inherit owning phase authority
```

Tests cover ordinary grant rejection, matching phase/question/testimony-line grant validity, authority mismatch, and a mandatory `authorization:<id> granted` gate satisfied by the matching producer.

Rust schema:

```rust
#[serde(default)]
represented_authority: Option<String>,
```

Add one private `interrogation_story_context(...)` helper in `mod.rs`. It accepts the owning immutable `InterrogationPhaseJson` and reads `represented_authority` itself; callers cannot supply an arbitrary `None`. Route every interrogation-origin context through it:

```text
InterrogationPhase
InquiryQuestion auto-break
TestimonyLine On Correct
InquiryQuestion post-correct reveals
```

Where borrowing requires it, clone the immutable phase definition before taking the mutable scene borrow. Investigation and Analysis remain authority-null.

After editing, grep `StoryRevealMaterializationContext` and verify no interrogation-origin raw literal remains.

Update interrogation authoring guidance; do not edit the already-current Analysis skill.

Verification:

```bash
bun test packages/scripts/compile-scenes/parser-interrogation.test.ts packages/scripts/compile-scenes/validator.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes/emitter.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml authorization --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation --all-features -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

---

### Task 3: Add minimal production catalog and truthful Threshold provenance

**Files:**
- create `docs/stories_plan/story_catalog.md`
- modify `investigation_scene_7.md`
- modify `investigation_scene_8.md`

Catalog contains only four Facts with Summary/Details/`Category: chapter_1`, secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` with KAGAMI granting authority, and Source Groups `door_lock_fixed_record` / `victim_phone_device` with Summary.

Provenance:

```text
victim_phone_notification -> victim_phone_device, [time]
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
```

The two door-lock records remain same-source.

This task is independently compilable. Catalog definitions do not require producers merely because they exist; reachability errors apply when authored nodes require unreachable progress.

```bash
bun run scenes:compile
bun run test:scripts
```

Expected: PASS before `analysis_scene_8_5.md` exists. If a definition-without-producer is unexpectedly rejected, investigate the regression; do not merge Task 3 into Task 4 merely to mask it.

---

### Task 4: Author real production `analysis_scene_8_5.md`

Replace the manifest's `scene_8_5.md` with `analysis_scene_8_5.md` and migrate only useful late-night/fatigue/partner atmosphere.

Boards:

1. `evidence_packages` Classify: real records grouped into small lies / earlier third party / lock chronology; reveal first two facts.
2. `local_event_sequence` Order: Event-1841 → Event-1844, fixed 1841@1, every card sources the single `evidence:local_sequence_record`; reveal `merge_time_is_not_event_time`.
3. `narrow_request_basis` Threshold: use the three provenance records; 2 selected, 2 source groups, `[time, order]`, no procedural-status restriction, source group required; reveal final fact and complete request objective; one exact same-source Incorrect Selection only.

Outro: request prepared, identity unresolved, clip not yet available.

Delete `scene_8_5.md`. Add a concise supersession note near the top of `semantic-content-reaudit.md` saying its old `scene_8_5.md` references are historical pre-HPA-265 findings; preserve the historical audit itself.

```bash
bun run scenes:compile
bun run test:scripts
```

---

### Task 5: Hearing confirmation and load-bearing authorization

Keep p1–p4 proof order/contradictions, but shorten them to formal confirmation. Keep p5+ unchanged.

Gate:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

Correct `gate_hold_record`:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

p4 uses actual Markdown grammar:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

Do **not** author `authorization_granted:narrow_lock_export`; that is normalized JSON terminology.

Compiler/Rust acceptance proves objective absent → grant impossible; wrong evidence → no grant/clip; correct gate → grant+clip atomically; p4 unavailable before authorization and reachable after; replay/restore no duplicate effects.

```bash
bun run scenes:compile
bun run test:scripts
```

---

### Task 6: Focused packaged Beat 8.5 smoke with canonical CI ownership

Do not expand `production-journey.e2e.ts`.

Add test-only checkpoint `chapter-1-analysis-beat-85-ready`: seed required real records through existing packaged definitions/`AcquisitionCtx`, clear presentation-only pending events for this test seed, jump to `analysis_scene_8_5`, expose Analysis mode. No production seed API.

Add `analysis-beat85` immediately after `production-journey` in:

- `E2E_SUITE_IDS`
- gameplay `E2E_CHAIN_DEFINITIONS`

and add it to the `story-and-compiler` risk rule:

```js
["smoke", "gameplay", "production-journey", "analysis-beat85"]
```

Update registry + selector tests. Current registry requires every suite to belong to a chain.

Focused packaged path:

```text
ready checkpoint
-> solve Classify
-> solve Order
-> one-card Threshold draft
-> Save -> Title -> Continue once
-> exact Threshold draft restored
-> solve Threshold
-> debug jump to hearing preserving state
-> p1-p3 confirmation
-> gate
-> narrow_lock_export + approved_clip
-> p4 reachable
```

Stop there; no remaining-hearing E2E.

```bash
bun test apps/game/scripts/e2e-suite-registry.test.mjs apps/game/scripts/select-e2e-suites.test.mjs
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

---

## Human acceptance gate

After Tasks 0–6 are green, stop for human Beat 8.5 → hearing playtest. Evaluate board clarity, detective feel/pacing, p1–p4 repetition, same-source feedback, Save/Continue confidence, keyboard usability, and thumbnail value.

If no concrete misunderstanding appears, richer hints are not needed. If one appears, prefer authored copy/existing Hint/one exact Incorrect Selection before runtime semantics. No empty playtest commit.

---

### Task 7: Final verification and completion

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

Final assertions: shared-source proof happened first; one canonical Beat 8.5 Analysis scene; audit note present; four facts + request objective; no grant before hearing; exact-once authorization + clip; p4 authorization-gated; authority shown in Case File; proof order retained; Order/Threshold Rust restore green; one packaged Threshold Save → Title → Continue green; `analysis-beat85` is in gameplay chain + story/compiler risk selection; `production-journey` remains narrow.

Mark HPA-265 Done only after automated evidence + human acceptance. HPA-262/263/264/266 remain Duplicate.

## Stop conditions

Stop and re-review if shared-source support needs a deep model change, production boards alter culprit/proof order, represented authority needs mutable state, authorization cannot remain atomic, p4 cannot use existing authorization predicate, E2E checkpoint requires a production seed API, or HPA-603/HPA-601 becomes a real blocker. No stop condition authorizes Chapter 2 abstractions or a generic redesign.
