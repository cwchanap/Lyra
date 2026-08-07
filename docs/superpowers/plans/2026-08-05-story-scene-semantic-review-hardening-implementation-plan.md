# HPA-561 Durable Scene Asset Contracts and Semantic Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the silent unknown-speaker fallback through the existing global character catalog, harden scene semantic/visual review, and apply the new rules to the production Chapter 1 manifest through mechanically assisted background and semantic acceptance passes.

**Architecture:** Reuse the post-HPA-259 compiler. Do not add scene metadata or AST fields. Harden the shared writing/review skills first, then make `enrichLine()` reject every uncatalogued speaker while using existing `portraitMode: "none"` for intentional portraitless/system speakers. Add one small background-cue audit script for compiler-owned inventory data, then use the existing seven-axis `reviewing-story-scenes` skill as the only semantic review authority.

**Tech Stack:** TypeScript scene compiler, Vitest, Markdown story sources, YAML asset catalog/policy, PNG assets, Claude skills, Bun scripts.

## Global Constraints

- HPA-259 is merged and is the implementation baseline.
- Do not add `Local Speakers`, `ASTLocalSpeaker`, parser metadata, or a second speaker registry.
- Reuse `portraitMode: "none"` for every intentional portraitless/system speaker.
- Reuse `enrichAnalysisScene()` for analysis Intro, board Result Dialogue, and Outro.
- Unknown speakers fail only in asset-enabled compilation, matching the existing enrichment boundary.
- Do not infer semantic aliases in the compiler.
- Keep one global `characters.yaml` display-name namespace.
- Harden skills before production migration consumes the new guidance.
- Preserve the seven review axes and existing review severity/verdict format.
- HPA-552 owns `.claude/skills/writing-analysis-scene/SKILL.md`; do not duplicate it.
- Freeze the current production `chapter.md` when each audit phase starts; do not hard-code a permanent 16-file list.
- Include manifest-listed production analysis scenes automatically; exclude synthetic HPA-259 fixtures.
- Background variants require a concrete narrative/spatial function; there is no image-count quota.
- Priority A background findings are implemented; Priority B remains documented.
- Do not alter culprit, case logic, evidence packages, unlock chains, scene order, reveal ladder, or sealed-reveal timing except for a narrowly accepted correction.

## Delivery shape

Execute HPA-561 as two implementation PRs under the same Linear ticket.

### PR A — contract and tooling

Tasks 1–5:

- focused skill pressure tests;
- writing/review/orchestrator hardening;
- strict existing-catalog enforcement plus the minimal `characters.yaml` migration required to keep production compilation green;
- background-cue audit script and tests.

PR A contains no broad scene prose rewrite and no background art regeneration. It may temporarily expose only the explicitly expected missing portrait-file warnings for the newly portrait-bearing `店主` and `增田圭` catalog entries; PR B resolves those asset warnings.

### PR B — Chapter 1 content and visual acceptance

Tasks 6–9 after PR A lands:

- generate accepted missing portraits;
- run the background audit and implement Priority A changes;
- run the existing seven-axis semantic review, save its consolidated report, and fix Blocker/Important findings;
- rerun review to `SHIP` and run the final regression gate.

---

## File Structure

### PR A — skills/review

- Modify `.claude/skills/writing-detective-game-dialogue/SKILL.md`.
- Modify `.claude/skills/writing-investigation-scene/SKILL.md`.
- Modify `.claude/skills/writing-interrogation-scene/SKILL.md`.
- Modify `.claude/skills/reviewing-story-scenes/SKILL.md`.
- Modify `.claude/skills/subagent-driven-story-writing/SKILL.md`.
- Modify `.claude/skills/generating-lyra-image-assets/SKILL.md`.
- Create `docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md`.

### PR A — compiler/catalog

- Modify `packages/scripts/compile-scenes/assets/enrich.ts`.
- Modify `packages/scripts/compile-scenes/assets/enrich.test.ts`.
- Modify `static/assets/config/characters.yaml`.

