# Investigation Evidence Source Audit Skill Design

## Problem

Chapter 1 evidence-source authoring now supports multiple carrier shapes:
physical hotspots, generated standalone hotspots, character topics, and broader
derived sources such as spatial replays. The current layout editor assignment
workflow can move reveals around, but it is the wrong primary source of truth
for story semantics:

- Writers need to decide whether a clue is collected from a visible object,
  an implied local object, a hidden/derived source, a person topic, or a spatial
  reconstruction.
- The same physical click target can intentionally reveal multiple evidence
  items, such as a counter administration area yielding timecard, doorlock, and
  order records.
- Some authored hotspots are navigation or spatial context, not evidence
  carriers, such as `後場入口`.
- Generated JSON can lag behind authored Markdown; using the editor as the
  primary assignment surface creates sync uncertainty.

Authored investigation Markdown must remain the durable source of truth.
Generated JSON and editor state are compiled views.

## Decision

Create a repo-local skill:

```text
.claude/skills/auditing-investigation-evidence-sources/SKILL.md
```

The skill gives agents a repeatable workflow for re-auditing an
`investigation_scene_<N>.md` file and applying evidence-source fixes directly in
Markdown. It is an authoring/audit skill, not an image-generation or layout
skill.

The skill will classify each evidence item into one of these collection-source
types:

```text
physical-hotspot    Player inspects a visible in-scene source object.
implied-hotspot     Player inspects a local object/area; final evidence image is derived.
hidden-hotspot      Player uncovers non-visible evidence from a local action/device.
person-topic        A character provides the evidence through a specific topic.
spatial-replay      The player stands at, traces, or reconstructs a local route/view.
document-packet     One packet/table/source intentionally yields multiple evidence items.
navigation-only     Hotspot unlocks space only and must not carry evidence metadata.
```

The skill will update authored Markdown only. It will never hand-edit generated
JSON under `apps/game/src-tauri/resources/`.

## Markdown Rules

The skill follows the existing `writing-investigation-scene` schema and these
extra source-audit rules:

1. Every evidence item must be revealed by a hotspot, topic, or sub-location in
   the same `Source Sublocation`.
2. `Evidence Source` and `Scene Source Prompt` belong only on hotspots that
   reveal evidence.
3. A hotspot may reveal multiple evidence items only when they share the same
   player inspection and source treatment.
4. If evidence comes from a person, move the reveal to the exact `#### Topic:`
   where that person provides the information.
5. If evidence is derived from a route, sightline, or reenactment, use a
   meaningful spatial hotspot label and `Evidence Source: implied`.
6. If no physical hotspot or topic exists, create a meaningful local hotspot
   instead of a generic one whenever story content supports it.
7. Use `evidence_source_<evidence_id>` only for truly hidden generated
   standalones, and give the hotspot a meaningful Traditional Chinese label.
8. Navigation-only hotspots such as doorways should not gain evidence metadata
   just to host an unrelated clue.

## Required Audit Output

Before editing, the skill requires an evidence-carrier table:

```text
Evidence ID | Evidence Name | Source Sublocation | Current Carrier | Proposed Carrier | Source Type | Action
```

`Action` must be one of:

```text
keep
move reveal
create hotspot
merge into multi-evidence hotspot
split hotspot
remove invalid source metadata
needs human story decision
```

The agent should edit only rows whose action is justified by the scene text.
When a row is ambiguous, the skill requires the agent to state the ambiguity
and choose the least invasive story-consistent fix.

## Chapter 1 Initial Audit Notes

The skill must explicitly handle the current unclear cases:

- Scene 3 `後場入口` is a navigation carrier for `sublocation:corridor`, not an
  evidence source.
- Scene 3 `收銀台與第二杯訂單` is a meaningful local source for
  `two_coffee_order`; it should not be replaced by a generic hidden document.
- Scene 3 `三宅打卡紀錄` and `門鎖摘要合併時間表` can share the broader
  `吧台管理紀錄` / counter administration packet because the dialogue has the
  店長 open both staff records and the doorlock summary there.
- Scene 3 `閉店維護 routine 紀錄` belongs to the corridor notice board.
- Scene 3 `後場 L 型動線草圖` is derived from the inner-entry sightline, not a
  visible posted floor plan.
- Scene 7 `雨宮的匿名訊息` is phone/message-derived and should not imply that
  the final evidence thumbnail is visible on the room background.
- Scene 7 `咖啡機最後出杯` is suspicious because the current sub-location is
  `back_door` while the prose says coffee machine/register. The audit must
  either move the source to a matching local carrier or rewrite the local
  carrier as a phone/record lookup that is plausible in `back_door`.
- Scene 7 `三宅23:06站位` is a spatial replay carrier for
  `miyake_pov_replay`.
- Scene 7 `店長23:20動線` is currently a spatial narrative hotspot without its
  own evidence item; do not force one unless the manifest has a matching
  evidence entry.
- Scene 9 should be audited as document packets. The existing grouped packets
  are likely valid if the packet text really supports every evidence item they
  reveal.

## Editor Role

The layout editor should still display evidence carriers, hotspots, and
sub-location filtering, but assignment through the editor is no longer the
recommended semantic workflow. If an editor assignment fails to save, the
authoritative remediation is to run this Markdown audit skill and then recompile.

A future editor improvement can expose this as read-only diagnostics:

- show current carrier per evidence item;
- show whether the carrier is hotspot/topic/standalone/spatial;
- flag source-sublocation mismatches;
- link the user to the Markdown block that must be changed.

## Verification

After skill-guided edits:

1. Run `bun run scenes:compile`.
2. Run `bun run evidence-sources:audit`.
3. Review the affected Markdown diff to ensure edits preserved story intent and
   did not move evidence across sub-location boundaries.
4. Use the layout editor only to refresh visual placement after the Markdown and
   compiled JSON are aligned.
