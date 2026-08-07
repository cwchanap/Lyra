# HPA-561 Chapter 1 Semantic Content Re-audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply HPA-561's hardened speaker, narration, expression, portrait, and background-variety rules to every production Chapter 1 scene listed in the manifest at execution time, fix every Blocker/Important finding, and preserve Minor/deferred findings in a durable report.

**Architecture:** Freeze `docs/stories_plan/chapter_1/chapter.md` at audit start and use that snapshot as the corpus authority. Run structural compiler/asset checks first, then hardened semantic review across all manifest-listed scene types, including production analysis scenes automatically if HPA-265 has landed. Record findings before editing, make only finding-driven corrections, rerun focused checks after each batch, and finish with a full manifest review with zero open Blocker/Important findings.

**Tech Stack:** Markdown story sources, TypeScript scene compiler, YAML asset catalog, compiled scene JSON, Lyra review/writing skills, Bun scripts.

## Global Constraints

- HPA-259 is merged and `analysis` is a real compiler scene type.
- Freeze the current manifest at audit start; do not rely on the historical 16-file list.
- Include any manifest-listed production `analysis_scene_*.md` automatically; exclude synthetic HPA-259 fixtures.
- Record every Blocker/Important finding before editing it.
- Fix every Blocker/Important or explicitly accept it with evidence.
- Preserve Minor/deferred items instead of broad rewriting.
- Do not alter culprit, case logic, evidence packages, unlock chains, scene order, sealed-lore timing, or reveal ladder except for a narrowly scoped accepted correction.
- Do not reimplement HPA-259 hidden-answer/threshold semantics.
- HPA-552 owns the dedicated analysis authoring skill.
- Background findings are governed by `docs/stories_plan/chapter_1/background-variety-audit.md`.

---

### Task 1: Freeze the production manifest and create the audit ledger

- [ ] Read `docs/stories_plan/chapter_1/chapter.md` and copy its exact ordered scene list into `docs/stories_plan/chapter_1/semantic-content-reaudit.md` with audit date/ruleset.
- [ ] Classify each entry as linear, investigation, interrogation, or analysis.
- [ ] Add ledger columns:

```markdown
| ID | Severity | Path:line | Scene/block | Rule area | Offending text | Authority | Why it matters | Remediation | Disposition |
|---|---|---|---|---|---|---|---|---|---|
```

- [ ] Initialize final counters as pending and commit the empty ledger before review edits.

---

### Task 2: Run structural speaker/portrait baseline checks

- [ ] Run `bun run scenes:compile` and capture relevant Chapter 1 diagnostics.
- [ ] For every scene type, verify each dialogue speaker is cataloged, reserved `旁白`, or declared Local Speakers.
- [ ] If production analysis exists, cover Intro, all board Result Dialogue blocks, and Outro.
- [ ] Compare authored intent with compiled portraits; record unexpected `portrait: null`, wrong IDs/expressions, or missing reusable asset warnings.
- [ ] Write findings into the ledger before editing and commit baseline findings.

---

### Task 3: Audit narration ownership across the complete frozen corpus

- [ ] Enumerate every `旁白` line across all dialogue-bearing containers, not only top-level Intro/Outro.
- [ ] Classify each as allowed transition/unavailable-information/intentional voiceover or as visible action/atmosphere/object state/present-character conclusion that should be reassigned.
- [ ] Record exact quote, path/line, authority, severity, and remediation direction before any rewrite.
- [ ] Group repeated root causes without hiding individual occurrences.
- [ ] Commit narration findings.

---

### Task 4: Audit expression choreography against the actual catalog

- [ ] Build a per-character available-slug reference from `static/assets/config/characters.yaml`.
- [ ] Compare bracketed state, dialogue tone, authored expression, and configured slugs at meaningful transitions.
- [ ] Mark Important only when a suitable configured slug is ignored across a material transition or an authored slug contradicts the state.
- [ ] Keep standard-only/calm/cosmetic opportunities Minor or no finding.
- [ ] Include production analysis Intro/Result/Outro if present.
- [ ] Record findings before edits and commit them.

---

### Task 5: Cross-check the background-variety audit

- [ ] Read `docs/stories_plan/chapter_1/background-variety-audit.md` and verify every applicable player-visible production scene is represented.
- [ ] If production analysis exists, verify its scene-tag cues are covered.
- [ ] Record Important when an accepted Priority A change is not integrated.
- [ ] Verify continuity after accepted changes and preserve Priority B as deferred.
- [ ] Commit cross-check findings.

---

### Task 6: Triage and fix every Blocker/Important finding

- [ ] Deduplicate root causes while preserving every source occurrence.
- [ ] Fix identity/speaker-contract findings first: labels, Local Speakers metadata, reusable catalog treatment, explicit missing asset work.
- [ ] Fix narration ownership using the smallest local correction: visible info -> brackets; character-owned interpretation -> character dialogue; preserve legitimate voiceover.
- [ ] Fix expression findings using existing slugs unless a separately accepted asset addition is required.
- [ ] Fix only accepted Priority A background integration gaps.
- [ ] Update each finding disposition immediately after the fix.
- [ ] Run `bun run scenes:compile` after each logical fix batch and commit focused batches separately where practical.

---

### Task 7: Re-review affected scenes and close regressions

- [ ] Re-run relevant review axes on every changed scene; at minimum Axis 3 and Axis 5.
- [ ] Add newly discovered findings before additional edits; no silent cleanup.
- [ ] Resolve any new Blocker/Important using Task 6's process.
- [ ] Keep report counters provisional until the final full-corpus pass.

---

### Task 8: Run final full-manifest semantic gate

- [ ] Run:

```bash
bun run scenes:compile
bun run check:scripts
bun run test:scripts
bun run format:check
```

- [ ] Run hardened standalone semantic review over the complete frozen manifest, recognizing all four scene types without an ephemeral cast table.
- [ ] If a production analysis scene is present, confirm Intro / all Result Dialogue / Outro were included in speaker/narration/expression review and its scene-tag backgrounds were cross-checked.
- [ ] Set final counters to:

```text
Open Blockers: 0
Open Important: 0
Minor/deferred: <count with ledger entries>
```

- [ ] Inspect changed story files and confirm no unrelated culprit, timeline, evidence-package, unlock-chain, scene-order, or sealed-reveal changes.
- [ ] Commit final audit state.

## Plan Self-Review

- Manifest-driven scope survives HPA-265 replacing Beat 8.5.
- HPA-259 analysis dialogue is audited when production content exists; hidden board semantics are not redundantly reimplemented.
- Findings are recorded before fixes.
- Blocker/Important close; Minor remains visible.
- No broad literary rewrite or Chapter 2 audit is introduced.
