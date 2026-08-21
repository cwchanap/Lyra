repo: cwchanap/Lyra
branch: main
path: apps/game/src

## Last sync
date: 2026-08-15T01:13:40Z

### Updated in this project
- Read InterrogationView, DialogueBox, GameAtmosphere, PrimaryObjectiveHud and tokens.css for the interrogation UI vocabulary.
- Copied real standees, an interrogation background, and five evidence thumbnails into `static/assets/`.
- Redesigned the interrogation scene: centered record panel, dialogue-only testimony state, HUD-opened evidence tray, oversized 反駁 ring.
- Wired canon evidence copy (Name / Description / Details / Source) from the chapter 1 evidence manifests into tray tooltips.

## Screen map
| Screen | Built from |
| --- | --- |
| Interrogation Redesign.dc.html | apps/game/src/lib/components/InterrogationView.svelte, DialogueBox.svelte, GameAtmosphere.svelte, PrimaryObjectiveHud.svelte, apps/game/src/lib/styles/tokens.css |
| Evidence tray copy | docs/stories_plan/chapter_1/investigation_scene_3.md, docs/stories_plan/chapter_1/investigation_scene_7.md |

## Sync history
- 2026-08-14T03:46:04Z — initial read of the interrogation components + asset copy.
