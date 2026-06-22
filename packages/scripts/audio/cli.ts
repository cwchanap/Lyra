import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatAudioCatalogYaml,
  mergeApprovedEntriesIntoCatalog,
  parseAudioCatalogText,
  serializeAudioCatalog,
} from "./audio-catalog";
import { applyAudioCuesToMarkdown } from "./apply";
import {
  loadCorpusForPlan,
  validateSoundPlanAgainstCorpus,
} from "./corpus-validation";
import { parseSoundPlanText, validateSoundPlan } from "./sound-plan";
import type { SoundPlan, SoundPlanCue, SoundPlanDiagnostic } from "./types";

const DEFAULT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const AUDIO_CATALOG_PATH = "static/assets/config/audio.yaml";
const STORY_ROOTS = ["static/stories_plan/", "docs/stories_plan/"] as const;

type CliDiagnostic = {
  code: string;
  message: string;
  path?: string;
};

export type AudioCliOptions = {
  repoRoot?: string;
  cwd?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

type CliContext = {
  repoRoot: string;
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

type ParsedPlanArgs = {
  planPath: string;
  flags: Set<string>;
};

type FileUpdate = {
  file: string;
  fullPath: string;
  source: string;
  changed: boolean;
};

export async function runAudioCli(
  args: string[] = process.argv.slice(2),
  options: AudioCliOptions = {},
): Promise<number> {
  const context = createContext(options);
  const [command, ...commandArgs] = args;

  if (command === "validate") {
    return runValidateCommand(commandArgs, context);
  }
  if (command === "apply") {
    return await runApplyCommand(commandArgs, context);
  }
  if (command === "generate") {
    const { runGenerateCommand } = await import("./generate");
    return runGenerateCommand(commandArgs, {
      repoRoot: context.repoRoot,
      cwd: context.cwd,
      stdout: context.stdout,
      stderr: context.stderr,
    });
  }

  context.stderr("Usage: audio/cli.ts <validate|apply|generate> ...");
  return 2;
}

function runValidateCommand(args: string[], context: CliContext): number {
  const parsedArgs = parsePlanArgs(args, "Usage: audio:validate <plan.yaml>");
  if (!parsedArgs.ok) {
    exitWithDiagnostics(parsedArgs.diagnostics, context);
    return 2;
  }

  const plan = loadPlan(parsedArgs.value.planPath, context);
  if (!plan) return 2;
  const diagnostics = validateSoundPlan(plan);
  if (exitWithDiagnostics(diagnostics, context)) return 2;
  // Corpus-aware checks (#4): first-visual-unit BGM+BGS and cue-vs-manifest.
  const corpusDiagnostics = runCorpusValidation(plan, context);
  if (exitWithDiagnostics(corpusDiagnostics, context)) return 2;
  context.stdout(`[audio] ${parsedArgs.value.planPath} OK`);
  return 0;
}

async function runApplyCommand(
  args: string[],
  context: CliContext,
): Promise<number> {
  const parsedArgs = parsePlanArgs(
    args,
    "Usage: audio:apply <plan.yaml> [--check]",
    ["--check"],
  );
  if (!parsedArgs.ok) {
    exitWithDiagnostics(parsedArgs.diagnostics, context);
    return 2;
  }

  const check = parsedArgs.value.flags.has("--check");
  const plan = loadPlan(parsedArgs.value.planPath, context);
  if (!plan) return 2;
  const diagnostics = validateSoundPlan(plan);
  if (exitWithDiagnostics(diagnostics, context)) return 2;
  // Structural path safety (no absolute / traversal / outside story roots)
  // runs before corpus-aware checks — a malformed cue path is wrong regardless
  // of what the chapter manifest says.
  const cueFileDiagnostics = validateCueFilePaths(plan.cues, context.repoRoot);
  if (exitWithDiagnostics(cueFileDiagnostics, context)) return 2;
  // Corpus-aware checks (#4): first-visual-unit BGM+BGS and cue-vs-manifest.
  const corpusDiagnostics = runCorpusValidation(plan, context);
  if (exitWithDiagnostics(corpusDiagnostics, context)) return 2;

  const catalogPath = resolve(context.repoRoot, AUDIO_CATALOG_PATH);
  const catalogText = readTextFile(catalogPath, "audio catalog", context);
  if (catalogText === undefined) return 2;

  const parsedCatalog = parseAudioCatalogText(catalogText, catalogPath);
  if (!parsedCatalog.ok) {
    exitWithDiagnostics(parsedCatalog.diagnostics, context);
    return 2;
  }
  const merged = mergeApprovedEntriesIntoCatalog(
    parsedCatalog.value,
    plan.entries,
  );
  if (exitWithDiagnostics(merged.diagnostics, context)) return 2;

  const nextCatalogText = await formatAudioCatalogYaml(
    serializeAudioCatalog(merged.catalog),
  );
  const changedPaths: string[] = [];
  const changedPathSet = new Set<string>();
  if (nextCatalogText !== catalogText) {
    pushChangedPath(AUDIO_CATALOG_PATH, changedPaths, changedPathSet);
  }

  const fileUpdates: FileUpdate[] = [];
  const cuesByFile = groupCuesByFile(plan.cues);
  for (const [file, cues] of cuesByFile) {
    const fullPath = resolve(context.repoRoot, file);
    const source = readTextFile(fullPath, file, context);
    if (source === undefined) return 2;
    const result = applyAudioCuesToMarkdown(file, source, cues);
    if (exitWithDiagnostics(result.diagnostics, context)) return 2;
    if (result.changed) pushChangedPath(file, changedPaths, changedPathSet);
    fileUpdates.push({
      file,
      fullPath,
      source: result.source,
      changed: result.changed,
    });
  }

  if (check && changedPaths.length > 0) {
    context.stderr("[audio] approved plan is not applied");
    for (const path of changedPaths) {
      context.stderr(`[audio] changed: ${path}`);
    }
    return 2;
  }

  if (!check && nextCatalogText !== catalogText) {
    if (
      !writeTextFile(catalogPath, "audio catalog", nextCatalogText, context)
    ) {
      return 2;
    }
  }
  if (!check) {
    for (const update of fileUpdates) {
      if (!update.changed) continue;
      if (
        !writeTextFile(update.fullPath, update.file, update.source, context)
      ) {
        return 2;
      }
    }
  }

  context.stdout(check ? "[audio] apply check OK" : "[audio] apply OK");
  return 0;
}

function parsePlanArgs(
  args: string[],
  usage: string,
  allowedFlags: string[] = [],
):
  | { ok: true; value: ParsedPlanArgs }
  | { ok: false; diagnostics: CliDiagnostic[] } {
  const allowedFlagSet = new Set(allowedFlags);
  const diagnostics: CliDiagnostic[] = [];
  const flags = new Set<string>();
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--")) {
      if (allowedFlagSet.has(arg)) {
        flags.add(arg);
      } else {
        diagnostics.push({
          code: "audioCliUnknownFlag",
          path: arg,
          message: `Unknown flag "${arg}". ${usage}`,
        });
      }
      continue;
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) {
    diagnostics.push({
      code: "audioCliMissingArg",
      message: usage,
    });
  }
  for (const extra of positionals.slice(1)) {
    diagnostics.push({
      code: "audioCliUnexpectedArg",
      path: extra,
      message: `Unexpected argument "${extra}". ${usage}`,
    });
  }

  if (diagnostics.length > 0 || positionals[0] === undefined) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    value: {
      planPath: positionals[0],
      flags,
    },
  };
}

