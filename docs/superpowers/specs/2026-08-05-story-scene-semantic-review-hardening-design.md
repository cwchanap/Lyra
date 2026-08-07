# HPA-561 Durable Scene Asset Contracts and Semantic Review Hardening Design

## Status

Approved consolidated design, revised after reuse review against the post-HPA-259 codebase.

HPA-561 is one feature with one design and one implementation plan. The revised design deliberately reuses the existing character catalog, asset compiler, audit-script pattern, and seven-axis scene-review skill instead of introducing parallel registries or review formats.

## Goal

Improve Chapter 1 authored-scene reliability and presentation quality by:

1. closing the silent unknown-speaker portrait fallback through the existing global character catalog;
2. hardening narration, expression, portrait, and background-variety authoring/review rules;
3. applying those rules to the production Chapter 1 manifest through a mechanically assisted background audit and the existing seven-axis semantic review;
4. fixing every material finding without turning the work into a broad Chapter 1 rewrite.

## Post-HPA-259 baseline

HPA-259 is merged. The repository already supports four compiler-driven scene types:

- linear;
- investigation;
- interrogation;
- analysis.

Analysis scenes already have:

- `ASTAnalysisScene` with Intro, board Result Dialogue, and Outro dialogue;
- a separate required-Summary parser contract;
- `enrichAnalysisScene()` using the common dialogue asset-enrichment path;
- immutable analysis JSON/Rust catalog wire and analysis dialogue origins.

HPA-561 extends those seams. It does not add another analysis traversal and does not change HPA-259 board semantics.

## Reuse decision: one character registry

The existing asset catalog already models both portrait-bearing and portraitless speakers:

```ts
portraitMode: "portrait" | "none"
```

For `portraitMode: "none"`, the current compiler already:

- emits `portrait: null`;
- rejects authored expressions through `assetExpressionOnNoPortraitSpeaker`;
- does not require `expressions.standard`;
- rejects duplicate `displayNames` globally.

Therefore HPA-561 will **not** add `Local Speakers`, `ASTLocalSpeaker`, scene-header metadata, or a second speaker registry.

The actual compiler defect is the existing fallback that allows an unknown speaker with no expression to silently compile as `portrait: null`.

### Revised deterministic contract

When assets are enabled, every dialogue speaker must resolve through `characters.yaml`.

```text
known catalog speaker
  -> portraitMode: portrait -> existing portrait/expression enrichment
  -> portraitMode: none     -> portrait: null, expression forbidden

unknown speaker
  -> assetUnknownSpeaker
```

No speaker is exempt merely because an expression was omitted.

When assets are disabled, preserve the existing semantic-only workflow; catalog membership remains an asset-enrichment concern.

## Current Chapter 1 migration decisions

The current production manifest must still be frozen at implementation time, but the present review identifies seven scene speaker labels absent from `characters.yaml`. `旁白` is also absent from the catalog today and works only because of the same silent fallback.

If the manifest is unchanged, the strict gate therefore requires eight display-name contracts or deliberate authored-label corrections.

| Display name | Catalog treatment | Design decision |
|---|---|---|
| `旁白` | `portraitMode: none` | System narrator; one global no-portrait contract, no compiler special case. |
| `上班族` | `portraitMode: none` | Anonymous one-shot commuter. |
| `路人甲` | `portraitMode: none` | Anonymous one-shot passerby. |
| `路人乙` | `portraitMode: none` | Anonymous one-shot passerby. |
| `路人丙` | `portraitMode: none` | Anonymous one-shot passerby. |
| `學生` | `portraitMode: none` | Brief one-shot participant in Scene P1; no portrait asset required. |
| `店主` | `portraitMode: portrait` | Primary opposing speaker throughout the Scene P1 mini-case; visually important enough for a real portrait contract. She is **not** `店長高瀨`. |
| `增田圭` | `portraitMode: portrait` | Visible, case-significant recurring Chapter 1 character; real portrait contract required. |

### `店主` visual scope

Keep this deliberately small:

- one stable character identity;
- `standard` expression;
- one additional pressure/exposure expression such as `flustered`;
- no large expression pack.

This gives the long Scene P1 exchange a meaningful visual transition without creating unnecessary asset work.

### `學生` and anonymous labels

`portraitMode: none` is intentional. These entries exist to make speaker identity explicit and compiler-checked, not to create visual assets.

If a later scene turns one of these generic labels into a reusable visible character, promote/rename it deliberately rather than adding scene-local metadata.

## Semantic authoring rules

### Speaker/portrait decision

The writing/review skills should teach one catalog, not catalog-vs-local selection:

