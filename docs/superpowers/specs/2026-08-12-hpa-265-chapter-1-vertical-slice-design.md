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

The former chain was effectively:

```text
HPA-262 platform acceptance
  -> HPA-264 request/hearing handoff
    -> HPA-265 production authoring/iteration
      -> HPA-266 first-version acceptance

HPA-263 optional post-playtest hints
```

Those boundaries no longer buy meaningful isolation:

- HPA-259/260/261 already shipped the Analysis compiler, Rust runtime, and Svelte workbench.
- Remaining HPA-262 work is acceptance coverage, not a new platform layer.
- The represented-authority seam has one real Chapter 1 consumer: the existing hearing gate.
- Production authoring and first-version acceptance cannot be meaningfully separated once the real scene exists.
- HPA-263 is intentionally conditional on the same playtest.

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

1. Prove, before production authoring, that four distinct Order cards may share one evidence source through both compiler and Rust runtime.
2. Add exact incomplete Order and Threshold restore coverage.
3. Add one optional interrogation Phase `Represented Authority` field and propagate it through existing compiler/reachability/Rust reveal paths.
4. Author real Chapter 1 catalog/provenance/Analysis content.
5. Make the hearing grant load-bearing by requiring the authorization for p4.
6. Add one focused packaged Beat 8.5 suite and wire it into existing E2E chain/risk ownership.

No AuthorityEvent family, grant ledger, request screen, save migration, new board kind, or hint engine is required.

## 4. Early shared-source proof

The synthetic compiler/Rust fixture currently gives Event-1841..1844 separate evidence sources. Production should not copy that artifact: the real case has one fixed local-sequence record containing four ordered rows.

Before changing production content, modify both checked-in Analysis fixtures so all four Order cards use the existing fixture `evidence:lock_sequence` while retaining distinct card ids:

```text
event_1841 --\
event_1842 ----> evidence:lock_sequence
event_1843 ----/
event_1844 ---/
```

Then run the existing script compiler tests and Rust cross-board acceptance.

This is a test-fixture proof, not a production data-model change. If it fails, fix the narrow shared-source bug before any production dialogue/provenance work begins.

## 5. Canonical production source ownership

Production Chapter 1 remains under:

```text
docs/stories_plan/
  story_catalog.md
  chapter_1/
    chapter.md
    investigation_scene_7.md
    investigation_scene_8.md
    analysis_scene_8_5.md
    interrogation_scene_10.md
    semantic-content-reaudit.md
```

`scene_8_5.md` is replaced by `analysis_scene_8_5.md`, not kept as a second playable transition.

The semantic re-audit is historical evidence. When the linear file is deleted, add a short supersession note that its `scene_8_5.md` findings describe the pre-HPA-265 production snapshot; do not rewrite the historical audit as though it had reviewed the new Analysis scene.

## 6. Production story catalog

Create the smallest catalog needed by the real slice.

### Facts

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
merge_time_is_not_event_time
two_independent_lock_contradictions_identified
```

Every Fact includes parser-required `Summary`, `Details`, and `Category: chapter_1`.

### Objective

```text
prepare_narrow_lock_request
kind = secondary
```

### Authorization

```text
narrow_lock_export
grantingAuthority = KAGAMI 證據摘要審查會主理
```

### Source groups

```text
door_lock_fixed_record
victim_phone_device
```

Each Source Group includes `Summary`.

Catalog definitions are allowed to exist before their eventual producers are authored. Whole-corpus reachability errors are about authored nodes whose prerequisites cannot be produced; merely defining a Fact/Objective/Authorization does not require an immediate producer. Therefore catalog/provenance work remains an independently compilable task rather than being forcibly merged with Analysis authoring.

## 7. Truthful provenance and Threshold semantics

Only three production records need new provenance for the v1 Threshold.

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

The two door-lock records come from the same fixed-panel package and must remain the same source group. Do not split them to manufacture independence.

Threshold rules:

```text
eligible = local_sequence_record, external_maintenance_credential, victim_phone_notification
minimum selected = 2
minimum distinct source groups = 2
required capabilities = [time, order]
allowed procedural statuses = []
require source group = true
```

One exact wrong selection is enough for v1:

```text
local_sequence_record + external_maintenance_credential
-> same-source feedback
```

No progressive hint taxonomy is authored before playtest evidence.

## 8. Real production Beat 8.5

### 8.1 Classify — `evidence_packages`

Use real Case File records to separate:

1. Miyake's unrelated small lies.
2. Earlier third-party route/access evidence.
3. Lock/KAGAMI chronology conflict.

Outputs:

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
```

