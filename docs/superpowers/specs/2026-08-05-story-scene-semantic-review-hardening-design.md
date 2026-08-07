# HPA-561 Durable Scene Asset Contracts and Semantic Review Hardening Design

## Status

Approved consolidated design for HPA-561 on the post-HPA-259 baseline.

HPA-561 is one feature with one implementation flow. The background-variety audit and the existing-content semantic re-audit are acceptance phases of the same work, not independent subsystems, so this document is the single design authority for the ticket.

## Goal

Improve Chapter 1 authored-scene reliability and presentation quality by:

1. replacing silent unknown-speaker portrait fallback with a durable scene-authored speaker contract;
2. hardening narration, expression, portrait, and background-variety authoring/review rules;
3. applying the new rules to the production Chapter 1 manifest and closing every Blocker/Important finding without turning the work into a broad rewrite.

## Post-HPA-259 baseline

HPA-259 is merged and is no longer a future dependency. The repository now has four compiler-driven scene types:

- linear;
- investigation;
- interrogation;
- analysis.

Analysis scenes already have:

- `ASTAnalysisScene` with `intro`, `boards[].resultDialogue`, and `outro` dialogue containers;
- `parser-analysis.ts` with a required-Summary analysis header contract;
- `parser-common.ts` shared parser helpers;
- `enrichAnalysisScene()` and ordered asset enrichment;
- immutable analysis JSON/Rust catalog wire and analysis dialogue origins.

HPA-561 extends these landed seams. It must not reintroduce a three-scene-type assumption, duplicate analysis traversal, or unify the full header architecture simply to add one metadata field.

Production Chapter 1 currently still uses `scene_8_5.md`. HPA-265 may later replace it with `analysis_scene_8_5.md`; HPA-561 must work correctly in either state.

## Observed quality gaps

Chapter 1 playtesting exposed three confirmed failures:

- scene-closing conclusions were authored as `旁白` even though they were character-owned interpretation or summary;
- speaking characters could silently become `portrait: null` without durable author intent;
- bracketed emotional beats did not change portraits while dialogue omitted appropriate available expression slugs.

Cataloged-label drift is a related prospective risk. It was not the cause of `店主` in `scene_p1.md`: the stationery-shop `店主` and Rain Bell `店長高瀨` are separate characters.

The background system also has a presentation-quality gap: existing rules primarily verify that a background prompt/asset exists, but do not explicitly review repeated near-identical composition where a materially different viewpoint or state would improve spatial clarity, investigation readability, pacing, or reveal emphasis.

## Architectural boundary

Adopt a hybrid structural/semantic boundary.

### Compiler owns deterministic speaker membership

With assets enabled, every dialogue speaker must be exactly one of:

1. a configured `characters.yaml` display name;
2. reserved `旁白`;
3. a speaker declared by that scene's `Local Speakers` metadata.

Anything else is `assetUnknownSpeaker`.

A declared local speaker is intentionally portraitless and may not author an expression slug.

### Skills/review own contextual meaning

The compiler does not decide whether:

- a local label is semantically an alias for a reusable/cataloged character;
- a one-shot character deserves a portrait;
- narration ownership is appropriate;
- an expression change is artistically justified;
- a background needs a different camera/composition variant.

Those remain writing/review responsibilities.

## Durable `Local Speakers` contract

### Authored syntax

Legacy scene types retain their existing optional-Summary behavior:

```markdown
# Scene P0: 雨中的東京
- **Summary:** 東京雨夜裡，KAGAMI 試點悄悄成為城市日常。
- **Local Speakers:** 上班族, 路人甲, 路人乙
```

When a legacy scene omits an authored Summary, `Local Speakers` appears immediately after H1.

Analysis scenes retain HPA-259's required Summary:

```markdown
# Scene 8.5: 短暫誤判整理點
- **Summary:** 相馬與早坂整理目前真正成立的命題。
- **Local Speakers:** 工作人員

## Intro
...
```

Rules:

- `Local Speakers` may appear once.
- It appears immediately after Summary when Summary exists.
- Entries are comma-separated, trimmed, non-empty, and unique.
- Leading/trailing empty members are invalid.
- `旁白` is reserved and cannot be declared local.
- Catalog overlap is invalid when assets are enabled: a registered display name must use its catalog contract instead of being redeclared local.
- The metadata is compiler-only and never appears in emitted runtime JSON.

## Parser architecture

Do not unify the complete legacy and analysis header parsers.

HPA-259 intentionally gave analysis scenes a separate required-Summary header parser, while linear/investigation/interrogation use `parseSceneHeader()` with optional Summary fallback.

Add one narrow helper in the landed `parser-common.ts` seam:

```ts
parseOptionalLocalSpeakers(tokens, sourceFile, startIndex)
```

It owns only:

