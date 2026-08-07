# HPA-561 Durable Scene Asset Contracts and Semantic Review Hardening Design

## Status

Design approved for refresh after HPA-259. This document now targets the compiler and runtime baseline that exists after HPA-259 merged into `main`.

HPA-561 remains split into three independently reviewable workstreams:

1. durable speaker/portrait contracts plus narration/expression review;
2. Chapter 1 background-variety audit and selective regeneration;
3. Chapter 1 existing-content semantic re-audit.

The companion documents are:

- `docs/superpowers/specs/2026-08-05-chapter-1-background-variety-audit-design.md`
- `docs/superpowers/plans/2026-08-05-chapter-1-background-variety-audit-implementation-plan.md`
- `docs/superpowers/specs/2026-08-05-chapter-1-semantic-content-reaudit-design.md`
- `docs/superpowers/plans/2026-08-05-chapter-1-semantic-content-reaudit-implementation-plan.md`

## Post-HPA-259 baseline

HPA-259 is no longer a future dependency. The repository now has four compiler-driven scene types:

- linear;
- investigation;
- interrogation;
- analysis.

Analysis scenes already have:

- `ASTAnalysisScene` with `intro`, `boards[].resultDialogue`, and `outro` dialogue containers;
- `parser-analysis.ts` with a required-Summary analysis header contract;
- `parser-common.ts` shared parser helpers;
- `enrichAnalysisScene()` and ordered asset enrichment;
- Rust immutable analysis scene/catalog wire and analysis dialogue origins.

HPA-561 must extend these landed seams rather than reintroducing a three-scene-type assumption.

Production Chapter 1 still uses `scene_8_5.md`; HPA-259 deliberately did not insert `analysis_scene_8_5.md`. HPA-265 owns the later production Beat 8.5 replacement.

## Observed quality gaps

Chapter 1 playtesting exposed three confirmed failures:

- scene-closing conclusions were authored as `旁白` even though they were character-owned interpretation or summary;
- speaking characters could silently become `portrait: null` without durable author intent;
- bracketed emotional beats did not change portraits while dialogue omitted appropriate available expression slugs.

Cataloged-label drift is a related prospective risk, not the cause of `店主` in `scene_p1.md`. The stationery-shop `店主` and Rain Bell `店長高瀨` are separate characters.

## Decision

Adopt a hybrid structural/semantic boundary.

### Compiler owns deterministic speaker membership

Every scene type may declare one optional scene-level metadata line:

```markdown
- **Local Speakers:** 上班族, 路人甲
```

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
- a background needs a new camera/composition variant.

Those remain writing/review responsibilities.

## Local Speakers authored contract

### Syntax

Legacy scene types retain their existing optional-Summary behavior:

```markdown
# Scene P0: 雨中的東京
- **Summary:** 東京雨夜裡，KAGAMI 試點悄悄成為城市日常。
- **Local Speakers:** 上班族, 路人甲, 路人乙
```

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
- For legacy scene types without authored Summary, it appears immediately after H1.
- Entries are comma-separated, trimmed, non-empty, and unique.
- `旁白` is reserved and cannot be declared local.
- Catalog overlap is invalid when assets are enabled: a registered display name must use its catalog contract instead of being redeclared local.
- The metadata is compiler-only and never appears in emitted runtime JSON.

## Parser architecture

Do **not** unify the full legacy and analysis header parsers merely for this feature.

HPA-259 intentionally gave analysis scenes a separate required-Summary header parser, while linear/investigation/interrogation use `parseSceneHeader()` with optional Summary fallback.

Add one narrow common helper in the landed parser-common seam:

```ts
parseOptionalLocalSpeakers(tokens, sourceFile, startIndex)
```

It owns only:

- immediate `Local Speakers` recognition;
- comma-list syntax;
- empty/duplicate entry checks;
- reserved `旁白` rejection;
- duplicate/misplaced Local Speakers diagnostics;
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

This keeps HPA-259's required-Summary contract intact without duplicating Local Speakers parsing.

Catalog overlap cannot be parser-owned because the parser has no asset config. It is validated during asset enrichment.

## AST boundary

Add one compile-time-only local-speaker field to all four compiler AST scene types:

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

## Asset-enrichment behavior

HPA-259 already added analysis asset traversal. Reuse it.

Existing analysis enrichment already visits:

- `intro`;
- every `boards[].resultDialogue`;
- `outro`.

HPA-561 must not create a second analysis traversal. Instead, extend the common `EnrichContext` with the scene's local-speaker set and make `enrichLine()` classify speakers consistently for all four scene types.

Order:

1. configured catalog speaker -> existing portrait/no-portrait logic;
2. reserved `旁白` -> `portrait: null`;
3. declared local speaker -> `portrait: null`;
4. anything else -> `assetUnknownSpeaker`.

Before dialogue enrichment, reject a local declaration that overlaps a configured display name.

