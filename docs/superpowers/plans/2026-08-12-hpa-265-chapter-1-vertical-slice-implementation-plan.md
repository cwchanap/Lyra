# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and accept the real Chapter 1 Beat 8.5 Classify → Order → Threshold scene, connect request readiness to the existing KAGAMI hearing authorization, prove one packaged Save/Continue/grant path, and stop for human acceptance.

## Constraints

- Start from latest `main`; HPA-265 is the survivor for former HPA-262/263/264/266.
- Reuse existing Analysis/runtime/UI/story/save owners. No Chapter 2 abstractions, new board kind, second state owner, grant ledger, save migration, fake Event evidence rows, or generic hint engine.
- Analysis completes `prepare_narrow_lock_request`; only the hearing grants `narrow_lock_export`.
- p4 requires `authorization:narrow_lock_export granted`.
- Delete old `scene_8_5.md` only after useful dialogue migration; mark its semantic re-audit references historical.

### Task 0 — prove shared Order-card source first

In both:

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`

change Order cards `event_1841`..`event_1844` to share existing fixture `evidence:lock_sequence`, retaining distinct card ids/accepted order/fixed anchor.

Before and after:

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage --all-features -- --nocapture
```

Expected PASS. If RED, fix only the narrow shared-source bug before production authoring; never split production evidence as a workaround.

### Task 1 — incomplete Order + Threshold restore only

In `analysis_integration_tests.rs`, add exact detached restore checks for:

```rust
AnalysisDraft::Order { card_ids: vec!["event_1841".into(), "event_1843".into()] }
AnalysisDraft::Threshold { selected_card_ids: BTreeSet::from(["lock_sequence".into()]) }
```

Continue existing correct flows. Do not add another public-wire test. Re-run existing focused frontend Analysis tests and Rust cross-board acceptance.

### Task 2 — represented authority through existing interrogation path

Add optional Phase:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Flow through AST → optional JSON → story-target validation → interrogation reachability nodes → Rust Phase schema.

Compiler tests: ordinary grant rejected; matching Phase/Question/TestimonyLine accepted; mismatch rejected; mandatory `authorization:<id> granted` gate satisfied by matching producer.

Rust:

```rust
#[serde(default)]
represented_authority: Option<String>,
```

Add one private `interrogation_story_context(...)` in `mod.rs`. It accepts the owning immutable `InterrogationPhaseJson` and reads authority itself. Route every interrogation story context through it: Phase, InquiryQuestion auto-break, TestimonyLine On Correct, InquiryQuestion post-correct reveals. Investigation/Analysis remain authority-null. Grep after edits to ensure no raw interrogation context literal remains.

Update interrogation authoring guidance; do not edit already-current Analysis skill.

Verify focused compiler tests + `cargo test ... authorization`, `... interrogation`, then full Rust.

### Task 3 — minimal catalog + truthful provenance, independently compilable

Create production `story_catalog.md` with four Facts (Summary/Details/`Category: chapter_1`), secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by KAGAMI review authority, and Source Groups `door_lock_fixed_record` / `victim_phone_device` with Summary.

Provenance:

```text
victim_phone_notification -> victim_phone_device, [time]
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
```

Door-lock records remain same-source.

```bash
bun run scenes:compile
bun run test:scripts
```

Expected PASS before production Analysis scene exists. Catalog definitions do not require producers merely because they exist; if that unexpectedly fails, investigate the regression rather than merging tasks to conceal it.

### Task 4 — author production Analysis Beat 8.5

Replace manifest `scene_8_5.md` with `analysis_scene_8_5.md`.

- Classify `evidence_packages`: real records grouped into small lies / earlier third party / lock chronology; output first two facts.
- Order `local_event_sequence`: Event-1841 → 1844, fixed 1841@1, every card source `evidence:local_sequence_record`; output merge-time fact.
- Threshold `narrow_request_basis`: three provenance records, 2 selected / 2 source groups / `[time, order]`, no procedural-status restriction; output final fact + complete request objective; one same-source Incorrect Selection only.
- Outro: request prepared, identity unresolved, clip unavailable.

Delete old linear file. Add a concise supersession note near top of `semantic-content-reaudit.md` saying old `scene_8_5.md` findings are historical pre-HPA-265 findings; preserve audit content.

Run `bun run scenes:compile` + `bun run test:scripts`.

### Task 5 — hearing confirmation + load-bearing authorization

Keep p1–p4 proof order/contradictions but make them concise confirmation. p5+ unchanged.

Gate:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

Correct gate:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

p4:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

Do not author normalized JSON spelling `authorization_granted:narrow_lock_export`.

Compiler/Rust acceptance proves objective absent → grant impossible; wrong evidence → no grant/clip; correct gate → grant+clip atomic; p4 unavailable before grant and reachable after; replay/restore no duplicates.

### Task 6 — focused packaged Beat 8.5 smoke + canonical CI ownership

Do not expand `production-journey.e2e.ts`.

Add test-only `chapter-1-analysis-beat-85-ready` checkpoint: seed required real records via existing packaged definitions/`AcquisitionCtx`, clear presentation-only seed events, jump to production Analysis. No production seed API.

Add `analysis-beat85` immediately after `production-journey` in:

- `E2E_SUITE_IDS`
- gameplay chain
- `story-and-compiler` risk rule (`["smoke", "gameplay", "production-journey", "analysis-beat85"]`)

Update registry/selector tests.

Packaged path:

```text
ready -> Classify -> Order -> one-card Threshold draft
-> Save -> Title -> Continue once -> exact draft
-> Threshold complete -> debug jump to hearing retaining state
-> p1-p3 -> gate -> authorization + approved_clip -> p4 reachable
```

Stop there.

Run registry/selection tests and `run-save-e2e.mjs --suite analysis-beat85`.

## Human gate

After Tasks 0–6 are green, stop for human Beat 8.5 → hearing playtest. Evaluate clarity, detective feel/pacing, hearing repetition, same-source feedback, Save/Continue confidence, keyboard usability, thumbnail value. Rich hints only for concrete observed confusion; no empty commit.

### Task 7 — final verification

Run `scenes:compile`, `test:scripts`, focused Analysis frontend tests, full Rust, E2E registry/selector tests, focused `analysis-beat85`, full repo test/check/lint.

Final assertions: shared-source proof happened first; canonical Analysis scene only; historical audit note present; four facts + request objective; no grant before hearing; exact-once grant + clip; p4 authorization-gated; Case File authority shown; proof order retained; Rust Order/Threshold restore green; one packaged Threshold Save → Title → Continue; `analysis-beat85` in gameplay chain + story/compiler risk; `production-journey` stays narrow.

Mark HPA-265 Done only after automated evidence + human acceptance. Former tickets stay Duplicate.

## Stop conditions

Stop/re-review if shared-source support needs a deep model change, production boards alter culprit/proof order, represented authority needs mutable state, authorization cannot stay atomic, p4 cannot use existing authorization predicate, E2E checkpoint needs a production seed API, or HPA-603/HPA-601 becomes blocking. No stop condition authorizes Chapter 2 abstractions or generic redesign.
