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

## Final decisions

- **Shared-source assumption is proved first.** Before production authoring, modify both checked-in Analysis fixtures so Order cards `event_1841`..`event_1844` all use existing fixture `evidence:lock_sequence`, then run script tests + Rust cross-board acceptance. Production subsequently uses one real `evidence:local_sequence_record` instead of fake Event evidence rows.
- **Persistence scope stays small.** Add only incomplete Order and Threshold Rust restore coverage; reuse existing Classify/result-dialogue/no-answer-key coverage.
- **Authority is immutable Phase definition data.** Add optional `Represented Authority` through parser/emitter/validation/reachability/Rust. Every interrogation story reveal context is built through one private `interrogation_story_context(...)` helper accepting the owning immutable Phase definition and reading authority itself. Investigation/Analysis remain authority-null.
- **Catalog/provenance remains independently compilable.** Definitions do not require producers merely because they exist; reachability errors concern authored nodes whose prerequisites are unreachable. If an independent compile unexpectedly rejects unused definitions, investigate that regression rather than hiding it by merging tasks.
- **Production Beat 8.5 replaces the linear scene.** One Classify → Order → Threshold Analysis scene; delete `scene_8_5.md` after migrating useful atmosphere and mark its semantic re-audit references historical pre-HPA-265 findings.
- **Authorization is load-bearing.** Gate grants `narrow_lock_export` + `approved_clip` in one reveal transaction. p4 uses actual Markdown predicate `authorization:narrow_lock_export granted`. `authorization_granted` is normalized JSON terminology only.
- **Hearing confirms rather than re-teaches.** p1–p4 keep proof order/contradictions but become concise formal confirmation; p5+ unchanged.
- **Focused E2E gets normal CI ownership.** Keep `production-journey` narrow. Add `analysis-beat85` after it in `E2E_SUITE_IDS`, gameplay chain, and `story-and-compiler` risk rule. One packaged Threshold Save → Title → Continue proves the real persistence path.
- **Human acceptance remains final gate.** Rich hints are playtest-conditional.

## Production catalog/provenance

Four Facts:

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
merge_time_is_not_event_time
two_independent_lock_contradictions_identified
```

Each has Summary/Details/`Category: chapter_1`. Add secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by `KAGAMI 證據摘要審查會主理`, and Source Groups `door_lock_fixed_record` / `victim_phone_device`.

```text
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
victim_phone_notification -> victim_phone_device, [time]
```

Threshold requires 2 selected, 2 distinct source groups, `[time, order]`, no procedural-status restriction, and one exact same-source Incorrect Selection.

## Hearing handoff

```markdown
## Phase: 申請限定調出 {#gate}
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

## Packaged acceptance

Test-only `chapter-1-analysis-beat-85-ready` seeds required real records via existing packaged definitions/`AcquisitionCtx`, clears presentation-only seed events, and jumps to production Analysis.

```text
ready -> Classify -> Order -> one-card Threshold draft
-> Save -> Title -> Continue once -> exact draft restored
-> Threshold -> debug jump to hearing retaining state
-> p1-p3 -> gate -> narrow_lock_export + approved_clip -> p4 reachable
```

`analysis-beat85` belongs to gameplay chain and story/compiler risk selection.

## Acceptance criteria

- [ ] Shared Order-card source behavior proven in compiler + Rust fixtures first.
- [ ] Exact incomplete Order + Threshold Rust restore coverage.
- [ ] One production `analysis_scene_8_5.md`; no playable old linear duplicate.
- [ ] Semantic re-audit marks old linear references historical.
- [ ] Beat 8.5 establishes four facts + request objective and never grants authorization.
- [ ] Every interrogation story context uses one authority-aware constructor.
- [ ] Gate grants authorization + clip atomically/once.
- [ ] p4 requires `authorization:narrow_lock_export granted`.
- [ ] Hearing confirms rather than re-teaches Analysis.
- [ ] One packaged Threshold draft survives Save → Title → Continue and reaches grant.
- [ ] `analysis-beat85` belongs to gameplay chain + story/compiler risk selection.
- [ ] Human playtest accepts or yields one focused iteration.
- [ ] No Chapter 2 work, generic authority family, hint engine, save migration, or fake Event evidence records.

## Verification floor

`bun run scenes:compile`; `bun run test:scripts`; focused Analysis frontend tests; focused + full Rust tests; E2E registry/selection tests; focused `analysis-beat85`; `bun run check`; normal lint/test policy; human Beat 8.5 → hearing playtest.