A declared local with an expression produces a focused compile error because local speakers have no expression contract.

When assets are disabled, parser syntax still validates but catalog membership remains unenforced, preserving the existing asset-enabled boundary.

## Runtime boundary after HPA-259

HPA-561 introduces **no additional runtime scene fields** beyond the HPA-259 baseline.

That wording is important: HPA-259 already added the `analysis` runtime scene/catalog wire. HPA-561 does not roll it back and does not claim the entire runtime schema is unchanged relative to the pre-HPA-259 branch.

The only new authored metadata, `Local Speakers`, remains compiler-only.

## Writing guidance

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
- do not switch every line;
- standard-only catalogs and calm scenes do not create blockers.

## Analysis authoring-skill ownership

HPA-552 owns creation of `.claude/skills/writing-analysis-scene/SKILL.md`.

HPA-561 does not duplicate that ticket. Instead:

- the base dialogue rules hardened by HPA-561 apply to analysis dialogue;
- `reviewing-story-scenes` is extended to recognize analysis scenes immediately;
- when HPA-552 lands, its analysis skill should reference/inherit the base dialogue rules rather than copy them.

HPA-561 should be related to HPA-552 and HPA-265, not blocked by either.

## Review Axis changes

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

### Axis 5 — Visual asset coverage

Keep background checks first, then:

1. local-speaker contract;
2. catalog/alias/reusable-character appropriateness;
3. compiled portrait/expression asset IDs;
4. missing-file warnings;
5. background continuity/variety from the companion workstream.

For analysis scenes, inspect compiler-produced portrait/background refs from Intro/Result/Outro dialogue using the HPA-259 enrichment path.

## Existing-content audit policy

Do not hard-code HPA-561 to a permanent 16-file corpus.

At audit start:

1. read `docs/stories_plan/chapter_1/chapter.md`;
2. freeze the exact manifest-listed production corpus into the audit report;
3. audit every listed scene file, regardless of scene type.

The current post-HPA-259 baseline still contains 16 files and still lists `scene_8_5.md`.

If HPA-265 has replaced it with `analysis_scene_8_5.md` by execution time, the analysis scene is automatically included without changing HPA-561's design.

Synthetic HPA-259 fixtures are not part of the Chapter 1 content audit.

## Background-variety policy

The companion background audit follows the same manifest-driven rule.

It audits every production background-bearing scene listed in the Chapter 1 manifest at execution time. If a production analysis scene exists, its Intro/Result/Outro scene-tag background cues are in scope. HPA-561 does not invent or regenerate backgrounds for synthetic analysis fixtures.

## Verification strategy

Primary proof:

- focused parser tests for Local Speakers across legacy and analysis headers;
- focused enrichment tests proving the same speaker classification on legacy and analysis dialogue;
- emitter/fixture proof that Local Speakers never enter runtime JSON;
- honest RED/GREEN skill pressure scenarios;
- manifest-driven Chapter 1 background audit;
- manifest-driven Chapter 1 semantic content re-audit;
- final zero-open-Blocker/Important report.

Broad regression checks:

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
```

Run Rust/full application checks only when HPA-561 implementation actually touches runtime-facing code unexpectedly; the intended design does not.

## Non-goals

- no full header-parser unification;
- no semantic alias inference in the compiler;
- no narration/emotion/image-similarity classifier;
- no automatic expression or image generation;
- no arbitrary expression/background-count thresholds;
- no third character/location registry;
- no eighth review axis;
- no new Rust/Svelte/runtime JSON field for Local Speakers;
- no HPA-260 runtime work;
- no HPA-552 analysis-skill duplication;
- no synthetic analysis-scene background work;
- no wholesale Chapter 1 rewrite or background regeneration;
- no Chapter 2 audit.

## Acceptance criteria

- Local Speakers works for linear, investigation, interrogation, and analysis scenes.
- HPA-259's required-Summary analysis header behavior remains intact.
- Local Speakers parsing is shared through one narrow helper, not four copies.
- All four AST scene types carry compiler-only local-speaker source data.
- Asset-enabled enrichment rejects every undeclared unknown speaker across all four scene types.
- Analysis Intro/Result/Outro reuse the existing HPA-259 enrichment traversal.
- Declared local speakers compile portraitless and cannot author expressions.
- Cataloged speakers cannot be redundantly declared local.
- `旁白` remains reserved.
- Local Speakers never appear in emitted runtime JSON.
- The base writing skill's narration/expression guidance is corrected and hardened.
- Semantic review recognizes all four scene types.
- HPA-552 remains owner of the analysis authoring skill.
- Background and semantic audits freeze the production Chapter 1 manifest at execution time rather than hard-coding a permanent file list.
- If a production analysis scene is manifest-listed, it is audited automatically.
- The final content re-audit has zero open Blocker and Important findings.
