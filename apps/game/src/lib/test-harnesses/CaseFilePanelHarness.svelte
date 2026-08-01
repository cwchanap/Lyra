<script lang="ts">
  import CaseFilePanel from "$lib/components/case-file/CaseFilePanel.svelte";
  import type { GameStateView } from "$lib/state/types";

  let section = $state<
    | "objective"
    | "evidence"
    | "statements"
    | "facts"
    | "questions"
    | "authorizations"
  >("objective");
  let panelDisabled = $state(false);
  let gameState = $state<GameStateView>({
    mode: { type: "gameComplete" },
    chapter: {
      id: "chapter_1",
      title: "第一章",
      summary: "",
      index: 0,
      total: 1,
    },
    scene: {
      kind: "linear",
      id: "scene_1",
      title: "雨中現場",
      summary: "",
      index: 0,
      total: 1,
    },
    inventory: {
      evidence: [
        {
          id: "receipt",
          name: "咖啡收據",
          description: "時間被圈起的收據。",
          details: "收據顯示關鍵時間。",
          provenance: {
            sourceKind: "unspecified",
            representationLayer: "none",
            proceduralStatus: "unspecified",
            completeness: "unspecified",
            confidence: "unspecified",
            sourceGroupId: null,
            sourceLabel: null,
            proofCapabilities: [],
            supersedesRecordId: null,
          },
          imageAssetId: null,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
          acquisitionContext: {
            chapterId: "chapter_1",
            chapterTitle: "第一章",
            sceneId: "scene_1",
            sceneTitle: "雨中現場",
          },
          sourceGroup: null,
        },
        {
          id: "umbrella",
          name: "黑色雨傘",
          description: "傘柄留下指紋。",
          details: "傘柄有新鮮指紋。",
          provenance: {
            sourceKind: "unspecified",
            representationLayer: "none",
            proceduralStatus: "unspecified",
            completeness: "unspecified",
            confidence: "unspecified",
            sourceGroupId: null,
            sourceLabel: null,
            proofCapabilities: [],
            supersedesRecordId: null,
          },
          imageAssetId: null,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
          acquisitionContext: {
            chapterId: "chapter_1",
            chapterTitle: "第一章",
            sceneId: "scene_1",
            sceneTitle: "雨中現場",
          },
          sourceGroup: null,
        },
      ],
      statements: [],
    },
    story: {
      objectives: [
        {
          id: "find-witness",
          label: "找到目擊者",
          summary: "確認雨夜目擊者。",
          kind: "primary",
          sortOrder: 1,
          completed: false,
          activePrimary: true,
        },
        {
          id: "check-alibi",
          label: "確認不在場證明",
          summary: "核對嫌疑人的說法。",
          kind: "secondary",
          sortOrder: 2,
          completed: false,
          activePrimary: false,
        },
        {
          id: "trace-umbrella",
          label: "追查雨傘來源",
          summary: "確認雨傘的所有人。",
          kind: "secondary",
          sortOrder: 3,
          completed: false,
          activePrimary: false,
        },
        ...["完成四", "完成三", "完成二", "完成一"].map((label, index) => ({
          id: `complete-${index + 1}`,
          label,
          summary: `${label}的結案摘要。`,
          kind: "secondary" as const,
          sortOrder: 20 - index,
          completed: true,
          activePrimary: false,
        })),
      ],
      facts: [
        {
          id: "receipt-time",
          label: "收據時間",
          summary: "收據記錄了時間。",
          details: "時間與證詞矛盾。",
          category: "時間",
          assertedInChapterId: "chapter_1",
          assertedInSceneId: "scene_1",
          firstOrigin: {
            type: "sceneEvent",
            chapterId: "chapter_1",
            sceneId: "scene_1",
            blockKind: "hotspot",
            blockId: "counter",
          },
          originContext: {
            type: "scene",
            originKind: "sceneEvent",
            location: {
              chapterId: "chapter_1",
              chapterTitle: "第一章",
              sceneId: "scene_1",
              sceneTitle: "雨中現場",
            },
          },
          supportingRecords: [
            { kind: "evidence", id: "receipt" },
            { kind: "evidence", id: "hidden-record" },
          ],
          supportingFactIds: ["clock-confirmed", "hidden-fact"],
        },
        {
          id: "clock-confirmed",
          label: "時鐘確認",
          summary: "店內時鐘運作正常。",
          details: "維修紀錄確認沒有誤差。",
          category: "時間",
          assertedInChapterId: "chapter_1",
          assertedInSceneId: "scene_1",
          firstOrigin: {
            type: "sceneEvent",
            chapterId: "chapter_1",
            sceneId: "scene_1",
            blockKind: "hotspot",
            blockId: "clock",
          },
          originContext: {
            type: "scene",
            originKind: "sceneEvent",
            location: {
              chapterId: "chapter_1",
              chapterTitle: "第一章",
              sceneId: "scene_1",
              sceneTitle: "雨中現場",
            },
          },
          supportingRecords: [{ kind: "evidence", id: "umbrella" }],
          supportingFactIds: [],
        },
      ],
      questions: [
        {
          id: "arrival",
          label: "嫌疑人何時抵達？",
          summary: "確認抵達時間。",
          status: "resolved",
          resolvedByFactId: "receipt-time",
        },
        {
          id: "motive",
          label: "嫌疑人的動機是什麼？",
          summary: "找出衝突原因。",
          status: "open",
          resolvedByFactId: null,
        },
      ],
      authorizations: [
        {
          id: "search",
          label: "調閱店內紀錄",
          summary: "可調閱當日店內紀錄。",
          grantingAuthority: "搜查課長",
          grantedInChapterId: null,
          grantedInSceneId: null,
          firstOrigin: { type: "migration", migrationId: "legacy" },
          originContext: { type: "migration" },
        },
      ],
    },
    dialogueHistory: [],
    pendingAcquisition: null,
  });

  function removeSelectedEvidence() {
    gameState = {
      ...gameState,
      inventory: {
        ...gameState.inventory,
        evidence: gameState.inventory.evidence.slice(0, -1),
      },
    };
  }

  function removeReceiptDuringRelation() {
    gameState = {
      ...gameState,
      inventory: {
        ...gameState.inventory,
        evidence: gameState.inventory.evidence.filter(
          (evidence) => evidence.id !== "receipt",
        ),
      },
    };
  }

  function clearCaseFile() {
    gameState = {
      ...gameState,
      inventory: { evidence: [], statements: [] },
      story: { facts: [], questions: [], objectives: [], authorizations: [] },
    };
  }

  function setSectionFromParent() {
    section = "questions";
  }

  function toggleDisabled() {
    panelDisabled = !panelDisabled;
  }
</script>

<button
  type="button"
  data-case-file-action="remove-selected-evidence"
  onclick={removeSelectedEvidence}>移除選取證物</button
>
<button type="button" data-case-file-action="clear" onclick={clearCaseFile}
  >清空案件檔案</button
>
<button
  type="button"
  data-case-file-action="remove-receipt-during-relation"
  onclick={removeReceiptDuringRelation}>使支持證物失效</button
>
<button
  type="button"
  data-case-file-action="set-section-from-parent"
  onclick={setSectionFromParent}>由父層切換待解問題</button
>
<button
  type="button"
  data-case-file-action="toggle-disabled"
  onclick={toggleDisabled}
  >{panelDisabled ? "啟用案件檔案" : "停用案件檔案"}</button
>

<CaseFilePanel
  state={gameState}
  bind:section
  reexamineEnabled={false}
  onReexamineEvidence={() => {}}
  onReexamineStatement={() => {}}
  disabled={panelDisabled}
/>
