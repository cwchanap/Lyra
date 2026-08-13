# HPA-265 Chapter 1 Beat 8.5 Vertical Slice Design

## Status

Ready for implementation planning. This design supersedes the separate delivery sequencing previously tracked as HPA-262, HPA-263, HPA-264, HPA-265, and HPA-266. HPA-265 is now the single product-delivery and first-version acceptance owner.

## 1. Outcome

Deliver one real Chapter 1 product slice:

```text
real Chapter 1 evidence
  -> Beat 8.5 Classify / Order / Threshold
  -> durable facts + prepare_narrow_lock_request
  -> existing final hearing
  -> represented KAGAMI authority grants narrow_lock_export
  -> existing approved_clip evidence becomes available
  -> Chapter 1 continues through its existing proof order
  -> save/resume + packaged happy path + playtest acceptance
```

The implementation should feel like finishing one gameplay sequence, not integrating five subsystems. Compiler, Rust Analysis runtime, Svelte workbench, global story state, Case File, and save/load already exist and remain their current owners.

## 2. Why the former tickets should be one task

The old chain was effectively:

```text
HPA-262 platform acceptance
   -> HPA-264 request/hearing handoff
      -> HPA-265 production authoring/iteration
         -> HPA-266 first-version acceptance

HPA-263 optional post-playtest hints
```

That sequencing introduced planning/PR handoffs between steps that cannot be meaningfully accepted in isolation anymore:

- HPA-262 is now mostly acceptance coverage over already-shipped HPA-259/260/261.
- HPA-264 has exactly one real production consumer: the Chapter 1 hearing gate.
- HPA-265 needs the authority handoff to be a playable product slice.
- HPA-266 can only validate the production scene authored by HPA-265.
- HPA-263 is intentionally conditional on the same playtest.

Keeping them separate would optimize ticket boundaries rather than product iteration speed.

## 3. Reuse survey

### Already shipped — keep as-is

- **HPA-259:** Analysis Markdown parser, compiler normalization, Classify/Order/Threshold validation, hidden accepted solutions, threshold materialization, analysis definition registry.
- **HPA-260:** Rust Analysis state, typed drafts, action-token fencing, direct answer checking, story effects, read-only solved boards, exact current-format persistence.
- **HPA-261:** Svelte Analysis workbench and board components, pointer/keyboard controls, unavailable/read-only handling, provenance display.
- **HPA-255:** global Fact / Question / Objective / Authorization definitions and durable mutation semantics.
- **HPA-257:** positive story predicates, reveal dispatch, transaction semantics, fixed-point reachability, authorization validation.
- **HPA-258 / HPA-129:** Case File, objective/authorization views, save/load, Continue.
- Existing `interrogation_scene_10.md` already contains the narrative moment where 神谷澪 authorizes the limited door-lock excerpt.

### Small missing seams

Only two platform-level gaps are expected:

1. close two remaining Analysis acceptance proofs: incomplete Order and incomplete Threshold exact restore, plus one compact Rust public-wire assertion;
2. carry an optional represented-authority identity on an interrogation phase so the existing HPA-257 authorization dispatcher can legally process a Chapter 1 hearing grant.

Everything else should be content, tests, or playtest iteration.

## 4. Canonical production source ownership

Production Chapter 1 remains under:

```text
docs/stories_plan/
  story_catalog.md                 # new global production story catalog
  chapter_1/
    chapter.md
    ... existing scenes ...
    analysis_scene_8_5.md          # new production Analysis scene
    interrogation_scene_10.md      # existing hearing, minimally extended
```

`docs/stories_plan/chapter_1/scene_8_5.md` is the old linear Beat 8.5 implementation. Its useful character/pacing dialogue should move into the Analysis Intro/Outro, then the stale file should be deleted rather than kept as an unreferenced second version.

There must be one playable Beat 8.5 source.

## 5. Production story catalog

Production currently has no authored `docs/stories_plan/story_catalog.md`. HPA-265 should create the smallest catalog needed by the Chapter 1 vertical slice.

### Facts

```text
miyake_known_lies_are_unrelated_to_murder
earlier_external_entry_exists
merge_time_is_not_event_time
two_independent_lock_contradictions_identified
```

Use short Chapter-1-specific summary/details. Do not introduce generalized later-chapter categories.

### Objective

```text
prepare_narrow_lock_request
Kind: secondary
```

Beat 8.5 completes this objective after the Threshold board succeeds.

### Authorization

```text
narrow_lock_export
Granting Authority: KAGAMI 證據摘要審查會主理
```

The authorization represents permission to inspect the already-authored `evidence:approved_clip` narrow excerpt. It is not a new evidence type or request object.

### Source groups

Only source groups needed by the real Threshold board are required initially:

```text
door_lock_fixed_record
victim_phone_device
```

The two door-lock records below deliberately share `door_lock_fixed_record` because they come from the same formally fixed panel/document bundle. The phone notification uses `victim_phone_device`.

Do not create source groups for every Chapter 1 record merely because the schema supports them.

## 6. Real Chapter 1 record mapping

The synthetic Analysis fixture is a platform test corpus, not production data. Production boards must reference records the player actually acquired earlier in Chapter 1.

### Reused records

| Reasoning role | Production source |
| --- | --- |
| Miyake closing-routine inconsistency | `evidence:closing_routine` |
| Miyake's cake-box concealment | `evidence:cake_box` |
| Miyake's claimed private call | `evidence:miyake_mother_call_log` |
| Miyake cannot see inner storage | `evidence:miyake_pov_replay` |
| Earlier external credential event | `evidence:external_maintenance_credential` |
| Door-lock local event sequence | `evidence:local_sequence_record` |
| Independent ~22:58 time anchor | `evidence:victim_phone_notification` |
| Limited approved excerpt | `evidence:approved_clip` — hearing output, never an Analysis input |

No fixture-only `miyake_call_record`, `event_1841` evidence records, or `lock_sequence` record should be copied into production.

### Minimal provenance additions

Only Threshold-eligible source records need new provenance fields in this slice.

#### `evidence:local_sequence_record`

```text
Source Kind: digital
Representation Layer: raw
Procedural Status: exhibit
Completeness: complete
Confidence: corroborated
Source Group: door_lock_fixed_record
Source Label: 後場門鎖程序固定紀錄
Proof Capabilities: [order]
```

#### `evidence:external_maintenance_credential`

```text
Source Kind: digital
Representation Layer: raw
Procedural Status: exhibit
Completeness: complete
Confidence: corroborated
Source Group: door_lock_fixed_record
Source Label: 後場門鎖程序固定紀錄
Proof Capabilities: [order, access]
```

It shares the source group with `local_sequence_record`; both came from the same fixed panel/document bundle. This is intentional and is the real same-source mistake the Threshold board should reject.

#### `evidence:victim_phone_notification`

```text
Source Kind: digital
Representation Layer: raw
Source Group: victim_phone_device
Source Label: 死者手機通知紀錄
Proof Capabilities: [time]
```

Do not invent a procedural status/confidence claim solely to satisfy the board. The Threshold board will leave `Allowed Procedural Statuses` empty, so neutral defaults remain valid where the story does not establish more.

## 7. Production Beat 8.5 board design

The three boards should reuse the already-shipped interaction grammar, but their content must fit the real Chapter 1 evidence.

### 7.1 Board 1 — Evidence packages / Classify

Purpose: force the player to stop treating every suspicious fact as one murder theory.

Suggested ID:

```text
evidence_packages
```

Groups:

```text
miyake_small_lies
  - closing_routine
  - cake_box
  - miyake_mother_call

earlier_third_party
  - miyake_pov_replay
  - external_maintenance_credential

lock_chronology_gap
  - local_sequence_record
  - victim_phone_notification
```

The Analysis card IDs may be concise board-level IDs while their `Source` fields point to the real evidence IDs above.

Successful board reveals:

```text
assert_fact:miyake_known_lies_are_unrelated_to_murder
assert_fact:earlier_external_entry_exists
```

The board does not resolve the culprit or grant access. Its output is only the two high-level conclusions already present in the existing Beat 8.5 dialogue.

### 7.2 Board 2 — Local event sequence / Order

Purpose: make the player actively reconstruct the one piece of data that the current linear scene explains in dialogue.

Suggested ID:

```text
local_event_sequence
```

Cards:

```text
event_1841
event_1842
event_1843
event_1844
```

**All four cards use:**

```text
Source: evidence:local_sequence_record
```

This is deliberate. The Case File contains one formally fixed local-sequence record with four event rows. Analysis cards are reasoning units, not additional inventory records. The compiler requires unique Analysis card IDs, not unique case-record sources.

Accepted order:

```text
[event_1841, event_1842, event_1843, event_1844]
```

Keep the existing fixture's useful first anchor if playability remains clear:

```text
Fixed Anchors: [event_1841@1]
```

Successful board reveals:

```text
assert_fact:merge_time_is_not_event_time
```

Interpret this fact narrowly: the local record establishes that device event order and the summary/merge timestamp are not interchangeable propositions. The later approved clip still contributes the exact authorized comparison; the Analysis scene must not steal the hearing's exact 89.7-second reveal.

### 7.3 Board 3 — Narrow-request basis / Threshold

Purpose: prove the player has enough **independent** support to ask the review authority for the limited excerpt.

