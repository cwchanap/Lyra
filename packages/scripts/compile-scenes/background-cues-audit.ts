import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BackgroundCueSceneType =
  | "linear"
  | "investigation"
  | "interrogation"
  | "analysis";

export type BackgroundCueAuditItem = {
  cueKey: string;
  sceneFile: string;
  sceneType: BackgroundCueSceneType;
  cuePath: string;
  backgroundAssetId: string | null;
  expectedPath: string | null;
  fileMissing: boolean;
};

export type BackgroundCueAuditProblem = {
  kind:
    | "chapterManifestReadError"
    | "chapterManifestParseError"
    | "chapterManifestShapeInvalid"
    | "chapterEntryInvalid"
    | "chapterNotFound"
    | "sceneEntryInvalid"
    | "sceneTypeInvalid"
    | "sceneReadError"
    | "sceneParseError"
    | "sceneShapeInvalid"
    | "assetManifestReadError"
    | "assetManifestParseError"
    | "assetManifestShapeInvalid"
    | "assetManifestEntryInvalid"
    | "duplicateBackgroundAssetId"
    | "backgroundAssetIdInvalid"
    | "backgroundAssetMissingFromManifest";
  inputPath: string;
  message: string;
};

export type BackgroundCueAuditResult = {
  items: BackgroundCueAuditItem[];
  problems: BackgroundCueAuditProblem[];
};

export type BackgroundCueAuditOptions = {
  repoRoot?: string;
  chapterId?: string;
};

type ChapterEntry = {
  id: string;
  scenes: unknown[];
};

