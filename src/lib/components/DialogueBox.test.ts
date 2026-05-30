import { render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DialogueBox from "./DialogueBox.svelte";
import type { DialogueItem, QueueToken } from "../state/types";

const token: QueueToken = { sceneId: "s1", queueGen: 1, cursor: 0 };

function renderDialogueBox(
  current: DialogueItem,
  overrides?: { disabled?: boolean },
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

  it("does not call onAdvance when disabled", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox(
      { kind: "action", text: "hello" },
      { disabled: true },
    );
    await user.click(screen.getByRole("button"));
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