- immediate `Local Speakers` recognition;
- comma-list syntax;
- empty/duplicate entry checks;
- reserved `旁白` rejection;
- duplicate/misplaced metadata diagnostics;
- returned source locations and next-token index.

Then:

```text
linear / investigation / interrogation
  parseSceneHeader()
    -> optional Summary
    -> parseOptionalLocalSpeakers(...)

analysis
  parseAnalysisHeader()
    -> required Summary
    -> parseOptionalLocalSpeakers(...)
```

Catalog overlap is not parser-owned because parser code does not have the asset catalog. It is validated during asset enrichment.

## AST and runtime boundary

Add one compile-time-only local-speaker field to all four AST scene types:

```ts
type ASTLocalSpeaker = Located<{ name: string }>;

localSpeakers: ASTLocalSpeaker[];
```

Apply it to:

- `ASTLinearScene`;
- `ASTInvestigationScene`;
- `ASTInterrogationScene`;
- `ASTAnalysisScene`.

Do not add it to emitted JSON types or Rust/Svelte schemas.

HPA-561 therefore introduces no additional runtime scene field beyond the HPA-259 baseline. This wording is deliberate: HPA-259 already added the analysis runtime/catalog wire; HPA-561 does not roll it back or claim the whole runtime schema is unchanged relative to the pre-HPA-259 branch.

## Asset-enrichment behavior

HPA-259 already added analysis asset traversal. Reuse it.

Existing analysis enrichment already visits:

- `intro`;
- every `boards[].resultDialogue`;
- `outro`.

Extend the common enrichment context with the scene's local-speaker set and make `enrichLine()` classify speakers consistently for all four scene types:

1. configured catalog speaker -> existing portrait/no-portrait logic;
2. reserved `旁白` -> `portrait: null`;
3. declared local speaker -> `portrait: null`;
4. anything else -> `assetUnknownSpeaker`.

Before dialogue enrichment, reject any local declaration that overlaps a configured display name.

A declared local with an expression is a focused compile error because local speakers have no expression contract.

When assets are disabled, `Local Speakers` syntax still validates but catalog membership remains unenforced, preserving the existing asset-enabled boundary.

## Authoring guidance

### Speaker decision

- recurring or case-significant visible speaker -> global catalog;
- true one-shot faceless speaker -> scene `Local Speakers`;
- `旁白` -> reserved system speaker;
- unresolved reusable/local decision -> stop and escalate;
- never declare local merely to suppress portrait-generation work.

### Narration ownership

| Meaning | Authored form |
|---|---|
| visible movement, body language, atmosphere, room/object state | `[ ... ]` |
| present-character conclusion, judgment, interpretation, reaction | character dialogue |
| time/location transition, unavailable information, intentional voiceover | `**旁白**：...` |

The base writing skill's contradictory warehouse example must be corrected during implementation.

### Expression choreography

- bracketed emotion does not select a portrait asset;
- use only expression slugs that exist for that character;
- use a suitable non-standard slug at a meaningful state transition when one exists;
- do not switch expression every line;
- standard-only catalogs and calm scenes do not create blockers merely for remaining standard.

## Semantic review changes

### Axis 3 — Voice, style, narration & expression

Apply to all four scene types.

For analysis scenes, inspect:

- Intro dialogue;
- every board Result Dialogue;
- Outro dialogue.

Check:

- narration ownership;
- dialogue/visible-direction/portrait-expression coherence;
- meaningful emotional transitions left flat only when a suitable configured slug exists;
- excessive expression flicker;
- no false positive for standard-only or calm sequences.

### Axis 5 — Visual asset coverage & variety

Keep deterministic coverage/spatial checks before subjective variety checks:

1. background/first-cue completeness and compiled asset identity;
2. local-speaker contract;
3. catalog/alias/reusable-character appropriateness;
4. compiled portrait/expression asset IDs and missing files;
5. spatial usability;
6. recurring-location continuity;
7. purposeful background variety;
8. same-view false-positive control.

For analysis scenes, inspect compiler-produced portrait/background refs from Intro/Result/Outro using HPA-259's existing enrichment path.

## Background-variety acceptance phase

### Scope

At the start of this phase:

1. read `docs/stories_plan/chapter_1/chapter.md`;
2. freeze its exact ordered production scene list into `docs/stories_plan/chapter_1/background-variety-audit.md`;
3. inspect every player-visible background cue in those manifest-listed files.

Coverage includes:

- linear `[場景：...]` tags;
- investigation sub-locations and dialogue scene tags;
- interrogation phases and dialogue scene tags;
- production analysis Intro, board Result Dialogue, and Outro scene tags when a manifest-listed `analysis_scene_*.md` exists.

Synthetic HPA-259 fixtures are excluded.

### Variety must have a job

A new or regenerated background is justified only when it improves at least one concrete function:

