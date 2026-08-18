import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

const testDir = dirname(fileURLToPath(import.meta.url));

async function loadCommands() {
  return import("./commands");
}

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
});

describe("persistence command transport", () => {
  it("invokes Tauri directly without a runtime global", async () => {
    const commands = await loadCommands();
    mocks.invoke.mockResolvedValueOnce({ type: "idle" });

    expect("__TAURI_INTERNALS__" in window).toBe(false);
    await expect(commands.getThumbnailActivity()).resolves.toEqual({
      type: "idle",
    });

    expect(mocks.invoke).toHaveBeenCalledWith(
      "get_thumbnail_activity",
      undefined,
    );
  });

  it("submits raw PNG bytes with only the exact ticket header", async () => {
    const commands = await loadCommands();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    mocks.invoke.mockResolvedValueOnce({ type: "idle" });

    await expect(
      commands.submitSaveThumbnail("ticket-123", bytes),
    ).resolves.toEqual({ type: "idle" });

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "submit_save_thumbnail",
      bytes,
      {
        headers: {
          "x-lyra-thumbnail-ticket": "ticket-123",
        },
      },
    );
  });

  it("reads a thumbnail by typed slot and observed save ID", async () => {
    const commands = await loadCommands();
    mocks.invoke.mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);

    await expect(
      commands.readSaveThumbnail(
        { type: "manual", slot: 2 },
        "save-id-observed",
      ),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "read_save_thumbnail",
      {
        reference: { type: "manual", slot: 2 },
        observedSaveId: "save-id-observed",
      },
    );
  });

  it("accepts Uint8Array responses without copying them into JSON", async () => {
    const commands = await loadCommands();
    const bytes = new Uint8Array([4, 5, 6]);
    mocks.invoke.mockResolvedValueOnce(bytes);

    await expect(
      commands.readSaveThumbnail({ type: "auto", slot: 1 }, "save-id"),
    ).resolves.toBe(bytes);
  });

  it("rejects non-binary thumbnail responses as a typed error", async () => {
    const commands = await loadCommands();
    mocks.invoke.mockResolvedValueOnce({ bytes: [1, 2, 3] });

    await expect(
      commands.readSaveThumbnail({ type: "auto", slot: 1 }, "save-id"),
    ).rejects.toEqual({
      code: "thumbnailCorrupt",
      message: "Thumbnail response was not binary.",
    });
  });

  it("preserves structured persistence errors and opaque failure tokens", async () => {
    const commands = await loadCommands();
    const error = {
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "00000000-0000-4000-8000-000000000000",
      ignored: { operation: "must not cross the boundary" },
    };
    mocks.invoke.mockRejectedValueOnce(error);

    await expect(
      commands.invokePersistenceCommand("save_manual", {}),
    ).rejects.toEqual({
      code: error.code,
      message: error.message,
      failureToken: error.failureToken,
    });
  });

  it("cancels a persistence challenge with only its opaque token", async () => {
    const commands = await loadCommands();
    mocks.invoke.mockResolvedValueOnce(undefined);

    await expect(
      commands.cancelPersistenceFailure("00000000-0000-4000-8000-000000000000"),
    ).resolves.toBeUndefined();

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "cancel_persistence_failure",
      {
        failureToken: "00000000-0000-4000-8000-000000000000",
      },
    );
  });

  it("keeps filesystem and bypass details out of command argument shapes", () => {
    const source = readFileSync(join(testDir, "commands.ts"), "utf8");

    expect(source).not.toMatch(
      /\b(appDataPath|savePath|thumbnailPath|objectId)\b/,
    );
    expect(source).not.toMatch(
      /\b(failure_token|observed_save_id|event_id|prepared_thumbnail_ticket)\s*:/,
    );
    expect(source).not.toMatch(/\b(force|skipFlush|discardCurrent): boolean\b/);
  });
});
