import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  ExitStatusView,
  GameError,
  GameplayCommandResultView,
  PersistenceFailureTokenView,
  PersistenceHealthView,
  SaveBrowserOpenResultView,
  SaveSlotView,
  ThumbnailActivityView,
} from "./types";
import type { GameStateView } from "$lib/state/types";

const testDir = dirname(fileURLToPath(import.meta.url));

const diagnostic = {
  code: "saveWriteFailed",
  message: "Save could not be written.",
} satisfies GameError;

const failureToken =
  "00000000-0000-4000-8000-000000000000" satisfies PersistenceFailureTokenView;

const emptySlot = {
  reference: { type: "auto", slot: 1 },
  modifiedAt: null,
  status: { type: "empty" },
} satisfies SaveSlotView;

const validSlot = {
  reference: { type: "manual", slot: 2 },
  modifiedAt: "2026-07-27T08:00:00Z",
  status: {
    type: "valid",
    metadata: {
      saveId: "00000000-0000-4000-8000-000000000001",
      saveType: "manual",
      schemaVersion: 1,
      contentRevision: "sha256:fixture",
      savedAt: "2026-07-27T08:00:00Z",
      displayName: "雨夜",
      thumbnail: { type: "available", width: 480, height: 360 },
      summary: {
        chapterId: "chapter_1",
        chapterTitle: "第一章",
        chapterSummary: null,
        sceneId: "investigation_scene_1",
        sceneTitle: "雨夜",
        sceneSummary: null,
        activePrimaryObjectiveId: null,
        activePrimaryObjectiveLabel: null,
        activePrimaryObjectiveSummary: null,
      },
    },
  },
} satisfies SaveSlotView;

const invalidSlot = {
  reference: { type: "auto", slot: 5 },
  modifiedAt: "2026-07-27T08:00:01Z",
  status: {
    type: "invalid",
    metadata: {
      saveId: null,
      savedAt: null,
      displayName: null,
      thumbnail: { type: "unavailable", reason: "corrupt" },
      summary: null,
    },
    diagnostic,
  },
} satisfies SaveSlotView;

const browser = {
  browser: {
    discovery: {
      type: "unavailable",
      diagnostic: {
        code: "saveDiscoveryUnavailable",
        message: "Save discovery is unavailable.",
      },
    },
    slots: [emptySlot, validSlot, invalidSlot],
  },
  continueCandidate: null,
  preflight: {
    type: "flushFailed",
    diagnostic,
    failureToken,
  },
} satisfies SaveBrowserOpenResultView;

const health = {
  type: "degraded",
  diagnostic,
} satisfies PersistenceHealthView;

const activity = {
  type: "unavailable",
  diagnostic: {
    reason: "captureUnavailable",
    message: "Capture failed.",
    retryable: true,
  },
} satisfies ThumbnailActivityView;

const exit = {
  type: "failed",
  diagnostic,
  failureToken,
} satisfies ExitStatusView;

const state = {
  mode: { type: "gameComplete" },
  chapter: {
    id: "chapter_1",
    title: "第一章",
    summary: "",
    index: 0,
    total: 1,
  },
  scene: {
    kind: "linear",
    id: "scene_1",
    title: "雨夜",
    summary: "",
    index: 0,
    total: 1,
  },
  inventory: { evidence: [], statements: [] },
  story: { facts: [], questions: [], objectives: [], authorizations: [] },
  dialogueHistory: [],
  pendingAcquisition: null,
} satisfies GameStateView;

const wrapped = {
  state,
  thumbnailCapture: {
    ticket: "00000000-0000-4000-8000-000000000002",
    timeoutMs: 725,
  },
} satisfies GameplayCommandResultView;

describe("persistence wire contracts", () => {
  it("accepts complete lower-camel save and coordinator payloads", () => {
    expect(browser.browser.slots).toHaveLength(3);
    expect(health.type).toBe("degraded");
    expect(activity.type).toBe("unavailable");
    expect(exit.failureToken).toBe(failureToken);
    expect(wrapped.state).toBe(state);
  });

  it("keeps the failure token opaque and preserves it on actionable errors", () => {
    const actionable = {
      ...diagnostic,
      failureToken,
    } satisfies GameError;

    expect(Object.keys(actionable).sort()).toEqual([
      "code",
      "failureToken",
      "message",
    ]);
    expect(failureToken).not.toContain("operation");
    expect(failureToken).not.toContain("revision");
    expect(failureToken).not.toContain("generation");
  });

  it("forbids filesystem and bypass implementation details in frontend contracts", () => {
    const source = readFileSync(join(testDir, "types.ts"), "utf8");

    expect(source).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    expect(source).not.toMatch(
      /\b(appDataPath|savePath|thumbnailPath|objectId)\b/,
    );
    expect(source).not.toMatch(/\b(force|skipFlush|discardCurrent): boolean\b/);
    expect(source).not.toContain("data?:");
  });
});
