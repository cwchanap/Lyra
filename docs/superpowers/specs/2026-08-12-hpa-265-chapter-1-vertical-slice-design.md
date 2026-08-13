# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Design

## Status

Ready for implementation planning after review. This design supersedes the separate delivery sequencing previously tracked as HPA-262, HPA-263, HPA-264, HPA-265, and HPA-266. HPA-265 is the single Chapter 1 product-delivery and first-version acceptance owner.

## 1. Outcome

Deliver one real Chapter 1 product slice:

```text
real Chapter 1 evidence
  -> Beat 8.5 Classify / Order / Threshold
  -> durable facts + prepare_narrow_lock_request
  -> existing final KAGAMI hearing
  -> represented KAGAMI authority grants narrow_lock_export
  -> existing approved_clip evidence becomes available
  -> Chapter 1 continues through the existing proof order
  -> one packaged save/resume proof + human playtest acceptance
```

The work should feel like finishing one gameplay sequence, not integrating five subsystems. The Analysis compiler/runtime/workbench, story state, Case File, and save system already exist and remain their current owners.

## 2. Why the old five-ticket chain is now one task

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
- The remaining HPA-262 work is two persistence acceptance gaps, not a new platform layer.
- HPA-264 has exactly one first-version consumer: the existing Chapter 1 hearing gate.
- HPA-265 cannot be accepted without the authority handoff and real save/resume path.
- HPA-266 is acceptance of the same production scene.
- HPA-263 was always conditional on the same playtest.

One HPA-265 ticket therefore lowers handoff cost without creating a monolithic architecture change.

## 3. Reuse survey and review resolution

### Already shipped — reuse

- **Classify / Order / Threshold:** compiler, Rust Analysis runtime, and Svelte workbench already support all three board kinds.
- **Threshold accepted sets:** existing provenance/source-group/proof-capability materialization remains authoritative.
- **Multiple Analysis cards sharing one record source:** card identity is the Analysis card id, not the source record id. Event-1841..1844 can therefore share `evidence:local_sequence_record`.
- **Incorrect Selection:** existing threshold authored feedback handles the one same-source teaching case needed for v1.
- **Story state:** HPA-255 remains the only Fact / Objective / Authorization mutation owner.
- **Reveal transaction/idempotence:** HPA-257 remains the only reveal dispatcher and atomicity owner.
- **Authorization check:** Rust `apply_story_reveal()` already compares `represented_authority` with the catalog authorization's `grantingAuthority`.
- **Positive gate grammar:** existing interrogation unlock expressions already accept story predicates.
- **Save/load:** current Analysis snapshot already persists typed drafts; no schema migration is needed.

### Small extensions still required

1. Add one optional immutable `Represented Authority` field to an interrogation **Phase** definition.
2. Propagate that field through parser -> emitted JSON -> story-target validation -> whole-corpus reachability -> every interrogation `StoryRevealMaterializationContext`.
3. Add a dedicated packaged Beat 8.5 E2E checkpoint/seed so packaged acceptance does not replay the whole chapter from the title screen.

No AuthorityEvent scene family, grant ledger, request screen, new board kind, hint engine, or four Event evidence records are introduced.

### Review item intentionally not adopted

The review reported that `.claude/skills/writing-analysis-scene/SKILL.md` still treated Classify/Order as parser-only. That is stale against current `main`: the skill now explicitly states that Chapter 1 supports `classify`, `order`, and `threshold`, and that the compiler and packaged runtime consume all three. HPA-265 therefore does **not** modify that skill merely to repeat an already-correct contract.

The interrogation skill **does** still contain the pre-HPA-264 statement that production authorization grants are unavailable. That text becomes stale once the represented-authority carrier lands and must be updated in the authority task.

## 4. Canonical production ownership

Production Chapter 1 remains under one source root:

```text
docs/stories_plan/
  story_catalog.md
  chapter_1/
    chapter.md
    ... existing scenes ...
    analysis_scene_8_5.md
    investigation_scene_9.md
    interrogation_scene_10.md
```

