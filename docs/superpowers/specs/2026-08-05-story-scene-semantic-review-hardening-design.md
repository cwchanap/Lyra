# HPA-561 Durable Scene Asset Contracts and Semantic Review Hardening Design

## Status

Approved consolidated design, revised after reuse review against the post-HPA-259 codebase.

HPA-561 is one feature with one design and one implementation plan. The revised design reuses the existing character catalog, asset compiler, audit-script pattern, and seven-axis scene-review skill instead of introducing parallel registries or review formats.

## Goal

Improve Chapter 1 authored-scene reliability and presentation quality by:

1. closing the silent unknown-speaker portrait fallback through the existing global character catalog;
2. hardening narration, expression, portrait, and background-variety authoring/review rules;
3. applying those rules to the production Chapter 1 manifest through a mechanically assisted background audit and the existing seven-axis semantic review;
4. fixing every material finding without turning the work into a broad Chapter 1 rewrite.

## Post-HPA-259 baseline

HPA-259 is merged. The repository already supports four compiler-driven scene types: linear, investigation, interrogation, and analysis.

Analysis scenes already have `ASTAnalysisScene`, a separate required-Summary parser contract, `enrichAnalysisScene()` using the common dialogue asset-enrichment path, and immutable analysis JSON/Rust catalog/dialogue-origin wire.

HPA-561 extends those seams. It does not add another analysis traversal and does not change HPA-259 board semantics.

Production Chapter 1 currently still uses `scene_8_5.md`. HPA-265 may later replace it with `analysis_scene_8_5.md`; all audits remain manifest-driven so either state works.

## Reuse decision: one character registry

The existing asset catalog already models both portrait-bearing and portraitless speakers:

```ts
portraitMode: "portrait" | "none"
```

For `portraitMode: "none"`, the compiler already emits `portrait: null`, rejects expressions through `assetExpressionOnNoPortraitSpeaker`, does not require `expressions.standard`, and rejects duplicate `displayNames` globally.

Therefore HPA-561 will **not** add `Local Speakers`, `ASTLocalSpeaker`, scene-header metadata, or a second speaker registry.

The compiler defect is the current unknown-speaker fallback: an uncatalogued speaker with no expression silently becomes `portrait: null`.

### Revised deterministic contract

When assets are enabled:

```text
known catalog speaker
  -> portraitMode: portrait -> existing portrait/expression enrichment
  -> portraitMode: none     -> portrait: null; expression forbidden

unknown speaker
  -> assetUnknownSpeaker
```

No speaker is exempt merely because an expression was omitted.

When assets are disabled, preserve the existing semantic-only path; catalog membership remains an asset-enrichment concern.

## Current Chapter 1 migration decisions

The implementation still freezes the production manifest at execution time. On the current manifest, reuse review identified seven scene speaker labels absent from `characters.yaml`. `旁白` is also absent from the catalog and works only because of the same silent fallback.

If the manifest is unchanged, the strict gate therefore needs eight display-name contracts or deliberate authored-label corrections.

| Display name | Catalog treatment | Design decision |
|---|---|---|
| `旁白` | `portraitMode: none` | System narrator; one global no-portrait entry, no compiler special case. |
| `上班族` | `portraitMode: none` | Anonymous one-shot commuter. |
| `路人甲` | `portraitMode: none` | Anonymous one-shot passerby. |
| `路人乙` | `portraitMode: none` | Anonymous one-shot passerby. |
| `路人丙` | `portraitMode: none` | Anonymous one-shot passerby. |
| `學生` | `portraitMode: none` | Brief one-shot Scene P1 participant; no portrait required. |
| `店主` | `portraitMode: portrait` | Primary opposing speaker throughout the Scene P1 mini-case; real portrait contract required. She is **not** `店長高瀨`. |
| `增田圭` | `portraitMode: portrait` | Visible, case-significant Chapter 1 character; real portrait contract required. |

### `店主` portrait scope

Keep the visual contract small: one stable identity, `standard`, and one pressure/exposure expression such as `flustered`. Do not create a large expression pack.

### Portraitless generic labels

`學生`, commuters, passersby, and `旁白` are intentionally explicit but portraitless. If later content makes one of these labels a distinct reusable visible character, rename/promote it deliberately in the single global catalog rather than introducing scene-local metadata.

## Semantic authoring rules

### Speaker/portrait decision

The skills teach one catalog:

