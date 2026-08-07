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

PR A contains no broad scene prose rewrite and no background/portrait art regeneration. It may temporarily expose only the explicitly expected missing portrait-file warnings for the newly portrait-bearing `店主` and `增田圭` catalog entries; PR B resolves those asset warnings.

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

```text
Using the current Lyra dialogue-writing skill, draft a short scene ending in which
an on-screen detective looks at the evidence, physically closes the folder, and
states their own conclusion. Preserve the current repo format and do not add new
characters. Return only authored scene Markdown.
```

GREEN acceptance: visible action is bracketed; the detective owns the conclusion; `旁白` is not used as generic action/conclusion fallback.

- [ ] **Step 3: Run RED 2 — reusable visible speaker missing catalog contract**

```text
Using the current Lyra dialogue-writing skill, draft a scene featuring a named,
visible, case-significant witness who is present for multiple exchanges but does
not yet exist in characters.yaml. Use repository sources. Return authored scene
Markdown plus any required asset/catalog escalation.
```

GREEN acceptance: the writer explicitly requires a global catalog decision; it does not rely on portraitless compilation.

- [ ] **Step 4: Run RED 3 — bracket-only emotional transition**

Choose a current catalog character with an available non-standard slug:

```text
Draft a short exchange where the character visibly moves from calm to pressured.
Use repository-defined expressions only. Return authored scene Markdown.
```

GREEN acceptance: a meaningful portrait transition is authored when the available slug fits; brackets alone are not treated as portrait state.

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

Use:

```markdown
| Meaning | Authored form |
|---|---|
| Visible movement, body language, atmosphere, room/object state | `[ ... ]` |
| Present-character conclusion, judgment, interpretation, reaction | character dialogue |
| Time/location transition, unavailable information, intentional voiceover | `**旁白**：...` |
```

Rewrite the warehouse example so visible action/architecture/body discovery is bracketed. Keep intentional voiceover explicitly labeled.

- [ ] **Step 2: Replace local-vs-catalog guidance with one-catalog guidance**

Teach:

```text
reusable or visually important speaker -> characters.yaml portraitMode: portrait
intentional faceless/system/very minor speaker -> characters.yaml portraitMode: none
unknown/unresolved identity -> stop and resolve catalog label/mode
never rely on an uncatalogued speaker compiling portraitless
```

- [ ] **Step 3: Add catalog-bounded expression choreography**

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

Investigation: sibling sub-locations can vary in angle/focus but preserve adjacency, hotspot readability, visible floor/standee clearance, and case props.

Interrogation: a new phase background is justified only when visible environmental/dramatic state materially changes.

- [ ] **Step 6: Extend Axis 3 in `reviewing-story-scenes`**

Rename to `Voice, style, narration & expression`. Add narration/expression rules. Apply to all four scene types; for analysis inspect Intro, every Result Dialogue, and Outro.

- [ ] **Step 7: Extend Axis 5 without changing severity/report format**

Keep existing completeness/compiled-ID/file checks, then add:

```text
catalog/portrait appropriateness
spatial usability
same-location continuity
purposeful variation
same-view false-positive control
```

Do not create a second findings format.

- [ ] **Step 8: Harden image-generation continuity**

Require sibling same-location asset inspection and record stable anchors plus intended delta before generation. Keep final policy-canvas verification.

- [ ] **Step 9: Simplify orchestrator handoff**

Pass source paths/catalog escalation rules; do not relay an ephemeral cast table.

- [ ] **Step 10: Respect HPA-552 ownership**

Do not create the dedicated analysis skill. If HPA-552 landed independently, only ensure it references/inherits the base rules.

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

Acceptance: repository catalog/roster label is used.

**Analysis inheritance spot check**

```text
Review an HPA-259-shaped analysis scene containing Intro, Result Dialogue, and
Outro for narration/expression/portrait/background issues using the hardened
review skill.
```

Acceptance: all analysis dialogue carriers are covered.

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

**Consumes:** Task 2 guidance.

**Produces:** one strict global catalog contract; no parser/AST changes.

- [ ] **Step 1: Add a failing unknown-speaker/no-expression test**

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

- [ ] **Step 2: Add analysis-carrier strict-gate coverage**

