---
name: designing-lyra-sound-assets
description: Use when designing Lyra chapter BGM, BGS, or SFX plans before audio catalog updates, scene cue application, or ElevenLabs generation.
---

# Designing Lyra Sound Assets

## Overview

Design chapter audio as YAML: reusable catalog sounds, proposed BGM/BGS/SFX,
and approved BGM/BGS cue targets. Never generate, call ElevenLabs, edit
markdown, or return only chat.

## When to Use

Use for planning, revision, approval triage, validation prep, or reuse decisions
before `audio:apply` / `audio:generate`. Do not use for generation, catalog
writes, prose edits, or applying approved plans.

## Quick Reference

| Pressure | Required response |
| --- | --- |
| "Quick list" | Durable YAML shape, not dotted-ID bullets. |
| "Good sounds approved" | `proposed` unless exact entry IDs were approved. |
| "Generate/apply now" | No `audio:generate`; apply only after explicit approval. |
| "Add SFX cues" | Keep SFX in `entries` / `rejected`; never in `cues`. |
| "Reuse existing" | Read catalog/files and record `catalogSnapshot`. |

## Inputs

Read one root: `docs/stories_plan/chapter_<N>/` or
`static/stories_plan/chapter_<N>/`, plus its `chapter.md`, manifest scenes,
`static/assets/config/audio.yaml`, `static/assets/audio/**`, and any existing
plan.

Evidence must be actual file contents and line numbers. Do not infer unlisted
scenes.

## Output

Write `docs/audio_plans/chapter_<N>.sound-plan.yaml` with:
`schemaVersion: 1`, `chapterId`, `sources`, `catalogSnapshot`, `entries`,
`cues`, and `rejected`.

`catalogSnapshot` records existing `bgm`, `bgs`, and `sfx` IDs, including empty
arrays. Entries need snake_case `id` with no dots/prefix, `channel`, `status`,
`loop`, `intendedDurationSeconds`, English `prompt`, `reuseRationale`, and
evidence `{ file, line, note }`. Use `approved` only for exact user-approved
IDs; otherwise use `proposed`.

## Minimal YAML Example

```yaml
schemaVersion: 1
chapterId: chapter_1
sources:
  - docs/stories_plan/chapter_1/chapter.md
catalogSnapshot: { bgm: [], bgs: [], sfx: [] }
entries:
  - id: street_rain_awning
    channel: bgs
    status: proposed
    loop: true
    intendedDurationSeconds: 60
    prompt: Seamless awning rain, no voices.
    reuseRationale: No catalog match; reusable rain BGS.
    evidence:
      - { file: docs/stories_plan/chapter_1/scene_6.md, line: 3, note: rain under awning }
  - id: phone_alert_vibration
    channel: sfx
    status: proposed
    loop: false
    intendedDurationSeconds: 1
    prompt: Muted phone vibration.
    reuseRationale: Emphasized feedback accent.
    evidence:
      - { file: docs/stories_plan/chapter_1/scene_6.md, line: 24, note: phone alert }
cues:
  - { file: docs/stories_plan/chapter_1/scene_6.md, visualUnit: tag_001, bgs: street_rain_awning }
rejected:
  - { file: docs/stories_plan/chapter_1/scene_6.md, line: 18, sound: ordinary footsteps, reason: incidental movement }
```

## Rules

- `cues` may contain only approved/generated `bgm` and `bgs`; never `sfx`.
- `visualUnit` must identify an existing scene tag or visual unit.
- BGM is sparse major-beat music; BGS is acoustic environment; SFX is only for
  emphasized, repeated, or player-feedback actions.
- Stage directions are evidence, not automatic sound requests.
- Prefer reuse; reject incidental footsteps, prop handling, clothing rustle,
  rain already covered by BGS, and similar texture.

## Red Flags

Stop if you would return chat-only bullets, use dotted IDs, omit required keys,
mark vague approval as `approved`, add SFX under `cues`, invent evidence, call
ElevenLabs, or run `audio:generate`.

## Verification

After writing a plan, run:

```bash
bun run audio:validate docs/audio_plans/chapter_<N>.sound-plan.yaml
```

Report validation and entries still needing approval. If it fails, fix the
plan, not scenes, catalog, or generated resources.

## Common Mistakes

- Writing a free-form draft instead of the YAML plan file.
- Encoding channel in the ID, such as `bgm.rain`, instead of `channel: bgm`.
- Omitting `catalogSnapshot`, `rejected`, or real evidence lines.
- Treating SFX as cueable scene metadata in v1.