type SceneEntry = {
  type: BackgroundCueSceneType;
  file: string;
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCENES_DIRECTORY = "apps/game/src-tauri/resources/scenes";
const ASSETS_DIRECTORY = "apps/game/src-tauri/resources/assets";
const CHAPTER_MANIFEST_FILE = "chapters.json";
const ASSET_MANIFEST_FILE = "manifest.json";
const VALID_SCENE_TYPES = new Set<BackgroundCueSceneType>([
  "linear",
  "investigation",
  "interrogation",
  "analysis",
]);
const VALID_DECISIONS = new Set([
  "keep",
  "prompt-adjust",
  "regenerate",
  "add-variant",
]);
const VALID_PRIORITIES = new Set(["A", "B"]);

/**
 * Reads compiler-owned output and emits one row for every object that owns a
 * `backgroundAssetId` property. The traversal is deliberately structural:
 * this inventory does not infer location, narrative purpose, or art quality.
 */
export function auditBackgroundCues(
  options: BackgroundCueAuditOptions = {},
): BackgroundCueAuditResult {
  const result: BackgroundCueAuditResult = { items: [], problems: [] };
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const scenesRoot = resolve(repoRoot, SCENES_DIRECTORY);
  const assetsRoot = resolve(repoRoot, ASSETS_DIRECTORY);
  const assetManifestPath = resolve(assetsRoot, ASSET_MANIFEST_FILE);
  const chapterManifestPath = resolve(scenesRoot, CHAPTER_MANIFEST_FILE);

  const assetManifest = readJsonFile({
    path: assetManifestPath,
    inputPath: `${ASSETS_DIRECTORY}/${ASSET_MANIFEST_FILE}`,
    readKind: "assetManifestReadError",
    parseKind: "assetManifestParseError",
    result,
  });
  const backgroundAssets = readBackgroundAssets(assetManifest, result);

  const chapterManifest = readJsonFile({
    path: chapterManifestPath,
    inputPath: `${SCENES_DIRECTORY}/${CHAPTER_MANIFEST_FILE}`,
    readKind: "chapterManifestReadError",
    parseKind: "chapterManifestParseError",
    result,
  });
  const chapters = readChapters(chapterManifest, result);
  const selectedChapters = selectChapters(chapters, options.chapterId, result);

  for (const chapter of selectedChapters) {
    for (const rawScene of chapter.scenes) {
      const scene = readSceneEntry(rawScene, chapter.id, result);
      if (!scene) continue;

      const scenePath = resolve(scenesRoot, scene.file);
      const sceneJson = readJsonFile({
        path: scenePath,
        inputPath: scene.file,
        readKind: "sceneReadError",
        parseKind: "sceneParseError",
        result,
      });
      if (!isRecord(sceneJson)) {
        if (sceneJson !== undefined) {
          recordProblem(
            result,
            "sceneShapeInvalid",
            scene.file,
            "Compiled scene JSON must be an object.",
          );
        }
        continue;
      }

      collectBackgroundCues({
        value: sceneJson,
        path: [],
        scene,
        repoRoot,
        backgroundAssets,
        result,
      });
    }
  }

  return result;
}

/** Whether the CLI should fail before optional report-coverage validation. */
export function backgroundCueAuditShouldFail(
  result: BackgroundCueAuditResult,
): boolean {
  return (
    result.problems.length > 0 || result.items.some((item) => item.fileMissing)
  );
}

/**
 * Checks that a human-written background report covers the exact current cue
 * inventory. It validates only row identity and allowed decision/priority
 * values; semantic judgments remain owned by the human report.
 */
export function checkBackgroundAuditCoverage(
  result: BackgroundCueAuditResult,
  reportMarkdown: string,
): string[] {
  const parsed = parseCueDecisionTable(reportMarkdown);
  if (parsed.errors.length > 0) return parsed.errors;

  const errors: string[] = [];
  const inventoryKeys = new Set(result.items.map((item) => item.cueKey));
  const reportedKeys = new Set<string>();

  for (const row of parsed.rows) {
    if (reportedKeys.has(row.cueKey)) {
      errors.push(`Duplicate cue key in report: ${row.cueKey}`);
    }
    reportedKeys.add(row.cueKey);

    if (!inventoryKeys.has(row.cueKey)) {
      errors.push(`Stale cue key in report: ${row.cueKey}`);
    }

    if (!row.decision) {
      errors.push(`Blank Decision for cue key: ${row.cueKey}`);
    } else if (!VALID_DECISIONS.has(row.decision)) {
      errors.push(
        `Unsupported Decision "${row.decision}" for cue key: ${row.cueKey}`,
      );
    }

    if (!row.priority) {
      errors.push(`Blank Priority for cue key: ${row.cueKey}`);
    } else if (!VALID_PRIORITIES.has(row.priority)) {
      errors.push(
        `Unsupported Priority "${row.priority}" for cue key: ${row.cueKey}`,
      );
    }
  }

  for (const item of result.items) {
    if (!reportedKeys.has(item.cueKey)) {
      errors.push(`Missing cue key in report: ${item.cueKey}`);
    }
  }

  return errors;
}

function readJsonFile(input: {
  path: string;
  inputPath: string;
  readKind: Extract<
    BackgroundCueAuditProblem["kind"],
    "chapterManifestReadError" | "assetManifestReadError" | "sceneReadError"
  >;
  parseKind: Extract<
    BackgroundCueAuditProblem["kind"],
    "chapterManifestParseError" | "assetManifestParseError" | "sceneParseError"
  >;
  result: BackgroundCueAuditResult;
}): unknown | undefined {
  let source: string;
  try {
    source = readFileSync(input.path, "utf-8");
  } catch (error) {
    recordProblem(
      input.result,
      input.readKind,
      input.inputPath,
      toMessage(error),
    );
    return undefined;
  }

  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    recordProblem(
      input.result,
      input.parseKind,
      input.inputPath,
      toMessage(error),
    );
    return undefined;
  }
}