- reusable or visually important speaker -> `characters.yaml`, `portraitMode: portrait`;
- intentional faceless/system/very minor speaker -> `characters.yaml`, `portraitMode: none`;
- unresolved identity -> stop and resolve the global label/mode;
- never rely on an uncatalogued speaker compiling portraitless.

Global display-name uniqueness gives every repeated authored label one explicit catalog contract. Whether two uses are semantically the same person still remains a review/canon question; the compiler does not infer identity.

### Narration ownership

| Meaning | Authored form |
|---|---|
| Visible movement, body language, atmosphere, room/object state | `[ ... ]` |
| Present-character conclusion, judgment, interpretation, reaction | character dialogue |
| Time/location transition, unavailable information, intentional voiceover | `**旁白**：...` |

Correct the contradictory warehouse example in the base dialogue skill.

### Expression choreography

- bracketed emotion does not change portrait state;
- use only configured expression slugs;
- use a suitable non-standard slug at a meaningful transition;
- do not switch line-by-line;
- calm and standard-only scenes are valid;
- add new expression art only for a concrete visible need.

## Review-skill authority

Do not create a parallel semantic-audit vocabulary or findings format.

`reviewing-story-scenes` remains the single semantic review authority with its existing seven axes, Blocker/Important finding severities, `BLOCKERS-PRESENT` / `FIX-RECOMMENDED` / `SHIP` verdicts, source-cited findings, and consolidated Phase 4 report.

### Axis 3 — Voice, style, narration & expression

Extend Voice & Style to check narration ownership, bracket/dialogue/portrait-expression coherence, meaningful transitions left flat despite a suitable configured slug, excessive expression flicker, and false-positive protection for calm/standard-only sequences.

Apply to all four scene types. For analysis, inspect Intro, every Result Dialogue, and Outro.

### Axis 5 — Visual asset coverage & purposeful variety

Keep existing completeness/compiled-ID/file checks, then add catalog/portrait appropriateness, compiled portrait/expression correctness, background spatial usability/continuity, purposeful variation, and same-view false-positive protection.

Repeated art is not a finding by itself. Flag only when another viewpoint/state would materially improve comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, reasoning state, or meaningful environment state.

## Background-variety design

### Variety must have a job

A new/regenerated background is justified only for orientation, investigation readability, evidence focus, pressure/reveal emphasis, reasoning/procedural state, or meaningful time/weather/lighting/occupancy/aftermath state.

There is no image-count quota.

### Continuity anchors

Same-location variants preserve entrances/exits, window positions, fixed furniture, room geometry/corridor direction, case-significant props, signature palette/materials, and believable adjacency.

Camera angle, distance, focal emphasis, crop, lighting, weather, and occupancy may change when function changes.

### Decision/priority policy

Every reviewed cue gets one decision:

```text
keep
prompt-adjust
regenerate
add-variant
```

And one priority:

- **A** — comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, meaningful state change, or canon/continuity;
- **B** — serviceable cosmetic polish.

Implement Priority A only. Keep Priority B documented.

## Mechanical background-audit support

Do not manually transcribe compiler-owned data.

Add a small audit script modeled on `evidence-sources-audit.ts`:

```text
packages/scripts/compile-scenes/background-cues-audit.ts
packages/scripts/compile-scenes/background-cues-audit.test.ts
bun run background-cues:audit
```

It reads the frozen production manifest plus compiled scene/asset outputs and emits one deterministic row per **cue occurrence**, including repeated occurrences that reuse the same asset ID:

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

It also emits structured `problems[]` instead of silently skipping malformed/missing input.

The script does **not** infer physical location family or artistic quality. Default asset IDs do not reliably encode those judgments.

### Human background report

Create `docs/stories_plan/chapter_1/background-variety-audit.md` with generated `cueKey` values as the stable first column:

```markdown
| Cue key | Location family | Current function | Continuity anchors | Variety finding | Decision | Priority | Proposed function | Disposition |
```

A check mode compares the report to the mechanical inventory so every current cue occurs exactly once and has a valid decision/priority. Coverage becomes mechanical; artistic judgment remains semantic.

Production analysis scenes are included automatically if manifest-listed. Synthetic HPA-259 fixtures are excluded.

## Existing-content semantic re-audit

Do not invent a second findings ledger or severity scale.

At audit start:

