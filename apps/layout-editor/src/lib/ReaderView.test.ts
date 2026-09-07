// @vitest-environment jsdom

// HPA-135 Task 4: ReaderView edit affordances. The view emits (ref, item)
// selections only — every source I/O and draft decision lives behind
// openFocusedEdit, which the view never touches.

import { render, screen, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { NO_NEW_FINDINGS_DIALOGUE } from "@lyra/scripts/compile-scenes/semantic-defaults";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import ReaderView from "./ReaderView.svelte";
import type {
  ReaderEditableRef,
  ReaderGroup,
  ReaderItem,
  ReaderScene,
} from "./workbench-types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const ref = (carrierId: string, itemIndex: number): ReaderEditableRef => ({
  carrierId,
  itemIndex,
});

const line = (
  speaker: string,
  text: string,
  itemRef: ReaderEditableRef,
): ReaderItem => ({ kind: "line", speaker, text, editable: itemRef });

const action = (text: string, itemRef: ReaderEditableRef): ReaderItem => ({
  kind: "action",
  text,
  editable: itemRef,
});

const multilineAction = (
  text: string,
  itemRef: ReaderEditableRef,
): ReaderItem => ({ kind: "action", text, editable: itemRef, multiline: true });

const sceneTag = (text: string): ReaderItem => ({ kind: "sceneTag", text });

const notice = (text: string): ReaderItem => ({
  kind: "notice",
  noticeKind: "reveal",
  text,
});

function group(
  id: string,
  items: ReaderItem[],
  children: ReaderGroup[] = [],
): ReaderGroup {
  return {
    id,
    kind: "topic",
    label: id,
    flow: "main",
    sourceAnchor: `#${id}`,
    items,
    children,
  };
}

function fixtureScene(overrides: Partial<ReaderScene> = {}): ReaderScene {
  return {
    id: "interrogation_scene_2",
    type: "interrogation",
    title: "Night Inquiry",
    sourcePath: "docs/stories_plan/chapter_1/interrogation_scene_2.md",
    presentation: [],
    groups: [
      group("intro", [
        sceneTag("場景：偵訊室"),
        line("相馬律", "intro line", ref("intro", 1)),
      ]),
      group(
        "phase:phase1",
        [notice("Reveals question: q2")],
        [
          group("question:q1:onLoop", [
            line("證人", "on loop line", ref("question:q1:onLoop", 0)),
          ]),
          group("question:q1:defaultChallenge", [
            action("slams the folder", ref("question:q1:defaultChallenge", 0)),
          ]),
          group("evidence:cctv:onReexamine", [
            // Compiler-synthesized default re-examination fallback.
            action(
              NO_NEW_FINDINGS_DIALOGUE[0]!.text,
              ref("evidence:cctv:onReexamine", 0),
            ),
          ]),
        ],
      ),
    ],
    ...overrides,
  };
}

describe("ReaderView edit affordances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Edit for resolved dialogue lines and emits the selection only", async () => {
    const onEditItem = vi.fn();
    const user = userEvent.setup();
    render(ReaderView, { scene: fixtureScene(), onEditItem });

    const intro = screen.getByText("相馬律: intro line").closest("li")!;
    await user.click(within(intro).getByRole("button", { name: "Edit" }));

    expect(onEditItem).toHaveBeenCalledExactlyOnceWith(
      { carrierId: "intro", itemIndex: 1 },
      {
        kind: "line",
        speaker: "相馬律",
        text: "intro line",
        editable: { carrierId: "intro", itemIndex: 1 },
      },
    );
    // Selection only: the view never performs source I/O itself.
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("renders Edit for single-line actions", async () => {
    const onEditItem = vi.fn();
    const user = userEvent.setup();
    render(ReaderView, { scene: fixtureScene(), onEditItem });

    const row = screen.getByText("slams the folder").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Edit" }));

    expect(onEditItem).toHaveBeenCalledExactlyOnceWith(
      { carrierId: "question:q1:defaultChallenge", itemIndex: 0 },
      expect.objectContaining({ kind: "action", text: "slams the folder" }),
    );
  });

  it("renders no Edit for multiline actions (read-only in v1)", async () => {
    const onEditItem = vi.fn();
    const user = userEvent.setup();
    render(ReaderView, {
      scene: fixtureScene({
        groups: [
          group("main", [
            multilineAction("雨聲漸強， 打濕了窗台。", ref("main", 0)),
            action("slams the folder", ref("main", 1)),
          ]),
        ],
      }),
      onEditItem,
    });

    const row = screen.getByText("雨聲漸強， 打濕了窗台。").closest("li")!;
    expect(within(row).queryByRole("button", { name: "Edit" })).toBeNull();
    // The single-line action beside it stays editable.
    const sibling = screen.getByText("slams the folder").closest("li")!;
    await user.click(within(sibling).getByRole("button", { name: "Edit" }));
    expect(onEditItem).toHaveBeenCalledExactlyOnceWith(
      { carrierId: "main", itemIndex: 1 },
      expect.objectContaining({ kind: "action" }),
    );
  });

  it("renders no Edit for compiler-synthesized default re-examination", () => {
    const onEditItem = vi.fn();
    render(ReaderView, { scene: fixtureScene(), onEditItem });

    const row = screen
      .getByText(NO_NEW_FINDINGS_DIALOGUE[0]!.text)
      .closest("li")!;
    expect(within(row).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("renders no Edit for sceneTag and notice items", () => {
    const onEditItem = vi.fn();
    render(ReaderView, { scene: fixtureScene(), onEditItem });

    const tagRow = screen.getByText("場景：偵訊室").closest("li")!;
    expect(within(tagRow).queryByRole("button", { name: "Edit" })).toBeNull();
    const noticeRow = screen.getByText("Reveals question: q2").closest("li")!;
    expect(
      within(noticeRow).queryByRole("button", { name: "Edit" }),
    ).toBeNull();
  });

  it("renders no Edit at all in Analysis scenes (outside the edit seam)", () => {
    const onEditItem = vi.fn();
    render(ReaderView, {
      scene: fixtureScene({
        id: "analysis_scene_8_5",
        type: "analysis",
        title: "Analysis",
      }),
      onEditItem,
    });

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
