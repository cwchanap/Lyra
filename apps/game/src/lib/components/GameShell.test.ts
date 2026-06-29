import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameStateView } from "$lib/state/types";
import { reportAsyncTestFailure } from "$lib/test-utils";
import {
  claimEscape,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";

const mocks = vi.hoisted(() => ({
  audioPreferences: {
    muted: false,
    bgmVolume: 0.5,
    bgsVolume: 0.5,
    sfxVolume: 0.5,
  },
  updateAudioPreferences: vi.fn(),
  currentWindow: {
    isFullscreen: vi.fn(),
    setFullscreen: vi.fn(),
  },
}));

vi.mock("$lib/audio/gameplay-audio-runtime.svelte", () => ({
  audioPreferences: mocks.audioPreferences,
  updateAudioPreferences: mocks.updateAudioPreferences,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mocks.currentWindow,
}));

import GameShellHarness from "./GameShellHarness.svelte";

function state(
  mode: GameStateView["mode"] = {
    type: "dialogue",
    current: { kind: "action", text: "幕開" },
    queueRemaining: 0,
    sceneTag: null,
    queueToken: { sceneId: "scene_1", queueGen: 1, cursor: 0 },
    backgroundAssetId: null,
    bgm: null,
    bgs: null,
  },
): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 3,
    },
    scene: { kind: "linear", id: "scene_1", title: "", index: 0, total: 1 },
    mode,
    inventory: { evidence: [], statements: [] },
  };
}

function escapeKeydown(): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
}

