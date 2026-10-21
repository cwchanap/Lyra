---
name: voicing-lyra-dialogue
description: Use when translating Lyra dialogue into the per-scene Japanese script, fixing Japanese readings, casting or auditioning ElevenLabs voices, or checking a chapter's translation coverage. Clip generation is generating-lyra-voice-clips.
---

# Voicing Lyra Dialogue

## Overview

Japanese voice is a pipeline of four files and four commands. Each step has an
owner gate: nothing is cast, and no credits are spent, without the owner's
explicit word.

| File | What it holds | Who edits it |
| --- | --- | --- |
| `docs/stories_plan/chapter_<N>/ja/<scene>.ja.yaml` | One entry per spoken line of that scene file, linked by the line's ID: `id`, `speaker`, `expression`, `zh`, `ja`, `note`, `voice` | `voice:sync` adds entries and moves orphans to `stale`; you fill `ja`, `note`, `voice.direction`, `voice.tts` |
| `docs/stories_plan/ja_glossary.yaml` | Japanese names, kana readings, each character's register, style rules | You, when a new name or term appears |
| `static/assets/config/voice_cast.yaml` | Per role: model, settings, seed, expression directions, audition lines, shortlist, picked `voiceId`, `status` | You propose; only the owner's pick makes a role `approved` |
| `static/assets/voice/ja/<clip>.ogg` | Generated clips | Only `voice:generate` |

Every spoken line in a translated scene ends in a line ID such as
` {#L012}`, unique within its scene file. The script entry with
`id: L012` is that line's translation, so editing or moving the Chinese line
keeps its translation and clip. `voice:sync` writes the IDs into the scene
files; nobody types them, and the ID of a deleted translated line is never
reused. `speaker`, `expression` and `zh` in an entry record what the
Japanese was translated from.

Commands: `voice:sync`, `voice:validate`, `voice:audition`,
`voice:generate`. The compiler turns scripts plus clips into the generated
`dialogue_locale.ja.json`; never hand-edit that.

## 1. Inputs

Read the chapter's `chapter.md`, the authored scenes it lists, `characters.md`
for each role's profile, the glossary, `voice_cast.yaml`, and the chapter's
existing `ja/` files. Translate only from the authored scene lines that
`voice:sync` lists. Never translate from planning docs or the story bible.

## 2. Sync and translate

1. `bun run voice:sync chapter_<N>` appends an ID to every spoken line
   that has none, adds an empty entry for every new ID, and moves entries
   whose line was deleted to the file's `stale` list (translated or voiced
   ones only). Commit the scene files with the scripts. A chapter still
   being written gets its IDs only when its translation starts, so the
   writing PRs do not churn.
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
4. A changed line (`localeScriptSourceChanged`): the scene line's speaker,
   expression or Chinese text differs from the entry's. Check the `ja`
   against the new line and fix it if needed, then copy the current
   `speaker`, `expression` and `zh` into the entry. Until then the game
   keeps showing and playing the old translation.
5. A stale entry: its line was deleted. If a new line replaced it and the
   Japanese still fits, move the translation to that line's entry;
   otherwise retranslate. Then delete the stale entry.
6. `bun run voice:validate chapter_<N> --strict` must pass before the
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
5. Record the owner's pick (exact `voiceId`, `status: approved` and the
   cast record comment) and run `voice:sync` as `generating-lyra-voice-clips`
   step 1 says. "These sound fine" is not a pick; ask which one.

Clip IDs are `ch<N>_<characterId>_<nnnn>`. They are never renumbered, and a
number used by a deleted line or an existing file is never reused, so a clip
file always belongs to one line.

## 5. Generate, listen and ship

Everything from the dry-run estimate to the clips PR is the
`generating-lyra-voice-clips` skill: the owner's budget OK, preparing the
Mac, the pilot scene, the chapter run, exit codes, listening QA and shipping.

## Red flags

| Thought | Reality |
| --- | --- |
| "Generate this role too, its voice is obvious" | Only `approved` roles get clips. The owner picks the voice. |
| "Copy the new `zh` in so the changed warning goes away" | Check the `ja` first; `zh` records what was translated. |
| "Give the edited line a fresh ID" | Keep the ID; it is what keeps the translation and clip. |
| "Copy this line's `{#L012}` onto a new line" | Each ID is one line. New lines get theirs from `voice:sync`. |
| "Patch `dialogue_locale.ja.json`" | Generated. Fix the script and run `scenes:compile`. |
| "Commit the audition takes for reference" | Auditions stay in the gitignored folder. |
| "Voice it now, translate later" | A line with empty `ja` gets no clip ID and no clip. |