function readBackgroundAssets(
  manifest: unknown | undefined,
  result: BackgroundCueAuditResult,
): Map<string, string> {
  const backgroundAssets = new Map<string, string>();
  if (manifest === undefined) return backgroundAssets;
  if (!isRecord(manifest) || !Array.isArray(manifest.entries)) {
    recordProblem(
      result,
      "assetManifestShapeInvalid",
      `${ASSETS_DIRECTORY}/${ASSET_MANIFEST_FILE}`,
      "Generated asset manifest must contain an entries array.",
    );
    return backgroundAssets;
  }

  for (const [index, rawEntry] of manifest.entries.entries()) {
    const inputPath = `${ASSETS_DIRECTORY}/${ASSET_MANIFEST_FILE}#/entries/${index}`;
    if (!isRecord(rawEntry)) {
      recordProblem(
        result,
        "assetManifestEntryInvalid",
        inputPath,
        "Generated asset manifest entry must be an object.",
      );
      continue;
    }
    if (rawEntry.type !== "background") continue;
    if (
      typeof rawEntry.assetId !== "string" ||
      !rawEntry.assetId ||
      typeof rawEntry.expectedPath !== "string" ||
      !rawEntry.expectedPath
    ) {
      recordProblem(
        result,
        "assetManifestEntryInvalid",
        inputPath,
        "Background asset manifest entries require non-empty assetId and expectedPath strings.",
      );
      continue;
    }
    if (backgroundAssets.has(rawEntry.assetId)) {
      recordProblem(
        result,
        "duplicateBackgroundAssetId",
        inputPath,
        `Generated asset manifest repeats background asset id "${rawEntry.assetId}".`,
      );
      continue;
    }
    backgroundAssets.set(rawEntry.assetId, rawEntry.expectedPath);
  }

  return backgroundAssets;
}

function readChapters(
  manifest: unknown | undefined,
  result: BackgroundCueAuditResult,
): ChapterEntry[] {
  if (manifest === undefined) return [];
  if (!isRecord(manifest) || !Array.isArray(manifest.chapters)) {
    recordProblem(
      result,
      "chapterManifestShapeInvalid",
      `${SCENES_DIRECTORY}/${CHAPTER_MANIFEST_FILE}`,
      "Generated chapter manifest must contain a chapters array.",
    );
    return [];
  }

  const chapters: ChapterEntry[] = [];
  for (const [index, rawChapter] of manifest.chapters.entries()) {
    const inputPath = `${SCENES_DIRECTORY}/${CHAPTER_MANIFEST_FILE}#/chapters/${index}`;
    if (
      !isRecord(rawChapter) ||
      typeof rawChapter.id !== "string" ||
      !rawChapter.id ||
      !Array.isArray(rawChapter.scenes)
    ) {
      recordProblem(
        result,
        "chapterEntryInvalid",
        inputPath,
        "Generated chapter entries require an id and scenes array.",
      );
      continue;
    }
    chapters.push({ id: rawChapter.id, scenes: rawChapter.scenes });
  }
  return chapters;
}

function selectChapters(
  chapters: ChapterEntry[],
  chapterId: string | undefined,
  result: BackgroundCueAuditResult,
): ChapterEntry[] {
  if (!chapterId) return chapters;
  const chapter = chapters.find((candidate) => candidate.id === chapterId);
  if (chapter) return [chapter];
  recordProblem(
    result,
    "chapterNotFound",
    `${SCENES_DIRECTORY}/${CHAPTER_MANIFEST_FILE}`,
    `Generated chapter manifest does not contain chapter "${chapterId}".`,
  );
  return [];
}

function readSceneEntry(
  value: unknown,
  chapterId: string,
  result: BackgroundCueAuditResult,
): SceneEntry | null {
  if (!isRecord(value) || typeof value.file !== "string" || !value.file) {
    recordProblem(
      result,
      "sceneEntryInvalid",
      `${SCENES_DIRECTORY}/${CHAPTER_MANIFEST_FILE}#${chapterId}`,
      "Generated scene entries require a file string.",
    );
    return null;
  }
  if (value.file.startsWith("/") || value.file.split("/").includes("..")) {
    recordProblem(
      result,
      "sceneEntryInvalid",
      value.file,
      "Generated scene file must be relative to the scenes resource directory.",
    );
    return null;
  }
  if (!isSceneType(value.type)) {
    recordProblem(
      result,
      "sceneTypeInvalid",
      value.file,
      `Generated scene type must be linear, investigation, interrogation, or analysis; got ${String(value.type)}.`,
    );
    return null;
  }
  return { type: value.type, file: value.file };
}

