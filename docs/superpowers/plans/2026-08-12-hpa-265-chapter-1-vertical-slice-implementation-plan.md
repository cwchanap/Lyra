# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Deliver the Chapter 1 Beat 8.5 Analysis slice, hearing authorization, one focused packaged Save/Continue path, then human acceptance.

## Task 0 — prove shared source first

Before production content, make Order card ids `event_1841`..`event_1844` all source existing fixture `evidence:lock_sequence` in both compiler and Rust Analysis fixtures, retaining distinct card ids/order/anchor. Run `bun run test:scripts` plus existing Rust cross-board acceptance before/after. Expected PASS; if RED, fix only the narrow shared-source bug before real authoring.

## Task 1 — incomplete draft restores

Add exact Rust `detached_restore()` coverage for incomplete Order `[event_1841,event_1843]` and Threshold `{lock_sequence}`. Reuse current Classify/result-dialogue/no-answer-key coverage and focused frontend tests.

## Task 2 — represented authority

Add optional Phase `Represented Authority` through parser/AST/optional JSON/story validation/reachability/Rust schema. Tests cover ordinary grant rejection, matching Phase/Question/TestimonyLine validity, mismatch, matching authorization reachability, Rust matching/missing/mismatched grant, and replay idempotence.

Add one private `interrogation_story_context(...)` accepting the owning immutable `InterrogationPhaseJson` and reading its authority itself. Route all interrogation story contexts through it: Phase, InquiryQuestion auto-break, TestimonyLine On Correct, InquiryQuestion post-correct. Investigation/Analysis remain authority-null. Update interrogation skill only.

## Task 3 — minimal catalog/provenance, independently compilable

Add four Facts (Summary/Details/`Category: chapter_1`), secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by KAGAMI review authority, Source Groups `door_lock_fixed_record` / `victim_phone_device`.

```text
victim_phone_notification -> victim_phone_device [time]
local_sequence_record -> door_lock_fixed_record [order]
external_maintenance_credential -> door_lock_fixed_record [order, access]
```

Run `scenes:compile` + `test:scripts` before production Analysis exists. Expected PASS. Catalog definitions do not need producers simply by existing; if unexpectedly RED, investigate rather than merge tasks to hide it.

## Task 4 — production Analysis

Replace `scene_8_5.md` with `analysis_scene_8_5.md`.

- Classify real records into small lies / earlier third party / lock chronology; output first two facts.
- Order Event-1841 → 1844, fixed 1841@1, every card source `evidence:local_sequence_record`; output merge-time fact.
- Threshold three provenance records, 2 selected / 2 source groups / `[time,order]`, no procedural-status restriction; output final fact + request objective; one same-source Incorrect Selection.
- Outro: request prepared, identity unresolved, clip unavailable.

Delete old linear file after dialogue migration. Add a short supersession note to `semantic-content-reaudit.md` marking old `scene_8_5.md` findings historical pre-HPA-265; preserve audit body. Run compiler/script tests.

## Task 5 — hearing confirmation + load-bearing grant

Keep p1–p4 proof order/contradictions but shorten to formal confirmation; p5+ unchanged.

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

Do not use normalized JSON spelling `authorization_granted:narrow_lock_export` in Markdown. Verify objective/grant/wrong evidence/atomicity/p4 reachability/replay-restore.

## Task 6 — focused packaged smoke + CI ownership

Keep `production-journey.e2e.ts` unchanged. Add test-only `chapter-1-analysis-beat-85-ready` through existing packaged definitions/`AcquisitionCtx` + scene jump. No production seed API.

Add `analysis-beat85` immediately after `production-journey` in `E2E_SUITE_IDS`, gameplay chain, and story/compiler risk rule:

```js
["smoke","gameplay","production-journey","analysis-beat85"]
```

Update registry/selector tests.

Packaged path:

```text
ready -> Classify -> Order -> one-card Threshold
-> Save -> Title -> Continue once -> exact draft
-> Threshold -> debug jump hearing retaining state
-> p1-p3 -> gate -> authorization + clip -> p4 reachable
```

Stop there.

## Human gate

After Tasks 0–6 green, human plays Beat 8.5 → hearing. Rich hints only for concrete observed confusion; no empty commit.

## Task 7 — final verification

Run story/compiler, focused frontend Analysis, full Rust, registry/selector tests, focused `analysis-beat85`, and normal repo test/check/lint. Assert shared-source proof first, canonical Analysis only, historical audit note, four facts + request objective, no early grant, exact-once grant+clip, p4 authorization gate, Case File authority, proof order, Rust Order/Threshold restores, one packaged Threshold Save/Continue, E2E chain/risk ownership, production-journey narrow.

Mark HPA-265 Done only after automated evidence + human acceptance. Former tickets remain Duplicate.

## Stop conditions

Stop/re-review if shared-source support needs deep model change, production boards alter culprit/proof order, authority needs mutable state, grant cannot stay atomic, p4 cannot use existing authorization predicate, E2E checkpoint needs production seed API, or HPA-603/HPA-601 becomes blocking. No generic redesign or Chapter 2 abstraction by default.
