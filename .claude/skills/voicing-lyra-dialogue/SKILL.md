---
name: voicing-lyra-dialogue
description: Use when translating Lyra dialogue into the per-scene Japanese script, casting or auditioning ElevenLabs voices, generating or regenerating Japanese voice clips, or checking a chapter's voice coverage.
---

# Voicing Lyra Dialogue

## Overview

Japanese voice is a pipeline of four files and four commands. Each step has an
owner gate: nothing is cast, and no credits are spent, without the owner's
explicit word.

| File | What it holds | Who edits it |
| --- | --- | --- |
| `docs/stories_plan/chapter_<N>/ja/<scene>.ja.yaml` | One entry per unique spoken line: `speaker`, `expression`, `zh`, `ja`, `note`, `voice` | `voice:sync` adds and moves entries; you fill `ja`, `note`, `voice.direction`, `voice.tts` |
| `docs/stories_plan/ja_glossary.yaml` | Japanese names, kana readings, each character's register, style rules | You, when a new name or term appears |
| `static/assets/config/voice_cast.yaml` | Per role: model, settings, seed, expression directions, audition lines, shortlist, picked `voiceId`, `status` | You propose; only the owner's pick makes a role `approved` |
| `static/assets/voice/ja/<clip>.ogg` | Generated clips | Only `voice:generate` |

Commands: `voice:sync`, `voice:validate`, `voice:audition`,
`voice:generate`. The compiler turns scripts plus clips into the generated
`dialogue_locale.ja.json`; never hand-edit that.

## 1. Inputs

Read the chapter's `chapter.md`, the authored scenes it lists, `characters.md`
for each role's profile, the glossary, `voice_cast.yaml`, and the chapter's
existing `ja/` files. Translate only from the authored scene lines that
`voice:sync` lists. Never translate from planning docs or the story bible.

## 2. Sync and translate

1. `bun run voice:sync chapter_<N>` adds an empty entry for every new spoken
   line and moves entries whose Chinese line is gone to the file's `stale`
   list.
2. Fill every empty `ja`:
   - Use the glossary's name, reading and register for each speaker (first
     person, politeness level, sentence endings).
   - Follow the glossary's style rules: full-width punctuation, 「」 quotes,
     …… and ――, clock times as the Chinese writes them.
   - Say no more than the Chinese line says. Do not add foreshadowing,
     explanation, or a spoiler.
   - Keep each line about as short as its source; it shares a dialogue box.
   - Read the scene around the line, not the line alone.
3. For a whole chapter, use one subagent per scene, then do one review pass
   across scene boundaries for consistent names, terms and registers.
4. A stale entry: if its Japanese still fits the new Chinese line, move the
   translation to the new entry; otherwise retranslate. Then delete the stale
   entry. Never edit `zh` to silence a stale warning; `zh` must match the
   scene.
5. `bun run voice:validate chapter_<N> --strict` must pass before the
   translation PR is ready.

## 3. Pronunciation

`voice:generate` swaps every glossary name and term that has a `reading` for
its kana before sending text to ElevenLabs. Fix a misreading in this order:

1. Add or correct the glossary `reading` when the word recurs.
2. Only when one line still misreads, give it `voice.tts`: the whole line as
   it should be spoken, in kana where needed. `tts` replaces `ja` for speech
   only; the displayed text stays `ja`.

## 4. Casting

1. Shortlist 2 to 3 Japanese library voices per role in `voice_cast.yaml`
   `candidates`, matching the role's age, temperament and register. Pick
   `auditionLines` that cover the role's range (calm, pressed, the strongest
   emotion), each with the `expression` whose direction it should use.
2. A library voice may need to be added to the account's voices before API
   use (ElevenLabs Voice Library, add to My Voices). Each takes a voice slot.
3. Estimate first: `bun run voice:audition <characterId> --dry-run`.
   Auditions are cheap (about 1,500 credits for four roles) but are still
   paid, so the owner's budget OK covers them.
4. `bun run voice:audition <characterId>` writes takes to
   `.voice-auditions/<characterId>/<voice>_<voiceId>_<n>.mp3`. Play them for
   the owner. Never commit them.
5. Set `status: approved` and `voiceId` only for the exact voice the owner
   names for that role. "These sound fine" is not a pick; ask which one.
6. Run `bun run voice:sync chapter_<N>` so the approved roles' translated
   lines get clip IDs, and commit the scripts.

Clip IDs are `ch<N>_<characterId>_<nnnn>`. They are never renumbered, and a
number used by a deleted line or an existing file is never reused, so a clip
file always belongs to one line.

## 5. Estimate and approval

`bun run voice:generate chapter_<N> --dry-run` prints each clip it would make,
the clip count and the character total (roughly the credit cost), and the
lines of roles not approved yet. It needs no API key. Post the total to the
owner and wait for an explicit OK on that amount before any paid run.

## 6. Generate

1. Pilot one scene first: `bun run voice:generate chapter_<N> --scene scene_<K>.md`.
   The owner listens in `bun run dev:game` (Settings > VOICE). Tune
   `settings`, `expressionDirections`, readings, or a line's `direction` /
   `tts`, then regenerate.
2. Then the rest of the chapter: `bun run voice:generate chapter_<N>`.
3. A run regenerates only clips whose inputs changed (`ttsHash`: model, voice,
   settings, seed, direction and final text). Neighbouring lines are not in
   the hash. `--force` takes a new performance of unchanged lines; use it
   with `--only <clip>`, never on a whole chapter without the owner's OK.
4. The script records `ttsHash` and `generatedAt` after each clip, so an
   interrupted run resumes where it stopped. Commit scripts and clips
   together.
5. **Exit code 3 means credits or billing ran out.** Stop and ask the owner
   to top up or enable API billing. Never retry with `--force`.
6. The key comes from `ELEVENLABS_API_KEY` in the environment or
   `packages/scripts/.env`. `ffmpeg` with `libvorbis` must be installed.
   Cloud threads cannot reach the owner's key; generation runs on the
   owner's Mac.

## 7. QA

Listen to every new clip in game, not only in a file browser. Check names and
kanji readings, the emotion against the scene, clipped starts or endings, and
loudness against neighbouring clips. Fix with a reading, `direction` or `tts`,
then `bun run voice:generate chapter_<N> --only <clip>`.

## 8. Ship

1. `bun run voice:validate chapter_<N> --strict`
2. `bun run scenes:compile` (no `voiceClipMissing` warning for the chapter)
3. `bun run test:scripts` and `bun run check:scripts`
4. Commit scripts, cast file and clips; never `.voice-auditions/` or
   `packages/scripts/.voice-cache/`. Mark the PR ready (CI skips drafts).

## Red flags

| Thought | Reality |
| --- | --- |
| "Generate this role too, its voice is obvious" | Only `approved` roles get clips. The owner picks the voice. |
| "Edit `zh` so the stale warning goes away" | `zh` must match the scene. Move or retranslate, then delete the stale entry. |
| "Patch `dialogue_locale.ja.json`" | Generated. Fix the script and run `scenes:compile`. |
| "Commit the audition takes for reference" | Auditions stay in the gitignored folder. |
| "Voice it now, translate later" | A line with empty `ja` gets no clip ID and no clip. |
| "They said it sounds good, run the chapter" | A paid run needs an explicit OK on the dry-run total. |
| "Exit 3, retry with `--force`" | Billing or quota. Stop and ask the owner. |
| "Regenerate the chapter with `--force` to be safe" | Spends credits on unchanged lines. Use `--only`. |
