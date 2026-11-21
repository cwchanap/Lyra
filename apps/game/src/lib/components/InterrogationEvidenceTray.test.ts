import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type { CrossExamView, Inventory } from "../state/types";
import {
  neutralCaseRecordProvenance,
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "../state/test-fixtures";
import * as storyAssets from "$lib/assets/story-assets";
import InterrogationEvidenceTray from "./InterrogationEvidenceTray.svelte";

const crossExam: CrossExamView = {
  questionId: "q_alibi",
  lineId: "line_1",
  lineLabel: "否認",
  lineContent: [
    { kind: "sceneTag", text: "雨聲。" },
    { kind: "action", text: "她移開視線。" },
    { kind: "line", speaker: "嫌疑人", text: "我沒去。" },
  ],
  lineIndex: 0,
  lineTotal: 3,
  presenting: true,
};

const coffeeReceipt = neutralEvidenceRecordView({
  id: "receipt",
  name: "咖啡收據",
  description: "十七點四十二分的消費紀錄。",
  details: "付款末四碼 0192。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "scene_1",
});
coffeeReceipt.provenance = {
  ...neutralCaseRecordProvenance(),
  sourceLabel: "店內收銀匯出",
};

const inventory: Inventory = {
  evidence: [coffeeReceipt],
  statements: [
    neutralStatementRecordView({
      id: "witness",
      speaker: "目擊者",
      content: "我看見她走進巷子。",
      onReexamine: null,
      acquiredInChapterId: "chapter_1",
      acquiredInSceneId: "scene_1",
    }),
  ],
};

function props(
  overrides: Partial<{
    inventory: Inventory;
    disabled: boolean;
    topLayerOpen: boolean;
    returnFocusTo: HTMLElement | null;
    fallbackFocusTarget: HTMLElement | null;
    crossExam: CrossExamView | null;
    presentTo: { name: string } | null;
    onPresent: (kind: "evidence" | "statement", itemId: string) => void;
    onResume: () => void;
    onOpenGameMenu: (trigger: HTMLElement) => void;
  }> = {},
) {
  return {
    crossExam:
      overrides.crossExam !== undefined ? overrides.crossExam : crossExam,
    presentTo: overrides.presentTo ?? null,
    inventory: overrides.inventory ?? inventory,
    disabled: overrides.disabled ?? false,
    topLayerOpen: overrides.topLayerOpen ?? false,
    returnFocusTo: overrides.returnFocusTo ?? null,
    fallbackFocusTarget: overrides.fallbackFocusTarget ?? null,
    onPresent: overrides.onPresent ?? vi.fn(),
    onResume: overrides.onResume ?? vi.fn(),
    onOpenGameMenu: overrides.onOpenGameMenu ?? vi.fn(),
  };
}

function searchInput() {
  return screen.getByRole("searchbox", { name: "搜尋紀錄" });
}

afterEach(() => {
  cleanup();
  resetEscapeCoordinator();
});

describe("InterrogationEvidenceTray", () => {
  it("excludes the transient Present scrim from save thumbnails", () => {
    const { container } = render(InterrogationEvidenceTray, props());

    const scrim = container.querySelector(".interrogation-tray-scrim");
    expect(scrim).not.toBeNull();
    expect(scrim).toHaveAttribute("data-save-thumbnail-exclude", "");
  });

  it("renders tile choices with a transient hover and focus detail panel", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());

    const grid = container.querySelector("[data-interrogation-evidence-grid]");
    expect(grid).not.toBeNull();

    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );
    expect(detail).not.toBeNull();
    expect(detail).toHaveTextContent(
      "將游標移至紀錄，或以 Tab 選取以查看詳情；在紀錄上按 ↓ 直接捲動詳情。",
    );

    const evidenceTile = screen.getByRole("button", {
      name: /咖啡收據.*店內收銀匯出/,
    });
    expect(evidenceTile).toHaveTextContent("咖啡收據");
    expect(evidenceTile).toHaveTextContent("店內收銀匯出");
    expect(evidenceTile).not.toHaveTextContent("十七點四十二分的消費紀錄。");
    expect(evidenceTile).not.toHaveTextContent("付款末四碼 0192。");

    await user.hover(evidenceTile);
    expect(detail).toHaveTextContent("十七點四十二分的消費紀錄。");
    expect(detail).toHaveTextContent("付款末四碼 0192。");

    evidenceTile.focus();
    expect(detail).toHaveTextContent("物證 / EVIDENCE");
    expect(detail).toHaveTextContent("店內收銀匯出");
  });

  it("keeps the focused detail after the pointer leaves another tile", async () => {
    const { container } = render(InterrogationEvidenceTray, props());
    const evidenceTile = screen.getByRole("button", {
      name: /咖啡收據.*店內收銀匯出/,
    });
    const statementTile = screen.getByRole("button", { name: /目擊者/ });
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ESC" })).toHaveFocus(),
    );
    evidenceTile.focus();
    await waitFor(() => expect(detail).toHaveTextContent("咖啡收據"));
    fireEvent.mouseEnter(statementTile);
    await waitFor(() => expect(detail).toHaveTextContent("目擊者"));
    fireEvent.mouseLeave(statementTile);
    await waitFor(() => expect(detail).toHaveTextContent("咖啡收據"));
  });

  it("shows the keyboard-selected record over a still-hovered tile", async () => {
    const { container } = render(InterrogationEvidenceTray, props());
    const evidenceTile = screen.getByRole("button", {
      name: /咖啡收據.*店內收銀匯出/,
    });
    const statementTile = screen.getByRole("button", { name: /目擊者/ });
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );

    fireEvent.mouseEnter(statementTile);
    await waitFor(() => expect(detail).toHaveTextContent("目擊者"));

    evidenceTile.focus();
    await waitFor(() => expect(detail).toHaveTextContent("咖啡收據"));
  });

  it("keeps the last inspected record visible after the pointer leaves", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );
    const evidenceTile = screen.getByRole("button", {
      name: /咖啡收據.*店內收銀匯出/,
    });

    await user.hover(evidenceTile);
    expect(detail).toHaveTextContent("十七點四十二分的消費紀錄。");

    await user.unhover(evidenceTile);
    expect(detail).toHaveTextContent("十七點四十二分的消費紀錄。");
    expect(detail).toHaveTextContent("付款末四碼 0192。");
  });

  it("keeps evidence and statement detail distinct when their ids collide", async () => {
    const user = userEvent.setup();
    const sharedId = "shared-record";
    const collisionInventory: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: sharedId,
          name: "同名物證",
          description: "物證詳情。",
          details: "物證補充。",
          imageAssetId: null,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [
        neutralStatementRecordView({
          id: sharedId,
          speaker: "同名證言",
          content: "證言詳情。",
          onReexamine: null,
          acquiredInChapterId: "chapter_1",
          acquiredInSceneId: "scene_1",
        }),
      ],
    };
    const { container } = render(
      InterrogationEvidenceTray,
      props({ inventory: collisionInventory }),
    );
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );
    const evidenceTile = screen.getByRole("button", { name: /同名物證/ });
    const statementTile = screen.getByRole("button", { name: /同名證言/ });

    await user.hover(evidenceTile);
    expect(detail).toHaveTextContent("物證詳情。");
    await user.unhover(evidenceTile);
    await user.hover(statementTile);
    expect(detail).toHaveTextContent("證言詳情。");
    expect(detail).not.toHaveTextContent("物證詳情。");
  });

  it("presents the mapped kind and id immediately and exposes the tray Escape button", async () => {
    const user = userEvent.setup();
    const onPresent = vi.fn();
    const onResume = vi.fn();
    render(InterrogationEvidenceTray, props({ onPresent, onResume }));

    await user.click(
      screen.getByRole("button", { name: /咖啡收據.*店內收銀匯出/ }),
    );
    expect(onPresent).toHaveBeenCalledWith("evidence", "receipt");

    const escape = screen.getByRole("button", { name: "ESC" });
    expect(escape).toHaveAttribute("data-interrogation-tray-escape");
    await user.click(escape);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("submits the selected evidence and statement against the live testimony line", async () => {
    const user = userEvent.setup();
    const onPresent = vi.fn();
    const { container } = render(
      InterrogationEvidenceTray,
      props({ onPresent }),
    );

    expect(
      container.querySelector("[data-interrogation-present-tray]"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "提出證據" })).toHaveTextContent(
      "她移開視線。我沒去。",
    );
    expect(
      container.querySelector("[data-interrogation-evidence-detail]"),
    ).toHaveTextContent(
      "將游標移至紀錄，或以 Tab 選取以查看詳情；在紀錄上按 ↓ 直接捲動詳情。",
    );

    await user.click(screen.getByRole("button", { name: /咖啡收據/ }));
    await user.click(screen.getByRole("button", { name: /目擊者/ }));

    expect(onPresent).toHaveBeenNthCalledWith(1, "evidence", "receipt");
    expect(onPresent).toHaveBeenNthCalledWith(2, "statement", "witness");
  });

  it("resumes the testimony from 收回 and its topmost Escape claim", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(InterrogationEvidenceTray, props({ onResume }));

    await user.click(screen.getByRole("button", { name: "收回" }));
    expect(onResume).toHaveBeenCalledTimes(1);

    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it("opens the game menu without resuming the active Present state", async () => {
    const user = userEvent.setup();
    const onOpenGameMenu = vi.fn();
    const onResume = vi.fn();
    render(InterrogationEvidenceTray, props({ onOpenGameMenu, onResume }));

    await user.click(screen.getByRole("button", { name: "遊戲選單" }));

    expect(onOpenGameMenu).toHaveBeenCalledOnce();
    expect(onOpenGameMenu).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
    expect(onResume).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "提出證據" }),
    ).toBeInTheDocument();
  });

  it("mounts the tray with an empty query and the record grid scrolled to the top", () => {
    // Regression guard: the tray is conditionally mounted, so a fresh SHOW /
    // PRESENT open must never inherit a previous query or scroll offset.
    const { container } = render(InterrogationEvidenceTray, props());

    expect(searchInput()).toHaveValue("");
    expect(
      container.querySelector("[data-interrogation-evidence-grid]")?.scrollTop,
    ).toBe(0);
  });

  it("announces result counts through a single polite status region", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("顯示 2 / 2");
    // Exactly one results-status live region: the count and the empty-state
    // hint must never be announced twice for one query change.
    expect(container.querySelectorAll("[role='status']")).toHaveLength(1);

    await user.type(searchInput(), "收據");
    expect(status).toHaveTextContent("顯示 1 / 2");

    await user.type(searchInput(), "不存在的字詞");
    expect(status).toHaveTextContent("顯示 0 / 2");
    // The visible empty-state hint stays a plain paragraph inside the grid —
    // reachable by screen-reader navigation, not a second live region.
    const emptyHint = screen.getByText("沒有符合的紀錄，請修改搜尋字詞");
    expect(emptyHint.closest("[role='status']")).toBeNull();
  });

  it("exposes a visible search cue through the input placeholder", () => {
    render(InterrogationEvidenceTray, props());

    expect(searchInput()).toHaveAttribute("placeholder", "搜尋紀錄");
  });

  it("filters records from the search input and shows the hit count", async () => {
    const user = userEvent.setup();
    render(InterrogationEvidenceTray, props());

    const dialog = screen.getByRole("dialog", { name: "提出證據" });
    expect(dialog).toHaveTextContent("顯示 2 / 2");

    await user.type(searchInput(), "收據");

    expect(
      screen.getByRole("button", { name: /咖啡收據/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /目擊者/ })).toBeNull();
    expect(dialog).toHaveTextContent("顯示 1 / 2");
  });

  it("filters records from the SHOW tray search input the same way", async () => {
    const user = userEvent.setup();
    render(
      InterrogationEvidenceTray,
      props({ crossExam: null, presentTo: { name: "遊丸" } }),
    );

    const dialog = screen.getByRole("dialog", { name: "出示紀錄" });
    expect(dialog).toHaveTextContent("顯示 2 / 2");

    await user.type(searchInput(), "目擊");

    expect(screen.queryByRole("button", { name: /咖啡收據/ })).toBeNull();
    expect(screen.getByRole("button", { name: /目擊者/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("顯示 1 / 2");
  });

  it("shows the empty-state hint when no record matches the query", async () => {
    const user = userEvent.setup();
    render(InterrogationEvidenceTray, props());

    await user.type(searchInput(), "不存在的字詞");

    expect(screen.queryByRole("button", { name: /咖啡收據/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /目擊者/ })).toBeNull();
    expect(
      screen.getByText("沒有符合的紀錄，請修改搜尋字詞"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "提出證據" })).toHaveTextContent(
      "顯示 0 / 2",
    );
  });

  it("keeps the record count in the header beside the search, not inside the record grid", () => {
    // The compact (max-height) layout pins the count into the header row
    // (h2 / search / count / ESC) per the 800×600 wireframe; the grid holds
    // tiles and the empty-state hint only. The count is not focusable, so
    // this move does not affect the Tab-order contract.
    render(InterrogationEvidenceTray, props());

    const count = screen.getByText(/顯示 \d+ \/ \d+/);
    expect(count.closest("header")).not.toBeNull();
    expect(count.closest("[data-interrogation-evidence-grid]")).toBeNull();
  });

  it("pins the single max-height compact budget for 800×600 readability", () => {
    // jsdom cannot evaluate media queries or resolve component styles at
    // runtime, so this pins the declared compact rules in the component
    // source — the same approach used by InterrogationView.test.ts and
    // AcquisitionPopup.test.ts for CSS jsdom cannot resolve.
    const source = readFileSync(
      join(
        process.cwd(),
        "src/lib/components/InterrogationEvidenceTray.svelte",
      ),
      "utf8",
    );
    expect(source.match(/@media \(max-height: 650px\)/g)?.length).toBe(1);
    const compact = source
      .slice(source.indexOf("@media (max-height: 650px)"))
      .replace(/\s+/g, " ");

    // Tray padding/gap budget reclaims ~60px at 800×600; the pinned height
    // keeps the centered tray — and the search input under it — from jumping
    // while filtering shrinks the grid contents.
    expect(compact).toContain(
      "height: min(760px, calc(100dvh - 48px)); padding: 14px; gap: 8px;",
    );
    // Header wraps and centers; the duplicate eyebrow is always hidden.
    expect(compact).toContain("header { flex-wrap: wrap; align-items: center;");
    expect(compact).toContain(".eyebrow { display: none;");
    // Tighter grid gap and no stretched lone row when 1–5 records match.
    expect(compact).toContain(".record-grid { gap: 8px; align-content: start;");
    // Tiles: 48px visual, tighter padding/gap, readable naturally wrapped titles.
    expect(compact).toContain(".record-visual { height: 48px;");
    expect(compact).toContain(".record-tile { gap: 6px; padding: 8px;");
    expect(compact).toContain(
      ".record-copy strong { font-size: 14px; line-height: 1.35;",
    );
    // Long testimony/detail scroll locally instead of swallowing the first
    // full card row.
    expect(compact).toContain(
      ".line-record { max-height: 112px; padding: 10px 12px; overflow-y: auto;",
    );
    expect(compact).toContain(".target-text { line-height: 1.5;");
    expect(compact).toContain(
      ".record-detail { max-height: 112px; min-height: 64px;",
    );
  });

  it("resets the record grid scroll to the top when the query changes", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());
    const grid = container.querySelector("[data-interrogation-evidence-grid]");

    // jsdom has no layout engine, so intercept scrollTop assignments on the
    // grid element to verify the input handler scrolls back to the top.
    const assignments: number[] = [];
    Object.defineProperty(grid, "scrollTop", {
      get: () => 120,
      set: (value: number) => assignments.push(value),
      configurable: true,
    });

    await user.type(searchInput(), "收據");

    expect(assignments.length).toBeGreaterThan(0);
    expect(assignments.every((value) => value === 0)).toBe(true);
  });

  it("clears a filtered-out record's hover detail when the query changes", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );
    const evidenceTile = screen.getByRole("button", {
      name: /咖啡收據.*店內收銀匯出/,
    });

    await user.hover(evidenceTile);
    expect(detail).toHaveTextContent("付款末四碼 0192。");

    await user.type(searchInput(), "目擊");

    expect(screen.queryByRole("button", { name: /咖啡收據/ })).toBeNull();
    expect(detail).not.toHaveTextContent("付款末四碼 0192。");
    expect(detail).toHaveTextContent(
      "將游標移至紀錄，或以 Tab 選取以查看詳情；在紀錄上按 ↓ 直接捲動詳情。",
    );

    // Bringing the record back must not resurrect the stale detail.
    await user.clear(searchInput());
    expect(
      screen.getByRole("button", { name: /咖啡收據.*店內收銀匯出/ }),
    ).toBeInTheDocument();
    expect(detail).toHaveTextContent(
      "將游標移至紀錄，或以 Tab 選取以查看詳情；在紀錄上按 ↓ 直接捲動詳情。",
    );
  });

  it("passes the original kind and id when clicking a record found via search", async () => {
    const user = userEvent.setup();
    const onPresent = vi.fn();
    const sharedId = "shared-record";
    const collisionInventory: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: sharedId,
          name: "同名物證",
          description: "物證詳情。",
          details: "物證補充。",
          imageAssetId: null,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [
        neutralStatementRecordView({
          id: sharedId,
          speaker: "同名證言",
          content: "證言詳情。",
          onReexamine: null,
          acquiredInChapterId: "chapter_1",
          acquiredInSceneId: "scene_1",
        }),
      ],
    };
    render(
      InterrogationEvidenceTray,
      props({ inventory: collisionInventory, onPresent }),
    );

    await user.type(searchInput(), "物證");
    await user.click(screen.getByRole("button", { name: /同名物證/ }));
    expect(onPresent).toHaveBeenCalledWith("evidence", sharedId);

    await user.clear(searchInput());
    await user.type(searchInput(), "證言");
    await user.click(screen.getByRole("button", { name: /同名證言/ }));
    expect(onPresent).toHaveBeenCalledWith("statement", sharedId);
  });

  it("traps tab focus among its active controls", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());

    const search = searchInput();
    const escape = screen.getByRole("button", { name: "ESC" });
    const lineRecord = container.querySelector(
      "[data-interrogation-line-record]",
    );
    const evidence = screen.getByRole("button", { name: /咖啡收據/ });
    const statement = screen.getByRole("button", { name: /目擊者/ });
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );
    const gameMenu = screen.getByRole("button", { name: "遊戲選單" });
    const withdraw = screen.getByRole("button", { name: "收回" });

    await waitFor(() => expect(escape).toHaveFocus());
    // The testimony blockquote is a focusable scrollable region: compact
    // max-height clips long lines, so it joins the trap between the header
    // controls and the record tiles.
    await user.tab();
    expect(lineRecord).toHaveFocus();
    await user.tab();
    expect(evidence).toHaveFocus();
    await user.tab();
    expect(statement).toHaveFocus();
    // The scrollable detail panel sits between the record tiles and the
    // footer actions so keyboard users can reach detail text that overflows
    // the compact max-height (the panel itself is keyboard-scrollable).
    await user.tab();
    expect(detail).toHaveFocus();
    await user.tab();
    expect(gameMenu).toHaveFocus();
    await user.tab();
    expect(withdraw).toHaveFocus();
    // The search input sits before ESC in DOM order, so Tab wraps from the
    // last button to the search input before returning to ESC.
    await user.tab();
    expect(search).toHaveFocus();
    await user.tab();
    expect(escape).toHaveFocus();
  });

  it("keeps the scrollable record detail keyboard-accessible for overflowing text", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());

    const detail = container.querySelector<HTMLElement>(
      "[data-interrogation-evidence-detail]",
    );
    if (!detail) throw new Error("detail panel missing");
    // A focusable scrollable region (WCAG 2.1): compact max-height clips
    // overflowing detail text, so keyboard users must be able to focus and
    // scroll the panel itself.
    expect(detail).toHaveAttribute("tabindex", "0");

    const gameMenu = screen.getByRole("button", { name: "遊戲選單" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ESC" })).toHaveFocus(),
    );

    gameMenu.focus();
    await user.tab({ shift: true });
    expect(detail).toHaveFocus();

    // Focusing the panel must not surface a stale record detail; the hint
    // stays until a record is hovered/focused.
    expect(detail).toHaveTextContent(
      "將游標移至紀錄，或以 Tab 選取以查看詳情；在紀錄上按 ↓ 直接捲動詳情。",
    );
  });

  it("keeps the record detail in the trap cycle while the game command is in flight", async () => {
    const user = userEvent.setup();
    const { container } = render(
      InterrogationEvidenceTray,
      props({ disabled: true }),
    );

    const detail = container.querySelector<HTMLElement>(
      "[data-interrogation-evidence-detail]",
    );
    if (!detail) throw new Error("detail panel missing");
    // Pending disables every command button but never the search input or
    // the detail panel, so the trap must keep cycling through both.
    detail.focus();
    expect(detail).toHaveFocus();
    await user.tab();
    expect(searchInput()).toHaveFocus();
  });

  it("keeps the testimony line keyboard-focusable so clipped text can scroll", () => {
    const { container } = render(InterrogationEvidenceTray, props());

    // A focusable scrollable region (WCAG 2.1): the compact max-height
    // clips overflowing testimony, so keyboard users must be able to focus
    // and scroll the blockquote itself — same contract as the detail panel.
    const lineRecord = container.querySelector(
      "[data-interrogation-line-record]",
    );
    expect(lineRecord).not.toBeNull();
    expect(lineRecord).toHaveAttribute("tabindex", "0");
  });

  it("moves from a focused tile to its detail with ArrowDown and returns to that tile with Shift+Tab", async () => {
    const user = userEvent.setup();
    const { container } = render(InterrogationEvidenceTray, props());

    const detail = container.querySelector<HTMLElement>(
      "[data-interrogation-evidence-detail]",
    );
    if (!detail) throw new Error("detail panel missing");
    const evidence = screen.getByRole("button", { name: /咖啡收據/ });
    const statement = screen.getByRole("button", { name: /目擊者/ });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ESC" })).toHaveFocus(),
    );
    evidence.focus();
    await waitFor(() =>
      expect(detail).toHaveTextContent("十七點四十二分的消費紀錄。"),
    );

    // ArrowDown reaches this tile's scrollable detail directly — without
    // presenting the record and without tabbing past the statement tile,
    // whose focus handler would swap the inspected record.
    await user.keyboard("{ArrowDown}");
    expect(detail).toHaveFocus();
    expect(detail).toHaveTextContent("咖啡收據");
    expect(detail).toHaveTextContent("十七點四十二分的消費紀錄。");

    // Shift+Tab returns to the inspected tile — not the grid's last tile.
    await user.tab({ shift: true });
    expect(evidence).toHaveFocus();
    expect(statement).not.toHaveFocus();
    expect(detail).toHaveTextContent("十七點四十二分的消費紀錄。");
  });

  it("returns focus to a connected trigger when the tray unmounts", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "evidence hud";
    document.body.append(trigger);
    const result = render(
      InterrogationEvidenceTray,
      props({ returnFocusTo: trigger }),
    );

    try {
      result.unmount();
      await waitFor(() => expect(trigger).toHaveFocus());
    } finally {
      trigger.remove();
    }
  });

  it("uses the stage fallback when document.body was the focus origin", async () => {
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(fallback);
    const result = render(
      InterrogationEvidenceTray,
      props({ returnFocusTo: document.body, fallbackFocusTarget: fallback }),
    );

    try {
      result.unmount();
      await waitFor(() => expect(fallback).toHaveFocus());
    } finally {
      fallback.remove();
    }
  });

  it("keeps evidence, 收回, and Escape inert while the game command is in flight", async () => {
    const user = userEvent.setup();
    const onPresent = vi.fn();
    const onResume = vi.fn();
    const onOpenGameMenu = vi.fn();
    render(
      InterrogationEvidenceTray,
      props({ disabled: true, onPresent, onResume, onOpenGameMenu }),
    );

    const evidence = screen.getByRole("button", { name: /咖啡收據/ });
    const escape = screen.getByRole("button", { name: "ESC" });
    const gameMenu = screen.getByRole("button", { name: "遊戲選單" });
    const withdraw = screen.getByRole("button", { name: "收回" });
    expect(evidence).toBeDisabled();
    expect(escape).toBeDisabled();
    expect(gameMenu).toBeDisabled();
    expect(withdraw).toBeDisabled();

    await user.click(evidence);
    await user.click(escape);
    await user.click(gameMenu);
    await user.click(withdraw);
    expect(closeTopmostEscapeClaim()).toBe(true);

    expect(onPresent).not.toHaveBeenCalled();
    expect(onOpenGameMenu).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("renders a resolved evidence image and swaps to a placeholder when the image fails to load", async () => {
    const inventoryWithImage: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: "coffee-order",
          name: "咖啡訂單",
          description: "訂單時間與證詞不符。",
          details: "最終列印時間為 21:17。",
          imageAssetId: "evidence.coffee_order.receipt",
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [],
    };

    const { container } = render(
      InterrogationEvidenceTray,
      props({ inventory: inventoryWithImage }),
    );

    const img = await waitFor(() => {
      const el =
        container.querySelector<HTMLImageElement>(".evidence-card img");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(img).toHaveAttribute(
      "src",
      expect.stringContaining("/assets/evidence/coffee_order.receipt.png"),
    );

    // Simulate a browser load failure (the URL is path-construction-only;
    // the actual file does not exist in jsdom). The onerror handler must
    // swap the src to a placeholder data URI.
    img.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(img).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("falls back to a placeholder when evidence image resolution rejects", async () => {
    const assetId = "evidence.broken_asset.reject_test";
    const inventoryWithFailingImage: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: "broken-evidence",
          name: "破損證物",
          description: "無法載入。",
          details: "",
          imageAssetId: assetId,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [],
    };

    const resolveSpy = vi
      .spyOn(storyAssets, "resolveStoryAsset")
      .mockRejectedValueOnce(new Error("network"));

    try {
      const { container } = render(
        InterrogationEvidenceTray,
        props({ inventory: inventoryWithFailingImage }),
      );

      const img = await waitFor(() => {
        const el =
          container.querySelector<HTMLImageElement>(".evidence-card img");
        expect(el).not.toBeNull();
        return el!;
      });
      expect(img).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it("does not swap a placeholder image again when onerror fires a second time", async () => {
    const inventoryWithImage: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: "coffee-order",
          name: "咖啡訂單",
          description: "訂單時間與證詞不符。",
          details: "最終列印時間為 21:17。",
          imageAssetId: "evidence.coffee_order.receipt",
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [],
    };

    const { container } = render(
      InterrogationEvidenceTray,
      props({ inventory: inventoryWithImage }),
    );

    const img = await waitFor(() => {
      const el =
        container.querySelector<HTMLImageElement>(".evidence-card img");
      expect(el).not.toBeNull();
      return el!;
    });

    // First error swaps to a placeholder data URI.
    img.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(img).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });

    // A second error on the already-placeholder image must be a no-op:
    // handleEvidenceImageError returns early when image.placeholder is true.
    const srcAfterFirstSwap = img.getAttribute("src");
    img.dispatchEvent(new Event("error"));
    await Promise.resolve();
    expect(img.getAttribute("src")).toBe(srcAfterFirstSwap);
  });

  it("renders the seal fallback when resolveStoryAsset resolves with null", async () => {
    const inventoryWithImage: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: "coffee-order",
          name: "咖啡訂單",
          description: "訂單時間與證詞不符。",
          details: "最終列印時間為 21:17。",
          imageAssetId: "evidence.coffee_order.receipt",
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_1",
        }),
      ],
      statements: [],
    };

    const resolveSpy = vi
      .spyOn(storyAssets, "resolveStoryAsset")
      .mockResolvedValue(null);

    try {
      const { container } = render(
        InterrogationEvidenceTray,
        props({ inventory: inventoryWithImage }),
      );

      // When resolveStoryAsset resolves with null, the $effect's
      // `if (!cancelled && asset)` guard skips setting evidenceImages, so
      // the seal fallback renders instead of an <img>.
      await waitFor(() => {
        expect(container.querySelector(".evidence-card img")).toBeNull();
        expect(
          container.querySelector(".evidence-card .record-seal"),
        ).not.toBeNull();
      });
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it("wraps shift+Tab from the escape button back to the search input", async () => {
    const user = userEvent.setup();
    render(InterrogationEvidenceTray, props());

    const search = searchInput();
    const escape = screen.getByRole("button", { name: "ESC" });

    await waitFor(() => expect(escape).toHaveFocus());
    // The search input sits before ESC in DOM order, so Shift+Tab from the
    // tray's initial focus target lands on it.
    await user.tab({ shift: true });
    expect(search).toHaveFocus();
  });

  it("focuses the first or last control when Tab arrives from outside the tray", async () => {
    // A genuinely focusable element outside the tray: both jsdom and real
    // browsers treat document.body.focus() as a no-op, so <body> cannot act
    // as the focus owner a Tab would arrive from.
    const outside = document.createElement("button");
    outside.textContent = "tray-external control";
    document.body.append(outside);

    try {
      render(InterrogationEvidenceTray, props());

      const search = searchInput();
      const escape = screen.getByRole("button", { name: "ESC" });
      const withdraw = screen.getByRole("button", { name: "收回" });

      // The mount's first focus lands on ESC; only once that settled do we
      // move focus outside, so the mount focus can't race the simulation.
      await waitFor(() => expect(escape).toHaveFocus());

      outside.focus();
      expect(outside).toHaveFocus();

      // Forward Tab from outside lands on the first control: the search
      // input, which sits before ESC in DOM order.
      outside.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
      await waitFor(() => expect(search).toHaveFocus());

      // Shift+Tab from outside wraps to the last control.
      outside.focus();
      outside.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
      await waitFor(() => expect(withdraw).toHaveFocus());
    } finally {
      outside.remove();
    }
  });

  it("focuses the enabled search input when Tab arrives while the command buttons are disabled", async () => {
    render(InterrogationEvidenceTray, props({ disabled: true }));

    // Every button is disabled, but the search input stays enabled
    // (filtering never sends a game command), so the trap must cycle to it
    // instead of focusing the tray container or assuming zero controls.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await waitFor(() => expect(searchInput()).toHaveFocus());
  });

  it("ignores non-Tab keys in the focus trap handler", async () => {
    render(InterrogationEvidenceTray, props());

    const escape = screen.getByRole("button", { name: "ESC" });
    await waitFor(() => expect(escape).toHaveFocus());

    // A non-Tab key must not be intercepted by the Tab trap handler.
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    const dispatched = window.dispatchEvent(event);
    expect(dispatched).toBe(true);
    expect(escape).toHaveFocus();
  });

  it("suspends the Tab trap while an upper layer is open", async () => {
    // When the Game Menu / Save Browser opens above the tray, the tray stays
    // mounted but must not intercept Tab — the upper dialog owns keyboard
    // navigation. A window-dispatched Tab must pass through (not cancelled)
    // rather than being swallowed by preventDefault + stopImmediatePropagation.
    const { rerender } = render(InterrogationEvidenceTray, props());

    const escape = screen.getByRole("button", { name: "ESC" });
    await waitFor(() => expect(escape).toHaveFocus());

    // While suspended, Tab is not cancelled and focus is not moved by the
    // trap.
    await rerender(props({ topLayerOpen: true }));
    const suspendedEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    expect(window.dispatchEvent(suspendedEvent)).toBe(true);
    expect(suspendedEvent.defaultPrevented).toBe(false);
    expect(escape).toHaveFocus();

    // Once the upper layer closes, the trap resumes: Tab is cancelled
    // (preventDefault) so the browser's native Tab navigation is overridden
    // by the trap's focus cycling.
    await rerender(props({ topLayerOpen: false }));
    const resumedEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(resumedEvent);
    expect(resumedEvent.defaultPrevented).toBe(true);
  });

  it("falls back to the stage fallback when the return-focus target was disconnected before unmount", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "evidence hud";
    document.body.append(trigger);
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(fallback);

    const result = render(
      InterrogationEvidenceTray,
      props({ returnFocusTo: trigger, fallbackFocusTarget: fallback }),
    );

    try {
      // Detach the trigger while the tray is still mounted. On unmount, the
      // `target.isConnected` guard is false, so focus must fall through to
      // the connected fallback.
      trigger.remove();
      result.unmount();
      await waitFor(() => expect(fallback).toHaveFocus());
    } finally {
      fallback.remove();
    }
  });

  it("does not focus anything when both return-focus target and fallback are disconnected on unmount", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "evidence hud";
    document.body.append(trigger);
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(fallback);

    const focusSpy = vi.spyOn(fallback, "focus");

    const result = render(
      InterrogationEvidenceTray,
      props({ returnFocusTo: trigger, fallbackFocusTarget: fallback }),
    );

    try {
      trigger.remove();
      fallback.remove();
      result.unmount();
      // Give the tick().then() callback a chance to run.
      await waitFor(() => {
        expect(focusSpy).not.toHaveBeenCalled();
      });
    } finally {
      focusSpy.mockRestore();
    }
  });

  it("keeps the newly focused record when blur fires on the previously focused tile", async () => {
    // When focus moves from record A to record B, the blur handler
    // clearFocusedRecordDetail(A) checks whether focusedRecordKey still
    // equals A. If focus has already moved to B (focusedRecordKey = B),
    // the guard's false arm prevents clearing the new focus state.
    const { container } = render(InterrogationEvidenceTray, props());
    const evidenceTile = screen.getByRole("button", {
      name: /咖啡收據.*店內收銀匯出/,
    });
    const statementTile = screen.getByRole("button", { name: /目擊者/ });
    const detail = container.querySelector(
      "[data-interrogation-evidence-detail]",
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ESC" })).toHaveFocus(),
    );

    // Focus the evidence tile, then focus the statement tile. The blur
    // handler on the evidence tile must not clear the statement tile's
    // focused detail.
    evidenceTile.focus();
    await waitFor(() => expect(detail).toHaveTextContent("咖啡收據"));

    statementTile.focus();
    await waitFor(() => expect(detail).toHaveTextContent("目擊者"));

    // The detail must still show the statement record, not revert to empty
    // or the evidence record — the blur guard protected the new focus.
    expect(detail).toHaveTextContent("目擊者");
  });
});
