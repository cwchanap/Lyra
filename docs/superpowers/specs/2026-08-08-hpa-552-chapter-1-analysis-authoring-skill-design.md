# HPA-552 Chapter 1 Analysis Scene Authoring Skill Design

**Status:** Proposed  
**Linear:** HPA-552 — Add the analysis-scene authoring skill for Chapter 1 writers  
**Scope:** Authoring contract and repo guidance only; no runtime, layout-editor, or Chapter 2 template work

## 1. Summary

Add one focused repo-contract skill, `.claude/skills/writing-analysis-scene/SKILL.md`, for authoring the Chapter 1 `analysis_scene_<K>.md` contract.

The compiler remains the source of truth for syntax, references, provenance interpretation, accepted-solution normalization, asset metadata, and reachability. The skill teaches writer intent and ownership; it is not a second schema implementation.

The implementation remains intentionally small:

- one new Analysis authoring skill;
- one compiler-backed invalid unsupported-board fixture;
- narrow routing/story-state links in existing repo guidance; and
- no parser, runtime, frontend, save, layout-editor, or Chapter 2 work.

Canonical copyable examples remain compiler fixtures. No Markdown-fence compiler, schema-doc generator, or extension framework is introduced.

## 2. Baseline and sequencing

HPA-259 is merged and supplies the original Chapter 1 Analysis contract:

- `analysis_scene_<K>.md` manifest dispatch;
- source-located parsing;
- closed `classify`, `order`, and `threshold` board kinds;
- evidence/statement-backed cards;
- positive story unlock expressions;
- story reveal validation;
- provenance-backed threshold validation;
- deterministic normalized accepted answers;
- qualified Analysis scene/board registration; and
- the full Beat 8.5 compiler fixture under `packages/scripts/__fixtures__/analysis-chapter-1/`.

HPA-265 is the intended production consumer for the real Beat 8.5 scene.

HPA-561 PR #44 is also in flight and changes several overlapping writer/reviewer skills plus the Chapter 1 onboarding Analysis scene. HPA-552 implementation must start from or rebase onto post-#44 `main` before touching those overlapping files. It must preserve HPA-561's narration/catalog/background/review hardening.

This sequencing rule also means the new Analysis skill must describe the **current post-#44 Chapter 1 compiler contract**, not freeze a pre-#44 snapshot. Two existing tutorial-only additions from #44 therefore need a narrow note:

- `practice:<id>` Analysis card sources for the P1 onboarding scene; and
- optional threshold `### Incorrect Selection` feedback blocks.

These are already-built Chapter 1 exceptions, not new HPA-552 features. They must not be generalized into Beat 8.5 Case File/provenance semantics.

## 3. Repository gaps

### 3.1 No dedicated Analysis authoring skill

`CLAUDE.md` treats `.claude/skills/*/SKILL.md` as the authoring contract, but Analysis has no dedicated writer skill.

### 3.2 Chapter-manifest guidance is stale

`writing-chapter-manifest` still omits `analysis_scene_<K>.md`.

### 3.3 Story-writing orchestration is stale

`subagent-driven-story-writing` does not route Analysis files to `writing-analysis-scene` or include Analysis-specific brief inputs.

### 3.4 Investigation/interrogation qualified-Analysis notes are stale

Both skills already show qualified Analysis predicates but still describe Analysis registration as synthetic-fixture-only. HPA-259 made those references part of the production compiler contract.

Corrected guidance must say:

- qualified Analysis refs must resolve to manifest-owned Analysis content;
- playable content should depend only on completion that its runtime/content flow can actually produce; and
- prefer emitted Facts/Objectives when the narrative dependency is the earned conclusion rather than UI completion itself.

Authorization remains separate: Analysis can prepare a request but must not grant `narrow_lock_export`.

### 3.5 `reviewing-story-scenes` needs only the final new-skill link after HPA-561

Current `main` still shows three-family review routing, but HPA-561 PR #44 already adds:

- `analysis_scene_*.md` to description/When-to-Use;
- Analysis files to Phase 1 discovery;
- Analysis Intro / Result Dialogue / Outro to the existing semantic axes; and
- Analysis-aware visual review through the existing Axis 5 rules.

HPA-552 must not duplicate that work.