Create table cases for `intro`, `resultDialogue`, and `outro`, each containing an unknown line. For every case call:

```ts
enrichScenesWithAssets({
  scenes: [],
  analysisScenes: [scene],
  config: config(),
});
```

and assert `assetUnknownSpeaker`.

- [ ] **Step 3: Verify RED**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/assets/enrich.test.ts
```

Expected: new tests fail because current `enrichLine()` silently returns `portrait: null` for an unknown/no-expression line.

- [ ] **Step 4: Delete only the silent fallback**

Use:

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

- [ ] **Step 5: Add intentional no-portrait catalog entries**

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

Add `id: masuda_kei`, `displayNames: ["增田圭"]`, `portraitMode: portrait`, a canonical visual prompt derived from `docs/stories_plan/characters.md`, and a `standard` expression matching his ordinary Scene P2 presentation. Do not invent sealed traits.

- [ ] **Step 8: Run focused tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/assets/enrich.test.ts
bun run check:scripts
```

- [ ] **Step 9: Run production compilation**

```bash
bun run scenes:compile
```

Expected:

- no `assetUnknownSpeaker` errors for the frozen current Chapter 1 corpus;
- no expression-on-no-portrait errors for `旁白`, commuters, or `學生`;
- only explicitly expected new portrait-file warnings for `stationery_owner` and `masuda_kei` may remain.

If the manifest changed and additional unknown labels appear, classify them using Task 2 guidance; do not weaken the compiler.

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

**Produces:** compiler-owned background inventory and mechanical report-coverage checking. Artistic classification remains outside the script.

- [ ] **Step 1: Define audit types**

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

- [ ] **Step 2: Enumerate cue occurrences from compiled output**

After a successful `bun run scenes:compile`, read:

```text
docs/stories_plan/chapter_1/chapter.md
apps/game/src-tauri/resources/scenes/chapter_1/<scene>.json
apps/game/src-tauri/resources/assets/manifest.json
```

For every manifest-listed emitted scene, recursively walk JSON. Whenever an object owns a `backgroundAssetId` property, emit one occurrence row even if multiple occurrences reuse the same asset ID.

Use a JSON-pointer-like path such as:

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

Map non-null IDs through the asset manifest for `expectedPath`; set `fileMissing` from disk existence. Do **not** infer physical `locationFamily` from asset IDs.

- [ ] **Step 3: Add report coverage checking**

```ts
export function checkBackgroundAuditCoverage(
  result: BackgroundCueAuditResult,
  reportMarkdown: string,
): string[];
```

Read the first table column under `## Cue decisions`. Return problems for missing, stale, duplicate cue keys and invalid/blank Decision/Priority values.

Allowed decisions:

```ts
new Set(["keep", "prompt-adjust", "regenerate", "add-variant"])
```

Allowed priorities:

```ts
new Set(["A", "B"])
```

- [ ] **Step 4: Write tests**

Cover:

1. two occurrences reusing one asset -> two cue keys;
2. null `backgroundAssetId` -> still enumerated;
3. analysis Intro/Result/Outro -> enumerated;
4. missing expected file -> `fileMissing: true`;
5. unreadable/malformed input -> structured problem;
6. report check rejects missing/stale/duplicate/invalid decision/priority rows.

- [ ] **Step 5: Run focused tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/background-cues-audit.test.ts
```

- [ ] **Step 6: Wire CLI scripts**

`packages/scripts/package.json`:

```json
"background-cues:audit": "bun run compile-scenes/background-cues-audit.ts"
```

Root `package.json`:

```json
"background-cues:audit": "bun run --cwd packages/scripts background-cues:audit"
```

Support:

```bash
bun run background-cues:audit --chapter chapter_1
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

The first prints deterministic items/problems. The second exits non-zero on structured input problems or report coverage/decision errors.

- [ ] **Step 7: Run checks**

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

Expected: all commands exit 0. `scenes:compile` may report only the accepted new missing portrait PNG warnings for `stationery_owner` and `masuda_kei`; record exact warnings in the PR.

- [ ] **Step 2: Verify diff boundary**

```bash
git diff --name-only <PR_A_BASE>...HEAD
```

