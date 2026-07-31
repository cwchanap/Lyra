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
          supportingRecords: [{ kind: "evidence", id: "receipt" }],
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
        evidence: gameState.inventory.evidence.slice(0, 1),
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
</script>

<button
  type="button"
  data-case-file-action="remove-selected-evidence"
  onclick={removeSelectedEvidence}>移除選取證物</button
>
<button type="button" data-case-file-action="clear" onclick={clearCaseFile}
  >清空案件檔案</button
>

<CaseFilePanel
  state={gameState}
  bind:section
  reexamineEnabled={false}
  onReexamineEvidence={() => {}}
  onReexamineStatement={() => {}}
/>
