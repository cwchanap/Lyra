# HPA-602 Old-Clock Raster Continuity Design

**Linear:** HPA-602 — Old-clock raster continuity for `scene_p2` / `scene_11` (HPA-561 follow-up)

## Goal

Close the remaining Chapter 1 old-clock visual-continuity follow-up without changing the already-correct authored case logic.

The player encounters one physical clock through four visual surfaces:

1. `background.chapter_1.scene_p2.tag_002` — ordinary-day seed, mounted at the inner-storage entrance.
2. `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png` — crime-scene inspection surface, still mounted and stopped.
3. `static/assets/evidence/old_clock_photo.png` — Case File photograph collected from that inspection.
4. `background.chapter_1.scene_11.tag_002` — post-case payoff, the same clock removed from the wall and resting on the counter.

HPA-602 succeeds only when those four player-facing surfaces read as the same physical prop. This remains a raster-continuity task, not a story rewrite or asset-system change.

## Current Canon

The authored text already fixes the clock's narrative identity and location.

`docs/stories_plan/chapter_1/scene_p2.md` establishes:

- the back-corridor / inner-storage entrance as the clock's normal location;
- an old clock mounted on the entrance's inner wall;
- the manager noticing that it is running slowly;
- the clock continuing to lag later in the scene.

`docs/stories_plan/chapter_1/investigation_scene_7.md` establishes:

- the Scene 7 `inner` sublocation is the inner storage room;
- the old-clock hotspot is the same manager-mentioned clock;
- it remains mounted on the inner-storage entrance wall;
- it reveals `evidence:old_clock_photo`;
- its face is visually readable only as a vague late-night analog position while dialogue/evidence copy carries the `22:59` fact.

`docs/stories_plan/chapter_1/scene_11.md` establishes:

- the stopped clock is the warehouse clock from the case;
- it has been taken down after the case;
- it rests on the café counter before the manager packs it into a box.

HPA-602 therefore preserves the written continuity rather than editing dialogue, evidence semantics, scene order, or case logic to accommodate current rasters.

## Scope

### Named regeneration targets

These two backgrounds remain the reason HPA-602 exists and are regenerated in this PR:

- `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`

### Mandatory identity siblings

Before prompt writing or generation, inspect these existing player-facing siblings together with the named targets:

- `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- `static/assets/evidence/old_clock_photo.png`

If either sibling does not match the accepted clock identity after the named targets are regenerated, regenerate that sibling in this same PR. Do not accept a mismatch and file another follow-up.

This conditional expansion is still HPA-602 scope because Scene 7 is where the player actually examines the clock and the evidence icon is the collected photo of that exact object.

### Required authored prompt change

`docs/stories_plan/chapter_1/scene_11.md` must receive a minimal `Background Prompt` patch so future asset regeneration preserves the same-clock relationship without depending on a one-off image reference.

The durable semantic contract must say, in substance:

- this is the same old clock from the back-corridor / inner-storage entrance;
- it has been removed from the wall and is resting on the counter;
- it is an analog clock stopped at a vague late-night position, with minute hand near 12 and hour hand near 11;
- no readable clock numerals or other text are required.

`scene_p2.md` already makes the clock the focal recurring object at the correct location and does not require a prompt patch unless local generation fails to preserve the authored composition.

If Scene 7 `inner.png` or `old_clock_photo.png` is regenerated, patch its existing `Background Prompt` / `Scene Source Prompt` / `Image Prompt` only as much as needed to preserve the same clock identity. Do not add new story facts.

### Review and verification

- Re-run Axis 5 only for the old-clock continuity item.
- Close the deferred old-clock entry directly in `docs/stories_plan/chapter_1/semantic-content-reaudit.md`; do not depend on the historical `final-cycle-axis-5-visual-background-rerun.md` filename, which is not present in the tree.
- Run the existing scene compiler and Chapter 1 background-cue audit.
- Run a one-off PNG header/chunk inspection copied from the existing story-scene hardening recipe; do not add a new script.

### Out of scope

- No changes to culprit, motive, death time, evidence packages, proof order, unlocks, reveal ladder, or sealed-reveal timing.
- No dialogue or narration rewrite.
- No new evidence asset, hotspot, scene tag, asset ID, renderer behavior, layout contract, compiler feature, runtime feature, or asset framework.
- No regeneration of `investigation_scene_3` corridor/inner views solely for this ticket; their authored prompts do not depict the clock.
- No unrelated Chapter 1 background regeneration.
- No full Chapter 1 semantic re-audit.
- No Chapter 2 work.

## Design Decision

Use a **four-surface identity family with reference-first regeneration**.

The clock remains baked into backgrounds and the existing evidence icon. No sprite or overlay is introduced.

The identity is chosen **before the first generation**, not by declaring whichever fresh `scene_p2` output happens to be generated first as authoritative.

Implementation first inspects all four current rasters, then records a short identity sheet:

- casing / rim shape and material;
- dial treatment;
- hand style;
- age, wear, discoloration, and one or two distinctive imperfections;
- overall proportions.

Choose the most distinctive existing identity that can plausibly serve all three physical states:

1. mounted and operating before the murder;
2. mounted and stopped during Scene 7;
3. removed and resting on the counter in Scene 11.

`scene_p2/tag_002` is the first named output, but not automatically the identity authority.

This shape is preferable to the alternatives:

- **Only regenerate Scene 11:** leaves the seed/inspection/evidence chain free to contradict the payoff.
- **Regenerate only P2 + Scene 11:** can mint a consistent new pair while the actual inspection and Case File photo remain different clocks.
- **Rewrite story text around existing art:** reopens continuity HPA-561 already fixed.
- **Add a clock sprite/overlay:** creates rendering/composition machinery for a four-image prop-continuity problem.
- **Add image similarity/CV tests:** disproportionate automation for one bounded visual family.

## Visual Continuity Contract

### Shared clock identity

Every accepted clock surface must share the same visible identity:

- same casing / rim silhouette and material;
- same dial styling;
- same hand design;
- same age, wear, discoloration, and distinctive imperfections;
- same overall proportions.

These traits are continuity anchors, not new evidence. The player should recognize the prop without a UI label explaining that it is the same clock.

### Time depiction rule

Do not render literal `22:59`, readable numerals, a digital display, or other clock-face text.

Lyra's asset policy forbids readable text, and Scene 7 already solves the story requirement by using a vague late-night analog position.

For the stopped state:

- analog minute hand points near 12;
- analog hour hand points near 11;
- face markings, if present, remain non-readable ticks/shapes rather than legible numerals;
- authored dialogue and evidence copy carry the exact `22:59` interpretation.

The pre-murder P2 plate does not need to show an exact time or visually prove that the clock is slow. Dialogue/action own that fact.

### `scene_p2/tag_002` — ordinary-day seed

Preserve the authored composition:

- eye-level medium-wide view from the corridor mouth;
- narrow café back corridor leading to the inner-storage entrance;
- recurring old clock mounted on the entrance's inner wall near stacked supplies;
- quiet operational afternoon mood;
- no foreground dialogue characters;
- no readable text;
- lower composition remains usable by dialogue UI.

Its visual job is to establish the physical clock in its normal place before the murder.

### `investigation_scene_7/inner.png` — inspection state

This is a mandatory identity sibling because it is the interactive surface where the old-clock hotspot is examined.

If regeneration is required, preserve:

- cold inner storage room;
- high metal shelves and hard sensor light;
- clock mounted on the inner-storage entrance wall and visible without being covered by baked 黑瀨徹;
- shelf impact mark and all current hotspot landmarks;
- existing standee floor clearance and perspective;
- same clock identity as P2;
- vague late-night stopped-hand position only, with no readable numerals.

Do not move the clock to the storage back wall or invent a second clock.

### `old_clock_photo.png` — Case File evidence state

This is the collected photograph of the same Scene 7 object, not a generic clock illustration.

If regeneration is required, preserve the existing evidence workflow:

- isolated photo-print / evidence-icon composition;
- same casing, dial, hands, wear, and distinctive imperfection as the mounted clock;
- analog hands in the same vague late-night stopped position;
- no readable numerals or timestamp text;
- transparent `512x512` evidence canvas.

### `scene_11/tag_002` — aftermath payoff

Preserve:

- empty Rain Bell café interior in soft afternoon light;
- quiet post-case stillness and existing latte/counter context where compatible;
- the same old clock now removed from the inner-storage entrance wall and resting naturally on the counter;
- analog hands in the same vague stopped position: minute hand near 12, hour hand near 11;
- no people, logos, watermark, readable clock numerals, or other text;
- lower composition usable by dialogue UI.

The prop must not look like a decorative replacement or a different clock introduced for the ending.

## Prompt Ownership

Authored prompt lines remain the durable semantic source of truth because the compiler copies the authored background prompt into the generated asset request.

### Required patch: Scene 11

Patch `scene_11.md` unconditionally. The current generic phrase `old wall clock resting on the counter` is insufficient for future regeneration.

Use semantic wording equivalent to:

> Empty Rain Bell cafe interior in afternoon light, a latte cup on a wooden table, the same recurring old analog wall clock from the back-corridor inner-storage entrance now removed and resting on the counter, matching its distinctive aged casing and dial, hands stopped at a vague late-night position with minute hand near 12 and hour hand near 11, no readable clock numerals or text, quiet unresolved stillness.

Exact copy may be adjusted for natural prompt style, but those semantics are required.

### P2 prompt

Keep the current `scene_p2` prompt unless visual generation proves it cannot satisfy the authored corridor/entrance composition. It already names the old clock as the focal object at the correct place and forbids readable text.

### Scene 7 / evidence prompts

If either sibling is regenerated, tighten its existing prompt to include the chosen identity traits and same-clock relationship while keeping the existing vague/unreadable time rule.

Do not put filesystem paths, asset IDs, or new story exposition into authored Markdown.

## Asset Generation Workflow

Follow `.claude/skills/generating-lyra-image-assets/SKILL.md` and the system image-generation skill it references.

1. Inspect these four files side by side before writing prompts:
   - `scene_p2/tag_002.png`
   - `investigation_scene_7/inner.png`
   - `old_clock_photo.png`
   - `scene_11/tag_002.png`
2. Record the selected clock identity traits and the intended state/composition delta for each surface.
3. Patch the required Scene 11 prompt.
4. Generate/regenerate `scene_p2/tag_002.png` to the authored corridor/entrance composition using the selected identity.
5. Generate/regenerate `scene_11/tag_002.png` with that same identity in the removed/counter state.
6. Compare both new backgrounds with Scene 7 and the evidence photo.
7. If Scene 7 or the evidence photo does not match, regenerate it now and patch only its relevant authored prompt if needed.
8. Re-inspect the complete four-surface family. Identity mismatch is a rejection condition: regenerate, and if repeat generation drifts because the authored prompt is underspecified, strengthen the prompt in this PR. Do not accept the mismatch as a follow-up.
9. Normalize using existing policy:
   - backgrounds: opaque PNG, exactly `1920x1080`;
   - evidence: RGBA/transparent PNG, exactly `512x512`;
   - preserve aspect ratio; no non-uniform stretching.

Use the built-in image-generation path by default. Do not introduce a new asset pipeline or CLI/API fallback beyond the repo-documented workflow and its existing approval rules.

## Acceptance Criteria

### Four-surface identity

- P2, Scene 7 `inner`, the Case File photo, and Scene 11 all depict one recognizable clock.
- Casing, dial, hands, wear, and proportions are continuous across all accepted surfaces.
- Scene 7 remains the same manager-mentioned clock at the inner-storage entrance.
- The evidence icon visibly belongs to the Scene 7 clock.
- Scene 11 visibly shows that same clock after removal.
- No accepted raster depends on readable numerals or a literal rendered `22:59`.
- Stopped analog hands read only as a vague late-night position: minute hand near 12, hour hand near 11.

### Scene composition

- P2 retains the corridor-mouth / inner-storage-entrance composition.
- Scene 7 retains hotspot landmarks, room geometry, baked 黑瀨 placement, and clock visibility.
- Scene 11 retains the quiet café aftermath composition and dialogue-safe lower area.
- Evidence remains an isolated evidence icon/photo-print rather than a background scene.

### Asset policy

- Touched backgrounds are opaque `1920x1080` PNGs.
- If touched, `old_clock_photo.png` is transparent/RGBA `512x512`.
- Existing asset paths and semantic IDs remain unchanged.
- No unrelated Chapter 1 raster is regenerated.

### Mechanical verification

Run:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Both must exit 0 with no new warnings or cue/report drift attributable to HPA-602.

These commands do **not** prove clock identity; side-by-side visual review remains the acceptance owner.

### One-off PNG verification

Reuse the existing portable Python standard-library PNG-header/chunk approach from `docs/superpowers/plans/2026-08-05-story-scene-semantic-review-hardening-implementation-plan.md`. Do not add a repository script.

The implementation plan must provide the exact command and assert:

- each touched background: `1920x1080`, no alpha color type, no `tRNS` chunk;
- touched evidence, if regenerated: `512x512`, alpha-capable RGBA/transparent output according to the evidence policy.

### Axis 5 closeout

Record the HPA-602 rerun directly in `docs/stories_plan/chapter_1/semantic-content-reaudit.md`:

- list the four surfaces inspected;
- list which surfaces were regenerated;
- record the chosen identity traits;
- record the Scene 11 prompt hardening;
- record PNG-policy verification;
- record `scenes:compile` and `background-cues:audit` results;
- mark the old-clock deferred item resolved with Axis 5 clock-item verdict `SHIP`.

Do not create a replacement `final-cycle-axis-5-visual-background-rerun.md` solely to satisfy the stale historical filename.

## Expected File Surface

Always expected:

- `docs/stories_plan/chapter_1/scene_11.md`
- `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- `docs/stories_plan/chapter_1/semantic-content-reaudit.md`