### PR A — background audit tooling

- Create `packages/scripts/compile-scenes/background-cues-audit.ts`.
- Create `packages/scripts/compile-scenes/background-cues-audit.test.ts`.
- Modify `packages/scripts/package.json`.
- Modify root `package.json`.

### PR B — content/assets/evidence

- Create `docs/stories_plan/chapter_1/background-variety-audit.md`.
- Create `docs/stories_plan/chapter_1/semantic-content-reaudit.md`.
- Modify only finding-backed Chapter 1 scene files.
- Create/update accepted portrait PNGs under `static/assets/portraits/**`.
- Create/update accepted Priority A background PNGs under `static/assets/backgrounds/chapter_1/**`.

---

### Task 1: Record only the three genuine RED skill scenarios

**Files:**
- Create: `docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md`
- Read: current writing/review skills, `characters.yaml`, representative Chapter 1 scenes.

**Produces:** honest baseline evidence before editing skill text.

- [ ] **Step 1: Create the scenario document**

Use:

```markdown
# HPA-561 Story Scene Skill Pressure Scenarios

## Protocol

## RED 1 — Narration fallback
### Exact prompt
### Baseline result
### Failure/rationalization
### GREEN acceptance
### GREEN result

## RED 2 — Reusable visible speaker missing catalog contract
...

## RED 3 — Bracket-only emotional transition
...

## Control — Calm standard scene
### Exact prompt
### GREEN result

## Spot check — Catalog-label drift
### Exact prompt
### GREEN result

## Spot check — Analysis inheritance
### Exact prompt
### GREEN result
```

- [ ] **Step 2: Run RED 1 — narration fallback**

Exact pressure:

```text
Using the current Lyra dialogue-writing skill, draft a short scene ending in which
an on-screen detective looks at the evidence, physically closes the folder, and
states their own conclusion. Preserve the current repo format and do not add new
characters. Return only authored scene Markdown.
```

GREEN acceptance: visible action is bracketed; the detective owns the conclusion; `旁白` is not used as a generic action/conclusion fallback.

- [ ] **Step 3: Run RED 2 — reusable visible speaker missing catalog contract**

Exact pressure:

```text
Using the current Lyra dialogue-writing skill, draft a scene featuring a named,
visible, case-significant witness who is present for multiple exchanges but does
not yet exist in characters.yaml. Use repository sources. Return authored scene
Markdown plus any required asset/catalog escalation.
```

GREEN acceptance: the writer explicitly requires a global character-catalog decision; it does not silently rely on portraitless compilation.

- [ ] **Step 4: Run RED 3 — bracket-only emotional transition**

Choose a current catalog character with an available non-standard slug and use:

```text
Draft a short exchange where the character visibly moves from calm to pressured.
Use repository-defined expressions only. Return authored scene Markdown.
```

GREEN acceptance: meaningful portrait transition is authored when the available slug fits; brackets alone are not treated as portrait state.

- [ ] **Step 5: Record baseline results truthfully**

If a baseline already passes, record that rather than inventing RED evidence.

- [ ] **Step 6: Commit baseline evidence**

```bash
git add docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md
git commit -m "test: record focused story skill pressure scenarios"
```

---

### Task 2: Harden skills before any production migration

**Files:** all six skill files listed under PR A.

**Produces:** the authoring/review rules that later migration and audits consume.

- [ ] **Step 1: Correct narration contradictions in the base dialogue skill**

Use this ownership table as the authoritative rule:

```markdown
| Meaning | Authored form |
|---|---|
| Visible movement, body language, atmosphere, room/object state | `[ ... ]` |
| Present-character conclusion, judgment, interpretation, reaction | character dialogue |
| Time/location transition, unavailable information, intentional voiceover | `**旁白**：...` |
```

Rewrite the warehouse example so visible action/architecture/body discovery is bracketed. Keep intentional opening/closing voiceover explicitly labeled as such.

