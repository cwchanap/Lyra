# HPA-561 Durable Scene Asset Contracts and Semantic Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable scene-level local-speaker contract across all four compiler scene types, harden narration/expression review, and migrate current Chapter 1 content without adding semantic compiler heuristics.

**Architecture:** Build on the merged HPA-259 baseline. Preserve the existing legacy header parser and HPA-259's separate required-Summary analysis header; share only a narrow Local Speakers parser helper through `parser-common.ts`. Add compiler-only local-speaker data to all four AST scene types and reuse HPA-259's existing analysis asset traversal so one common `enrichLine()` speaker-classification path governs linear, investigation, interrogation, and analysis dialogue. Keep alias appropriateness, narration ownership, expression choreography, and portrait-worthiness in skills/review.

**Tech Stack:** TypeScript scene compiler, Vitest, Markdown scene files, YAML asset catalog, Claude skills, Bun scripts.

## Global Constraints

- HPA-259 is merged and is the implementation baseline.
- Preserve HPA-259's separate required-Summary analysis header contract.
- Do not reimplement analysis dialogue traversal; `enrichAnalysisScene()` already covers Intro, board Result Dialogue, and Outro.
- `Local Speakers` is compile-time-only and must never enter emitted JSON or Rust/Svelte types.
- Local-speaker membership is strict only when assets are enabled, matching the existing asset-enrichment boundary.
- `旁白` is reserved and never requires catalog/local declaration.
- A declared local speaker is intentionally portraitless and cannot use an expression slug.
- Catalog overlap is validated where asset config exists, not in syntax-only parser code.
- Do not infer aliases in the compiler.
- Do not use Local Speakers to suppress portrait work for a reusable or case-significant visible character.
- Preserve the seven review axes; extend Axis 3 and Axis 5.
- Do not create `.claude/skills/writing-analysis-scene/SKILL.md`; HPA-552 owns that skill.
- Background variety is implemented by `docs/superpowers/plans/2026-08-05-chapter-1-background-variety-audit-implementation-plan.md`.
- Existing-content re-audit is implemented by `docs/superpowers/plans/2026-08-05-chapter-1-semantic-content-reaudit-implementation-plan.md`.

---

## File Structure

### Compiler/tests
- Modify `packages/scripts/compile-scenes/parser-common.ts` — add shared Local Speakers helper.
- Modify `packages/scripts/compile-scenes/parser-scene-header.ts` + test — legacy optional-Summary integration.
- Modify `packages/scripts/compile-scenes/parser-analysis.ts` + test — analysis required-Summary integration.
- Modify `packages/scripts/compile-scenes/types.ts` — `ASTLocalSpeaker` plus fields on all four AST scene types.
- Modify `parser-linear.ts`, `parser-investigation.ts`, `parser-interrogation.ts` — propagate header result.
- Modify `packages/scripts/compile-scenes/assets/enrich.ts` + test — common four-scene speaker classification.
- Modify focused emitter/compiler fixtures only to prove Local Speakers never enter runtime JSON.

### Content/catalog
- Modify only manifest-listed Chapter 1 scenes that need local declarations or label corrections.
- Modify `static/assets/config/characters.yaml` for reusable portrait-worthy speakers discovered by the strict gate.

### Skills
- Modify `.claude/skills/writing-detective-game-dialogue/SKILL.md`.
- Modify `.claude/skills/reviewing-story-scenes/SKILL.md`.
- Modify `.claude/skills/subagent-driven-story-writing/SKILL.md`.
- Do not duplicate HPA-552's analysis authoring skill.

---

### Task 1: Record honest RED semantic pressure scenarios

**Files:**
- Create `docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md`.

- [ ] Record baseline prompts/results for narration fallback, reusable visible speaker without catalog contract, prospective label drift, and bracket-only emotional transition.
- [ ] Keep calm-scene and intentional-local cases as post-change controls only.
- [ ] Add an analysis-scene inheritance check using HPA-259-shaped Intro / Result Dialogue / Outro content; record whether current review instructions recognize it.
- [ ] Commit baseline evidence before skill changes.

---

### Task 2: Parse `Local Speakers` while preserving HPA-259 header semantics

**Files:** `parser-common.ts`, `parser-scene-header.ts`, `parser-scene-header.test.ts`, `parser-analysis.ts`, `parser-analysis.test.ts`, `types.ts`, and the three legacy scene parsers.

**Produces:**

```ts
export type ASTLocalSpeaker = Located<{ name: string }>;

export function parseOptionalLocalSpeakers(
  tokens: Token[],
  sourceFile: string,
  startIndex: number,
):
  | { ok: true; value: { localSpeakers: ASTLocalSpeaker[]; nextTokenIndex: number } }
  | { ok: false; error: CompileError };
```

