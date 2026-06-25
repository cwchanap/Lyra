import { render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DialogueBox from "./DialogueBox.svelte";
import type { DialogueItem, QueueToken } from "../state/types";

const token: QueueToken = { sceneId: "s1", queueGen: 1, cursor: 0 };

function renderDialogueBox(
  current: DialogueItem,
  overrides?: { disabled?: boolean; onAdvanceFeedback?: () => void },
) {
  const onAdvance = vi.fn();
  const result = render(DialogueBox, {
    current,
    queueToken: token,
    onAdvance,
    ...overrides,
  });
  return { onAdvance, ...result };
}

function dialogueBoxSource() {
  return readFileSync(
    join(process.cwd(), "src/lib/components/DialogueBox.svelte"),
    "utf8",
  );
}

describe("DialogueBox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
      expect(container.querySelector("img.portrait")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
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
    expect(source).toMatch(/\.portrait\.left\s*{[^}]*transform:\s*none;/s);
    expect(source).toMatch(/\.portrait\.right\s*{[^}]*transform:\s*none;/s);
  });

  it("renders Katase on the left because her portrait faces right", async () => {
    const { container } = renderDialogueBox({
      kind: "line",
      speaker: "片瀨",
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

  it("renders a sceneTag dialogue item", () => {
    renderDialogueBox({ kind: "sceneTag", text: "cafe" });
    expect(screen.getByText(/SCENE/)).toBeInTheDocument();
  });

  it("calls onAdvance with queueToken on click", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox({
      kind: "action",
      text: "hello",
    });
    await user.click(screen.getByRole("button"));
    expect(onAdvance).toHaveBeenCalledWith(token);
  });

  it("plays advance feedback before dispatching advance on click", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const onAdvanceFeedback = vi.fn(() => calls.push("feedback"));
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { onAdvanceFeedback },
    );
    onAdvance.mockImplementationOnce(() => calls.push("advance"));

    await user.click(screen.getByRole("button"));

    expect(onAdvanceFeedback).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith(token);
    expect(calls).toEqual(["feedback", "advance"]);
  });

  it("plays advance feedback even when command dispatch is disabled", async () => {
    const user = userEvent.setup();
    const onAdvanceFeedback = vi.fn();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { disabled: true, onAdvanceFeedback },
    );
    await user.click(screen.getByRole("button"));
    expect(onAdvanceFeedback).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("advances dialogue when Space is pressed on the window", () => {
    const { onAdvance } = renderDialogueBox({ kind: "action", text: "hello" });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );

    expect(onAdvance).toHaveBeenCalledWith(token);
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
});
