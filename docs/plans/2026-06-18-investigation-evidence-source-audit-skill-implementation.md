# Investigation Evidence Source Audit Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Markdown-first investigation evidence-source audit workflow, stop using the layout editor as the semantic assignment surface, and apply the workflow to the currently unclear Chapter 1 evidence carriers.

**Architecture:** Authored `investigation_scene_<N>.md` remains the durable source of truth. The new repo-local skill teaches agents how to build a carrier table, classify each evidence source, and edit Markdown directly; the layout editor shows current carriers but no longer presents assignment controls as the primary write path. Scene edits stay same-sublocation and are verified through the compiler plus the evidence-source audit script.

**Tech Stack:** Repo-local Codex skills in `.claude/skills`, Svelte 5 layout editor, Vitest component/source tests, authored investigation Markdown, `bun run scenes:compile`, `bun run evidence-sources:audit`.

---

## Task 1: Create The Evidence Source Audit Skill

**Files:**

- Create: `.claude/skills/auditing-investigation-evidence-sources/SKILL.md`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`

**Step 1: Add the skill file**

Create `.claude/skills/auditing-investigation-evidence-sources/SKILL.md` with:

- YAML front matter:
  - `name: auditing-investigation-evidence-sources`
  - description explaining it is used to audit/fix investigation evidence carriers directly in authored Markdown.
- A clear role statement: the agent audits and edits `investigation_scene_<N>.md`; it does not edit generated JSON.
- Required source loading:
  - the target investigation scene;
  - its `.layout.json` sidecar when present;
  - current compiled JSON when available, for comparison only;
  - `writing-investigation-scene`.
- Required carrier table format:
  - `Evidence ID`
  - `Evidence Name`
  - `Source Sublocation`
  - `Current Carrier`
  - `Proposed Carrier`
  - `Source Type`
  - `Action`
- Source type taxonomy:
  - `physical-hotspot`
  - `implied-hotspot`
  - `hidden-hotspot`
  - `person-topic`
  - `spatial-replay`
  - `document-packet`
  - `navigation-only`
- Markdown edit rules:
  - move reveals in Markdown only;
  - preserve same-source-sublocation;
  - put person-sourced evidence on the topic;
  - put route/sightline derived evidence on a meaningful spatial hotspot;
  - only use `evidence_source_<evidence_id>` for unavoidable hidden standalones;
  - remove `Evidence Source` / `Scene Source Prompt` from non-evidence hotspots;
  - never hand-edit `apps/game/src-tauri/resources`.
- Verification commands:
  - `bun run scenes:compile`
  - `bun run evidence-sources:audit`

**Step 2: Link from the investigation writing skill**

In `.claude/skills/writing-investigation-scene/SKILL.md`, add a short related-workflow note near the Hotspot/Topic evidence-source rules:

```md
When re-auditing existing evidence-to-hotspot or evidence-to-topic placement,
use `auditing-investigation-evidence-sources`; it owns Markdown-first carrier
cleanup and avoids editor/generated-JSON sync drift.
```

**Step 3: Verify skill text**

Run:

```bash
rg -n "Evidence ID|Source Type|evidence_source_|bun run evidence-sources:audit" .claude/skills/auditing-investigation-evidence-sources/SKILL.md
```

Expected: all required anchors are present.

**Step 4: Commit**

```bash
git add .claude/skills/auditing-investigation-evidence-sources/SKILL.md .claude/skills/writing-investigation-scene/SKILL.md
git commit -m "docs(skills): add investigation evidence source audit"
```

---

## Task 2: Make Editor Evidence Correlation Read-Only

**Files:**

- Modify: `apps/layout-editor/src/lib/EvidenceAssignmentPanel.svelte`
- Modify: `apps/layout-editor/src/lib/EvidenceAssignmentPanel.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

**Step 1: Update component tests first**

Change the panel tests so they assert:

- the panel lists only evidence whose `sourceSublocationId` matches the selected sublocation;
- each row shows the current carrier label;
- the component renders no editable `<select>`;
- the component no longer calls an assignment handler on user change.

