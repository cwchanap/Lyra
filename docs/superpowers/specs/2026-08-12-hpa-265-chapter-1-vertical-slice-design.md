# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Design

## Status

Ready for implementation after review. This design supersedes the separate delivery sequencing previously tracked as HPA-262, HPA-263, HPA-264, HPA-265, and HPA-266. HPA-265 is the single Chapter 1 product-delivery and first-version acceptance owner.

## 1. Outcome

Deliver one real Chapter 1 product slice:

```text
real Chapter 1 evidence
  -> Beat 8.5 Classify / Order / Threshold
  -> durable facts + prepare_narrow_lock_request
  -> existing final KAGAMI hearing
  -> represented KAGAMI authority grants narrow_lock_export
  -> authorization:narrow_lock_export granted gates p4
  -> existing approved_clip evidence becomes available
  -> Chapter 1 continues through the existing proof order
  -> one packaged save/resume proof + human playtest acceptance
```

The work should feel like finishing one gameplay sequence, not integrating five subsystems. The Analysis compiler/runtime/workbench, story state, Case File, and save system already exist and remain their current owners.

## 2. Why the old five-ticket chain is one task

The former chain was effectively HPA-262 platform acceptance → HPA-264 request/hearing handoff → HPA-265 production authoring → HPA-266 first-version acceptance, with HPA-263 as optional playtest polish. Those boundaries no longer buy meaningful isolation because the Analysis platform is already shipped, the authority seam has one Chapter 1 consumer, and production authoring/acceptance are one flow.

## 3. Reuse survey

### Already shipped — keep as-is

- Analysis Markdown/parser/validation for `classify`, `order`, `threshold`.
- Rust Analysis drafts, answer checking, story effects, read-only solved boards, exact save/restore.
- Svelte Analysis workbench with pointer/keyboard interaction.
- Threshold accepted-set materialization from source groups and proof capabilities.
- Story catalog Fact / Objective / Authorization / Source Group schemas.
- HPA-257 positive predicates, reveal transaction, reachability, authority matching, and `authorization:<id> granted` authoring grammar.
- `StoryRevealMaterializationContext.represented_authority` and Rust grant equality checks.
- Case File authorization display.
- Test-only scene jump and packaged acquisition seams.
- Existing hearing phases `p1`, `p2`, `p3`, `gate`, `p4` and `gate_hold_record`.

### Missing seams

1. Prove before production authoring that four distinct Order cards may share one evidence source through compiler and Rust runtime.
2. Add exact incomplete Order and Threshold restore coverage.
3. Add one optional interrogation Phase `Represented Authority` field and propagate it through existing compiler/reachability/Rust reveal paths.
4. Author real Chapter 1 catalog/provenance/Analysis content.
5. Make the hearing grant load-bearing by requiring authorization for p4.
6. Add one focused packaged Beat 8.5 suite and wire it into existing E2E chain/risk ownership.

No AuthorityEvent family, grant ledger, request screen, save migration, new board kind, or hint engine is required.

## 4. Early shared-source proof

The synthetic fixture currently gives Event-1841..1844 separate evidence sources. Production should not copy that artifact: the real case has one fixed local-sequence record containing four ordered rows.

Before production changes, modify both checked-in Analysis fixtures so all four Order cards use existing fixture `evidence:lock_sequence` while keeping distinct card ids:

```text
event_1841 --\
event_1842 ----> evidence:lock_sequence
event_1843 ----/
event_1844 ---/
```

Run script compiler tests and the Rust cross-board acceptance. This proves the only untested content-model assumption before real dialogue/provenance work begins.

## 5. Canonical production source ownership

Production remains under `docs/stories_plan/`, with one new global `story_catalog.md` and one new `chapter_1/analysis_scene_8_5.md`. `scene_8_5.md` is replaced, not retained as a second playable transition. `semantic-content-reaudit.md` remains historical evidence; add a supersession note when the old linear file is deleted rather than rewriting the audit.

## 6. Production story catalog

Create only four Facts (`miyake_known_lies_are_unrelated_to_murder`, `earlier_external_entry_exists`, `merge_time_is_not_event_time`, `two_independent_lock_contradictions_identified`), secondary Objective `prepare_narrow_lock_request`, Authorization `narrow_lock_export` granted by `KAGAMI 證據摘要審查會主理`, and Source Groups `door_lock_fixed_record` / `victim_phone_device`.

Each Fact has `Summary`, `Details`, `Category: chapter_1`; each Source Group has Summary.

This catalog/provenance slice remains independently compilable. Current whole-corpus reachability diagnoses authored nodes whose prerequisites cannot be produced; it does not require every catalog definition to have a producer merely because the definition exists. If the independent compile unexpectedly fails on that premise, investigate the regression instead of hiding it by merging authoring tasks.

## 7. Truthful provenance and Threshold semantics

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

The two door-lock records remain the same source group. Threshold requires 2 selected, 2 distinct source groups, `[time, order]`, no procedural-status restriction, and `Require Source Group: true`. One exact same-source wrong selection is enough for v1.

## 8. Real production Beat 8.5

### Classify — `evidence_packages`

Use real Case File records to separate Miyake's unrelated small lies, earlier third-party route/access, and lock chronology conflict. Outputs `miyake_known_lies_are_unrelated_to_murder` and `earlier_external_entry_exists`.

