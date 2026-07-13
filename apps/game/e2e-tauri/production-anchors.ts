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
  startButton: "開始調查",
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
  // InvestigationSceneSurface: aria-label={`${activeCharacter.name}詢問項目`}
  topicPopoverName: "早坂茜詢問項目",
} as const;

/** Dialogs use aria-labelledby (not aria-label). Match via heading text. */
export function dialogByHeading(heading: string): string {
  return `//div[@role="dialog"][.//h2[contains(normalize-space(.), "${heading}")]]`;
}
