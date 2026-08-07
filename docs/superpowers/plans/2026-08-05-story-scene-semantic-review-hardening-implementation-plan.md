# HPA-561 Durable Scene Asset Contracts and Semantic Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable scene-level local-speaker contract across all four compiler scene types, harden narration/expression/background review, and apply the new rules to the production Chapter 1 manifest through a focused background audit and semantic re-audit.

**Architecture:** Build on the merged HPA-259 baseline. Preserve the legacy optional-Summary header and HPA-259's separate required-Summary analysis header; share only one narrow `Local Speakers` parser helper. Keep deterministic speaker membership in the compiler, reuse HPA-259's existing analysis asset traversal, keep narration/expression/background judgments in skills/review, then freeze the production Chapter 1 manifest and run background + semantic acceptance passes against the exact corpus that exists at execution time.

**Tech Stack:** TypeScript scene compiler, Vitest, Markdown story sources, YAML asset catalog/policy, PNG background assets, Claude skills, Bun scripts.

## Global Constraints

- HPA-259 is merged and is the implementation baseline.
- Preserve HPA-259's separate required-Summary analysis header contract.
- Reuse `enrichAnalysisScene()` for analysis Intro, board Result Dialogue, and Outro; do not add a second analysis traversal.
- `Local Speakers` is compile-time-only and must never enter emitted JSON or Rust/Svelte types.
- Speaker membership is strict only when assets are enabled, matching the existing enrichment boundary.
- `旁白` is reserved and never requires catalog/local declaration.
- A declared local speaker is intentionally portraitless and cannot use an expression slug.
- Validate catalog overlap where asset config exists, not in syntax-only parser code.
- Do not infer aliases in the compiler.
- Do not use `Local Speakers` to suppress portrait work for a reusable or case-significant visible character.
- Preserve the seven review axes; extend Axis 3 and Axis 5 rather than adding an eighth axis.
- HPA-552 owns `.claude/skills/writing-analysis-scene/SKILL.md`; do not duplicate it here.
- Freeze `docs/stories_plan/chapter_1/chapter.md` at the start of each content-audit phase; do not rely on a permanent 16-file list.
- Include manifest-listed production analysis scenes automatically; exclude synthetic HPA-259 fixtures.
- Background variants need a concrete narrative/spatial function; there is no image-count quota.
- Priority A background findings are implemented; Priority B remains documented.
- Semantic findings are recorded before editing. Blocker/Important must close or be explicitly accepted with evidence; Minor/deferred stays visible.
- Do not alter culprit, case logic, evidence packages, unlock chains, scene order, reveal ladder, or sealed-reveal timing except for a narrowly accepted correction.

---

## File Structure

### Compiler and tests

- Modify `packages/scripts/compile-scenes/parser-common.ts` — add shared `parseOptionalLocalSpeakers`.
- Modify `packages/scripts/compile-scenes/parser-scene-header.ts` and tests — legacy optional-Summary integration.
- Modify `packages/scripts/compile-scenes/parser-analysis.ts` and tests — analysis required-Summary integration.
- Modify `packages/scripts/compile-scenes/types.ts` — add `ASTLocalSpeaker` and `localSpeakers` to all four AST scene types.
- Modify `packages/scripts/compile-scenes/parser-linear.ts` — propagate header local speakers.
- Modify `packages/scripts/compile-scenes/parser-investigation.ts` — propagate header local speakers.
- Modify `packages/scripts/compile-scenes/parser-interrogation.ts` — propagate header local speakers.
- Modify `packages/scripts/compile-scenes/assets/enrich.ts` and tests — strict speaker classification across legacy and analysis scenes.
- Modify focused compiler/emitter fixtures only as needed to prove `Local Speakers` is absent from runtime JSON.

### Skills

- Modify `.claude/skills/writing-detective-game-dialogue/SKILL.md`.
- Modify `.claude/skills/writing-investigation-scene/SKILL.md`.
- Modify `.claude/skills/writing-interrogation-scene/SKILL.md`.
- Modify `.claude/skills/reviewing-story-scenes/SKILL.md`.
- Modify `.claude/skills/subagent-driven-story-writing/SKILL.md`.
- Modify `.claude/skills/generating-lyra-image-assets/SKILL.md`.
- Do not create or modify HPA-552's dedicated analysis authoring skill unless that ticket has already landed and only a reference-to-base-rule correction is required.

