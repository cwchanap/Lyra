---
name: writing-analysis-scene
description: Use when writing or extending an analysis_scene_<K>.md file under static/stories_plan/chapter_<N>/ or docs/stories_plan/chapter_<N>/ for compiler-validated Analysis boards (classify, order, or threshold) whose cards reference case records or practice items, each with Result Dialogue and story Reveals.
---

# Writing Analysis Scenes (《東京雨證：第零證人》)

## Role

You author compiler-validated **analysis scene** markdown: a detective
thought-organization beat where 相馬/早坂 arrange evidence on interactive
**boards**. An analysis scene has no hotspots, no subjects to question, and no
evidence/statement manifest of its own — it *consumes* case records defined in
earlier investigation/interrogation scenes (or self-contained **practice**
cards) and emits story progression through each board's `Reveals`.

**Chapter 1 contract:** Analysis supports the three board kinds documented by
this skill: `classify`, `order`, and `threshold`. Author kind-specific metadata
and validation rules from the sections below; the compiler and packaged runtime
consume the resulting board definitions.

## Required Background

Read `writing-detective-game-dialogue` first. Reuse its dialogue rules exactly:
Traditional Chinese player-facing text, `**角色名**：內容`, bracketed stage
directions, `[場景：...]` tags, global catalog/portrait/expression rules,
purposeful background prompts, and short (≤100 Chinese char) dialogue lines.
Those rules govern every dialogue carrier in this scene (Intro, Result Dialogue,
Outro).

## The model

- One **Intro** (linear dialogue, plays on scene load).
- One or more **Analysis Boards**, played in author order. A `classify` board
  assigns cards to authored groups, an `order` board arranges cards into an
  authored sequence, and a `threshold` board selects a subset that jointly
  satisfies authored provenance/proof requirements.
- One **Outro** (closing dialogue).
- Every board carries `Reveals` (story targets only) and a `### Result Dialogue`
  block that plays once the board is solved. Boards may chain via `Unlock`.

Cards never define evidence/statements — they only *reference* them by
`evidence:<id>` / `statement:<id>` (resolved against earlier scenes' case
records) or `practice:<id>` (a self-contained tutorial card).

## File Skeleton

```markdown
# Scene N: <title>

- **Summary:** <one-sentence player recap copy, not a beat list>

## Intro

[場景：地點、時間、氛圍、視覺要素]
- **Background Prompt:** <English production prompt, only when assets enabled>

**相馬律**：...

## Board: <label> {#board_id}

- **Kind:** classify | order | threshold
- **Prompt:** <what the player must do, player-facing>
- **Reveals:** [assert_fact:some_fact]
- **Incomplete Feedback:** <why the attempt is incomplete>
- **Incorrect Feedback:** <why the attempt is wrong>
- **Hint:** <optional hint>

### Card: <label> {#card_id}

- **Source:** evidence:<id>
- **Summary:** <player-facing one-line summary>

### Group: <label> {#group_id}      <!-- classify only -->

- **Description:** <what the group proves>
- **Accepted Cards:** [card_id, ...]

### Incorrect Selection                    <!-- threshold only, optional -->

- **Cards:** [card_id, ...]
- **Feedback:** <why this exact selection is wrong>

### Result Dialogue

**相馬律**：...

## Outro

**相馬律**：...
```

The skeleton's headings, levels, and metadata keys follow the canonical compiler
fixture `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
(using its threshold board) and
`docs/stories_plan/chapter_1/analysis_scene_p1_5.md` (practice-card threshold
with asset cues). Use those fixtures to resolve questions about structure.
`- **Summary:**` belongs directly after the H1 and is one sentence of
player-facing recap copy, not a beat list.

## Heading Hierarchy Reference

| Level | Block |
| --- | --- |
| H1 | `# Scene N: <title>` (N may be a decimal like `8.5` or `1.5`) |
| H2 | `## Intro`, `## Board:`, `## Outro` |
| H3 | `### Card:`, `### Group:` (classify only), `### Incorrect Selection` (threshold only), `### Result Dialogue` |

