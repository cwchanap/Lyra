# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the real Chapter 1 Beat 8.5 Classify → Order → Threshold scene, hearing authorization, one packaged Save/Continue path, then human acceptance.

## Task 0 — prove shared Order-card source first

In both checked-in Analysis fixtures, make card ids `event_1841`..`event_1844` all source existing fixture `evidence:lock_sequence`, retaining distinct ids/order/anchor:

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`

Run before/after:

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage --all-features -- --nocapture
```

Expected PASS. If RED, fix only the narrow shared-source bug before production authoring; never split production evidence as workaround.

## Task 1 — incomplete Order + Threshold restore only

In `analysis_integration_tests.rs`, add exact `detached_restore()` coverage for partial Order `[event_1841,event_1843]` and Threshold `{lock_sequence}`. Continue existing flows. Do not add another public-wire assertion. Re-run focused frontend Analysis tests + Rust acceptance.

## Task 2 — represented authority through existing interrogation paths

Add optional Phase `Represented Authority` through AST → optional JSON → story-target validation → reachability → Rust `InterrogationPhaseJson`.

Tests cover ordinary grant rejection, matching Phase/Question/TestimonyLine validity, mismatch, matching authorization reachability, Rust missing/matching/mismatched authority, replay idempotence.

Add one private `interrogation_story_context(...)` in `mod.rs` that accepts the owning immutable `InterrogationPhaseJson` and reads authority itself. Route all interrogation story contexts through it: Phase, InquiryQuestion auto-break, TestimonyLine On Correct, InquiryQuestion post-correct. Investigation/Analysis remain authority-null. Grep after edits to ensure no interrogation-origin raw context literal remains.

Update interrogation authoring skill; do not edit already-current Analysis skill.

## Task 3 — minimal catalog + truthful provenance, independently compilable

Create production `story_catalog.md` with four Facts (Summary/Details/`Category: chapter_1`), secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by KAGAMI review authority, and Source Groups `door_lock_fixed_record` / `victim_phone_device` with Summary.

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

Expected PASS before production Analysis exists. Catalog definitions do not need producers merely because they exist; if that premise unexpectedly fails, investigate the regression rather than merging Task 3 into Task 4 to hide it.

## Task 4 — production `analysis_scene_8_5.md`

Replace manifest `scene_8_5.md` with Analysis.

- Classify `evidence_packages`: real records grouped into small lies / earlier third party / lock chronology; output first two facts.
- Order `local_event_sequence`: Event-1841 → 1844, fixed 1841@1, every card source `evidence:local_sequence_record`; output merge-time fact.
- Threshold `narrow_request_basis`: three provenance records, 2 selected / 2 source groups / `[time,order]`, no procedural-status restriction; output final fact + complete request objective; one same-source Incorrect Selection.
- Outro: request prepared, identity unresolved, clip unavailable.

Delete old linear file after dialogue migration. Add a concise supersession note to `semantic-content-reaudit.md` that its old `scene_8_5.md` findings are historical pre-HPA-265 findings; preserve audit content.

Run `scenes:compile` + `test:scripts`.

## Task 5 — hearing confirmation + load-bearing authorization

Keep p1–p4 proof order/contradictions, shorten to formal confirmation. p5+ unchanged.

Gate:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

Correct gate:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

p4 authoring syntax:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

Do not use normalized JSON spelling `authorization_granted:narrow_lock_export` in Markdown.

Compiler/Rust acceptance proves objective absent → no grant; wrong evidence → no grant/clip; correct gate → grant+clip atomic; p4 unavailable before authorization/reachable after; replay/restore no duplicates.

## Task 6 — focused packaged Beat 8.5 smoke + canonical CI ownership

Do not expand `production-journey.e2e.ts`.

Add test-only `chapter-1-analysis-beat-85-ready` checkpoint using existing packaged definitions/`AcquisitionCtx` + scene jump. No production seed API.

Add `analysis-beat85` immediately after `production-journey` in:

- `E2E_SUITE_IDS`
- gameplay chain
- `story-and-compiler` risk rule: `["smoke","gameplay","production-journey","analysis-beat85"]`

Update registry/selector tests.

Packaged path:

```text
ready -> Classify -> Order -> one-card Threshold draft
-> Save -> Title -> Continue once -> exact draft
-> Threshold -> debug jump to hearing retaining state
-> p1-p3 -> gate -> narrow_lock_export + approved_clip -> p4 reachable
```

Stop there.

## Human acceptance gate

After Tasks 0–6 are green, stop for human Beat 8.5 → hearing playtest. Rich hints only for concrete observed confusion; no empty commit.

## Task 7 — final verification

Run story/compiler, focused frontend Analysis, full Rust, E2E registry/selector, focused `analysis-beat85`, and normal repo test/check/lint gates.

Final assertions: shared-source proof first; canonical Analysis scene only; historical audit note; four facts + request objective; no grant before hearing; exact-once grant + clip; p4 authorization-gated; Case File authority display; proof order retained; Rust Order/Threshold restores; one packaged Threshold Save → Title → Continue; E2E suite in gameplay chain + story/compiler risk; production-journey stays narrow.

Mark HPA-265 Done only after automated evidence + human acceptance. Former tickets remain Duplicate.

## Stop conditions

Stop/re-review if shared-source support needs deep model change, production boards alter culprit/proof order, represented authority needs mutable state, authorization cannot remain atomic, p4 cannot use existing authorization predicate, E2E checkpoint needs production seed API, or HPA-603/HPA-601 becomes blocking. No stop condition authorizes Chapter 2 abstractions or generic redesign.