The existing linear `scene_8_5.md` is removed after its useful dialogue is migrated into Analysis Intro/Outro. There must not be two playable Beat 8.5 entries.

## 5. Production story catalog

The production catalog is intentionally Chapter-1-small. It contains exactly the global definitions required by this slice.

### Facts

All four Fact entries must include the parser-required `Summary`, `Details`, and `Category` fields. Use the local category `chapter_1`; this is not a generalized taxonomy.

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
merge_time_is_not_event_time
two_independent_lock_contradictions_identified
```

### Objective

```text
prepare_narrow_lock_request  # secondary
```

### Authorization

```text
narrow_lock_export
Granting Authority: KAGAMI 證據摘要審查會主理
```

### Source groups

Both source groups include a required Summary.

```text
door_lock_fixed_record
victim_phone_device
```

Do not add Chapter 2 definitions, generic authority types, or speculative categories.

## 6. Real Case File source model

### 6.1 Small-lie / third-party inputs

Beat 8.5 consumes existing production records rather than copying synthetic fixture IDs:

```text
closing_routine
cake_box
miyake_mother_call_log
miyake_pov_replay
external_maintenance_credential
local_sequence_record
victim_phone_notification
```

These records already belong to earlier Chapter 1 scenes. Analysis defines no new evidence manifest.

### 6.2 Event-1841..1844 are reasoning units, not Case File rows

Scene 8 currently models the four local events inside one formally fixed record:

```text
evidence:local_sequence_record
```

The Order board therefore uses four distinct Analysis cards:

```text
event_1841
event_1842
event_1843
event_1844
```

and all four cards point to the same Case File source. Card label/summary carries the row meaning shown to the player. Do not split the real record into four artificial evidence items.

### 6.3 Truthful source independence

Threshold independence comes from real provenance:

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

Therefore selecting the two door-lock records fails the `Minimum Distinct Source Groups: 2` rule naturally, while one door-lock record plus the phone record can satisfy the required time/order proof set.

The first-version Threshold does **not** add procedural-status restrictions merely because the compiler supports them.

## 7. Production Beat 8.5 boards

### Board 1 — `evidence_packages` / Classify

Purpose: separate what the currently acquired records actually prove.

Groups:

```text
miyake_small_lies
  closing_routine
  cake_box
  miyake_mother_call

earlier_third_party
  miyake_pov_replay
  external_maintenance_credential

lock_chronology_gap
  local_sequence_record
  victim_phone_notification
```

Outputs:

```text
assert_fact:miyake_known_lies_are_unrelated_to_murder
assert_fact:earlier_external_entry_exists
```

### Board 2 — `local_event_sequence` / Order

Purpose: make the player distinguish local device order from the summary's merged timestamp interpretation.

```text
event_1841 -> event_1842 -> event_1843 -> event_1844
```

`event_1841` remains the fixed first anchor. All four cards source `evidence:local_sequence_record`.

Output:

```text
assert_fact:merge_time_is_not_event_time
```

### Board 3 — `narrow_request_basis` / Threshold

Eligible cards:

```text
lock_sequence       -> evidence:local_sequence_record
external_credential -> evidence:external_maintenance_credential
phone_notification  -> evidence:victim_phone_notification
```

Rules:

```text
Minimum Selected: 2
Minimum Distinct Source Groups: 2
Required Proof Capabilities: [time, order]
Allowed Procedural Statuses: []
Require Source Group: true
```

Output:

```text
assert_fact:two_independent_lock_contradictions_identified
complete_objective:prepare_narrow_lock_request
```

One explicit same-source Incorrect Selection is enough for v1:

```text
[lock_sequence, external_credential]
```

No progressive hint system is pre-built.

## 8. Request versus authorization boundary

Analysis may establish facts and complete `prepare_narrow_lock_request`; it may not grant `narrow_lock_export`. The existing `analysisBoardGrantAuthorizationForbidden` rule stays unchanged.

The authorization is granted only in the existing final KAGAMI hearing.

## 9. Represented-authority carrier

### 9.1 Authoring contract

One optional phase metadata field:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

It is immutable definition context. It does not grant anything by itself.

Question and testimony-line story reveals inherit their owning phase's represented authority. There is no line-level copy of the field.

Legacy phases omit the JSON member entirely rather than emitting `representedAuthority: null`.

### 9.2 Compiler contract

The field flows through:

```text
ASTInquiryPhase
  -> JSONInterrogationPhase
  -> buildStoryRevealTargetBatches
  -> validateStoryRevealTargets
  -> ReachabilityNode.representedAuthority