`## Intro`, `## Outro`, `### Incorrect Selection`, and
`### Result Dialogue` must **not** declare a `{#id}` anchor. `## Board:` and
`### Card:` must declare one. There is no `## Evidence Manifest`,
`## Statement Manifest`, `### Subject:`, `### Question:`, or hotspot/topic
block in an analysis scene — those belong to other scene families and the
parser rejects them as an unknown H2/H3. The complete board hierarchy is:

```text
## Intro
## Board: <label> {#board_id}
### Card: <label> {#card_id}
### Group: <label> {#group_id}      # classify only
### Incorrect Selection             # threshold only, optional
### Result Dialogue
## Outro
```

## Block Field Schemas

Field labels are English. Reserved metadata values are English (`classify`,
`order`, `threshold`, `true`, `false`). Player-facing field values and dialogue
are Traditional Chinese. IDs are English snake_case slugs anchored with `{#id}`.

### Header

- **H1:** `# Scene N: <title>`. The scene number `N` is a decimal integer or
  decimal pair (e.g. `8.5`, `1.5`). The full filename stem
  `analysis_scene_<K>` is the compiled scene id (for example,
  `analysis_scene_8_5.md` → `analysis_scene_8_5`); use that full id in
  cross-references. Title text after the colon is Traditional Chinese.
- **Required:** `- **Summary:** <non-empty>` immediately after the H1.

### Intro (H2)

- **Heading:** `## Intro` (no anchor). Exactly one, before every Board.
- **Body:** linear dialogue. Plays on scene load. May open with a `[場景：...]`
  tag; when assets are enabled, that tag is followed immediately by
  `Background Prompt` plus optional `Background Asset ID`, `BGM`, and `BGS`
  (see "Asset background cues").

### Board (H2)

- **Heading:** `## Board: <label> {#board_id}` — anchor required.
- **Required:** `Kind: classify | order | threshold`, `Prompt`,
  `Reveals`, `Incomplete Feedback`, `Incorrect Feedback`.
- **Optional:** `Unlock` (a story unlock expression), `Hint`.
- **Body:** one or more `### Card:` blocks, optional `### Group:` blocks for
  `classify`, optional `### Incorrect Selection` blocks for `threshold`, then
  exactly one `### Result Dialogue`.

Any board may chain off an earlier board's completion via
`Unlock: analysis_board:<chapter_id>@<scene_id>@<board_id> completed` (the
fully qualified slug segments are required). `Unlock` may be omitted, but the
runtime presents incomplete unlocked boards in authored order; every board must
be reachable.

### Card (H3)

- **Heading:** `### Card: <label> {#card_id}` — anchor required.
- **Required:** `Source`, `Summary`.
- **Source forms:** `evidence:<id>`, `statement:<id>`, or `practice:<id>`.
  - `evidence:<id>` / `statement:<id>` must resolve to a case record defined in
    an earlier investigation/interrogation scene. An unresolved reference fails
    with `analysisCardSourceUnresolved`.
  - `practice:<id>` is a self-contained tutorial card that does not resolve to a
    case record (see "Threshold provenance & practice cards").

### Incorrect Selection (H3 — threshold only)

- **Heading:** `### Incorrect Selection` (no anchor). Allowed only when
  `Kind: threshold`.
- **Required:** `Cards: [card_id, ...]`, `Feedback`.
- Each named card must be a displayed card of this board; a selection that
  matches an accepted card set fails with `analysisIncorrectSelectionAccepted`.
  Use these for instructive wrong-attempt feedback (see the practice fixture's
  two `### Incorrect Selection` blocks).

### Result Dialogue (H3)

- **Heading:** `### Result Dialogue` (no anchor). Exactly one per board,
  required. Non-empty (a board with empty result dialogue fails with
  `analysisBoardEmptyResultDialogue`).
- **Body:** direct dialogue parsed as dialogue items, played once the board is
  solved. It is a supported dialogue carrier: a `[場景：...]` tag plus asset
  metadata may author a material post-board visual transition here.

### Outro (H2)

- **Heading:** `## Outro` (no anchor). Exactly one, after every Board.
- **Body:** closing dialogue. May carry a `[場景：...]` tag (with asset metadata
  when assets are enabled) for an authored visual transition out of the scene.

## Classify board fields