Suggested ID:

```text
narrow_request_basis
```

Eligible cards:

```text
lock_sequence        -> evidence:local_sequence_record
external_credential  -> evidence:external_maintenance_credential
phone_notification   -> evidence:victim_phone_notification
```

Threshold rules:

```text
Minimum Selected: 2
Minimum Distinct Source Groups: 2
Required Proof Capabilities: [time, order]
Allowed Procedural Statuses: []
Require Source Group: true
```

Consequences of the real provenance model:

- `local_sequence_record + external_maintenance_credential` fails because both are `door_lock_fixed_record`.
- a door-lock order record plus `victim_phone_notification` can satisfy source independence and the time/order capability union.
- accepted sets remain compiler-materialized from truthful metadata rather than hard-coded in a new evaluator.

Add one authored `Incorrect Selection` for the same-source pair so the first-version player receives a concrete explanation. This is minimal deterministic feedback, not the old HPA-263 progressive-hint system.

Successful board reveals:

```text
assert_fact:two_independent_lock_contradictions_identified
complete_objective:prepare_narrow_lock_request
```

It does **not** grant `narrow_lock_export`.

## 8. Board sequencing

Use authored order and existing Analysis completion predicates:

```text
evidence_packages
  -> local_event_sequence
      Unlock: analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
  -> narrow_request_basis
      Unlock: analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed
```

Do not add a board graph abstraction.

## 9. Minimal represented-authority carrier

### Problem

HPA-257 already enforces the correct authorization rule at compiler and runtime boundaries:

```text
grant_authorization:<id>
```

is valid only when the reveal batch carries a non-null represented authority that exactly matches the catalog authorization's `Granting Authority`.

Current Investigation/Interrogation adapters always supply `null`; Analysis is intentionally forbidden from granting. Therefore the Chapter 1 hearing currently has no legal production producer for `narrow_lock_export`.

### Selected design

Add one optional metadata field to **Interrogation Phase**:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

Compiled wire field:

```json
{
  "representedAuthority": "KAGAMI 證據摘要審查會主理"
}
```

Only emit the field when authored. Existing interrogation JSON stays byte-shape-compatible instead of gaining `representedAuthority: null` everywhere.

### Why Phase owns it

A phase already owns:

- one subject;
- one institutional/narrative context;
- phase entry reveals;
- its questions and testimony-line correct reveals.

The hearing's gate phase is exactly one represented KAGAMI authority context. Adding authority separately to every line would duplicate data; adding a new `AuthorityEvent` scene/runtime family would be overengineering for one production use.

### Propagation rules

For an Interrogation phase with `Represented Authority`:

- phase-level story reveal batches use that authority;
- question-level reveal batches inherit it;
- testimony-line `On Correct -> Reveals` batches inherit it;
- Investigation remains `null`;
- Analysis remains `null` and continues rejecting authorization grants.

Compiler validation and Rust `apply_story_reveal()` remain the authoritative equality checks. The new field does not itself grant anything.

### No mutable state

Represented authority is immutable scene definition data. It does not belong in save progress and requires no new save-schema field.

## 10. Hearing integration

Keep the existing final hearing. Do not create a new hearing scene or request screen.

The existing authorization gate in `interrogation_scene_10.md` is the production grant point.

### Gate phase

Add:

```markdown
- **Represented Authority:** KAGAMI 證據摘要審查會主理
```

and strengthen the phase unlock to require both the local hearing progression and the Analysis objective:

```text
phase:p3 completed and objective:prepare_narrow_lock_request completed
```

This makes the workbench's procedural output meaningful: the hearing can argue its earlier phases, but the limited-export gate does not become available unless Beat 8.5 prepared the request.

### Correct grant line

The existing `gate_hold_record` correct breakthrough should reveal in one command:

```text
grant_authorization:narrow_lock_export
evidence:approved_clip
```

Prefer grant first, then evidence, matching the narrative: authority is granted, then the authorized excerpt is handed over. Existing command transaction rollback makes the combined mutation atomic.

Repeated correct presentation, hearing replay, save/load, or acquisition acknowledgement must not grant or acquire twice; existing one-shot question/line progress + StoryState/Inventory idempotence remain the owners of that guarantee.

### Following proof phase

Keep the existing `p4` proof beat, but trim wording only as needed so it does not reteach the full Order board. Its new role is:

```text
Beat 8.5: establish that local order != summary event time
Hearing gate: authority allows narrow excerpt
p4: use approved excerpt to show the exact authorized summary-vs-local mapping
```

This preserves the final proof order while avoiding duplicated tutorial explanation.

## 11. Platform acceptance closure

The existing Rust Chapter-1-shaped Analysis fixture remains useful for stable platform tests. Do not delete or rewrite it to mirror every production prose detail.