- [ ] **Step 2: Replace local-vs-catalog guidance with one-catalog guidance**

Teach:

```text
reusable or visually important speaker -> characters.yaml portraitMode: portrait
intentional faceless/system/very minor speaker -> characters.yaml portraitMode: none
unknown/unresolved identity -> stop and resolve catalog label/mode
never rely on an uncatalogued speaker compiling portraitless
```

- [ ] **Step 3: Add catalog-bounded expression choreography**

Teach:

```text
bracketed emotion does not select a portrait
use configured slugs only
switch on meaningful state transitions
avoid line-by-line flicker
standard-only / calm scenes remain valid
```

- [ ] **Step 4: Add purposeful background-prompt guidance**

For each materially new view, prompt for:

```text
narrative/spatial function
camera angle and distance
focal area
stable continuity anchors
lighting/weather/occupancy state
UI-safe lower composition
```

Never create a variant solely to increase image count.

- [ ] **Step 5: Extend investigation/interrogation guidance**

Investigation: sibling sub-locations can vary in angle/focus but must preserve adjacency, hotspot readability, visible floor/standee clearance, and case-significant props.

Interrogation: a new phase background is justified only when visible environmental/dramatic state materially changes.

- [ ] **Step 6: Extend Axis 3 in `reviewing-story-scenes`**

Rename to `Voice, style, narration & expression` and add the narration/expression rules above. Apply to all four scene types; for analysis review Intro, every Result Dialogue, and Outro.

- [ ] **Step 7: Extend Axis 5 without changing its severity/report format**

Keep existing completeness/compiled-ID/file checks, then add:

```text
catalog/portrait appropriateness
spatial usability
same-location continuity
purposeful variation
same-view false-positive control
```

Do not create a second severity vocabulary or findings ledger.

- [ ] **Step 8: Harden image-generation continuity**

Require inspection of sibling same-location assets before generation and record stable anchors plus intended delta. Keep final policy-canvas verification.

- [ ] **Step 9: Simplify orchestrator handoff**

Pass source paths/catalog escalation rules; do not relay an ephemeral cast table.

- [ ] **Step 10: Respect HPA-552 ownership**

Do not create the dedicated analysis authoring skill. If HPA-552 has landed independently, only ensure it references/inherits the hardened base dialogue rules.

- [ ] **Step 11: Run post-change verification**

Rerun RED 1–3 as GREEN, then run:

**Calm control**

```text
Draft a calm administrative exchange for a character whose current scene does
not justify an expression change. Use repository expressions only.
```

Acceptance: remaining `standard` is allowed.

**Catalog-label drift spot check**

```text
Draft a Rain Bell manager exchange using repository sources. Do not tell the
writer which display label to choose.
```

Acceptance: repository catalog/roster label is used; no new alias is invented.

**Analysis inheritance spot check**

```text
Review an HPA-259-shaped analysis scene containing Intro, Result Dialogue, and
Outro for narration/expression/portrait/background issues using the hardened
review skill.
```

Acceptance: all three analysis dialogue carriers are covered.

- [ ] **Step 12: Commit**

```bash
git add .claude/skills/writing-detective-game-dialogue/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md \
  .claude/skills/reviewing-story-scenes/SKILL.md \
  .claude/skills/subagent-driven-story-writing/SKILL.md \
  .claude/skills/generating-lyra-image-assets/SKILL.md \
  docs/superpowers/specs/2026-08-05-story-scene-semantic-review-hardening-scenarios.md
git commit -m "docs: harden story semantic and visual review"
```

---

### Task 3: Delete the silent unknown-speaker fallback and migrate the global catalog

**Files:**
- Modify: `packages/scripts/compile-scenes/assets/enrich.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.test.ts`
- Modify: `static/assets/config/characters.yaml`

**Consumes:** hardened speaker/portrait guidance from Task 2.

**Produces:** one strict global catalog contract; no parser/AST changes.

- [ ] **Step 1: Add a failing test for an unknown speaker without expression**