### Order — `local_event_sequence`

Four card identities represent rows inside one source record: `event_1841 -> event_1842 -> event_1843 -> event_1844`. Every card uses `evidence:local_sequence_record`. Output `merge_time_is_not_event_time`.

### Threshold — `narrow_request_basis`

Use the three provenance-bearing records above. Output `two_independent_lock_contradictions_identified` and complete `prepare_narrow_lock_request`. Analysis never grants `narrow_lock_export`.

## 9. Represented authority

Add one optional immutable Phase definition field:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Flow it through Markdown → AST → optional emitted JSON → `validateStoryRevealTargets` → `ReachabilityNode.representedAuthority` → Rust `InterrogationPhaseJson` → `StoryRevealMaterializationContext` → existing grant mutation.

### One Rust context constructor

Do not hand-thread four raw context literals. Add one private `interrogation_story_context(...)` helper in `mod.rs` that accepts the owning immutable `InterrogationPhaseJson`, reads `represented_authority`, and constructs the context. Route InterrogationPhase, InquiryQuestion auto-break, TestimonyLine On Correct, and InquiryQuestion post-correct reveals through it. Investigation and Analysis remain authority-null.

## 10. Hearing role after Beat 8.5

Keep proof order, but p1–p4 become formal confirmation: p1 small-lie conclusion, p2 earlier-time conflict, p3 earlier-third-party/sightline conflict, `gate` authority decision, p4 merge-time interpretation, p5+ unchanged culprit proof.

### Gate

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

At `gate_hold_record`:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

Grant + acquisition remain one atomic/idempotent reveal transaction.

### Authorization must gate something

p4 uses actual Markdown grammar:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

`authorization_granted` is normalized JSON, not authoring syntax. This makes the matching authority producer load-bearing in production reachability.

## 11. Packaged acceptance boundary

Do not grow `production-journey.e2e.ts`. Add test-only checkpoint `chapter-1-analysis-beat-85-ready`: acquire required real records through existing packaged definitions/`AcquisitionCtx`, clear presentation-only pending events for the seed, jump to `analysis_scene_8_5`, expose Analysis mode.

Focused path: ready checkpoint → solve Classify → solve Order → one-card Threshold draft → Save → Title → Continue once → restore exact Threshold draft → solve Threshold → debug jump to `interrogation_scene_10` retaining state → p1-p3 confirmation → gate grant → `narrow_lock_export` + `approved_clip` → p4 reachable.

## 12. E2E ownership is decided up front

Current registry invariants require every suite to belong to a chain. Add `analysis-beat85` immediately after `production-journey` in `E2E_SUITE_IDS` and the gameplay chain. The `story-and-compiler` risk rule selects `smoke`, `gameplay`, `production-journey`, and `analysis-beat85`. The suite must run for the Chapter 1 content/compiler changes it protects, not only under `--full`.

## 13. Save/restore coverage split

- Classify incomplete restore: existing Rust.
- Order incomplete restore: new Rust.
- Threshold incomplete restore: new Rust.
- Result-dialogue restore: existing Rust.
- One real production Save → Title → Continue: packaged Threshold smoke.

Do not repeat the matrix through WebDriver.

## 14. Human acceptance gate

After automated implementation is green, stop for human playtest. Evaluate board clarity, detective feel/pacing, p1–p4 repetition, same-source feedback, Save/Continue confidence, keyboard usability, and thumbnail value. If no concrete misunderstanding appears, richer hints are not required; otherwise prefer authored copy/existing Hint/one exact Incorrect Selection before runtime semantics.

## 15. Acceptance criteria

- [ ] Shared Order-card source behavior is proven in compiler and Rust fixtures before production authoring.
- [ ] Incomplete Order and Threshold drafts have exact Rust restore coverage.
- [ ] One canonical production `analysis_scene_8_5.md`; no playable `scene_8_5.md` duplicate.
- [ ] Historical semantic re-audit marks deleted `scene_8_5.md` references as pre-HPA-265 findings.
- [ ] Real records carry only required Threshold provenance.
- [ ] Beat 8.5 establishes four facts + `prepare_narrow_lock_request`, never grants authorization.
- [ ] All interrogation story contexts obtain authority through one private constructor; Investigation/Analysis remain authority-null.
- [ ] Gate grants `narrow_lock_export` + `approved_clip` atomically/once.
- [ ] p4 requires `authorization:narrow_lock_export granted`.
- [ ] Hearing confirms rather than re-teaches Analysis.
- [ ] One packaged Threshold draft survives Save → Title → Continue and reaches the grant.
- [ ] `analysis-beat85` belongs to gameplay chain and story/compiler risk selection.
- [ ] Human playtest accepts first version or yields one concrete iteration.
- [ ] No Chapter 2 work, generic authority event family, hint engine, save migration, or fake Event evidence records.

## 16. Verification floor

- `bun run scenes:compile`
- `bun run test:scripts`
- focused Analysis frontend tests
- focused + full Rust tests
- E2E registry/selection tests
- focused packaged `analysis-beat85` suite
- `bun run check`
- normal repository lint/test policy
- one human Beat 8.5 → hearing playtest

## 17. Deferred

HPA-603 / HPA-601 remain separate unless real packaged play proves them blocking. Full production hardening remains HPA-536. Chapter 2 remains deferred until HPA-265 acceptance + fresh canon/design review.
