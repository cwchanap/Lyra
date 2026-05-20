---
name: writing-chapter-manifest
description: Use when authoring or updating a chapter.md file under static/stories_plan/chapter_<N>/. The manifest declares the chapter's title, summary, and the ordered list of scenes the engine plays through. Trigger when starting a new chapter, adding a new scene to a chapter, or reordering scenes within a chapter.
---

# Writing Chapter Manifests (《東京雨證：第零證人》)

## Role

A chapter manifest declares **what scenes a chapter contains, in what playable order**. It is the entry point the engine uses to load a chapter — there is no convention-based scene discovery in v1.

## When to use

Use when:
- Starting a new chapter — author `static/stories_plan/chapter_<N>/chapter.md` before writing any scene files.
- Adding a new scene to an existing chapter — append it to the `## Scenes` list.
- Reordering scenes — edit the list.
- Renaming the chapter title — edit the H1.

## File location

`static/stories_plan/chapter_<N>/chapter.md` — one per chapter directory. Chapter ordering across chapters is derived from the directory name (`chapter_1`, `chapter_2`, …); there is no top-level index file.

## Required schema

```markdown
# Chapter 1: 雨鐘咖啡館殺人事件

**Summary:** 律師相馬律與早坂茜調查咖啡館內的殺人事件。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
3. scene_1.md
4. investigation_scene_2.md
```

Field details:

- **H1 title (required, exactly one):** `# Chapter <N>: <繁體中文 title>`. The number `<N>` must match the directory name. The title is player-facing.
- **`**Summary:**` field (required):** One-line Traditional Chinese summary the engine can show in chapter selection / save metadata.
- **`## Scenes` ordered list (required):** Numbered list of scene filenames in playable order, *relative to this chapter directory*. Each entry is one filename, no subdirectories.

## Scene-type inference

Scene type is inferred from filename prefix — do **not** add a type annotation in the manifest.

| Filename pattern | Scene type |
|---|---|
| `scene_<K>.md` | Linear dialogue (uses `writing-detective-game-dialogue` linear format) |
| `investigation_scene_<K>.md` | Interactive investigation (uses `writing-investigation-scene`) |
| `interrogation_scene_<K>.md` | Playable interrogation scene (uses `writing-interrogation-scene`) |

## Parser validation guarantees

The compile-time parser checks the following — the manifest fails the build if any rule is violated:

- H1 line present and matches the directory number.
- `**Summary:**` field present (non-empty).
- `## Scenes` list present, non-empty.
- Every listed filename exists in this chapter's directory.
- Every listed filename matches a known scene-type prefix.
- `interrogation_scene_<K>.md` is a playable interrogation scene authored by `writing-interrogation-scene`.

## Cross-chapter ordering

Chapters play in directory-name order: `chapter_1` → `chapter_2` → `chapter_3` → … There is no chapter manifest gating yet. Each chapter starts when its predecessor's final scene's Outro queue empties.

## Common mistakes

| Mistake | Fix |
|---|---|
| Listing scenes in narrative order but in the wrong filename | Rename the file so its number matches its position in the manifest. Filenames and order should agree. |
| Adding scenes that don't exist in the directory | Either create the file or remove the entry. |
| Mixing scene-type prefixes (e.g., `scene_2.md` listed before `investigation_scene_1.md`) | Allowed — playable order is whatever the manifest says, not what the filenames suggest. |
| Forgetting to add a newly-authored scene to the manifest | The parser does *not* auto-discover scene files. A scene that exists but is not listed in `chapter.md` is never played. |
| Adding metadata fields other than `**Summary:**` (e.g., `**Author:**`, `**Length:**`) | Not supported in v1. Stick to the schema. |