Add beside the existing no-portrait tests:

```ts
it("errors for unknown speaker without expression", () => {
  const scenes = [
    linearScene([
      {
        kind: "line",
        speaker: "未登錄人物",
        expression: null,
        portrait: null,
        text: "hi",
      },
    ]),
  ];

  const result = enrichScenesWithAssets({ scenes, config: config() });

  expect(result.errors.map((error) => error.code)).toContain(
    "assetUnknownSpeaker",
  );
});
```

- [ ] **Step 2: Add strict-gate coverage for analysis dialogue carriers**

Construct one `ASTAnalysisScene` containing an unknown line in each carrier in separate table cases:

```ts
const cases = ["intro", "resultDialogue", "outro"] as const;
```

For every case, call `enrichScenesWithAssets({ scenes: [], analysisScenes: [scene], config: config() })` and assert `assetUnknownSpeaker`.

This proves HPA-259's existing `enrichAnalysisScene()` traversal is sufficient; do not add another walker.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/assets/enrich.test.ts
```

Expected: the new unknown/no-expression tests fail because current `enrichLine()` silently returns `portrait: null`.

- [ ] **Step 4: Delete only the silent fallback**

Replace the current unknown-speaker branch with:

```ts
const character = context.config.characters.byDisplayName.get(item.speaker);
if (!character) {
  context.errors.push(
    compileError(
      context.scene.ast.sourceFile,
      context.scene.ast.line,
      "assetUnknownSpeaker",
      `Unknown speaker "${item.speaker}" in asset-enabled scene.`,
    ),
  );
  return { ...item, portrait: null };
}
```

Keep the existing `portraitMode === "none"` and `assetExpressionOnNoPortraitSpeaker` path unchanged.

- [ ] **Step 5: Add the intentional no-portrait catalog entries**

Add entries with empty expressions:

```yaml
  - id: narrator
    displayNames: ["旁白"]
    portraitMode: none
    visualPrompt: null
    referenceAssetId: null
    expressions: {}

  - id: office_worker
    displayNames: ["上班族"]
    portraitMode: none
    visualPrompt: null
    referenceAssetId: null
    expressions: {}

  - id: passerby_a
    displayNames: ["路人甲"]
    portraitMode: none
    visualPrompt: null
    referenceAssetId: null
    expressions: {}

  - id: passerby_b
    displayNames: ["路人乙"]
    portraitMode: none
    visualPrompt: null
    referenceAssetId: null
    expressions: {}

  - id: passerby_c
    displayNames: ["路人丙"]
    portraitMode: none
    visualPrompt: null
    referenceAssetId: null
    expressions: {}

  - id: generic_student
    displayNames: ["學生"]
    portraitMode: none
    visualPrompt: null
    referenceAssetId: null
    expressions: {}
```

- [ ] **Step 6: Add the explicit Scene P1 `店主` portrait contract**

Use:

```yaml
  - id: stationery_owner
    displayNames: ["店主"]
    portraitMode: portrait
    visualPrompt: >
      Middle-aged Japanese woman who owns a small neighborhood stationery and
      copy shop, practical everyday blouse with a dark work apron, hair tied
      back simply, ordinary local-shop presence, firm and slightly stubborn
      working demeanor.
    referenceAssetId: null
    expressions:
      standard:
        prompt: firm skeptical shopkeeper expression, practical and self-assured
      flustered:
        prompt: embarrassed defensive expression after realizing the receipt was misread
```

Do not alias this to `店長高瀨`.

- [ ] **Step 7: Add the `增田圭` portrait contract**

Add `id: masuda_kei`, `displayNames: ["增田圭"]`, `portraitMode: portrait`, a canonical visual prompt derived from `docs/stories_plan/characters.md`, and a `standard` expression matching his ordinary Scene P2 presentation. Do not invent later-chapter sealed traits.

- [ ] **Step 8: Run focused tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/assets/enrich.test.ts
bun run check:scripts
```

Expected: PASS.

