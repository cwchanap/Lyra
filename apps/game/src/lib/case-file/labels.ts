import type {
  Completeness,
  Confidence,
  ProceduralStatus,
  ProofCapability,
  RepresentationLayer,
  SourceKind,
} from "$lib/state/types";
import type { CaseFileSection } from "./types";

export const caseFileSectionLabels: Record<CaseFileSection, string> = {
  objective: "目前目標",
  evidence: "證物",
  statements: "證詞",
  facts: "已確認事實",
  questions: "待解問題",
  authorizations: "授權",
};

export const sourceKindLabels: Record<SourceKind, string | null> = {
  physical: "實體物證",
  testimony: "證人證詞",
  digital: "數位紀錄",
  subjective: "主觀觀察",
  unspecified: null,
};

export const representationLayerLabels: Record<
  RepresentationLayer,
  string | null
> = {
  raw: "原始紀錄",
  sync: "同步紀錄",
  summary: "摘要",
  composite: "綜合整理",
  none: null,
};

export const proceduralStatusLabels: Record<ProceduralStatus, string | null> = {
  unspecified: null,
  lead: "線索",
  reacquired: "重新取得",
  exhibit: "正式證物",
};

export const completenessLabels: Record<Completeness, string | null> = {
  complete: "完整",
  partial: "部分",
  cropped: "裁切",
  unspecified: null,
};

export const confidenceLabels: Record<Confidence, string | null> = {
  unverified: "未核實",
  corroborated: "已佐證",
  disputed: "有爭議",
  unspecified: null,
};

export const proofCapabilityLabels: Record<ProofCapability, string> = {
  time: "時間",
  order: "順序",
  route: "動線",
  identity: "身分",
  access: "出入",
  motive: "動機",
  source: "來源",
  credibility: "可信度",
  procedure: "程序",
  causation: "因果",
};
