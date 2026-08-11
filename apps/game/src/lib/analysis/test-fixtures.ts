import type {
  AnalysisBoardView,
  AnalysisCardView,
  AnalysisDraft,
  Inventory,
  Mode,
  SceneView,
} from "$lib/state/types";
import {
  neutralCaseRecordProvenance,
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "$lib/state/test-fixtures";

type AnalysisSceneView = Extract<SceneView, { kind: "analysis" }>;
type AnalysisMode = Extract<Mode, { type: "analysis" }>;
type ClassifyBoardView = Extract<AnalysisBoardView, { kind: "classify" }>;
type OrderBoardView = Extract<AnalysisBoardView, { kind: "order" }>;
type ThresholdBoardView = Extract<AnalysisBoardView, { kind: "threshold" }>;

function practiceCard(
  id: string,
  label: string,
  summary: string,
): AnalysisCardView {
  return {
    id,
    label,
    summary,
    source: { kind: "practice", id, label: null, summary: null },
    sourceLabel: null,
    sourceSummary: null,
    available: true,
  };
}

function evidenceCard(
  id: string,
  label: string,
  summary: string,
  sourceId: string,
  sourceLabel: string,
  sourceSummary: string,
): AnalysisCardView {
  return {
    id,
    label,
    summary,
    source: {
      kind: "evidence",
      id: sourceId,
      label: sourceLabel,
      summary: sourceSummary,
    },
    sourceLabel,
    sourceSummary,
    available: true,
  };
}

function statementCard(
  id: string,
  label: string,
  summary: string,
  sourceId: string,
  sourceLabel: string,
  sourceSummary: string,
): AnalysisCardView {
  return {
    id,
    label,
    summary,
    source: {
      kind: "statement",
      id: sourceId,
      label: sourceLabel,
      summary: sourceSummary,
    },
    sourceLabel,
    sourceSummary,
    available: true,
  };
}

function p1PracticeBoard(): ThresholdBoardView {
  return {
    kind: "threshold",
    id: "p1_reprint_time_board",
    label: "重印時間整理",
    prompt: "選出正確的三項資料。",
    minimumSelected: 3,
    selectedCardIds: [],
    available: true,
    completed: false,
    readOnly: false,
    draft: { kind: "threshold", selectedCardIds: [] },
    feedback: null,
    hint: null,
    cards: [
      practiceCard(
        "receipt_reprint",
        "標示 REPRINT 的收據",
        "十七點四十二分的重印時間。",
      ),
      practiceCard(
        "register_paper_jam",
        "收銀機出紙口的卡紙痕跡",
        "原本的收據可能卡住。",
      ),
      practiceCard(
        "cctv_change",
        "監視器中的找零畫面",
        "學生在十七點三十八分前離開。",
      ),
      practiceCard(
        "handwritten_ledger",
        "手寫帳本的影印費",
        "十七點三十七分的收入。",
      ),
    ],
  };
}

export const p1PracticeAnalysisSceneFixture: AnalysisSceneView = {
  kind: "analysis",
  id: "analysis_scene_p1_5",
  title: "把時間排回去",
  summary: "P1 practice",
  index: 2,
  total: 17,
  activeBoardId: "p1_reprint_time_board",
  actionToken: {
    sceneId: "analysis_scene_p1_5",
    activeBoardId: "p1_reprint_time_board",
    durableRevision: 3,
  },
  availableBoardIds: ["p1_reprint_time_board"],
  backgroundAssetId: null,
  bgm: null,
  bgs: null,
  visibleBoards: [p1PracticeBoard()],
};

export const p1PracticeAnalysisModeFixture: AnalysisMode = {
  type: "analysis",
  boardId: "p1_reprint_time_board",
  activeBoardId: "p1_reprint_time_board",
  actionToken: {
    sceneId: "analysis_scene_p1_5",
    activeBoardId: "p1_reprint_time_board",
    durableRevision: 3,
  },
  availableBoardIds: ["p1_reprint_time_board"],
  feedback: null,
  lastFeedback: null,
  backgroundAssetId: null,
  bgm: null,
  bgs: null,
};

const miyakeCall = neutralEvidenceRecordView({
  id: "miyake_call_record",
  name: "三宅母親通話紀錄",
  description: "可解釋三宅隱瞞通話原因的正式調閱紀錄。",
  details: "通話內容與時間已由電信方回覆並固定。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_1",
});

const corridorReplay = neutralEvidenceRecordView({
  id: "l_corridor_replay",
  name: "L 型後場視角重演",
  description: "重建三宅站位與內側倉庫的遮蔽關係。",
  details: "重演顯示三宅當時的位置看不見內側倉庫。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_1",
});

const externalCredential = neutralEvidenceRecordView({
  id: "external_credential_event",
  name: "外包憑證事件",
  description: "排在三宅之前的外部維護憑證開門事件。",
  details: "外部憑證從承包商動線進入，身分仍未對應。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_1",
});

const event1841 = neutralEvidenceRecordView({
  id: "event_1841",
  name: "維護模式開啟",
  description: "本機事件 1841。",
  details: "門鎖面板記錄維護模式開啟。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_1",
});

const event1842 = neutralEvidenceRecordView({
  id: "event_1842",
  name: "外包憑證開門",
  description: "本機事件 1842。",
  details: "門鎖面板記錄外部維護憑證開啟後門。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_1",
});

const event1843 = neutralEvidenceRecordView({
  id: "event_1843",
  name: "員工憑證開門",
  description: "本機事件 1843。",
  details: "門鎖面板記錄員工憑證開啟後走廊。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_1",
});

const event1844 = neutralEvidenceRecordView({
  id: "event_1844",
  name: "伺服器合併完成",
  description: "本機事件 1844。",
  details: "面板記錄維護同步與伺服器合併完成。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_1",
});

const lock = neutralEvidenceRecordView({
  id: "lock_sequence",
  name: "門鎖本機順序",
  description: "門鎖設備本機事件順序。",
  details: "只提供先後，不提供精確秒數。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_7",
});
lock.provenance = {
  ...neutralCaseRecordProvenance(),
  sourceKind: "digital",
  proceduralStatus: "reacquired",
  sourceGroupId: "door-lock",
  sourceLabel: "雨鐘後場門鎖",
  proofCapabilities: ["time", "order"],
};
lock.sourceGroup = {
  id: "door-lock",
  label: "門鎖本機",
  summary: "雨鐘後場門鎖的本機資料。",
};

const phoneNotification = neutralEvidenceRecordView({
  id: "phone_notification",
  name: "死者手機通知",
  description: "重新調閱的死者手機通知紀錄。",
  details: "通知時間提供獨立的時間錨。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_7",
});
phoneNotification.provenance = {
  ...neutralCaseRecordProvenance(),
  sourceKind: "digital",
  proceduralStatus: "reacquired",
  sourceGroupId: "phone-archive",
  sourceLabel: "手機通知調閱回覆",
  proofCapabilities: ["time"],
};
phoneNotification.sourceGroup = {
  id: "phone-archive",
  label: "手機通知",
  summary: "死者手機通知的調閱資料。",
};

const managerTiming = neutralStatementRecordView({
  id: "manager_timing",
  speaker: "店長",
  content: "「我在面板同步前就聽見後門開了。」",
  onReexamine: null,
  acquiredInChapterId: "chapter_1",
  acquiredInSceneId: "investigation_scene_1",
});
managerTiming.provenance = {
  ...neutralCaseRecordProvenance(),
  sourceKind: "testimony",
  proceduralStatus: "exhibit",
  sourceGroupId: "manager-interview",
  sourceLabel: "店長程序固定訪談",
  proofCapabilities: ["time"],
};
managerTiming.sourceGroup = {
  id: "manager-interview",
  label: "店長訪談",
  summary: "店長程序固定訪談的紀錄。",
};

const sameSourceGroupEvidence = neutralEvidenceRecordView({
  id: "same_source_group_evidence",
  name: "同源紀錄 A",
  description: "同一來源群組的測試紀錄 A。",
  details: "僅供分析板測試。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_7",
});
sameSourceGroupEvidence.provenance = {
  ...neutralCaseRecordProvenance(),
  sourceKind: "digital",
  sourceGroupId: "door-lock",
  sourceLabel: "雨鐘後場門鎖",
  proofCapabilities: ["time"],
};
sameSourceGroupEvidence.sourceGroup = {
  id: "door-lock",
  label: "門鎖本機",
  summary: "雨鐘後場門鎖的本機資料。",
};

const sameSourceGroupStatement = neutralStatementRecordView({
  id: "same_source_group_statement",
  speaker: "同源證人",
  content: "同一來源群組的測試紀錄 B。",
  onReexamine: null,
  acquiredInChapterId: "chapter_1",
  acquiredInSceneId: "investigation_scene_7",
});
sameSourceGroupStatement.provenance = {
  ...neutralCaseRecordProvenance(),
  sourceKind: "testimony",
  sourceGroupId: "door-lock",
  sourceLabel: "雨鐘後場門鎖",
  proofCapabilities: ["order"],
};
sameSourceGroupStatement.sourceGroup = {
  id: "door-lock",
  label: "門鎖本機",
  summary: "雨鐘後場門鎖的本機資料。",
};

export const beat85CompilerAnalysisInventoryFixture: Inventory = {
  evidence: [
    miyakeCall,
    corridorReplay,
    externalCredential,
    event1841,
    event1842,
    event1843,
    event1844,
    lock,
    phoneNotification,
    sameSourceGroupEvidence,
  ],
  statements: [managerTiming, sameSourceGroupStatement],
};

const classifyBoard: ClassifyBoardView = {
  kind: "classify",
  id: "evidence_packages",
  label: "證據包整理",
  prompt: "把每張卡放進它真正支持的命題。",
  cards: [
    evidenceCard(
      "miyake_call",
      "三宅母親通話紀錄",
      "解釋三宅隱瞞通話的原因。",
      "miyake_call_record",
      "三宅母親通話紀錄",
      "可解釋三宅隱瞞通話原因的正式調閱紀錄。",
    ),
    evidenceCard(
      "l_corridor_replay",
      "L 型後場視角重演",
      "證明三宅當時站位看不見內側倉庫。",
      "l_corridor_replay",
      "L 型後場視角重演",
      "重建三宅站位與內側倉庫的遮蔽關係。",
    ),
    evidenceCard(
      "external_credential_event",
      "外包憑證事件",
      "證明有人比三宅更早從承包商動線進入。",
      "external_credential_event",
      "外包憑證事件",
      "排在三宅之前的外部維護憑證開門事件。",
    ),
  ],
  groups: [
    {
      id: "miyake_small_lies",
      label: "三宅的小謊",
      description: "只解釋生活壓力造成的隱瞞。",
    },
    {
      id: "earlier_third_party",
      label: "更早的第三者",
      description: "支持更早外部進入者存在的資料。",
    },
  ],
  available: true,
  completed: false,
  readOnly: false,
  draft: { kind: "classify", groupByCard: {} },
  feedback: null,
  hint: "先問每一項資料真正能證明什麼。",
};

const orderBoard: OrderBoardView = {
  kind: "order",
  id: "local_event_sequence",
  label: "本機事件順序",
  prompt: "把本機事件排回原始先後。",
  cards: [
    evidenceCard(
      "event_1841",
      "維護模式開啟",
      "本機事件 1841。",
      "event_1841",
      "維護模式開啟",
      "本機事件 1841。",
    ),
    evidenceCard(
      "event_1842",
      "外包憑證開門",
      "本機事件 1842。",
      "event_1842",
      "外包憑證開門",
      "本機事件 1842。",
    ),
    evidenceCard(
      "event_1843",
      "員工憑證開門",
      "本機事件 1843。",
      "event_1843",
      "員工憑證開門",
      "本機事件 1843。",
    ),
    evidenceCard(
      "event_1844",
      "伺服器合併完成",
      "本機事件 1844。",
      "event_1844",
      "伺服器合併完成",
      "本機事件 1844。",
    ),
  ],
  fixedAnchors: [{ cardId: "event_1841", position: 1 }],
  available: true,
  completed: false,
  readOnly: false,
  draft: { kind: "order", cardIds: ["event_1841"] },
  feedback: null,
  hint: null,
};

const thresholdBoard: ThresholdBoardView = {
  kind: "threshold",
  id: "narrow_request_basis",
  label: "有限調取申請基礎",
  prompt: "選出足以支持有限調取申請的獨立矛盾。",
  cards: [
    evidenceCard(
      "lock_sequence",
      "門鎖本機順序",
      "提供事件先後與摘要時間不一致的證明。",
      "lock_sequence",
      "門鎖本機順序",
      "門鎖設備本機事件順序。",
    ),
    evidenceCard(
      "phone_notification",
      "死者手機通知",
      "提供獨立時間錨。",
      "phone_notification",
      "死者手機通知",
      "重新調閱的死者手機通知紀錄。",
    ),
    statementCard(
      "manager_timing",
      "店長時間證詞",
      "提供另一個可被程序固定的時間來源。",
      "manager_timing",
      "店長",
      "「我在面板同步前就聽見後門開了。」",
    ),
  ],
  minimumSelected: 2,
  selectedCardIds: ["lock_sequence"],
  available: true,
  completed: false,
  readOnly: false,
  draft: { kind: "threshold", selectedCardIds: ["lock_sequence"] },
  feedback: null,
  hint: null,
};

export const beat85CompilerAnalysisSceneFixture: AnalysisSceneView = {
  kind: "analysis",
  id: "analysis_scene_8_5",
  title: "短暫誤判整理點",
  summary: "相馬與早坂整理目前真正成立的命題。",
  index: 0,
  total: 1,
  activeBoardId: "evidence_packages",
  actionToken: {
    sceneId: "analysis_scene_8_5",
    activeBoardId: "evidence_packages",
    durableRevision: 8,
  },
  availableBoardIds: [
    "evidence_packages",
    "local_event_sequence",
    "narrow_request_basis",
  ],
  backgroundAssetId: null,
  bgm: null,
  bgs: null,
  visibleBoards: [classifyBoard, orderBoard, thresholdBoard],
};

export const beat85CompilerAnalysisModeFixture: AnalysisMode = {
  type: "analysis",
  boardId: "evidence_packages",
  activeBoardId: "evidence_packages",
  actionToken: {
    sceneId: "analysis_scene_8_5",
    activeBoardId: "evidence_packages",
    durableRevision: 8,
  },
  availableBoardIds: [
    "evidence_packages",
    "local_event_sequence",
    "narrow_request_basis",
  ],
  feedback: null,
  lastFeedback: null,
  backgroundAssetId: null,
  bgm: null,
  bgs: null,
};

export const beat85CompilerAnalysisDrafts: {
  classifyEmpty: AnalysisDraft;
  classifyPartial: AnalysisDraft;
  orderEmpty: AnalysisDraft;
  orderPartial: AnalysisDraft;
  thresholdEmpty: AnalysisDraft;
  thresholdPartial: AnalysisDraft;
} = {
  classifyEmpty: { kind: "classify", groupByCard: {} },
  classifyPartial: {
    kind: "classify",
    groupByCard: { miyake_call: "miyake_small_lies" },
  },
  orderEmpty: { kind: "order", cardIds: [] },
  orderPartial: { kind: "order", cardIds: ["event_1841"] },
  thresholdEmpty: { kind: "threshold", selectedCardIds: [] },
  thresholdPartial: {
    kind: "threshold",
    selectedCardIds: ["lock_sequence"],
  },
};
