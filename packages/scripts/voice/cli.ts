import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatErrors } from "../compile-scenes/orchestrator";
import {
  DIAGNOSTIC_EXIT_CODE,
  FAILURE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
} from "../audio/exit-codes";
import { collectEmittedLines } from "./emitted-lines";
import { glossaryPath, parseGlossaryText } from "./glossary";
import {
  localeScriptDir,
  localeScriptPath,
  parseLocaleScriptText,
  sceneFileForScriptName,
  serializeLocaleScript,
} from "./locale-script";
import { syncChapterScripts, type ExistingScript } from "./sync";
import type { EmittedScene, LocaleGlossary, VoiceDiagnostic } from "./types";
import { validateChapterScripts } from "./validate";

const DEFAULT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
/**
 * Only Japanese is supported: script lines carry a `ja` field. The
 * `<chapter>/<locale>/` layout leaves room for more locales later.
 */
const LOCALE = "ja";
const DETAIL_LIMIT = 40;
const USAGE = [
  "Usage:",
  "  voice:sync <chapter_N>",
  "  voice:validate <chapter_N> [--strict] [--verbose]",
].join("\n");

export type VoiceCliOptions = {
  repoRoot?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

type CliContext = {
  repoRoot: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

type ParsedArgs = {
  chapterId: string;
  locale: string;
  flags: Set<string>;
};

export async function runVoiceCli(
  args: string[] = process.argv.slice(2),
  options: VoiceCliOptions = {},
): Promise<number> {
  const context: CliContext = {
    repoRoot: options.repoRoot ?? DEFAULT_REPO_ROOT,
    stdout: options.stdout ?? console.log,
    stderr: options.stderr ?? console.error,
  };
  const [command, ...rest] = args;
  if (command === "sync") return runSync(rest, context);
  if (command === "validate") return runValidate(rest, context);
  context.stderr(USAGE);
  return DIAGNOSTIC_EXIT_CODE;
}

function parseArgs(
  args: string[],
  allowedFlags: readonly string[],
  context: CliContext,
): ParsedArgs | null {
  let chapterId: string | undefined;
  const flags = new Set<string>();
  for (const arg of args) {
    if (arg.startsWith("--")) {
      if (!allowedFlags.includes(arg)) {
        context.stderr(`Unknown flag ${arg}.\n${USAGE}`);
        return null;
      }
      flags.add(arg);
    } else if (chapterId === undefined) {
      chapterId = arg;
    } else {
      context.stderr(`Unexpected argument ${arg}.\n${USAGE}`);
      return null;
    }
  }
  if (chapterId === undefined || !/^chapter_\d+$/.test(chapterId)) {
    context.stderr(USAGE);
    return null;
  }
  return { chapterId, locale: LOCALE, flags };
}

function loadEmittedScenes(
  parsed: ParsedArgs,
  context: CliContext,
): EmittedScene[] | null {
  const result = collectEmittedLines({
    repoRoot: context.repoRoot,
    chapterId: parsed.chapterId,
  });
  if (!result.ok) {
    context.stderr("[voice] the story does not compile:");
    context.stderr(formatErrors(result.errors));
    return null;
  }
  return result.scenes;
}

function loadExistingScripts(
  parsed: ParsedArgs,
  context: CliContext,
): ExistingScript[] | null {
  const dir = localeScriptDir(parsed.chapterId, parsed.locale);
  const fullDir = resolve(context.repoRoot, dir);
  if (!existsSync(fullDir)) return [];
  const scripts: ExistingScript[] = [];
  const diagnostics: VoiceDiagnostic[] = [];
  for (const name of readdirSync(fullDir).sort()) {
    const sceneFile = sceneFileForScriptName(name, parsed.locale);
    if (sceneFile === null) continue;
    const path = localeScriptPath(parsed.chapterId, sceneFile, parsed.locale);
    const parsedFile = parseLocaleScriptText(
      readFileSync(resolve(context.repoRoot, path), "utf-8"),
      path,
    );
    if (!parsedFile.ok) {
      diagnostics.push(...parsedFile.diagnostics);
      continue;
    }
    scripts.push({ path, sceneFile, file: parsedFile.value });
  }
  if (diagnostics.length > 0) {
    printDiagnostics(diagnostics, context, true);
    return null;
  }
  return scripts;
}

function loadGlossary(
  locale: string,
  context: CliContext,
):
  | { ok: true; value: { path: string; value: LocaleGlossary } | undefined }
  | { ok: false } {
  const path = glossaryPath(locale);
  const fullPath = resolve(context.repoRoot, path);
  if (!existsSync(fullPath)) return { ok: true, value: undefined };
  const parsed = parseGlossaryText(readFileSync(fullPath, "utf-8"), path);
  if (!parsed.ok) {
    printDiagnostics(parsed.diagnostics, context, true);
    return { ok: false };
  }
  return { ok: true, value: { path, value: parsed.value } };
}

function printDiagnostics(
  diagnostics: VoiceDiagnostic[],
  context: CliContext,
  verbose: boolean,
): void {
  const shown = verbose ? diagnostics : diagnostics.slice(0, DETAIL_LIMIT);
  for (const d of shown) {
    context.stderr(`[voice] ${d.severity} ${d.code} ${d.path}: ${d.message}`);
  }
  if (shown.length < diagnostics.length) {
    context.stderr(
      `[voice] ... ${diagnostics.length - shown.length} more (pass --verbose to list all).`,
    );
  }
}

function runSync(args: string[], context: CliContext): number {
  const parsed = parseArgs(args, [], context);
  if (!parsed) return DIAGNOSTIC_EXIT_CODE;
  const scenes = loadEmittedScenes(parsed, context);
  if (!scenes) return DIAGNOSTIC_EXIT_CODE;
  const existing = loadExistingScripts(parsed, context);
  if (!existing) return DIAGNOSTIC_EXIT_CODE;

  const result = syncChapterScripts({
    chapterId: parsed.chapterId,
    locale: parsed.locale,
    scenes,
    existing,
  });
  if (!result.ok) {
    printDiagnostics(result.diagnostics, context, true);
    return DIAGNOSTIC_EXIT_CODE;
  }

  try {
    for (const [path, file] of result.writes) {
      const fullPath = resolve(context.repoRoot, path);
      const text = serializeLocaleScript(file);
      const current = existsSync(fullPath)
        ? readFileSync(fullPath, "utf-8")
        : null;
      if (current === text) continue;
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, text);
      context.stdout(`[voice] wrote ${path}`);
    }
    for (const path of result.deletes) {
      rmSync(resolve(context.repoRoot, path), { force: true });
      context.stdout(`[voice] removed ${path}`);
    }
  } catch (cause) {
    context.stderr(
      `[voice] failed to write scripts: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return FAILURE_EXIT_CODE;
  }

  const { added, kept, staled, droppedUntranslated } = result.report;
  context.stdout(
    `[voice] ${parsed.chapterId} ${parsed.locale}: ${added} added, ${kept} kept, ${staled} stale, ${droppedUntranslated} untranslated removed.`,
  );
  return SUCCESS_EXIT_CODE;
}

function runValidate(args: string[], context: CliContext): number {
  const parsed = parseArgs(args, ["--strict", "--verbose"], context);
  if (!parsed) return DIAGNOSTIC_EXIT_CODE;
  const scenes = loadEmittedScenes(parsed, context);
  if (!scenes) return DIAGNOSTIC_EXIT_CODE;
  const existing = loadExistingScripts(parsed, context);
  if (!existing) return DIAGNOSTIC_EXIT_CODE;
  const glossary = loadGlossary(parsed.locale, context);
  if (!glossary.ok) return DIAGNOSTIC_EXIT_CODE;

  const { diagnostics, summary } = validateChapterScripts({
    chapterId: parsed.chapterId,
    locale: parsed.locale,
    scenes,
    existing,
    glossary: glossary.value,
  });
  printDiagnostics(diagnostics, context, parsed.flags.has("--verbose"));
  context.stdout(
    `[voice] ${parsed.chapterId} ${parsed.locale}: ${summary.uniqueLines} unique lines (${summary.emittedLines} emitted), ${summary.translated} translated, ${summary.untranslated} untranslated, ${summary.missing} missing, ${summary.stale} stale.`,
  );

  const strict = parsed.flags.has("--strict");
  const failing = diagnostics.some(
    (d) => d.severity === "error" || (strict && d.severity === "warning"),
  );
  return failing ? DIAGNOSTIC_EXIT_CODE : SUCCESS_EXIT_CODE;
}

if (import.meta.main) {
  const exitCode = await runVoiceCli();
  process.exit(exitCode);
}
