import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseChapter } from "./parser-chapter";
import { parseInvestigationScene } from "./parser-investigation";
import type { ASTEvidence, EvidenceSource } from "./types";

export type EvidenceSourceSuggestion = EvidenceSource | "needs-review";

export type EvidenceSourceAuditItem = {
  sceneFile: string;
  sublocationId: string;
  hotspotId: string;
  hotspotLabel: string;
  hotspotDescription: string;
  currentSource: EvidenceSource | null;
  sceneSourcePrompt: string | null;
  backgroundPrompt: string | null;
  suggestedSource: EvidenceSourceSuggestion;
  evidence: Array<{
    id: string;
    name: string;
    imagePrompt: string | null;
  }>;
};

/**
 * A chapter or scene the audit could not fully process. Surfaced as a
 * structured item (in addition to the stderr log) so the report and
 * programmatic consumers can flag malformed metadata — e.g. an invalid
 * `Evidence Source` value — instead of silently skipping the scene.
 */
export type AuditProblem = {
  sceneFile: string;
  kind:
    | "chapterReadError"
    | "chapterParseError"
    | "sceneReadError"
    | "sceneParseError";
  message: string;
};

export type EvidenceSourceAuditResult = {
  items: EvidenceSourceAuditItem[];
  problems: AuditProblem[];
};

const DEFAULT_SOURCE_ROOTS = ["docs/stories_plan", "static/stories_plan"];
const IMPLIED_WORDS = [
  "監視器",
  "回放",
  "螢幕",
  "monitor",
  "playback",
  "screen",
];
const RECORD_WORDS = [
  "打卡",
  "紀錄",
  "資料",
  "系統",
  "查詢",
  "query",
  "record",
  "system",
];
const PHYSICAL_WORDS = [
  "副本",
  "列印",
  "文件",
  "紙本",
  "表",
  "白板",
  "document",
  "object",
  "physical",
];
const VISIBLE_WORDS = [
  "副本",
  "列印",
  "文件",
  "傘",
  "盒",
  "白板",
  "document",
  "object",
  "physical",
];

export function suggestEvidenceSource(input: {
  label: string;
  description: string;
}): EvidenceSourceSuggestion {
  const text = `${input.label} ${input.description}`.toLowerCase();

  if (containsAny(text, IMPLIED_WORDS)) {
    return "implied";
  }

  if (containsAny(text, RECORD_WORDS)) {
    return containsAny(text, PHYSICAL_WORDS) ? "visible" : "hidden";
  }

  if (containsAny(text, VISIBLE_WORDS)) {
    return "visible";
  }

  return "needs-review";
}

