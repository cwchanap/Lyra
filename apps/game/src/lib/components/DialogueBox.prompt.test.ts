import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeCoordinator } from "$lib/state/escape-coordinator";
import DialogueBox from "./DialogueBox.svelte";
import type { DialogueItem, FeedbackLine, QueueToken } from "../state/types";

vi.mock("$lib/audio/gameplay-audio-runtime.svelte", () => ({
  playDialogueVoice: vi.fn(() => 1),
  stopDialogueVoice: vi.fn(),
}));

const token: QueueToken = { sceneId: "s1", queueGen: 1, cursor: 3 };
const prompt: DialogueItem = {
  kind: "prompt",
  question: "那 89.7 秒說明了什麼？",
  options: [{ label: "摘要合併了時間" }, { label: "三宅說了謊" }],
};

function renderPrompt(
  overrides: {
    promptFeedback?: FeedbackLine | null;
    disabled?: boolean;
  } = {},
) {
  const onAdvance = vi.fn();
  const onAnswerPrompt = vi.fn();
  render(DialogueBox, {
    current: prompt,
    queueToken: token,
    onAdvance,
    onAnswerPrompt,
    textRevealDurationMs: 0,
    ...overrides,
  });
  return { onAdvance, onAnswerPrompt };
}

afterEach(() => {
  resetEscapeCoordinator();
});

describe("DialogueBox 推理 prompt", () => {
  it("shows the question and its options instead of the advance button", () => {
    renderPrompt();
    expect(screen.getByText("那 89.7 秒說明了什麼？")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /摘要合併了時間/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /三宅說了謊/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "推進對話" }),
    ).not.toBeInTheDocument();
  });

  it("answers with the picked option and never advances on a box click", async () => {
    const user = userEvent.setup();
    const { onAdvance, onAnswerPrompt } = renderPrompt();

    await user.click(screen.getByText("那 89.7 秒說明了什麼？"));
    await user.click(screen.getByRole("button", { name: /三宅說了謊/ }));

    expect(onAnswerPrompt).toHaveBeenCalledExactlyOnceWith(token, 1);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("picks an option with its number key, and Space does not skip the prompt", async () => {
    const { onAdvance, onAnswerPrompt } = renderPrompt();

    await fireEvent.keyDown(window, { key: " " });
    await fireEvent.keyDown(window, { key: "3" });
    await fireEvent.keyDown(window, { key: "1" });

    expect(onAdvance).not.toHaveBeenCalled();
    expect(onAnswerPrompt).toHaveBeenCalledExactlyOnceWith(token, 0);
  });

  it("leaves number keys alone while a menu makes the dialogue inert", async () => {
    const menu = document.body.appendChild(document.createElement("div"));
    menu.setAttribute("inert", "");
    const onAnswerPrompt = vi.fn();
    render(DialogueBox, {
      target: menu,
      props: {
        current: prompt,
        queueToken: token,
        onAdvance: vi.fn(),
        onAnswerPrompt,
        textRevealDurationMs: 0,
      },
    });

    await fireEvent.keyDown(window, { key: "1" });

    expect(onAnswerPrompt).not.toHaveBeenCalled();
    menu.remove();
  });

  it("leaves number keys to a focused text field outside the dialogue", async () => {
    const { onAnswerPrompt } = renderPrompt();
    const input = document.body.appendChild(document.createElement("input"));
    input.focus();

    await fireEvent.keyDown(window, { key: "1" });

    expect(onAnswerPrompt).not.toHaveBeenCalled();
    input.remove();
  });

  it("returns focus to the first option when LOG closes on a prompt", async () => {
    renderPrompt();

    await fireEvent.keyDown(window, { key: "l" });
    await fireEvent.keyDown(window, { key: "l" });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /摘要合併了時間/ }),
      ).toHaveFocus(),
    );
  });

  it("shows the reply to a wrong pick", () => {
    renderPrompt({
      promptFeedback: { speaker: "早坂茜", text: "他的小謊和這段時間無關。" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "早坂茜他的小謊和這段時間無關。",
    );
  });

  it("ignores picks while a command is in flight", async () => {
    const user = userEvent.setup();
    const { onAnswerPrompt } = renderPrompt({ disabled: true });
    await user.click(screen.getByRole("button", { name: /摘要合併了時間/ }));
    expect(onAnswerPrompt).not.toHaveBeenCalled();
  });
});
