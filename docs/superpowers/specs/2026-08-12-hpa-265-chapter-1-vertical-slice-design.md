# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Design

## Status

Ready for implementation after review. HPA-265 is the single Chapter 1 product-delivery and first-version acceptance owner.

## Final architecture

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

### Shared-source model

Before production authoring, prove in both compiler and Rust fixtures that distinct Order card ids `event_1841`..`event_1844` may all reference one existing evidence source `evidence:lock_sequence`. Production then uses one truthful `evidence:local_sequence_record` for its four event-row reasoning cards, never four fake Case File records.

### Persistence

Add only incomplete Order + Threshold exact Rust restore proofs. Existing Classify, result-dialogue, and answer-key-redaction coverage stays authoritative.

### Represented authority

Add optional Interrogation Phase `Represented Authority` through parser/emitter/validation/reachability/Rust. Use one private `interrogation_story_context(...)` helper accepting the owning immutable `InterrogationPhaseJson` and reading authority itself. All interrogation story reveal contexts use it; Investigation and Analysis remain authority-null.

### Catalog/provenance

Add only four Chapter 1 Facts, secondary `prepare_narrow_lock_request`, Authorization `narrow_lock_export`, and two Source Groups. Catalog/provenance remains independently compilable: catalog definitions do not require producers simply by existing; reachability errors concern authored nodes with unreachable prerequisites.

```text
local_sequence_record -> door_lock_fixed_record, [order]
external_maintenance_credential -> door_lock_fixed_record, [order, access]
victim_phone_notification -> victim_phone_device, [time]
```

### Production Analysis

Replace `scene_8_5.md` with one `analysis_scene_8_5.md`: Classify → Order → Threshold. Delete the old linear scene after migrating useful atmosphere. Add a supersession note to `semantic-content-reaudit.md` marking its old `scene_8_5.md` references historical pre-HPA-265 findings.

### Hearing authorization

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

This is the actual Markdown authoring grammar; `authorization_granted` is the normalized JSON predicate name.

p1–p4 become concise formal confirmation while preserving proof order/contradictions; p5+ stays unchanged.

### Packaged acceptance

Keep `production-journey.e2e.ts` narrow. Add test-only `chapter-1-analysis-beat-85-ready` and suite `analysis-beat85`, placed immediately after `production-journey` in `E2E_SUITE_IDS`, gameplay chain, and story/compiler risk selection.

```text
ready -> Classify -> Order -> one-card Threshold draft
-> Save -> Title -> Continue once -> exact draft
-> Threshold -> debug jump to hearing retaining state
-> p1-p3 -> gate -> authorization + approved_clip -> p4 reachable
```

### Human gate

Human playtest is final subjective acceptance; rich hints remain conditional on observed confusion.

## Acceptance criteria

- shared-source behavior proved first in compiler + Rust fixtures;
- incomplete Order + Threshold exact restores;
- one canonical production Analysis Beat 8.5 and historical audit note;
- four facts + request objective, no Analysis-side grant;
- one authority-aware constructor for all interrogation story contexts;
- gate grant + clip atomic/once and p4 authorization-gated;
- hearing confirms rather than re-teaches;
- one packaged Threshold Save/Continue reaches grant;
- `analysis-beat85` owned by gameplay chain + story/compiler risk;
- human acceptance;
- no Chapter 2 abstractions, generic authority family, hint engine, migration, or fake Event evidence.
