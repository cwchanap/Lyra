/** Coupling point for chapter_1 production content. Update when authoring renames. */
export const STORY_CLEARED_STORAGE_KEY = "lyra.storyClearedOnce.v1";

// Measured N=157 mandatory advances (scene_p0 + investigation_scene_p1 first
// pass + analysis_scene_p1_5 result + scene_p2 + scene_0 queues +
// investigation_scene_1 intro) via compiled JSON. Re-examination and optional
// dialogue are excluded. Cap is higher because each step may spend one click
// on typewriter-complete before the real advance (helpers double-click).
export const DIALOGUE_DRAIN_CAP = 600;

/**
 * Selectors are plain strings (WDIO classic `$()` does not accept RegExp).
 * Prefer exact aria-label / button text partials that match production a11y.
 */
export const anchors = {
  startButton: "開始新遊戲",
  mainMenu: "主選單",
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
  advanceTestimony: "推進證詞",
  gameMenu: "遊戲選單",
  continueInvestigation: "繼續調查",
  caseFileMenuEntry: "案件檔案",
  sceneSelect: "場景跳轉",
  evidenceAcquired: "物證取得",
  caseFile: "案件檔案",
  caseFileEvidenceTab: "證物",
  caseFileReexamine: "重新檢視",

  // investigation_scene_p1: hotspots have authored layouts and render as
  // placed InvestigationSceneSurface targets (調查：<label>).
  p1Practice: {
    hotspotLabels: [
      "調查：櫃台上的收據",
      "調查：老舊收銀機的出紙口",
      "調查：櫃台後的監視器",
      "調查：店主的手寫帳本",
    ],
    analysisBoard: "分析板",
    acceptedCards: [
      "標示 REPRINT 的收據",
      "收銀機出紙口的卡紙痕跡",
      "手寫帳本的影印費",
    ],
    submit: "比對推論",
  },

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
  unicodeSave: {
    unicodeName: "雨の証拠 🕵🏽‍♀️ é",
    compositeSceneId: "investigation_scene_7",
    compositeSublocation: "後場門口",
    compositeHotspot: "調查：止滑墊與半乾水痕",
    acquisitionTitles: ["雨宮匿名訊息縮圖", "地板雨水乾燥圖"],
    interrogationSceneId: "interrogation_scene_4",
    interrogationEntryDialogue: "他從進來就一直捏著那罐東西",
    interrogationQuestion: "二十二點五十六分左右在哪裡",
    challenge: "反駁",
    withdraw: "收回",
  },
  // InvestigationSceneSurface: aria-label={`${activeCharacter.name}詢問項目`}
  topicPopoverName: "早坂茜詢問項目",
  captureProof: {
    root: "[data-save-thumbnail-root]",
    probe: "[data-capture-proof]",
    refresh: "[data-capture-proof-refresh]",
    forceUnavailable: "[data-capture-proof-force-unavailable]",
    thumbnail: "[data-capture-proof-thumbnail]",
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
