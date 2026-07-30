import { sha256CanonicalJson } from "./canonical-json";
import type {
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  StoryCatalogJsonV2,
} from "./types";

export type DialogueSegmentOriginV1 =
  | { type: "linearScene"; chapterId: string; sceneId: string }
  | {
      type: "investigationIntro" | "investigationOutro";
      chapterId: string;
      sceneId: string;
    }
  | {
      type: "investigationInteraction";
      chapterId: string;
      sceneId: string;
      segmentId: string;
    }
  | {
      type: "interrogationIntro" | "interrogationOutro";
      chapterId: string;
      sceneId: string;
    }
  | {
      type: "interrogationPhase";
      chapterId: string;
      sceneId: string;
      phaseId: string;
      segmentId: string;
    };

export type EmittedSceneJsonV1 =
  | JSONLinearScene
  | JSONInvestigationScene
  | JSONInterrogationScene;

export type SaveContentBundleV1 = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: EmittedSceneJsonV1[];
  }>;
  storyCatalog: StoryCatalogJsonV2;
};

export type BuildSaveContentManifestInput = {
  bundle: SaveContentBundleV1;
};

export type SaveContentManifestV1 = {
  manifestVersion: 1;
  contentRevision: `sha256:${string}`;
};

export function buildSaveContentManifest(
  input: BuildSaveContentManifestInput,
): SaveContentManifestV1 {
  return {
    manifestVersion: 1,
    contentRevision: sha256CanonicalJson(input.bundle),
  };
}