function loadPlan(
  planPath: string,
  context: CliContext,
): SoundPlan | undefined {
  const fullPath = resolveInputPath(planPath, context);
  const text = readTextFile(fullPath, planPath, context);
  if (text === undefined) return undefined;
  const parsed = parseSoundPlanText(text, planPath);
  if (!parsed.ok) {
    exitWithDiagnostics(parsed.diagnostics, context);
    return undefined;
  }
  return parsed.value;
}

/**
 * Load the chapter corpus for `plan` and run the spec-required corpus-aware
 * checks (#4): the first visual unit must explicitly set both BGM and BGS,
 * and every cue must target a scene file listed in the chapter manifest.
 * Returns an empty array when the corpus is unavailable for reasons outside
 * the plan's control (e.g. missing chapter directory) AND that missing state
 * already produced its own diagnostic — but in practice load failures surface
 * here so validate/apply can block on them.
 */
function runCorpusValidation(
  plan: SoundPlan,
  context: CliContext,
): SoundPlanDiagnostic[] {
  const corpus = loadCorpusForPlan(plan, { repoRoot: context.repoRoot });
  if (!corpus.ok) return corpus.diagnostics;
  return validateSoundPlanAgainstCorpus(plan, corpus.data);
}

function validateCueFilePaths(
  cues: SoundPlanCue[],
  repoRoot: string,
): CliDiagnostic[] {
  const diagnostics: CliDiagnostic[] = [];
  for (const [index, cue] of cues.entries()) {
    const path = `cues[${index}].file`;
    if (isAbsolute(cue.file)) {
      diagnostics.push({
        code: "audioApplyCueFileAbsolute",
        path,
        message: `Cue file path "${cue.file}" must be relative to the repo root.`,
      });
      continue;
    }
    if (cue.file.split(/[\\/]+/).includes("..")) {
      diagnostics.push({
        code: "audioApplyCueFileTraversal",
        path,
        message: `Cue file path "${cue.file}" must not contain ".." traversal.`,
      });
      continue;
    }

    const fullPath = resolve(repoRoot, cue.file);
    const relativePath = relative(repoRoot, fullPath);
    if (
      relativePath === "" ||
      relativePath.startsWith("..") ||
      isAbsolute(relativePath)
    ) {
      diagnostics.push({
        code: "audioApplyCueFileOutsideRepo",
        path,
        message: `Cue file path "${cue.file}" resolves outside the repo root.`,
      });
      continue;
    }

    const normalized = relativePath.split("\\").join("/");
    if (!STORY_ROOTS.some((root) => normalized.startsWith(root))) {
      diagnostics.push({
        code: "audioApplyCueFileOutsideStoryRoot",
        path,
        message: `Cue file path "${cue.file}" must be under static/stories_plan/ or docs/stories_plan/.`,
      });
    }
  }
  return diagnostics;
}