- [ ] **Step 9: Run production compilation**

```bash
bun run scenes:compile
```

Expected:

- no `assetUnknownSpeaker` errors for the frozen current Chapter 1 corpus;
- no expression-on-no-portrait errors for `旁白`, commuters, or `學生`;
- only the newly expected portrait-file warnings for `stationery_owner` and `masuda_kei` may remain from this task.

If additional unknown labels appear because the manifest changed, classify them using Task 2 guidance; do not weaken the compiler.

- [ ] **Step 10: Commit**

```bash
git add packages/scripts/compile-scenes/assets/enrich.ts \
  packages/scripts/compile-scenes/assets/enrich.test.ts \
  static/assets/config/characters.yaml
git commit -m "feat: require all scene speakers in character catalog"
```

---

### Task 4: Add mechanical background-cue audit tooling

**Files:**
- Create: `packages/scripts/compile-scenes/background-cues-audit.ts`
- Create: `packages/scripts/compile-scenes/background-cues-audit.test.ts`
- Modify: `packages/scripts/package.json`
- Modify: root `package.json`

**Produces:** compiler-owned background inventory and a mechanical report-coverage check. Artistic classification remains outside the script.

- [ ] **Step 1: Define the audit result**

```ts
export type BackgroundCueAuditItem = {
  cueKey: string;
  sceneFile: string;
  sceneType: "linear" | "investigation" | "interrogation" | "analysis";
  cuePath: string;
  backgroundAssetId: string | null;
  expectedPath: string | null;
  fileMissing: boolean;
};

export type BackgroundCueAuditProblem = {
  source: string;
  kind: "manifestRead" | "manifestParse" | "compiledSceneRead" | "assetManifestRead";
  message: string;
};

export type BackgroundCueAuditResult = {
  items: BackgroundCueAuditItem[];
  problems: BackgroundCueAuditProblem[];
};
```

- [ ] **Step 2: Implement deterministic cue enumeration from compiled output**

The command first requires a successful `bun run scenes:compile`, then reads:

```text
docs/stories_plan/chapter_1/chapter.md
apps/game/src-tauri/resources/scenes/chapter_1/<scene>.json
apps/game/src-tauri/resources/assets/manifest.json
```

For every manifest-listed emitted scene, recursively walk JSON objects/arrays. Whenever an object owns a `backgroundAssetId` property, emit one occurrence row even when multiple occurrences reuse the same asset ID.

Use a JSON-pointer-like `cuePath` such as:

```text
/queue/0
/intro/0
/sublocations/2
/phases/1
/boards/0/resultDialogue/0
```

Set:

```ts
cueKey = `${sceneFile}::${cuePath}`;
```

Map non-null `backgroundAssetId` through the asset manifest for `expectedPath`; `fileMissing` is `true` when that path does not exist.

Do **not** infer `locationFamily` from the asset ID.

- [ ] **Step 3: Add a report-coverage checker**

Export:

```ts
export function checkBackgroundAuditCoverage(
  result: BackgroundCueAuditResult,
  reportMarkdown: string,
): string[];
```

Read the first table column from rows under the report's `## Cue decisions` table. Return problems for:

- mechanical cue key missing from report;
- report cue key not in current mechanical inventory;
- duplicate cue key;
- blank/unsupported Decision;
- blank/unsupported Priority.

Allowed decisions:

```ts
new Set(["keep", "prompt-adjust", "regenerate", "add-variant"])
```

Allowed priorities:

```ts
new Set(["A", "B"])
```

- [ ] **Step 4: Write tests before CLI wiring**

Cover:

1. two occurrences reusing one background asset produce two `cueKey` rows;
2. a null `backgroundAssetId` is still enumerated;
3. analysis Intro/Result Dialogue/Outro cue objects are enumerated;
4. missing expected file sets `fileMissing: true`;
5. structured problems are returned for unreadable/malformed inputs;
6. coverage check rejects missing, stale, duplicate, invalid-decision, and invalid-priority rows.