1. freeze the current production `chapter.md` manifest;
2. invoke hardened `reviewing-story-scenes` over that corpus;
3. save its consolidated report verbatim to `docs/stories_plan/chapter_1/semantic-content-reaudit.md`;
4. fix Blocker/Important findings using minimal finding-backed changes;
5. append a resolution section mapping original findings to evidence;
6. rerun the complete seven-axis review and append the final consolidated report.

Completion requires the final consolidated review to have verdict `SHIP` and no remaining Blocker/Important findings. Minor/deferred observations may remain documented.

This makes the existing skill, not hand-entered counters, the semantic acceptance authority.

## Skill verification strategy

Use only three baseline pressure scenarios corresponding to observed gaps:

1. narration fallback;
2. reusable visible speaker missing catalog treatment;
3. bracket-only emotional transition with an available expression.

After skill changes, rerun those three as GREEN and add a calm/standard false-positive control, catalog-label drift GREEN-only spot check, and analysis-inheritance GREEN-only spot check.

Do not manufacture baseline failures for prospective risks.

## Delivery shape

HPA-561 remains one Linear ticket and one spec/plan, but implementation is delivered as two reviewable PRs.

### PR A — contract and tooling

Contains skill/review/orchestrator hardening, strict global speaker-catalog enforcement, the minimal `characters.yaml` migration required to keep production compilation green, and the background-cue audit script/tests.

No broad scene rewrite and no background/portrait art generation. The two newly portrait-bearing entries may temporarily produce only their explicitly expected missing-file warnings; PR B resolves them.

### PR B — Chapter 1 content and visual acceptance

After PR A lands, generate approved `店主`/`增田圭` portraits, run/fill the background audit, implement Priority A prompt/background changes, invoke the seven-axis semantic re-audit, fix recorded Blocker/Important findings, rerun review to `SHIP`, and retain Priority B/Minor findings as documented follow-up.

This separates code/tooling review from art/content review without creating extra architecture or Linear tickets.

## Verification

Primary proof:

- unknown speaker without expression now fails;
- `portraitMode: none` speakers compile portraitless and reject expressions across linear, investigation, interrogation, and analysis dialogue paths;
- analysis Intro/Result/Outro obey the same strict rule through existing enrichment;
- three RED -> GREEN skill scenarios plus post-change control/spot checks;
- mechanical background inventory and coverage check;
- grouped location-family review for Priority A assets;
- final seven-axis review verdict `SHIP` with no Blocker/Important findings.

Final checks:

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
bun run lint
```

The current CI workflow does not itself run `bun run lint:all` in the frontend job, but `bun run lint` exists and is appropriate because HPA-561 touches TypeScript/tooling files.

Rust/app tests remain unnecessary unless implementation unexpectedly changes runtime-facing code.

## Non-goals

- no `Local Speakers` metadata or second speaker registry;
- no scene-header/AST changes for speaker classification;
- no semantic alias/narration/emotion/image-similarity classifier;
- no automatic expression choice;
- no arbitrary expression/background-count thresholds;
- no parallel semantic-review format or severity vocabulary;
- no generic location registry;
- no eighth review axis;
- no HPA-260 runtime work;
- no HPA-552 analysis-skill duplication;
- no synthetic analysis-scene background work;
- no wholesale Chapter 1 rewrite/background regeneration;
- no Chapter 2 audit.

## Acceptance criteria

- Unknown dialogue speakers fail asset-enabled compilation even without expressions.
- The strict gate is implemented by deleting the silent fallback, not adding parser/AST metadata.
- Every intentional portraitless speaker uses existing `portraitMode: none`.
- `旁白` is a no-portrait catalog entry rather than a compiler special case.
- `店主` receives a real portrait contract and remains distinct from `店長高瀨`.
- `學生` is explicit but portraitless.
- `增田圭` receives a real portrait contract.
- Skills are hardened before production migration consumes the guidance.
- Axis 3/5 cover all four scene types and `reviewing-story-scenes` remains semantic authority.
- Baseline prompt verification uses only three genuine RED scenarios; prospective checks are GREEN-only.
- Compiler-owned background inventory/coverage is scripted; artistic decisions remain human/agent reviewed.
- Priority A background findings are implemented; Priority B remains documented.
- Semantic re-audit is the consolidated `reviewing-story-scenes` output, not a parallel format.
- Final semantic review is `SHIP` with no Blocker/Important findings.
- Implementation is split into contract/tooling and content/asset PRs under HPA-561.