function collectBackgroundCues(input: {
  value: unknown;
  path: string[];
  scene: SceneEntry;
  repoRoot: string;
  backgroundAssets: Map<string, string>;
  result: BackgroundCueAuditResult;
}): void {
  if (Array.isArray(input.value)) {
    for (const [index, value] of input.value.entries()) {
      collectBackgroundCues({
        ...input,
        value,
        path: [...input.path, String(index)],
      });
    }
    return;
  }
  if (!isRecord(input.value)) return;

  if (Object.hasOwn(input.value, "backgroundAssetId")) {
    const cuePath = pointerFor([...input.path, "backgroundAssetId"]);
    const rawAssetId = input.value.backgroundAssetId;
    const backgroundAssetId =
      rawAssetId === null || typeof rawAssetId === "string" ? rawAssetId : null;
    if (backgroundAssetId === null && rawAssetId !== null) {
      recordProblem(
        input.result,
        "backgroundAssetIdInvalid",
        `${input.scene.file}#${cuePath}`,
        "backgroundAssetId must be a string or null.",
      );
    }

    const expectedPath =
      backgroundAssetId === null
        ? null
        : (input.backgroundAssets.get(backgroundAssetId) ?? null);
    if (backgroundAssetId !== null && expectedPath === null) {
      recordProblem(
        input.result,
        "backgroundAssetMissingFromManifest",
        input.scene.file,
        `No generated background asset manifest entry exists for "${backgroundAssetId}" at ${cuePath}.`,
      );
    }

    input.result.items.push({
      cueKey: `${input.scene.file}::${cuePath}`,
      sceneFile: input.scene.file,
      sceneType: input.scene.type,
      cuePath,
      backgroundAssetId,
      expectedPath,
      fileMissing:
        expectedPath !== null &&
        !existsSync(resolve(input.repoRoot, expectedPath)),
    });
  }

  for (const [key, value] of Object.entries(input.value)) {
    collectBackgroundCues({ ...input, value, path: [...input.path, key] });
  }
}

function pointerFor(segments: string[]): string {
  return `/${segments
    .map((segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("/")}`;
}

function parseCueDecisionTable(reportMarkdown: string): {
  rows: Array<{ cueKey: string; decision: string; priority: string }>;
  errors: string[];
} {
  const lines = reportMarkdown.split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) =>
    /^##\s+Cue decisions\s*$/i.test(line.trim()),
  );
  if (sectionIndex === -1) {
    return { rows: [], errors: ["Missing ## Cue decisions section."] };
  }

  let headerIndex = -1;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^#{1,6}\s/.test(line.trim())) break;
    if (line.trim().startsWith("|")) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex === -1) {
    return { rows: [], errors: ["Missing Cue decisions table."] };
  }

  const headers = splitTableRow(lines[headerIndex] ?? "").map((value) =>
    value.toLowerCase(),
  );
  const decisionIndex = headers.indexOf("decision");
  const priorityIndex = headers.indexOf("priority");
  const errors: string[] = [];
  if (decisionIndex === -1) {
    errors.push("Cue decisions table is missing a Decision column.");
  }
  if (priorityIndex === -1) {
    errors.push("Cue decisions table is missing a Priority column.");
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: Array<{ cueKey: string; decision: string; priority: string }> =
    [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || !trimmed.startsWith("|")) {
      break;
    }
    const values = splitTableRow(line);
    if (isTableSeparator(values)) continue;
    const cueKey = normalizeTableCell(values[0] ?? "");
    if (!cueKey) {
      errors.push("Blank cue key in report.");
      continue;
    }
    rows.push({
      cueKey,
      decision: normalizeTableCell(values[decisionIndex] ?? ""),
      priority: normalizeTableCell(values[priorityIndex] ?? ""),
    });
  }

  return { rows, errors };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return body.split("|").map((value) => value.trim());
}

