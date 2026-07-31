import type { CaseFileSection } from "./types";

export const caseFileSectionLabels: Record<CaseFileSection, string> = {
  objective: "目前目標",
  evidence: "證物",
  statements: "證詞",
  facts: "已確認事實",
  questions: "待解問題",
  authorizations: "授權",
};
