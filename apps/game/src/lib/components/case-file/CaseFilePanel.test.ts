import { render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import CaseFilePanelHarness from "$lib/test-harnesses/CaseFilePanelHarness.svelte";

describe("CaseFilePanel", () => {
  it("keeps the visible six-section case file navigable without leaking hidden or stale records", async () => {
    const user = userEvent.setup();
    render(CaseFilePanelHarness);

    const tabs = screen.getAllByRole("tab");
    expect(
      tabs.map((tab) => tab.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual([
      "目前目標 1 項",
      "證物 2 項",
      "證詞 0 項",
      "已確認事實 1 項",
      "待解問題 1 項",
      "授權 1 項",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("data-submenu-initial-focus");
    expect(screen.queryByText(/目錄|總計|catalog/i)).not.toBeInTheDocument();

    tabs[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(tabs[1]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /已確認事實 1 項/ }));
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

    await user.click(screen.getByRole("tab", { name: /授權 1 項/ }));
    expect(screen.getByText("已匯入的進度")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /證物 2 項/ }));
    await user.click(screen.getByRole("button", { name: "黑色雨傘" }));
    await user.click(screen.getByRole("button", { name: "移除選取證物" }));
    expect(
      screen.getByRole("heading", { name: "證物：咖啡收據" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("evidence:umbrella")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空案件檔案" }));
    await user.click(screen.getByRole("tab", { name: /證物 0 項/ }));
    expect(
      screen.getByText("目前尚無證物。", { selector: "p" }),
    ).toBeInTheDocument();
  });
});
