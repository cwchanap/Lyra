// =============================================================================
// apps/layout-editor/scripts/verify-focused-edit-real-content.ts
//
// HPA-135 Task 1 hard gate: proves against REAL Chapter 1 data (authored
// Markdown + compiled resources) that compiler-owned source identity works
// end to end:
//   1. direct Reader dialogue resolves to its authored physical line;
//   2. a single-line action resolves likewise;
//   3. at least one metadata-wrapped interrogation Reader item resolves to
//      the OUTER metadata token's line;
//   4. investigation carriers resolve through dialogueSegmentCarrierId()
//      (never raw segment array order);
//   5. scene-owned Background Prompts resolve from the typed manifest's
//      unitId + promptLine + authoredPrompt;
//   6. evidence Image Prompts resolve from evidenceId + promptLine +
//      authoredPrompt;
//   7. every sampled source value equals the compiled Reader/manifest value
//      (a no-op renderSceneSourceReplacement() must succeed byte-for-byte);
//   8. compiler-only source metadata never leaks into production scene JSON.
//
// Exits non-zero with a diagnostic on any mismatch. If the compiled resource
// tree is missing, run `bun run scenes:compile` first.
// =============================================================================

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChaptersIndex } from "@lyra/scene-types";
import type { AssetManifest } from "@lyra/scripts/compile-scenes/assets/manifest";
import {
  deriveDialogueSegments,
  dialogueSegmentCarrierId,
  resolveDialogueItemSource,
} from "@lyra/scripts/compile-scenes/dialogue-segment-origins";
import { NO_NEW_FINDINGS_DIALOGUE } from "@lyra/scripts/compile-scenes/semantic-defaults";
import { parseInterrogationScene } from "@lyra/scripts/compile-scenes/parser-interrogation";
import { parseInvestigationScene } from "@lyra/scripts/compile-scenes/parser-investigation";
import { parseLinearScene } from "@lyra/scripts/compile-scenes/parser-linear";
import { tokenize } from "@lyra/scripts/compile-scenes/tokenizer";
import type {
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
} from "@lyra/scripts/compile-scenes/types";
import {
  renderSceneSourceReplacement,
  type WorkbenchSourceTarget,
} from "@lyra/scripts/workbench/source-edit-targets";
import type { WorkbenchScenePayload } from "../src/lib/workbench-types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const resourcesRoot = resolve(repoRoot, "apps/game/src-tauri/resources/scenes");
const assetsRoot = resolve(repoRoot, "apps/game/src-tauri/resources/assets");

function fail(message: string): never {
  console.error(`verify-focused-edit-real-content: FAIL — ${message}`);
  process.exit(1);
}

