import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaseFileRecordItem } from "$lib/case-file/types";
import type { EvidenceRecord, StatementRecord } from "$lib/state/types";
import {
  neutralCaseRecordProvenance,
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "$lib/state/test-fixtures";
import CaseFileRecordDetail from "./CaseFileRecordDetail.svelte";
import CaseFileItemList from "./CaseFileItemList.svelte";

const resolveStoryAsset = vi.hoisted(() => vi.fn());

vi.mock("$lib/assets/story-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/assets/story-assets")>()),
  resolveStoryAsset,
}));

function evidenceRecord(
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  const record = neutralEvidenceRecordView({
    id: "receipt",
    name: "咖啡收據",
    description: "時間被圈起的收據。",
    details: "收據顯示關鍵時間。",
    imageAssetId: null,
    onReexamine: [{ kind: "action", text: "重新比對時間。" }],
    collectedInChapterId: "chapter_1",
    collectedInSceneId: "scene_1",
  });
  return { ...record, ...overrides };
}

function statementRecord(
  overrides: Partial<StatementRecord> = {},
): StatementRecord {
  const record = neutralStatementRecordView({
    id: "witness",
    speaker: "若月",
    content: "我一直在店內。",
    onReexamine: null,
    acquiredInChapterId: "chapter_1",
    acquiredInSceneId: "scene_1",
  });
  return { ...record, ...overrides };
}

function recordItem(
  record: EvidenceRecord | StatementRecord,
  overrides: Partial<CaseFileRecordItem> = {},
): CaseFileRecordItem {
  const target =
    "name" in record
      ? { kind: "evidence" as const, id: record.id }
      : { kind: "statement" as const, id: record.id };
  return {
    key: `${target.kind}:${target.id}`,
    section: target.kind === "evidence" ? "evidence" : "statements",
    target,
    record,
    predecessor: null,
    successor: null,
    hasVisibleProvenance: false,
    ...overrides,
  };
}

