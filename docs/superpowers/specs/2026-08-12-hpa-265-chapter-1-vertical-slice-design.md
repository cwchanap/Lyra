# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Design

## Status

Ready for implementation after review. HPA-265 is the single Chapter 1 product-delivery and first-version acceptance owner.

## Outcome

```text
real Chapter 1 evidence
-> Beat 8.5 Classify / Order / Threshold
-> four facts + prepare_narrow_lock_request
-> existing KAGAMI hearing
-> represented authority grants narrow_lock_export
-> authorization:narrow_lock_export granted gates p4
-> approved_clip acquired
-> existing proof order continues
-> focused packaged Save/Continue proof
-> human acceptance
```

## Decisions

- Prove shared Order-card source behavior first in compiler + Rust fixtures: `event_1841`..`event_1844` all use existing fixture `evidence:lock_sequence`, with distinct card ids/order retained. Production then uses one real `evidence:local_sequence_record` instead of fake Event evidence rows.
- Add only incomplete Order + Threshold Rust restore coverage; reuse existing Classify/result-dialogue/no-answer-key coverage.
- Add optional Interrogation Phase `Represented Authority` through parser/emitter/validation/reachability/Rust. Use one private `interrogation_story_context(...)` helper accepting the owning immutable Phase definition and reading authority itself for every interrogation story reveal context. Investigation/Analysis remain authority-null.
- Keep catalog/provenance independently compilable. Catalog definitions do not need producers merely because they exist; reachability errors concern authored nodes requiring unreachable progress.
- Replace linear Beat 8.5 with one production Analysis scene. Add a supersession note to the historical semantic re-audit when deleting the old file.
- Gate grants `narrow_lock_export` + `approved_clip` atomically. p4 requires Markdown predicate `authorization:narrow_lock_export granted`; `authorization_granted` is normalized JSON terminology only.
- p1–p4 become concise formal confirmation; p5+ unchanged.
- Keep `production-journey` narrow. Add `analysis-beat85` after it in `E2E_SUITE_IDS`, gameplay chain, and story/compiler risk rule. One packaged Threshold Save → Title → Continue is enough.
- Human playtest is the final subjective gate; rich hints remain conditional.

## Production catalog/provenance

Four Facts: `miyake_known_lies_are_unrelated_to_murder`, `earlier_external_entry_exists`, `merge_time_is_not_event_time`, `two_independent_lock_contradictions_identified`; each with Summary/Details/`Category: chapter_1`.

Add secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by `KAGAMI 證據摘要審查會主理`, and Source Groups `door_lock_fixed_record` / `victim_phone_device`.

```text
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
victim_phone_notification -> victim_phone_device, [time]
```

Threshold: 2 selected, 2 source groups, `[time, order]`, no procedural-status restriction, one same-source Incorrect Selection.

## Hearing handoff

```markdown
## Phase: 申請限定調出 {#gate}
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

```markdown
## Phase: 門鎖時間不是事件時間 {#p4}
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

## Packaged acceptance

`chapter-1-analysis-beat-85-ready` seeds required production records through existing packaged definitions/`AcquisitionCtx`, clears presentation-only seed events, and jumps to Analysis.

```text
ready -> Classify -> Order -> one-card Threshold draft
-> Save -> Title -> Continue once -> exact draft
-> Threshold -> debug jump to hearing retaining state
-> p1-p3 -> gate -> authorization + approved_clip -> p4 reachable
```

`analysis-beat85` is in the gameplay chain and story/compiler risk selection.

## Acceptance criteria

- [ ] Shared-source behavior proven first in compiler + Rust fixtures.
- [ ] Incomplete Order + Threshold exact Rust restore coverage.
- [ ] One production Analysis Beat 8.5; old linear duplicate removed and audit references marked historical.
- [ ] Four facts + request objective established; Analysis never grants authority.
- [ ] All interrogation story contexts use one authority-aware constructor.
- [ ] Gate grant + approved clip atomic/once; p4 requires authorization.
- [ ] Hearing confirms instead of re-teaching.
- [ ] One packaged Threshold Save → Title → Continue reaches grant.
- [ ] `analysis-beat85` owned by gameplay chain + story/compiler risk.
- [ ] Human playtest accepted or one focused iteration made.
- [ ] No Chapter 2 abstractions, generic authority family, hint engine, save migration, or fake Event evidence.
