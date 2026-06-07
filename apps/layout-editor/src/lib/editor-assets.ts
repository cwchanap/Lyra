export type EditorAssetType =
  | "background"
  | "portrait"
  | "standee"
  | "evidence";

export function publicPathForEditorAsset(
  assetId: string,
  type: EditorAssetType,
): string {
  if (type === "portrait") {
    const [, characterId, expression] = assetId.split(".");
    return `/assets/portraits/${characterId}/${expression}.png`;
  }

  if (type === "standee") {
    const [, characterId, pose] = assetId.split(".");
    return `/assets/standees/${characterId}/${pose}.png`;
  }

  if (type === "evidence") {
    return `/assets/evidence/${assetId.replace(/^evidence\./, "")}.png`;
  }

  return `/assets/backgrounds/${assetId
    .replace(/^background\./, "")
    .replaceAll(".", "/")}.png`;
}
