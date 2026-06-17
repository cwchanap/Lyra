# Local Evidence Collection Design

## Problem

Evidence assignment currently proves that an evidence item is reachable, but it does
not prove that the collection interaction feels plausible in the active background.
Scene 3 exposes the issue clearly:

- `三宅打卡紀錄` and `門鎖摘要合併時間表` are front-room records, but the background
  does not clearly show the exact documents.
- `閉店維護 routine 紀錄` belongs in the corridor, where a wall board can plausibly
  carry the clue.
- `後場 L 型平面圖` is written as a physical posted plan, but the `inner_entry`
  background does not clearly contain a readable map.

## Story Rule

Evidence does not need to be literally visible in the background, but it must be
collected from a believable local trigger in the same sublocation.

The trigger should be a thing the player can inspect in the scene: a register area,
monitor, notice board, shelf geometry, door, or character-held record. The collected
evidence image can then be a cleaner, isolated evidence representation.

## Scene 3 Decisions

- `三宅打卡紀錄` should be collected in `front` from a broader counter/admin-records
  trigger. It should not require a literal visible timecard document in the image.
- `門鎖摘要合併時間表` should also be collected in `front`, either from the same
  counter/admin-records trigger or a KAGAMI/POS terminal trigger.
- `閉店維護 routine 紀錄` should stay in `corridor`, collected from a visible wall
  notice/check board trigger.
- `後場 L 型平面圖` should become derived spatial evidence from the `inner_entry`
  geometry. The player collects it by inspecting the local shelf/door/turn sightline,
  not by finding a literal wall map. The evidence name can become `後場 L 型動線草圖`
  or similar if the prose needs to make that derivation explicit.

## Data Rule

Add authored source-sublocation metadata to each investigation evidence item. The
compiler and editor should treat it as the local ownership boundary for assignment.

Suggested Markdown:

```md
### evidence:backroom_floorplan {#backroom_floorplan}
- **Name:** 後場 L 型動線草圖
- **Source Sublocation:** inner_entry
```

Validation:

- Every investigation evidence item must declare `Source Sublocation`.
- Any hotspot/topic that reveals `evidence:<id>` must live in the same sublocation.
- Evidence assignment UI should only show hotspots from the evidence source
  sublocation.
- Existing runtime inventory can remain scene-level; the restriction is enforced at
  authoring/compile/editor time.

## Authoring Guidance

Writers should author evidence in three parts:

- `Source Sublocation`: where the player can collect it.
- `Collection Trigger`: the local hotspot/topic that carries it.
- `Evidence Source`: visible, implied, or hidden, describing how the trigger presents
  the evidence before inspection.

If no local trigger exists, choose one of:

- rewrite the evidence as derived from local geometry or dialogue;
- add a believable local trigger hotspot;
- regenerate/edit the background only when the evidence must be a visible physical
  object.

Manual editor reassignment remains available, but only inside the source sublocation.

## Testing

- Compiler tests should reject cross-sublocation evidence reveals.
- Editor assignment helper tests should filter assignment choices by source
  sublocation.
- Scene 3 should compile with all evidence locally backed:
  - `front`: admin records / monitor records;
  - `corridor`: wall notice/check board;
  - `inner_entry`: spatial-layout trigger.
