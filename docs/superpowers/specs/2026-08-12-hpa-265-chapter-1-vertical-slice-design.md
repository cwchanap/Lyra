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

## Final design decisions

- Prove shared Order-card source behavior **before** production authoring in both compiler and Rust fixtures: `event_1841`..`event_1844` all point to existing fixture `evidence:lock_sequence`, while card ids/order remain distinct. Production then uses one real `evidence:local_sequence_record` rather than fake Event evidence rows.
- Add only incomplete Order + Threshold Rust restore coverage; reuse existing Classify/result-dialogue/no-answer-key coverage.
- Add optional Interrogation Phase `Represented Authority` through parser/emitter/validation/reachability/Rust. Use one private `interrogation_story_context(...)` constructor accepting the owning immutable Phase definition and reading authority itself. All interrogation story reveal contexts use it; Investigation/Analysis remain authority-null.
- Add the minimal Chapter 1 catalog/provenance as an **independently compilable** slice. Definitions do not need producers simply because they exist; reachability errors concern authored nodes with unreachable prerequisites.
- Replace the linear Beat 8.5 with one production Analysis scene; mark old `semantic-content-reaudit.md` references to `scene_8_5.md` as historical pre-HPA-265 findings.
- Existing hearing gate grants `narrow_lock_export` + `approved_clip` atomically. p4 requires actual authoring syntax `authorization:narrow_lock_export granted`; `authorization_granted` is normalized JSON terminology only.
- p1–p4 keep proof order/contradictions but become concise formal confirmation, not a second Analysis tutorial. p5+ remains unchanged.
- Keep `production-journey.e2e.ts` narrow. Add `analysis-beat85` immediately after it in `E2E_SUITE_IDS`, gameplay chain, and the `story-and-compiler` risk rule. One packaged Threshold Save → Title → Continue proves the real persistence boundary.
- Human playtest remains the final subjective gate; richer hints are playtest-conditional.

## Production catalog/provenance

Facts:

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
merge_time_is_not_event_time
two_independent_lock_contradictions_identified
```

Each includes Summary/Details/`Category: chapter_1`.

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

Threshold: 2 selected, 2 distinct source groups, `[time, order]`, no procedural-status restriction, one exact same-source Incorrect Selection.

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

Test-only `chapter-1-analysis-beat-85-ready` seeds required records through existing packaged definitions/`AcquisitionCtx`, clears presentation-only seed events, and jumps to production Analysis.

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

## Acceptance criteria

- [ ] Shared Order-card source behavior proven in compiler + Rust fixtures first.
- [ ] Exact incomplete Order + Threshold Rust restore coverage.
- [ ] One production `analysis_scene_8_5.md`; no playable old linear duplicate.
- [ ] Semantic re-audit marks deleted-linear references historical.
- [ ] Beat 8.5 establishes four facts + request objective, never grants authorization.
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
