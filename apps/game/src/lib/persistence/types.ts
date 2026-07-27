import type { GameStateView } from "$lib/state/types";

export type PersistenceFailureTokenView = string;

export type GameError = {
  code: string;
  message: string;
  failureToken?: PersistenceFailureTokenView;
};

export type SaveDiagnosticView = GameError;

export type SaveSlotRef =
  | { type: "auto"; slot: number }
  | { type: "manual"; slot: number };

export type SaveType = "auto" | "manual";

export type SaveSummaryView = {
  chapterId: string;
  chapterTitle: string;
  sceneId: string;
  sceneTitle: string;
  activePrimaryObjectiveId: string | null;
  activePrimaryObjectiveLabel: string | null;
};

export type ThumbnailUnavailableReason =
  | "captureUnavailable"
  | "missing"
  | "corrupt"
  | "readFailed";

export type ThumbnailAvailabilityView =
  | { type: "available"; width: number; height: number }
  | { type: "unavailable"; reason: ThumbnailUnavailableReason };

export type SaveMetadataView = {
  saveId: string;
  saveType: SaveType;
  schemaVersion: number;
  contentRevision: string;
  savedAt: string;
  displayName: string;
  thumbnail: ThumbnailAvailabilityView;
  summary: SaveSummaryView;
};

export type ReadableSaveMetadataView = {
  saveId: string | null;
  savedAt: string | null;
  displayName: string | null;
  thumbnail: ThumbnailAvailabilityView;
  summary: SaveSummaryView | null;
};

export type SaveSlotStatusView =
  | { type: "empty" }
  | { type: "valid"; metadata: SaveMetadataView }
  | {
      type: "invalid";
      metadata: ReadableSaveMetadataView | null;
      diagnostic: SaveDiagnosticView;
    };

export type SaveSlotView = {
  reference: SaveSlotRef;
  modifiedAt: string | null;
  status: SaveSlotStatusView;
};

export type SaveDiscoveryStatusView =
  | { type: "loading" }
  | { type: "available" }
  | { type: "unavailable"; diagnostic: SaveDiagnosticView };

export type SaveBrowserView = {
  discovery: SaveDiscoveryStatusView;
  slots: SaveSlotView[];
};

export type SaveBrowserPreflightView =
  | { type: "ready" }
  | {
      type: "flushFailed";
      diagnostic: SaveDiagnosticView;
      failureToken: PersistenceFailureTokenView;
    };

export type SaveBrowserOpenResultView = {
  browser: SaveBrowserView;
  continueCandidate: SaveSlotRef | null;
  preflight: SaveBrowserPreflightView;
};

export type ThumbnailDiagnosticView = {
  reason: ThumbnailUnavailableReason;
  message: string;
  retryable: boolean;
};

export type PersistenceHealthView =
  | { type: "healthy" }
  | { type: "pending" }
  | { type: "degraded"; diagnostic: SaveDiagnosticView };

export type ThumbnailActivityView =
  | { type: "idle" }
  | { type: "capturing" }
  | { type: "unavailable"; diagnostic: ThumbnailDiagnosticView };

export type ExitStatusView =
  | { type: "idle" }
  | { type: "saving" }
  | {
      type: "failed";
      diagnostic: SaveDiagnosticView;
      failureToken: PersistenceFailureTokenView;
    };

export type ThumbnailCaptureRequestView = {
  ticket: string;
  timeoutMs: number;
};

export type ThumbnailCapturePurposeView =
  | { type: "manualSave" }
  | { type: "acquisitionAcknowledgement"; eventId: string };

export type GameplayCommandResultView = {
  state: GameStateView;
  thumbnailCapture: ThumbnailCaptureRequestView | null;
};

export type GameplayThumbnailCaptureResult =
  | { type: "available"; bytes: Uint8Array }
  | { type: "unavailable"; reason: string };

export interface GameplayThumbnailCapture {
  capture(
    request: ThumbnailCaptureRequestView,
  ): Promise<GameplayThumbnailCaptureResult>;
}

export type OccupiedSlotExpectationView = {
  saveId: string | null;
  modifiedAt: string | null;
};

export type ManualSlotExpectationView =
  | { type: "empty" }
  | {
      type: "occupied";
      observation: OccupiedSlotExpectationView;
    };

export type ManualSaveResultView = {
  savedSlot: SaveSlotView;
  browser: SaveBrowserView;
  thumbnailActivity: ThumbnailActivityView;
};

export type AcquisitionAcknowledgementPhase =
  | { type: "idle" }
  | { type: "preparing" }
  | { type: "capturing" }
  | { type: "saving"; slow: boolean }
  | {
      type: "failed";
      diagnostic: GameError;
      failureToken: PersistenceFailureTokenView | null;
    };
