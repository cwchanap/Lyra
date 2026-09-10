import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  buildAiReviewTransportPayload,
  type AiReviewProviderRequest,
} from "./ai-review";
import { tauriAiReviewProvider } from "./ai-review-provider";

const mockInvoke = vi.mocked(invoke);

const request: AiReviewProviderRequest = {
  lens: "dialogue",
  selectedSourceRef:
    "docs/stories_plan/chapter_1/scene_2.md#reader:dialogue:intro:0",
  selectedText: "相馬律：先不要急著判斷。",
  context: [
    {
      ref: "voice-soma",
      sourceRef: "docs/stories_plan/characters.md#相馬律",
      kind: "characterVoice",
      content: "台詞風格：結論偏短。",
    },
  ],
  missingContext: [],
  replacementTargetRef: "reader:dialogue:intro:0",
};

describe("tauriAiReviewProvider", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("sends the TS-built transport payload to run_ai_review unchanged", async () => {
    mockInvoke.mockResolvedValueOnce({ noChange: true });
    const result = await tauriAiReviewProvider(request);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("run_ai_review", {
      payload: buildAiReviewTransportPayload(request),
    });
    expect(result).toEqual({ noChange: true });
  });

  it("propagates native provider errors untouched", async () => {
    mockInvoke.mockRejectedValueOnce({
      code: "aiProviderConfigMissing",
      message: "AI review agent CLI not found: claude",
    });
    await expect(tauriAiReviewProvider(request)).rejects.toMatchObject({
      code: "aiProviderConfigMissing",
    });
  });
});