- reusable or visually important speaker -> catalog with `portraitMode: portrait`;
- intentional faceless/system/very minor speaker -> catalog with `portraitMode: none`;
- unresolved speaker identity -> stop and resolve the catalog/label decision;
- never rely on an unknown-speaker fallback.

Global display-name uniqueness is a useful constraint: it makes label drift visible rather than allowing two scenes to independently invent the same ambiguous label.

### Narration ownership

| Meaning | Authored form |
|---|---|
| Visible movement, body language, atmosphere, room/object state | `[ ... ]` |
| Present-character conclusion, judgment, interpretation, reaction | character dialogue |
| Time/location transition, unavailable information, intentional voiceover | `**旁白**：...` |

The contradictory warehouse example in the base dialogue skill must be corrected.

### Expression choreography

- bracketed emotion does not change portrait state;
- use only expression slugs that exist in `characters.yaml`;
- use a suitable existing non-standard slug at a meaningful state transition;
- do not switch portraits line-by-line;
- standard-only catalogs and calm scenes are valid;
- adding a new expression asset requires a concrete visible need, not a quota.

## Review-skill changes

Do not create a parallel semantic-audit vocabulary or findings format.

`reviewing-story-scenes` remains the single semantic review authority and keeps its existing:

- seven independent axes;
- Blocker / Important finding severity;
- `BLOCKERS-PRESENT` / `FIX-RECOMMENDED` / `SHIP` verdicts;
- source-cited one-line findings;
- consolidated Phase 4 report.

### Axis 3 — Voice, style, narration & expression

Extend the existing Voice & Style axis to include:

- narration ownership;
- bracket/dialogue/portrait-expression coherence;
- meaningful transitions left flat despite an available configured slug;
- excessive expression flicker;
- false-positive protection for calm or standard-only characters.

Apply to all four scene types. For analysis scenes, inspect Intro, every Result Dialogue, and Outro.

### Axis 5 — Visual asset coverage & purposeful variety

Keep the existing completeness checks, then add:

1. portrait/catalog appropriateness;
2. compiled portrait/expression correctness;
3. background spatial usability and continuity;
4. purposeful variation;
5. same-view false-positive protection.

A repeated background is not a finding merely because it remains on screen. Flag it only when a different viewpoint/state would materially improve comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, reasoning state, or a meaningful environmental change.

## Background-variety design

### Variety must have a job

A new or regenerated background is justified only for a concrete function:

- orientation;
- investigation readability;
- evidence focus;
- pressure/reveal emphasis;
- reasoning/procedural state;
- meaningful time/weather/lighting/occupancy/aftermath state.

No image-count quota.

### Continuity anchors

Same-location variants preserve:

- entrances/exits;
- window positions;
- fixed furniture;
- room geometry and corridor direction;
- case-significant props;
- signature palette/materials;
- believable adjacency between sub-locations.

Camera angle, distance, focal emphasis, foreground crop, lighting, weather, and occupancy may change when the narrative function changes.

### Priority policy

Each reviewed cue receives one decision:

- `keep`;
- `prompt-adjust`;
- `regenerate`;
- `add-variant`.

And one priority:

- **Priority A** — affects comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, meaningful state change, or canon/continuity;
- **Priority B** — serviceable cosmetic polish.

Implement Priority A only. Priority B remains documented.

## Mechanical background-audit support

Do not manually transcribe compiler-owned data into a large table.

Add one small audit script modeled on `evidence-sources-audit.ts`:

```text
packages/scripts/compile-scenes/background-cues-audit.ts
packages/scripts/compile-scenes/background-cues-audit.test.ts
bun run background-cues:audit
```

The script reads the production Chapter 1 manifest plus compiled scene/asset outputs and emits deterministic mechanical rows for every player-visible background cue:

```ts
type BackgroundCueAuditItem = {
  cueKey: string;
  sceneFile: string;
  sceneType: "linear" | "investigation" | "interrogation" | "analysis";
  cuePath: string;
  backgroundAssetId: string | null;
  expectedPath: string | null;
  fileMissing: boolean;
};
```

It also emits structured `problems[]` instead of silently skipping malformed/missing inputs.

The script does **not** infer the physical location family or artistic quality. Those remain human/agent review judgments.

### Human report

Create:

```text
docs/stories_plan/chapter_1/background-variety-audit.md
```

Use the generated `cueKey` as the stable first column, then add only judgment fields:

```markdown
| Cue key | Location family | Current function | Continuity anchors | Variety finding | Decision | Priority | Proposed function | Disposition |
```

The audit command should support a check mode that verifies every current mechanical `cueKey` appears exactly once in the report. Coverage becomes mechanically checkable while judgment remains semantic.

If HPA-265 has inserted a production `analysis_scene_*.md`, it is included automatically. Synthetic HPA-259 fixtures are excluded.

