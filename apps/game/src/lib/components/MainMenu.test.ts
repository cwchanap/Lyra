import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveBrowserOpenResultView } from "$lib/persistence/types";

import MainMenu from "./MainMenu.svelte";

function titleDiscovery(
  slotStatus: "empty" | "invalid" = "empty",
): SaveBrowserOpenResultView {
  return {
    browser: {
      discovery: { type: "available" },
      slots: Array.from({ length: 8 }, (_, index) => ({
        reference:
          index < 5
            ? ({ type: "auto", slot: index + 1 } as const)
            : ({ type: "manual", slot: index - 4 } as const),
        modifiedAt: slotStatus === "empty" ? null : "2026-07-27T12:00:00Z",
        status:
          slotStatus === "empty"
            ? ({ type: "empty" } as const)
            : ({
                type: "invalid",
                metadata: null,
                diagnostic: {
                  code: "saveCorrupt",
                  message: "存檔損毀",
                },
              } as const),
      })),
    },
    continueCandidate:
      slotStatus === "empty" ? null : { type: "auto", slot: 1 },
    preflight: { type: "ready" },
  };
}

describe("MainMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render sound volume controls on the start screen", () => {
    render(MainMenu, { onNewGame: vi.fn(), onExit: vi.fn() });

    expect(
      screen.queryByRole("region", { name: "音訊設定" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("BGM")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("BGS")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SFX")).not.toBeInTheDocument();
  });

  it("starts with visible save discovery loading and canonical ordered actions", () => {
    render(MainMenu, {
      onNewGame: vi.fn(),
      discovery: null,
    });

    expect(screen.getByRole("status")).toHaveTextContent("讀取存檔中…");
    const actions = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter(Boolean);
    expect(actions.slice(0, 3)).toEqual(["繼續遊戲", "載入遊戲", "開始新遊戲"]);
  });

  it("disables Continue and Load for eight empty slots but keeps New Game ready", () => {
    render(MainMenu, {
      onNewGame: vi.fn(),
      onContinue: vi.fn(),
      onLoad: vi.fn(),
      discovery: titleDiscovery(),
    });

    expect(screen.getByRole("button", { name: "繼續遊戲" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "載入遊戲" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "開始新遊戲" })).toBeEnabled();
  });

  it("enables Continue and Load for any nonempty file, including an invalid newest save", () => {
    render(MainMenu, {
      onNewGame: vi.fn(),
      onContinue: vi.fn(),
      onLoad: vi.fn(),
      discovery: titleDiscovery("invalid"),
    });

    expect(screen.getByRole("button", { name: "繼續遊戲" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "載入遊戲" })).toBeEnabled();
  });

  it("disables disk actions and exposes Retry when discovery is unavailable", async () => {
    const user = userEvent.setup();
    const onRetryDiscovery = vi.fn();
    const unavailable: SaveBrowserOpenResultView = {
      browser: {
        discovery: {
          type: "unavailable",
          diagnostic: {
            code: "saveDiscoveryUnavailable",
            message: "無法讀取存檔",
          },
        },
        slots: [],
      },
      continueCandidate: null,
      preflight: { type: "ready" },
    };
    render(MainMenu, {
      onNewGame: vi.fn(),
      onContinue: vi.fn(),
      onLoad: vi.fn(),
      onRetryDiscovery,
      discovery: unavailable,
    });

    expect(screen.getByRole("button", { name: "繼續遊戲" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "載入遊戲" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("無法讀取存檔");
    await user.click(screen.getByRole("button", { name: "重試" }));
    expect(onRetryDiscovery).toHaveBeenCalledOnce();
  });
});