### Chapter 1 content/assets

- Modify only manifest-listed Chapter 1 scene files with finding-backed speaker/narration/expression/background changes.
- Modify `static/assets/config/characters.yaml` for reusable portrait-worthy speakers discovered by the strict gate.
- Create/update Priority A background PNGs under `static/assets/backgrounds/chapter_1/**` only when accepted by the background audit.

### Evidence/audit artifacts

- Create `docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md`.
- Create `docs/stories_plan/chapter_1/background-variety-audit.md`.
- Create `docs/stories_plan/chapter_1/semantic-content-reaudit.md`.

---

### Task 1: Record honest RED semantic pressure scenarios

**Files:**
- Create: `docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md`
- Read: current writing/review/orchestrator skills, `static/assets/config/characters.yaml`, representative Chapter 1 scenes.

**Produces:** baseline evidence for the current skill gaps before the skill text changes.

- [ ] **Step 1: Create the scenario ledger**

Use this exact structure:

```markdown
# HPA-561 Story Scene Skill Pressure Scenarios

## Protocol

## Scenario 1: Narration fallback
### Exact prompt
### Baseline result
### Failure/rationalization observed
### GREEN acceptance
### GREEN result

## Scenario 2: Reusable visible speaker missing catalog contract
...

## Scenario 3: Prospective catalog-label drift
...

## Scenario 4: Bracket-only emotional transition
...

## Scenario 5: Analysis-scene inheritance
...

## Control 6: Calm standard expression remains valid
...

## Control 7: Intentional one-shot local speaker remains valid
...

## Final verification summary
```

- [ ] **Step 2: Run Scenario 1 against current skills**

Prompt a scene-closing conclusion that tempts `旁白`; record whether visible action/character interpretation is incorrectly narrated.

- [ ] **Step 3: Run Scenario 2**

Prompt a reusable visible speaker absent from `characters.yaml`; record whether the agent notices the missing reusable portrait/catalog contract rather than treating the speaker as anonymous.

- [ ] **Step 4: Run Scenario 3 without naming the expected label**

Prompt a known recurring character and require repository-source label selection; record whether the agent invents or drifts to an unregistered alias.

- [ ] **Step 5: Run Scenario 4 without naming the expected expression slug**

Prompt a meaningful emotional transition for a character that has an applicable non-standard slug; record whether the portrait remains implicitly flat.

- [ ] **Step 6: Run Scenario 5 with HPA-259-shaped analysis dialogue**

Use Intro, one board Result Dialogue, and Outro. Record whether current semantic review recognizes analysis dialogue as governed by the same narration/expression/speaker rules.

- [ ] **Step 7: Do not treat Controls 6–7 as required RED failures**

They are post-change false-positive controls.

- [ ] **Step 8: Commit baseline evidence**

```bash
git add docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md
git commit -m "test: record story scene semantic pressure behavior"
```

---

### Task 2: Parse `Local Speakers` across all four scene types

**Files:**
- Modify: `packages/scripts/compile-scenes/parser-common.ts`
- Modify: `packages/scripts/compile-scenes/parser-scene-header.ts`
- Test: `packages/scripts/compile-scenes/parser-scene-header.test.ts`
- Modify: `packages/scripts/compile-scenes/parser-analysis.ts`
- Test: `packages/scripts/compile-scenes/parser-analysis.test.ts`
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/parser-linear.ts`
- Modify: `packages/scripts/compile-scenes/parser-investigation.ts`
- Modify: `packages/scripts/compile-scenes/parser-interrogation.ts`

**Interfaces:**

```ts
export type ASTLocalSpeaker = Located<{ name: string }>;

export function parseOptionalLocalSpeakers(
  tokens: Token[],
  sourceFile: string,
  startIndex: number,
):
  | {
      ok: true;
      value: {
        localSpeakers: ASTLocalSpeaker[];
        nextTokenIndex: number;
      };
    }
  | { ok: false; error: CompileError };