function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) fail(message);
  return value;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    fail(`${path} not found — run \`bun run scenes:compile\` first`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function readSource(relativePath: string): string {
  const full = resolve(repoRoot, relativePath);
  if (!existsSync(full)) fail(`authored source missing: ${relativePath}`);
  return readFileSync(full, "utf8");
}

function lineAt(content: string, line: number): string {
  const raw = content.split("\n")[line - 1];
  return must(raw, `source has no line ${line}`);
}

/**
 * Compiled-vs-source equality + byte-locality proof: the probe replacement
 * only succeeds when the compiled value still sits at the compiler-provided
 * physical line, and it is verified to touch exactly that line while every
 * other byte of the document survives. Nothing is written to disk.
 */
const PROBE_SUFFIX = "【HPA-135驗證】";

function assertProbeRender(
  target: WorkbenchSourceTarget,
  source: string,
): void {
  const replacementText = `${target.currentText}${PROBE_SUFFIX}`;
  const result = renderSceneSourceReplacement({
    source,
    target,
    replacementText,
  });
  if (!result.ok) {
    fail(
      `probe render rejected for ${target.semanticRef} (line ${target.line}): ` +
        `${result.diagnostic.code} ${result.diagnostic.message}`,
    );
  }
  const before = source.split("\n");
  const after = result.nextContent.split("\n");
  if (before.length !== after.length) {
    fail(
      `probe render for ${target.semanticRef} changed the physical line count`,
    );
  }
  const changed = before
    .map((line, index) => (line === after[index] ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length !== 1 || changed[0] !== target.line - 1) {
    fail(
      `probe render for ${target.semanticRef} changed lines [${changed}] instead of exactly line ${target.line}`,
    );
  }
  const originalLine = must(before[target.line - 1], "missing target line");
  const valueIndex = originalLine.lastIndexOf(target.currentText);
  if (valueIndex < 0) {
    fail(
      `probe render for ${target.semanticRef}: compiled value absent from line ${target.line}`,
    );
  }
  const expectedLine =
    originalLine.slice(0, valueIndex) +
    replacementText +
    originalLine.slice(valueIndex + target.currentText.length);
  if (after[target.line - 1] !== expectedLine) {
    fail(
      `probe render for ${target.semanticRef} did not preserve the surrounding bytes of line ${target.line}`,
    );
  }
}

interface SceneContext {
  chapterId: string;
  sceneId: string;
  sourcePath: string;
  source: string;
  compiled: WorkbenchScenePayload;
  segments: ReturnType<typeof deriveDialogueSegments>;
}

function segmentTargets(
  context: SceneContext,
  options: { metadataWrappedOnly?: boolean } = {},
): WorkbenchSourceTarget[] {
  const targets: WorkbenchSourceTarget[] = [];
  for (const segment of context.segments) {
    const carrierId = dialogueSegmentCarrierId(segment.origin);
    for (const [itemIndex, item] of segment.items.entries()) {
      if (item.kind === "sceneTag") continue; // scene tags are not v1 targets
      const resolution = resolveDialogueItemSource(
        context.segments,
        carrierId,
        itemIndex,
      );
      if (!resolution.ok) {
        // Compiler-synthesized default re-examinations have no authored
        // source and are never editable targets. Anything else that fails
        // to resolve is real compiled-vs-source drift.
        if (item.text !== NO_NEW_FINDINGS_DIALOGUE[0]!.text) {
          fail(
            `carrier "${carrierId}" item ${itemIndex} in ${context.sceneId} failed to resolve: ${resolution.error.message}`,
          );
        }
        continue;
      }
      if (resolution.ok) {
        const raw = lineAt(context.source, resolution.line);
        // Multiline bracket-block actions are intentionally read-only in v1
        // (the focused-edit seam rejects them), so sampling must not probe
        // them as editable targets. Same predicate as multilineReaderActionRefs.
        const trimmed = raw.trim();
        const token = tokenize(trimmed, "")[0];
        if (
          item.kind === "action" &&
          token?.kind === "unknown" &&
          trimmed.startsWith("[")
        ) {
          continue;
        }
        const wrapped = /^\s*-\s+\*\*[A-Za-z][A-Za-z0-9 ]*:\*\*/.test(raw);
        if (options.metadataWrappedOnly && !wrapped) continue;
        targets.push({
          semanticRef: `reader:${item.kind === "action" ? "action" : "dialogue"}:${carrierId}:${itemIndex}`,
          kind: item.kind === "action" ? "readerAction" : "readerDialogue",
          line: resolution.line,
          currentText: item.text,
        });
      }
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Load the compiled chapter_1 manifest.
// ---------------------------------------------------------------------------

const chapters = readJson(
  resolve(resourcesRoot, "chapters.json"),
) as ChaptersIndex;
const chapter = must(
  chapters.chapters.find(({ id }) => id === "chapter_1"),
  "chapter_1 missing from compiled manifest",
);

function sceneContext(sceneFile: string): SceneContext {
  const entry = must(
    chapter.scenes.find(({ file }) => file.endsWith(`${sceneFile}.json`)),
    `chapter_1 scene ${sceneFile} missing from compiled manifest`,
  );
  const compiled = readJson(
    resolve(resourcesRoot, entry.file),
  ) as WorkbenchScenePayload;
  if (compiled.type !== (entry.type as WorkbenchScenePayload["type"])) {
    fail(
      `${sceneFile}: manifest type ${entry.type} != compiled ${compiled.type}`,
    );
  }
  const sourcePath = `docs/stories_plan/${entry.file.replace(/\.json$/, ".md")}`;
  const source = readSource(sourcePath);
  const chapterId = chapter.id;
  const sceneId = sceneFile;
  const ast = parseSource(sceneFile, source, compiled);
  const segments = deriveDialogueSegments({
    chapterId,
    json: compiled,
    sourceAst: ast,
  });
  return { chapterId, sceneId, sourcePath, source, compiled, segments };
}

function parseSource(
  sceneFile: string,
  source: string,
  compiled: WorkbenchScenePayload,
): ASTLinearScene | ASTInvestigationScene | ASTInterrogationScene {
  const sourceFile = `docs/stories_plan/chapter_1/${sceneFile}.md`;
  if (compiled.type === "linear") {
    const parsed = parseLinearScene(source, sourceFile, sceneFile);
    if (!parsed.ok)
      fail(`${sceneFile} failed to parse: ${parsed.error.message}`);
    return parsed.value;
  }
  if (compiled.type === "investigation") {
    const parsed = parseInvestigationScene(source, sourceFile, sceneFile);
    if (!parsed.ok)
      fail(`${sceneFile} failed to parse: ${parsed.error.message}`);
    return parsed.value;
  }
  if (compiled.type === "interrogation") {
    const parsed = parseInterrogationScene(source, sourceFile, sceneFile);
    if (!parsed.ok)
      fail(`${sceneFile} failed to parse: ${parsed.error.message}`);
    return parsed.value;
  }
  fail(`${sceneFile}: unsupported compiled scene type for this verifier`);
}

// ---------------------------------------------------------------------------
// 1+2. Direct Reader dialogue and single-line action (first linear scene).
// ---------------------------------------------------------------------------

const linearEntry = must(
  chapter.scenes.find(({ type }) => type === "linear"),
  "chapter_1 has no linear scene",
);
const linearSceneId = linearEntry.file
  .replace(/^.*\//, "")
  .replace(/\.json$/, "");
const linearContext = sceneContext(linearSceneId);
const directTargets = segmentTargets(linearContext).filter((target) => {
  const raw = lineAt(linearContext.source, target.line);
  // Direct lines are authored dialogue/action lines, not metadata bullets.
  return !/^\s*-\s+\*\*[A-Za-z][A-Za-z0-9 ]*:\*\*/.test(raw);
});
must(
  directTargets.find((target) => target.kind === "readerDialogue"),
  `${linearSceneId}: no direct Reader dialogue target resolved`,
);
must(
  directTargets.find((target) => target.kind === "readerAction"),
  `${linearSceneId}: no single-line action target resolved`,
);
for (const target of directTargets)
  assertProbeRender(target, linearContext.source);
console.log(
  `direct Reader targets: ${directTargets.length} resolved from ${linearSceneId} (dialogue + single-line action)`,
);

// ---------------------------------------------------------------------------
// 3. Metadata-wrapped interrogation Reader items (outer metadata line).
// ---------------------------------------------------------------------------

const interrogationEntry = must(
  chapter.scenes.find(
    ({ type, file }) =>
      type === "interrogation" && /interrogation_scene_4\.json$/.test(file),
  ),
  "chapter_1 interrogation_scene_4 missing from compiled manifest",
);
const interrogationSceneId = interrogationEntry.file
  .replace(/^.*\//, "")
  .replace(/\.json$/, "");
const interrogationContext = sceneContext(interrogationSceneId);
const wrappedTargets = segmentTargets(interrogationContext, {
  metadataWrappedOnly: true,
});
if (wrappedTargets.length === 0) {
  fail(
    `${interrogationSceneId}: no metadata-wrapped Reader item resolved to the outer metadata line`,
  );
}
for (const target of wrappedTargets) {
  assertProbeRender(target, interrogationContext.source);
}
console.log(
  `metadata-wrapped interrogation targets: ${wrappedTargets.length} resolved from ${interrogationSceneId}`,
);

// ---------------------------------------------------------------------------
// 4. Investigation carrier mapping via carrier IDs (never segment order).
// ---------------------------------------------------------------------------

const investigationEntry = must(
  chapter.scenes.find(
    ({ type, file }) =>
      type === "investigation" && /investigation_scene_1\.json$/.test(file),
  ),
  "chapter_1 investigation_scene_1 missing from compiled manifest",
);
const investigationSceneId = investigationEntry.file
  .replace(/^.*\//, "")
  .replace(/\.json$/, "");
const investigationContext = sceneContext(investigationSceneId);
const carrierIds = investigationContext.segments.map((segment) =>
  dialogueSegmentCarrierId(segment.origin),
);
if (new Set(carrierIds).size !== carrierIds.length) {
  fail(`${investigationSceneId}: duplicate carrier ids`);
}
// Every lookup goes through dialogueSegmentCarrierId() + resolveDialogueItemSource().
const investigationTargets = segmentTargets(investigationContext);
for (const target of investigationTargets) {
  assertProbeRender(target, investigationContext.source);
}
console.log(
  `investigation carriers: ${carrierIds.length} mapped and ${investigationTargets.length} items resolved for ${investigationSceneId}`,
);

// ---------------------------------------------------------------------------
// 5+6. Manifest-owned prompt identity for every chapter_1 scene-owned entry.
// ---------------------------------------------------------------------------

const manifest = readJson(
  resolve(assetsRoot, "manifest.json"),
) as AssetManifest;

let backgroundChecked = 0;
let evidenceChecked = 0;
for (const entry of manifest.entries) {
  if (entry.type === "background" && "unitId" in entry.source) {
    const { chapterId, sceneId, unitId, promptLine, authoredPrompt } =
      entry.source;
    if (chapterId !== "chapter_1") continue;
    const source = readSource(`docs/stories_plan/${chapterId}/${sceneId}.md`);
    assertProbeRender(
      {
        semanticRef: `asset:background:${unitId}`,
        kind: "backgroundPrompt",
        line: promptLine,
        currentText: authoredPrompt,
      },
      source,
    );
    backgroundChecked++;
  }
  if (entry.type === "evidence" && "evidenceId" in entry.source) {
    const { chapterId, sceneId, evidenceId, promptLine, authoredPrompt } =
      entry.source;
    if (chapterId !== "chapter_1") continue;
    const source = readSource(`docs/stories_plan/${chapterId}/${sceneId}.md`);
    assertProbeRender(
      {
        semanticRef: `asset:evidence:${evidenceId}:imagePrompt`,
        kind: "evidenceImagePrompt",
        line: promptLine,
        currentText: authoredPrompt,
      },
      source,
    );
    evidenceChecked++;
  }
}
if (backgroundChecked === 0) {
  fail("manifest has no scene-owned chapter_1 Background Prompt entries");
}
if (evidenceChecked === 0) {
  fail("manifest has no scene-owned chapter_1 evidence Image Prompt entries");
}
console.log(
  `manifest prompt identity: ${backgroundChecked} Background Prompts + ${evidenceChecked} evidence Image Prompts verified against authored lines`,
);

// ---------------------------------------------------------------------------
// 7+8. Compiled Reader/manifest values match, and compiler-only metadata
// never leaks into production scene JSON.
// ---------------------------------------------------------------------------

for (const context of [
  linearContext,
  interrogationContext,
  investigationContext,
]) {
  const serialized = JSON.stringify(context.compiled);
  for (const leak of [
    "sourceLine",
    "backgroundPromptLine",
    "imagePromptLine",
    "backgroundPrompt",
    "imagePrompt",
  ]) {
    if (serialized.includes(leak)) {
      fail(
        `${context.sceneId}: compiler-only metadata "${leak}" leaked into scene JSON`,
      );
    }
  }
}

console.log(
  "verify-focused-edit-real-content: OK — compiler-owned source identity holds on real Chapter 1 data",
);
