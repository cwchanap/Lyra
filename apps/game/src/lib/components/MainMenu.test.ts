import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { SaveBrowserOpenResultView } from "$lib/persistence/types";

import MainMenu from "./MainMenu.svelte";

const mocks = vi.hoisted(() => ({
  readSaveThumbnail: vi.fn(),
}));

vi.mock("$lib/persistence/commands", () => ({
  readSaveThumbnail: mocks.readSaveThumbnail,
}));

const recapSummary = {
  chapterId: "chapter_1",
  chapterTitle: "第一章　雨中的證言",
  chapterSummary: "相馬律接下雨夜中的第一宗委託。",
  sceneId: "scene_2",
  sceneTitle: "律師事務所",
  sceneSummary: "早坂帶來一份程序不明的調查摘要。",
  activePrimaryObjectiveId: "objective_1",
  activePrimaryObjectiveLabel: "詢問目擊者",
  activePrimaryObjectiveSummary: "釐清目擊者在雨夜看見的人影。",
};

function validStatus(summary = recapSummary) {
  return {
    type: "valid" as const,
    metadata: {
      saveId: "11111111-1111-4111-8111-111111111111",
      saveType: "manual" as const,
      schemaVersion: 2,
      contentRevision: `sha256:${"1".repeat(64)}`,
      savedAt: "2026-07-27T12:34:00Z",
      displayName: "雨夜的證言",
      thumbnail: { type: "available" as const, width: 480, height: 270 },
      summary,
    },
  };
}

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

// MainMenu installs its card keyboard navigation and the 1.5 s auto-focus
// timer only when its weather canvas provides a 2D context; jsdom returns
// null, so hand it a minimal fake (same pattern as InterrogationSubjectArt).
function stubWeatherCanvasContext(): MockInstance<
  typeof HTMLCanvasElement.prototype.getContext
> {
  const context = {
    createLinearGradient: () => ({ addColorStop: () => {} }),
    setTransform: () => {},
    scale: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  };
  return vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
}