### 8.2 Order — `local_event_sequence`

Four card identities represent four rows inside one source record:

```text
event_1841 -> event_1842 -> event_1843 -> event_1844
```

Every card uses:

```text
evidence:local_sequence_record
```

The UI orders card ids; the Case File continues to contain one truthful evidence record.

Output:

```text
merge_time_is_not_event_time
```

### 8.3 Threshold — `narrow_request_basis`

Uses the three records/provenance above.

Outputs:

```text
two_independent_lock_contradictions_identified
complete prepare_narrow_lock_request
```

Analysis never grants `narrow_lock_export`.

## 9. Represented authority

Add one optional immutable Phase definition field:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

It flows through:

```text
Markdown
-> ASTInquiryPhase.representedAuthority
-> optional emitted JSON member
-> validateStoryRevealTargets
-> ReachabilityNode.representedAuthority
-> InterrogationPhaseJson.represented_authority
-> Rust StoryRevealMaterializationContext
-> existing grant_authorization validation/mutation
```

Legacy phases omit the JSON member rather than emitting `null`.

### 9.1 One Rust context constructor

Do not hand-thread four raw `StoryRevealMaterializationContext` literals. Add one private `interrogation_story_context(...)` helper in `mod.rs` that accepts the owning immutable `InterrogationPhaseJson`, reads its `represented_authority`, and builds the context.

All interrogation-origin story contexts route through it:

```text
InterrogationPhase
InquiryQuestion auto-break
TestimonyLine On Correct
InquiryQuestion reveals after correct contradiction
```

Investigation and Analysis remain authority-null.

The helper is local code deduplication comparable to the existing `interrogation_segment()` helper, not a new abstraction layer.

## 10. Hearing role after Beat 8.5

Keep the existing proof order, but p1–p4 become formal confirmation rather than a second Analysis tutorial.

```text
p1 -> confirm small-lie conclusion
p2 -> confirm earlier-time conflict
p3 -> confirm earlier-third-party/sightline conflict
gate -> authority decision
p4 -> formalize merge-time interpretation with approved clip
p5+ -> existing culprit proof unchanged
```

### 10.1 Gate