PR A contains skills, strict catalog enforcement/config, scenario evidence, and background-audit tooling only. No broad scene prose/background changes.

- [ ] **Step 3: Open/review PR A under HPA-561**

Review one-registry/YAGNI boundary, unknown-speaker coverage through analysis traversal, explicit `店主` / `學生` / `增田圭` decisions, and audit-tool mechanical/semantic boundary.

Merge PR A before final PR B acceptance, or explicitly stack PR B on PR A.

---

### Task 6: Generate approved portraits and run the background-variety audit

**Files:**
- Create: `docs/stories_plan/chapter_1/background-variety-audit.md`
- Create/update: portrait PNGs required by Task 3.
- Read: frozen manifest, generated background inventory, same-location assets.

- [ ] **Step 1: Generate approved portrait files**

Use `.claude/skills/generating-lyra-image-assets/SKILL.md` and `static/assets/config/policy.yaml` for:

```text
portrait.stationery_owner.standard
portrait.stationery_owner.flustered
portrait.masuda_kei.standard
```

Do not add expressions beyond the catalog contract without a concrete finding.

- [ ] **Step 2: Freeze the exact production manifest**

Copy current ordered `chapter.md` scene list into the report header with audit date/ruleset. If HPA-265 inserted production analysis, include it automatically.

- [ ] **Step 3: Generate mechanical background inventory**

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1
```

- [ ] **Step 4: Create `## Cue decisions`**

```markdown
| Cue key | Location family | Current function | Continuity anchors | Variety finding | Decision | Priority | Proposed function | Disposition |
|---|---|---|---|---|---|---|---|---|
```

Copy `cueKey` exactly from the tool. Human/agent judgment fills other columns.

- [ ] **Step 5: Group by physical location family**

Inspect entrances/exits, windows, fixed furniture, geometry/corridor direction, case props, palette/materials, adjacency, camera angle/distance, focal emphasis, lighting/weather/occupancy.

- [ ] **Step 6: Assign one decision and priority per cue**

Priority A only for comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, meaningful state change, or canon/continuity. Otherwise Priority B.

- [ ] **Step 7: Record a same-view false-positive control**

Keep at least one uninterrupted sequence as `keep` and explain why changing it would be gratuitous.

- [ ] **Step 8: Check coverage mechanically**

