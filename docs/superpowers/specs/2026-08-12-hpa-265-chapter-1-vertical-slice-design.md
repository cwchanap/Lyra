# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Design

## Status
Ready for implementation after review. HPA-265 is the single Chapter 1 delivery/acceptance owner.

## Outcome

```text
real Chapter 1 evidence
-> Beat 8.5 Classify / Order / Threshold
-> facts + prepare_narrow_lock_request
-> existing KAGAMI hearing
-> represented authority grants narrow_lock_export
-> authorization gate unlocks p4
-> approved_clip acquired
-> existing proof order
-> focused packaged Save/Continue
-> human acceptance
```

## Locked decisions

- Prove shared Order-card sources first in compiler + Rust fixtures: four event card ids share existing fixture `evidence:lock_sequence`. Production uses one real `local_sequence_record`; never invent four Case File rows.
- Add only missing incomplete Order/Threshold Rust restores.
- Add optional Phase `Represented Authority` through existing compiler/reachability/Rust seams. All interrogation story contexts use one private helper that accepts owning immutable Phase definition and reads authority itself. Investigation/Analysis stay authority-null.
- Production catalog/provenance is independently compilable. Definitions need no producer merely by existing; reachability failures apply to authored nodes requiring unreachable progress.
- Replace linear `scene_8_5.md` with one production Analysis scene; add historical supersession note to semantic re-audit when deleting old file.
- Gate grants `narrow_lock_export` + `approved_clip` atomically. p4 requires Markdown `authorization:narrow_lock_export granted` (`authorization_granted` is normalized JSON only).
- p1–p4 become concise confirmation; p5+ unchanged.
- Keep `production-journey` narrow. Add `analysis-beat85` after it in suite ids, gameplay chain, and story/compiler risk rule. One packaged Threshold Save → Title → Continue is enough.
- Human playtest remains final subjective gate; rich hints conditional.

## Minimal production data

Facts: `miyake_known_lies_are_unrelated_to_murder`, `earlier_external_entry_exists`, `merge_time_is_not_event_time`, `two_independent_lock_contradictions_identified` (Summary/Details/`Category: chapter_1`). Secondary objective: `prepare_narrow_lock_request`. Authorization: `narrow_lock_export`, granting authority `KAGAMI 證據摘要審查會主理`.

```text
local_sequence_record -> door_lock_fixed_record [order]
external_maintenance_credential -> door_lock_fixed_record [order, access]
victim_phone_notification -> victim_phone_device [time]
```

## Hearing

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

```text
Beat8.5-ready checkpoint
-> Classify -> Order -> one-card Threshold
-> Save -> Title -> Continue once
-> Threshold complete -> debug jump hearing retaining state
-> p1-p3 -> gate -> authorization + clip -> p4 reachable
```

`analysis-beat85` belongs to gameplay chain + story/compiler risk selection.

## Acceptance

Shared-source proof first; exact Order/Threshold restores; one canonical Analysis scene + audit note; four facts/request objective; one authority-aware context helper; atomic exact-once grant+clip; p4 authorization gate; confirmation-style hearing; focused packaged Save/Continue; normal E2E ownership; human acceptance; no Chapter2/generalized architecture.