Add only the two missing save checkpoints and one producer-side wire assertion:

- partial Classify: already covered;
- partial Order: add exact detached restore;
- partial Threshold: add exact detached restore;
- public Rust JSON: assert the Classify/Order/Threshold union shape and absence of accepted-answer fields.

If these tests already pass with no runtime changes, that is a successful result. Do not manufacture production changes to make this phase look larger.

## 12. First-version save/resume and packaged acceptance

The production acceptance flow is one journey, not a matrix:

1. reach real `analysis_scene_8_5` with required evidence;
2. save/resume one representative incomplete state for each board kind;
3. make one representative wrong Threshold attempt, including the same-source pair;
4. solve all boards;
5. save/resume once during Analysis result/outro dialogue or immediate presentation state;
6. reach the final hearing;
7. prove the gate cannot grant until the objective is complete;
8. complete `gate_hold_record` and observe `narrow_lock_export` + `approved_clip` once;
9. continue through the existing hearing/proof order.

Reuse the current packaged Tauri production-journey harness/checkpoints. Do not add one E2E file per board or failure permutation.

## 13. Playtest and optional polish

After the real packaged flow is playable, run one internal playtest focused on:

- does each board ask an understandable question?
- is the transition from free investigation to structured reasoning paced well?
- does same-source independence make sense after one wrong attempt?
- does the hearing feel like it consumes prior reasoning rather than replaying it?
- does Save -> Title -> Continue identify and restore the Analysis state clearly?
- do current dynamic thumbnails materially improve save identification?

Make one content/UI iteration if the playtest identifies a concrete issue.

### Contextual feedback / progressive hints

The former HPA-263 scope is **conditional**:

- no new generic feedback engine;
- no pre-authored four-level hint taxonomy unless actual players need it;
- add a small authored `Incorrect Selection` or existing `Hint` only where the playtest demonstrates confusion;
- if no richer hint is needed, record that conclusion and finish HPA-265.

Optional polish must not prevent Chapter 1 first-version acceptance.

## 14. Expected production change surface

### Story/content

```text
docs/stories_plan/story_catalog.md                           # new
docs/stories_plan/chapter_1/chapter.md
docs/stories_plan/chapter_1/analysis_scene_8_5.md            # new
docs/stories_plan/chapter_1/scene_8_5.md                     # delete after migration
docs/stories_plan/chapter_1/investigation_scene_7.md         # phone provenance only
docs/stories_plan/chapter_1/investigation_scene_8.md         # door-lock provenance only
docs/stories_plan/chapter_1/interrogation_scene_10.md        # authority gate/handoff
```

### Minimal authority carrier

```text
packages/scripts/compile-scenes/types.ts
packages/scripts/compile-scenes/parser-interrogation.ts
packages/scripts/compile-scenes/emitter.ts
packages/scripts/compile-scenes/validator.ts
packages/scripts/compile-scenes/*focused tests*
apps/game/src-tauri/src/game/schema.rs
apps/game/src-tauri/src/game/mod.rs
apps/game/src-tauri/src/game/*focused tests/fixtures as required by Rust constructors*
.claude/skills/writing-interrogation-scene/SKILL.md
```

`reveals.rs` should normally require no production change: its existing `StoryRevealMaterializationContext` already validates represented authority. Tests there may be extended if useful.

### Acceptance

```text
apps/game/src-tauri/src/game/analysis_integration_tests.rs
existing frontend Analysis tests — verify/reuse, edit only if a real gap is found
existing packaged production-journey E2E — extend one happy path
```

## 15. Explicit non-goals

- no new Analysis board kind;
- no generic request/authority workflow engine;
- no new scene/runtime family for authority events;
- no frontend authority decision logic;
- no new Case File record for each Event-1841..1844 row;
- no Chapter 2 content or compare/route/chain template work;
- no production migration/backward-compatibility layer;
- no exhaustive save/fault/accessibility matrix;
- no editor work;
- no HPA-603/HPA-601 cleanup unless a fresh production failure proves they block this slice.

## 16. Stop conditions

Pause implementation and re-review the design only if one of these occurs:

1. the real Chapter 1 records cannot express the three boards without changing case canon;
2. multiple Analysis cards pointing to `local_sequence_record` reveals a concrete compiler/runtime/UI defect that cannot be fixed narrowly;
3. represented authority cannot safely inherit from a phase without creating ambiguity between subjects/authority contexts;
4. granting `narrow_lock_export` at the existing hearing gate conflicts with the current final proof order;
5. the packaged journey demonstrates HPA-603 or HPA-601 is an actual production blocker rather than a latent issue.

Do not widen the ticket preemptively for hypothetical later-chapter needs.