```bash
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: exit 0 before asset changes.

- [ ] **Step 9: Commit audit + portraits before background regeneration**

```bash
git add docs/stories_plan/chapter_1/background-variety-audit.md static/assets/portraits
git commit -m "docs: audit Chapter 1 backgrounds and add approved portraits"
```

---

### Task 7: Implement only Priority A background changes

**Files:**
- Modify only scene prompts/cues named by Priority A rows.
- Create/update only accepted backgrounds under `static/assets/backgrounds/chapter_1/**`.
- Update audit dispositions.

- [ ] **Step 1: Write accepted delta before every edit**

Each Priority A row states:

```text
narrative/spatial function
stable continuity anchors
intended camera/composition delta
lighting/weather/occupancy delta if any
```

- [ ] **Step 2: Edit only corresponding authored prompt/cue**

Do not add scene tags solely for image count.

- [ ] **Step 3: Compile**

```bash
bun run scenes:compile
```

- [ ] **Step 4: Commit authored cue changes separately**

```bash
git add docs/stories_plan/chapter_1
git commit -m "docs: improve Priority A Chapter 1 background cues"
```

- [ ] **Step 5: Generate/regenerate Priority A PNGs only**

Inspect sibling same-location assets first and preserve documented anchors.

- [ ] **Step 6: Verify touched background dimensions/opacity**

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

- [ ] **Step 7: Review each location family together**

Reject variants implying a different physical place.

- [ ] **Step 8: Update dispositions and rerun coverage**

```bash
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Priority B remains documented and ungenerated.

- [ ] **Step 9: Commit art/dispositions**

```bash
git add static/assets/backgrounds/chapter_1 docs/stories_plan/chapter_1/background-variety-audit.md
git commit -m "feat: add Priority A Chapter 1 background variants"
```

---

### Task 8: Use `reviewing-story-scenes` as semantic re-audit authority

**Files:**
- Create: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- Read: frozen manifest and normal seven-axis sources.

- [ ] **Step 1: Freeze production manifest again**

Copy exact current `chapter.md` scene list into the report header. This is a fresh snapshot because production content may have changed since Task 6.

- [ ] **Step 2: Invoke hardened `reviewing-story-scenes`**

Run its normal seven-axis workflow over every manifest-listed production scene. Do not invent a new ledger or severity vocabulary.

For analysis, explicitly include Intro, every Result Dialogue, and Outro in Axis 3/5.

- [ ] **Step 3: Save consolidated Phase 4 output verbatim**

```markdown
# Chapter 1 Semantic Content Re-audit

## Frozen manifest
...

## Initial seven-axis review
<verbatim consolidated reviewing-story-scenes report>
```

- [ ] **Step 4: Commit initial review before scene edits**

```bash
git add docs/stories_plan/chapter_1/semantic-content-reaudit.md
git commit -m "docs: record Chapter 1 semantic re-audit"
```

- [ ] **Step 5: Resolve every Blocker/Important with minimal changes**

```text
speaker/identity -> correct global catalog label/config
narration -> brackets or character dialogue as appropriate
expression -> existing configured slug unless new asset is separately justified
background -> accepted Priority A integration only
```

No unrelated prose cleanup.

- [ ] **Step 6: Append resolution log**

For each original Blocker/Important:

```markdown
- `<original file:line + finding>` — **Resolved/Accepted** — <exact evidence/change>
```

Do not rewrite the initial review block.

- [ ] **Step 7: Compile + focused re-review**

```bash
bun run scenes:compile
```

Run at least Axis 3 and Axis 5 on every changed scene.

- [ ] **Step 8: Run full seven-axis review again**

Append under:

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

Minor/deferred observations may remain.

- [ ] **Step 9: Commit focused fixes and final report**

Keep speaker/identity, narration/expression, and visual fixes in separate commits where practical; then commit final report update.

---

### Task 9: Final PR B verification gate

- [ ] **Step 1: Verify background report coverage**

```bash
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

- [ ] **Step 2: Run full regression commands**

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
bun run lint
```

Expected: all exit 0.

- [ ] **Step 3: Rerun Task 7 portable background PNG check**

Expected: every touched Chapter 1 background is opaque `1920x1080`.

- [ ] **Step 4: Verify portrait warnings resolved**

`scenes:compile` no longer reports missing `stationery_owner` or `masuda_kei` portrait files.

- [ ] **Step 5: Verify semantic gate**

Final `semantic-content-reaudit.md` section is the consolidated `reviewing-story-scenes` report with verdict `SHIP` and no Blocker/Important findings. Do not substitute hand-entered counters.

- [ ] **Step 6: Verify story boundary**

No unrelated culprit, timeline, evidence-package, unlock-chain, scene-order, reveal-ladder, or sealed-reveal change.

- [ ] **Step 7: Verify runtime boundary**

No parser/AST/runtime schema changes for speaker classification and no Rust/Svelte changes.

- [ ] **Step 8: Inspect PR B diff**

```bash
git diff --name-only <PR_B_BASE>...HEAD
```

Every path is attributable to portrait assets, background audit/accepted Priority A assets, recorded semantic findings, or finding-backed Chapter 1 corrections.

## Plan Self-Review

- **Reuse:** existing `characters.yaml`, `portraitMode: none`, no-portrait expression diagnostics, HPA-259 analysis traversal, evidence-audit script precedent, and seven-axis review are reused.
- **Compiler scope:** one behavior change — delete silent unknown/no-expression fallback.
- **No second registry:** no `Local Speakers`, AST/header work, or runtime-omission ceremony.
- **Order:** skills before production migration.
- **Current decisions:** `店主` portrait; `學生` no portrait; `增田圭` portrait; narrator/commuters no portrait.
- **Audit accountability:** background inventory/coverage is scripted; semantic severity stays with `reviewing-story-scenes`.
- **Prompt eval:** three genuine baseline scenarios only; calm/label-drift/analysis checks are post-change.
- **Verification:** includes `bun run lint`; touched background dimension/opacity has a concrete portable command.
- **Reviewability:** contract/tooling and content/art are separate implementation PRs under one HPA-561 ticket.
