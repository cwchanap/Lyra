# HPA-561 Chapter 1 Semantic Content Re-audit Design

## Status

Approved HPA-561 companion design, refreshed for the merged HPA-259 baseline.

This workstream applies HPA-561's hardened speaker, narration, expression, portrait, and background-variety rules to the **production Chapter 1 manifest that exists when the audit runs**.

## Goal

Re-review existing Chapter 1 authored content after the new rules land, record source-cited findings before editing, fix every Blocker and Important finding, preserve Minor/deferred items, and avoid turning the task into a broad literary rewrite.

## Post-HPA-259 baseline

The repository now supports four scene types, including `analysis`.

Production Chapter 1 still currently lists the historical 16 files and still uses `scene_8_5.md`, but HPA-265 may replace that file with `analysis_scene_8_5.md` later.

Therefore the re-audit does not permanently hard-code a 16-file list.

At execution start:

1. read `docs/stories_plan/chapter_1/chapter.md`;
2. copy the exact ordered scene list into the audit report;
3. treat that frozen manifest as the corpus authority for the entire re-audit;
4. audit every listed scene regardless of scene type.

Synthetic HPA-259 fixtures are excluded.

## Audit deliverable

Create `docs/stories_plan/chapter_1/semantic-content-reaudit.md` with manifest snapshot, ruleset/date, findings ledger, dispositions, and final severity counts.

Required final state:

```text
Open Blockers: 0
Open Important: 0
Minor/deferred: documented
```

## Scene-type coverage

### Linear
Audit the complete queue.

### Investigation
Audit Intro, sub-location transitions, hotspot inspect/reexamine, character topic/reexamine, evidence On Collect/Reexamine, statement On Acquire/Reexamine, and Outro.

### Interrogation
Audit Intro, phase entry dialogue, testimony loops, challenge/correct/wrong dialogue, authored result/reveal dialogue, and Outro.

### Analysis
If a production `analysis_scene_*.md` is manifest-listed, audit Intro, each board Result Dialogue, and Outro.

HPA-561 does not re-review HPA-259 hidden accepted answers, threshold math, or board validation unless a semantic story/canon issue directly exposes a problem.

## Audit dimensions

### Speaker/local/portrait contract
- exact catalog labels for reusable speakers;
- valid Local Speakers intent for true one-shot faceless speakers;
- no reusable/case-significant character incorrectly declared local;
- reserved `旁白` handling;
- compiled `portrait: null` matches authored intent;
- missing reusable portrait files remain explicit asset work.

### Narration ownership
Every `旁白` line must be true transition, unavailable information, or intentional voiceover. Flag visible action/atmosphere/object state better expressed in brackets and present-character conclusions/judgments/reactions better owned by the character.

### Expression choreography
Check only actual slugs in `characters.yaml`. Important requires a suitable existing non-standard slug ignored across a meaningful transition or an authored expression that contradicts the state. Standard-only or calm scenes are not Important merely for staying standard.

### Background-variety integration
Cross-check `docs/stories_plan/chapter_1/background-variety-audit.md`: applicable cues are covered, accepted Priority A changes are integrated, continuity remains coherent, and no unnecessary image changes are demanded just to satisfy variety. Production analysis scene tags are included automatically if present.

## Severity policy

**Blocker:** material identity/canon/viewpoint/player-understanding failure.

**Important:** unresolved visible reusable portrait treatment, cataloged label drift, major narrator fallback, meaningful ignored expression despite an available slug, or unimplemented accepted Priority A background issue.

**Minor/deferred:** polish without material comprehension/identity/canon/pacing impact.

## Finding format

Every finding records ID, severity, exact authored path+line, scene/block, rule area, offending quote, authority, why it matters, remediation direction, and final disposition. Do not edit before the finding is recorded.

## Editing boundary

Finding-driven fixes may change Local Speakers metadata, speaker labels, narration/bracket ownership, expression annotations, reusable portrait catalog/assets, and accepted Priority A background prompts/assets.

They must not change culprit, case logic, evidence packages, reveal ladder, unlock chains, scene order, sealed-lore timing, or Chapter 1 canon beyond the minimal accepted correction.

## Relationships

- HPA-259 is merged baseline; its analysis parser/board correctness is not reimplemented.
- HPA-552 owns the dedicated analysis authoring skill; semantic review must still understand analysis scenes directly.
- HPA-265 may replace the production Beat 8.5 transition. The manifest-driven audit automatically handles either `scene_8_5.md` or `analysis_scene_8_5.md` and is not blocked by HPA-265.

## Acceptance criteria

- The report freezes the production Chapter 1 manifest at execution time.
- Every manifest-listed scene is audited regardless of scene type.
- Production analysis scenes are automatically included if present; synthetic HPA-259 fixtures are excluded.
- Every applicable file is audited for speaker/portrait contract, narration ownership, expression choreography, and background-audit integration.
- Every finding cites exact authored path and line and is recorded before editing.
- All Blocker and Important findings are fixed or explicitly accepted with evidence.
- Final full-corpus review reports zero open Blocker and Important findings.
- Minor/deferred findings remain documented.
- Fixes stay finding-driven and do not become an unrelated Chapter 1 rewrite.
- Canon, evidence logic, unlock chains, reveal timing, and scene order remain intact.