```

Every `ASTLinearScene`, `ASTInvestigationScene`, `ASTInterrogationScene`, and `ASTAnalysisScene` gains:

```ts
localSpeakers: ASTLocalSpeaker[];
```

No emitted JSON type gains this field.

- [ ] **Step 1: Write failing legacy-header tests**

Cover:

- Summary followed by Local Speakers;
- Local Speakers immediately after H1 when Summary is omitted;
- duplicate Local Speakers key;
- misplaced Local Speakers later in the file;
- blank/empty member;
- duplicate member;
- leading/trailing comma;
- reserved `旁白`;
- source-line preservation.

- [ ] **Step 2: Write failing analysis-header tests**

Cover:

- required Summary followed by Local Speakers;
- Local Speakers without required Summary still fails with the existing analysis Summary diagnostic;
- duplicate/misplaced Local Speakers;
- the same list/member validation as legacy headers.

- [ ] **Step 3: Verify RED**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-scene-header.test.ts packages/scripts/compile-scenes/parser-analysis.test.ts
```

Expected: new Local Speakers cases fail because the helper/AST fields do not exist yet; existing HPA-259 analysis Summary tests remain unchanged.

- [ ] **Step 4: Implement the narrow shared parser helper**

`parseOptionalLocalSpeakers()` parses only the immediate optional metadata field and returns source-located names plus the next token index. It must not parse Summary, board metadata, asset config, or semantic alias identity.

Use focused diagnostics:

```text
sceneLocalSpeakersDuplicate
sceneLocalSpeakersMisplaced
sceneLocalSpeakerEmpty
sceneLocalSpeakerDuplicate
sceneLocalSpeakerReserved
```

- [ ] **Step 5: Integrate legacy header path**

`parseSceneHeader()` keeps its current optional Summary behavior and calls `parseOptionalLocalSpeakers()` at the first token after the optional Summary.

- [ ] **Step 6: Integrate analysis header path**

`parseAnalysisHeader()` keeps HPA-259's required Summary logic and calls the same helper immediately after the required Summary token.

- [ ] **Step 7: Propagate local speakers to all four ASTs**

Add `localSpeakers` to `types.ts`; set it in linear/investigation/interrogation parsers from the shared legacy header result and in `parseAnalysisScene()` from the analysis header result.

- [ ] **Step 8: Run focused tests and type checking**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-scene-header.test.ts packages/scripts/compile-scenes/parser-analysis.test.ts
bun run check:scripts
```

Expected: PASS; existing analysis required-Summary behavior remains intact.

- [ ] **Step 9: Commit**

```bash
git add packages/scripts/compile-scenes/parser-common.ts \
  packages/scripts/compile-scenes/parser-scene-header.ts \
  packages/scripts/compile-scenes/parser-scene-header.test.ts \
  packages/scripts/compile-scenes/parser-analysis.ts \
  packages/scripts/compile-scenes/parser-analysis.test.ts \
  packages/scripts/compile-scenes/types.ts \
  packages/scripts/compile-scenes/parser-linear.ts \
  packages/scripts/compile-scenes/parser-investigation.ts \
  packages/scripts/compile-scenes/parser-interrogation.ts
git commit -m "feat: parse local speakers across scene types"
```

---

### Task 3: Enforce durable speaker classification in asset enrichment

**Files:**
- Modify: `packages/scripts/compile-scenes/assets/enrich.ts`
- Test: `packages/scripts/compile-scenes/assets/enrich.test.ts`
- Modify: focused fixtures only where runtime-omission proof needs them.

**Consumes:** `scene.ast.localSpeakers` for both `SceneRecord` and `AnalysisSceneRecord`.

**Produces:** one strict speaker-membership path reused by legacy dialogue and HPA-259 analysis Intro/Result/Outro traversal.

- [ ] **Step 1: Write failing enrichment tests**

Cover:

- undeclared unknown legacy speaker without expression -> `assetUnknownSpeaker`;
- undeclared unknown analysis Intro speaker -> `assetUnknownSpeaker`;
- undeclared unknown analysis Result Dialogue speaker -> `assetUnknownSpeaker`;
- undeclared unknown analysis Outro speaker -> `assetUnknownSpeaker`;
- reserved `旁白` remains allowed;
- declared local compiles to `portrait: null`;
- declared local with expression -> `assetLocalSpeakerExpression`;
- cataloged speaker remains existing portrait behavior;
- catalog/local overlap -> `assetLocalSpeakerCatalogOverlap`;
- assets-disabled path keeps membership unenforced.

- [ ] **Step 2: Verify RED**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/assets/enrich.test.ts
```

