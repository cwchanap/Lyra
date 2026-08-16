import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
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

    const button = screen.getByRole("button", { name: /選取：\s*卡片 A/ });
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

  it("does not pick up a mouse drag at four pixels or less", async () => {
    const onDragStart = vi.fn();
    render(AnalysisCard, {
      card: card(),
      dragEnabled: true,
      onDragStart,
      onSelect: vi.fn(),
    });
    const button = screen.getByRole("button");

    await fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(button, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 14,
      clientY: 14,
    });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it.each(["mouse", "pen"] as const)(
    "starts a %s drag once movement exceeds four pixels",
    async (pointerType) => {
      const onDragStart = vi.fn();
      render(AnalysisCard, {
        card: card(),
        dragEnabled: true,
        onDragStart,
        onSelect: vi.fn(),
      });
      const button = screen.getByRole("button");

      await fireEvent.pointerDown(button, {
        pointerId: 2,
        pointerType,
        button: 0,
        clientX: 10,
        clientY: 10,
      });
      await fireEvent.pointerMove(button, {
        pointerId: 2,
        pointerType,
        clientX: 15,
        clientY: 10,
      });
      await fireEvent.pointerMove(button, {
        pointerId: 2,
        pointerType,
        clientX: 20,
        clientY: 10,
      });

      expect(onDragStart).toHaveBeenCalledOnce();
    },
  );

  it("does not start custom drag for touch input", async () => {
    const onDragStart = vi.fn();
    const onDrop = vi.fn();
    render(AnalysisCard, {
      card: card(),
      dragEnabled: true,
      onDragStart,
      onDrop,
      onSelect: vi.fn(),
    });
    const button = screen.getByRole("button");

    await fireEvent.pointerDown(button, {
      pointerId: 3,
      pointerType: "touch",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(button, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 30,
      clientY: 30,
    });
    await fireEvent.pointerUp(button, {
      pointerId: 3,
      pointerType: "touch",
      button: 0,
      clientX: 30,
      clientY: 30,
    });

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it.each(["", "unknown", "mouse-like"])(
    "does not start custom drag for a non-mouse/pen pointer type: %s",
    async (pointerType) => {
      const onDragStart = vi.fn();
      const onDrop = vi.fn();
      render(AnalysisCard, {
        card: card(),
        dragEnabled: true,
        onDragStart,
        onDrop,
        onSelect: vi.fn(),
      });
      const button = screen.getByRole("button");

      await fireEvent.pointerDown(button, {
        pointerId: 8,
        pointerType,
        button: 0,
        clientX: 10,
        clientY: 10,
      });
      await fireEvent.pointerMove(button, {
        pointerId: 8,
        pointerType,
        clientX: 30,
        clientY: 30,
      });
      await fireEvent.pointerUp(button, {
        pointerId: 8,
        pointerType,
        button: 0,
        clientX: 30,
        clientY: 30,
      });

      expect(onDragStart).not.toHaveBeenCalled();
      expect(onDrop).not.toHaveBeenCalled();
    },
  );

  it("emits opaque resolver target IDs as the pointer crosses targets", async () => {
    const onDragStart = vi.fn();
    const onDragTargetChange = vi.fn();
    const resolveDropTarget = vi.fn((x: number) =>
      x < 30 ? "classify:group:first" : "classify:group:second",
    );
    render(AnalysisCard, {
      card: card(),
      dragEnabled: true,
      resolveDropTarget,
      onDragStart,
      onDragTargetChange,
      onSelect: vi.fn(),
    });
    const button = screen.getByRole("button");

    await fireEvent.pointerDown(button, {
      pointerId: 4,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(button, {
      pointerId: 4,
      pointerType: "mouse",
      clientX: 15,
      clientY: 10,
    });
    await fireEvent.pointerMove(button, {
      pointerId: 4,
      pointerType: "mouse",
      clientX: 35,
      clientY: 10,
    });
    await fireEvent.pointerMove(button, {
      pointerId: 4,
      pointerType: "mouse",
      clientX: 40,
      clientY: 10,
    });

    expect(onDragStart).toHaveBeenCalledOnce();
    expect(resolveDropTarget).toHaveBeenCalledWith(15, 10);
    expect(resolveDropTarget).toHaveBeenCalledWith(35, 10);
    expect(onDragTargetChange.mock.calls).toEqual([
      ["classify:group:first"],
      ["classify:group:second"],
    ]);
  });

  it("emits one drop on pointer up with the current target", async () => {
    const onDrop = vi.fn();
    const resolveDropTarget = vi.fn(() => "order:end");
    render(AnalysisCard, {
      card: card(),
      dragEnabled: true,
      resolveDropTarget,
      onDrop,
      onSelect: vi.fn(),
    });
    const button = screen.getByRole("button");

    await fireEvent.pointerDown(button, {
      pointerId: 5,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(button, {
      pointerId: 5,
      pointerType: "mouse",
      clientX: 15,
      clientY: 10,
    });
    await fireEvent.pointerUp(button, {
      pointerId: 5,
      pointerType: "mouse",
      button: 0,
      clientX: 15,
      clientY: 10,
    });
    await fireEvent.pointerUp(button, {
      pointerId: 5,
      pointerType: "mouse",
      button: 0,
      clientX: 15,
      clientY: 10,
    });

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith("order:end");
  });

  it("cancels a custom drag without emitting a drop", async () => {
    const onDragCancel = vi.fn();
    const onDrop = vi.fn();
    render(AnalysisCard, {
      card: card(),
      dragEnabled: true,
      resolveDropTarget: vi.fn(() => "classify:group:first"),
      onDragCancel,
      onDrop,
      onSelect: vi.fn(),
    });
    const button = screen.getByRole("button");

    await fireEvent.pointerDown(button, {
      pointerId: 6,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(button, {
      pointerId: 6,
      pointerType: "mouse",
      clientX: 15,
      clientY: 10,
    });
    await fireEvent.pointerCancel(button, {
      pointerId: 6,
      pointerType: "mouse",
      clientX: 15,
      clientY: 10,
    });

    expect(onDragCancel).toHaveBeenCalledOnce();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("suppresses the physical click that follows a completed drag", async () => {
    const onSelect = vi.fn();
    const onDrop = vi.fn();
    render(AnalysisCard, {
      card: card(),
      dragEnabled: true,
      resolveDropTarget: vi.fn(() => "classify:group:first"),
      onSelect,
      onDrop,
    });
    const button = screen.getByRole("button");

    await fireEvent.pointerDown(button, {
      pointerId: 7,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(button, {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 15,
      clientY: 10,
    });
    await fireEvent.pointerUp(button, {
      pointerId: 7,
      pointerType: "mouse",
      button: 0,
      clientX: 15,
      clientY: 10,
    });
    await fireEvent.click(button, { detail: 1 });

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith("classify:group:first");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps semantic click selection working when no drag starts", async () => {
    const onSelect = vi.fn();
    render(AnalysisCard, {
      card: card(),
      dragEnabled: true,
      onSelect,
    });

    await userEvent.click(screen.getByRole("button"));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("keeps the non-button branch as an article without a button role", () => {
    render(AnalysisCard, { card: card() });

    const article = screen.getByText("卡片 A").closest("article");
    expect(article).toBeInTheDocument();
    expect(article).not.toHaveAttribute("role", "button");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("exposes the requested card focus hook", () => {
    render(AnalysisCard, { card: card() });

    expect(screen.getByText("卡片 A").closest("article")).toHaveAttribute(
      "data-analysis-focus-key",
      "card:card_a",
    );
  });
});