- [ ] Write failing tests covering Summary+Local Speakers, legacy no-Summary placement, analysis required-Summary placement, duplicate/misplaced key, empty/duplicate member, leading/trailing comma, reserved `旁白`, and source-line preservation.
- [ ] Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-scene-header.test.ts packages/scripts/compile-scenes/parser-analysis.test.ts
```

- [ ] Add `localSpeakers: ASTLocalSpeaker[]` to linear, investigation, interrogation, and analysis ASTs only; do not add JSON fields.
- [ ] Implement `parseOptionalLocalSpeakers()` in `parser-common.ts` without parsing Summary or board metadata.
- [ ] Legacy `parseSceneHeader()` calls it after optional Summary handling.
- [ ] `parseAnalysisHeader()` keeps HPA-259's required Summary and calls it after the Summary token.
- [ ] Propagate header result into all four AST scene types.
- [ ] Re-run focused tests plus `bun run check:scripts`.
- [ ] Commit as `feat: parse local speakers across scene types`.

---

### Task 3: Enforce speaker classification through HPA-259's existing asset traversal

**Files:** `assets/enrich.ts`, `assets/enrich.test.ts`, focused fixtures.

- [ ] Write failing tests for unknown speakers in legacy dialogue and analysis Intro/Result/Outro, reserved narrator, declared local, local+expression, catalog speaker, catalog/local overlap, and assets-disabled behavior.
- [ ] Run the focused enrichment test and confirm RED.
- [ ] Add the current scene's local-speaker set to `EnrichContext` for both regular and analysis records.
- [ ] Reuse existing `enrichAnalysisScene()`; do not add a second traversal.
- [ ] Validate catalog/local overlap once per scene using `characters.byDisplayName`.
- [ ] Make `enrichLine()` classify in this order: catalog -> `旁白` -> declared local -> `assetUnknownSpeaker`.
- [ ] A local speaker with an expression returns a focused compile error and no portrait.
- [ ] Prove emitted linear/investigation/interrogation/analysis JSON contains no `localSpeakers` field.
- [ ] Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/assets/enrich.test.ts
bun run test:scripts
bun run check:scripts
```

- [ ] Commit as `feat: enforce durable scene speaker contracts`.

---

### Task 4: Migrate production Chapter 1 speaker contracts

- [ ] Read `docs/stories_plan/chapter_1/chapter.md` at task start and freeze the actual manifest; do not assume the historical 16-file list.
- [ ] Run `bun run scenes:compile` and collect actual speaker diagnostics.
- [ ] Classify each as cataloged reusable, reusable needing catalog/portrait work, genuine local, typo/incorrect label, or reserved narrator.
- [ ] Do not bulk-whitelist diagnostics into Local Speakers.
- [ ] Known direction: anonymous commuters are strong local candidates; `店主` is not `店長高瀨`; visible case-significant 增田圭 gets a reusable catalog contract.
- [ ] If the manifest already contains a production `analysis_scene_*.md`, apply the same classification to Intro/Result/Outro speakers automatically.
- [ ] Keep missing portrait PNGs visible as separate asset work; never downgrade a reusable speaker to local to clear warnings.
- [ ] Re-run `bun run scenes:compile` until speaker-classification errors are resolved.
- [ ] Commit metadata/catalog separately from generated art.

---

### Task 5: Harden writing, review, and orchestration skills

- [ ] Correct contradictory narration examples: visible movement/architecture/atmosphere/body discovery use brackets unless intentionally voiceover.
- [ ] Add reusable/catalog vs local vs reserved speaker guidance and escalation rules.
- [ ] Add a catalog-bounded expression pass: brackets do not change portrait state; use existing slugs only; switch on meaningful transitions; no line-by-line flicker; calm/standard-only scenes remain valid.
- [ ] Extend `reviewing-story-scenes` applicability to `scene_*`, `investigation_scene_*`, `interrogation_scene_*`, and `analysis_scene_*`.
- [ ] For analysis scenes, Axis 3 reviews Intro / every Result Dialogue / Outro; Axis 5 reviews their speaker/portrait/background refs from HPA-259 enrichment.
- [ ] Do not create `writing-analysis-scene`; add a handoff note that HPA-552's future skill inherits/references base dialogue rules.
- [ ] Remove ephemeral cast-table relay from the orchestrator; source Markdown owns Local Speakers intent.
- [ ] Rerun RED scenarios as GREEN plus the two controls and analysis inheritance check.
- [ ] Commit skill changes and scenario results.

---

### Task 6: Verify against merged HPA-259 baseline

- [ ] Map acceptance criteria to legacy-header tests, analysis-header tests, enrichment tests across analysis Intro/Result/Outro, runtime-omission fixture proof, scenario evidence, and production corpus classifications.
- [ ] Run:

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
```

- [ ] Confirm HPA-259 analysis JSON remains valid and no Local Speakers field appears in emitted JSON.
- [ ] Confirm HPA-561 changes no Rust/Svelte types and reuses the existing analysis enrichment path.
- [ ] Inspect `git diff --name-only main...HEAD` and explain every path.
- [ ] Run final standalone semantic review across all four scene types.

## Plan Self-Review

- HPA-259 parsing/enrichment is reused, not rebuilt.
- Legacy optional Summary and analysis required Summary both remain intact.
- Local Speakers syntax lives in one narrow shared helper.
- Local Speakers remains compiler-only.
- No generic header framework, alias classifier, or new runtime field is introduced.
- Manifest-driven audits automatically include production analysis content if HPA-265 has landed.
- HPA-552 remains owner of the dedicated analysis authoring skill.