function renderDetail(
  item: CaseFileRecordItem,
  options: {
    disabled?: boolean;
    reexamineEnabled?: boolean;
    onNavigate?: (key: CaseFileRecordItem["key"]) => void;
  } = {},
) {
  const onReexamineEvidence = vi.fn();
  const onReexamineStatement = vi.fn();
  const onNavigate = options.onNavigate ?? vi.fn();
  return {
    ...render(CaseFileRecordDetail, {
      item,
      reexamineEnabled: options.reexamineEnabled ?? true,
      onReexamineEvidence,
      onReexamineStatement,
      onNavigate,
      disabled: options.disabled ?? false,
    }),
    onReexamineEvidence,
    onReexamineStatement,
    onNavigate,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("CaseFileRecordDetail", () => {
  afterEach(() => {
    resolveStoryAsset.mockReset();
    vi.restoreAllMocks();
  });

  it("keeps a neutral legacy evidence record free of provenance output", () => {
    renderDetail(recordItem(evidenceRecord()));

    expect(
      screen.getByRole("heading", { name: "證物：咖啡收據" }),
    ).toBeInTheDocument();
    expect(screen.getByText("時間被圈起的收據。")).toBeInTheDocument();
    expect(screen.getByText("收據顯示關鍵時間。")).toBeInTheDocument();
    expect(screen.getByText("取得於：測試章節・測試場景")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "來源與狀態" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("未指定")).not.toBeInTheDocument();
    expect(screen.queryByText("前一項紀錄")).not.toBeInTheDocument();
    expect(screen.queryByText("後續紀錄")).not.toBeInTheDocument();
  });

  it("renders only authored provenance labels and the fixed proof-capability map", () => {
    const record = evidenceRecord({
      provenance: {
        sourceKind: "digital",
        representationLayer: "raw",
        proceduralStatus: "exhibit",
        completeness: "complete",
        confidence: "corroborated",
        sourceGroupId: "cafe_register",
        sourceLabel: "鑑識原始匯出",
        proofCapabilities: [
          "time",
          "order",
          "route",
          "identity",
          "access",
          "motive",
          "source",
          "credibility",
          "procedure",
          "causation",
        ],
        supersedesRecordId: null,
      },
      sourceGroup: {
        id: "cafe_register",
        label: "店內收銀紀錄",
        summary: "同一台收銀機的匯出紀錄。",
      },
    });
    renderDetail(recordItem(record, { hasVisibleProvenance: true }));

    expect(
      screen.getByRole("heading", { name: "來源與狀態" }),
    ).toBeInTheDocument();
    expect(screen.getByText("來源類型：數位紀錄")).toBeInTheDocument();
    expect(screen.getByText("呈現層：原始紀錄")).toBeInTheDocument();
    expect(screen.getByText("程序狀態：正式證物")).toBeInTheDocument();
    expect(screen.getByText("完整度：完整")).toBeInTheDocument();
    expect(screen.getByText("可信度：已佐證")).toBeInTheDocument();
    expect(screen.getByText("來源：鑑識原始匯出")).toBeInTheDocument();
    expect(screen.getByText("來源群組：店內收銀紀錄")).toBeInTheDocument();
    expect(screen.getByText("同一台收銀機的匯出紀錄。")).toBeInTheDocument();
    expect(
      screen.getByText(
        "可證明：時間、順序、動線、身分、出入、動機、來源、可信度、程序、因果",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/evidence:|statement:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/成員/)).not.toBeInTheDocument();
  });

  it("uses the source-group label when the record has no source label", () => {
    const record = statementRecord({
      provenance: {
        ...neutralCaseRecordProvenance(),
        sourceKind: "testimony",
        sourceGroupId: "witnesses",
      },
      sourceGroup: {
        id: "witnesses",
        label: "現場目擊者",
        summary: "同一時段在店內的人。",
      },
    });
    renderDetail(recordItem(record, { hasVisibleProvenance: true }));

    expect(screen.getByText("來源：現場目擊者")).toBeInTheDocument();
    expect(screen.queryByText("來源群組：現場目擊者")).not.toBeInTheDocument();
    expect(screen.queryByText("來源：未指定")).not.toBeInTheDocument();
  });

  it("keeps an acquired superseded record inspectable and follows only acquired history", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const item = recordItem(evidenceRecord(), {
      successor: { kind: "statement", id: "corrected" },
      hasVisibleProvenance: true,
    });
    renderDetail(item, { onNavigate });

    expect(screen.getByText("已被後續紀錄取代")).toBeInTheDocument();
    const successor = screen.getByRole("button", { name: "查看後續紀錄" });
    expect(successor).toBeEnabled();
    await user.click(successor);
    expect(onNavigate).toHaveBeenCalledWith("statement:corrected");
    expect(
      screen.queryByText(/未取得|隱藏|placeholder/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the detail inspectable while gating only re-examination", async () => {
    const user = userEvent.setup();
    const { onReexamineEvidence } = renderDetail(recordItem(evidenceRecord()), {
      disabled: true,
      reexamineEnabled: true,
    });

    expect(
      screen.getByRole("heading", { name: "證物：咖啡收據" }),
    ).toBeInTheDocument();
    const reexamine = screen.getByRole("button", { name: "重新檢視" });
    expect(reexamine).toBeDisabled();
    // A transient in-flight disable (disabled=true) is NOT a mode block, so
    // the mode explanation must stay absent.
    expect(reexamine).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByText("重新檢視僅可在調查或訊問期間使用。"),
    ).not.toBeInTheDocument();
    await user.click(reexamine);
    expect(onReexamineEvidence).not.toHaveBeenCalled();
  });

  it("explains why re-examination is unavailable when the mode does not support it", () => {
    // canReexamineCaseRecords gates re-examination to explore/interrogation.
    // In every other mode the Case File still opens, so the disabled action
    // must carry an explanation rather than rendering as a silent dead button.
    renderDetail(recordItem(evidenceRecord()), {
      reexamineEnabled: false,
    });

    const reexamine = screen.getByRole("button", { name: "重新檢視" });
    expect(reexamine).toBeDisabled();
    expect(reexamine).toHaveAttribute(
      "aria-describedby",
      "case-file-reexamine-note",
    );
    expect(
      screen.getByText("重新檢視僅可在調查或訊問期間使用。"),
    ).toBeInTheDocument();
  });

  it("keeps a record list row selectable while re-examination is disabled", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(CaseFileItemList, {
      section: "evidence",
      items: [recordItem(evidenceRecord())],
      selectedKey: "evidence:receipt",
      emptyText: "目前尚無證物。",
      disabled: true,
      onSelect,
    });

    const row = screen.getByRole("button", { name: "咖啡收據" });
    expect(row).toBeEnabled();
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith("evidence:receipt");
  });

  it("resolves a record image asynchronously, falls back once, and ignores a stale resolution", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const initial = deferred<{
      assetId: string;
      type: "evidence";
      url: string;
      placeholder: boolean;
    } | null>();
    const current = deferred<{
      assetId: string;
      type: "evidence";
      url: string;
      placeholder: boolean;
    } | null>();
    resolveStoryAsset
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(current.promise);

    const rendered = renderDetail(
      recordItem(evidenceRecord({ imageAssetId: "evidence.old" })),
    );
    expect(
      screen.queryByRole("img", { name: "咖啡收據" }),
    ).not.toBeInTheDocument();

    await rendered.rerender({
      item: recordItem(evidenceRecord({ imageAssetId: "evidence.current" })),
      reexamineEnabled: true,
      onReexamineEvidence: rendered.onReexamineEvidence,
      onReexamineStatement: rendered.onReexamineStatement,
      onNavigate: rendered.onNavigate,
      disabled: false,
    });

    current.resolve({
      assetId: "evidence.current",
      type: "evidence",
      url: "/assets/evidence/current.png",
      placeholder: false,
    });
    initial.resolve({
      assetId: "evidence.old",
      type: "evidence",
      url: "/assets/evidence/old.png",
      placeholder: false,
    });

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "咖啡收據" })).toHaveAttribute(
        "src",
        "/assets/evidence/current.png",
      );
    });
    const image = screen.getByRole("img", { name: "咖啡收據" });
    image.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(image).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Missing evidence asset"),
    );
    warnSpy.mockClear();
    image.dispatchEvent(new Event("error"));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("renders a statement record with its speaker heading and content", () => {
    renderDetail(recordItem(statementRecord()));

    expect(
      screen.getByRole("heading", { name: "證詞：若月" }),
    ).toBeInTheDocument();
    expect(screen.getByText("我一直在店內。")).toBeInTheDocument();
    expect(screen.queryByText("證物：")).not.toBeInTheDocument();
  });

  it("triggers statement re-examination when enabled", async () => {
    const user = userEvent.setup();
    const record = statementRecord({
      onReexamine: [{ kind: "action", text: "再次詢問。" }],
    });
    const { onReexamineStatement } = renderDetail(recordItem(record));

    const reexamine = screen.getByRole("button", { name: "重新檢視" });
    expect(reexamine).toBeEnabled();
    await user.click(reexamine);
    expect(onReexamineStatement).toHaveBeenCalledWith("witness");
  });

  it("triggers evidence re-examination when enabled", async () => {
    const user = userEvent.setup();
    const { onReexamineEvidence } = renderDetail(recordItem(evidenceRecord()));

    const reexamine = screen.getByRole("button", { name: "重新檢視" });
    expect(reexamine).toBeEnabled();
    await user.click(reexamine);
    expect(onReexamineEvidence).toHaveBeenCalledWith("receipt");
  });

  it("navigates to the predecessor record", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const item = recordItem(evidenceRecord(), {
      predecessor: { kind: "evidence", id: "earlier_record" },
    });
    renderDetail(item, { onNavigate });

    const predecessor = screen.getByRole("button", {
      name: "查看前一項紀錄",
    });
    expect(predecessor).toBeEnabled();
    await user.click(predecessor);
    expect(onNavigate).toHaveBeenCalledWith("evidence:earlier_record");
  });

  it("does not render a re-examine button when onReexamine is null", () => {
    renderDetail(recordItem(evidenceRecord({ onReexamine: null })));

    expect(
      screen.queryByRole("button", { name: "重新檢視" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("重新檢視僅可在調查或訊問期間使用。"),
    ).not.toBeInTheDocument();
  });

  it("renders both predecessor and successor navigation buttons", () => {
    const item = recordItem(evidenceRecord(), {
      predecessor: { kind: "evidence", id: "prev" },
      successor: { kind: "statement", id: "next" },
    });
    renderDetail(item);

    expect(
      screen.getByRole("button", { name: "查看前一項紀錄" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看後續紀錄" }),
    ).toBeInTheDocument();
  });

  it("renders the provenance section with all fields absent for a neutral record", () => {
    // A record with all-neutral provenance but hasVisibleProvenance: true
    // exercises the false branch of every provenance {#if} block.
    const record = evidenceRecord();
    renderDetail(recordItem(record, { hasVisibleProvenance: true }));

    expect(
      screen.getByRole("heading", { name: "來源與狀態" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/來源類型：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/呈現層：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/程序狀態：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/完整度：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/可信度：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/來源：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/來源群組：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/可證明：/)).not.toBeInTheDocument();
  });

  it("falls back to a placeholder when resolveStoryAsset resolves to null", async () => {
    resolveStoryAsset.mockResolvedValue(null);
    renderDetail(
      recordItem(evidenceRecord({ imageAssetId: "evidence.missing" })),
    );

    await waitFor(() => {
      const img = screen.getByRole("img", { name: "咖啡收據" });
      expect(img).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("falls back to a missing-asset placeholder when resolveStoryAsset rejects", async () => {
    resolveStoryAsset.mockRejectedValue(new Error("asset failure"));
    renderDetail(
      recordItem(evidenceRecord({ imageAssetId: "evidence.broken" })),
    );

    await waitFor(() => {
      const img = screen.getByRole("img", { name: "咖啡收據" });
      expect(img).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });
});