`classify` boards make the player assign every displayed card to one authored
group. They use the common board fields plus one or more `### Group:` blocks.

- **Group heading:** `### Group: <label> {#group_id}` — anchor required.
- **Group metadata:** `Description` and `Accepted Cards` are required, and
  these are the only group metadata fields.
- `Accepted Cards: [card_id, ...]` names the displayed cards accepted by that
  group. Every displayed card must belong to exactly one accepted group; a card
  accepted by two groups or by none fails validation.
- Writers author the `Accepted Cards` lists. `acceptedGroupByCard` is the
  normalized compiler output, never a writer-authored field.

The canonical three-board fixture
`packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
contains a complete classify board with two groups.

## Order board fields

`order` boards make the player arrange every displayed card in an authored
sequence. They use the common board fields plus these required metadata keys:

- `Accepted Order: [card_id, ...]` must contain every displayed card exactly
  once. Unknown cards, duplicates, and omitted displayed cards fail validation.
- `Fixed Anchors` is required even when there are no anchors. Use `[]` to mean
  none. A non-empty list uses `<card_id>@<one-based-position>` for each entry.
- Anchors must use unique displayed cards and unique in-range positions, agree
  with `Accepted Order`, and occupy a contiguous prefix of positions `1..N`
  (where `N` is the number of anchors). A non-prefix list fails with
  `analysisOrderAnchorNotPrefix`; the existing invalid fixture is
  `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/`.

The canonical three-board fixture's `local_event_sequence` board demonstrates
`Accepted Order` with a one-based fixed anchor.

## Threshold board fields

Threshold requirements are source-owned: provenance, source groups, and proof
capabilities come from the originating case records, while the board authors
which requirements a selection must satisfy.

- **Required metadata:** `Eligible Cards`, `Minimum Selected`,
  `Minimum Distinct Source Groups`, `Required Proof Capabilities`,
  `Allowed Procedural Statuses`, `Require Source Group`.
- `Eligible Cards: [card_id, ...]` — the selectable pool. At least one, and at
  most six (the materialization budget, `MAX_THRESHOLD_ELIGIBLE_CARDS = 6`).
- `Minimum Selected: <int>` (≥0), `Minimum Distinct Source Groups: <int>` (≥0).
- `Required Proof Capabilities: [cap, ...]` — from the canonical set
  `time, order, route, identity, access, motive, source, credibility,
  procedure, causation`. An empty list `[]` is valid and means no capability is
  required.
- `Allowed Procedural Statuses: [status, ...]` — from
  `unspecified, lead, reacquired, exhibit`. An empty list `[]` is valid.
- `Require Source Group: true | false`.
- The compiler materializes every accepted subset; a threshold with **no**
  accepted selection fails with `analysisThresholdUnsatisfiable`.

## Threshold provenance & practice cards

A threshold board's requirements are checked against each eligible card's case
record provenance (the same provenance fields authored on the source scene's
evidence/statement manifest — see `writing-investigation-scene` /
`writing-interrogation-scene`).

Two practice-card rules:

- **Exact one-to-one manifest binding within a chapter:** every `practice:<id>`
  must appear on exactly one analysis card in exactly one analysis board, be
  revealed exactly once by the immediately preceding `investigation_scene_*.md`,
  and have this analysis scene directly follow that investigation in the
  chapter manifest. Conversely, every practice reveal in an investigation must
  target a card on the immediately following analysis scene. This uniqueness is
  chapter-scoped, not global across chapters; reuse in another chapter requires
  its own immediate investigation-to-analysis handoff. Duplicate
  analysis-card/board use within a chapter fails with
  `practiceCardSourceDuplicate`.

- **No mixing.** A threshold may not mix `practice:` cards with `evidence:` /
  `statement:` (Case File) cards in `Eligible Cards`
  (`analysisThresholdPracticeMixedSources`).
- **Practice thresholds stay neutral.** When every eligible card is a
  `practice:` card, the board must set `Minimum Distinct Source Groups: 0`,
  `Allowed Procedural Statuses: []`, `Require Source Group: false`, and
  `Required Proof Capabilities: []` (`analysisThresholdPracticeProvenanceForbidden`).
  The practice fixture `analysis_scene_p1_5.md` is the canonical example.

Tell the writer (or, when you are the writer, confirm) the exact practice-card
IDs and their immediately preceding investigation reveal locations before
choosing requirements.

## Orchestrator handoff

Before dispatching this skill, the orchestrator supplies the writer with:

- board, card, and (when applicable) group IDs;
- card source IDs and source-owner paths;
- the authored board order and unlock chain;
- intended story outputs and the request-vs-authorization boundary;
- source provenance expectations when a threshold uses them; and
- tutorial practice-card binding details when the scene uses practice cards.

The writer then uses this skill as the sole owner of board-kind metadata syntax
and validation rules. Provenance remains authored on the source records, not
duplicated on Analysis cards.

## Reveals syntax

Board `Reveals` accepts **story targets only**. Local investigation targets
(`evidence:`, `statement:`, `hotspot:`, etc.) are rejected with
`analysisBoardNonStoryReveal`. The supported story targets are:

```text
assert_fact:<fact_id>
reveal_question:<question_id>
resolve_question:<question_id>@<fact_id>
reveal_objective:<objective_id>
complete_objective:<secondary_objective_id>
set_primary_objective:<primary_objective_id>
set_primary_objective:<primary_objective_id>; complete_current
set_primary_objective:null
set_primary_objective:null; complete_current
grant_authorization:<authorization_id>   # forbidden here — see below
```

`grant_authorization` is rejected on analysis boards with
`analysisBoardGrantAuthorizationForbidden`; do not author it. Every typed ID
must resolve in `story_catalog.md`. See `writing-interrogation-scene`'s
"HPA-257 monotonic story progression" section for the shared ordered-transaction
and resolver rules — they apply unchanged to analysis `Reveals`.

When later narrative logic depends on a conclusion, prefer an authored
`assert_fact` or objective transition over a board-completion predicate as the
semantic state. Board-completion predicates remain available for sequencing,
but always use the fully qualified `analysis_scene:<chapter_id>@<scene_id>` or
`analysis_board:<chapter_id>@<scene_id>@<board_id>` form shown below.

Analysis can prepare a request but cannot grant authority: Beat 8.5 may reveal
or complete `prepare_narrow_lock_request`, but it must not grant
`narrow_lock_export`; the hearing's represented authority owns that grant.

Use the full compiled scene id in analysis predicates, including the
`analysis_scene_` prefix. For example:

```text
analysis_scene:chapter_1@analysis_scene_p1_5 completed
analysis_board:chapter_1@analysis_scene_p1_5@p1_reprint_time_board completed
```

## Asset background cues

Analysis backgrounds are authored on **dialogue carriers**: the Intro, each
board's Result Dialogue, and the Outro may carry `[場景：...]` plus supported
asset metadata. The board UI itself (Card/Incorrect Selection metadata) carries
no visual cue.

When `static/assets/config/policy.yaml` has `enabled: false`, author semantic
content only — no `Background Prompt` / `BGM` / `BGS` / asset metadata, and no
filesystem paths. When assets are enabled:

- The Intro scene tag is the primary place to establish the analysis backdrop;
  follow it immediately with `Background Prompt` and optional `Background Asset
  ID`, `BGM`, and `BGS` metadata. Each Result Dialogue and the Outro follow the
  same cue grammar when they author a visual transition.
- Repeating a `Background Prompt` does **not** inherit or reuse an asset. To
  reuse the same background, explicitly repeat its exact `Background Asset ID`
  while still repeating the scene tag and required `Background Prompt` cues.
- The requirement for both `BGM` and `BGS` applies to the first visual cue in the
  compiler-wide ordered corpus, not the first unit of each chapter; later cues
  may omit unchanged channels. A new background asset is justified only by a
  material environmental/dramatic change; do not manufacture a variant per
  board.

## Workflow

1. Read the chapter detail plan and confirm which case records (`evidence:` /
   `statement:` IDs from earlier scenes) this beat arranges, and which story
   facts/objectives each board should assert/complete.
2. List every board id and its unlock chain before writing dialogue. Decide the
   kind-specific fields for each board; for threshold boards, confirm each
   eligible card is Case File vs practice, define provenance requirements, and
   verify the exact practice-card reveal binding above.
3. Confirm every `evidence:` / `statement:` card source resolves to a guaranteed
   case record from a prior scene (the compiler rejects unresolved sources).
4. Write the scene in canonical order: `## Intro`, `## Board:` blocks (each with
   its Cards, kind-specific H3 blocks, and exactly one `### Result Dialogue`),
   then `## Outro`.