export function auditEvidenceSources(
  sourceRoots: string[] = DEFAULT_SOURCE_ROOTS,
): EvidenceSourceAuditResult {
  const items: EvidenceSourceAuditItem[] = [];
  const problems: AuditProblem[] = [];

  for (const sourceRoot of sourceRoots) {
    const root = resolve(sourceRoot);
    if (!existsSync(root)) continue;

    const chapterDirs = readdirSync(root)
      .filter(
        (entry) =>
          /^chapter_\d+$/.test(entry) &&
          statSync(resolve(root, entry)).isDirectory(),
      )
      .sort(byChapterNumber);

    for (const chapterDirName of chapterDirs) {
      const chapterRoot = resolve(root, chapterDirName);
      const manifestRef = `${chapterDirName}/chapter.md`;
      const manifestPath = resolve(chapterRoot, "chapter.md");
      // The audit reports migration work; it must not abort on a single
      // unreadable, missing, or malformed file. Surface read/parse errors as
      // structured problems (and on stderr) and keep going.
      let chapterSource: string;
      try {
        chapterSource = readFileSync(manifestPath, "utf-8");
      } catch (err) {
        recordProblem(
          problems,
          "chapterReadError",
          manifestRef,
          toMessage(err),
        );
        continue;
      }
      const chapter = parseChapter(chapterSource, manifestRef, chapterDirName);
      if (!chapter.ok) {
        recordProblem(
          problems,
          "chapterParseError",
          manifestRef,
          chapter.error.message,
        );
        continue;
      }

      for (const file of chapter.value.sceneFiles) {
        if (!file.startsWith("investigation_scene_")) continue;

        const sceneFile = `${chapterDirName}/${file}`;
        const scenePath = resolve(chapterRoot, file);
        let sceneSource: string;
        try {
          sceneSource = readFileSync(scenePath, "utf-8");
        } catch (err) {
          recordProblem(problems, "sceneReadError", sceneFile, toMessage(err));
          continue;
        }
        const scene = parseInvestigationScene(
          sceneSource,
          sceneFile,
          file.replace(/\.md$/, ""),
        );
        if (!scene.ok) {
          recordProblem(
            problems,
            "sceneParseError",
            sceneFile,
            scene.error.message,
          );
          continue;
        }

        const evidenceById = new Map(
          scene.value.evidenceManifest.map((evidence) => [
            evidence.id,
            evidence,
          ]),
        );

        for (const sublocation of scene.value.sublocations) {
          for (const hotspot of sublocation.hotspots) {
            const revealedEvidence = hotspot.reveals
              .filter((reveal) => reveal.kind === "evidence")
              .map((reveal) => evidenceById.get(reveal.id))
              .filter((evidence): evidence is ASTEvidence => Boolean(evidence));

            if (revealedEvidence.length === 0) continue;

            items.push({
              sceneFile,
              sublocationId: sublocation.id,
              hotspotId: hotspot.id,
              hotspotLabel: hotspot.label,
              hotspotDescription: hotspot.description,
              currentSource: hotspot.evidenceSource,
              sceneSourcePrompt: hotspot.sceneSourcePrompt,
              backgroundPrompt: sublocation.assetCue?.backgroundPrompt ?? null,
              suggestedSource: suggestEvidenceSource({
                label: hotspot.label,
                description: hotspot.description,
              }),
              evidence: revealedEvidence.map((evidence) => ({
                id: evidence.id,
                name: evidence.name,
                imagePrompt: evidence.imageCue.imagePrompt,
              })),
            });
          }
        }
      }
    }
  }

  return { items, problems };
}

/** Log a skip reason to stderr and record it as a structured audit problem. */
function recordProblem(
  problems: AuditProblem[],
  kind: AuditProblem["kind"],
  sceneFile: string,
  message: string,
): void {
  console.error(`[evidence-sources-audit] skipping ${sceneFile}: ${message}`);
  problems.push({ sceneFile, kind, message });
}

function containsAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function byChapterNumber(a: string, b: string): number {
  const aNumber = Number(/^chapter_(\d+)$/.exec(a)?.[1] ?? 0);
  const bNumber = Number(/^chapter_(\d+)$/.exec(b)?.[1] ?? 0);
  return aNumber - bNumber || a.localeCompare(b);
}

/** Coerce a thrown value (fs errors are Error instances) into a string. */
function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function printReport(result: EvidenceSourceAuditResult): void {
  const { items, problems } = result;
  if (items.length === 0) {
    console.log("No evidence-revealing hotspots found.");
  } else {
    console.log(`Evidence source audit: ${items.length} hotspot(s)`);
    for (const item of items) {
      console.log(
        [
          `- ${item.sceneFile} ${item.sublocationId}/${item.hotspotId}`,
          `  label: ${item.hotspotLabel}`,
          `  description: ${item.hotspotDescription}`,
          `  current: ${item.currentSource ?? "missing"}; suggested: ${item.suggestedSource}`,
          "  evidence:",
          ...item.evidence.flatMap((entry) => [
            `    - ${entry.id} (${entry.name})`,
            `      imagePrompt: ${entry.imagePrompt ?? "missing"}`,
          ]),
        ].join("\n"),
      );
      if (item.sceneSourcePrompt) {
        console.log(`  scene source prompt: ${item.sceneSourcePrompt}`);
      }
      if (item.backgroundPrompt) {
        console.log(`  background prompt: ${item.backgroundPrompt}`);
      }
    }
  }

  if (problems.length > 0) {
    console.log(`Problems (${problems.length}):`);
    for (const problem of problems) {
      console.log(
        `  - [${problem.kind}] ${problem.sceneFile}: ${problem.message}`,
      );
    }
  }
}

if (import.meta.main) {
  const roots = process.argv.slice(2);
  printReport(
    auditEvidenceSources(roots.length > 0 ? roots : DEFAULT_SOURCE_ROOTS),
  );
}