describe("GameShell", () => {
  afterEach(() => {
    cleanup();
    mocks.updateAudioPreferences.mockClear();
    mocks.currentWindow.isFullscreen.mockReset();
    mocks.currentWindow.setFullscreen.mockReset();
    resetEscapeCoordinator();
  });

  // Default the fullscreen probe to "not fullscreen" so the fire-and-forget
  // reassert in `reassertFullscreenIfActive` no-ops silently for tests that
  // don't care about fullscreen. Tests that DO (the success/rejection pins)
  // override this with their own `mockResolvedValue(true)`.
  beforeEach(() => {
    mocks.currentWindow.isFullscreen.mockResolvedValue(false);
  });

  it("renders the chapter header and scoped children", () => {
    render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

    expect(screen.getByText("雨夜的第一份證詞")).toBeInTheDocument();
    expect(screen.getByText("案件摘要")).toBeInTheDocument();
    expect(screen.getByText("FILE", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("scoped child")).toBeInTheDocument();
  });

  it("keeps duplicated utility controls out of the chapter HUD", () => {
    render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

    expect(screen.getByText("雨夜的第一份證詞")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "音訊設定" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /結束/ }),
    ).not.toBeInTheDocument();
  });

  it("hides chapter chrome during investigation exploration", () => {
    render(GameShellHarness, {
      gameState: state({
        type: "explore",
        sublocationId: "main",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      }),
      onReset: vi.fn(),
    });

    expect(screen.queryByText("雨夜的第一份證詞")).not.toBeInTheDocument();
    expect(screen.queryByText("案件摘要")).not.toBeInTheDocument();
    expect(
      screen.queryByText("FILE", { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "音訊設定" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("scoped child")).toBeInTheDocument();
  });

  it("opens evidence and sound as separate submenu screens", async () => {
    const testName = "opens evidence and sound as separate submenu screens";

    try {
      const user = userEvent.setup();
      const onReset = vi.fn();
      render(GameShellHarness, {
        gameState: state(),
        onReset,
        menuContent: "menu inventory slot",
      });

      await user.keyboard("{Escape}");
      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });

      expect(
        within(dialog).getByRole("button", { name: /物證檔案/ }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: /音訊設定/ }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "音訊設定" })).toBeNull();
      expect(screen.queryByText("menu inventory slot")).toBeNull();

      await user.click(
        within(dialog).getByRole("button", { name: /物證檔案/ }),
      );
      expect(
        within(dialog).getByText("menu inventory slot"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: /返回選單/ }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: /繼續調查/ }),
      ).toBeNull();
      expect(
        within(dialog).queryByRole("button", { name: /音訊設定/ }),
      ).toBeNull();
      expect(screen.queryByRole("region", { name: "音訊設定" })).toBeNull();

      await user.click(
        within(dialog).getByRole("button", { name: /返回選單/ }),
      );
      expect(
        within(dialog).getByRole("button", { name: /繼續調查/ }),
      ).toBeInTheDocument();

      await user.click(
        within(dialog).getByRole("button", { name: /音訊設定/ }),
      );
      expect(
        within(dialog).getByRole("region", { name: "音訊設定" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: /返回選單/ }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: /物證檔案/ }),
      ).toBeNull();
      expect(screen.queryByText("menu inventory slot")).toBeNull();

      await user.click(
        within(dialog).getByRole("button", { name: /返回選單/ }),
      );
      await user.click(
        within(dialog).getByRole("button", { name: /結束案件/ }),
      );

      expect(onReset).toHaveBeenCalledTimes(1);
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("renders scene select only when scene menu content is provided", async () => {
    const testName =
      "renders scene select only when scene menu content is provided";

    try {
      const user = userEvent.setup();
      const { rerender } = render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
      });

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("button", { name: /場景跳轉/ })).toBeNull();

      await user.keyboard("{Escape}");
      await rerender({
        gameState: state(),
        onReset: vi.fn(),
        sceneMenuEnabled: true,
        sceneMenuContent: "scene selector slot",
      });
      await user.keyboard("{Escape}");
      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      await user.click(
        within(dialog).getByRole("button", { name: /場景跳轉/ }),
      );

      expect(
        within(dialog).getByText("scene selector slot"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: /返回選單/ }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: /繼續調查/ }),
      ).toBeNull();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("returns from a submenu to the main game menu on Escape", async () => {
    const testName = "returns from a submenu to the main game menu on Escape";

    try {
      const user = userEvent.setup();
      render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        menuContent: "menu inventory slot",
      });

      await user.keyboard("{Escape}");
      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      await user.click(
        within(dialog).getByRole("button", { name: /物證檔案/ }),
      );

      expect(
        await screen.findByRole("dialog", { name: "物證檔案" }),
      ).toBeInTheDocument();

      await user.keyboard("{Escape}");

      expect(
        await screen.findByRole("dialog", { name: "遊戲選單" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("menu inventory slot")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /繼續調查/ })).toBeVisible();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("opens the game menu and consumes Escape during investigation exploration", async () => {
    const testName =
      "opens the game menu and consumes Escape during investigation exploration";

    try {
      const onReset = vi.fn();
      render(GameShellHarness, {
        gameState: state({
          type: "explore",
          sublocationId: "main",
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        }),
        onReset,
      });

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });

      const propagated = window.dispatchEvent(escape);

      expect(propagated).toBe(false);
      expect(escape.defaultPrevented).toBe(true);
      expect(
        await screen.findByRole("dialog", { name: "遊戲選單" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /繼續調查/ })).toBeVisible();
      expect(onReset).not.toHaveBeenCalled();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("traps focus inside the game menu, including menu-slot focusables, and restores focus on close", async () => {
    const testName =
      "traps focus inside the game menu, including menu-slot focusables, and restores focus on close";

    try {
      document.body.tabIndex = -1;
      document.body.focus();

      render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        // Mirror production's <InventoryPanel>: a focusable control rendered
        // via the menu slot. The default harness slot is a non-focusable <p>,
        // so without this knob the trap never exercises a slot-provided
        // focusable and a regression that dropped it from the Tab cycle would
        // pass silently.
        menuExtraButtonLabel: "extra slot focusable",
        sceneMenuEnabled: true,
        sceneMenuContent: "scene slot focusable",
      });

      window.dispatchEvent(escapeKeydown());

      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      const resume = within(dialog).getByRole("button", {
        name: /繼續調查/,
      });
      expect(resume).toHaveFocus();

      const user = userEvent.setup();
      await user.click(
        within(dialog).getByRole("button", { name: /物證檔案/ }),
      );
      const backFromEvidence = within(dialog).getByRole("button", {
        name: /返回選單/,
      });
      expect(backFromEvidence).toHaveFocus();
      const extra = within(dialog).getByRole("button", {
        name: "extra slot focusable",
      });

      // The trap handler only intercepts Tab at the first/last boundary; for
      // middle focusables it relies on the browser's native Tab focus move.
      // userEvent.tab() performs that real traversal, so this exercises the
      // full integration: every focusable in the panel — including the
      // menu-slot control (production: <InventoryPanel>) — must be reachable
      // by Tab, and focus must never escape the dialog.
      let sawSlotFocusable = false;
      let wrappedToFirst = false;
      for (let i = 0; i < 12 && !wrappedToFirst; i++) {
        await user.tab();
        if (document.activeElement === extra) sawSlotFocusable = true;
        if (document.activeElement === backFromEvidence && i > 0) {
          wrappedToFirst = true;
        }
      }
      expect(sawSlotFocusable).toBe(true);
      expect(wrappedToFirst).toBe(true);

      // Reverse boundary: shift+Tab from the first focusable wraps to last.
      await fireEvent.click(backFromEvidence);
      await user.click(
        within(dialog).getByRole("button", { name: /音訊設定/ }),
      );
      const backFromSound = within(dialog).getByRole("button", {
        name: /返回選單/,
      });
      backFromSound.focus();
      const sfx = within(dialog).getByLabelText("SFX");
      await user.tab({ shift: true });
      expect(sfx).toHaveFocus();

      await fireEvent.click(backFromSound);
      const currentResume = within(dialog).getByRole("button", {
        name: /繼續調查/,
      });
      await fireEvent.click(currentResume);
      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });
      expect(document.body).toHaveFocus();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    } finally {
      document.body.removeAttribute("tabindex");
    }
  });

  it("skips focus restoration when the source element was removed while the menu was open", async () => {
    const testName =
      "skips focus restoration when the source element was removed while the menu was open";

    // Exercises the `isConnected` guard in closeGameMenu(): if the element that
    // was focused when the menu opened is detached before close, the guard must
    // skip calling focus() on a detached node rather than leaving focus in an
    // inconsistent state.
    let trigger: HTMLButtonElement | null = null;
    try {
      render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

      trigger = document.createElement("button");
      trigger.textContent = "outside trigger";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      // Spy on focus() so we can assert the guard does NOT invoke it once the
      // node is detached. (jsdom exposes `focus` as a getter-only property, so
      // direct assignment throws; vi.spyOn redefines it as configurable.)
      const focusSpy = vi.spyOn(trigger, "focus");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await screen.findByRole("dialog", { name: "遊戲選單" });

      // Detach the source element while the menu is open.
      document.body.removeChild(trigger);
      expect(trigger.isConnected).toBe(false);

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });

      // The guard skipped focus(); restoring it would call the spy and fail
      // this assertion.
      expect(focusSpy).not.toHaveBeenCalled();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    } finally {
      if (trigger?.isConnected) {
        document.body.removeChild(trigger);
      }
    }
  });

  it("renders menu slot content only inside the evidence submenu", async () => {
    const testName =
      "renders menu slot content only inside the evidence submenu";

    try {
      const user = userEvent.setup();
      render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        menuContent: "menu inventory slot",
      });

      expect(screen.queryByText("menu inventory slot")).not.toBeInTheDocument();

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      expect(screen.queryByText("menu inventory slot")).not.toBeInTheDocument();

      await user.click(
        within(dialog).getByRole("button", { name: /物證檔案/ }),
      );
      expect(
        within(dialog).getByText("menu inventory slot"),
      ).toBeInTheDocument();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("closes the menu when the bound open prop is driven false externally (dossier reexamine path)", async () => {
    const testName =
      "closes the menu when the bound open prop is driven false externally (dossier reexamine path)";

    // +page.svelte binds open to a local $state and sets it false after
    // dossier reexamine resolves, closing the menu so the installed dialogue
    // (z-index 30, in <main>) isn't hidden behind the scrim (z-index 40).
    // This test pins the parent→child half of that contract.
    try {
      const { rerender } = render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        open: true,
      });

      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      const main = screen.getByText("scoped child").closest("main")!;
      expect(main.inert).toBe(true);
      expect(dialog).toBeInTheDocument();

      // Simulate +page.svelte setting gameMenuOpen=false after reexamine
      // resolves. The `inert` attribute on <main> must revert and the
      // scrim must unmount — otherwise the reexamine dialogue is invisible.
      rerender({
        gameState: state(),
        onReset: vi.fn(),
        open: false,
      });

      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });
      expect(main.inert).toBe(false);
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("marks the chapter header and main content inert while the game menu is open", async () => {
    const testName =
      "marks the chapter header and main content inert while the game menu is open";

    // The focus-trap test exercises the JS Tab interceptor
    // (`handleGameMenuKeydown`), not the `inert` attribute. `inert` is what
    // actually blocks mouse clicks and non-Tab focus moves into background
    // content in real browsers, so a regression that dropped `inert` from
    // <header>/<main> would pass the trap test silently. Pin the state
    // directly: Svelte 5 sets the `inert` IDL property (which real browsers
    // reflect to the attribute and act on), so assert on the property —
    // jsdom does not reflect `inert` property→attribute, hence
    // `hasAttribute` would false-negative here.
    try {
      render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

      const header = screen.getByText("雨夜的第一份證詞").closest("header");
      const main = screen.getByText("scoped child").closest("main");
      if (!header || !main) {
        throw new Error("harness header/main not found");
      }

      expect(header.inert).toBe(false);
      expect(main.inert).toBe(false);

      window.dispatchEvent(escapeKeydown());
      await screen.findByRole("dialog", { name: "遊戲選單" });

      expect(header.inert).toBe(true);
      expect(main.inert).toBe(true);

      window.dispatchEvent(escapeKeydown());
      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });

      expect(header.inert).toBe(false);
      expect(main.inert).toBe(false);
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("reasserts Tauri fullscreen when Escape opens the game menu from fullscreen", async () => {
    const testName =
      "reasserts Tauri fullscreen when Escape opens the game menu from fullscreen";

    try {
      mocks.currentWindow.isFullscreen.mockResolvedValue(true);
      mocks.currentWindow.setFullscreen.mockResolvedValue(undefined);
      render(GameShellHarness, {
        gameState: state({
          type: "explore",
          sublocationId: "main",
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        }),
        onReset: vi.fn(),
      });

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(() => {
        expect(mocks.currentWindow.setFullscreen).toHaveBeenCalledWith(true);
      });
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("still opens the game menu and logs a diagnostic when Tauri fullscreen reassertion rejects", async () => {
    const testName =
      "still opens the game menu and logs a diagnostic when Tauri fullscreen reassertion rejects";

    // The reassert is fire-and-forget (`void reassertFullscreenIfActive()`
    // followed by `void openGameMenu()`), so a real IPC failure (permission
    // revoked, window race) must not block the menu from opening. This pins
    // both halves of the contract: the menu opens despite the rejection, and
    // the failure is surfaced via console.warn so the silent no-op is
    // visible in production Tauri. A refactor that awaited the reassert, or
    // swallowed the error without logging, would fail this test.
    let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      mocks.currentWindow.isFullscreen.mockResolvedValue(true);
      mocks.currentWindow.setFullscreen.mockRejectedValue(
        new Error("permission revoked"),
      );
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      render(GameShellHarness, {
        gameState: state({
          type: "explore",
          sublocationId: "main",
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        }),
        onReset: vi.fn(),
      });

      window.dispatchEvent(escapeKeydown());

      // The reassert was attempted and rejected...
      await vi.waitFor(() => {
        expect(mocks.currentWindow.setFullscreen).toHaveBeenCalledWith(true);
      });

      // ...yet the menu still opened.
      expect(
        await screen.findByRole("dialog", { name: "遊戲選單" }),
      ).toBeInTheDocument();

      // ...and the rejection was logged with the prefixed diagnostic.
      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          "[GameShell] fullscreen reassert failed:",
          expect.any(Error),
        );
      });
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    } finally {
      warnSpy?.mockRestore();
    }
  });

  it("recovers from a rapid Escape\u2192Escape during the open microtask", async () => {
    const testName =
      "recovers from a rapid Escape\u2192Escape during the open microtask";

    // The first Escape opens the menu (sets gameMenuOpen=true, then awaits
    // tick() before focusing the resume button). The second Escape is
    // dispatched synchronously before that tick() resolves, taking the close
    // path while the open is still pending. The menu must settle closed and
    // remain consistent \u2014 not half-open, and the open's deferred focus()
    // must not target a node that has just been unmounted.
    try {
      render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

      window.dispatchEvent(escapeKeydown());
      window.dispatchEvent(escapeKeydown());

      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });

      // State stays usable: a fresh Escape reopens the menu.
      window.dispatchEvent(escapeKeydown());
      await screen.findByRole("dialog", { name: "遊戲選單" });
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("opens the game menu with Escape during interrogation", async () => {
    const testName = "opens the game menu with Escape during interrogation";

    // The global Escape handler is mode-agnostic, but interrogation coexists
    // with its own keyboard surface (InterrogationView). This pins the
    // contract so a future mode-specific Escape branch can't silently drop
    // the menu from interrogation.
    try {
      const onReset = vi.fn();
      render(GameShellHarness, {
        gameState: state({
          type: "interrogation",
          phaseId: "cross_examination",
          backgroundAssetId: null,
          bgm: null,
          bgs: null,
        }),
        onReset,
      });

      const escape = escapeKeydown();
      const propagated = window.dispatchEvent(escape);

      expect(propagated).toBe(false);
      expect(escape.defaultPrevented).toBe(true);
      expect(
        await screen.findByRole("dialog", { name: "遊戲選單" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /繼續調查/ })).toBeVisible();
      expect(onReset).not.toHaveBeenCalled();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("dismisses on a scrim click but stays open when a click lands inside the panel", async () => {
    const testName =
      "dismisses on a scrim click but stays open when a click lands inside the panel";

    // Backdrop-dismiss is gated on event.target === event.currentTarget on
    // the scrim, replacing the panel's old stopPropagation. Assert both
    // directions so a regression that re-introduced a bubbling close (or one
    // that stopped dismissing entirely) is caught.
    try {
      const user = userEvent.setup();
      render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        menuContent: "click target paragraph",
      });

      await user.keyboard("{Escape}");
      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });

      await user.click(
        within(dialog).getByRole("button", { name: /物證檔案/ }),
      );

      // A click inside the panel (non-interactive slot content) must NOT
      // bubble-close via the scrim handler.
      await user.click(screen.getByText("click target paragraph"));
      expect(dialog).toBeInTheDocument();

      // A click on the scrim itself (target === currentTarget) dismisses.
      await user.click(dialog);
      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("closes a nested overlay's Escape claim instead of opening the menu", async () => {
    const testName =
      "closes a nested overlay's Escape claim instead of opening the menu";

    // GameShell's Escape handler must defer to the escape-coordinator: when a
    // nested overlay (production: the investigation topic popover) has
    // claimed Escape, the first Escape closes that overlay and must NOT open
    // the game menu. The next Escape opens the menu once the claim is gone.
    // This pins the "close one layer per Escape" contract.
    try {
      render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

      const nestedCloser = vi.fn();
      const releaseNested = claimEscape(nestedCloser);

      window.dispatchEvent(escapeKeydown());

      expect(nestedCloser).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });

      releaseNested();

      window.dispatchEvent(escapeKeydown());
      await screen.findByRole("dialog", { name: "遊戲選單" });
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("still closes the menu first when an overlay claim lingers behind it", async () => {
    const testName =
      "still closes the menu first when an overlay claim lingers behind it";

    // The menu is the topmost layer: Escape while the menu is open must
    // close the menu, not route to an overlay claim sitting behind it. This
    // pins that the `gameMenuOpen` branch is evaluated before the
    // escape-coordinator, so a stale claim can never trap the player out of
    // closing the menu.
    try {
      render(GameShellHarness, { gameState: state(), onReset: vi.fn() });

      // Open the menu first, while no claim is active.
      window.dispatchEvent(escapeKeydown());
      await screen.findByRole("dialog", { name: "遊戲選單" });

      // Simulate a popover whose claim lingers behind the now-open menu.
      const behindCloser = vi.fn();
      claimEscape(behindCloser);

      window.dispatchEvent(escapeKeydown());
      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });

      // The menu closed; the lingering claim was NOT invoked on this Escape.
      expect(behindCloser).not.toHaveBeenCalled();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("resets the active submenu when the bound open prop is driven false externally", async () => {
    const testName =
      "resets the active submenu when the bound open prop is driven false externally";

    // The $effect that clears `activeMenuPanel` when `open` becomes false
    // is only reachable when a submenu is active at the moment the parent
    // closes the menu externally (production: +page.svelte sets gameMenuOpen
    // false after a dossier reexamine). Without a submenu active, the
    // effect's `activeMenuPanel !== null` guard short-circuits. Pin the
    // submenu-active path so a regression that left the submenu state
    // dangling after an external close is caught.
    try {
      const { rerender } = render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        open: true,
        menuContent: "menu inventory slot",
      });

      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      const user = userEvent.setup();
      await user.click(
        within(dialog).getByRole("button", { name: /物證檔案/ }),
      );
      expect(
        await screen.findByRole("dialog", { name: "物證檔案" }),
      ).toBeInTheDocument();

      // Parent drives open=false while the evidence submenu is active.
      rerender({
        gameState: state(),
        onReset: vi.fn(),
        open: false,
        menuContent: "menu inventory slot",
      });

      await vi.waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "遊戲選單" })).toBeNull();
      });

      // Reopen via Escape — the menu must land on the root actions, not the
      // stale evidence submenu. If the $effect failed to clear
      // activeMenuPanel, reopening would show the submenu back button and
      // hide the root actions.
      window.dispatchEvent(escapeKeydown());
      const reopened = await screen.findByRole("dialog", { name: "遊戲選單" });
      expect(
        within(reopened).getByRole("button", { name: /繼續調查/ }),
      ).toBeInTheDocument();
      expect(
        within(reopened).queryByRole("button", { name: /返回選單/ }),
      ).toBeNull();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("disables the close-case button when the disabled prop is set", async () => {
    const testName =
      "disables the close-case button when the disabled prop is set";

    // The close-case button binds `{disabled}`. The default harness passes
    // disabled=false, so the disabled branch is never exercised. Pin it so a
    // regression that dropped the binding (or inverted it) is caught.
    try {
      render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        disabled: true,
      });

      window.dispatchEvent(escapeKeydown());
      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      const closeCase = within(dialog).getByRole("button", {
        name: /結束案件/,
      });
      expect(closeCase).toBeDisabled();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });

  it("renders an empty scene submenu when sceneMenuEnabled is set without sceneMenuContent", async () => {
    const testName =
      "renders an empty scene submenu when sceneMenuEnabled is set without sceneMenuContent";

    // The harness sceneMenu snippet guards its content on `{#if
    // sceneMenuContent}`. The truthy branch is covered by the scene-select
    // test; pin the falsy branch so the snippet renders an empty submenu
    // rather than throwing or leaking the back button's slot target.
    try {
      const user = userEvent.setup();
      render(GameShellHarness, {
        gameState: state(),
        onReset: vi.fn(),
        sceneMenuEnabled: true,
      });

      await user.keyboard("{Escape}");
      const dialog = await screen.findByRole("dialog", { name: "遊戲選單" });
      await user.click(
        within(dialog).getByRole("button", { name: /場景跳轉/ }),
      );

      expect(
        await screen.findByRole("dialog", { name: "場景跳轉" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: /返回選單/ }),
      ).toBeInTheDocument();
      // No harness scene-menu button rendered (sceneMenuContent is null).
      expect(
        within(dialog).queryByRole("button", { name: /scene/ }),
      ).toBeNull();
    } catch (error) {
      reportAsyncTestFailure(testName, error);
    }
  });
});