- [ ] **Step 3: Extend enrichment context**

Add the current scene's local-speaker name set to `EnrichContext`. Both `enrichScene()` and HPA-259's existing `enrichAnalysisScene()` populate it from their AST.

- [ ] **Step 4: Validate catalog overlap once per scene**

Before enriching dialogue, compare local declarations with configured `displayNames`. Emit `assetLocalSpeakerCatalogOverlap` at the Local Speakers source line for every overlap.

- [ ] **Step 5: Replace silent unknown fallback in `enrichLine()`**

Classify in this exact order:

```text
cataloged speaker
-> reserved 旁白
-> declared local
-> assetUnknownSpeaker
```

Declared local always resolves to `portrait: null` and may not have an expression.

- [ ] **Step 6: Reuse analysis traversal unchanged**

Do not add a second loop for analysis. Verify `enrichAnalysisScene()` continues to call common dialogue enrichment for Intro, every board Result Dialogue, and Outro.

- [ ] **Step 7: Prove compiler-only runtime boundary**

Add focused assertions that emitted linear/investigation/interrogation/analysis JSON contains enriched portraits as before but no `localSpeakers` property.

- [ ] **Step 8: Run tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/assets/enrich.test.ts
bun run test:scripts
bun run check:scripts
```

- [ ] **Step 9: Commit**

```bash
git add packages/scripts/compile-scenes/assets/enrich.ts \
  packages/scripts/compile-scenes/assets/enrich.test.ts \
  packages/scripts/__fixtures__
git commit -m "feat: enforce durable scene speaker contracts"
```

---

### Task 4: Migrate production Chapter 1 speaker and portrait contracts

**Files:**
- Modify: only manifest-listed Chapter 1 scenes that require local declarations/label corrections.
- Modify: `static/assets/config/characters.yaml` for reusable portrait-worthy speakers.
- Generate missing portraits only through the established image-asset workflow when accepted.

- [ ] **Step 1: Freeze the current production manifest**

Read `docs/stories_plan/chapter_1/chapter.md` and record the exact current ordered scene list in the work notes for this task. Do not assume the historical 16-file list.

- [ ] **Step 2: Run compilation and capture all speaker errors**

```bash
bun run scenes:compile
```

- [ ] **Step 3: Classify every speaker diagnostic**

Choose exactly one:

```text
cataloged reusable
reusable but missing catalog/portrait contract
genuine one-shot local
typo/incorrect alias requiring source correction
reserved 旁白
```

Do not bulk-copy unknown labels into `Local Speakers` merely to restore green compilation.

- [ ] **Step 4: Apply known Chapter 1 direction**

- anonymous commuters in `scene_p0.md` are strong local candidates;
- stationery-shop `店主` is not Rain Bell `店長高瀨`;
- visible case-significant 增田圭 gets a reusable catalog/portrait contract rather than a local declaration.

- [ ] **Step 5: Include production analysis automatically if present**

If the frozen manifest contains `analysis_scene_*.md`, classify speakers in Intro, every Result Dialogue, and Outro using the same rules.

- [ ] **Step 6: Keep missing reusable portrait assets visible**

Generate accepted portrait work through `generating-lyra-image-assets` or keep an explicit unresolved asset warning/work item; never downgrade a reusable speaker to local to suppress the warning.

- [ ] **Step 7: Compile until membership is green**

```bash
bun run scenes:compile
```

Expected: no undeclared-unknown/local-expression/catalog-overlap errors for the production Chapter 1 corpus.

- [ ] **Step 8: Commit metadata/catalog separately from generated art**

```bash
git add docs/stories_plan/chapter_1 static/assets/config/characters.yaml
git commit -m "docs: declare Chapter 1 speaker contracts"
```

---

### Task 5: Harden writing, semantic review, and image-generation skills

**Files:**
- Modify: `.claude/skills/writing-detective-game-dialogue/SKILL.md`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`
- Modify: `.claude/skills/reviewing-story-scenes/SKILL.md`
- Modify: `.claude/skills/subagent-driven-story-writing/SKILL.md`
- Modify: `.claude/skills/generating-lyra-image-assets/SKILL.md`
- Update: scenario artifact from Task 1.

- [ ] **Step 1: Correct contradictory narration examples**

Rewrite examples so visible movement, architecture, atmosphere, body discovery, and object state use bracketed directions; preserve clearly intentional voiceover/time/location transitions as `旁白`.

