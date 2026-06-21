import type { SoundPlanCue, SoundPlanDiagnostic } from "./types";
import {
  indexVisualUnitsFromMarkdown,
  type VisualUnitIndex,
} from "./visual-units";

export type ApplyMarkdownResult = {
  source: string;
  changed: boolean;
  diagnostics: SoundPlanDiagnostic[];
};

const METADATA_RE = /^-\s+\*\*([A-Za-z][A-Za-z0-9 ]*):\*\*(?:\s+(.*))?\s*$/;
const VISUAL_AUDIO_METADATA_KEYS = new Set(["Background Prompt", "BGM", "BGS"]);

type MetadataSpanMode = "attachedMetadata" | "interactiveVisualTail";
type IndexedCue = {
  cue: SoundPlanCue;
  index: number;
};

export function applyAudioCuesToMarkdown(
  file: string,
  source: string,
  cues: SoundPlanCue[],
): ApplyMarkdownResult {
  const relevant = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => cue.file === file);
  if (relevant.length === 0) {
    return { source, changed: false, diagnostics: [] };
  }

  const diagnostics: SoundPlanDiagnostic[] = [];
  const indexedUnits = indexVisualUnitsFromMarkdown(file, source);
  const units = new Map(indexedUnits.map((unit) => [unit.id, unit]));
  const eol = detectEol(source);
  let lines = source.split(/\r\n|\n/);
  const sorted = relevant.sort((a, b) => {
    const unitA = units.get(a.cue.visualUnit);
    const unitB = units.get(b.cue.visualUnit);
    const lineDelta =
      (unitB?.metadataInsertLine ?? 0) - (unitA?.metadataInsertLine ?? 0);
    return lineDelta === 0 ? a.index - b.index : lineDelta;
  });

  for (const item of sorted) {
    const { cue } = item;
    const unit = units.get(cue.visualUnit);
    if (!unit) {
      diagnostics.push(
        createUnknownVisualUnitDiagnostic(file, indexedUnits, item),
      );
      continue;
    }

    lines = applyCueAtUnit(lines, unit, cue);
  }

  const resultSource = lines.join(eol);
  return {
    source: resultSource,
    changed: resultSource !== source,
    diagnostics,
  };
}

function applyCueAtUnit(
  lines: string[],
  unit: VisualUnitIndex,
  cue: SoundPlanCue,
): string[] {
  const out = [...lines];
  const preferred = Math.max(0, unit.metadataInsertLine - 1);
  const mode = isInteractiveVisualHeading(out[unit.line - 1] ?? "")
    ? "interactiveVisualTail"
    : "attachedMetadata";
  const [metadataStart, metadataEnd] = findMetadataSpan(out, preferred, mode);
  const block = out.slice(metadataStart, metadataEnd);
  const nextBlock = setMetadataValue(block, "BGM", cue.bgm);
  const finalBlock = setMetadataValue(nextBlock, "BGS", cue.bgs);
  out.splice(metadataStart, metadataEnd - metadataStart, ...finalBlock);
  return out;
}

function findMetadataSpan(
  lines: string[],
  preferred: number,
  mode: MetadataSpanMode,
): [number, number] {
  const start = findMetadataStart(lines, preferred, mode);
  return [start, findMetadataEnd(lines, start, mode)];
}

function findMetadataStart(
  lines: string[],
  preferred: number,
  mode: MetadataSpanMode,
): number {
  const bounded = Math.min(Math.max(0, preferred), lines.length);
  if (mode === "interactiveVisualTail") {
    return bounded;
  }

  let cursor = bounded - 1;
  let start = bounded;
  let seenMetadata = false;
  while (cursor >= 0) {
    const line = lines[cursor] ?? "";
    if (line.trim() === "") {
      if (seenMetadata) start = cursor;
      cursor -= 1;
      continue;
    }
    if (!isAllowedMetadataLine(line, mode)) break;
    seenMetadata = true;
    start = cursor;
    cursor -= 1;
  }

  while (start < bounded && (lines[start] ?? "").trim() === "") {
    start += 1;
  }
  return seenMetadata ? start : bounded;
}

function detectEol(source: string): "\r\n" | "\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function createUnknownVisualUnitDiagnostic(
  file: string,
  units: VisualUnitIndex[],
  { cue, index }: IndexedCue,
): SoundPlanDiagnostic {
  const knownIds = units.map((unit) => unit.id).join(", ");
  const knownLabel =
    knownIds.length > 0
      ? `Known visual units: ${knownIds}.`
      : "No visual units found.";
  return {
    code: "audioApplyUnknownVisualUnit",
    path: `${file}:cues[${index}]:${cue.visualUnit}`,
    message: `Audio cue at cues[${index}] targets unknown visual unit "${cue.visualUnit}" in ${file}. ${knownLabel}`,
  };
}

function findMetadataEnd(
  lines: string[],
  start: number,
  mode: MetadataSpanMode,
): number {
  let cursor = start;
  let lastMetadataEnd = start;
  let seenMetadata = false;

  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    if (line.trim() === "") {
      cursor += 1;
      continue;
    }
    if (!isAllowedMetadataLine(line, mode)) break;
    seenMetadata = true;
    cursor += 1;
    lastMetadataEnd = cursor;
  }

  return seenMetadata ? lastMetadataEnd : start;
}

function setMetadataValue(
  block: string[],
  key: "BGM" | "BGS",
  value: string | undefined,
): string[] {
  if (value === undefined) return block;

  const line = `- **${key}:** ${value}`;
  const index = block.findIndex((item) => parseMetadataKey(item) === key);
  if (index >= 0) {
    const copy = [...block];
    copy[index] = line;
    return copy;
  }

  const insertAt = findAudioInsertIndex(block, key);
  const copy = [...block];
  copy.splice(insertAt, 0, line);
  return copy;
}

function findAudioInsertIndex(block: string[], key: "BGM" | "BGS"): number {
  const backgroundIndex = block.findIndex(
    (item) => parseMetadataKey(item) === "Background Prompt",
  );
  const bgmIndex = block.findIndex((item) => parseMetadataKey(item) === "BGM");
  const bgsIndex = block.findIndex((item) => parseMetadataKey(item) === "BGS");

  if (key === "BGM") {
    if (backgroundIndex >= 0) return backgroundIndex + 1;
    if (bgsIndex >= 0) return bgsIndex;
    return block.length;
  }

  if (bgmIndex >= 0) return bgmIndex + 1;
  if (backgroundIndex >= 0) return backgroundIndex + 1;
  return block.length;
}

function isAllowedMetadataLine(line: string, mode: MetadataSpanMode): boolean {
  const key = parseMetadataKey(line);
  if (key === undefined) return false;
  return mode === "attachedMetadata" || VISUAL_AUDIO_METADATA_KEYS.has(key);
}

function parseMetadataKey(line: string): string | undefined {
  const match = METADATA_RE.exec(line.trim());
  return match?.[1];
}

function isInteractiveVisualHeading(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("## Sub-location:") || trimmed.startsWith("## Phase:")
  );
}
