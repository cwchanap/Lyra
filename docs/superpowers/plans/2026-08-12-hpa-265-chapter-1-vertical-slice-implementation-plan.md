# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Deliver the real Chapter 1 Beat 8.5 Analysis slice, hearing authorization, one focused packaged Save/Continue path, then human acceptance.

## Task 0 — shared-source proof first

Before production authoring, change both checked-in Analysis fixtures so Order cards `event_1841`..`event_1844` all source existing fixture `evidence:lock_sequence`, retaining distinct card ids/accepted order/fixed anchor:

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`

Verify before/after:

```bash
bun run test:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_fixture_acceptance_round_trips_drafts_and_effects_without_replay_or_leakage --all-features -- --nocapture
```

Expected PASS. If RED, fix only narrow shared-source bug before production content. Never split real evidence as workaround.

## Task 1 — only missing draft restores

Add exact Rust detached restore coverage for incomplete Order `[event_1841,event_1843]` and Threshold `{lock_sequence}`. Reuse existing Classify/result-dialogue/no-answer-key coverage. Re-run focused Analysis frontend tests + cross-board Rust acceptance.

## Task 2 — represented authority

Add optional Phase `Represented Authority` through AST → optional JSON → validation → reachability → Rust schema.

Compiler tests: ordinary grant rejected; matching Phase/Question/TestimonyLine grants accepted; mismatch rejected; matching producer satisfies mandatory `authorization:<id> granted` gate.

Rust field:

```rust
#[serde(default)]
represented_authority: Option<String>,
```

Add one private `interrogation_story_context(...)` helper accepting owning immutable `InterrogationPhaseJson` and reading authority itself. Route all interrogation story contexts through it: Phase, InquiryQuestion auto-break, TestimonyLine On Correct, InquiryQuestion post-correct. Investigation/Analysis remain authority-null. Grep after edit to ensure no interrogation-origin raw context literal remains.

Update interrogation authoring skill only.

## Task 3 — minimal catalog/provenance, independently compilable

Add four Facts with Summary/Details/`Category: chapter_1`, secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by KAGAMI review authority, Source Groups `door_lock_fixed_record` / `victim_phone_device`.

```text
victim_phone_notification -> victim_phone_device, [time]
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
```

Run:

```bash
bun run scenes:compile
bun run test:scripts
```

Expected PASS before production Analysis exists. Definitions do not require producers merely because they exist; if that unexpectedly fails, investigate the regression rather than merging tasks to hide it.

## Task 4 — production Beat 8.5

Replace manifest `scene_8_5.md` with `analysis_scene_8_5.md`.

- Classify: real records grouped into small lies / earlier third party / lock chronology; output first two facts.
- Order: Event-1841 → 1844, fixed 1841@1, every card sources `evidence:local_sequence_record`; output merge-time fact.
- Threshold: three provenance records; 2 selected / 2 source groups / `[time,order]` / no procedural-status restriction; output final fact + complete request objective; one same-source Incorrect Selection.
- Outro: request prepared, identity unresolved, clip unavailable.

Delete old linear file after dialogue migration. Add a short supersession note to `semantic-content-reaudit.md`: its `scene_8_5.md` findings are historical pre-HPA-265 findings. Preserve historical audit body.

Run `scenes:compile` + `test:scripts`.

## Task 5 — hearing confirmation + load-bearing authorization

p1–p4 keep proof order/contradictions but become concise confirmation; p5+ unchanged.

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

Do not write normalized JSON spelling `authorization_granted:narrow_lock_export` in Markdown.

Compiler/Rust acceptance: objective absent no grant; wrong evidence no grant/clip; correct gate grant+clip atomic; p4 unavailable before grant/reachable after; replay/restore no duplicates.

## Task 6 — focused Beat 8.5 packaged smoke + CI ownership

Do not expand `production-journey.e2e.ts`.

Add test-only `chapter-1-analysis-beat-85-ready` using existing packaged definitions/`AcquisitionCtx` + scene jump. No production seed API.

Add `analysis-beat85` immediately after `production-journey` in:

- `E2E_SUITE_IDS`
- gameplay chain
- story/compiler risk rule: `["smoke","gameplay","production-journey","analysis-beat85"]`

Update registry/selector tests.

Packaged path:

```text
ready -> Classify -> Order -> one-card Threshold
-> Save -> Title -> Continue once -> exact draft
-> Threshold -> debug jump to hearing retaining state
-> p1-p3 -> gate -> authorization + approved_clip -> p4 reachable
```

Stop there.

## Human gate

After Tasks 0–6 green, human plays Beat 8.5 → hearing. Rich hints only for concrete observed confusion. No empty commit.

## Task 7 — final verification

Run story/compiler, focused frontend Analysis, full Rust, registry/selector, focused `analysis-beat85`, and normal repo test/check/lint gates. Assert shared-source proof occurred first; canonical Analysis only; historical audit note; four facts + request objective; no early grant; exact-once grant+clip; p4 authorization-gated; Case File authority shown; proof order retained; Rust Order/Threshold restores; one packaged Threshold Save/Continue; E2E suite in gameplay chain+risk; production-journey narrow.

Mark HPA-265 Done only after automated evidence + human acceptance. Former tickets remain Duplicate.

## Stop conditions

Stop/re-review if shared-source support needs deep model change, production boards alter culprit/proof order, authority needs mutable state, grant cannot stay atomic, p4 cannot use existing authorization predicate, E2E checkpoint needs production seed API, or HPA-603/HPA-601 becomes blocking. No generic redesign or Chapter 2 abstraction by default.