describe("MainMenu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    mocks.readSaveThumbnail.mockReset();
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

  it("shows the exact valid Continue candidate as one expanded text-only recap", () => {
    const discovery = titleDiscovery();
    discovery.browser.slots[0] = {
      reference: { type: "auto", slot: 1 },
      modifiedAt: "2026-07-27T12:00:00Z",
      status: validStatus({
        ...recapSummary,
        chapterTitle: "不應顯示的較舊章節",
      }),
    };
    discovery.browser.slots[6] = {
      reference: { type: "manual", slot: 2 },
      modifiedAt: "2026-07-27T13:00:00Z",
      status: validStatus(),
    };
    discovery.continueCandidate = { type: "manual", slot: 2 };

    render(MainMenu, {
      onNewGame: vi.fn(),
      onContinue: vi.fn(),
      discovery,
    });

    const recap = screen.getByRole("region", { name: "繼續遊戲摘要" });
    expect(
      screen.getAllByRole("region", { name: "繼續遊戲摘要" }),
    ).toHaveLength(1);
    expect(recap).toHaveTextContent(/第一章.*雨中的證言/);
    expect(recap).toHaveTextContent("相馬律接下雨夜中的第一宗委託。");
    expect(recap).toHaveTextContent("律師事務所");
    expect(recap).toHaveTextContent("早坂帶來一份程序不明的調查摘要。");
    expect(recap).toHaveTextContent("詢問目擊者");
    expect(recap).toHaveTextContent("釐清目擊者在雨夜看見的人影。");
    expect(recap).not.toHaveTextContent("不應顯示的較舊章節");
    expect(screen.getByTestId("save-recap-details")).toHaveClass("expanded");
    expect(mocks.readSaveThumbnail).not.toHaveBeenCalled();
  });

  it("retains readable invalid recap copy while Continue follows its diagnostic path", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const discovery = titleDiscovery("invalid");
    discovery.browser.slots[0] = {
      reference: { type: "auto", slot: 1 },
      modifiedAt: "2026-07-27T13:00:00Z",
      status: {
        type: "invalid",
        metadata: {
          saveId: "22222222-2222-4222-8222-222222222222",
          savedAt: "2026-07-27T12:35:00Z",
          displayName: "舊版存檔",
          thumbnail: { type: "unavailable", reason: "corrupt" },
          summary: recapSummary,
        },
        diagnostic: {
          code: "contentRevisionMismatch",
          message: "存檔內容版本不相容",
        },
      },
    };

    render(MainMenu, {
      onNewGame: vi.fn(),
      onContinue,
      discovery,
    });

    const recap = screen.getByRole("region", { name: "繼續遊戲摘要" });
    expect(recap).toHaveTextContent("相馬律接下雨夜中的第一宗委託。");
    expect(recap).toHaveTextContent("早坂帶來一份程序不明的調查摘要。");
    expect(recap).toHaveTextContent("釐清目擊者在雨夜看見的人影。");
    await user.click(screen.getByRole("button", { name: "繼續遊戲" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(mocks.readSaveThumbnail).not.toHaveBeenCalled();
  });

  it("does not invent a recap for unreadable invalid candidate metadata", () => {
    render(MainMenu, {
      onNewGame: vi.fn(),
      onContinue: vi.fn(),
      discovery: titleDiscovery("invalid"),
    });

    expect(
      screen.queryByRole("region", { name: "繼續遊戲摘要" }),
    ).not.toBeInTheDocument();
    expect(mocks.readSaveThumbnail).not.toHaveBeenCalled();
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

  // HPA-830: when the save archive overlay is open, +page passes inert so
  // the covered menu cannot be reached by Tab/Enter; the attribute must sit
  // on the existing root node (no extra wrapper).
  it("marks its root node inert only while the archive overlay owns the screen", async () => {
    const props = { onNewGame: vi.fn() };
    const { rerender } = render(MainMenu, props);
    expect(document.querySelector<HTMLElement>(".lyra-menu")?.inert).toBe(
      false,
    );

    await rerender({ ...props, inert: true });

    // jsdom does not reflect the inert property to the attribute, so assert
    // the IDL property (same convention as GameShell.test.ts).
    expect(document.querySelector<HTMLElement>(".lyra-menu")?.inert).toBe(true);
  });

  // HPA-830: window keydown listeners do not become idle when the DOM turns
  // inert, so the component itself must early-return on its own inert prop.
  // Dispatching on window (not a menu element) is the point: the guard must
  // be MainMenu's own state, never a closest('[inert]') lookup, which is
  // null because the archive overlay is MainMenu's sibling.
  it("ignores ArrowUp/ArrowDown while inert instead of hijacking overlay keys", () => {
    stubWeatherCanvasContext();
    render(MainMenu, { onNewGame: vi.fn(), onExit: vi.fn(), inert: true });

    const down = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
    });
    window.dispatchEvent(down);
    const up = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      cancelable: true,
    });
    window.dispatchEvent(up);

    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  // HPA-830: the deferred auto-focus timer must route through the guarded
  // focusCard so it cannot grab focus from an open archive overlay.
  it("skips the delayed first-card auto-focus while inert", () => {
    vi.useFakeTimers();
    stubWeatherCanvasContext();
    render(MainMenu, { onNewGame: vi.fn(), inert: true });

    vi.advanceTimersByTime(1500);

    expect(document.activeElement).toBe(document.body);
  });

  // Companion guard: the inert early-return must not disable the keyboard
  // navigation for the normal (uncovered) menu.
  it("still drives card navigation with ArrowDown when the menu is not inert", () => {
    stubWeatherCanvasContext();
    render(MainMenu, { onNewGame: vi.fn(), onExit: vi.fn() });

    const down = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      cancelable: true,
    });
    window.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /結束偵查/ }),
    );
  });

  // Companion guard: focusCard(0) keeps the original timer behavior when
  // the menu is not inert.
  it("still auto-focuses the first card after the 1.5s timer when not inert", () => {
    vi.useFakeTimers();
    stubWeatherCanvasContext();
    render(MainMenu, { onNewGame: vi.fn(), onExit: vi.fn() });

    vi.advanceTimersByTime(1500);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "開始新遊戲" }),
    );
  });

  it("steps ArrowDown/ArrowUp from the currently focused card instead of a stale index", () => {
    stubWeatherCanvasContext();
    render(MainMenu, {
      onNewGame: vi.fn(),
      onContinue: vi.fn(),
      onLoad: vi.fn(),
      onExit: vi.fn(),
      discovery: titleDiscovery("invalid"),
    });

    const loadButton = screen.getByRole("button", { name: "載入遊戲" });
    const newGameButton = screen.getByRole("button", { name: "開始新遊戲" });
    const continueButton = screen.getByRole("button", { name: "繼續遊戲" });
    loadButton.focus();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }),
    );
    expect(document.activeElement).toBe(newGameButton);

    loadButton.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true }),
    );
    expect(document.activeElement).toBe(continueButton);
  });

  it("cancels the 1.5s auto-focus timer when the menu becomes inert and returns within 1.5s", async () => {
    vi.useFakeTimers();
    stubWeatherCanvasContext();
    const props = {
      onNewGame: vi.fn(),
      onContinue: vi.fn(),
      onLoad: vi.fn(),
      onExit: vi.fn(),
      discovery: titleDiscovery("invalid"),
      inert: false,
    };
    const { rerender } = render(MainMenu, props);

    vi.advanceTimersByTime(200);
    await rerender({ ...props, inert: true });
    vi.advanceTimersByTime(400);
    await rerender({ ...props, inert: false });

    const loadButton = screen.getByRole("button", { name: "載入遊戲" });
    loadButton.focus();
    vi.advanceTimersByTime(1000);

    expect(document.activeElement).toBe(loadButton);
  });
});