```

For interrogation scenes:

```text
phase reveals            -> phase authority
question reveals         -> phase authority
testimony-line reveals   -> phase authority
```

Investigation and Analysis remain authority `null`.

The existing HPA-257 validation remains authoritative:

```text
no represented authority -> authorizationGrantOutsideAuthorityEvent
wrong authority           -> authorizationGrantAuthorityMismatch
matching authority        -> valid grant producer
```

Whole-corpus reachability uses the same phase authority when deciding whether an authorization producer can publish the `authorization_granted:<id>` atom.

### 9.3 Runtime contract

Rust adds the optional field to `InterrogationPhaseJson::Inquiry` only. It is not mutable state and is not persisted separately.

Every `StoryRevealMaterializationContext` whose origin is one of:

```text
InterrogationPhase
InquiryQuestion
TestimonyLine
```

must inherit the owning phase authority. Implementation must grep all such call sites rather than relying on a hard-coded count: there are distinct question-reveal paths for auto-break and correct-contradiction flows.

Investigation and Analysis contexts remain `None`.

`reveals.rs::apply_story_reveal()` continues to own the authority equality check and `StoryState` continues to own the durable grant.

## 10. Hearing handoff and repetition policy

The existing `q_request_clip` / `gate_hold_record` phase remains the first production authority event.

It becomes:

```text
Represented Authority: KAGAMI 證據摘要審查會主理
Unlock: phase:p3 completed and objective:prepare_narrow_lock_request completed
On Correct Reveals:
  grant_authorization:narrow_lock_export
  evidence:approved_clip
```

### p1–p3 decision: formal confirmation, not reteaching

This is decided now rather than deferred to playtest.

The existing phase order and evidence contradictions remain because they are part of the stable hearing proof order, but p1–p3 copy is shortened so the hearing **formalizes** conclusions already organized in Beat 8.5 instead of teaching the same reasoning again.

- **p1:** formally accepts that Miyake's small lies have independent explanations; it does not re-explain every small-lie card.
- **p2:** formally accepts the earlier time conflict using the existing phone/time evidence; it does not reconstruct the Classify board.
- **p3:** formally accepts the earlier third-party/sightline contradiction; it does not walk the player through the whole package grouping again.

The hearing Intro explicitly says the workbench conclusions are already prepared and the hearing is deciding what can be accepted into the review record.

`p4` is also trimmed so it uses the newly approved clip to formalize the merge-time interpretation rather than replaying the Order board tutorial.

Do not remove or reorder the later culprit-proof phases.

A scene-level `objective:prepare_narrow_lock_request completed` lock is unnecessary because the real manifest already places Beat 8.5 earlier in the Chapter 1 path; the **grant phase itself** carries the semantic objective gate.

## 11. Persistence and acceptance ownership

### Rust acceptance

The existing fixture integration test already proves partial Classify restore, result-dialogue restore, wrong/correct Threshold behavior, read-only solved boards, no answer leakage, and exactly-once story effects.

HPA-265 adds only the two missing exact incomplete draft proofs:

```text
Order: [event_1841, event_1843]
Threshold: [lock_sequence]
```

Do not add another producer-side public-wire assertion: existing Rust/frontend contract coverage already pins the three board variants and answer-key redaction.

### Packaged acceptance

Do **not** turn `production-journey.e2e.ts` into a title-to-hearing chapter runner. It currently proves P1 tutorial -> first KAGAMI investigation acquisition and should keep that job.

Add one E2E-only checkpoint/seed for **Beat 8.5 ready** using production resources. It should:

1. create a production `GameEngine` under the existing `e2e` feature;
2. seed the exact pre-Beat-8.5 evidence records through the existing `AcquisitionCtx` definition path, then discard presentation-only pending acquisition events for the seed;
3. include the existing hearing-gate contradiction record needed later in the packaged smoke;
4. `jump_to_scene("chapter_1", "analysis_scene_8_5")`;
5. return an Analysis-mode checkpoint projection.

This is test-only state setup, not a production progression API.

The packaged proof then covers one representative path:

```text
load Beat 8.5-ready checkpoint
  -> solve Classify
  -> solve Order
  -> leave one-card Threshold draft
  -> Save -> Title -> Continue once
  -> verify exact Threshold draft
  -> solve Threshold
  -> jump to production interrogation_scene_10 retaining inventory/story state
  -> complete concise p1–p3 confirmations
  -> pass the gate
  -> verify narrow_lock_export + approved_clip
