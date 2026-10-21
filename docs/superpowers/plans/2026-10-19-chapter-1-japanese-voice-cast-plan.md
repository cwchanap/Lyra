# Chapter 1 Japanese Voice Cast Plan

**Status:** steps 1 (the Japanese script) and 2 (voice playback) of the work
order are built in the same PR as this plan; steps 3 to 5 are not started, and
no audio has been generated, so the game still plays silent.

**Goal:** Give a few Chapter 1 characters Japanese voices generated with
ElevenLabs text-to-speech, write a repo skill that captures the SOP so later
chapters repeat it, and keep the Japanese script in the repo so a Japanese
language option can reuse it later.

**What the player gets:** voiced characters speak Japanese while the dialogue
box keeps showing the current Traditional Chinese text (Japanese audio with
Chinese subtitles). A voice volume slider and a voice on/off toggle sit with the
existing BGM/BGS/SFX settings. Unvoiced characters and narration behave exactly
as today.

## 1. Decisions (defaults picked for this plan)

| Question | Default | Why |
| --- | --- | --- |
| Which characters get voices | The four recurring core cast: 相馬律, 早坂茜, 神谷澪, 黑瀨徹 | They are the cross-chapter core cast (`characters.md` §1), so a voice cast once keeps paying off. They speak 611 of Chapter 1's 793 spoken lines (77%). Chapter-1-only locals (高瀨 53 lines, 三宅蒼太 35, the rest 10 or fewer each) and 旁白 stay unvoiced; adding one later is a cast entry plus a generation run. |
| Which of their lines are voiced | Every Chapter 1 line those four speak, including interrogation loop/challenge/wrong-answer lines | A voiced character who falls silent mid-scene reads as a bug. Repeated identical lines (same speaker, same text, same expression) share one clip: 608 unique clips. |
| Which lines get Japanese text | All 793 spoken lines in Chapter 1 (every speaker plus 旁白), voiced or not | Translation needs whole-conversation context anyway, and it makes Chapter 1 dialogue complete for a later Japanese mode. Stage directions, scene tags, evidence text, hotspot labels and UI strings are left for that later localization project; the file format below extends to them. |
| Where the Japanese script lives | One YAML file per scene beside the source: `docs/stories_plan/chapter_1/ja/<scene>.ja.yaml` | Keeps the Chinese Markdown and its parser contract untouched, sits next to the dialogue it translates, and is invisible to gameplay compilation (the compiler only reads files `chapter.md` lists). |
| How a Japanese line is tied to its Chinese line | By a line ID: every spoken line in a translated scene ends in ` {#L012}`, unique within its scene file, and the script entry with `id: L012` is its translation. `voice:sync` writes the IDs; writers never type them. (Changed on 2026-10-20 from matching by speaker, exact text and expression, at the owner's request, so further locales can link to the same lines.) | Editing a line's Chinese text or moving it keeps its translation and clip; the validator flags the entry for review instead of dropping it. The ID stays out of the scene JSON, so saves are untouched, and the game still matches lines at runtime by speaker, text and expression through the generated locale manifest. |
| Does voice touch saves | No. Voice and Japanese text ship in a separate locale manifest, not in scene JSON | The save `contentRevision` hashes emitted scene JSON, so keeping locale data out of it means recording or re-recording voices never invalidates saves. |
| TTS model | `eleven_v4` (supports Japanese and audio tags such as `[whispers]` on the text-to-speech endpoint). The 2026-10-21 pilot picked it over `eleven_v3`, whose takes sounded stiff, and dropped the default calm tags. Both models reject `apply_language_text_normalization`, so readings come from the glossary and `voice.tts`. | Audio tags let one stored direction per line steer delivery; the pilot confirmed the model before the full run. |
| Where generation runs | The owner's Mac checkout through Remote Control, the same way Chapter 2 art and audio were made | The ElevenLabs key lives there (`packages/scripts/.env`, per CLAUDE.md). Translation, tooling and runtime work need no Mac. |

## 2. Data files

### 2.1 Japanese script, per scene

`docs/stories_plan/chapter_1/ja/scene_5.ja.yaml` (illustrative):

```yaml
schemaVersion: 1
locale: ja
source: docs/stories_plan/chapter_1/scene_5.md
lines:
  - id: L012                         # the scene line `**神谷澪**：嫌疑人的態度不是證據。 {#L012}`
    speaker: 神谷澪                  # speaker, expression and zh record what was translated
    zh: 嫌疑人的態度不是證據。
    ja: 被疑者の態度は、証拠ではありません。
    voice:
      clip: ch1_kamiya_mio_0012
      direction: "[calm, precise]"   # optional; defaults from the cast's expression map
      tts: ひぎしゃのたいどは、しょうこではありません。  # optional reading override
      ttsHash: 3f9a1c2e0b4d          # written back by voice:generate
      generatedAt: 2026-10-25T10:00:00Z
  - id: L013
    speaker: 旁白
    zh: 一份案件摘要，正在生成。
    ja: 事件の要約が、生成されていく。
```

- Lines appear in emitted order, each in the script of the scene file it is
  written in. Each ID is listed once, even when the line plays more than
  once. Two lines that read exactly the same keep separate entries but share
  one clip.
- `voice` exists only for speakers with an approved cast entry.
- `clip` IDs are `ch<N>_<characterId>_<nnnn>`, assigned once and never
  renumbered (deleted lines leave gaps), so regenerating one line never
  renames another's file. `voice:sync` assigns them to translated lines of
  approved roles; a number used by a stale entry or an existing clip file is
  never reused. A clip of a role without an approved voice is a warning.
- `voice:validate` fails on an ID listed twice, a clip ID used twice, or a
  wrong `source`/`locale`; the compiler fails on an ID used twice in a scene
  file or a malformed `{#…}` tag. A line without an ID, a line whose speaker,
  expression or text changed since translation, a stale entry (its line was
  deleted), an emitted line with no entry (missing), an untranslated line
  and a voiced line with no translation are warnings; `--strict` fails on
  warnings too.

### 2.2 Glossary and style guide

`docs/stories_plan/ja_glossary.yaml`: Japanese display names and kana
readings for every character, place and term the TTS can misread, plus each
character's Japanese register. Defaults to review:

| Character | Japanese name (reading) | Register |
| --- | --- | --- |
| 相馬律 | 相馬律 (そうま りつ) | 一人称「僕」; plain form with 早坂, polite with officials and witnesses; short conclusions, no flourish |
| 早坂茜 | 早坂茜 (はやさか あかね) | 「私」; clipped plain form, practical, few sentence-final particles |
| 神谷澪 | 神谷澪 (かみや みお) | 「私」; formal です・ます in the hearing, precise, no contractions |
| 黑瀨徹 | 黒瀬徹 (くろせ とおる) | 「俺」; rough plain form (〜だ, 〜ねえ), short street phrasing |
| 旁白 | — | written narration (だ・である) |

Terms: KAGAMI (カガミ), 吉祥寺 (きちじょうじ), cafe 雨鐘 (あまがね, default
reading), and the Chapter 1 locals (三宅蒼太 みやけ そうた, 高瀬 たかせ,
片瀬美咲 かたせ みさき, 北見修一 きたみ しゅういち, 増田圭 ますだ けい).
The glossary is applied automatically to TTS input; a line-level `tts`
override wins when the model still misreads it.

### 2.3 Voice cast

`static/assets/config/voice_cast.yaml`, next to `audio.yaml` and
`characters.yaml` because the cast is reused across chapters:

```yaml
schemaVersion: 1
locales:
  ja:
    model: eleven_v4
    languageTextNormalization: false
    cast:
      - characterId: kamiya_mio          # must exist in characters.yaml
        status: proposed                  # approved only on the owner's explicit pick
        voiceId: null                     # filled at casting
        settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.0 }
        seed: 1102                        # fixed per character for consistency
        expressionDirections: { standard: "[calm]", stern: "[firmly]" }
        auditionLines: [ ... three representative Chapter 1 lines ... ]
        candidates: [ ... shortlist from section 5 ... ]
```

## 3. Runtime and compiler changes

- **Compiler:** `scenes:compile` joins every emitted `line` item with the
  Japanese script and writes `apps/game/src-tauri/resources/assets/dialogue_locale.ja.json`
  (Japanese text plus, for voiced lines, a `voice.ja.<clip>` asset ID). It sits
  in the already-bundled `resources/assets/` tree and outside the
  `contentRevision` bundle. Lines are grouped per chapter, so the same Chinese
  line in two chapters keeps two clips. A line gets its asset ID only when its
  script entry has a `voice.clip` and that `.ogg` exists at compile time.
  Missing script entries and missing `.ogg` files are warnings, like missing
  art today. The line key, locale list and manifest types live in the shared
  `@lyra/dialogue-locale` package, which the compiler and the game both use.
- **Asset paths:** `@lyra/asset-paths` gains a `voice` type:
  `voice.<locale>.<clip>` resolves to `/assets/voice/<locale>/<clip>.ogg`.
  Clips live under `static/assets/voice/ja/`.
- **Rust:** one read-only command that returns the locale manifest from the
  resource directory. No engine, schema or save changes.
- **Frontend:** a voice channel in the gameplay audio controller.
  `AudioPreferences` gains `voiceVolume` (default 0.9) and `voiceEnabled`
  (default on); the existing normalizer fills them in for stored v1
  preferences, so no storage key bump. `DialogueBox.svelte` is the single
  playback owner: every `line` item, including interrogation testimony
  (which `DialogueBox` renders while `InterrogationStage` only hosts the
  stage and portrait), starts its clip when it becomes current, keyed on the
  box's queue token so a re-render never starts a second clip. The previous
  clip stops on advance, skip, scene change, mode change, load and return to
  title. Voice never blocks advancing. A failed or missing clip is silence plus one warning,
  matching the existing audio contract.
- **Packaged E2E:** contract unchanged. Headless runs absorb voice playback
  failures as warnings; controller behavior is covered by Vitest.
- **Left for later:** a replay button in dialogue history, BGM ducking under
  voice (decided by ear in the pilot), and a Japanese text display option that
  reads the same manifest.

## 4. Tooling (`packages/scripts/voice/`)

Root scripts delegate to `@lyra/scripts`, like `audio:*`.

- `voice:sync <chapter>`: compiles the chapter, adds skeleton entries for new
  lines, and moves translated or voiced entries whose line is gone to the
  file's `stale` list. It never overwrites a filled `ja`. Entries that are
  both orphaned and empty are dropped, and a script file left with nothing in
  it is deleted. It also gives each translated line of an `approved` cast role
  a clip ID, continuing after the highest number any script entry or clip
  file already uses.
- `voice:validate <chapter>`: coverage, stale entries, conflicting
  translations, cast references, and a soft length check.
- `voice:audition <characterId>`: generates that role's audition lines with
  each candidate voice into a gitignored `.voice-auditions/` folder for
  listening. Never committed.
- `voice:generate <chapter> [--dry-run] [--scene <file>] [--speaker <id>] [--only <clip>] [--force]`:
  the dry run prints clip count and character total with no key needed. A real
  run calls `POST /v1/text-to-speech/{voice_id}` with the cast's model,
  settings, seed and `language_code: ja`. On models that support request
  stitching (`eleven_v3` does not) it also sends the neighbouring lines as
  `previous_text`/`next_text`, but only for linear `scene_<K>.md` files:
  investigation, interrogation and analysis scripts list branch and result
  lines out of play order, so their clips get no context. It refuses to run when `voice:sync` would change
  the scripts. It regenerates only clips
  whose `ttsHash` changed. The hash covers every input that shapes the
  performance: model, voice ID, settings, seed, the resolved direction
  (the line's own `direction`, else the cast's expression fallback), and the
  final TTS text, plus any neighbouring-line context the request sends, so
  a clip goes stale when the lines around it change. It writes
  provenance back into the script entry, and reuses the existing
  `PaymentRequiredError` handling and exit code 3.
- Post-processing reuses the existing ffmpeg step: trim leading and trailing
  silence, normalize loudness to -18 LUFS integrated, mono, Ogg Vorbis.
  Estimated size: about 20 MB for 608 clips.

## 5. Voice shortlists for casting

Japanese voices from the ElevenLabs voice library that match each role's
profile in `characters.md` (listed 2026-10-19; previews are free to play in
the library). Auditions narrow these to one per role, and the owner picks.

| Role | Candidates |
| --- | --- |
| 相馬律 (26, calm, analytical) | Calm Japanese voice komi `G4sNoJjgWjyp9nhj1Bhj`; Hadou v3 `3VouIDzZzPEjDgmtbXBJ`; Yuta `YqSsGYVfnt78k7OGZl33` |
| 早坂茜 (early 30s, firm, practical) | Popo `1zDn39fNfsYODLsGC75y`; Kurea `IgiTcMDSHJPIJjnlwIdM`; Shino `Kohz4YYGbPgnEUrf8CZl` |
| 神谷澪 (early 30s, cold, exact) | Kasane `ioLsi3BGjCKHDhF2fNod`; Chiemi `CAz2VQzFEVyGujit7Iof`; Yoko `j3dRDAhPGt6NA8DY9Flv` |
| 黑瀨徹 (about 50, gruff, weathered) | PiropiroRX `YkUoVuNq2782tso28g8Q`; Haruma `pL2AN47H9Cgg5ce6LNmO`; Shintarou `Z9CocQcpiyoQFqRiRwRE` |

A library voice must be added to the account's voices before API use and
takes a voice slot. If its owner withdraws it later, committed clips keep
working but new lines need a recast, so the cast file records each voice ID.
If no candidate fits a role, ElevenLabs Voice Design can build a custom voice
from the character description.

**Cast picked 2026-10-21.** The owner chose from a second, wider shortlist of
library samples (no paid auditions). The cast record for each role is in
`voice_cast.yaml`.

| Role | Voice |
| --- | --- |
| 相馬律 | Kenzo `b34JylakFZPlGS0BnwyY` (the owner's own find in the library) |
| 早坂茜 | Popo `1zDn39fNfsYODLsGC75y` |
| 神谷澪 | Kasane `ioLsi3BGjCKHDhF2fNod` |
| 黑瀨徹 | Ishibashi `Mv8AjrYZCBkdsmDHNwcB` |

## 6. Cost

- The four voiced characters' 608 unique lines hold about 10,000 Chinese
  characters. Sample translations run about 1.5 to 1.6 times as many
  characters in Japanese, so one full pass is an estimated 16,000 to 18,000
  TTS characters.
- ElevenLabs bills v3/v4 at 1 credit per character on the website and lower
  through the API, so one full pass costs at most about 18,000 credits.
- Auditions (12 candidates × 3 short lines) cost about 1,500. Allowing for
  retakes, the request is a budget of 30,000 credits for Chapter 1.

## 7. Work order

1. **PR 1, Japanese script (cloud). Done in this PR.** Locale file format,
   `voice:sync` and `voice:validate`, the glossary and style guide, and all
   793 Chapter 1 lines (789 unique entries) translated scene by scene. Clip
   IDs are left for PR 3, which assigns them.
2. **PR 2, voice playback (cloud). Done in this PR.** Compiler manifest,
   `voice` asset type, the Rust read-only command, the frontend voice channel
   and settings. The script's optional `voice` block (`clip`, plus the
   `direction`, `tts`, `ttsHash` and `generatedAt` fields PR 3 fills in) is
   parsed and validated here, because the manifest reads `voice.clip`. Ships
   silent until clips exist.
3. **PR 3, generation tooling and the SOP skill (cloud). Done in this PR.** `voice_cast.yaml`
   with the shortlists, `voice:audition`, `voice:generate`, ffmpeg
   post-processing, tests with a fake client, the
   `voicing-lyra-dialogue` skill, and the CLAUDE.md command list.
4. **Casting. Done 2026-10-21.** The owner picked one voice per role from
   library samples; the four cast entries are `approved` and `voice:sync`
   gave their 608 lines clip IDs.
5. **PR 4, Chapter 1 clips (Mac).** Generate the pilot scene first
   (`scene_5.md`, the review-board hearing, where all four voiced characters
   speak 54 lines);
   the owner listens in `bun run dev:game`; tune settings, directions and
   readings; then generate the remaining clips, run QA, and mark the PR ready
   (CI skips drafts).

## 8. The SOP skills

Translation and casting are `.claude/skills/voicing-lyra-dialogue/SKILL.md`.
Generation (gates, recording the cast, preparing the Mac, estimate, pilot,
chapter run, exit codes, listening QA and shipping) was split out on
2026-10-21 into `.claude/skills/generating-lyra-voice-clips/SKILL.md`. The
outline below is the original combined plan.

Description: use when translating Lyra dialogue into the per-scene Japanese
script, casting or auditioning ElevenLabs voices, generating or regenerating
voice clips, or checking a chapter's voice coverage.

Outline:

1. **Inputs.** The authored scenes listed in `chapter.md`, `characters.md`,
   the glossary, `voice_cast.yaml`, and the chapter's existing `ja/` files.
   Never translate from planning docs or the story bible.
2. **Sync and translate.** Run `voice:sync`, translate every empty `ja` with
   the style guide (character register, glossary names, no spoilers beyond
   what the Chinese line says, keep each line about as short as its source).
   One subagent per scene, then a review pass across scene boundaries.
3. **Pronunciation.** Glossary readings first; a line `tts` override only
   when the model still misreads.
4. **Casting.** Audition candidates, play them for the owner, set `approved`
   only for the exact voice the owner picks.
5. **Estimate and approval.** Run `voice:generate --dry-run` and get the
   owner's OK on the character total before any paid run.
6. **Generate.** Pilot scene first, then the rest. Exit code 3 means credits
   or billing ran out: stop and ask the owner to top up; never retry with
   `--force`.
7. **QA.** Listen in-game; check names, emotion, clipped endings and loudness;
   fix with `direction` or `tts`, then regenerate with `--only`.
8. **Ship.** `voice:validate`, `bun run scenes:compile`, focused tests,
   `bun run check:scripts`, PR marked ready.

Red flags: generating for a cast entry that is not `approved`, editing `zh` in
a script file to silence a stale warning, hand-editing the generated locale
manifest, committing audition files, voicing a line whose Japanese is still
empty, or treating a vague "sounds good" as approval for a paid run.

## 9. Risks

- **Kanji misreadings** are the most common Japanese TTS failure. The
  glossary, line-level `tts` overrides, and ElevenLabs' Japanese text
  normalization option cover it; the pilot measures how often it happens.
- **Consistency across about 600 clips:** a fixed seed per character, stable
  settings, and neighbouring-line context in linear scenes keep the
  performance even. The seed
  does not guarantee identical output, so QA still listens.
- **Chinese edits after recording:** the validator flags the entry as stale.
  If the Japanese line still fits, updating `zh` keeps the clip; if not, the
  line is retranslated and only that clip is regenerated.
- **Per-line autosave stall:** every dialogue line already triggers an
  autosave thumbnail capture (known and unfixed, about 0.65 s on the Linux
  packaged build). The pilot checks whether it delays voice start on the Mac.
- **Repository size:** about 20 MB more audio, alongside 303 MB of existing
  static assets.

## 10. Owner decisions

- **Voice picks**, one per role. Done 2026-10-21 (section 5).
- **Credit budget:** approve up to 30,000 ElevenLabs credits for Chapter 1
  before step 4.

Everything else above is a default the owner can change on review.
