# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Design

## Status

Ready for implementation after review. HPA-265 is the single Chapter 1 product-delivery and first-version acceptance owner, replacing the old HPA-262/263/264/265/266 sequencing chain.

## Outcome

```text
real Chapter 1 evidence
-> Beat 8.5 Classify / Order / Threshold
-> four durable facts + prepare_narrow_lock_request
-> existing KAGAMI hearing
-> matching represented authority grants narrow_lock_export
-> authorization:narrow_lock_export granted gates p4
-> approved_clip acquired
-> existing proof order continues
-> one packaged Save/Continue proof + human acceptance
```

The implementation finishes one gameplay sequence. Existing Analysis compiler/runtime/UI, story state, Case File, and save/load remain their current owners.

## Key architecture decisions

- **Prove shared card sources first.** Before production authoring, change both checked-in Analysis fixtures so the four Order card ids `event_1841`..`event_1844` all point to the existing fixture `evidence:lock_sequence`, then run script tests + the Rust cross-board acceptance. Production subsequently uses one real `evidence:local_sequence_record` for the four row cards.
- **Only missing persistence proofs.** Add exact incomplete Order and Threshold restore coverage; keep existing Classify/result-dialogue/no-answer-key coverage.
- **One represented-authority carrier.** Add optional Interrogation Phase `Represented Authority` through parser/emitter/validation/reachability/Rust. In Rust, every interrogation story reveal context is built by one private `interrogation_story_context(...)` helper that accepts the owning immutable Phase definition and reads its authority itself. Investigation and Analysis remain authority-null.
- **Minimal Chapter 1 catalog.** Add only four Facts, secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export`, and two Source Groups. Real provenance is added only to the three Threshold records.
- **Independent catalog checkpoint.** Catalog definitions do not need a producer merely because they exist; reachability errors apply when an authored node requires unreachable progress. Catalog/provenance therefore remains an independently compilable task. If that premise unexpectedly fails, investigate the regression rather than hiding it by merging tasks.
- **Real Beat 8.5.** Replace the linear `scene_8_5.md` with one production `analysis_scene_8_5.md`: Classify → Order → Threshold. Delete the old file after migrating useful atmosphere, and add a short supersession note to `semantic-content-reaudit.md` marking its references to the deleted linear scene as historical pre-HPA-265 findings.
- **Authority is load-bearing.** The existing hearing `gate` grants `narrow_lock_export` and acquires `approved_clip` in one reveal transaction. p4 requires the actual authoring grammar `authorization:narrow_lock_export granted`, not the normalized JSON spelling `authorization_granted`.
- **Hearing confirms, not re-teaches.** p1–p4 retain proof order and contradictions but become concise formal confirmation of conclusions already organized in Analysis; p5+ remains unchanged.
- **Focused packaged smoke.** Do not grow `production-journey.e2e.ts`. Add `analysis-beat85` after `production-journey` in both `E2E_SUITE_IDS` and the gameplay chain, and add it to the `story-and-compiler` risk rule. One real Threshold draft gets Save → Title → Continue; Classify/Order restores stay Rust-level.
- **Human gate.** Stop after automation for human Beat 8.5 → hearing playtest. Rich hints are added only for concrete observed confusion.

## Production story shape

### Facts

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
merge_time_is_not_event_time
two_independent_lock_contradictions_identified
```

Each Fact carries Summary, Details, and `Category: chapter_1`.

### Objective / authorization

```text
prepare_narrow_lock_request     secondary
narrow_lock_export              grantingAuthority = KAGAMI 證據摘要審查會主理
```

### Source groups / capabilities

```text
local_sequence_record
  sourceGroup = door_lock_fixed_record
  proofCapabilities = [order]

external_maintenance_credential
  sourceGroup = door_lock_fixed_record
  proofCapabilities = [order, access]

victim_phone_notification
  sourceGroup = victim_phone_device
  proofCapabilities = [time]
```

The two door-lock records remain same-source. Threshold uses 2 selected, 2 distinct source groups, `[time, order]`, no procedural-status restriction, and one exact same-source Incorrect Selection.

## Hearing handoff

Gate:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

Correct gate resolution:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

p4:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

This makes authority validation/reachability production-load-bearing instead of decorative.

## Packaged acceptance

Test-only `chapter-1-analysis-beat-85-ready` acquires required production records through existing packaged definitions/`AcquisitionCtx`, clears presentation-only pending events for the seed, jumps to `analysis_scene_8_5`, and exposes Analysis mode.

Focused path:

```text
ready checkpoint
-> solve Classify
-> solve Order
-> one-card Threshold draft
-> Save -> Title -> Continue once
-> exact Threshold draft restored
-> solve Threshold
-> debug jump to interrogation_scene_10 retaining state
-> p1-p3 confirmation
-> gate grant
-> narrow_lock_export + approved_clip
-> p4 reachable
```

`analysis-beat85` is a normal gameplay-chain suite and is selected by Chapter 1 story/compiler risk rules.

## Acceptance criteria

- [ ] Shared Order-card source behavior proved in compiler + Rust fixtures before production authoring.
- [ ] Exact incomplete Order + Threshold Rust restore coverage.
- [ ] One canonical production `analysis_scene_8_5.md`; no playable old linear duplicate.
- [ ] Semantic re-audit marks deleted `scene_8_5.md` references historical.
- [ ] Real records carry only required Threshold provenance.
- [ ] Beat 8.5 establishes four facts + request objective and never grants authorization.
- [ ] All interrogation story contexts use one authority-aware constructor; Investigation/Analysis remain authority-null.
- [ ] Gate grants authorization + approved clip atomically/once.
- [ ] p4 requires `authorization:narrow_lock_export granted`.
- [ ] Hearing confirms rather than re-teaches Analysis.
- [ ] One packaged Threshold draft survives Save → Title → Continue and reaches grant.
- [ ] `analysis-beat85` belongs to gameplay chain and story/compiler risk selection.
- [ ] Human playtest accepts first version or yields one concrete iteration.
- [ ] No Chapter 2 work, generic authority family, hint engine, save migration, or fake Event evidence records.

## Verification floor

`bun run scenes:compile`; `bun run test:scripts`; focused Analysis frontend tests; focused + full Rust tests; E2E registry/selection tests; focused `analysis-beat85`; `bun run check`; normal lint/test policy; human Beat 8.5 → hearing playtest.

## Deferred

HPA-603/HPA-601 stay separate unless real packaged play proves them blocking. Full production hardening remains HPA-536. Chapter 2 stays deferred until HPA-265 acceptance plus fresh canon/design review.