```

Same-source failure stays in focused compiler/Rust/Svelte tests. The result-dialogue resume matrix stays in Rust. Do not add three packaged restore cycles or a chapter-long replay harness.

Register this as one focused packaged suite/spec (`analysis-beat85`) rather than changing the existing `production-journey` suite. It may run explicitly for HPA-265 acceptance and in the repository's full E2E selection; do not automatically lengthen the ordinary gameplay chain unless the suite-registry contract requires every suite to belong to a chain.

## 12. Human acceptance gate

The final subjective playtest is a **human gate**, not an agent implementation step.

After automated verification is green, hand the production build to the user and ask them to play Beat 8.5 -> hearing while checking:

```text
clarity of each board question
detective feel
pacing
whether p1–p4 feel like confirmation rather than repetition
same-source feedback comprehension
Save/Continue confidence
keyboard usability
whether save thumbnails materially help identification
```

If no concrete misunderstanding appears, richer hints are explicitly not needed for the first version. If one appears, make one focused content iteration using the existing Prompt / Hint / Incorrect Selection / Card / Group wording surfaces before considering any new runtime feedback semantics.

No empty "playtest completed" commit is created.

## 13. Verification floor

Automated:

```text
bun run scenes:compile
bun run test:scripts
focused Analysis frontend tests
focused + full Rust tests
bun run check
normal repository lint/test policy
one packaged Beat 8.5 checkpoint -> Save/Continue -> hearing grant smoke
```

Human:

```text
one Chapter 1 Beat 8.5 -> hearing playtest
```

Do not add exhaustive E2E permutations for every board state, wrong selection, keyboard path, or dialogue resume point.

## 14. Non-goals

- No Chapter 2 implementation or canon decisions.
- No generic AuthorityEvent scene family.
- No authorization workflow engine or grant ledger.
- No new save field for represented authority.
- No four Event evidence records.
- No second Analysis framework or frontend store.
- No generalized progressive-hint system.
- No exhaustive production-hardening matrix.
- No save-thumbnail redesign.
- HPA-603/HPA-601 remain separate latent follow-ups unless real packaged play demonstrates they block this slice.

## 15. Stop conditions

Stop and re-review rather than widening scope if:

1. the production boards require changing the Chapter 1 culprit or final proof order;
2. shared Analysis card sources reveal a deeper compiler/runtime invariant that cannot be fixed narrowly;
3. represented authority needs mutable runtime state instead of immutable phase definition data;
4. authorization cannot remain atomic through the existing reveal transaction;
5. the existing hearing gate cannot carry the grant without removing or duplicating a major proof beat;
6. the Beat 8.5 E2E checkpoint cannot seed production records through existing test-only engine seams without creating a new production API;
7. HPA-603/HPA-601 becomes a demonstrated blocker on the real slice.
