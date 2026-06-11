import { publicPathForAssetId } from "@lyra/asset-paths";

export type EditorAssetType =
  | "background"
  | "portrait"
  | "standee"
  | "evidence";

export function publicPathForEditorAsset(
  assetId: string,
  type: EditorAssetType,
): string {
  return publicPathForAssetId(assetId, type);
}