Keep the existing carrier discovery tests in `evidence-assignment.test.ts`; the read-only panel can still use those helpers to render labels.

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EvidenceAssignmentPanel.test.ts src/App.test.ts
```

Expected: fail before implementation because the panel still renders editable assignment controls.

**Step 2: Implement read-only display**

In `EvidenceAssignmentPanel.svelte`:

- remove the required `onAssignEvidence` prop;
- remove `carrierFromValue` and `handleAssignmentChange`;
- render the current selected carrier as text or a compact badge instead of a `<select>`;
- keep thumbnail/name/id display;
- keep selected sublocation filtering;
- change the heading from `Hotspot Correlation` to `Evidence Sources`.

In `App.svelte`:

- remove the `onAssignEvidence={assignEvidenceToCarrier}` prop from `EvidenceAssignmentPanel`;
- remove the `assignEvidenceToCarrier` import if it is no longer used.

In `App.test.ts`:

- assert the app mounts `EvidenceAssignmentPanel`;
- assert it does not wire `assignEvidenceToCarrier` into the detail view.

**Step 3: Verify editor tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EvidenceAssignmentPanel.test.ts src/App.test.ts
```

Expected: pass.

**Step 4: Commit**

```bash
git add apps/layout-editor/src/lib/EvidenceAssignmentPanel.svelte apps/layout-editor/src/lib/EvidenceAssignmentPanel.test.ts apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(editor): show evidence sources read-only"
```

---

## Task 3: Apply The Audit To Chapter 1 Scenes

**Files:**

- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_9.md`
- Modify only if needed for compile validity: `docs/stories_plan/chapter_1/investigation_scene_8.md`

**Step 1: Build the audit tables**

For scenes 3, 7, and 9, manually build the skill-required carrier table from the authored Markdown.

Scene 3 expected decisions:

- `two_coffee_order`: `收銀台與第二杯訂單` is the meaningful source carrier.
- `cctv_screenshot`: `閉店監視器回放` remains an implied monitor source.
- `timecard_record` and `doorlock_summary_timetable`: `吧台管理紀錄` remains a shared document-packet source.
- `closing_routine`: `閉店維護告示板` remains visible.
- `backroom_floorplan`: `倉庫入口遮蔽視線` remains an implied spatial/sightline source.
- `後場入口` remains navigation-only.

Scene 7 expected decisions:

- `amemiya_message_thumb`: keep on `雨宮的匿名訊息`, but make the source language clearly phone/message-derived rather than background-visible.
- `coffee_last_cup_record`: keep only if the hotspot prose makes the local `back_door` collection plausible; otherwise rewrite the carrier/source copy so it is a local record lookup from the phone/message context, not a physical coffee-machine hotspot in the wrong sublocation.
- `miyake_pov_replay`: keep on `三宅23:06站位` as `spatial-replay`.
- `店長23:20動線`: leave navigation/narrative-only unless a matching evidence manifest item exists.
- `forensic_prelim_range`: keep on 黑瀨 topic, not a standalone hotspot.

Scene 9 expected decisions:

- Treat `workorder`, `material_kit`, `unsent_memo`, and `whistleblower_draft` as document packets.
- Keep grouped evidence reveals only where the dialogue inspects the same packet and the same source treatment applies.

**Step 2: Apply Markdown fixes**

Use the audit table to make minimal story-preserving edits:

- move `two_coffee_order` back to `register` if it is still grouped under `counter_admin_records`;
- remove invalid `Evidence Source` / `Scene Source Prompt` metadata from any hotspot that no longer reveals evidence;
- adjust Scene 7 source copy for `amemiya_message` and `last_cup` if needed;
- make no edits to Scene 9 if the document-packet audit passes.

If current dirty `investigation_scene_8.md` blocks `bun run scenes:compile` because a non-evidence hotspot still has `Evidence Source`, preserve the user's topic reveal move and remove only the invalid source metadata from that non-evidence hotspot.

**Step 3: Run compile and audit**

Run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

Expected: both pass. If compile fails on unrelated interrogation cross-scene references caused by the current dirty scene state, fix only the minimal authored Markdown necessary to restore declared evidence/reveal consistency.

**Step 4: Commit**

```bash
git add docs/stories_plan/chapter_1/investigation_scene_3.md docs/stories_plan/chapter_1/investigation_scene_7.md docs/stories_plan/chapter_1/investigation_scene_9.md docs/stories_plan/chapter_1/investigation_scene_8.md
git commit -m "docs(story): audit chapter 1 evidence sources"
```

---

## Task 4: Final Verification

**Files:**

- No intended source edits unless verification exposes a real defect.

**Step 1: Run focused tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EvidenceAssignmentPanel.test.ts src/App.test.ts
```

Expected: pass.

**Step 2: Run frontend check**

Run:

```bash
bun run check
```

Expected: pass.

**Step 3: Re-run scene verification**

Run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

Expected: pass.

**Step 4: Review final diff**

Run:

```bash
git status --short
git diff --stat origin/codex/evidence-source-asset-workflow...HEAD
```

Expected: only intentional plan, skill, editor, and Chapter 1 authored Markdown changes are present.
