// @vitest-environment jsdom

// HPA-136 Task 3: AiReviewPanel is presentation/request-lifecycle only. A fake
// provider drives every case; the panel performs no Tauri I/O and no store
// access, so the only seams under test are props in, request out.

import { render, screen, waitFor, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AiReviewPanel from "./AiReviewPanel.svelte";
import type {
  AiReviewLens,
  AiReviewProviderRequest,
  AiReviewResult,
} from "./ai-review";
import type { AiReviewContextBundle } from "./ai-review-context";

const SELECTED_SOURCE_REF =
  "docs/stories_plan/chapter_1/scene_2.md#reader:dialogue:main:1";

const BUNDLE: AiReviewContextBundle = {
  selectedSourceRef: SELECTED_SOURCE_REF,
  selectedText: "相馬律：先不要急著判斷。",
  replacementTargetRef: "reader:dialogue:main:1",
  context: [
    {
      ref: "selection",
      kind: "selection",
      label: "選取內容",
      sourceRef: SELECTED_SOURCE_REF,
      content: "相馬律：先不要急著判斷。",
      approxChars: 12,
      required: true,
    },
    {
      ref: "characterVoice",
      kind: "characterVoice",
      label: "角色聲音 相馬律",
      sourceRef: "docs/stories_plan/characters.md#相馬律主角",
      content: "台詞風格：結論偏短。",
      approxChars: 10,
      required: false,
    },
    {
      ref: "chapterPlan",
      kind: "chapterPlan",
      label: "章節計畫 Beat 2",
      sourceRef: "docs/stories_plan/chapter_1_plan.md#beat-2",
      content: "# Beat 2：委託與程序入口",
      approxChars: 30,
      required: false,
    },
  ],
  missingContext: [
    {
      kind: "revealBoundary",
      label: "青葉揭示邊界 第 1 章",
      reason: "§18.5 必須恰好有一個「第 1 章」列，實際 0 個。",
    },
  ],
};

const FINDINGS_RESULT: AiReviewResult = {
  lens: "dialogue",
  reviewedSourceRefs: [SELECTED_SOURCE_REF],
  findings: [
    {
      severity: "Important",
      summary: "語氣與角色設定不一致",
      explanation: "台詞風格要求結論偏短，但選取句子迂迴。",
      supportingSourceRefs: ["docs/stories_plan/characters.md#相馬律主角"],
    },
  ],
  uncertainty: [],
  impact: null,
  replacement: null,
  noChange: false,
};

/** Echoes the request's lens and cites a known ref, passing local validation. */
function okProvider(resultOverrides: Partial<AiReviewResult> = {}) {
  return vi.fn(async (request: AiReviewProviderRequest) => {
    const candidate: AiReviewResult = {
      lens: request.lens,
      reviewedSourceRefs: [request.selectedSourceRef],
      findings: [
        {
          severity: "Minor",
          summary: "s",
          explanation: "e",
          supportingSourceRefs: [request.selectedSourceRef],
        },
      ],
      uncertainty: [],
      impact: null,
      replacement: null,
      noChange: false,
      ...resultOverrides,
    };
    return candidate;
  });
}

type PanelProps = {
  selectionLabel: string;
  lenses: AiReviewLens[];
  initialLens: AiReviewLens;
  context: AiReviewContextBundle;
  rebuildContext: (lens: AiReviewLens) => AiReviewContextBundle;
  provider: (request: AiReviewProviderRequest) => Promise<unknown>;
  onReviewReplacement?: (replacementText: string) => void;
  onClose: () => void;
};

/** Story-consistency lens omits the dialogue-only voice chip. */
function rebuildForLens(lens: AiReviewLens): AiReviewContextBundle {
  if (lens === "storyConsistency") {
    return {
      ...BUNDLE,
      context: BUNDLE.context.filter((item) => item.ref !== "characterVoice"),
    };
  }
  return BUNDLE;
}

function panelProps(
  overrides: Partial<PanelProps> = {},
): PanelProps & { onClose: () => void } {
  return {
    selectionLabel: "相馬律：先不要急著判斷。",
    lenses: ["storyConsistency", "dialogue"],
    initialLens: "dialogue",
    context: BUNDLE,
    rebuildContext: rebuildForLens,
    provider: okProvider(),
    onClose: vi.fn(),
    ...overrides,
  };
}

async function runReview(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Run review" }));
}

function chipList(): HTMLElement {
  return screen.getByLabelText("Context chips");
}

describe("AiReviewPanel lifecycle", () => {
  it("the required selected-source chip cannot be removed", async () => {
    render(AiReviewPanel, { props: panelProps() });
    const chips = chipList();
    const selectionChip = within(chips)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("選取內容"))!;
    expect(
      within(selectionChip).queryByRole("button", { name: "Remove" }),
    ).toBeNull();
    // Supporting chips stay removable.
    const voiceChip = within(chips)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("角色聲音"))!;
    expect(
      within(voiceChip).getByRole("button", { name: "Remove" }),
    ).toBeInTheDocument();
  });

  it("a supporting chip exposes its full outgoing content; removal hides it", async () => {
    const user = userEvent.setup();
    render(AiReviewPanel, { props: panelProps() });

    // The exact outgoing text is rendered inside the chip's expandable block.
    const chips = chipList();
    const voiceChip = within(chips)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("角色聲音"))!;
    expect(
      within(voiceChip).getByText("台詞風格：結論偏短。"),
    ).toBeInTheDocument();

    await user.click(within(voiceChip).getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("台詞風格：結論偏短。")).not.toBeInTheDocument();
  });

  it("supporting chip removal changes the provider request", async () => {
    const provider = okProvider();
    const user = userEvent.setup();
    render(AiReviewPanel, { props: panelProps({ provider }) });

    const chips = chipList();
    const voiceChip = within(chips)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("角色聲音"))!;
    await user.click(within(voiceChip).getByRole("button", { name: "Remove" }));
    await runReview();

    expect(provider).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        context: expect.arrayContaining([
          expect.not.objectContaining({ ref: "characterVoice" }),
        ]),
      }),
    );
    const request = provider.mock.calls[0]![0] as AiReviewProviderRequest;
    expect(request.context.map((item) => item.ref)).not.toContain(
      "characterVoice",
    );
  });

  it("offers only the allowed lenses for the selection kind", async () => {
    render(AiReviewPanel, { props: panelProps() });
    const group = screen.getByRole("group", { name: "Review lens" });
    const labels = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual(["Story consistency", "Dialogue"]);

    // Prompt refinement is not offered for reader item selections.
    const promptOnly = panelProps({ lenses: ["promptRefinement"] });
    render(AiReviewPanel, { props: promptOnly });
    const second = screen.getAllByRole("group", {
      name: "Review lens",
    })[1]!;
    expect(
      within(second)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Prompt refinement"]);
  });

  it("makes no provider call before Run", () => {
    const provider = okProvider();
    render(AiReviewPanel, { props: panelProps({ provider }) });
    expect(provider).not.toHaveBeenCalled();
  });

  it("Run calls the provider exactly once and renders findings", async () => {
    const provider = okProvider(FINDINGS_RESULT);
    render(AiReviewPanel, { props: panelProps({ provider }) });
    await runReview();

    expect(provider).toHaveBeenCalledTimes(1);
    const finding = await screen.findByLabelText("AI review findings");
    const article = within(finding).getByRole("article");
    expect(article).toHaveAttribute("data-severity", "Important");
    expect(
      within(article).getByText("語氣與角色設定不一致"),
    ).toBeInTheDocument();
    expect(
      within(article).getByText(/台詞風格要求結論偏短/u),
    ).toBeInTheDocument();
    expect(
      within(article).getByText(/characters\.md#相馬律主角/u),
    ).toBeInTheDocument();
  });

  it("the provider request contains the currently selected lens", async () => {
    const provider = okProvider();
    const user = userEvent.setup();
    render(AiReviewPanel, {
      props: panelProps({ provider, initialLens: "dialogue" }),
    });

    const group = screen.getByRole("group", { name: "Review lens" });
    await user.click(
      within(group).getByRole("button", { name: "Story consistency" }),
    );
    await runReview();

    expect(provider).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ lens: "storyConsistency" }),
    );
  });

  it("renders an explicit no-change result", async () => {
    const provider = okProvider({
      findings: [],
      noChange: true,
    });
    render(AiReviewPanel, { props: panelProps({ provider }) });
    await runReview();
    expect(await screen.findByText(/No findings/u)).toBeInTheDocument();
  });

  it("renders missing context before Run and sends it in the request", async () => {
    const provider = okProvider();
    render(AiReviewPanel, { props: panelProps({ provider }) });

    // Visible before Run.
    const missing = screen.getByLabelText("Missing context");
    expect(missing).toHaveTextContent("青葉揭示邊界 第 1 章");
    expect(missing).toHaveTextContent(/必須恰好有一個「第 1 章」列/u);
    expect(provider).not.toHaveBeenCalled();

    await runReview();
    expect(provider).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        missingContext: [
          {
            kind: "revealBoundary",
            label: "青葉揭示邊界 第 1 章",
            reason: "§18.5 必須恰好有一個「第 1 章」列，實際 0 個。",
          },
        ],
      }),
    );
  });

  it("renders provider failure kinds as distinct failure text", async () => {
    async function runAndAssert(
      provider: (request: AiReviewProviderRequest) => Promise<unknown>,
      expected: RegExp,
    ): Promise<void> {
      const mounted = render(AiReviewPanel, {
        props: panelProps({ provider }),
      });
      await runReview();
      expect(await screen.findByText(expected)).toBeInTheDocument();
      mounted.unmount();
    }

    // Config missing.
    await runAndAssert(
      vi.fn(async () => {
        throw { code: "aiProviderConfigMissing", message: "no key" };
      }),
      /AI review is not configured/u,
    );

    // Config missing surfaces the native message (e.g. non-executable CLI
    // is not "missing").
    await runAndAssert(
      vi.fn(async () => {
        throw {
          code: "aiProviderConfigMissing",
          message: "AI review agent CLI is not executable: claude",
        };
      }),
      /not executable: claude/u,
    );

    // Truncation.
    await runAndAssert(
      vi.fn(async () => {
        throw { code: "aiProviderResponseTruncated", message: "too long" };
      }),
      /truncated/u,
    );

    // Request failure keeps the native message.
    await runAndAssert(
      vi.fn(async () => {
        throw { code: "aiProviderRequestFailed", message: "HTTP 503" };
      }),
      /AI review request failed: HTTP 503/u,
    );

    // Invalid provider response.
    await runAndAssert(
      vi.fn(async () => {
        throw { code: "aiProviderInvalidResponse", message: "not JSON" };
      }),
      /unusable response: not JSON/u,
    );
  });

  it("a locally invalid result renders the validator reason and no replacement action", async () => {
    // Replacement cited for a findings-only request must fail validation.
    const provider = okProvider({
      replacement: {
        targetRef: "reader:dialogue:main:1",
        replacementText: "x",
        rationale: "r",
      },
    });
    render(AiReviewPanel, {
      props: panelProps({
        provider,
        context: {
          ...BUNDLE,
          replacementTargetRef: null,
        },
      }),
    });
    await runReview();

    expect(await screen.findByText(/不開放替換/u)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use replacement" }),
    ).toBeNull();
  });

  it("a valid replacement renders and hands off its text exactly once", async () => {
    const onReviewReplacement = vi.fn();
    const provider = okProvider({
      replacement: {
        targetRef: "reader:dialogue:main:1",
        replacementText: "先別急著下判斷。",
        rationale: "更貼近角色語氣。",
      },
    });
    const user = userEvent.setup();
    render(AiReviewPanel, {
      props: panelProps({ provider, onReviewReplacement }),
    });
    await runReview();

    await user.click(
      await screen.findByRole("button", { name: "Use replacement" }),
    );
    expect(onReviewReplacement).toHaveBeenCalledExactlyOnceWith(
      "先別急著下判斷。",
    );
  });

  it("Cancel fences a late fake response", async () => {
    let resolveLate!: (candidate: unknown) => void;
    const provider = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveLate = resolve;
        }),
    );
    const user = userEvent.setup();
    render(AiReviewPanel, { props: panelProps({ provider }) });

    await runReview();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("status")).toHaveTextContent("Canceled");

    // The stale response lands after Cancel: no result may render.
    resolveLate(FINDINGS_RESULT);
    await waitFor(() =>
      expect(
        screen.queryByLabelText("AI review findings"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Canceled");
  });

  it("removing a chip after a review clears the stale result", async () => {
    const provider = okProvider();
    const user = userEvent.setup();
    render(AiReviewPanel, { props: panelProps({ provider }) });
    await runReview();
    expect(
      await screen.findByLabelText("AI review findings"),
    ).toBeInTheDocument();

    const chips = chipList();
    const voiceChip = within(chips)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("角色聲音"))!;
    await user.click(within(voiceChip).getByRole("button", { name: "Remove" }));

    // The displayed result was produced with the removed chip's content, so
    // it must not remain actionable.
    expect(
      screen.queryByLabelText("AI review findings"),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".ai-review-panel")).toHaveAttribute(
      "data-state",
      "ready",
    );
  });

  it("changing lens rebuilds lens-appropriate context and clears the old result", async () => {
    const provider = okProvider();
    const user = userEvent.setup();
    render(AiReviewPanel, { props: panelProps({ provider }) });
    await runReview();
    expect(
      await screen.findByLabelText("AI review findings"),
    ).toBeInTheDocument();

    // The dialogue lens carries the voice chip; storyConsistency does not.
    const chips = chipList();
    const voiceChip = within(chips)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("角色聲音"))!;
    await user.click(within(voiceChip).getByRole("button", { name: "Remove" }));
    expect(
      within(chipList())
        .getAllByRole("listitem")
        .filter((item) => item.textContent?.includes("角色聲音")),
    ).toHaveLength(0);

    const group = screen.getByRole("group", { name: "Review lens" });
    await user.click(
      within(group).getByRole("button", { name: "Story consistency" }),
    );

    // Story-consistency context omits the dialogue-only voice chip.
    expect(
      within(chipList())
        .getAllByRole("listitem")
        .filter((item) => item.textContent?.includes("角色聲音")),
    ).toHaveLength(0);
    expect(
      screen.queryByLabelText("AI review findings"),
    ).not.toBeInTheDocument();

    // The next Run carries the new lens and the lens-appropriate context.
    await runReview();
    expect(provider).toHaveBeenCalledTimes(2);
    const request = provider.mock.calls[1]![0] as AiReviewProviderRequest;
    expect(request.lens).toBe("storyConsistency");
    expect(request.context.map((item) => item.ref)).not.toContain(
      "characterVoice",
    );
  });

  it("Close calls onClose; the panel never performs Tauri or store I/O", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(AiReviewPanel, { props: panelProps({ onClose }) });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