5. Self-check (below) before reporting done.

## Self-check

- Exactly one `## Intro` before the boards and exactly one `## Outro` after;
  one or more boards between them; each board has ≥1 card and one non-empty
  `### Result Dialogue`.
- Every board has `Kind`, `Prompt`, `Reveals`, `Incomplete Feedback`, and
  `Incorrect Feedback`; `Reveals` contains only story targets (no
  `evidence:`/`statement:`/`grant_authorization:`).
- classify: groups provide `Description` and `Accepted Cards`, and every
  displayed card appears in exactly one accepted group; do not author
  `acceptedGroupByCard`.
- order: `Accepted Order` contains every displayed card exactly once; required
  `Fixed Anchors` is `[]` or a unique, in-range, order-consistent contiguous
  prefix of one-based positions.
- threshold: ≤6 eligible cards; requirements match the Case File vs practice
  split; at least one accepted selection exists; every practice card is revealed
  exactly once by the immediately preceding investigation and the analysis scene
  directly follows it in the chapter manifest.
- Dialogue lines ≤100 Chinese characters, Traditional Chinese only, every
  speaker resolves to the global catalog; Intro, each Result Dialogue, and Outro
  use supported background cues when a visual transition is authored.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Adding `## Evidence Manifest` / `## Statement Manifest` | Analysis scenes consume case records, they don't define them. Reference `evidence:<id>` / `statement:<id>` in card `Source`. |
