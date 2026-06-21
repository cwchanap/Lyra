---
name: designing-lyra-sound-assets
description: Use when designing Chapter-level BGM, BGS, or SFX plans for Lyra story markdown before audio catalog updates or ElevenLabs generation.
---

# Designing Lyra Sound Assets

## Purpose

Create or update durable sound plans for Lyra chapters. This skill is
plan-first: it decides what sounds should exist, what existing sounds can be
reused, and where approved `BGM` / `BGS` cues should apply.

Write a durable YAML plan in the repo. Do not leave the result as a chat-only
draft. This skill never calls ElevenLabs, never runs paid generation, and does
not edit scene markdown directly.

## Inputs To Read

For one chapter, read:

- `docs/stories_plan/chapter_<N>/chapter.md`
- every scene file listed in that manifest
- `static/assets/config/audio.yaml`
- existing files under `static/assets/audio/**`
- `docs/audio_plans/chapter_<N>.sound-plan.yaml` if it already exists

Use actual file contents as evidence. Do not infer scene files outside the
manifest, and do not cite guessed line numbers.

## Output

Write or update:

```text
docs/audio_plans/chapter_<N>.sound-plan.yaml
```

The YAML plan must include:

- `schemaVersion: 1`
- `chapterId`
- `sources`
- `catalogSnapshot`
- `entries`
- `cues`
- `rejected`

`catalogSnapshot` must record the existing catalog IDs available during
planning, separated into `bgm`, `bgs`, and `sfx` arrays. Include empty arrays
when a channel has no current entries.

Every proposed or reused entry needs:

- plain snake_case `id` with no channel prefix and no dots
- `channel`: `bgm`, `bgs`, or `sfx`
- `status`: usually `proposed`; use `approved` only if the user explicitly
  approved that exact entry
- `loop`
- `intendedDurationSeconds`
- English generation `prompt`
- `reuseRationale`
- `evidence` with actual scene file paths, line numbers, and short notes from
  the read scenes

Use the separate `channel` field for channel identity. For example, use
`id: rain_street_light` with `channel: bgs`, not
`id: bgs.rain_street_light`.

## Cue Rules

`cues` may contain only `bgm` and `bgs` assignments in v1. Do not write `sfx`
fields in `cues`, and do not place SFX cue metadata into scene markdown.

Only cue approved or generated `bgm` / `bgs` entries. Keep unapproved sound
ideas in `entries` with `status: proposed`, or in `rejected` when the sound
should not be produced.

`visualUnit` must identify the visual unit the existing audio tooling can apply
to, such as a scene tag or sub-location visual unit from the read markdown.

## Sound Rules

- `BGM` is sparse and chapter-palette-driven.
- `BGM` changes only at major story beats.
- `BGS` is a location or mood pool.
- `BGS` changes only when the acoustic environment meaningfully changes.
- `SFX` is only for brief actions that are narratively emphasized, repeated, or
  useful as player feedback.
- Stage directions are evidence, not automatic sound requests.
- Prefer existing `audio.yaml` entries and existing files before proposing new
  generation.
- List rejected incidental sounds so later agents do not re-propose them.

Reject incidental stage-direction sounds that would create noisy one-shot
coverage: ordinary footsteps, single prop movements, clothing rustle, door
handling, generic rain mentions already covered by a BGS pool, and other
non-emphasized texture.

## Boundaries

- Do not run `audio:generate`.
- Do not call ElevenLabs.
- Do not edit scene markdown.
- Do not add `SFX` cues to scene markdown in v1.
- Do not add filesystem paths to authored story markdown.
- Writers author sound intent and English prompts, never generated file paths.
- Use `audio:apply` only after explicit user approval when the task asks to
  apply a validated, approved plan. This skill by itself only designs the plan.

## Verification

After writing a plan, run:

```bash
bun run audio:validate docs/audio_plans/chapter_<N>.sound-plan.yaml
```

Report the validation result and list entries still needing human approval. If
validation fails, fix the YAML plan first; do not compensate by editing scene
markdown, the catalog, or generated resources.

## Common Mistakes

- Returning a free-form chat draft instead of writing the YAML plan file.
- Using dotted IDs such as `bgm.rain_noir_investigation` instead of
  `id: rain_noir_investigation` plus `channel: bgm`.
- Omitting `catalogSnapshot` or `rejected`.
- Marking entries `approved` without explicit user approval.
- Adding SFX to `cues` or scene markdown even though v1 supports only planned
  SFX entries.
- Citing approximate or invented line numbers instead of actual file and line
  references from the read chapter scenes.
