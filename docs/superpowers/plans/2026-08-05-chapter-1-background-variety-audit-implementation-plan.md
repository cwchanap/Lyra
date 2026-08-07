# HPA-561 Chapter 1 Background Variety Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit and selectively improve background variety for the production Chapter 1 manifest, including a production analysis scene automatically if one exists when the work runs.

**Architecture:** Freeze `chapter.md` at audit start, enumerate every player-visible background cue from the manifest-listed scene files, group assets by recurring location family, and make one explicit keep/adjust/regenerate/add-variant decision per cue. Implement only Priority A changes with a documented narrative/spatial function. Reuse HPA-259's existing analysis scene asset traversal; do not create synthetic analysis visual work.

**Tech Stack:** Markdown story sources, TypeScript scene compiler, YAML asset policy, PNG backgrounds, Lyra image-generation skill, Bun scripts.

## Global Constraints

- HPA-259 is merged and production baseline supports `analysis` scenes.
- Freeze the current ordered `chapter.md` manifest at audit start and use it as scope authority.
- Include production analysis-scene scene-tag backgrounds if a manifest-listed `analysis_scene_*.md` exists.
- Exclude synthetic HPA-259 fixtures.
- No background-count quota or wholesale regeneration.
- Preserve recurring-location geometry, signature props, palette, and spatial relationships.
- Generate a new variant only for a documented narrative/spatial function.
- Priority A is implemented; Priority B is documented and deferred.
- HPA-552 owns the dedicated analysis authoring skill.

---

### Task 1: Freeze the production corpus and enumerate every background cue

- [ ] Copy the exact ordered `docs/stories_plan/chapter_1/chapter.md` manifest into `docs/stories_plan/chapter_1/background-variety-audit.md`.
- [ ] Classify each entry as linear, investigation, interrogation, or analysis.
- [ ] Enumerate linear scene tags, investigation sub-location/dialogue cues, interrogation phase/dialogue cues, and production analysis Intro/Result/Outro scene tags.
- [ ] Run `bun run scenes:compile` and record each cue's compiled asset ID/path or warning.
- [ ] Add one row per cue using:

```markdown
| Scene/source | Asset ID/path | Location family | Current function | Continuity anchors | Variety finding | Decision | Priority | Proposed function | Disposition |
|---|---|---|---|---|---|---|---|---|---|
```

- [ ] Record missing cues explicitly; do not silently skip them.
- [ ] Commit the inventory before changing prompts/assets.

---

### Task 2: Harden background authoring/review/generation rules

- [ ] Base dialogue skill: require useful prompts to state scene function, camera angle/distance, focal area, continuity anchors, lighting/weather/occupancy, and UI-safe composition where relevant.
- [ ] Investigation skill: sibling sub-locations should be distinct while preserving hotspot readability, standee floor/ground, lower-body clearance, and believable adjacency.
- [ ] Interrogation skill: a new phase background is justified only when the visible environment/dramatic state materially changes.
- [ ] Axis 5 ordering: completeness -> compiled ID/file -> spatial usability -> continuity -> purposeful variety -> same-view false-positive control.
- [ ] Image-generation skill: inspect current + sibling same-location assets and record continuity anchors plus intended delta before generation.
- [ ] Add analysis inheritance note only; do not create HPA-552's dedicated skill.
- [ ] Commit skill changes.

---

### Task 3: Review existing location families and classify each cue

- [ ] Group cues by recurring physical location rather than scene ID.
- [ ] Inspect each family together for entrances, windows, furniture, geometry, signature props, palette/materials, camera distance/angle, focal emphasis, lighting/weather/occupancy.
- [ ] Fill concrete `Current function` and `Continuity anchors` fields.
- [ ] Assign exactly one decision: `keep`, `prompt-adjust`, `regenerate`, `add-variant`.
- [ ] Assign Priority A only for comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, meaningful state change, or canon/continuity failure; otherwise Priority B.
- [ ] Run at least one same-view false-positive control and document why `keep` is correct.
- [ ] Commit classifications before asset changes.

---

### Task 4: Implement only Priority A authored prompt/cue changes

- [ ] For every Priority A row, write the accepted delta in concrete spatial terms before editing.
- [ ] Edit only the corresponding semantic `Background Prompt` or scene cue.
- [ ] Do not add scene tags just to create more art when no visible/narrative state changed.
- [ ] Run `bun run scenes:compile` and record resulting asset IDs/paths in the audit.
- [ ] Commit authored prompt/cue changes separately from PNGs.

---

### Task 5: Generate/regenerate accepted Priority A PNGs

- [ ] Load `.claude/skills/generating-lyra-image-assets/SKILL.md` and `static/assets/config/policy.yaml`.
- [ ] Inspect sibling location-family assets before each generation.
- [ ] Generate only accepted Priority A assets; do not batch speculative Priority B alternatives.
- [ ] Normalize final background files to opaque `1920x1080` PNGs.
- [ ] Review the complete location family together and reject variants that imply a different place.
- [ ] Mark final audit dispositions and commit generated art separately.

---

### Task 6: Verify background-variety workstream

- [ ] Confirm every production background cue in the frozen manifest is represented.
- [ ] Confirm no Priority A row remains unresolved.
- [ ] Confirm Priority B rows remain documented rather than regenerated for quota reasons.
- [ ] Run:

```bash
bun run scenes:compile
bun run format:check
```

- [ ] Scan touched PNG dimensions for exact `1920x1080`.
- [ ] Run final Axis 5 review for completeness, spatial usability, location continuity, purposeful variation, and same-view false-positive behavior.

## Plan Self-Review

- Manifest-driven scope automatically covers a production analysis scene if HPA-265 has landed.
- Synthetic HPA-259 fixtures are never production audit scope.
- No image-count target or similarity classifier is introduced.
- Continuity is preserved before variety.
- Only Priority A art is generated in this ticket.