After rebasing onto post-#44 `main`, HPA-552 only adds the link #44 could not add before the skill existed: name `writing-analysis-scene` in the review skill's related/relevant format-skill guidance, while verifying #44's Analysis discovery/axes remain present.

### 3.6 The Linear answer-key non-goal is over-broad

The ticket says “no answer-key data in any authored or shared surface,” but HPA-259 requires authors to declare semantic solution intent:

- classify `Accepted Cards`;
- order `Accepted Order` / `Fixed Anchors`; and
- threshold sufficiency constraints.

The real invariant is:

> Authors declare semantic solution intent in Markdown. Compiler-normalized answer keys remain compiler/runtime-private and do not enter answer-key-free public/shared views. Writers never hand-edit generated JSON.

## 4. Goals

1. Give Chapter 1 writers one skill for `analysis_scene_<K>.md`.
2. Cover only `classify`, `order`, and `threshold` board families.
3. Teach author intent without duplicating validator implementation.
4. Keep real case-analysis cards tied to existing evidence/statements and source-owned provenance.
5. Document HPA-561's tutorial-only `practice:` / exact wrong-selection exceptions narrowly if #44 lands as planned.
6. Explain threshold source-group/procedural-status/proof-capability semantics at the level writers need.
7. Keep valid/invalid examples compiler-backed.
8. Route authoring/orchestration/review guidance to the new skill without overwriting HPA-561.
9. Preserve request-readiness vs institutional-authorization ownership.

## 5. Non-goals

- No Analysis runtime/frontend/persistence work.
- No layout-editor preview/provenance inspector.
- No map authoring.
- No `compare`, `route`, `chain`, freeform, or plugin/template registry.
- No schema-to-doc generator.
- No compiler change for documentation convenience.
- No Analysis-local Evidence/Statement Manifest.
- No duplicate provenance model.
- No progressive hint system.
- No Analysis self-grant of institutional authorization.
- No new semantic-review axis/framework.
- No generalized practice-card subsystem beyond documenting the already-built onboarding exception.

## 6. Selected approach: reference-first skill + compiler fixtures

Canonical valid case-analysis example:

- `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md`
- companion source records: `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/investigation_scene_1.md`
- companion story/source-group definitions: `packages/scripts/__fixtures__/analysis-chapter-1/story_catalog.md`

Post-HPA-561 tutorial-only reference, if #44 lands unchanged:

- `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`

Use this only to document `practice:<id>`, exact `Incorrect Selection`, and scene-tag asset metadata already used by the real tutorial. It is not the canonical Beat 8.5 case-analysis example.

Canonical invalid example:

- `packages/scripts/__fixtures__/invalid/hpa_552_analysis_unsupported_board_kind/`
- declares `Kind: route`;
- expected diagnostic: `analysisBoardInvalidKind`.

The invalid fixture includes one tiny valid `scene_0.md` before the invalid Analysis scene. This keeps the chapter playable-scene count non-zero after Analysis parse failure, avoiding incidental `chapterNoPlayableScenes` noise.

This fixture remains useful despite existing parser unit coverage because it is the named writer-facing invalid example and exercises the manifest/orchestrator compile path.

Rejected alternatives remain:

- duplicate full valid scene inside the skill;
- fence-extraction/doc-test harness; and
- generated docs from parser metadata.

## 7. Ownership model

### 7.1 Compiler owns syntax/semantics

Authoritative implementation surfaces:

- `parser-analysis.ts`
- `validator-analysis.ts`
- `parser-common.ts`
- `parser-assets.ts`
- `parser-unlock.ts`
- `story-catalog.ts`
- `case-record-provenance.ts`
- `reachability.ts`

If skill prose disagrees with code, correct the skill.

### 7.2 Real case records remain investigation/interrogation-owned

Beat 8.5 and other real case-analysis cards reference:

```text
evidence:<id>
statement:<id>
```

Source Group, Procedural Status, Proof Capabilities, Representation Layer, Completeness/Confidence, and Supersedes remain on the source record.

Threshold acceptance reads those semantics through card references. Do not copy them to Analysis cards.

### 7.3 Tutorial-only practice exception

On the post-HPA-561 baseline, the P1 onboarding Analysis scene may reference:

```text
practice:<id>
```

These are tutorial-local carriers, not Case File evidence/statements. The skill must make this boundary explicit:

- use `practice:` only for the onboarding tutorial contract that already exists;
- do not use `practice:` in Beat 8.5 or normal Case File reasoning;
- do not assign Case File provenance/source groups/capabilities to practice cards;
- do not mix practice and Case File cards in one threshold eligible set; and
- all-practice threshold boards keep provenance requirements neutral as required by the compiler.

HPA-552 does not create or broaden practice storage/runtime behavior.

### 7.4 Analysis author owns reasoning intent

Writers own:

- title/Summary;
- Intro/Result Dialogue/Outro;
- board labels/prompts/feedback/static Hint;
- board/card/group IDs;
- card source references;
- classify accepted groups;
- exact order + fixed anchors;
- threshold sufficiency constraints;
- positive board prerequisites; and
- story outputs.

### 7.5 Generated/runtime data remains generated

Writers do not hand-edit generated scene/catalog JSON, normalized answer maps/selections, runtime save state, public answer-key-free views, or filesystem paths.

## 8. New skill contract

### 8.1 Structure

```text
H1  # Scene N: <title>
    - **Summary:** <player recap>
H2  ## Intro
H2  ## Board: <label> {#board_id}
H3      ### Card: <label> {#card_id}
H3      ### Group: <label> {#group_id}       # classify only
H3      ### Incorrect Selection               # threshold only, optional post-HPA-561
H3      ### Result Dialogue
H2  ## Outro
```

Core rules:

- exactly one Intro before all boards;
- one or more boards;
- exactly one Outro after boards;
- non-empty Result Dialogue on every board;
- board IDs scene-local;
- card/group IDs board-local; and
- no Analysis-local Evidence/Statement Manifest.

### 8.2 Common board fields

Required:

- `Kind`
- `Prompt`
- `Reveals`
- `Incomplete Feedback`
- `Incorrect Feedback`

Optional:

- `Unlock`
- `Hint`

Closed-key validation remains compiler-owned.

### 8.3 Cards

Normal case analysis:

```text
Source: evidence:<id>
Source: statement:<id>
```

Post-HPA-561 onboarding-only exception:

```text
Source: practice:<id>
```

Card Summary is player-facing reasoning copy and does not redefine provenance.

### 8.4 `classify`

Each Group has `Description` + `Accepted Cards`; every displayed card belongs to exactly one accepted group.

Compiler derives normalized `acceptedGroupByCard`.

### 8.5 `order`

The skill must state the real parser/validator contract without hedging:

- `Accepted Order` is required and contains every displayed card exactly once.
- `Fixed Anchors` is **required on every order board**.
- use `Fixed Anchors: []` when nothing is pinned;
- non-empty entries use `<card_id>@<one-based-position>`;
- card IDs/positions are unique, in range, and must agree with Accepted Order at that position.

Do not omit the field or invent a sentinel.

### 8.6 `threshold`

Case-analysis fields:

- `Eligible Cards`
- `Minimum Selected`
- `Minimum Distinct Source Groups`
- `Required Proof Capabilities`
- `Allowed Procedural Statuses`
- `Require Source Group`

Case-record semantics:

- allowed status applies per selected record;
- required source group applies per selected record;
- independence counts distinct non-null group IDs;
- capabilities are satisfied by union across the selection; and
- provenance comes from referenced source records.

Tutorial practice thresholds follow the compiler's neutral-provenance rule and do not mix practice with Case File cards.

Do not expose materialization implementation details as authoring design rules.

### 8.7 Optional threshold `Incorrect Selection`

If the post-HPA-561 compiler retains this already-built feature, a threshold board may add targeted exact wrong-subset feedback:

```markdown
### Incorrect Selection

- **Cards:** [card_a, card_b]
- **Feedback:** <short player-facing explanation>
```

It remains optional and narrow:

- only threshold boards;
- non-empty unique displayed cards;
- no duplicate authored wrong set;
- must not equal an accepted selection; and
- does not replace the board's general `Incorrect Feedback` or create progressive hint state.

### 8.8 Story progress/authority

Beat 8.5 may establish facts and complete `prepare_narrow_lock_request`.

It may not grant `narrow_lock_export`; `grant_authorization` remains compiler-forbidden on Analysis boards.

### 8.9 Feedback

First-version skill documents:

