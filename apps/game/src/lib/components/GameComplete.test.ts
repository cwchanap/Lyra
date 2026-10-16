import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import GameComplete from "./GameComplete.svelte";

describe("GameComplete", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the case-closed end card when the story is cleared", () => {
    render(GameComplete, { storyCleared: true, onReset: vi.fn() });

    expect(screen.getByText("案件結案")).toBeInTheDocument();
    expect(screen.queryByText("未完待續")).not.toBeInTheDocument();
  });

  it("renders a to-be-continued end card at an in-progress chapter boundary", () => {
    render(GameComplete, { storyCleared: false, onReset: vi.fn() });

    expect(screen.getByText("未完待續")).toBeInTheDocument();
    expect(screen.getByText(/本章後續內容製作中。/)).toBeInTheDocument();
    expect(screen.queryByText("案件結案")).not.toBeInTheDocument();
  });

  it("keeps the restart action on the to-be-continued card", async () => {
    const onReset = vi.fn();
    render(GameComplete, { storyCleared: false, onReset });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /重新開啟/ }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
