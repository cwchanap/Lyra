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

## Architecture decisions

- Prove shared Order-card sources before production authoring in both compiler + Rust fixtures: `event_1841`..`event_1844` all source existing fixture `evidence:lock_sequence`, retaining distinct card ids/order. Production uses one real `evidence:local_sequence_record`, never fake Event evidence rows.
- Add only incomplete Order + Threshold exact Rust restores. Reuse current Classify/result-dialogue/no-answer-key coverage.
- Add optional Interrogation Phase `Represented Authority` through parser/emitter/validation/reachability/Rust. Every interrogation story context is created by one private helper accepting owning immutable Phase definition and reading authority itself. Investigation/Analysis remain authority-null.
- Keep minimal catalog/provenance independently compilable. Catalog definitions do not need producers merely because they exist; reachability errors concern authored nodes with unreachable prerequisites.
- Replace linear Beat 8.5 with production Analysis; when old file is deleted, add a supersession note to the historical semantic re-audit rather than rewriting its findings.
- Gate grants `narrow_lock_export` + `approved_clip` atomically. p4 requires actual authoring syntax `authorization:narrow_lock_export granted`; `authorization_granted` is normalized JSON terminology.
- p1–p4 remain in proof order but become concise confirmation; p5+ unchanged.
- Keep `production-journey` narrow. Add `analysis-beat85` after it in suite list, gameplay chain, and story/compiler risk selection. One packaged Threshold Save → Title → Continue is sufficient.
- Human playtest is the final subjective gate; rich hints remain conditional.

## Catalog/provenance

Four Facts with Summary/Details/`Category: chapter_1`; secondary `prepare_narrow_lock_request`; Authorization `narrow_lock_export` granted by KAGAMI review authority; Source Groups `door_lock_fixed_record` / `victim_phone_device`.

```text
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
victim_phone_notification -> victim_phone_device, [time]
```

## Hearing handoff

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

## Packaged acceptance

`chapter-1-analysis-beat-85-ready` seeds production records through existing packaged definitions/`AcquisitionCtx`, clears seed presentation events, and jumps to Analysis.

```text
ready -> Classify -> Order -> one-card Threshold
-> Save -> Title -> Continue once -> exact draft
-> Threshold -> debug jump to hearing retaining state
-> p1-p3 -> gate -> authorization + approved_clip -> p4 reachable
```

`analysis-beat85` belongs to gameplay chain and story/compiler risk selection.

## Acceptance criteria

- shared-source proof first;
- incomplete Order + Threshold exact restores;
- one canonical Analysis Beat 8.5 and historical audit note;
- four facts + request objective, no Analysis-side grant;
- one authority-aware helper for all interrogation story contexts;
- atomic/once grant + clip, p4 authorization-gated;
- hearing confirms rather than re-teaches;
- one packaged Threshold Save/Continue reaches grant;
- E2E suite in gameplay chain + story/compiler risk;
- human acceptance;
- no Chapter 2 abstractions, generic authority family, hint engine, save migration, or fake Event evidence.