- [ ] **Step 5: Run tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/background-cues-audit.test.ts
```

- [ ] **Step 6: Wire CLI scripts**

In `packages/scripts/package.json` add:

```json
"background-cues:audit": "bun run compile-scenes/background-cues-audit.ts"
```

In root `package.json` add:

```json
"background-cues:audit": "bun run --cwd packages/scripts background-cues:audit"
```

CLI modes:

```bash
bun run background-cues:audit --chapter chapter_1
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

The first prints deterministic mechanical rows/problems; the second exits non-zero on structured problems or coverage/decision problems.

- [ ] **Step 7: Run focused and broad script checks**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/background-cues-audit.test.ts
bun run check:scripts
bun run lint
```

- [ ] **Step 8: Commit**

```bash
git add packages/scripts/compile-scenes/background-cues-audit.ts \
  packages/scripts/compile-scenes/background-cues-audit.test.ts \
  packages/scripts/package.json package.json
git commit -m "feat: add Chapter background cue audit"
```

---

### Task 5: Verify and publish PR A — contract and tooling

- [ ] **Step 1: Run PR A regression gate**

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
bun run lint
```

Expected: all commands exit 0. `scenes:compile` may report only the explicitly accepted missing portrait PNG warnings introduced for `stationery_owner` and `masuda_kei`; record the exact warning list in the PR.

- [ ] **Step 2: Verify the diff boundary**

```bash
git diff --name-only <PR_A_BASE>...HEAD
```

PR A contains skills, strict catalog enforcement/config, scenario evidence, and background-audit tooling only. No broad scene prose/background changes.

- [ ] **Step 3: Open/review PR A under HPA-561**

Require focused review of:

- one-registry/YAGNI boundary;
- unknown-speaker test coverage across analysis traversal;
- explicit `店主` / `學生` / `增田圭` decisions;
- audit-script mechanical vs semantic boundary.

Merge PR A before starting final PR B acceptance fixes, or base PR B explicitly on PR A if working stacked.

---

### Task 6: Generate accepted portrait assets and run the background-variety audit

**Files:**
- Create: `docs/stories_plan/chapter_1/background-variety-audit.md`
- Create/update: portrait PNGs required by Task 3.
- Read: frozen manifest, generated background inventory, same-location background assets.

- [ ] **Step 1: Generate the accepted new portrait files**

Use `.claude/skills/generating-lyra-image-assets/SKILL.md` and `static/assets/config/policy.yaml` for:

```text
portrait.stationery_owner.standard
portrait.stationery_owner.flustered
portrait.masuda_kei.standard
```

Do not add expressions beyond the catalog contract without a new concrete finding.

- [ ] **Step 2: Freeze the exact production manifest**

Copy the current ordered `docs/stories_plan/chapter_1/chapter.md` scene list into the report header with audit date/ruleset. If HPA-265 has inserted a production analysis scene, include it automatically.

- [ ] **Step 3: Generate the mechanical background inventory**

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1
```

- [ ] **Step 4: Create `## Cue decisions` from the mechanical `cueKey`s**

Use:

```markdown
| Cue key | Location family | Current function | Continuity anchors | Variety finding | Decision | Priority | Proposed function | Disposition |
|---|---|---|---|---|---|---|---|---|
```

The first column is copied exactly from the tool. Human/agent judgment fills every other column.

- [ ] **Step 5: Group by physical location family**

For each family inspect together:

```text
entrances/exits
windows
fixed furniture
geometry/corridor direction
case-significant props
palette/materials
adjacency
camera angle/distance
focal emphasis
lighting/weather/occupancy
```

- [ ] **Step 6: Assign one decision and priority to every cue**

Priority A only for comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, meaningful state change, or canon/continuity. Otherwise Priority B.

- [ ] **Step 7: Record a same-view false-positive control**

Keep at least one uninterrupted scene/cue sequence as `keep` and explain why a new view would be gratuitous.

