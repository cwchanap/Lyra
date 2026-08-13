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

The implementation finishes one gameplay sequence. Existing Analysis compiler/runtime/UI, story state, Case File, and save/load remain the owners of their current responsibilities.

## Reuse and missing seams

Reuse: Classify/Order/Threshold parser/runtime/UI, threshold provenance materialization, story catalog schemas, HPA-257 predicates/reveal transactions/reachability/authority checks, Rust `StoryRevealMaterializationContext`, Case File authorization display, test-only scene jump, packaged acquisition seams, and the existing hearing phases.

Missing only:

1. early compiler + Rust proof that four Order cards may share one evidence source;
2. incomplete Order/Threshold restore coverage;
3. optional interrogation Phase `Represented Authority` propagation;
4. real Chapter 1 catalog/provenance/Analysis content;
5. p4 consuming the granted authorization;
6. one focused Beat 8.5 E2E suite with canonical chain/risk ownership.

No AuthorityEvent family, grant ledger, request screen, save migration, new board kind, or hint engine.

## Early shared-source proof

Before production authoring, modify both checked-in Analysis fixtures so card ids `event_1841`..`event_1844` all use existing fixture `evidence:lock_sequence`, while card ids/accepted order remain distinct. Run script tests and the existing Rust cross-board acceptance.

This proves the only untested content-model assumption before real dialogue/provenance edits. Production then uses the analogous real source `evidence:local_sequence_record` without inventing four Case File rows.

## Production catalog and provenance

Create only four Facts (`miyake_known_lies_are_unrelated_to_murder`, `earlier_external_entry_exists`, `merge_time_is_not_event_time`, `two_independent_lock_contradictions_identified`), secondary Objective `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by `KAGAMI 證據摘要審查會主理`, and Source Groups `door_lock_fixed_record` / `victim_phone_device`.

Each Fact has `Summary`, `Details`, `Category: chapter_1`; each Source Group has Summary.

Truthful provenance:

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

Catalog/provenance remains an independently compilable task. Reachability errors concern authored nodes whose prerequisites cannot be produced; definitions do not require producers merely because they exist.

## Production Beat 8.5

`analysis_scene_8_5.md` replaces `scene_8_5.md` in the manifest.

- Classify `evidence_packages`: separate Miyake small lies, earlier third-party route/access, lock chronology gap; output first two facts.
- Order `local_event_sequence`: Event-1841 → Event-1844, all cards backed by `evidence:local_sequence_record`; output `merge_time_is_not_event_time`.
- Threshold `narrow_request_basis`: use the three provenance records, require 2 selected / 2 source groups / `[time, order]`, no procedural-status gate; output the final fact + complete `prepare_narrow_lock_request`.

One exact same-source Incorrect Selection is enough. Analysis never grants authorization.

When deleting `scene_8_5.md`, add a short supersession note to `semantic-content-reaudit.md` explaining its old linear-scene references are historical pre-HPA-265 findings; preserve the audit itself.

## Represented authority

Add optional Phase field:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Flow: Markdown → AST → optional JSON → story-target validation → reachability node authority → Rust phase definition → reveal materialization context → existing grant mutation.

In Rust, add one private `interrogation_story_context(...)` constructor in `mod.rs` that accepts the owning immutable `InterrogationPhaseJson` and reads authority itself. Route Phase, InquiryQuestion auto-break, TestimonyLine On Correct, and InquiryQuestion post-correct reveals through it. Investigation and Analysis remain authority-null.

## Hearing role

Keep p1–p4 order but make them concise formal confirmation, not a second Analysis tutorial. p5+ culprit proof remains unchanged.

Gate:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

Correct gate resolution:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

p4 must consume the authorization using actual authoring grammar:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

`authorization_granted` is normalized JSON, not Markdown syntax. This makes the authority producer load-bearing in production reachability.

## Packaged acceptance and CI ownership

Do not expand `production-journey.e2e.ts`.

Add test-only checkpoint `chapter-1-analysis-beat-85-ready`: acquire required real records through existing packaged definitions/`AcquisitionCtx`, clear presentation-only pending acquisition events for the seed, jump to `analysis_scene_8_5`, expose Analysis mode.

Focused flow:

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

Add `analysis-beat85` immediately after `production-journey` in `E2E_SUITE_IDS` and the gameplay chain. Add it to the `story-and-compiler` risk rule so Chapter 1 story/compiler changes actually run it. Current registry invariants require every suite to belong to a chain.

## Persistence split

- Classify incomplete: existing Rust.
- Order incomplete: new Rust.
- Threshold incomplete: new Rust.
- Result-dialogue restore: existing Rust.
- One real production Save → Title → Continue: packaged Threshold smoke.

No WebDriver persistence matrix.

## Human acceptance gate

After automation is green, stop for human playtest. Evaluate board clarity, detective feel/pacing, p1–p4 repetition, same-source feedback, Save/Continue confidence, keyboard usability, and thumbnail value. If no concrete misunderstanding appears, richer hints are not required; otherwise prefer authored copy/existing Hint/one exact Incorrect Selection before runtime semantics.

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