- Incomplete Feedback;
- general Incorrect Feedback;
- optional static Hint;
- optional exact threshold Incorrect Selection only if present on the post-HPA-561 baseline; and
- Result Dialogue.

No new progressive feedback engine is added.

### 8.10 Asset contract

The review claim that Analysis has no authored asset fields is incorrect.

Analysis Intro, Result Dialogue, and Outro all use `consumeDialogueUntilHeading`. A `[場景：…]` in those dialogue carriers can consume the shared scene-tag visual/audio metadata, and `enrichAnalysisScene` traverses all three.

On the post-HPA-561 baseline, that scene-tag metadata includes:

- `Background Prompt`;
- `Background Asset ID`;
- `BGM`;
- `BGS`.

Rules for the skill:

- attach supported visual/audio metadata immediately after `[場景：…]` in Intro/Result Dialogue/Outro;
- do not put background/audio fields directly on Board/Card/Group metadata;
- no Analysis-local Evidence Manifest means no local evidence `Image Prompt`; and
- never author filesystem paths.

The real HPA-561 `analysis_scene_p1_5.md` already demonstrates Intro scene-tag background metadata.

## 9. Repo-contract synchronization

### 9.1 `CLAUDE.md`

Add Analysis scene family -> `writing-analysis-scene`.

### 9.2 `writing-chapter-manifest`

Add Analysis filename/type inference. No explicit type metadata.

### 9.3 `subagent-driven-story-writing`

Map reasoning/evidence-organization workbenches to Analysis and dispatch the new skill. Analysis briefs provide exact IDs/source owner paths/prerequisites/story outputs/authority boundary without cloning schema.

### 9.4 `writing-investigation-scene`

Replace only stale synthetic-only qualified-Analysis wording.

### 9.5 `writing-interrogation-scene`

Same focused correction.

### 9.6 `reviewing-story-scenes`

Treat this as a sixth touched guidance file only for the new-skill link.

After rebasing onto #44:

- verify Analysis discovery/When-to-Use/axes are already present;
- add `writing-analysis-scene` to related/relevant format-skill guidance; and
- leave the seven-axis design unchanged.

Do not reapply #44's larger semantic-review patch.

## 10. Validation

Run:

```bash
bun run test:scripts
bun run scenes:compile
bun run check:scripts
bun run format:check
```

No Rust/frontend/E2E/layout-editor checks are required unless implementation unexpectedly touches them.

## 11. Expected implementation diff

Create:

- `.claude/skills/writing-analysis-scene/SKILL.md`
- invalid fixture `chapter.md`
- invalid fixture `scene_0.md`
- invalid fixture `analysis_scene_1.md`
- invalid fixture `expected-error.txt`

Modify narrowly:

- `CLAUDE.md`
- `writing-chapter-manifest`
- `subagent-driven-story-writing`
- `writing-investigation-scene`
- `writing-interrogation-scene`
- `reviewing-story-scenes`

No compiler/runtime production source change should be needed.

## 12. Review resolution

Accepted:

- Fixed Anchors guidance: required, `[]` when none, one-based entries consistent with Accepted Order.
- Clean the invalid fixture with a valid linear scene so its manual output does not include incidental `chapterNoPlayableScenes`.
- Keep the end-to-end unsupported-kind fixture despite existing parser unit coverage.

Accepted with adjustment:

- `reviewing-story-scenes` is a sixth touched surface only for the final link to `writing-analysis-scene`; HPA-561 already owns Analysis discovery/axes.

Rejected after code verification:

- “Analysis has no authored asset fields.” Shared scene-tag metadata is supported in Analysis dialogue carriers and already used by the real HPA-561 tutorial scene.

Additional post-#44 drift found during verification:

- HPA-561 adds tutorial-only `practice:<id>` cards and threshold `Incorrect Selection` blocks. Because HPA-552 deliberately rebases onto that compiler baseline, the skill documents these existing exceptions narrowly instead of leaving false pre-#44 guidance.

Everything else stays unchanged: compiler authority, three board families, reference-first examples, source-owned provenance, normalized-answer boundary, authorization separation, and no new architecture.

## 13. Final decision

Implement HPA-552 as a small reference-first authoring contract on the post-HPA-561 Chapter 1 compiler/skill baseline. The missing product is reliable writer guidance, not another framework.