- [ ] **Step 2: Add speaker-contract decision guidance**

Teach:

```text
recurring/case-significant visible speaker -> catalog
true one-shot faceless speaker -> Local Speakers
旁白 -> reserved
unresolved reusable/local decision -> stop/escalate
never use Local Speakers only to suppress portrait work
```

- [ ] **Step 3: Add catalog-bounded expression choreography**

Teach that brackets do not choose portrait state, writers may use only configured slugs, meaningful transitions should use a suitable available slug, line-by-line flicker is undesirable, and calm/standard-only sequences remain valid.

- [ ] **Step 4: Add background-purpose guidance to the base skill**

When a background prompt is needed, author the narrative/spatial function plus relevant camera angle/distance, focal area, continuity anchors, lighting/weather/occupancy, and UI-safe composition. Do not create variants for dialogue-count reasons.

- [ ] **Step 5: Add investigation-specific background guidance**

Sibling sub-locations should be visually distinct while preserving believable adjacency, hotspot/source readability, visible floor/ground for standees, and lower-body clearance.

- [ ] **Step 6: Add interrogation-specific background guidance**

A new phase background is justified only when the visible environmental/dramatic state materially changes.

- [ ] **Step 7: Extend Axis 3 and Axis 5**

Axis 3 becomes `Voice, style, narration & expression`. Axis 5 keeps coverage/spatial checks first, then continuity and purposeful variety. Semantic review must recognize all four scene types; for analysis it reviews Intro, every Result Dialogue, and Outro.

- [ ] **Step 8: Harden image-generation continuity rules**

Before generating/regenerating a background, inspect sibling assets for the same location family and record:

```text
continuity anchors
intended camera/composition delta
narrative/spatial function
```

Preserve entrances, windows, fixed furniture, geometry, case props, palette/materials, and adjacency.

- [ ] **Step 9: Simplify orchestrator handoff**

Remove temporary cast-table relay. Scene Markdown is the durable Local Speakers source; unresolved reusable portrait needs are escalated explicitly.

- [ ] **Step 10: Respect HPA-552 boundary**

Do not create the dedicated analysis authoring skill. If it has landed independently, ensure it references/inherits the hardened base rules rather than copying contradictory variants.

- [ ] **Step 11: Run GREEN scenarios and controls**

Rerun Scenarios 1–5 plus Controls 6–7 and record results in the scenario artifact.

- [ ] **Step 12: Commit**

```bash
git add .claude/skills/writing-detective-game-dialogue/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md \
  .claude/skills/reviewing-story-scenes/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/generating-lyra-image-assets/SKILL.md \
  docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md
git commit -m "docs: harden scene semantic and visual review"
```

---

### Task 6: Freeze the production manifest and audit background variety

**Files:**
- Create: `docs/stories_plan/chapter_1/background-variety-audit.md`
- Read: frozen manifest-listed scene files.
- Read: `static/assets/backgrounds/chapter_1/**` and `static/assets/config/policy.yaml`.

- [ ] **Step 1: Freeze the exact manifest**

Copy the ordered contents of `docs/stories_plan/chapter_1/chapter.md` into the audit with audit date/ruleset. Classify each entry as linear, investigation, interrogation, or analysis.

- [ ] **Step 2: Enumerate every player-visible background cue**

Cover:

```text
linear scene tags
investigation sub-location/dialogue cues
interrogation phase/dialogue cues
production analysis Intro/Result/Outro scene tags when present
```

Exclude synthetic HPA-259 fixtures.

- [ ] **Step 3: Compile and record asset identities**

```bash
bun run scenes:compile
```

For each cue, record compiled asset ID/path or missing-asset warning.

- [ ] **Step 4: Create one audit row per cue**

Use:

```markdown
| Scene/source | Asset ID/path | Location family | Current function | Continuity anchors | Variety finding | Decision | Priority | Proposed function | Disposition |
|---|---|---|---|---|---|---|---|---|---|
```

- [ ] **Step 5: Group cues by recurring physical location**

Review each family together for entrances, windows, furniture, geometry, corridor direction, case-significant props, palette/materials, camera distance/angle, focal emphasis, lighting/weather/occupancy, and adjacency.

- [ ] **Step 6: Assign one decision and priority to every cue**