function groupCuesByFile(cues: SoundPlanCue[]): Map<string, SoundPlanCue[]> {
  const cuesByFile = new Map<string, SoundPlanCue[]>();
  for (const cue of cues) {
    cuesByFile.set(cue.file, [...(cuesByFile.get(cue.file) ?? []), cue]);
  }
  return cuesByFile;
}

function resolveInputPath(path: string, context: CliContext): string {
  const cwdPath = resolve(context.cwd, path);
  if (existsSync(cwdPath)) return cwdPath;
  return resolve(context.repoRoot, path);
}

function readTextFile(
  path: string,
  label: string,
  context: CliContext,
): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.stderr(`[audio] failed to read ${label}: ${message}`);
    return undefined;
  }
}

function writeTextFile(
  path: string,
  label: string,
  text: string,
  context: CliContext,
): boolean {
  try {
    writeFileSync(path, text);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.stderr(`[audio] failed to write ${label}: ${message}`);
    return false;
  }
}

function exitWithDiagnostics(
  diagnostics: Array<SoundPlanDiagnostic | CliDiagnostic>,
  context: CliContext,
): 2 | undefined {
  if (diagnostics.length === 0) return undefined;
  for (const diagnostic of diagnostics) {
    context.stderr(formatDiagnostic(diagnostic));
  }
  return 2;
}

function formatDiagnostic(
  diagnostic: SoundPlanDiagnostic | CliDiagnostic,
): string {
  const path = "path" in diagnostic ? diagnostic.path : undefined;
  if (path) return `[${diagnostic.code}] ${path}: ${diagnostic.message}`;
  return `[${diagnostic.code}] ${diagnostic.message}`;
}

function pushChangedPath(
  path: string,
  changedPaths: string[],
  changedPathSet: Set<string>,
): void {
  if (changedPathSet.has(path)) return;
  changedPathSet.add(path);
  changedPaths.push(path);
}

function createContext(options: AudioCliOptions): CliContext {
  return {
    repoRoot: options.repoRoot ?? DEFAULT_REPO_ROOT,
    cwd: options.cwd ?? process.cwd(),
    stdout: options.stdout ?? console.log,
    stderr: options.stderr ?? console.error,
  };
}

if (import.meta.main) {
  const exitCode = await runAudioCli();
  process.exit(exitCode);
}