Conditional only if visual inspection says they do not match the accepted identity:

- `docs/stories_plan/chapter_1/investigation_scene_7.md`
- `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- `static/assets/evidence/old_clock_photo.png`

`scene_p2.md` changes only if the existing prompt proves insufficient to reproduce its already-authored corridor composition.

Generated runtime resource JSON remains untracked and is never hand-edited.

## Testing Philosophy

No new unit, component, Rust, packaged E2E, image-similarity, CV, screenshot, or prop-continuity framework is justified.

The production risk is visual identity and asset-policy drift, so verification stays at the owning boundaries:

- four-surface side-by-side visual acceptance;
- exact PNG dimensions/transparency policy via one-off scan;
- scene compilation;
- existing background-cue coverage check;
- Axis 5 clock-item closeout recorded in the existing re-audit document.

## Retry / Failure Rule

Do not close HPA-602 with a known clock-identity mismatch.

If generation drifts:

1. reject the output and regenerate using the selected identity/reference;
2. if the same drift repeats because the authored prompt is too generic, strengthen only that surface's semantic prompt;
3. regenerate again;
4. only accept when the four-surface family reads as one prop.

No new follow-up ticket is created for an identity mismatch discovered during HPA-602.

## Single-PR Boundary

HPA-602 is delivered as one PR. The same branch carries the approved design, implementation plan, required Scene 11 prompt hardening, named regenerated backgrounds, any mismatching mandatory siblings, re-audit closeout, and verification evidence. There is no separate asset PR or second continuity PR for this ticket.