- **orientation** — establish a room, route, entrance, or relationship between spaces;
- **investigation readability** — make hotspots, standee placement, or source areas understandable;
- **evidence focus** — emphasize a case-significant object/area without fabricating unreadable text;
- **pressure** — visually support confrontation, hearing, or revelation;
- **reasoning state** — support a materially different analytical or procedural beat;
- **aftermath/state** — show a meaningful time, weather, occupancy, lighting, or post-incident change.

A background does not deserve a variant merely because it has remained on screen for several dialogue lines.

### Continuity anchors

Variants of one location family must preserve stable facts players rely on:

- entrances/exits;
- window positions;
- fixed furniture;
- room geometry;
- corridor direction;
- case-significant props;
- signature palette/materials;
- believable adjacency between sub-locations.

Camera angle, distance, focal emphasis, foreground crop, lighting, occupancy, and weather may change when the narrative function changes.

### Audit record

Create `docs/stories_plan/chapter_1/background-variety-audit.md` with the frozen manifest and one row per cue:

| Field | Meaning |
|---|---|
| Scene/source | authored file and cue line/block |
| Asset ID/path | compiled background identity |
| Location family | recurring physical space |
| Current function | orientation/dialogue/investigation/etc. |
| Continuity anchors | stable spatial/canon facts |
| Variety finding | why current composition is sufficient or repetitive |
| Decision | `keep`, `prompt-adjust`, `regenerate`, `add-variant` |
| Priority | `A` or `B` |
| Proposed function | required narrative/spatial delta |
| Disposition | implemented/deferred/accepted |

Priority A affects comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, meaningful state change, or canon/continuity. Priority B is serviceable cosmetic polish and remains documented only.

### Skill/generation rules

- Base dialogue skill: background function, camera angle/distance, focal area, continuity anchors, lighting/weather/occupancy, UI-safe lower composition.
- Investigation skill: sibling sub-locations distinct but spatially coherent and standee/hotspot safe.
- Interrogation skill: a new phase variant only when visible environmental/dramatic state materially changes.
- HPA-552 remains owner of the analysis authoring skill; production analysis scenes inherit the shared base rules.
- Image generation must inspect sibling same-location assets and record continuity anchors plus intended delta before generation.
- Generate/regenerate only accepted Priority A assets; do not create variants to hit an image-count target.
- Final touched backgrounds remain opaque `1920x1080` PNGs.

## Existing-content semantic re-audit acceptance phase

### Corpus authority

Do not hard-code HPA-561 to a permanent 16-file corpus.

At re-audit start:

1. read `docs/stories_plan/chapter_1/chapter.md`;
2. copy its exact ordered production scene list into `docs/stories_plan/chapter_1/semantic-content-reaudit.md`;
3. freeze that list for the rest of the audit;
4. audit every listed scene regardless of scene type.

The current baseline still contains 16 files and still lists `scene_8_5.md`. If HPA-265 has replaced it with `analysis_scene_8_5.md` by execution time, that production analysis scene is automatically included. Synthetic HPA-259 fixtures are excluded.

### Scene-type coverage

- **Linear:** complete queue.
- **Investigation:** Intro, sub-location transitions, hotspot inspect/reexamine, character topic/reexamine, evidence On Collect/Reexamine, statement On Acquire/Reexamine, and Outro.
- **Interrogation:** Intro, phase entry dialogue, testimony loops, challenge/correct/wrong dialogue, authored result/reveal dialogue, and Outro.
- **Analysis:** when production-manifest-listed, Intro, every board Result Dialogue, and Outro.

HPA-561 does not re-review HPA-259 hidden accepted answers, threshold math, or board validation unless a semantic story/canon issue directly exposes a problem.

### Audit dimensions

#### Speaker/local/portrait contract

- exact catalog labels for reusable speakers;
- valid Local Speakers intent for true one-shot faceless speakers;
- no reusable/case-significant character incorrectly declared local;
- reserved `旁白` handling;
- compiled `portrait: null` matches authored intent;
- missing reusable portrait files remain explicit asset work.

#### Narration ownership

Every `旁白` line must be a true transition, unavailable information, or intentional voiceover. Flag visible action/atmosphere/object state better expressed in brackets and present-character conclusions/judgments/reactions better owned by the character.

#### Expression choreography

Check only actual slugs in `characters.yaml`. Important requires either a suitable existing non-standard slug ignored across a meaningful transition or an authored expression that contradicts the visible state. Standard-only or calm scenes are not Important merely for staying standard.

#### Background-variety integration

Cross-check `background-variety-audit.md`: applicable cues are covered, accepted Priority A changes are integrated, continuity remains coherent, and no unnecessary image change is demanded merely to satisfy variety.

### Severity policy

**Blocker:** material identity, canon, viewpoint, or player-understanding failure.

