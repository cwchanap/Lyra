import { fireEvent, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimEscape,
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import DialogueBox from "./DialogueBox.svelte";
import type {
  DialogueHistoryEntry,
  DialogueItem,
  QueueToken,
} from "../state/types";

const token: QueueToken = { sceneId: "s1", queueGen: 1, cursor: 0 };
const history: DialogueHistoryEntry[] = [
  {
    id: 1,
    kind: "line",
    speaker: "若月",
    text: "你好。",
    chapterTitle: "Chapter",
    sceneTitle: "Scene",
  },
  {
    id: 2,
    kind: "action",
    text: "雨聲壓過車流。",
    chapterTitle: "Chapter",
    sceneTitle: "Scene",
  },
];

function renderDialogueBox(
  current: DialogueItem,
  overrides?: {
    disabled?: boolean;
    onAdvanceFeedback?: () => void;
    history?: DialogueHistoryEntry[];
    crossExam?: {
      lineId: string;
      onChallenge: (lineId: string) => void;
      onWithdraw: () => void;
    } | null;
    textRevealDurationMs?: number;
  },
) {
  const onAdvance = vi.fn();
  const result = render(DialogueBox, {
    current,
    queueToken: token,
    onAdvance,
    history: overrides?.history ?? [],
    disabled: overrides?.disabled,
    onAdvanceFeedback: overrides?.onAdvanceFeedback,
    crossExam: overrides?.crossExam ?? null,
    textRevealDurationMs: overrides?.textRevealDurationMs ?? 0,
  });
  return { onAdvance, ...result };
}

function dialogueBoxSource() {
  return readFileSync(
    join(process.cwd(), "src/lib/components/DialogueBox.svelte"),
    "utf8",
  );
}

function isInert(element: HTMLElement) {
  return Boolean(
    (element as HTMLElement & { inert?: boolean }).inert ||
    element.hasAttribute("inert"),
  );
}

function dispatchWindowKeydown(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (init.isComposing) {
    Object.defineProperty(event, "isComposing", { value: true });
  }
  window.dispatchEvent(event);
  return event;
}

describe("DialogueBox", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetEscapeCoordinator();
  });

  it("renders an action dialogue item", () => {
    renderDialogueBox({ kind: "action", text: "Found evidence." });
    expect(screen.getByText("Found evidence.")).toBeInTheDocument();
    expect(screen.getByText(/NARRATION/)).toBeInTheDocument();
  });

  it("renders a line dialogue item with speaker", () => {
    renderDialogueBox({ kind: "line", speaker: "若月", text: "你好。" });
    expect(screen.getByText("若月")).toBeInTheDocument();
    expect(screen.getByText("你好。")).toBeInTheDocument();
    expect(screen.getByText(/LINE/)).toBeInTheDocument();
  });

  it("falls back to a portrait placeholder when the portrait image fails to load", async () => {
    const { container } = renderDialogueBox({
      kind: "line",
      speaker: "早坂茜",
      text: "你不舒服？",
      portrait: {
        characterId: "hayasaka_akane",
        expression: "concerned",
        assetId: "portrait.hayasaka_akane.load_error_component_test",
      },
    });

    await waitFor(() => {
      expect(container.querySelector("img.portrait")).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/load_error_component_test.png",
      );
    });

    const image = container.querySelector("img.portrait") as HTMLImageElement;
    image.dispatchEvent(new Event("error"));

    await waitFor(() => {
      const portraits = container.querySelectorAll("img.portrait");
      expect(portraits).toHaveLength(2);
      expect(portraits[1]).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });

    const placeholder = container.querySelectorAll(
      "img.portrait",
    )[1] as HTMLImageElement;
    placeholder.dispatchEvent(new Event("load"));

    await waitFor(() => {
      const portraits = container.querySelectorAll("img.portrait");
      expect(portraits[1]).toHaveClass("visible");
      expect(portraits[0]).toHaveClass("leaving");
    });
  });

  it.each([
    ["clerk", "standard"],
    ["hayasaka_akane", "standard"],
    ["miyake_mother", "standard"],
    ["miyake_sota", "standard"],
    ["soma_ritsu", "standard"],
    ["takase_manager", "standard"],
  ])(
    "renders %s portraits on the right because they face left",
    async (characterId, expression) => {
      const { container } = renderDialogueBox({
        kind: "line",
        speaker: "測試",
        text: "檢查站位。",
        portrait: {
          characterId,
          expression,
          assetId: `portrait.${characterId}.${expression}`,
        },
      });

      await waitFor(() => {
        expect(container.querySelector("img.portrait")).toHaveAttribute(
          "src",
          `/assets/portraits/${characterId}/${expression}.png`,
        );
      });

      const image = container.querySelector("img.portrait") as HTMLImageElement;
      expect(image).toHaveAttribute("data-placement", "right");
      expect(image).toHaveAttribute("data-layer", "behind-dialogue");
      expect(image).toHaveClass("right");
      expect(image.style.getPropertyValue("--portrait-height")).toBe(
        "min(1536px, 80vh)",
      );
    },
  );

  it("keeps side portraits inside the viewport instead of translating them offscreen", () => {
    renderDialogueBox({
      kind: "line",
      speaker: "測試",
      text: "檢查站位。",
      portrait: {
        characterId: "hayasaka_akane",
        expression: "standard",
        assetId: "portrait.hayasaka_akane.standard",
      },
    });

    const source = dialogueBoxSource();
    expect(source).toMatch(
      /\.portrait-shell\s+:global\(img\.portrait\.left\)\s*{[^}]*transform:\s*none;/s,
    );
    expect(source).toMatch(
      /\.portrait-shell\s+:global\(img\.portrait\.right\)\s*{[^}]*transform:\s*none;/s,
    );
  });

  it("renders Katase on the left because her portrait faces right", async () => {
    const { container } = renderDialogueBox({
      kind: "line",
      speaker: "片瀨美咲",
      text: "終電が……",
      portrait: {
        characterId: "katase",
        expression: "standard",
        assetId: "portrait.katase.standard",
      },
    });

    await waitFor(() => {
      expect(container.querySelector("img.portrait")).toHaveAttribute(
        "src",
        "/assets/portraits/katase/standard.png",
      );
    });

    const image = container.querySelector("img.portrait") as HTMLImageElement;
    expect(image).toHaveAttribute("data-placement", "left");
    expect(image).toHaveAttribute("data-layer", "behind-dialogue");
    expect(image).toHaveClass("left");
    expect(image.style.getPropertyValue("--portrait-height")).toBe(
      "min(1536px, 80vh)",
    );
  });

  it("crossfades between portrait asset changes without removing the old portrait first", async () => {
    const { container, rerender } = renderDialogueBox({
      kind: "line",
      speaker: "早坂茜",
      text: "第一句。",
      portrait: {
        characterId: "hayasaka_akane",
        expression: "standard",
        assetId: "portrait.hayasaka_akane.standard",
      },
    });

    await waitFor(() => {
      expect(container.querySelector("img.portrait")).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/standard.png",
      );
    });

    await rerender({
      current: {
        kind: "line",
        speaker: "早坂茜",
        text: "第二句。",
        portrait: {
          characterId: "hayasaka_akane",
          expression: "concerned",
          assetId: "portrait.hayasaka_akane.concerned",
        },
      },
      queueToken: token,
      onAdvance: vi.fn(),
      history: [],
      disabled: false,
      crossExam: null,
    });

    await waitFor(() => {
      const portraits = container.querySelectorAll("img.portrait");
      expect(portraits.length).toBe(2);
      expect(portraits[0]).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/standard.png",
      );
      expect(portraits[1]).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/concerned.png",
      );
    });
  });

  it("fades out the portrait when a line transitions to a portraitless action", async () => {
    const { container, rerender } = renderDialogueBox({
      kind: "line",
      speaker: "早坂茜",
      text: "看著你。",
      portrait: {
        characterId: "hayasaka_akane",
        expression: "standard",
        assetId: "portrait.hayasaka_akane.standard",
      },
    });

    await waitFor(() => {
      expect(container.querySelector("img.portrait")).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/standard.png",
      );
    });
    const portrait = container.querySelector(
      "img.portrait",
    ) as HTMLImageElement;
    await waitFor(() => {
      expect(portrait).toHaveClass("visible");
    });

    // A portraitless action item drives portraitSource to null, which the
    // shared CrossfadeImage turns into a fade-out of the existing layer
    // rather than an immediate detach. This verifies the DialogueBox ->
    // CrossfadeImage wiring for the line -> action transition, complementing
    // the primitive-level null-src fade-out test in CrossfadeImage.test.ts.
    await rerender({
      current: { kind: "action", text: "她轉過身。" },
      queueToken: token,
      onAdvance: vi.fn(),
      history: [],
      disabled: false,
      crossExam: null,
    });

    await waitFor(() => {
      const portraits = container.querySelectorAll("img.portrait");
      expect(portraits).toHaveLength(1);
      expect(portraits[0]).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/standard.png",
      );
      expect(portraits[0]).toHaveClass("leaving");
      expect(portraits[0]).not.toHaveClass("visible");
    });
  });

  it("crossfades same-source portraits when placement changes sides", async () => {
    const { container, rerender } = renderDialogueBox({
      kind: "line",
      speaker: "早坂茜",
      text: "右側。",
      portrait: {
        characterId: "hayasaka_akane",
        expression: "standard",
        assetId: "portrait.hayasaka_akane.standard",
      },
    });

    await waitFor(() => {
      expect(container.querySelector("img.portrait")).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/standard.png",
      );
    });

    await rerender({
      current: {
        kind: "line",
        speaker: "片瀨美咲",
        text: "左側。",
        portrait: {
          characterId: "katase",
          expression: "standard",
          assetId: "portrait.hayasaka_akane.standard",
        },
      },
      queueToken: token,
      onAdvance: vi.fn(),
      history: [],
      disabled: false,
      crossExam: null,
    });

    await waitFor(() => {
      const portraits = Array.from(
        container.querySelectorAll("img.portrait"),
      ) as HTMLImageElement[];
      expect(portraits).toHaveLength(2);
      expect(portraits[0]).toHaveAttribute("data-placement", "right");
      expect(portraits[0]).toHaveClass("right", "visible");
      expect(portraits[1]).toHaveAttribute("data-placement", "left");
      expect(portraits[1]).toHaveClass("left");
      expect(portraits[1]).not.toHaveClass("visible");
    });
  });

  it("uses a 1500ms portrait transition duration", async () => {
    const { container } = renderDialogueBox({
      kind: "line",
      speaker: "早坂茜",
      text: "慢慢切換。",
      portrait: {
        characterId: "hayasaka_akane",
        expression: "standard",
        assetId: "portrait.hayasaka_akane.standard",
      },
    });

    await waitFor(() => {
      expect(container.querySelector("img.portrait")).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/standard.png",
      );
    });

    const image = container.querySelector("img.portrait") as HTMLImageElement;
    expect(image.style.getPropertyValue("--crossfade-duration")).toBe("1500ms");
  });

  it("uses the shared crossfade image primitive for portrait rendering", () => {
    const source = dialogueBoxSource();
    expect(source).toContain(
      'import CrossfadeImage from "./CrossfadeImage.svelte"',
    );
    expect(source).toContain("<CrossfadeImage");
    expect(source).toContain("imageClass={`portrait ${portraitPlacement}`}");
    expect(source).toContain("dataAttributes={{");
    expect(source).toContain("placement: portraitPlacement");
    expect(source).toContain('layer: "behind-dialogue"');
  });

  it("scopes portrait selectors through the local portrait shell", () => {
    const source = dialogueBoxSource();

    expect(source).toContain('class="portrait-shell"');
    expect(source).toContain(".portrait-shell :global(img.portrait)");
    expect(source).toContain(".portrait-shell :global(img.portrait.left)");
    expect(source).toContain(".portrait-shell :global(img.portrait.right)");
    expect(source).not.toContain(":global(.portrait) {");
  });

  it("renders a sceneTag dialogue item", () => {
    renderDialogueBox({ kind: "sceneTag", text: "cafe" });
    expect(screen.getByText(/SCENE/)).toBeInTheDocument();
  });

  it("calls onAdvance with queueToken on click", async () => {
    const user = userEvent.setup();
    const { onAdvance, container } = renderDialogueBox({
      kind: "action",
      text: "hello",
    });
    await user.click(container.querySelector(".box") as HTMLElement);
    expect(onAdvance).toHaveBeenCalledWith(token);
  });

  it("reveals long action text over the configured 1500ms cap", async () => {
    vi.useFakeTimers();
    // 40 chars * 40ms/char floor = 1600ms, so the 1500ms cap governs.
    const longText =
      "雨聲壓過車流，霓虹在積水裡碎成一片片流動的光，遠處的號誌模糊成暈開的色塊與殘影。";
    const { container } = renderDialogueBox(
      {
        kind: "action",
        text: longText,
      },
      {
        textRevealDurationMs: 1500,
      },
    );
    const text = container.querySelector(".text-action") as HTMLElement;

    expect(text).not.toHaveTextContent(longText);

    await vi.advanceTimersByTimeAsync(750);
    expect(text.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(text).not.toHaveTextContent(longText);

    await vi.advanceTimersByTimeAsync(750);
    expect(text).toHaveTextContent(longText);
  });

  it("reveals short action text faster than the cap via the per-char floor", async () => {
    vi.useFakeTimers();
    // 7 chars * 40ms/char = 280ms, well below the 1500ms cap.
    const shortText = "雨聲壓過車流。";
    const { container } = renderDialogueBox(
      {
        kind: "action",
        text: shortText,
      },
      {
        textRevealDurationMs: 1500,
      },
    );
    const text = container.querySelector(".text-action") as HTMLElement;

    expect(text).not.toHaveTextContent(shortText);

    // At 150ms (past half of the 280ms effective duration) it is partial.
    await vi.advanceTimersByTimeAsync(150);
    expect(text.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(text).not.toHaveTextContent(shortText);

    // Completes well before the 1500ms cap.
    await vi.advanceTimersByTimeAsync(150);
    expect(text).toHaveTextContent(shortText);
  });

  it("reveals line text gradually while keeping the speaker visible", async () => {
    vi.useFakeTimers();
    const { container } = renderDialogueBox(
      {
        kind: "line",
        speaker: "若月",
        text: "答案還在雨裡。",
      },
      {
        textRevealDurationMs: 1500,
      },
    );
    const text = container.querySelector(".text-line") as HTMLElement;

    expect(screen.getByText("若月")).toBeInTheDocument();
    expect(text).not.toHaveTextContent("答案還在雨裡。");

    await vi.advanceTimersByTimeAsync(1500);
    expect(text).toHaveTextContent("答案還在雨裡。");
  });

  it("reveals the full line immediately under prefers-reduced-motion without scheduling a typewriter interval", async () => {
    const reducedMotionList = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", (query: string) =>
      query === "(prefers-reduced-motion: reduce)"
        ? reducedMotionList
        : ({ matches: false } as unknown as MediaQueryList),
    );

    vi.useFakeTimers();
    const { container } = renderDialogueBox(
      {
        kind: "line",
        speaker: "若月",
        text: "答案還在雨裡。",
      },
      {
        textRevealDurationMs: 1500,
      },
    );
    const text = container.querySelector(".text-line") as HTMLElement;

    // Flush the mount effect (microtask queue) without advancing the clock.
    // Under reduced motion the full line must be revealed immediately; without
    // the reduced-motion branch, visibleTextLength would still be 0 here.
    await vi.advanceTimersByTimeAsync(0);
    expect(text).toHaveTextContent("答案還在雨裡。");

    // Advancing the full duration must not mutate the already-fully-revealed
    // text — confirms no typewriter interval was scheduled.
    await vi.advanceTimersByTimeAsync(1500);
    expect(text).toHaveTextContent("答案還在雨裡。");

    vi.unstubAllGlobals();
  });

  it("completes the current text reveal before advancing dialogue", async () => {
    vi.useFakeTimers();
    const { onAdvance, container } = renderDialogueBox(
      {
        kind: "action",
        text: "先把這句說完。",
      },
      {
        textRevealDurationMs: 1500,
      },
    );
    const advanceControl = container.querySelector(".box") as HTMLElement;

    await fireEvent.click(advanceControl);

    expect(screen.getByText("先把這句說完。")).toBeInTheDocument();
    expect(onAdvance).not.toHaveBeenCalled();

    await fireEvent.click(advanceControl);

    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith(token);
  });

  it("plays advance feedback when completing text reveal via click", async () => {
    vi.useFakeTimers();
    const onAdvanceFeedback = vi.fn();
    const { onAdvance, container } = renderDialogueBox(
      { kind: "action", text: "先把這句說完。" },
      { textRevealDurationMs: 1500, onAdvanceFeedback },
    );
    const advanceControl = container.querySelector(".box") as HTMLElement;

    await fireEvent.click(advanceControl);

    expect(onAdvanceFeedback).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("先把這句說完。")).toBeInTheDocument();
    });

    await fireEvent.click(advanceControl);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("plays advance feedback when completing text reveal via window Space", async () => {
    vi.useFakeTimers();
    const onAdvanceFeedback = vi.fn();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "先把這句說完。" },
      { textRevealDurationMs: 1500, onAdvanceFeedback },
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );

    expect(onAdvanceFeedback).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("先把這句說完。")).toBeInTheDocument();
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("plays advance feedback when completing text reveal via Space", async () => {
    vi.useFakeTimers();
    const onAdvanceFeedback = vi.fn();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "先把這句說完。" },
      { textRevealDurationMs: 1500, onAdvanceFeedback },
    );
    dispatchWindowKeydown({ key: " " });

    expect(onAdvanceFeedback).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("先把這句說完。")).toBeInTheDocument();
    });

    dispatchWindowKeydown({ key: " " });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("plays advance feedback before dispatching advance on click", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const onAdvanceFeedback = vi.fn(() => calls.push("feedback"));
    const { onAdvance, container } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { onAdvanceFeedback },
    );
    onAdvance.mockImplementationOnce(() => calls.push("advance"));

    await user.click(container.querySelector(".box") as HTMLElement);

    expect(onAdvanceFeedback).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith(token);
    expect(calls).toEqual(["feedback", "advance"]);
  });

  it("plays advance feedback even when command dispatch is disabled", async () => {
    const user = userEvent.setup();
    const onAdvanceFeedback = vi.fn();
    const { onAdvance, container } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { disabled: true, onAdvanceFeedback },
    );
    await user.click(container.querySelector(".box") as HTMLElement);
    expect(onAdvanceFeedback).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("does not advance when the advance control is clicked while dialogue history is open", async () => {
    const user = userEvent.setup();
    const { onAdvance, container } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    await user.click(container.querySelector(".box") as HTMLElement);

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("advances exactly once from Space or Enter on the window", () => {
    const { onAdvance } = renderDialogueBox({
      kind: "action",
      text: "hello",
    });

    dispatchWindowKeydown({ key: " " });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenLastCalledWith(token);

    dispatchWindowKeydown({ key: "Enter" });
    expect(onAdvance).toHaveBeenCalledTimes(2);
    expect(onAdvance).toHaveBeenLastCalledWith(token);
  });

  it("advances from Space or Enter via the focused SR advance button (native activation)", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox({
      kind: "action",
      text: "hello",
    });

    // The SR advance button is a native <button>; when focused, Space/Enter
    // activate it natively (→ handleClick → dispatchAdvance). The window-level
    // handler bails because the focused element matches `button` in
    // interactiveFocusSelector, so advance must come from the button's own
    // click, not the global shortcut. dispatchWindowKeydown does not synthesize
    // this native activation in jsdom; userEvent.keyboard does.
    const advanceButton = screen.getByRole("button", { name: "推進對話" });
    advanceButton.focus();
    expect(document.activeElement).toBe(advanceButton);

    await user.keyboard(" ");
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenLastCalledWith(token);

    await user.keyboard("{Enter}");
    expect(onAdvance).toHaveBeenCalledTimes(2);
    expect(onAdvance).toHaveBeenLastCalledWith(token);
  });

  it("opens dialogue history from the LOG button", async () => {
    const user = userEvent.setup();
    renderDialogueBox({ kind: "action", text: "hello" }, { history });

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));

    expect(
      screen.getByRole("dialog", { name: "對話紀錄" }),
    ).toBeInTheDocument();
    expect(screen.getByText("你好。")).toBeInTheDocument();
    expect(screen.getByText("雨聲壓過車流。")).toBeInTheDocument();
  });

  it("toggles history from the focused LOG button with Space or Enter without advancing", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );

    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });
    logButton.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
    // Keyboard activation of the LOG button opens history, never advances.
    expect(onAdvance).not.toHaveBeenCalled();

    // Space also opens history. The Escape claim is driven by GameShell in
    // production; here we close it via the coordinator directly to refocus LOG.
    expect(closeTopmostEscapeClaim()).toBe(true);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "對話紀錄" }),
      ).not.toBeInTheDocument();
    });
    await user.keyboard(" ");
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("toggles dialogue history with L when focus is not inside a control", async () => {
    renderDialogueBox({ kind: "action", text: "hello" }, { history });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "L", bubbles: true }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
    screen.getByRole("button", { name: "關閉對話紀錄" }).blur();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", bubbles: true }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "對話紀錄" }),
      ).not.toBeInTheDocument();
    });
  });

  it("does not toggle dialogue history with L while another control is focused", async () => {
    renderDialogueBox({ kind: "action", text: "hello" }, { history });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", bubbles: true }),
    );
    await Promise.resolve();
    input.remove();

    expect(
      screen.queryByRole("dialog", { name: "對話紀錄" }),
    ).not.toBeInTheDocument();
  });

  it("does not toggle dialogue history or prevent defaults for modified L shortcuts", async () => {
    renderDialogueBox({ kind: "action", text: "hello" }, { history });

    const events = [
      dispatchWindowKeydown({ key: "l", metaKey: true }),
      dispatchWindowKeydown({ key: "l", ctrlKey: true }),
      dispatchWindowKeydown({ key: "l", altKey: true }),
      dispatchWindowKeydown({ key: "L", shiftKey: true }),
      dispatchWindowKeydown({ key: "l", isComposing: true }),
    ];
    await Promise.resolve();

    expect(
      screen.queryByRole("dialog", { name: "對話紀錄" }),
    ).not.toBeInTheDocument();
    for (const event of events) {
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("closes dialogue history with L while the history close button is focused", async () => {
    const user = userEvent.setup();
    renderDialogueBox({ kind: "action", text: "hello" }, { history });

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    const closeButton = screen.getByRole("button", { name: "關閉對話紀錄" });
    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", bubbles: true }),
    );
    await Promise.resolve();

    expect(
      screen.queryByRole("dialog", { name: "對話紀錄" }),
    ).not.toBeInTheDocument();
  });

  it("does not advance with Space or Enter while dialogue history is open", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("closes dialogue history when Space or Enter is pressed on the focused close button", async () => {
    const user = userEvent.setup();
    renderDialogueBox({ kind: "action", text: "hello" }, { history });

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    const closeButton = screen.getByRole("button", { name: "關閉對話紀錄" });
    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    // Enter on the focused close button must activate it (not be swallowed by
    // the window-level guard that prevents dialogue advancement).
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "對話紀錄" }),
      ).not.toBeInTheDocument();
    });

    // Reopen and verify Space also activates the close button.
    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
    screen.getByRole("button", { name: "關閉對話紀錄" }).focus();
    await user.keyboard(" ");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "對話紀錄" }),
      ).not.toBeInTheDocument();
    });
  });

  it("registers an Escape claim while history is open and restores focus to the LOG button", async () => {
    const user = userEvent.setup();
    const { container } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );
    const box = container.querySelector(".box") as HTMLElement;

    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });
    await user.click(logButton);

    expect(isInert(box)).toBe(true);
    expect(closeTopmostEscapeClaim()).toBe(true);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "對話紀錄" }),
      ).not.toBeInTheDocument();
      expect(isInert(box)).toBe(false);
      expect(logButton).toHaveFocus();
    });
  });

  it("keeps the LOG button non-inert while history is open so it can close the panel", async () => {
    const user = userEvent.setup();
    renderDialogueBox({ kind: "action", text: "hello" }, { history });

    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });
    await user.click(logButton);
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });

    // The advance box is inert, but the LOG button itself must not be so
    // clicking it again can close the panel.
    expect(isInert(logButton)).toBe(false);

    await user.click(logButton);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "對話紀錄" }),
      ).not.toBeInTheDocument();
    });
  });

  it("does not release another overlay claim when dialogue history closes", async () => {
    const user = userEvent.setup();
    const behindCloser = vi.fn();
    claimEscape(behindCloser);
    renderDialogueBox({ kind: "action", text: "hello" }, { history });

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    await user.click(screen.getByRole("button", { name: "關閉對話紀錄" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "對話紀錄" }),
      ).not.toBeInTheDocument();
    });

    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(behindCloser).toHaveBeenCalledTimes(1);
  });

  it("advances dialogue when Space is pressed on the window", () => {
    const { onAdvance } = renderDialogueBox({ kind: "action", text: "hello" });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );

    expect(onAdvance).toHaveBeenCalledWith(token);
  });

  it("keeps the dialogue surface click-only but exposes a sibling advance button for SR", () => {
    const { container } = renderDialogueBox({
      kind: "action",
      text: "hello",
    });

    const box = container.querySelector(".box");
    expect(box).not.toHaveAttribute("role");
    expect(box).not.toHaveAttribute("tabindex");
    // The advance button is a sibling of .box (not nested inside it), so
    // screen-reader users have a Tab-reachable advance target without a
    // nested-button role conflict.
    const advanceButton = screen.getByRole("button", { name: "推進對話" });
    expect(advanceButton).not.toBe(box);
    expect(advanceButton.closest(".box")).toBeNull();
  });

  it("advances dialogue when the SR advance button is clicked", async () => {
    const { onAdvance } = renderDialogueBox({
      kind: "action",
      text: "hello",
    });
    await fireEvent.click(screen.getByRole("button", { name: "推進對話" }));
    expect(onAdvance).toHaveBeenCalledWith(token);
  });

  it("marks the SR advance button inert while dialogue history is open", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    const advanceButton = screen.getByRole("button", { name: "推進對話" });
    expect(isInert(advanceButton)).toBe(true);

    // jsdom does not enforce `inert` (it does not block click dispatch), so
    // this assertion is not a faithful test of inert enforcement. The click is
    // blocked here by the `historyOpen` guard inside handleClick, not by
    // inert. Real inert enforcement is covered by the e2e (browser) path;
    // this unit test only verifies the inert attribute is applied AND that
    // the historyOpen guard independently prevents advancement.
    await fireEvent.click(advanceButton);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("advances from Space when a noninteractive gameplay container is focused", () => {
    const { onAdvance } = renderDialogueBox({ kind: "action", text: "hello" });
    const gameplayRoot = document.createElement("div");
    gameplayRoot.tabIndex = 0;
    document.body.appendChild(gameplayRoot);
    gameplayRoot.focus();

    dispatchWindowKeydown({ key: " " });
    gameplayRoot.remove();

    expect(onAdvance).toHaveBeenCalledWith(token);
  });

  it("opens dialogue history with L when a noninteractive gameplay container is focused", async () => {
    renderDialogueBox({ kind: "action", text: "hello" }, { history });
    const gameplayRoot = document.createElement("div");
    gameplayRoot.tabIndex = 0;
    document.body.appendChild(gameplayRoot);
    gameplayRoot.focus();

    dispatchWindowKeydown({ key: "l" });

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
    gameplayRoot.remove();
  });

  it("opens dialogue history with L while the SR advance button is focused", async () => {
    // The SR advance button is a sibling of .box (a native <button>), so
    // without an explicit exemption isHistoryShortcutBlockedByFocusedControl
    // would treat it as an interactive control and swallow L. The advance
    // button is part of this dialogue surface, so L must remain available.
    renderDialogueBox({ kind: "action", text: "hello" }, { history });
    const advanceButton = screen.getByRole("button", { name: "推進對話" });
    advanceButton.focus();
    expect(advanceButton).toHaveFocus();

    dispatchWindowKeydown({ key: "l" });

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
  });

  it("advances dialogue when Enter is pressed on the window", () => {
    const { onAdvance } = renderDialogueBox({ kind: "action", text: "hello" });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(onAdvance).toHaveBeenCalledWith(token);
  });

  it("plays advance feedback before advancing from the keyboard", () => {
    const order: string[] = [];
    const onAdvanceFeedback = () => order.push("feedback");
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { onAdvanceFeedback },
    );
    onAdvance.mockImplementation(() => order.push("advance"));

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );

    expect(onAdvance).toHaveBeenCalledWith(token);
    expect(order).toEqual(["feedback", "advance"]);
  });

  it("does not advance from the keyboard while disabled", () => {
    const onAdvance = vi.fn();
    renderDialogueBox({ kind: "action", text: "hello" }, { disabled: true });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("ignores repeated key holds", () => {
    const onAdvance = vi.fn();
    renderDialogueBox({ kind: "action", text: "hello" });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, repeat: true }),
    );

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("ignores keys that are not Space or Enter", () => {
    const onAdvance = vi.fn();
    renderDialogueBox({ kind: "action", text: "hello" });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("does not advance from Space or Enter while IME is composing", () => {
    const onAdvanceFeedback = vi.fn();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { onAdvanceFeedback },
    );

    // IME composition fires Space/Enter with isComposing=true; advancing
    // mid-composition would corrupt CJK input. Neither advance nor the
    // feedback SFX should fire.
    const spaceEvent = dispatchWindowKeydown({ key: " ", isComposing: true });
    const enterEvent = dispatchWindowKeydown({
      key: "Enter",
      isComposing: true,
    });

    expect(onAdvance).not.toHaveBeenCalled();
    expect(onAdvanceFeedback).not.toHaveBeenCalled();
    // The guard returns before preventDefault, so the event is not swallowed
    // — the IME keeps the keypress for composition.
    expect(spaceEvent.defaultPrevented).toBe(false);
    expect(enterEvent.defaultPrevented).toBe(false);
  });

  it("does not advance from the keyboard while another element is focused", () => {
    const onAdvance = vi.fn();
    renderDialogueBox({ kind: "action", text: "hello" });

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    input.remove();

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("uses the default empty history when no history prop is passed", async () => {
    const onAdvance = vi.fn();
    render(DialogueBox, {
      current: { kind: "action", text: "hello" },
      queueToken: token,
      onAdvance,
    });

    // The LOG button still renders; opening history shows the empty state.
    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });
    expect(logButton).toBeInTheDocument();
    fireEvent.click(logButton, { detail: 0 });
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("尚無對話紀錄")).toBeInTheDocument();
  });

  it("opens dialogue history with L while the LOG button is focused", async () => {
    renderDialogueBox({ kind: "action", text: "hello" }, { history });

    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });
    logButton.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", bubbles: true }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
  });

  it("toggles history when the LOG button is activated, including AT click (detail 0)", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );

    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });
    // AT click activation (VoiceOver VO+Space, programmatic .click()) carries
    // detail 0 and must toggle history — gating on detail would drop it.
    fireEvent.click(logButton, { detail: 0 });
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
    // Close via the escape coordinator so LOG refocuses for the next step.
    expect(closeTopmostEscapeClaim()).toBe(true);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "對話紀錄" }),
      ).not.toBeInTheDocument();
    });

    logButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "對話紀錄" }),
      ).toBeInTheDocument();
    });
    // Keyboard activation of the LOG button toggles history, never advances.
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("does not advance when a non-Space/Enter key is pressed on the focused LOG button", () => {
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );
    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });

    logButton.focus();
    fireEvent.keyDown(logButton, { key: "ArrowRight" });

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("does not advance when a held Space repeats on the focused LOG button", () => {
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );
    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });

    logButton.focus();
    fireEvent.keyDown(logButton, { key: " ", repeat: true });

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("does not advance from the LOG button keydown while history is open", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { history },
    );

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    const logButton = screen.getByRole("button", { name: "開啟對話紀錄" });
    fireEvent.keyDown(logButton, { key: " " });

    expect(onAdvance).not.toHaveBeenCalled();
  });
});

