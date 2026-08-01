import {
  getRoles,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import CaseFilePanelHarness from "$lib/test-harnesses/CaseFilePanelHarness.svelte";
import type { GameStateView } from "$lib/state/types";
import {
  closeTopmostEscapeClaim,
  escapeClaimed,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import CaseFilePanel from "./CaseFilePanel.svelte";

const lockedAcceptanceIds = [
  "future_scan",
  "locked_statement",
  "fact_locked",
  "question_locked",
  "objective_locked",
  "authorization_locked",
] as const;

const neutralProvenance = {
  sourceKind: "unspecified" as const,
  representationLayer: "none" as const,
  proceduralStatus: "unspecified" as const,
  completeness: "unspecified" as const,
  confidence: "unspecified" as const,
  sourceGroupId: null,
  sourceLabel: null,
  proofCapabilities: [],
  supersedesRecordId: null,
};

const acceptanceLocation = {
  chapterId: "synthetic_chapter",
  chapterTitle: "合成測試章",
  sceneId: "synthetic_case_file",
  sceneTitle: "案件檔案測試室",
};

function acceptanceState(): GameStateView {
  const recordBase = {
    onReexamine: null,
    acquisitionContext: acceptanceLocation,
    sourceGroup: null,
  };
  return {
    mode: { type: "gameComplete" },
    chapter: {
      id: "synthetic_chapter",
      title: "合成測試章",
      summary: "",
      index: 0,
      total: 1,
    },
    scene: {
      kind: "linear",
      id: "synthetic_case_file",
      title: "案件檔案測試室",
      index: 0,
      total: 1,
    },
    inventory: {
      evidence: [
        {
          ...recordBase,
          id: "neutral_note",
          name: "折角便箋",
          description: "折角便箋摘要。",
          details: "折角便箋詳情。",
          provenance: neutralProvenance,
          imageAssetId: null,
          collectedInChapterId: "synthetic_chapter",
          collectedInSceneId: "synthetic_case_file",
        },
        {
          ...recordBase,
          id: "shared_record",
          name: "共用代號照片",
          description: "共用代號照片摘要。",
          details: "共用代號照片詳情。",
          provenance: {
            ...neutralProvenance,
            sourceKind: "digital",
            representationLayer: "raw",
            proceduralStatus: "lead",
            completeness: "complete",
            confidence: "corroborated",
            sourceGroupId: null,
            sourceLabel: "合成照片",
            proofCapabilities: [],
          },
          imageAssetId: null,
          collectedInChapterId: "synthetic_chapter",
          collectedInSceneId: "synthetic_case_file",
          sourceGroup: null,
        },
        {
          ...recordBase,
          id: "signed_scan",
          name: "簽署掃描",
          description: "簽署掃描摘要。",
          details: "簽署掃描詳情。",
          provenance: {
            ...neutralProvenance,
            sourceKind: "digital",
            representationLayer: "sync",
            proceduralStatus: "exhibit",
            completeness: "complete",
            confidence: "corroborated",
            sourceGroupId: null,
            sourceLabel: "合成簽署掃描",
            proofCapabilities: ["time", "identity", "source", "procedure"],
            supersedesRecordId: "statement:shared_record",
          },
          imageAssetId: null,
          collectedInChapterId: "synthetic_chapter",
          collectedInSceneId: "synthetic_case_file",
          sourceGroup: null,
        },
        {
          ...recordBase,
          id: "orphan_scan",
          name: "孤立掃描",
          description: "孤立掃描摘要。",
          details: "孤立掃描詳情。",
          provenance: {
            ...neutralProvenance,
            sourceKind: "digital",
            representationLayer: "sync",
            proceduralStatus: "reacquired",
            completeness: "complete",
            confidence: "corroborated",
            sourceLabel: "合成孤立掃描",
            proofCapabilities: ["source"],
          },
          imageAssetId: null,
          collectedInChapterId: "synthetic_chapter",
          collectedInSceneId: "synthetic_case_file",
        },
      ],
      statements: [
        {
          ...recordBase,
          id: "shared_record",
          speaker: "目擊者乙",
          content: "我看見簽署檔案移交。",
          provenance: {
            ...neutralProvenance,
            sourceKind: "testimony",
            representationLayer: "raw",
            proceduralStatus: "lead",
            completeness: "complete",
            confidence: "corroborated",
            sourceGroupId: "synthetic_bundle",
            sourceLabel: "合成目擊筆錄",
            proofCapabilities: ["identity"],
          },
          acquiredInChapterId: "synthetic_chapter",
          acquiredInSceneId: "synthetic_case_file",
          sourceGroup: {
            id: "synthetic_bundle",
            label: "合成來源組",
            summary: "只公開玩家已取得紀錄所需的來源摘要。",
          },
        },
      ],
    },
    story: {
      facts: [
        {
          id: "fact_clock",
          label: "時鐘已校準",
          summary: "便箋時間可直接採信。",
          details: "校準紀錄與便箋互相吻合。",
          category: "時序",
          assertedInChapterId: "synthetic_chapter",
          assertedInSceneId: "synthetic_case_file",
          firstOrigin: {
            type: "sceneEvent",
            chapterId: "synthetic_chapter",
            sceneId: "synthetic_case_file",
            blockKind: "hotspot",
            blockId: "acceptance_fixture",
          },
          originContext: {
            type: "scene",
            originKind: "sceneEvent",
            location: acceptanceLocation,
          },
          supportingRecords: [
            { kind: "evidence", id: "neutral_note" },
            { kind: "evidence", id: "future_scan" },
            { kind: "statement", id: "locked_statement" },
          ],
          supportingFactIds: [
            "fact_locked",
            "question_locked",
            "objective_locked",
            "authorization_locked",
          ],
        },
        {
          id: "fact_route",
          label: "路線已確認",
          summary: "目擊筆錄支持移動路線。",
          details: "路線結論同時依賴時鐘事實。",
          category: "位置",
          assertedInChapterId: "synthetic_chapter",
          assertedInSceneId: "synthetic_case_file",
          firstOrigin: {
            type: "sceneEvent",
            chapterId: "synthetic_chapter",
            sceneId: "synthetic_case_file",
            blockKind: "hotspot",
            blockId: "acceptance_fixture",
          },
          originContext: {
            type: "scene",
            originKind: "sceneEvent",
            location: acceptanceLocation,
          },
          supportingRecords: [{ kind: "statement", id: "shared_record" }],
          supportingFactIds: ["fact_clock"],
        },
      ],
      questions: [
        {
          id: "question_open",
          label: "誰留下便箋？",
          summary: "仍需確認便箋作者。",
          status: "open",
          resolvedByFactId: null,
        },
        {
          id: "question_resolved",
          label: "目擊路線為何？",
          summary: "已由路線事實解答。",
          status: "resolved",
          resolvedByFactId: "fact_route",
        },
      ],
      objectives: [
        {
          id: "objective_primary",
          label: "確認合成檔案",
          summary: "核對所有已揭露資料。",
          kind: "primary",
          sortOrder: 1,
          completed: false,
          activePrimary: true,
        },
        ...[
          ["objective_secondary_a", "核對來源", 2, false],
          ["objective_secondary_b", "核對時間", 3, false],
          ["objective_completed_1", "完成舊線索一", 10, true],
          ["objective_completed_2", "完成舊線索二", 11, true],
          ["objective_completed_3", "完成舊線索三", 12, true],
          ["objective_completed_4", "完成舊線索四", 13, true],
        ].map(([id, label, sortOrder, completed]) => ({
          id: id as string,
          label: label as string,
          summary: `${label as string}摘要。`,
          kind: "secondary" as const,
          sortOrder: sortOrder as number,
          completed: completed as boolean,
          activePrimary: false,
        })),
      ],
      authorizations: [
        {
          id: "authorization_archive",
          label: "調閱合成檔案",
          summary: "可調閱本測試的合成來源。",
          grantingAuthority: "測試管理員",
          grantedInChapterId: "synthetic_chapter",
          grantedInSceneId: "synthetic_case_file",
          firstOrigin: {
            type: "sceneEvent",
            chapterId: "synthetic_chapter",
            sceneId: "synthetic_case_file",
            blockKind: "hotspot",
            blockId: "acceptance_fixture",
          },
          originContext: {
            type: "scene",
            originKind: "sceneEvent",
            location: acceptanceLocation,
          },
        },
      ],
    },
    dialogueHistory: [],
    pendingAcquisition: null,
  };
}

function expectLockedIdsAbsent(container: HTMLElement) {
  const text = container.textContent ?? "";
  const queries = within(container);
  const roles = Object.keys(getRoles(container));
  for (const id of lockedAcceptanceIds) {
    expect(text).not.toContain(id);
    for (const role of roles) {
      expect(
        queries.queryAllByRole(role, {
          name: (accessibleName) => accessibleName.includes(id),
        }),
      ).toHaveLength(0);
    }
  }
}

describe("CaseFilePanel", () => {
  afterEach(() => {
    resetEscapeCoordinator();
  });

  it("uses direct rail, list, and detail columns with a tabpanel relationship", () => {
    render(CaseFilePanel, {
      state: acceptanceState(),
      reexamineEnabled: false,
      onReexamineEvidence: () => {},
      onReexamineStatement: () => {},
    });

    const panel = screen.getByRole("region", { name: "案件檔案" });
    const directColumns = Array.from(panel.children);
    expect(directColumns).toHaveLength(3);
    expect(directColumns[0]).toContainElement(
      screen.getByRole("navigation", { name: "案件檔案分類" }),
    );
    expect(directColumns[1]).toContainElement(
      screen.getByRole("region", { name: "目前目標清單" }),
    );

    const activeTab = screen.getByRole("tab", { name: "目前目標 7 項" });
    const controlledId = activeTab.getAttribute("aria-controls");
    expect(activeTab).toHaveAttribute("id");
    expect(controlledId).not.toBeNull();
    const tabpanel = document.getElementById(controlledId!);
    expect(directColumns[2]).toContainElement(tabpanel);
    expect(tabpanel).toHaveAttribute("role", "tabpanel");
    expect(tabpanel).toHaveAttribute("aria-labelledby", activeTab.id);
  });

  it("gives same-speaker statement rows distinct visible and accessible excerpts", () => {
    const state = acceptanceState();
    state.inventory.statements = [
      {
        ...state.inventory.statements[0]!,
        id: "first_account",
        speaker: "目擊者乙",
        content: "我先看見紅色雨傘靠在門邊。",
      },
      {
        ...state.inventory.statements[0]!,
        id: "second_account",
        speaker: "目擊者乙",
        content: "後來雨傘已經移到櫃檯旁。",
      },
    ];

    render(CaseFilePanel, {
      state,
      section: "statements",
      reexamineEnabled: false,
      onReexamineEvidence: () => {},
      onReexamineStatement: () => {},
    });

    expect(
      screen.getByRole("button", {
        name: "目擊者乙 我先看見紅色雨傘靠在門邊。",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "目擊者乙 後來雨傘已經移到櫃檯旁。",
      }),
    ).toBeVisible();
  });

  it("traverses every populated acceptance section without exposing locked catalog IDs", async () => {
    const user = userEvent.setup();
    const { container } = render(CaseFilePanel, {
      state: acceptanceState(),
      reexamineEnabled: false,
      onReexamineEvidence: () => {},
      onReexamineStatement: () => {},
    });

    const objectiveDetail = within(
      screen.getByRole("tabpanel", { name: /目前目標/ }),
    );
    expect(objectiveDetail.getByText("確認合成檔案")).toBeInTheDocument();
    expect(objectiveDetail.getByText("核對來源")).toBeInTheDocument();
    expect(objectiveDetail.getByText("核對時間")).toBeInTheDocument();
    expect(objectiveDetail.getByText("完成舊線索四")).toBeInTheDocument();
    expect(objectiveDetail.getByText("完成舊線索三")).toBeInTheDocument();
    expect(objectiveDetail.getByText("完成舊線索二")).toBeInTheDocument();
    expect(objectiveDetail.queryByText("完成舊線索一")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "顯示較早完成目標" }));
    expect(objectiveDetail.getByText("完成舊線索一")).toBeInTheDocument();
    expectLockedIdsAbsent(container);

    await user.click(screen.getByRole("tab", { name: "證物 4 項" }));
    expect(
      screen.getByRole("heading", { name: "證物：折角便箋" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "共用代號照片" }));
    expect(screen.getByText("來源：合成照片")).toBeInTheDocument();
    expect(
      screen.getByText("取得於：合成測試章・案件檔案測試室"),
    ).toBeInTheDocument();
    expectLockedIdsAbsent(container);

    await user.click(screen.getByRole("tab", { name: "證詞 1 項" }));
    expect(
      screen.getByRole("heading", { name: "證詞：目擊者乙" }),
    ).toBeInTheDocument();
    expect(screen.getByText("來源群組：合成來源組")).toBeInTheDocument();
    expect(screen.getByText("可證明：身分")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看後續紀錄" }));
    expect(
      screen.getByRole("heading", { name: "證物：簽署掃描" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "查看前一項紀錄" }));
    expect(
      screen.getByRole("heading", { name: "證詞：目擊者乙" }),
    ).toHaveFocus();
    expectLockedIdsAbsent(container);

    await user.click(screen.getByRole("tab", { name: "已確認事實 2 項" }));
    await user.click(screen.getByRole("button", { name: "路線已確認" }));
    expect(screen.getByText("合成測試章・案件檔案測試室")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "查看支持記錄：目擊者乙" }),
    );
    expect(
      screen.getByRole("heading", { name: "證詞：目擊者乙" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "返回上一項" }));
    await user.click(
      screen.getByRole("button", { name: "查看支持事實：時鐘已校準" }),
    );
    expect(
      screen.getByRole("heading", { name: "事實：時鐘已校準" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "返回上一項" }));
    expectLockedIdsAbsent(container);

    await user.click(screen.getByRole("tab", { name: "待解問題 2 項" }));
    expect(
      screen.getByRole("heading", { name: "問題：誰留下便箋？" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "目擊路線為何？" }));
    await user.click(
      screen.getByRole("button", { name: "查看解答事實：路線已確認" }),
    );
    expect(
      screen.getByRole("heading", { name: "事實：路線已確認" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "返回上一項" }));
    expectLockedIdsAbsent(container);

    await user.click(screen.getByRole("tab", { name: "授權 1 項" }));
    expect(
      screen.getByRole("heading", { name: "授權：調閱合成檔案" }),
    ).toBeInTheDocument();
    expect(screen.getByText("授權人：測試管理員")).toBeInTheDocument();
    expect(
      screen.getByText("許可範圍：可調閱本測試的合成來源。"),
    ).toBeInTheDocument();
    expect(screen.getByText("合成測試章・案件檔案測試室")).toBeInTheDocument();
    expectLockedIdsAbsent(container);
  });

  it("uses a manual-activation roving tab stop that follows external section binding", async () => {
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    const tabs = screen.getAllByRole("tab");
    expect(
      tabs.map((tab) => tab.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual([
      "目前目標 7 項",
      "證物 2 項",
      "證詞 0 項",
      "已確認事實 2 項",
      "待解問題 2 項",
      "授權 1 項",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[0]).toHaveAttribute("data-submenu-initial-focus");
    expect(screen.queryByText(/目錄|總計|catalog/i)).not.toBeInTheDocument();

    tabs[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
    await user.keyboard("{ArrowUp}");
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");

    await user.click(
      screen.getByRole("button", { name: "由父層切換待解問題" }),
    );
    expect(tabs[4]).toHaveAttribute("aria-selected", "true");
    expect(tabs[4]).toHaveAttribute("tabindex", "0");
    tabs[4].focus();
    await user.keyboard("{ArrowDown}");
    expect(tabs[5]).toHaveFocus();
    expect(tabs[5]).toHaveAttribute("tabindex", "0");
    expect(tabs[4]).toHaveAttribute("tabindex", "-1");
  });

  it("keeps item focus stable and restores a one-level relation target", async () => {
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    await user.click(screen.getByRole("tab", { name: /已確認事實 2 項/ }));
    const factRow = screen.getByRole("button", { name: "收據時間" });
    await user.click(factRow);
    expect(factRow).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "事實：收據時間" }),
    ).toBeInTheDocument();
    expect(screen.getByText("第一章・雨中現場")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "查看支持記錄：咖啡收據" }),
    );
    const recordHeading = screen.getByRole("heading", {
      name: "證物：咖啡收據",
    });
    expect(recordHeading).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "返回上一項" }));
    expect(
      screen.getByRole("heading", { name: "事實：收據時間" }),
    ).toHaveFocus();
  });

  it("steps back through a relation layer when Escape is routed via the coordinator", async () => {
    // GameShell's submenu Escape branch consults the escape-coordinator
    // before closing the submenu. Following a relation registers a claim, so
    // one Escape (routed as closeTopmostEscapeClaim) must return the player
    // to the source item rather than bouncing to the root menu — "close one
    // layer per Escape."
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    await user.click(screen.getByRole("tab", { name: /已確認事實 2 項/ }));
    await user.click(screen.getByRole("button", { name: "收據時間" }));
    await user.click(
      screen.getByRole("button", { name: "查看支持記錄：咖啡收據" }),
    );
    expect(
      screen.getByRole("heading", { name: "證物：咖啡收據" }),
    ).toHaveFocus();

    expect(escapeClaimed()).toBe(true);
    expect(closeTopmostEscapeClaim()).toBe(true);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "事實：收據時間" }),
      ).toHaveFocus();
    });
    // The relation layer cleared and released its claim — no lingering trap.
    await waitFor(() => {
      expect(escapeClaimed()).toBe(false);
    });
  });

  it("restores focus to the first surviving row when replacement removes the focused selection", async () => {
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    await user.click(screen.getByRole("tab", { name: /證物 2 項/ }));
    const removedRow = screen.getByRole("button", { name: "黑色雨傘" });
    await user.click(removedRow);
    expect(removedRow).toHaveFocus();

    screen
      .getByRole("button", { name: "移除選取證物" })
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "咖啡收據" })).toHaveFocus();
    });
  });

  it("forwards disabled to objective disclosure, fact support, and resolved-question controls", async () => {
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    const disclosure = screen.getByRole("button", {
      name: "顯示較早完成目標",
    });
    await user.click(screen.getByRole("button", { name: "停用案件檔案" }));
    expect(disclosure).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "啟用案件檔案" }));
    await user.click(screen.getByRole("tab", { name: /已確認事實 2 項/ }));
    await user.click(screen.getByRole("button", { name: "收據時間" }));
    await user.click(screen.getByRole("button", { name: "停用案件檔案" }));
    expect(
      screen.getByRole("button", { name: "查看支持記錄：咖啡收據" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "查看支持事實：時鐘確認" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "啟用案件檔案" }));
    await user.click(screen.getByRole("tab", { name: /待解問題 2 項/ }));
    await user.click(screen.getByRole("button", { name: "嫌疑人何時抵達？" }));
    await user.click(screen.getByRole("button", { name: "停用案件檔案" }));
    expect(
      screen.getByRole("button", { name: "查看解答事實：收據時間" }),
    ).toBeDisabled();
  });

  it("shows the localized fact category in the detail pane", async () => {
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    await user.click(screen.getByRole("tab", { name: /已確認事實 2 項/ }));
    await user.click(screen.getByRole("button", { name: "收據時間" }));

    expect(screen.getByText("類別：時間")).toBeInTheDocument();
  });

  it("renders only direct visible detail relations and safe fallback content", async () => {
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    const objectiveDetail = within(
      screen.getByRole("tabpanel", { name: /目前目標/ }),
    );
    expect(
      objectiveDetail.getByRole("heading", { name: "目前目標" }),
    ).toBeInTheDocument();
    expect(objectiveDetail.getByText("找到目擊者")).toBeInTheDocument();
    expect(objectiveDetail.getByText("確認不在場證明")).toBeInTheDocument();
    expect(objectiveDetail.getByText("追查雨傘來源")).toBeInTheDocument();
    expect(objectiveDetail.getByText("完成四")).toBeInTheDocument();
    expect(objectiveDetail.getByText("完成三")).toBeInTheDocument();
    expect(objectiveDetail.getByText("完成二")).toBeInTheDocument();
    expect(objectiveDetail.queryByText("完成一")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "顯示較早完成目標" }));
    expect(objectiveDetail.getByText("完成一")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /已確認事實 2 項/ }));
    await user.click(screen.getByRole("button", { name: "收據時間" }));
    expect(
      screen.getByRole("button", { name: "查看支持記錄：咖啡收據" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看支持事實：時鐘確認" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/hidden-record|hidden-fact/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("黑色雨傘")).not.toBeInTheDocument();

    const staleRelation = screen.getByRole("button", {
      name: "查看支持記錄：咖啡收據",
    });
    const invalidateTarget = screen.getByRole("button", {
      name: "使支持證物失效",
    });
    const invalidateDuringCapture = (event: Event) => {
      if (event.target === staleRelation) invalidateTarget.click();
    };
    document.addEventListener("click", invalidateDuringCapture, true);
    try {
      await user.click(staleRelation);
    } finally {
      document.removeEventListener("click", invalidateDuringCapture, true);
    }
    expect(
      screen.getByRole("heading", { name: "證物：黑色雨傘" }),
    ).toHaveFocus();
    expect(screen.queryByText("evidence:receipt")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /待解問題 2 項/ }));
    await user.click(screen.getByRole("button", { name: "嫌疑人何時抵達？" }));
    expect(
      screen.getByRole("button", { name: "查看解答事實：收據時間" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "嫌疑人的動機是什麼？" }),
    );
    expect(
      screen.queryByRole("button", { name: /查看解答事實/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /授權 1 項/ }));
    await user.click(screen.getByRole("button", { name: "調閱店內紀錄" }));
    expect(screen.getByText("授權人：搜查課長")).toBeInTheDocument();
    expect(
      screen.getByText("許可範圍：可調閱當日店內紀錄。"),
    ).toBeInTheDocument();
    expect(screen.getByText("已匯入的進度")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /證物 1 項/ }));
    await user.click(screen.getByRole("button", { name: "黑色雨傘" }));
    await user.click(screen.getByRole("button", { name: "移除選取證物" }));
    expect(screen.getByRole("heading", { name: "證物" })).toBeInTheDocument();
    expect(screen.queryByText("evidence:umbrella")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空案件檔案" }));
    await user.click(screen.getByRole("tab", { name: /證物 0 項/ }));
    expect(
      screen.getByText("目前尚無證物。", { selector: "p" }),
    ).toBeInTheDocument();
  });
});