**Important:** unresolved visible reusable portrait treatment, cataloged label drift, major narrator fallback, meaningful ignored expression despite an available slug, or unimplemented accepted Priority A background issue.

**Minor/deferred:** polish without material comprehension, identity, canon, or pacing impact.

### Finding format

Every finding records:

- ID;
- severity;
- exact authored path and line;
- scene/block;
- rule area;
- offending quote;
- authority;
- why it matters;
- remediation direction;
- final disposition.

Record the finding before editing it.

Required final state:

```text
Open Blockers: 0
Open Important: 0
Minor/deferred: documented
```

### Editing boundary

Finding-driven fixes may change:

- `Local Speakers` metadata;
- speaker labels;
- narration/bracket ownership;
- expression annotations;
- reusable portrait catalog/assets;
- accepted Priority A background prompts/assets.

They must not change culprit, case logic, evidence packages, reveal ladder, unlock chains, scene order, sealed-reveal timing, or Chapter 1 canon beyond the minimal accepted correction.

## Ticket relationships

- **HPA-259:** merged baseline; no longer a blocker.
- **HPA-552:** owns `.claude/skills/writing-analysis-scene/SKILL.md`; HPA-561 hardens shared base rules and semantic review instead of duplicating that skill.
- **HPA-265:** may replace the production Beat 8.5 transition; manifest-driven audits automatically handle either state and do not block on HPA-265.
- **HPA-260:** runtime analysis behavior is outside HPA-561.

## Verification strategy

Primary proof:

- focused parser tests for `Local Speakers` across legacy and analysis headers;
- focused enrichment tests proving the same speaker classification on legacy and analysis dialogue;
- emitter/fixture proof that `Local Speakers` never enters runtime JSON;
- honest RED/GREEN skill pressure scenarios and false-positive controls;
- manifest-driven background audit;
- grouped before/after location-family review;
- manifest-driven semantic content re-audit;
- final zero-open-Blocker/Important report.

Broad regression checks:

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
```

Run Rust/full application checks only if implementation unexpectedly touches runtime-facing code; the intended design does not.

## Non-goals

- full header-parser unification;
- semantic alias inference in the compiler;
- narration/emotion/image-similarity classifiers;
- automatic expression choice;
- arbitrary expression/background-count thresholds;
- a third character/location registry;
- an eighth review axis;
- a new Rust/Svelte/runtime JSON field for `Local Speakers`;
- HPA-260 runtime work;
- HPA-552 analysis-skill duplication;
- synthetic analysis-scene background work;
- wholesale Chapter 1 rewrite or background regeneration;
- Chapter 2 or later content audit.

## Acceptance criteria

### Durable speaker contract

- `Local Speakers` works for linear, investigation, interrogation, and analysis scenes.
- HPA-259's required-Summary analysis header behavior remains intact.
- `Local Speakers` parsing is shared through one narrow helper, not four copies.
- All four AST scene types carry compiler-only local-speaker source data.
- Asset-enabled enrichment rejects every undeclared unknown speaker across all four scene types.
- Analysis Intro/Result/Outro reuse the existing HPA-259 enrichment traversal.
- Declared local speakers compile portraitless and cannot author expressions.
- Cataloged speakers cannot be redundantly declared local.
- `旁白` remains reserved.
- `Local Speakers` never appears in emitted runtime JSON.

### Authoring/review rules

- The base writing skill's narration/expression guidance is corrected and hardened.
- Investigation/interrogation background rules support purposeful variety without visual churn.
- Semantic review recognizes all four scene types and applies Axis 3/5 correctly to analysis dialogue.
- HPA-552 remains owner of the dedicated analysis authoring skill.

### Background audit

- The production Chapter 1 manifest is frozen at audit start.
- Every player-visible background cue in that frozen manifest receives `keep`, `prompt-adjust`, `regenerate`, or `add-variant` plus Priority A/B.
- Every new/regenerated background has a distinct narrative/spatial function.
- Recurring-location variants preserve documented continuity anchors.
- Every Priority A item is implemented or explicitly accepted with evidence; Priority B remains documented.
- At least one uninterrupted same-view scene remains `keep` as a false-positive control.
- Touched background PNGs are opaque `1920x1080`.

### Existing-content re-audit

- The production Chapter 1 manifest is frozen at re-audit start rather than permanently hard-coded.
- Every manifest-listed scene is audited regardless of scene type.
- Production analysis scenes are included automatically if present; synthetic HPA-259 fixtures are excluded.
- Every finding cites exact authored path/line and is recorded before editing.
- All Blocker and Important findings are fixed or explicitly accepted with evidence.
- Final full-corpus review reports zero open Blocker and Important findings.
- Minor/deferred findings remain documented.
- Fixes remain finding-driven and do not become an unrelated Chapter 1 rewrite.
- Canon, evidence logic, unlock chains, reveal timing, and scene order remain intact.