function isTableSeparator(values: string[]): boolean {
  return (
    values.length > 0 && values.every((value) => /^:?-{3,}:?$/.test(value))
  );
}

function normalizeTableCell(value: string): string {
  const trimmed = value.trim();
  const code = /^`([^`]+)`$/.exec(trimmed);
  return code?.[1] ?? trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSceneType(value: unknown): value is BackgroundCueSceneType {
  return (
    typeof value === "string" &&
    VALID_SCENE_TYPES.has(value as BackgroundCueSceneType)
  );
}

function recordProblem(
  result: BackgroundCueAuditResult,
  kind: BackgroundCueAuditProblem["kind"],
  inputPath: string,
  message: string,
): void {
  result.problems.push({ kind, inputPath, message });
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printBackgroundCueAudit(result: BackgroundCueAuditResult): void {
  if (result.items.length === 0) {
    console.log("No background cue occurrences found.");
  } else {
    console.log(
      `Background cue audit: ${result.items.length} cue occurrence(s)`,
    );
    console.log(
      "| Cue key | Scene file | Scene type | Cue path | Background asset ID | Expected path | File missing |",
    );
    console.log("| --- | --- | --- | --- | --- | --- | --- |");
    for (const item of result.items) {
      console.log(
        `| ${item.cueKey} | ${item.sceneFile} | ${item.sceneType} | ${item.cuePath} | ${item.backgroundAssetId ?? "null"} | ${item.expectedPath ?? "null"} | ${item.fileMissing ? "yes" : "no"} |`,
      );
    }
  }

  if (result.problems.length > 0) {
    console.error(`Background cue audit problems (${result.problems.length}):`);
    for (const problem of result.problems) {
      console.error(
        `  - [${problem.kind}] ${problem.inputPath}: ${problem.message}`,
      );
    }
  }
}

function parseCliArguments(
  args: string[],
):
  | { ok: true; chapterId: string | undefined; reportPath: string | undefined }
  | { ok: false; message: string } {
  let chapterId: string | undefined;
  let reportPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--chapter" || argument === "--check-report") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, message: `${argument} requires a value.` };
      }
      if (argument === "--chapter") {
        chapterId = value;
      } else {
        reportPath = value;
      }
      index += 1;
      continue;
    }
    return { ok: false, message: `Unknown argument: ${argument}` };
  }

  return { ok: true, chapterId, reportPath };
}

function printUsage(message: string): void {
  console.error(
    `Usage: bun run background-cues:audit [--chapter <chapter-id>] [--check-report <report.md>]\n${message}`,
  );
}

if (import.meta.main) {
  const cli = parseCliArguments(process.argv.slice(2));
  if (!cli.ok) {
    printUsage(cli.message);
    process.exitCode = 2;
  } else {
    const result = auditBackgroundCues(
      cli.chapterId ? { chapterId: cli.chapterId } : {},
    );
    printBackgroundCueAudit(result);
    if (backgroundCueAuditShouldFail(result)) process.exitCode = 1;

    if (cli.reportPath) {
      const reportPath = resolve(REPO_ROOT, cli.reportPath);
      let reportMarkdown: string | undefined;
      try {
        reportMarkdown = readFileSync(reportPath, "utf-8");
      } catch (error) {
        console.error(
          `Unable to read background audit report ${cli.reportPath}: ${toMessage(error)}`,
        );
        process.exitCode = 1;
      }
      if (reportMarkdown !== undefined) {
        const coverageErrors = checkBackgroundAuditCoverage(
          result,
          reportMarkdown,
        );
        if (coverageErrors.length > 0) {
          console.error(
            `Background cue audit coverage errors (${coverageErrors.length}):`,
          );
          for (const error of coverageErrors) {
            console.error(`  - ${error}`);
          }
          process.exitCode = 1;
        }
      }
    }
  }
}
