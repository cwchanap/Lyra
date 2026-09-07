// @vitest-environment jsdom

// HPA-135 Task 4: the ONE shared review surface. Renders every review state,
// the exact one-hunk diff, impact, and stale/validation diagnostics; Apply,
// Cancel, and replacement input are pure callbacks — the component performs
// no I/O itself.

import { render, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import FocusedEditReview from "./FocusedEditReview.svelte";
import type { ComponentProps } from "svelte";
import type {
  FocusedEditDraft,
  FocusedEditDiffHunk,
  WorkbenchValidationReport,
} from "./focused-edit";

const sceneDraft: FocusedEditDraft = {
  sourceDocumentId: "scene:chapter_1:scene_t",
  sourcePath: "docs/stories_plan/chapter_1/scene_t.md",
  expectedHash: "hash-1",
  semanticRef: "reader:dialogue:main:1",
  kind: "readerDialogue",
  expectedLine: 5,
  originalText: "原文台詞。",
  replacementText: "替換台詞。",
  nextContent: "next",
  impact: { scope: "scene", chapterId: "chapter_1", sceneId: "scene_t" },
};

const sharedAssetDraft: FocusedEditDraft = {
  ...sceneDraft,
  semanticRef: "asset:evidence:receipt:imagePrompt",
  kind: "evidenceImagePrompt",
  impact: {
    scope: "asset",
    assetId: "evidence.receipt",
    scenes: [
      { chapterId: "chapter_1", sceneId: "scene_a" },
      { chapterId: "chapter_1", sceneId: "scene_b" },
    ],
    usages: 2,
    shared: true,
  },
};

const hunk: FocusedEditDiffHunk = {
  oldStart: 3,
  oldLines: 3,
  newStart: 3,
  newLines: 3,
  lines: [
    { kind: "context", text: "前一行" },
    { kind: "del", text: "**相馬律**：原文台詞。" },
    { kind: "add", text: "**相馬律**：替換台詞。" },
    { kind: "context", text: "後一行" },
  ],
};

const failedValidation: WorkbenchValidationReport = {
  ok: false,
  diagnostics: [
    { code: "sourceEditValidationFailed", message: "compile exploded" },
  ],
};

type RenderProps = ComponentProps<typeof FocusedEditReview>;

function renderReview(overrides: Partial<RenderProps> = {}) {
  const onReplacementChange = vi.fn();
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const { container } = render(FocusedEditReview, {
    state: "editing",
    sourcePath: sceneDraft.sourcePath,
    draft: sceneDraft,
    hunk,
    diagnostic: null,
    error: null,
    validation: null,
    replacement: "",
    onReplacementChange,
    onApply,
    onCancel,
    ...overrides,
  });
  return {
    container,
    onReplacementChange,
    onApply,
    onCancel,
    // Scope to the container: some tests render a second instance.
    review: within(container).getByRole("region", {
      name: "Focused edit review",
    }),
  };
}

describe("FocusedEditReview", () => {
  it("renders the review identity, current text, and the exact unified hunk", () => {
    const { review } = renderReview();

    expect(
      within(review).getByText("docs/stories_plan/chapter_1/scene_t.md"),
    ).toBeInTheDocument();
    expect(
      within(review).getByText("reader:dialogue:main:1"),
    ).toBeInTheDocument();
    expect(within(review).getByText("原文台詞。")).toBeInTheDocument();
    expect(within(review).getByText("@@ -3,3 +3,3 @@")).toBeInTheDocument();
    expect(review.querySelector('[data-diff-kind="del"]')).toHaveTextContent(
      "**相馬律**：原文台詞。",
    );
    expect(review.querySelector('[data-diff-kind="add"]')).toHaveTextContent(
      "**相馬律**：替換台詞。",
    );
    expect(review.querySelectorAll('[data-diff-kind="context"]')).toHaveLength(
      2,
    );
    // Line separation: the header and every hunk row render on their own
    // visual line (real newlines inside the pre) — exact textContent fails
    // if the rows ever render contiguously.
    expect(review.querySelector("[data-diff]")!.textContent).toBe(
      "@@ -3,3 +3,3 @@\n  前一行\n- **相馬律**：原文台詞。\n+ **相馬律**：替換台詞。\n  後一行\n",
    );
  });

  it("shows scene impact and shared-asset impact with a warning", () => {
    const { review } = renderReview();
    const sceneImpact = review.querySelector("[data-impact]")!;
    expect(sceneImpact.getAttribute("data-impact-scope")).toBe("scene");
    expect(sceneImpact).toHaveTextContent("Scene chapter_1 / scene_t");

    const shared = renderReview({
      draft: sharedAssetDraft,
    });
    const assetImpact = shared.review.querySelector("[data-impact]")!;
    expect(assetImpact.getAttribute("data-impact-scope")).toBe("asset");
    expect(assetImpact).toHaveTextContent("Asset evidence.receipt");
    expect(assetImpact).toHaveTextContent("2 usages across 2 scenes");
    expect(assetImpact).toHaveTextContent("shared across scenes");
  });

  it("wires replacement input, Apply, and Cancel as callbacks", async () => {
    const user = userEvent.setup();
    const { review, onReplacementChange, onApply, onCancel } = renderReview();

    const textarea = within(review).getByLabelText("Replacement text");
    await user.type(textarea, "x");
    expect(onReplacementChange).toHaveBeenCalledWith("x");

    await user.click(within(review).getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);

    await user.click(within(review).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables Apply while applying and disables it without a draft", () => {
    const { review: applying } = renderReview({ state: "applying" });
    expect(
      within(applying).getByRole("button", { name: "Applying…" }),
    ).toBeDisabled();

    const { review: draftless } = renderReview({ draft: null, hunk: null });
    expect(
      within(draftless).getByRole("button", { name: "Apply" }),
    ).toBeDisabled();
  });

  it("renders the loading-source state", () => {
    const { review } = renderReview({
      state: "loading-source",
      draft: null,
      hunk: null,
      sourcePath: null,
    });
    expect(
      within(review).getByText("Loading source document…"),
    ).toBeInTheDocument();
  });

  it("renders the stale/no-change diagnostic loudly and keeps Apply disabled", () => {
    const { review } = renderReview({
      draft: null,
      hunk: null,
      diagnostic: {
        code: "focusedEditCompiledSourceStale",
        message: "Authored source no longer parses against the compiled scene.",
        sourceFile: "",
        line: 0,
      },
    });

    const alert = review.querySelector(
      '[data-diagnostic-code="focusedEditCompiledSourceStale"]',
    )!;
    expect(alert).toHaveTextContent(
      "focusedEditCompiledSourceStale: Authored source no longer parses against the compiled scene.",
    );
    expect(
      within(review).getByRole("button", { name: "Apply" }),
    ).toBeDisabled();
  });

  it("renders the applied-valid confirmation", () => {
    const { review } = renderReview({ state: "applied-valid" });
    expect(review.getAttribute("data-state")).toBe("applied-valid");
    expect(review.querySelector("[data-applied-valid]")).toHaveTextContent(
      "Applied — scenes:compile passed",
    );
  });

  it("renders applied-invalid with validation diagnostics and no fake freshness", () => {
    const { review } = renderReview({
      state: "applied-invalid",
      validation: failedValidation,
    });

    expect(review.getAttribute("data-state")).toBe("applied-invalid");
    const failed = review.querySelector("[data-validation-failed]")!;
    expect(failed).toHaveTextContent(
      "The source edit stays written and Reader/Assets projections were not refreshed",
    );
    expect(
      failed.querySelector(
        '[data-validation-code="sourceEditValidationFailed"]',
      ),
    ).toHaveTextContent("sourceEditValidationFailed: compile exploded");
    // Applied-invalid is not success: no applied-valid confirmation exists.
    expect(review.querySelector("[data-applied-valid]")).toBeNull();
  });

  it("renders the timeout validation code in the applied-invalid state", () => {
    const { review } = renderReview({
      state: "applied-invalid",
      validation: {
        ok: false,
        diagnostics: [
          {
            code: "sourceEditValidationTimeout",
            message: "scenes:compile exceeded 120s and was killed",
          },
        ],
      },
    });

    expect(review.getAttribute("data-state")).toBe("applied-invalid");
    expect(
      review.querySelector(
        '[data-validation-code="sourceEditValidationTimeout"]',
      ),
    ).toHaveTextContent("scenes:compile exceeded 120s and was killed");
  });

  it("renders top-level apply/load errors with a Close action", async () => {
    const user = userEvent.setup();
    const { review, onCancel } = renderReview({
      state: "error",
      draft: null,
      hunk: null,
      error: "source changed since it was loaded; refresh and retry",
    });

    const alert = review.querySelector("[data-review-error]")!;
    expect(alert).toHaveTextContent(
      "source changed since it was loaded; refresh and retry",
    );
    await user.click(within(review).getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
