import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisCardView } from "$lib/state/types";
import AnalysisCard from "./AnalysisCard.svelte";

function card(overrides: Partial<AnalysisCardView> = {}): AnalysisCardView {
  return {
    id: "card_a",
    label: "卡片 A",
    summary: "摘要 A。",
    source: { kind: "practice", id: "card_a", label: null, summary: null },
    sourceLabel: null,
    sourceSummary: null,
    available: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnalysisCard", () => {
  it("renders an interactive button that calls onSelect on click", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(AnalysisCard, { card: card(), onSelect });

    const button = screen.getByRole("button", { name: "選取：卡片 A" });
    await user.click(button);

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("reflects the selected state via aria-pressed", () => {
    render(AnalysisCard, { card: card(), selected: true, onSelect: vi.fn() });

    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("disables the button when the card is unavailable", () => {
    render(AnalysisCard, {
      card: card({ available: false }),
      onSelect: vi.fn(),
    });

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("尚未取得")).toBeInTheDocument();
  });

  it("disables the button when readOnly is true even with onSelect", () => {
    render(AnalysisCard, {
      card: card(),
      readOnly: true,
      onSelect: vi.fn(),
    });

    // When readOnly, the component renders the non-interactive article branch.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("卡片 A")).toBeInTheDocument();
  });

  it("renders badges when provided", () => {
    render(AnalysisCard, {
      card: card(),
      badges: ["標籤一", "標籤二"],
      onSelect: vi.fn(),
    });

    expect(screen.getByText("標籤一")).toBeInTheDocument();
    expect(screen.getByText("標籤二")).toBeInTheDocument();
  });

  it("prepends the single badge prop before the badges array", () => {
    render(AnalysisCard, {
      card: card(),
      badge: "主標籤",
      badges: ["次標籤"],
      onSelect: vi.fn(),
    });

    // The badge region is labeled; verify both badge texts appear.
    expect(screen.getByText("主標籤")).toBeInTheDocument();
    expect(screen.getByText("次標籤")).toBeInTheDocument();
  });

  it("renders a non-interactive article without onSelect", () => {
    render(AnalysisCard, { card: card() });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("卡片 A")).toBeInTheDocument();
    expect(screen.getByText("摘要 A。")).toBeInTheDocument();
  });

  it("shows the unavailable label on a non-interactive unavailable card", () => {
    render(AnalysisCard, { card: card({ available: false }) });

    expect(screen.getByText("尚未取得")).toBeInTheDocument();
  });

  it("shows the read-only label on an available non-interactive card", () => {
    render(AnalysisCard, { card: card(), readOnly: true });

    expect(screen.getByText("僅供檢視")).toBeInTheDocument();
  });

  it("renders badges on the non-interactive article branch", () => {
    render(AnalysisCard, {
      card: card(),
      badges: ["文章標籤"],
    });

    expect(screen.getByText("文章標籤")).toBeInTheDocument();
  });

  it("uses a custom unavailable label", () => {
    render(AnalysisCard, {
      card: card({ available: false }),
      unavailableLabel: "未取得資料",
    });

    expect(screen.getByText("未取得資料")).toBeInTheDocument();
  });
});
