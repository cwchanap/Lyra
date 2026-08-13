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

Existing Analysis compiler/runtime/UI, story state, Case File, and save/load remain their current owners.

## Decisions

1. **Prove shared sources first.** Before production authoring, change the compiler fixture and checked-in Rust Analysis JSON fixture so Order cards `event_1841`..`event_1844` all source existing fixture `evidence:lock_sequence`, then run script tests + Rust cross-board acceptance. Production then uses one real `evidence:local_sequence_record` for four reasoning cards instead of four fake Case File rows.
2. **Only missing persistence proofs.** Add exact incomplete Order and Threshold Rust restore coverage; reuse existing Classify/result-dialogue/no-answer-key coverage.
3. **One authority carrier + one Rust constructor.** Add optional Interrogation Phase `Represented Authority` through parser/emitter/validation/reachability/Rust. All interrogation story reveal contexts are built by one private `interrogation_story_context(...)` helper that accepts the owning immutable Phase definition and reads authority itself; Investigation and Analysis remain authority-null.
4. **Minimal independently-compilable catalog.** Add four Facts, secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export`, and Source Groups `door_lock_fixed_record` / `victim_phone_device`. Catalog definitions do not require producers merely because they exist; reachability errors concern authored nodes requiring unreachable progress. Keep catalog/provenance separate from Analysis authoring and expect it to compile independently.
5. **Real Beat 8.5.** Replace `scene_8_5.md` with `analysis_scene_8_5.md`: Classify → Order → Threshold. Add a supersession note to `semantic-content-reaudit.md` marking deleted-linear-scene references as historical pre-HPA-265 findings.
6. **Authority is load-bearing.** Existing hearing `gate` grants `narrow_lock_export` and acquires `approved_clip` atomically. p4 requires the actual Markdown predicate `authorization:narrow_lock_export granted`; `authorization_granted` is normalized JSON terminology only.
7. **Hearing confirms instead of re-teaching.** p1–p4 keep proof order/contradictions but become concise formal confirmation; p5+ remains unchanged.
8. **Focused packaged smoke with real CI ownership.** Do not grow `production-journey.e2e.ts`. Add `analysis-beat85` after `production-journey` in `E2E_SUITE_IDS`, the gameplay chain, and the `story-and-compiler` risk rule. One real Threshold draft gets Save → Title → Continue.
9. **Human gate.** Rich hints remain playtest-conditional.

## Production catalog/provenance

Facts:

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
merge_time_is_not_event_time
two_independent_lock_contradictions_identified
```

Each has Summary/Details/`Category: chapter_1`.

```text
prepare_narrow_lock_request     secondary
narrow_lock_export              grantingAuthority = KAGAMI 證據摘要審查會主理
```

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

Threshold requires 2 selected, 2 distinct source groups, `[time, order]`, no procedural-status restriction, and one exact same-source Incorrect Selection.

## Hearing handoff

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

## Packaged acceptance

`chapter-1-analysis-beat-85-ready` seeds required production records through existing packaged definitions/`AcquisitionCtx`, clears presentation-only seed events, and jumps to production Analysis.

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
-> gate grant
-> narrow_lock_export + approved_clip
-> p4 reachable
```

`analysis-beat85` belongs to the gameplay chain and story/compiler risk selection.

## Acceptance criteria

- [ ] Shared Order-card source behavior proven in compiler + Rust fixtures before production authoring.
- [ ] Exact incomplete Order + Threshold Rust restore coverage.
- [ ] One canonical production `analysis_scene_8_5.md`; no playable old linear duplicate.
- [ ] Semantic re-audit marks deleted `scene_8_5.md` references historical.
- [ ] Beat 8.5 establishes four facts + request objective and never grants authorization.
- [ ] All interrogation story contexts use one authority-aware constructor.
- [ ] Gate grants authorization + approved clip atomically/once.
- [ ] p4 requires `authorization:narrow_lock_export granted`.
- [ ] Hearing confirms rather than re-teaches Analysis.
- [ ] One packaged Threshold draft survives Save → Title → Continue and reaches grant.
- [ ] `analysis-beat85` belongs to gameplay chain and story/compiler risk selection.
- [ ] Human playtest accepts first version or yields one concrete iteration.
- [ ] No Chapter 2 work, generic authority family, hint engine, save migration, or fake Event evidence records.

## Verification floor

`bun run scenes:compile`; `bun run test:scripts`; focused Analysis frontend tests; focused + full Rust tests; E2E registry/selection tests; focused `analysis-beat85`; `bun run check`; normal lint/test policy; human Beat 8.5 → hearing playtest.
