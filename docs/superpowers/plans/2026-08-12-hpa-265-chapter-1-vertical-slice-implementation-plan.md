# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Ship the real Chapter 1 Beat 8.5 Analysis slice, hearing authorization, one focused packaged Save/Continue path, then human acceptance.

## Task 0 — shared-source proof first

Before production authoring, update both Analysis fixtures so `event_1841`..`event_1844` remain four Order card ids but all source existing fixture `evidence:lock_sequence`:

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`

Run script tests and existing Rust cross-board acceptance before/after. Expected PASS. If RED, fix only the narrow shared-source issue before real content; never split production evidence as workaround.

## Task 1 — missing draft restores only

Add exact Rust detached restore coverage for incomplete Order `[event_1841,event_1843]` and Threshold `{lock_sequence}`. Reuse existing Classify/result-dialogue/no-answer-key coverage and focused frontend Analysis tests.

## Task 2 — represented authority

Add optional Phase `Represented Authority` through AST → optional JSON → validation → reachability → Rust schema. Compiler tests cover ordinary rejection, matching Phase/Question/TestimonyLine validity, mismatch, and matching authorization reachability.

Add one private `interrogation_story_context(...)` accepting the owning immutable `InterrogationPhaseJson` and reading its authority itself. Route all interrogation story contexts through it: Phase, InquiryQuestion auto-break, TestimonyLine On Correct, InquiryQuestion post-correct. Investigation/Analysis remain authority-null. Grep after edits to ensure no raw interrogation-origin context literal remains.

Update interrogation authoring guidance only.

## Task 3 — minimal catalog/provenance, independently compilable

Add four Facts with Summary/Details/`Category: chapter_1`, secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by KAGAMI review authority, and Source Groups `door_lock_fixed_record` / `victim_phone_device`.

```text
victim_phone_notification -> victim_phone_device, [time]
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
```

Run `bun run scenes:compile` + `bun run test:scripts` before production Analysis exists. Expected PASS: catalog definitions do not need producers merely because they exist; reachability errors apply when authored nodes require unreachable progress. If unexpectedly RED, investigate the regression rather than merging Task 3 into Task 4 to hide it.

## Task 4 — production Beat 8.5

Replace manifest `scene_8_5.md` with `analysis_scene_8_5.md`.

- Classify: real records grouped into small lies / earlier third party / lock chronology; output first two facts.
- Order: Event-1841 → 1844, fixed 1841@1, every card sources `evidence:local_sequence_record`; output merge-time fact.
- Threshold: three provenance records, 2 selected / 2 source groups / `[time,order]`, no procedural-status restriction; output final fact + request objective; one same-source Incorrect Selection.
- Outro: request prepared, identity unresolved, clip unavailable.

Delete old linear file after migration. Add a concise supersession note to `semantic-content-reaudit.md` that its old `scene_8_5.md` findings are historical pre-HPA-265 findings; preserve audit content.

## Task 5 — hearing confirmation + load-bearing authorization

Keep p1–p4 proof order/contradictions but shorten to formal confirmation; p5+ unchanged.

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

Compiler/Rust acceptance: objective absent no grant; wrong evidence no grant/clip; correct gate grant+clip atomic; p4 unavailable before grant/reachable after; replay/restore no duplicates.

## Task 6 — focused packaged smoke + canonical CI ownership

Do not expand `production-journey.e2e.ts`.

Add test-only `chapter-1-analysis-beat-85-ready` through existing packaged definitions/`AcquisitionCtx` + scene jump. No production seed API.

Add `analysis-beat85` immediately after `production-journey` in:

- `E2E_SUITE_IDS`
- gameplay chain
- story/compiler risk rule `["smoke","gameplay","production-journey","analysis-beat85"]`

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

After Tasks 0–6 green, human plays Beat 8.5 → hearing. Rich hints only for concrete observed confusion; no empty commit.

## Task 7 — final verification

Run story/compiler, focused frontend Analysis, full Rust, registry/selector tests, focused `analysis-beat85`, and normal repo test/check/lint. Final assertions: shared-source proof first; canonical Analysis only; historical audit note; four facts + request objective; no early grant; exact-once grant+clip; p4 authorization-gated; Case File authority; proof order retained; Rust Order/Threshold restore; one packaged Threshold Save/Continue; E2E suite in gameplay chain+risk; production-journey narrow.

Mark HPA-265 Done only after automated evidence + human acceptance. Former tickets remain Duplicate.

## Stop conditions

Stop/re-review if shared-source support needs deep model change, production boards alter culprit/proof order, authority needs mutable state, grant cannot stay atomic, p4 cannot use existing authorization predicate, E2E checkpoint needs production seed API, or HPA-603/HPA-601 becomes blocking. No generic redesign or Chapter 2 abstraction by default.
