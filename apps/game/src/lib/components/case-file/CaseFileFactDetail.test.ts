import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CaseFileFactItem } from "$lib/case-file/types";
import type { FactView } from "$lib/state/types";
import CaseFileFactDetail from "./CaseFileFactDetail.svelte";

function factView(overrides: Partial<FactView> = {}): FactView {
  return {
    id: "fact_route",
    label: "路線已確認",
    summary: "目擊筆錄支持移動路線。",
    details: "路線結論同時依賴時鐘事實。",
    category: "位置",
    assertedInChapterId: "chapter_1",
    assertedInSceneId: "scene_1",
    firstOrigin: {
      type: "sceneEvent",
      chapterId: "chapter_1",
      sceneId: "scene_1",
      blockKind: "hotspot",
      blockId: "fixture",
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
    supportingRecords: [],
    supportingFactIds: [],
    ...overrides,
  };
}

function factItem(overrides: Partial<CaseFileFactItem> = {}): CaseFileFactItem {
  return {
    key: "fact:fact_route",
    section: "facts",
    fact: factView(),
    supportingRecordKeys: [],
    supportingFactKeys: [],
    ...overrides,
  };
}

describe("CaseFileFactDetail", () => {
  it("renders conservative copy when public supporting records are empty", () => {
    // FactView.supportingRecords is spoiler-gated: an empty public list
    // cannot be read as "the fact has no support" — only "no acquired direct
    // support is currently visible." The detail must keep the section and
    // say so, rather than omitting it.
    render(CaseFileFactDetail, {
      item: factItem(),
      supportingRecords: [],
      supportingFacts: [],
      onNavigate: vi.fn(),
    });

    expect(
      screen.getByRole("heading", { name: "直接支持紀錄" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("沒有可顯示的已取得直接支持紀錄。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("沒有可顯示的已確認直接支持事實。"),
    ).toBeInTheDocument();
  });

  it("renders the supporting record list when public support is non-empty", () => {
    render(CaseFileFactDetail, {
      item: factItem({
        supportingRecordKeys: ["evidence:receipt"],
      }),
      supportingRecords: [
        {
          key: "evidence:receipt",
          section: "evidence",
          target: { kind: "evidence", id: "receipt" },
          record: {
            id: "receipt",
            name: "咖啡收據",
            description: "",
            details: "",
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
          predecessor: null,
          successor: null,
          hasVisibleProvenance: false,
        },
      ],
      supportingFacts: [],
      onNavigate: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: "查看支持記錄：咖啡收據" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("沒有可顯示的已取得直接支持紀錄。"),
    ).not.toBeInTheDocument();
  });
});