Allowed decisions:

```text
keep
prompt-adjust
regenerate
add-variant
```

Priority A only when the issue affects comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, meaningful state change, or canon/continuity. Otherwise Priority B.

- [ ] **Step 7: Run the same-view false-positive control**

Identify at least one uninterrupted scene where keeping the same view is narratively correct; record `keep` and why changing it would be gratuitous churn.

- [ ] **Step 8: Commit the audit before changing prompts/assets**

```bash
git add docs/stories_plan/chapter_1/background-variety-audit.md
git commit -m "docs: audit Chapter 1 background variety"
```

---

### Task 7: Implement accepted Priority A background changes

**Files:**
- Modify: only source scene prompts/cues named by Priority A rows.
- Modify/Create: only accepted background PNGs under `static/assets/backgrounds/chapter_1/**`.
- Update: `docs/stories_plan/chapter_1/background-variety-audit.md` dispositions.

- [ ] **Step 1: Write the accepted visual delta before editing**

For each Priority A row, specify the concrete narrative/spatial function, preserved continuity anchors, intended camera/composition change, and any lighting/weather/occupancy change.

- [ ] **Step 2: Edit only the corresponding authored prompt/cue**

Do not add scene tags solely to increase image count.

- [ ] **Step 3: Compile and record final asset IDs/paths**

```bash
bun run scenes:compile
```

- [ ] **Step 4: Commit authored prompt/cue changes separately**

```bash
git add docs/stories_plan/chapter_1
git commit -m "docs: improve Priority A Chapter 1 background cues"
```

- [ ] **Step 5: Generate/regenerate only accepted Priority A PNGs**

Load `.claude/skills/generating-lyra-image-assets/SKILL.md` and `static/assets/config/policy.yaml`; inspect sibling same-location assets before generation.

- [ ] **Step 6: Normalize and inspect final files**

Every touched background must be opaque `1920x1080`. Review each complete location family together and reject any variant that implies a different physical place.

- [ ] **Step 7: Update audit dispositions and commit art**

```bash
git add static/assets/backgrounds/chapter_1 docs/stories_plan/chapter_1/background-variety-audit.md
git commit -m "feat: add Priority A Chapter 1 background variants"
```

Priority B remains documented and ungenerated.

---

### Task 8: Run the full manifest semantic content re-audit

**Files:**
- Create: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- Read: frozen manifest-listed scene files, `characters.yaml`, compiled scene output, `background-variety-audit.md`.

- [ ] **Step 1: Freeze the current production manifest again**

Copy the exact ordered `chapter.md` scene list into `semantic-content-reaudit.md`. This is a fresh snapshot because HPA-265 or other production content may have landed since Task 6.

- [ ] **Step 2: Create the findings ledger**

Use:

```markdown
| ID | Severity | Path:line | Scene/block | Rule area | Offending text | Authority | Why it matters | Remediation | Disposition |
|---|---|---|---|---|---|---|---|---|---|
```

Initialize counters as pending.

- [ ] **Step 3: Run structural speaker/portrait baseline checks**

```bash
bun run scenes:compile
```

For every scene type, verify each speaker is cataloged, reserved `旁白`, or declared local and compiled portrait behavior matches intent. If production analysis exists, cover Intro, every Result Dialogue, and Outro.

- [ ] **Step 4: Audit narration ownership**

Enumerate every `旁白` line across all dialogue-bearing containers. Classify each as allowed transition/unavailable-information/intentional voiceover or as visible action/atmosphere/object state/present-character conclusion needing reassignment.

- [ ] **Step 5: Audit expression choreography**

Build the actual per-character slug reference from `static/assets/config/characters.yaml`. Mark Important only when a suitable configured slug is ignored across a material transition or an authored expression contradicts the visible state. Standard-only/calm sequences are Minor or no finding.

- [ ] **Step 6: Cross-check background-variety integration**

Verify every applicable production scene is represented in `background-variety-audit.md`, accepted Priority A changes are integrated, continuity remains coherent, and Priority B remains deferred.

- [ ] **Step 7: Record every finding before editing**

Severity policy:

```text
Blocker = material identity/canon/viewpoint/player-understanding failure
Important = unresolved visible reusable portrait treatment, catalog-label drift,
            major narrator fallback, meaningful ignored configured expression,
            or unimplemented accepted Priority A background issue
Minor/deferred = polish without material comprehension/identity/canon/pacing impact
```

