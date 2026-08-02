import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReadableSaveMetadataView,
  SaveMetadataView,
  SaveSlotView,
} from "$lib/persistence/types";
import SaveCard from "./SaveCard.svelte";

const summary = {
  chapterId: "chapter_1",
  chapterTitle: "第一章　雨中的證言",
  chapterSummary: "相馬律接下雨夜中的第一宗委託。",
  sceneId: "scene_2",
  sceneTitle: "律師事務所",
  sceneSummary: "早坂帶來一份程序不明的調查摘要。",
  activePrimaryObjectiveId: "objective_1",
  activePrimaryObjectiveLabel: "詢問目擊者",
  activePrimaryObjectiveSummary: "釐清目擊者在雨夜看見的人影。",
};

function validMetadata(
  saveId: string,
  overrides: Partial<SaveMetadataView> = {},
): SaveMetadataView {
  return {
    saveId,
    saveType: "manual",
    schemaVersion: 1,
    contentRevision: `sha256:${"1".repeat(64)}`,
    savedAt: "2026-07-27T12:34:00Z",
    displayName: "雨夜的證言",
    thumbnail: { type: "available", width: 480, height: 270 },
    summary,
    ...overrides,
  };
}

function validSlot(
  saveId = "11111111-1111-4111-8111-111111111111",
  overrides: Partial<SaveMetadataView> = {},
): SaveSlotView {
  return {
    reference: { type: "manual", slot: 1 },
    modifiedAt: "2026-07-27T12:34:01Z",
    status: { type: "valid", metadata: validMetadata(saveId, overrides) },
  };
}