| `Reveals: [evidence:foo]` | Board Reveals are story targets only — fails `analysisBoardNonStoryReveal`. Use `assert_fact:` / `complete_objective:` etc. |
| `grant_authorization:` in a board Reveals | Forbidden on analysis boards — `analysisBoardGrantAuthorizationForbidden`. |
| Card `Source: evidence:missing_id` | Must resolve to a case record from an earlier scene — `analysisCardSourceUnresolved`. |
| Writing `acceptedGroupByCard` in a classify board | Author each group's `Accepted Cards`; `acceptedGroupByCard` is normalized compiler output. |
| Omitting a displayed card from `Accepted Order` | Include every displayed card exactly once. |
| Fixed anchors start after position 1 | Anchors must occupy the contiguous prefix `1..N`; fix the list or expect `analysisOrderAnchorNotPrefix`. |
| Threshold with no accepted selection | Loosen provenance requirements or fix eligible cards — `analysisThresholdUnsatisfiable`. |
| Mixing `practice:` and Case File cards in one threshold | Split them — `analysisThresholdPracticeMixedSources`. |
| Practice threshold with non-neutral requirements | Set `Minimum Distinct Source Groups: 0`, empty status/capability lists, `Require Source Group: false` — `analysisThresholdPracticeProvenanceForbidden`. |
| >6 eligible cards | Reduce the pool — `analysisThresholdEligibleCardBudgetExceeded`. |
| A `[場景：...]` tag on the board UI | Boards carry no scene tag. Intro, each Result Dialogue, and Outro are the supported dialogue carriers. |
| Repeating a prompt but omitting `Background Asset ID` | The compiler generates a new asset id when the id is omitted. Repeat the exact `Background Asset ID` plus the required tag/prompt to reuse an asset. |
| Anchor on `## Intro` / `## Outro` / `### Result Dialogue` | These must not declare an anchor — `analysisSceneIntroHasAnchor` / `analysisSceneOutroHasAnchor` / `analysisBoardResultDialogueHasAnchor`. |

---

**Related skills:** `writing-detective-game-dialogue` (base dialogue rules),
`writing-investigation-scene` / `writing-interrogation-scene` (the case-record
provenance fields threshold boards check against), `writing-chapter-manifest`,
`reviewing-story-scenes`.
