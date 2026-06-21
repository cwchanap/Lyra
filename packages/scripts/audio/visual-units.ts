export type VisualUnitIndex = {
  id: string;
  file: string;
  line: number;
  metadataInsertLine: number;
  existingBgm?: string;
  existingBgs?: string;
};

const SCENE_TAG_RE = /^\[場景：/;
const BLOCK_ID_RE = /\{#([a-zA-Z0-9_-]+)\}\s*$/;
// Mirrors the compiler tokenizer's metadata grammar closely enough for this
// line-based indexer: metadata values must be non-empty.
const METADATA_RE = /^-\s+\*\*([A-Za-z][A-Za-z0-9 ]*):\*\*\s+(.+?)\s*$/;
const VISUAL_METADATA_KEYS = new Set(["Background Prompt", "BGM", "BGS"]);

type MetadataScan = {
  insertLine: number;
  bgm?: string;
  bgs?: string;
};

export function indexVisualUnitsFromMarkdown(
  file: string,
  source: string,
): VisualUnitIndex[] {
  const lines = source.split(/\r?\n/);
  const units: VisualUnitIndex[] = [];
  const interactiveFile = isInteractiveFile(file);
  let insideInteractiveVisualBlock = false;
  let tagCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (interactiveFile && isH2Heading(trimmed)) {
      insideInteractiveVisualBlock = false;
    }

    if (isInteractiveVisualBlockHeading(trimmed)) {
      if (interactiveFile) {
        insideInteractiveVisualBlock = true;
      }
      const id = BLOCK_ID_RE.exec(trimmed)?.[1];
      if (!id) continue;
      const metadata = scanMetadata(lines, i + 1, "visualTailStart");
      units.push({
        id,
        file,
        line: i + 1,
        metadataInsertLine: metadata.insertLine,
        existingBgm: metadata.bgm,
        existingBgs: metadata.bgs,
      });
      continue;
    }

    if (SCENE_TAG_RE.test(trimmed)) {
      const sceneTagEndIndex = findSceneTagEndIndex(lines, i);
      if (interactiveFile && insideInteractiveVisualBlock) {
        i = sceneTagEndIndex;
        continue;
      }
      tagCount += 1;
      const metadata = scanMetadata(lines, sceneTagEndIndex + 1, "afterBlock");
      units.push({
        id: `tag_${String(tagCount).padStart(3, "0")}`,
        file,
        line: i + 1,
        metadataInsertLine: metadata.insertLine,
        existingBgm: metadata.bgm,
        existingBgs: metadata.bgs,
      });
      i = sceneTagEndIndex;
    }
  }

  return units;
}

function scanMetadata(
  lines: string[],
  startIndex: number,
  insertMode: "afterBlock" | "visualTailStart",
): MetadataScan {
  let insertLine = startIndex + 1;
  let visualInsertLine: number | undefined;
  let bgm: string | undefined;
  let bgs: string | undefined;

  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "") continue;

    const metadata = parseMetadataLine(trimmed);
    if (!metadata) break;

    const { key, value } = metadata;
    if (VISUAL_METADATA_KEYS.has(key) && visualInsertLine === undefined) {
      visualInsertLine = i + 1;
    }
    if (key === "BGM") bgm = value;
    if (key === "BGS") bgs = value;
    insertLine = i + 2;
  }

  if (insertMode === "visualTailStart" && visualInsertLine !== undefined) {
    insertLine = visualInsertLine;
  }

  return { insertLine, bgm, bgs };
}

function parseMetadataLine(
  line: string,
): { key: string; value: string } | null {
  const metadata = METADATA_RE.exec(line);
  if (!metadata) return null;
  const key = metadata[1] ?? "";
  const value = (metadata[2] ?? "").trim();
  if (value === "") return null;
  return { key, value };
}

function findSceneTagEndIndex(lines: string[], startIndex: number): number {
  if ((lines[startIndex] ?? "").trim().includes("]")) return startIndex;

  for (let i = startIndex + 1; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "") continue;
    if (trimmed.includes("]")) return i;
  }

  return startIndex;
}

function isInteractiveFile(file: string): boolean {
  return (
    file.includes("investigation_scene_") ||
    file.includes("interrogation_scene_")
  );
}

function isH2Heading(line: string): boolean {
  return /^##\s+/.test(line);
}

function isInteractiveVisualBlockHeading(line: string): boolean {
  return line.startsWith("## Sub-location:") || line.startsWith("## Phase:");
}