## Existing-content semantic re-audit

Do not invent a second findings ledger or severity vocabulary.

At audit start:

1. freeze the exact current `docs/stories_plan/chapter_1/chapter.md` manifest;
2. invoke the hardened `reviewing-story-scenes` skill over that frozen corpus;
3. save its consolidated report to:

```text
docs/stories_plan/chapter_1/semantic-content-reaudit.md
```

The initial report is read-only and uses the skill's existing output format.

After fixes, append a short resolution section mapping each original Blocker/Important finding to its disposition/evidence, then rerun the full seven-axis review and append the final consolidated report.

Completion requires the final review verdict to be `SHIP` with no remaining Blocker or Important findings. Minor/deferred observations may remain documented.

This keeps one review authority and avoids hand-entered counters claiming a state the review did not produce.

## Skill verification strategy

Use prompt-eval pressure tests, but only where they pay for themselves.

### Baseline RED scenarios

Run three baseline scenarios before editing skills:

1. narration fallback;
2. reusable/visible speaker missing a catalog contract;
3. bracket-only emotional transition with an available non-standard expression.

### Post-change verification

Rerun those three as GREEN, then run:

4. calm/standard scene false-positive control;
5. catalog-label drift spot check;
6. analysis-scene inheritance spot check.

The last two are GREEN-only spot checks; they do not need fabricated baseline failures.

## Delivery shape

HPA-561 remains one Linear ticket and one spec/plan, but implementation should be reviewable as **two PRs**.

### Implementation PR A — contract and tooling

Contains:

- skill/review/orchestrator hardening;
- strict global speaker-catalog enforcement;
- current Chapter 1 `characters.yaml` migration needed to keep compilation green;
- focused portrait assets required by the explicit `店主` / `增田圭` decisions;
- background-cue audit script and tests.

No broad scene prose/background rewrite.

### Implementation PR B — Chapter 1 acceptance

After PR A lands:

- freeze production Chapter 1 manifest;
- run background audit and fill judgment columns;
- implement Priority A prompt/background changes;
- invoke seven-axis semantic re-audit;
- fix recorded Blocker/Important findings;
- rerun review to `SHIP`;
- retain Priority B / Minor observations as documented follow-up.

This keeps compiler/tooling review separate from art/content review without creating more architecture or tickets.

## Verification

Primary proof:

- unknown speaker without expression now fails;
- `portraitMode: none` speakers compile portraitless and reject expressions;
- analysis Intro/Result/Outro use the same strict catalog rule through existing enrichment;
- three RED -> GREEN skill scenarios plus three post-change controls/spot checks;
- mechanical background cue inventory and coverage check;
- grouped before/after location-family review for Priority A backgrounds;
- final seven-axis semantic review verdict `SHIP`.

Final regression commands for code/tooling changes:

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
bun run lint
```

Rust/app tests remain unnecessary unless implementation unexpectedly changes runtime-facing code.

## Non-goals

- no `Local Speakers` metadata or second speaker registry;
- no scene-header/AST changes for speaker classification;
- no semantic alias/narration/emotion/image-similarity classifier;
- no automatic expression choice;
- no arbitrary expression/background-count thresholds;
- no new review severity vocabulary or parallel semantic ledger;
- no generic location registry;
- no eighth review axis;
- no HPA-260 runtime work;
- no HPA-552 analysis-skill duplication;
- no synthetic analysis-scene background work;
- no wholesale Chapter 1 rewrite/background regeneration;
- no Chapter 2 audit.

## Acceptance criteria

- Unknown dialogue speakers fail asset-enabled compilation even without an expression.
- The strict gate is implemented by deleting the silent fallback, not by adding new parser/AST metadata.
- Every intentional portraitless speaker is represented through existing `portraitMode: none`.
- `旁白` is cataloged as a no-portrait system speaker rather than compiler-special-cased.
- `店主` receives a real portrait contract and remains distinct from `店長高瀨`.
- `學生` remains explicit but portraitless.
- `增田圭` receives a real portrait contract.
- Skills are hardened before production speaker/content migration consumes them.
- Axis 3/5 changes apply to all four scene types and reuse `reviewing-story-scenes` as the semantic authority.
- Baseline skill verification is limited to three genuine RED scenarios; prospective checks are GREEN-only.
- Background mechanical data is generated by a script; artistic decisions remain human/agent reviewed.
- Background audit coverage is mechanically checkable against the current manifest.
- Priority A background findings are implemented; Priority B remains documented.
- The semantic re-audit is the consolidated output of `reviewing-story-scenes`, not a parallel review format.
- Final semantic review is `SHIP` with no Blocker/Important findings.
- Implementation is delivered as separate contract/tooling and content/asset PRs under HPA-561.