The existing `gate` phase becomes the first production represented-authority event:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
```

At `gate_hold_record` correct resolution:

```markdown
- **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
```

The grant and evidence acquisition remain one existing reveal transaction and therefore share current atomic/idempotent command semantics.

### 10.2 Authorization must gate something

Change p4 unlock to:

```markdown
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
```

`authorization:narrow_lock_export granted` is the Markdown authoring grammar. `authorization_granted` is the normalized JSON predicate name and must not be written into the scene file.

This makes the represented-authority producer load-bearing in real production reachability instead of producing a decorative Case File row only.

## 11. Packaged acceptance boundary

Do not grow `production-journey.e2e.ts` into a chapter runner. It keeps its current P1 → first KAGAMI acquisition responsibility.

Add one test-only checkpoint:

```text
chapter-1-analysis-beat-85-ready
```

It:

1. starts from production resources;
2. acquires the exact required real evidence through existing packaged definitions/`AcquisitionCtx`;
3. discards presentation-only pending acquisition events for the seed;
4. jumps to `analysis_scene_8_5`;
5. exposes Analysis mode.

Focused packaged path:

```text
ready checkpoint
-> solve Classify
-> solve Order
-> one-card Threshold draft
-> Save -> Title -> Continue once
-> exact Threshold draft restored
-> solve Threshold
-> debug jump to interrogation_scene_10 retaining story/inventory state
-> p1-p3 confirmation
-> gate grant
-> narrow_lock_export + approved_clip
-> p4 becomes reachable
```

Same-source wrong feedback remains focused compiler/Rust/Svelte coverage. Result-dialogue restore remains Rust coverage. There is no packaged restore matrix for all three boards.

## 12. E2E ownership is decided up front

The registry requires every suite to belong to a chain. Add `analysis-beat85` immediately after `production-journey` in `E2E_SUITE_IDS` and in the gameplay chain:

```text
smoke
gameplay
production-journey
analysis-beat85
```

The `story-and-compiler` risk rule must select the same four suites so Chapter 1 story/compiler PRs actually run Beat 8.5 coverage. The new suite must not exist only under `--full`.

Update registry and selection tests in the same task.

## 13. Save/restore coverage split

Use the cheapest layer for each persistence claim:

- Classify incomplete restore: existing Rust coverage.
- Order incomplete restore: new Rust coverage.
- Threshold incomplete restore: new Rust coverage.
- Result-dialogue restore: existing Rust coverage.
- One real production Save → Title → Continue: packaged Threshold smoke.

Do not repeat the same persistence matrix through WebDriver.

## 14. Human acceptance gate

After automated implementation is green, stop for human playtest.

Evaluate:

- board clarity;
- detective feel/pacing;
- whether p1–p4 feel like confirmation rather than repetition;
- same-source feedback comprehension;
- Save/Continue confidence;
- keyboard usability;
- save-thumbnail identification value.

If no concrete misunderstanding appears, richer contextual/progressive hints are not required for Chapter 1 first version. If one appears, prefer Prompt/Card/Group copy, existing Hint, or one exact Incorrect Selection before adding runtime semantics.

No empty playtest commit.

## 15. Acceptance criteria

- [ ] Shared Order-card source behavior is proven in compiler and Rust fixtures before production authoring.
- [ ] Incomplete Order and Threshold drafts have exact Rust restore coverage; existing Classify coverage remains green.
- [ ] Production Chapter 1 has one canonical `analysis_scene_8_5.md` and no playable `scene_8_5.md` duplicate.
- [ ] The historical semantic re-audit clearly marks deleted `scene_8_5.md` references as pre-HPA-265 findings.
- [ ] Real records carry only the provenance required for the first-version Threshold.
- [ ] Beat 8.5 establishes four authored facts and completes `prepare_narrow_lock_request`, but cannot grant `narrow_lock_export`.
- [ ] All interrogation story reveal contexts obtain authority through one private constructor; Investigation/Analysis remain authority-null.
- [ ] The gate grants `narrow_lock_export` and `approved_clip` atomically/once with the authored KAGAMI authority.
- [ ] p4 explicitly requires `authorization:narrow_lock_export granted`.
- [ ] The hearing confirms prior conclusions without re-teaching the full boards.
- [ ] One packaged real Threshold draft survives Save → Title → Continue and the focused path reaches the grant.
- [ ] `analysis-beat85` belongs to the gameplay chain and the story/compiler risk rule.
- [ ] Human playtest accepts the first version or produces one concrete follow-up iteration.
- [ ] No Chapter 2 work, generic authority event family, hint engine, save migration, or fake Event evidence records are introduced.

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

- HPA-603 practice-card runtime cleanup remains separate unless real packaged play proves it blocks this slice.
- HPA-601 practice-card must-reachability hardening remains separate unless real packaged play proves it blocks this slice.
- Full production hardening remains HPA-536.
- Chapter 2 remains deferred until HPA-265 is accepted and Chapter 2 receives a fresh canon/design review.
