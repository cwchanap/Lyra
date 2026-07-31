import { render, screen, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import CaseFilePanelHarness from "$lib/test-harnesses/CaseFilePanelHarness.svelte";

describe("CaseFilePanel", () => {
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

  it("renders only direct visible detail relations and safe fallback content", async () => {
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    const objectiveDetail = within(
      screen.getByRole("region", { name: "目前目標" }),
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