- [ ] **Step 8: Run mechanical coverage check**

```bash
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: exit 0 before asset changes begin.

- [ ] **Step 9: Commit the audit and portraits before background regeneration**

```bash
git add docs/stories_plan/chapter_1/background-variety-audit.md \
  static/assets/portraits
git commit -m "docs: audit Chapter 1 backgrounds and add approved portraits"
```

---

### Task 7: Implement only Priority A background changes

**Files:**
- Modify: only scene prompts/cues named by Priority A rows.
- Create/update: only accepted backgrounds under `static/assets/backgrounds/chapter_1/**`.
- Update: background audit dispositions.

- [ ] **Step 1: Write the accepted delta before every edit**

Each Priority A row must state:

```text
narrative/spatial function
stable continuity anchors
intended camera/composition delta
lighting/weather/occupancy delta if any
```

- [ ] **Step 2: Edit only the corresponding authored prompt/cue**

Do not add scene tags solely to increase image count.

- [ ] **Step 3: Compile after authored changes**

```bash
bun run scenes:compile
```

- [ ] **Step 4: Commit authored cue changes separately from art**

```bash
git add docs/stories_plan/chapter_1
git commit -m "docs: improve Priority A Chapter 1 background cues"
```

- [ ] **Step 5: Generate/regenerate accepted Priority A PNGs only**

Inspect sibling same-location assets first; preserve documented anchors.

- [ ] **Step 6: Verify touched background dimensions and opacity with a concrete command**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import struct, subprocess

changed = subprocess.check_output([
    "git", "diff", "--name-only", "main...HEAD", "--",
    "static/assets/backgrounds/chapter_1"
], text=True).splitlines()
paths = [Path(p) for p in changed if p.endswith(".png") and Path(p).exists()]
for path in paths:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"not PNG: {path}"
    width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(
        ">IIBBBBB", data[16:29]
    )
    assert (width, height) == (1920, 1080), f"wrong size {width}x{height}: {path}"
    assert color_type in (0, 2), f"background must have no alpha channel (color type {color_type}): {path}"
    print(f"OK {path}: {width}x{height}, color_type={color_type}")
PY
```

This is portable Python standard-library validation; it does not rely on macOS `sips`, ImageMagick, or Pillow.

- [ ] **Step 7: Review each complete location family together**

Reject any variant that implies a different physical place.

- [ ] **Step 8: Update dispositions and rerun coverage**

```bash
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Priority B remains documented and ungenerated.

- [ ] **Step 9: Commit art/dispositions**

```bash
git add static/assets/backgrounds/chapter_1 \
  docs/stories_plan/chapter_1/background-variety-audit.md
git commit -m "feat: add Priority A Chapter 1 background variants"
```

---

### Task 8: Use `reviewing-story-scenes` as the semantic re-audit authority

**Files:**
- Create: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- Read: frozen manifest and normal seven-axis sources.

- [ ] **Step 1: Freeze the production manifest again**

Copy the exact current `chapter.md` scene list into the report header. This is intentionally a fresh snapshot because production content may have changed since Task 6.

- [ ] **Step 2: Invoke the hardened `reviewing-story-scenes` skill**

Run its normal seven-axis workflow over every manifest-listed production scene. Do not invent a new 10-column ledger or alternate severity vocabulary.

For analysis scenes, explicitly include Intro, every board Result Dialogue, and Outro in Axis 3/5 coverage.

- [ ] **Step 3: Save the consolidated Phase 4 output verbatim**

Write it under:

```markdown
# Chapter 1 Semantic Content Re-audit

## Frozen manifest
...

## Initial seven-axis review
<verbatim consolidated reviewing-story-scenes report>
```

This preserves the existing `BLOCKERS-PRESENT` / `FIX-RECOMMENDED` / `SHIP` verdict and the skill's original Blocker/Important findings.

- [ ] **Step 4: Commit the initial review before editing scenes**

```bash
git add docs/stories_plan/chapter_1/semantic-content-reaudit.md
git commit -m "docs: record Chapter 1 semantic re-audit"
```

- [ ] **Step 5: Resolve every Blocker/Important finding with minimal changes**

Use finding type:

```text
speaker/identity -> correct global catalog label/config
narration -> brackets or character dialogue as appropriate
expression -> existing configured slug unless a separately justified asset is needed
background -> accepted Priority A integration only
```

Do not perform unrelated prose cleanup.

- [ ] **Step 6: Append a resolution log**

For each original Blocker/Important finding, append:

```markdown
- `<original file:line + finding>` — **Resolved/Accepted** — <exact evidence/change>
```

Do not rewrite the initial review block.

- [ ] **Step 7: Compile and re-review every changed scene**

```bash
bun run scenes:compile
```

Run at least Axis 3 and Axis 5 on every changed scene before the final full review.

- [ ] **Step 8: Run the full seven-axis review again**

Append the new consolidated report under:

```markdown
## Final seven-axis review
...
```

Completion condition:

```text
Verdict: SHIP
no remaining Blocker findings
no remaining Important findings
```

Minor/deferred observations may remain as normal review output or the resolution log.

- [ ] **Step 9: Commit focused fixes and final report**

Keep speaker/identity, narration/expression, and visual fixes in separate commits where practical; then commit the final report update.

---

### Task 9: Final PR B verification gate

- [ ] **Step 1: Verify background report coverage**

```bash
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: exit 0.

- [ ] **Step 2: Run full code/content regression commands**

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
bun run lint
```

Expected: all commands exit 0.

- [ ] **Step 3: Rerun the portable touched-background PNG check from Task 7**

Expected: every touched Chapter 1 background is opaque `1920x1080`.

- [ ] **Step 4: Verify portrait warnings are resolved**

`scenes:compile` must no longer report the accepted missing portrait files for `stationery_owner` or `masuda_kei`.

- [ ] **Step 5: Verify semantic gate**

Read the final section of `semantic-content-reaudit.md` and confirm it is the consolidated `reviewing-story-scenes` report with verdict `SHIP` and no Blocker/Important findings.

Do not substitute hand-entered counters for this review result.

- [ ] **Step 6: Verify story scope boundary**

Inspect changed story files and confirm no unrelated culprit, timeline, evidence-package, unlock-chain, scene-order, reveal-ladder, or sealed-reveal change.

- [ ] **Step 7: Verify runtime boundary**

Confirm there are no parser/AST/runtime schema changes for speaker classification and no Rust/Svelte changes. HPA-259 analysis JSON remains untouched apart from normal regenerated content.

- [ ] **Step 8: Inspect PR B diff**

```bash
git diff --name-only <PR_B_BASE>...HEAD
```

Every path must be attributable to portrait assets, background audit/accepted Priority A assets, recorded semantic findings, or finding-backed Chapter 1 corrections.

## Plan Self-Review

- **Reuse:** `characters.yaml`, `portraitMode: none`, existing expression diagnostics, HPA-259 analysis traversal, evidence-audit scripting pattern, and seven-axis semantic review are all reused rather than duplicated.
- **Compiler scope:** one production behavior change — delete silent unknown/no-expression fallback.
- **No second registry:** no `Local Speakers`, no AST/header work, no runtime-omission test ceremony.
- **Order:** skills land before catalog/content migration consumes their guidance.
- **Current content decisions:** `店主` portrait; `學生` no portrait; `增田圭` portrait; narrator/commuters no portrait.
- **Audit accountability:** mechanical background inventory/coverage is scripted; semantic severity remains owned by `reviewing-story-scenes`.
- **Prompt eval:** only three genuine baseline RED scenarios; calm/label-drift/analysis checks run post-change.
- **Verification:** `bun run lint` is included even though current CI primarily runs scene compilation/type/build gates; touched background dimension/opacity verification has an explicit portable command.
- **Reviewability:** contract/tooling and content/art are separate implementation PRs under one HPA-561 ticket.
