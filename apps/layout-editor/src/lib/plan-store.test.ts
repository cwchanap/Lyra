// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  planState,
  refreshPlan,
  selectPlanDocument,
  selectPlanHeading,
} from "./plan-store.svelte";
import type {
  WorkbenchPlanDocument,
  WorkbenchPlanWorkspacePayload,
} from "./workbench-types";

const mockInvoke = vi.mocked(invoke);

const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";

function storyBible(content: string): WorkbenchPlanDocument {
  return {
    id: "story-bible",
    kind: "storyBible",
    path: BIBLE_PATH,
    content,
    chapterNumber: null,
  };
}

function chapterPlan(chapter: number, content: string): WorkbenchPlanDocument {
  return {
    id: `chapter-${chapter}-plan`,
    kind: "chapterPlan",
    path: `docs/stories_plan/chapter_${chapter}_plan.md`,
    content,
    chapterNumber: chapter,
  };
}

function resetPlanState(): void {
  planState.workspace = null;
  planState.error = null;
  planState.loading = false;
  planState.surface = "overview";
  planState.selectedDocumentId = "story-bible";
  planState.selectedAnchor = null;
}

describe("plan-store", () => {
  beforeEach(() => {
    resetPlanState();
    vi.clearAllMocks();
  });

  it("two overlapping refreshes keep the newer result", async () => {
    const resolvers: Array<(payload: WorkbenchPlanWorkspacePayload) => void> =
      [];
    mockInvoke.mockImplementation(
      async () =>
        new Promise<WorkbenchPlanWorkspacePayload>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const first = refreshPlan();
    const second = refreshPlan();

    // Newer generation resolves first; the older one must not overwrite it.
    resolvers[1]!({ documents: [storyBible("## newer marker\n")] });
    await second;
    resolvers[0]!({ documents: [storyBible("## older marker\n")] });
    await first;

    expect(planState.loading).toBe(false);
    expect(planState.error).toBeNull();
    expect(
      planState.workspace?.documents[0]?.headings.map(
        (heading) => heading.text,
      ),
    ).toEqual(["newer marker"]);
  });

  it("valid selected document/anchor survives refresh, invalid selection falls back to story-bible/no anchor", async () => {
    mockInvoke.mockResolvedValueOnce({
      documents: [
        storyBible("## shared heading\n"),
        chapterPlan(1, "## chapter heading\n"),
      ],
    });
    await refreshPlan();

    selectPlanDocument("chapter-1-plan");
    selectPlanHeading("chapter-1-plan", "chapter-heading");
    expect(planState.surface).toBe("document");

    // Selection still exists in the refreshed workspace -> preserved.
    mockInvoke.mockResolvedValueOnce({
      documents: [
        storyBible("## shared heading\n\nmore prose\n"),
        chapterPlan(1, "## chapter heading\n\nmore prose\n"),
      ],
    });
    await refreshPlan();
    expect(planState.selectedDocumentId).toBe("chapter-1-plan");
    expect(planState.selectedAnchor).toBe("chapter-heading");

    // The anchor no longer exists (document does) -> anchor dropped only.
    mockInvoke.mockResolvedValueOnce({
      documents: [
        storyBible("## shared heading\n"),
        chapterPlan(1, "## renamed heading\n"),
      ],
    });
    await refreshPlan();
    expect(planState.selectedDocumentId).toBe("chapter-1-plan");
    expect(planState.selectedAnchor).toBeNull();

    // The selected document no longer exists -> story-bible / no anchor.
    mockInvoke.mockResolvedValueOnce({
      documents: [storyBible("## shared heading\n")],
    });
    await refreshPlan();
    expect(planState.selectedDocumentId).toBe("story-bible");
    expect(planState.selectedAnchor).toBeNull();
  });
});
