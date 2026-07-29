/** Coupling point for chapter_1 production content. Update when authoring renames. */
export const STORY_CLEARED_STORAGE_KEY = "lyra.storyClearedOnce.v1";

// Measured N=273 advances (scene_p0+p1+p2+0 queues + investigation_scene_1 intro)
// via compiled JSON. Cap is higher because each step may spend one click on
// typewriter-complete before the real advance (helpers double-click).
export const DIALOGUE_DRAIN_CAP = 600;

/**
 * Selectors are plain strings (WDIO classic `$()` does not accept RegExp).
 * Prefer exact aria-label / button text partials that match production a11y.
 */
export const anchors = {
  startButton: "開始新遊戲",
  continueGame: "繼續遊戲",
  loadGame: "載入遊戲",
  newGame: "開始新遊戲",
  saveGame: "儲存遊戲",
  returnToTitle: "返回標題畫面",
  exitGame: "結束偵查",
  nameSave: "命名存檔",
  continueName: "繼續",
  confirmOverwrite: "確認覆寫",
  confirmDelete: "確認刪除",
  previewUnavailable: "無法顯示預覽",
  advanceDialogue: "推進對話",
  gameMenu: "遊戲選單",
  continueInvestigation: "繼續調查",
  evidenceMenuEntry: "物證檔案",
  sceneSelect: "場景跳轉",
  evidenceAcquired: "物證取得",
  evidenceFile: "物證檔案",

  // investigation_scene_1 (first investigation after prologue)
  investigationSceneId: "investigation_scene_1",
  sublocationLabel: "相馬事務所",
  hotspotEvidence: {
    id: "kagami_summary_hotspot",
    // InvestigationSceneSurface: aria-label={`調查：${hotspot.label}`}
    label: "調查：桌面卷宗夾",
  },
  evidenceName: "KAGAMI 摘要副本",
  character: {
    id: "hayasaka",
    // InvestigationSceneSurface: aria-label={`詢問：${character.name}`}
    label: "詢問：早坂茜",
  },
  hpa392: {
    unicodeName: "雨の証拠 🕵🏽‍♀️ é",
    compositeSceneId: "investigation_scene_7",
    compositeSublocation: "後場門口",
    compositeHotspot: "調查：止滑墊與半乾水痕",
    acquisitionTitles: ["雨宮匿名訊息縮圖", "地板雨水乾燥圖"],
    interrogationSceneId: "interrogation_scene_4",
    interrogationQuestion: "二十二點五十六分左右在哪裡",
    challenge: "反駁",
    withdraw: "收回",
  },
  // InvestigationSceneSurface: aria-label={`${activeCharacter.name}詢問項目`}
  topicPopoverName: "早坂茜詢問項目",
  captureProof: {
    root: "[data-save-thumbnail-root]",
    probe: "[data-hpa-392-capture-proof]",
    refresh: "[data-hpa-392-capture-proof-refresh]",
    forceUnavailable: "[data-hpa-392-capture-proof-force-unavailable]",
    thumbnail: "[data-hpa-392-capture-proof-thumbnail]",
    sceneId: "scene_2",
    sceneEntryDialogue: "三宅蒼太的母親",
    preSwapDialogue: "我胃不好",
    leavingPortrait: "portraits/miyake_mother/standard.png",
    newestPortrait: "portraits/soma_ritsu/standard.png",
    recoveryPortraitDialogue: "他在店裡",
  },
} as const;

/** Dialogs use aria-labelledby (not aria-label). Match via heading text. */
export function dialogByHeading(heading: string): string {
  return `//div[@role="dialog"][.//h2[contains(normalize-space(.), "${heading}")]]`;
}
