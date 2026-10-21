---
name: generating-lyra-voice-clips
description: Use when generating, regenerating or shipping Lyra's Japanese voice clips with ElevenLabs (voice:generate), from the budget estimate through the pilot scene, the full chapter run, listening QA and the clips PR.
---

# Generating Lyra Voice Clips

## Overview

`voice:generate` turns a chapter's translated Japanese script into one
`static/assets/voice/ja/<clip>.ogg` per voiced line. Every run spends the
owner's ElevenLabs credits, so it has two owner gates: the cast (who speaks)
and the budget (how many characters). This skill starts after translation and
casting, which `voicing-lyra-dialogue` owns.

Generation runs on the owner's Mac through a Remote Control session. Cloud
threads have no API key and cannot reach ElevenLabs; they prepare the scripts,
run the dry-run and review the result.

## 0. Gates

Do not start a paid run until all of these hold:

| Gate | Where it is recorded |
| --- | --- |
| Every role to voice is `status: approved` with the owner's exact `voiceId` | `static/assets/config/voice_cast.yaml` |
| Each approved role has a cast record comment (date, voice name, how it was picked) | the comment above the role's `status` |
| The owner said OK to the dry-run total for this run, in their own words | the thread |

A pick from library samples counts once the owner names the exact voice for
that role. "These sound fine" is not a pick; ask which one.

## 1. Record the cast

When the owner picks, in `voice_cast.yaml` for each role:

1. Set `voiceId` to the picked ID and `status: approved`.
2. Put the picked voice first in `candidates` (add it if the owner found it
   outside the shortlist), keeping the rest of the shortlist for reference.
3. Above `status`, write the cast record:

   ```yaml
   # Cast record: picked by the owner on 2026-10-21 from library samples.
   # Kenzo: calm, young male voice. The owner found it in the voice
   # library, outside the shortlist below.
   status: approved
   ```

   Say where the pick came from (library samples or `voice:audition`) and
   one line on what the voice is. A later recast replaces the record and
   adds what changed and why.

4. `bun run voice:sync chapter_<N>` gives the approved roles' translated
   lines clip IDs (`ch<N>_<characterId>_<nnnn>`, never renumbered or
   reused). Commit the cast file and scripts together.

Changing an approved role's `voiceId`, `settings` or `seed` changes every
one of its clips' `ttsHash`, so the next run regenerates that whole role.
Estimate that run like any other.

## 2. Prepare the Mac

In the Remote Control session on the owner's checkout:

1. Check out the PR branch and `bun install`.
2. `ffmpeg -hide_banner -encoders | grep libvorbis` must list the encoder;
   without it every clip fails at transcoding.
3. The key is `ELEVENLABS_API_KEY` in `packages/scripts/.env` (gitignored)
   or the environment. Never print it, commit it, or paste it in a thread.
4. Each picked voice must be in the account's My Voices (ElevenLabs Voice
   Library, Add to My Voices). A library voice that is not added can fail
   on its first clip with a voice-not-found error. Adding one takes a voice
   slot.

## 3. Estimate

```bash
bun run voice:sync chapter_<N>            # must change nothing
bun run voice:validate chapter_<N> --strict
bun run voice:generate chapter_<N> --dry-run
```

`voice:generate` refuses when `voice:sync` would still change the scripts.
The dry-run needs no key; its last line is
`<N> clips, <chars> characters (<k> already current)`. The character total is
roughly the credit cost. Post it with the scope (pilot scene or whole
chapter) and wait for the owner's OK on that amount. Narrow a run with
`--scene <file.md>`, `--speaker <characterId>` or `--only <clip>` and
dry-run the same flags.

## 4. Pilot one scene

1. `bun run voice:generate chapter_<N> --scene <scene>.md` on a scene where
   every voiced role speaks with some emotion.
2. `bun run scenes:compile`, then the owner plays it in
   `bun run dev:game` with Settings > VOICE on.
3. Tune what the owner flags, cheapest fix first:
   - A misread name or term: its glossary `reading`
     (`docs/stories_plan/ja_glossary.yaml`).
   - One line misread: that line's `voice.tts`.
   - Wrong emotion on one line: that line's `voice.direction`.
   - Wrong emotion for an expression across the role:
     `expressionDirections`.
   - The voice too flat or unstable: the role's `settings`
     (`stability`, `style`, `speed`). This regenerates the whole role.
4. Dry-run again, get the OK, regenerate. Unchanged clips are skipped by
   `ttsHash`.

## 5. Run the chapter

1. `bun run voice:generate chapter_<N>` after the OK on the chapter total.
2. Each finished clip writes its `ttsHash` and `generatedAt` into the
   script, so an interrupted run resumes where it stopped. Re-run the same
   command; a take that was downloaded but not recorded is reused from
   `packages/scripts/.voice-cache/`.
3. Exit codes:

| Code | Meaning | Do |
| --- | --- | --- |
| 0 | Done | QA |
| 1 | A clip failed (network, voice not found, ffmpeg) | Read the message, fix the cause, re-run the same command |
| 2 | Usage or script diagnostics, or no API key | Fix and re-run |
| 3 | Billing or quota | Stop. Ask the owner to top up or enable API billing. Never retry with `--force` |

## 6. Listen

Listen to every new clip in game, not only in a file browser. Check names and
kanji readings, the emotion against the scene, clipped starts or endings, and
loudness against the neighbouring lines. Fix as in step 4, then
`bun run voice:generate chapter_<N> --only <clip>`. Use `--force` only with
`--only` to take a new performance of a line whose inputs did not change.

## 7. Ship

1. `bun run voice:validate chapter_<N> --strict`
2. `bun run scenes:compile` shows no `voiceClipMissing` warning for the
   chapter.
3. `bun run test:scripts` and `bun run check:scripts`.
4. Commit the clips, the scripts (their `ttsHash` and `generatedAt`) and any
   cast or glossary change together. Never commit `.voice-auditions/`,
   `packages/scripts/.voice-cache/` or `packages/scripts/.env`.
5. Open the PR and mark it ready (CI skips drafts). Say which roles and
   scenes were voiced and the characters spent.

## Red flags

| Thought | Reality |
| --- | --- |
| "Their voice is obvious, approve it" | Only the owner's named pick makes a role `approved`. |
| "They said it sounds good, run the chapter" | A paid run needs the owner's OK on the dry-run total. |
| "Exit 3, retry with `--force`" | Billing or quota. Stop and ask the owner. |
| "Regenerate the chapter with `--force` to be safe" | It spends credits on unchanged lines. Use `--only`. |
| "Tweak `settings` to fix one line" | It regenerates the whole role. Use `direction` or `tts`. |
| "Commit the cache so the next run is free" | The cache and auditions stay gitignored. |
| "Skip the pilot, the samples sounded right" | Samples are not our lines. Pilot one scene first. |
| "Run it from the cloud thread" | No key there. Generation runs on the owner's Mac. |