- [ ] **Step 8: Commit the complete initial ledger before fixes**

```bash
git add docs/stories_plan/chapter_1/semantic-content-reaudit.md
git commit -m "docs: record Chapter 1 semantic re-audit findings"
```

---

### Task 9: Fix every Blocker/Important finding and re-review affected scenes

**Files:**
- Modify: only source/catalog/assets tied to recorded findings.
- Update: `docs/stories_plan/chapter_1/semantic-content-reaudit.md` after each disposition.

- [ ] **Step 1: Fix identity/speaker-contract findings first**

Use the smallest correction: correct label, add/remove Local Speakers entry, promote reusable character to catalog/portrait contract, or explicitly track missing asset work.

- [ ] **Step 2: Fix narration ownership findings**

Use:

```text
visible information -> bracketed direction
present-character interpretation/reaction -> character dialogue
true transition/unavailable information/intentional voiceover -> keep 旁白
```

- [ ] **Step 3: Fix expression findings**

Use existing configured slugs unless a separately accepted asset addition is necessary. Do not add expression churn line-by-line.

- [ ] **Step 4: Fix accepted Priority A background integration gaps only**

Do not convert Priority B polish into mandatory scope.

- [ ] **Step 5: Update each disposition immediately**

Every fixed/accepted finding records the exact resolution and evidence.

- [ ] **Step 6: Run compilation after each logical batch**

```bash
bun run scenes:compile
```

- [ ] **Step 7: Re-run at least Axis 3 and Axis 5 on every changed scene**

Any newly discovered Blocker/Important must be added to the ledger before further editing.

- [ ] **Step 8: Commit focused fix batches**

Use separate commits where practical for speaker identity, narration/expression, and visual changes rather than one broad rewrite commit.

---

### Task 10: Final HPA-561 verification gate

- [ ] **Step 1: Map acceptance criteria to evidence**

Confirm coverage exists for:

- legacy + analysis Local Speakers parser tests;
- enrichment tests including analysis Intro/Result/Outro;
- runtime-omission proof;
- RED/GREEN skill scenarios and false-positive controls;
- complete background audit + Priority A dispositions;
- complete semantic re-audit + final counters.

- [ ] **Step 2: Run full regression commands**

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify background asset dimensions**

Scan every touched Chapter 1 background PNG and confirm exact opaque `1920x1080` output.

- [ ] **Step 4: Run final standalone semantic review over the frozen manifest**

The reviewer must recognize linear, investigation, interrogation, and analysis scenes without an ephemeral cast table.

If production analysis exists, explicitly confirm Intro, every Result Dialogue, and Outro were reviewed and its background cues were included in the visual audit.

- [ ] **Step 5: Set final semantic audit counters**

```text
Open Blockers: 0
Open Important: 0
Minor/deferred: <explicit ledger count>
```

- [ ] **Step 6: Verify scope boundary**

Inspect changed story files and confirm no unrelated culprit, timeline, evidence-package, unlock-chain, scene-order, reveal-ladder, or sealed-reveal changes.

- [ ] **Step 7: Verify runtime boundary**

Confirm `Local Speakers` appears only in authored/compiler AST surfaces, HPA-259 analysis JSON remains valid, and no Rust/Svelte/runtime type was added for this metadata.

- [ ] **Step 8: Inspect the final diff**

```bash
git diff --name-only main...HEAD
```

Explain every changed path; remove unrelated changes before review.

## Plan Self-Review

- **Spec coverage:** durable speaker contract, four-scene support, semantic review, background variety, manifest-driven migration, and full Chapter 1 re-audit each have explicit tasks.
- **HPA-259 reuse:** analysis parsing/enrichment is extended, not rebuilt.
- **Header behavior:** legacy optional Summary and analysis required Summary remain distinct.
- **Runtime boundary:** `Local Speakers` remains compiler-only.
- **YAGNI:** no generic header framework, semantic classifier, image-count quota, or extra review axis.
- **Content safety:** audits are manifest-driven, findings precede edits, Priority B/Minor remain deferred, and broad Chapter 1 rewriting is excluded.
- **Ticket boundaries:** HPA-552 owns the dedicated analysis authoring skill; HPA-260 runtime work remains out of scope.