function invalidSlot(metadata: ReadableSaveMetadataView | null): SaveSlotView {
  return {
    reference: { type: "manual", slot: 2 },
    modifiedAt: "2026-07-27T12:35:01Z",
    status: {
      type: "invalid",
      metadata,
      diagnostic: {
        code: "unsupportedSaveSchemaVersion",
        message: "這個存檔版本無法載入。",
      },
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  let nextUrl = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => `blob:save-${++nextUrl}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SaveCard", () => {
  it("presents an empty autosave without attempting a thumbnail read", () => {
    const readThumbnail = vi.fn();
    render(SaveCard, {
      slot: {
        reference: { type: "auto", slot: 3 },
        modifiedAt: null,
        status: { type: "empty" },
      },
      mode: "titleLoad",
      readThumbnail,
    });

    expect(screen.getByText("自動存檔 3")).toBeInTheDocument();
    expect(screen.getByText("空白存檔")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "載入自動存檔 3" }),
    ).toBeDisabled();
    expect(readThumbnail).not.toHaveBeenCalled();
  });

  it("shows valid metadata, newest marker, localized date, and intrinsic thumbnail", async () => {
    const readThumbnail = vi
      .fn()
      .mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    render(SaveCard, {
      slot: validSlot(),
      mode: "titleLoad",
      isContinueCandidate: true,
      readThumbnail,
    });

    expect(screen.getByText("手動存檔 1")).toBeInTheDocument();
    expect(screen.getByText("最新")).toBeInTheDocument();
    expect(screen.getByText("雨夜的證言")).toBeInTheDocument();
    expect(screen.getByText(/第一章.*雨中的證言/)).toBeInTheDocument();
    expect(
      screen.getByText("相馬律接下雨夜中的第一宗委託。"),
    ).toBeInTheDocument();
    expect(screen.getByText("律師事務所")).toBeInTheDocument();
    expect(
      screen.getByText("早坂帶來一份程序不明的調查摘要。"),
    ).toBeInTheDocument();
    expect(screen.getByText("詢問目擊者")).toBeInTheDocument();
    expect(
      screen.getByText("釐清目擊者在雨夜看見的人影。"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("save-recap-details")).toHaveClass("compact");
    for (const copy of screen.getAllByTestId("recap-summary-copy")) {
      expect(copy).toHaveClass("compact-clamp");
    }
    expect(screen.getByTestId("saved-at")).toHaveTextContent("2026");

    const image = await screen.findByRole("img", { name: "雨夜的證言的預覽" });
    expect(image).toHaveAttribute("src", "blob:save-1");
    expect(image).toHaveStyle({ objectFit: "contain" });
    expect(screen.getByTestId("thumbnail-frame")).toHaveClass("letterbox");
    expect(readThumbnail).toHaveBeenCalledWith(
      { type: "manual", slot: 1 },
      "11111111-1111-4111-8111-111111111111",
    );
    expect(image.getAttribute("src")).not.toContain("/");
  });

  it("shows a valid no-objective state", () => {
    render(SaveCard, {
      slot: validSlot("11111111-1111-4111-8111-111111111112", {
        thumbnail: { type: "unavailable", reason: "captureUnavailable" },
        summary: {
          ...summary,
          activePrimaryObjectiveId: null,
          activePrimaryObjectiveLabel: null,
          activePrimaryObjectiveSummary: null,
        },
      }),
      mode: "titleLoad",
    });

    expect(screen.getByText("沒有進行中的主要目標")).toBeInTheDocument();
    expect(screen.getByText("無法顯示預覽")).toBeInTheDocument();
  });

  it("keeps invalid metadata selectable and deletable while disabling Load", async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const slot = invalidSlot({
      saveId: "22222222-2222-4222-8222-222222222222",
      savedAt: "2026-07-27T12:35:00Z",
      displayName: "舊版存檔",
      thumbnail: { type: "unavailable", reason: "corrupt" },
      summary,
    });
    render(SaveCard, {
      slot,
      mode: "gameLoad",
      onSelect,
      onDelete,
    });

    expect(screen.getByText("舊版存檔")).toBeInTheDocument();
    expect(screen.getByText("這個存檔版本無法載入。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "載入手動存檔 2" }),
    ).toBeDisabled();

    await fireEvent.click(
      screen.getByRole("button", { name: "選擇手動存檔 2" }),
    );
    expect(onSelect).toHaveBeenCalledWith(slot, expect.any(HTMLElement));

    await fireEvent.click(
      screen.getByRole("button", { name: "刪除手動存檔 2" }),
    );
    expect(onDelete).toHaveBeenCalledWith(slot, expect.any(HTMLElement));
  });

  it("does not present an invalid slot with wholly unreadable metadata as empty", () => {
    render(SaveCard, {
      slot: invalidSlot(null),
      mode: "titleLoad",
    });

    expect(screen.getByText("無法顯示預覽")).toBeInTheDocument();
    expect(screen.getByText("無法讀取存檔名稱")).toBeInTheDocument();
    expect(screen.queryByText("EMPTY")).not.toBeInTheDocument();
  });

  it("renders and revokes an available invalid-slot thumbnail without a readable name", async () => {
    const rendered = render(SaveCard, {
      slot: invalidSlot({
        saveId: "33333333-3333-4333-8333-333333333333",
        savedAt: "2026-07-27T12:36:00Z",
        displayName: null,
        thumbnail: { type: "available", width: 480, height: 270 },
        summary,
      }),
      mode: "titleLoad",
      readThumbnail: vi.fn().mockResolvedValue(new Uint8Array([1])),
    });

    const image = await screen.findByRole("img", {
      name: "手動存檔 2的預覽",
    });
    expect(image).toHaveAttribute("src", "blob:save-1");

    rendered.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:save-1");
  });

  it.each(["missing", "corrupt", "readFailed"] as const)(
    "uses the preview placeholder for %s metadata without reading bytes",
    (reason) => {
      const readThumbnail = vi.fn();
      render(SaveCard, {
        slot: validSlot("11111111-1111-4111-8111-111111111113", {
          thumbnail: { type: "unavailable", reason },
        }),
        mode: "titleLoad",
        readThumbnail,
      });

      expect(screen.getByText("無法顯示預覽")).toBeInTheDocument();
      expect(readThumbnail).not.toHaveBeenCalled();
    },
  );

  it("switches to the placeholder when the raw thumbnail read fails", async () => {
    render(SaveCard, {
      slot: validSlot(),
      mode: "titleLoad",
      readThumbnail: vi.fn().mockRejectedValue(new Error("read failed")),
    });

    expect(await screen.findByText("無法顯示預覽")).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("ignores a stale read and revokes the current Blob URL on slot change", async () => {
    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    const readThumbnail = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const rendered = render(SaveCard, {
      slot: validSlot("11111111-1111-4111-8111-111111111111"),
      mode: "titleLoad",
      readThumbnail,
    });

    await rendered.rerender({
      slot: validSlot("22222222-2222-4222-8222-222222222222", {
        displayName: "較新的存檔",
      }),
      mode: "titleLoad",
      readThumbnail,
    });
    second.resolve(new Uint8Array([2]));
    expect(
      await screen.findByRole("img", { name: "較新的存檔的預覽" }),
    ).toHaveAttribute("src", "blob:save-1");

    first.resolve(new Uint8Array([1]));
    await Promise.resolve();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    await rendered.rerender({
      slot: {
        reference: { type: "manual", slot: 1 },
        modifiedAt: null,
        status: { type: "empty" },
      },
      mode: "titleLoad",
      readThumbnail,
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:save-1");
  });

  it("rerenders a failed sidecar through owned replacement and selected deletion", async () => {
    const readThumbnail = vi
      .fn()
      .mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const rendered = render(SaveCard, {
      slot: validSlot("11111111-1111-4111-8111-111111111114", {
        displayName: "缺少預覽的存檔",
        thumbnail: { type: "unavailable", reason: "missing" },
      }),
      mode: "titleLoad",
      readThumbnail,
    });

    expect(screen.getByText("無法顯示預覽")).toBeInTheDocument();
    expect(readThumbnail).not.toHaveBeenCalled();

    await rendered.rerender({
      slot: validSlot("11111111-1111-4111-8111-111111111114", {
        displayName: "損壞預覽的存檔",
        thumbnail: { type: "unavailable", reason: "corrupt" },
      }),
      mode: "titleLoad",
      readThumbnail,
    });
    expect(screen.getByText("無法顯示預覽")).toBeInTheDocument();
    expect(readThumbnail).not.toHaveBeenCalled();

    await rendered.rerender({
      slot: validSlot("22222222-2222-4222-8222-222222222224", {
        displayName: "新擁有的預覽",
      }),
      mode: "titleLoad",
      readThumbnail,
    });
    expect(
      await screen.findByRole("img", { name: "新擁有的預覽的預覽" }),
    ).toHaveAttribute("src", "blob:save-1");
    expect(readThumbnail).toHaveBeenCalledWith(
      { type: "manual", slot: 1 },
      "22222222-2222-4222-8222-222222222224",
    );

    await rendered.rerender({
      slot: {
        reference: { type: "manual", slot: 1 },
        modifiedAt: null,
        status: { type: "empty" },
      },
      mode: "titleLoad",
      readThumbnail,
    });
    expect(screen.getByText("空白存檔")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:save-1");
  });

  it("revokes its Blob URL on unmount", async () => {
    const rendered = render(SaveCard, {
      slot: validSlot(),
      mode: "titleLoad",
      readThumbnail: vi.fn().mockResolvedValue(new Uint8Array([1])),
    });
    await screen.findByRole("img");

    rendered.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:save-1");
  });

  it("revokes a URL and switches to the placeholder on browser decode failure", async () => {
    render(SaveCard, {
      slot: validSlot(),
      mode: "titleLoad",
      readThumbnail: vi.fn().mockResolvedValue(new Uint8Array([1])),
    });
    const image = await screen.findByRole("img");

    await fireEvent.error(image);

    await waitFor(() => {
      expect(screen.getByText("無法顯示預覽")).toBeInTheDocument();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:save-1");
  });
});
