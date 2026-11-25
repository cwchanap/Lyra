import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import GameComplete from "./GameComplete.svelte";

describe("GameComplete", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    {
      storyCleared: true,
      stamp: "案件結案",
      englishStamp: "CASE CLOSED",
      line: /調查結束。/,
      englishLine: "The dossier closes — but the rain keeps falling.",
      otherStamp: "未完待續",
    },
    {
      storyCleared: false,
      stamp: "未完待續",
      englishStamp: "TO BE CONTINUED",
      line: /本章後續內容製作中。/,
      englishLine: "The dossier stays open — for now.",
      otherStamp: "案件結案",
    },
  ])(
    "renders the $stamp card and returns to title on its CTA",
    async ({
      storyCleared,
      stamp,
      englishStamp,
      line,
      englishLine,
      otherStamp,
    }) => {
      const onReturnToTitle = vi.fn();
      render(GameComplete, { storyCleared, onReturnToTitle });

      expect(screen.getByText(stamp)).toBeInTheDocument();
      expect(screen.getByText(englishStamp)).toBeInTheDocument();
      expect(screen.getByText(line)).toBeInTheDocument();
      expect(screen.getByText(englishLine)).toBeInTheDocument();
      expect(screen.queryByText(otherStamp)).not.toBeInTheDocument();
      expect(screen.getByText("RETURN TO TITLE")).toBeInTheDocument();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: /返回標題畫面/ }));

      expect(onReturnToTitle).toHaveBeenCalledOnce();
    },
  );

  it("does not return to title while disabled", async () => {
    const onReturnToTitle = vi.fn();
    render(GameComplete, {
      storyCleared: false,
      onReturnToTitle,
      disabled: true,
    });

    const button = screen.getByRole("button", { name: /返回標題畫面/ });
    expect(button).toBeDisabled();
    await userEvent.setup().click(button);
    expect(onReturnToTitle).not.toHaveBeenCalled();
  });
});