describe("DialogueBox inline cross-examination controls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetEscapeCoordinator();
  });

  it("renders no 反駁 / 退下 controls without a crossExam prop", () => {
    renderDialogueBox({ kind: "line", speaker: "嫌疑人", text: "我沒去過。" });
    expect(screen.queryByRole("button", { name: /反駁/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /退下/ })).toBeNull();
  });

  it("renders the inline 反駁 / 退下 controls while a testimony plays", () => {
    renderDialogueBox(
      { kind: "line", speaker: "嫌疑人", text: "我沒去過。" },
      {
        crossExam: {
          lineId: "l_deny",
          onChallenge: vi.fn(),
          onWithdraw: vi.fn(),
        },
      },
    );
    expect(screen.getByRole("button", { name: /反駁/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /退下/ })).toBeInTheDocument();
  });

  it("challenges the current line without advancing the dialogue", async () => {
    const onChallenge = vi.fn();
    const { onAdvance } = renderDialogueBox(
      { kind: "line", speaker: "嫌疑人", text: "我沒去過。" },
      { crossExam: { lineId: "l_deny", onChallenge, onWithdraw: vi.fn() } },
    );

    await fireEvent.click(screen.getByRole("button", { name: /反駁/ }));

    expect(onChallenge).toHaveBeenCalledWith("l_deny");
    // The button lives inside the click-to-advance box; its click must not
    // also advance the testimony.
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("withdraws without advancing the dialogue", async () => {
    const onWithdraw = vi.fn();
    const { onAdvance } = renderDialogueBox(
      { kind: "line", speaker: "嫌疑人", text: "我沒去過。" },
      { crossExam: { lineId: "l_deny", onChallenge: vi.fn(), onWithdraw } },
    );

    await fireEvent.click(screen.getByRole("button", { name: /退下/ }));

    expect(onWithdraw).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("still advances when the box itself is clicked", async () => {
    const { container, onAdvance } = renderDialogueBox(
      { kind: "line", speaker: "嫌疑人", text: "我沒去過。" },
      {
        crossExam: {
          lineId: "l_deny",
          onChallenge: vi.fn(),
          onWithdraw: vi.fn(),
        },
      },
    );

    // In cross-exam mode the box drops role="button"/tabindex so the inline
    // 反駁/退下 buttons are not nested inside a button (a11y). Click-to-advance
    // still works via the box's onclick, so target the .box element directly
    // rather than querying by role.
    const box = container.querySelector(".box") as HTMLElement;
    await fireEvent.click(box);

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("does not fire challenge / withdraw while disabled", async () => {
    const onChallenge = vi.fn();
    const onWithdraw = vi.fn();
    renderDialogueBox(
      { kind: "line", speaker: "嫌疑人", text: "我沒去過。" },
      {
        disabled: true,
        crossExam: { lineId: "l_deny", onChallenge, onWithdraw },
      },
    );

    await fireEvent.click(screen.getByRole("button", { name: /反駁/ }));
    await fireEvent.click(screen.getByRole("button", { name: /退下/ }));

    expect(onChallenge).not.toHaveBeenCalled();
    expect(onWithdraw).not.toHaveBeenCalled();
  });
});
