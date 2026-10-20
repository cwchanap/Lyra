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
import type { AudioConverter } from "../audio/audio-files";
import { PaymentRequiredError } from "../audio/elevenlabs-client";
import {
  DIAGNOSTIC_EXIT_CODE,
  FAILURE_EXIT_CODE,
  PAYMENT_REQUIRED_EXIT_CODE,
  SUCCESS_EXIT_CODE,
} from "../audio/exit-codes";
import { loadDotEnv } from "../audio/generate";
import { planAuditions } from "./audition";
import { assignClipIds } from "./clip-ids";
import { collectEmittedLines } from "./emitted-lines";
import { planVoiceGeneration, type VoiceTarget } from "./generate";
import { glossaryPath, parseGlossaryText } from "./glossary";
import { addMissingLineIds } from "../compile-scenes/line-ids";
import {
  localeScriptDir,
  localeScriptPath,
  parseLocaleScriptText,
  sceneFileForScriptName,
  sceneSourcePath,
  serializeLocaleScript,
} from "./locale-script";
import { syncChapterScripts, type ExistingScript } from "./sync";
import { createTtsClient, type TtsClient } from "./tts-client";
import { glossaryReader } from "./tts-request";
import type { EmittedScene, LocaleGlossary, VoiceDiagnostic } from "./types";
import { validateChapterScripts } from "./validate";
import {
  approvedCastBySpeaker,
  CHARACTERS_PATH,
  parseVoiceCastText,
  VOICE_CAST_PATH,
  type LocaleCast,
} from "./voice-cast";
import {
  listVoiceClipFiles,
  voiceCachePath,
  voiceOutputPath,
  writeVoiceClip,
} from "./voice-files";

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
  "  voice:audition <characterId> [--candidate <voiceId>] [--dry-run] [--force]",
  "  voice:generate <chapter_N> [--scene <file.md>] [--speaker <characterId>] [--only <clip>] [--dry-run] [--force]",
].join("\n");

export type VoiceCliOptions = {
  repoRoot?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  /** Text-to-speech client; defaults to ElevenLabs with ELEVENLABS_API_KEY. */
  client?: TtsClient;
  /** mp3 to clip post-processing; defaults to ffmpeg. */
  convert?: AudioConverter;
  /** Clock for `generatedAt`; defaults to now. */
  now?: () => Date;
};

type CliContext = {
  repoRoot: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  client: TtsClient | undefined;
  convert: AudioConverter | undefined;
  now: () => Date;
};

type ParsedArgs = {
  chapterId: string;
  locale: string;
  flags: Set<string>;
  values: Map<string, string>;
};

export async function runVoiceCli(
  args: string[] = process.argv.slice(2),
  options: VoiceCliOptions = {},
): Promise<number> {
  const context: CliContext = {
    repoRoot: options.repoRoot ?? DEFAULT_REPO_ROOT,
    stdout: options.stdout ?? console.log,
    stderr: options.stderr ?? console.error,
    client: options.client,
    convert: options.convert,
    now: options.now ?? (() => new Date()),
  };
  const [command, ...rest] = args;
  if (command === "sync") return runSync(rest, context);
  if (command === "validate") return runValidate(rest, context);
  if (command === "audition") return runAudition(rest, context);
  if (command === "generate") return runGenerate(rest, context);
  context.stderr(USAGE);
  return DIAGNOSTIC_EXIT_CODE;
}

function parseFlags(
  args: string[],
  allowedFlags: readonly string[],
  valueFlags: readonly string[],
  context: CliContext,
): {
  positional: string | undefined;
  flags: Set<string>;
  values: Map<string, string>;
} | null {
  let positional: string | undefined;
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg.startsWith("--")) {
      if (valueFlags.includes(arg)) {
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) {
          context.stderr(`${arg} needs a value.\n${USAGE}`);
          return null;
        }
        values.set(arg, value);
        index += 1;
        continue;
      }
      if (!allowedFlags.includes(arg)) {
        context.stderr(`Unknown flag ${arg}.\n${USAGE}`);
        return null;
      }
      flags.add(arg);
    } else if (positional === undefined) {
      positional = arg;
    } else {
      context.stderr(`Unexpected argument ${arg}.\n${USAGE}`);
      return null;
    }
  }
  return { positional, flags, values };
}

function parseArgs(
  args: string[],
  allowedFlags: readonly string[],
  context: CliContext,
  valueFlags: readonly string[] = [],
): ParsedArgs | null {
  const parsed = parseFlags(args, allowedFlags, valueFlags, context);
  if (!parsed) return null;
  const chapterId = parsed.positional;
  if (chapterId === undefined || !/^chapter_\d+$/.test(chapterId)) {
    context.stderr(USAGE);
    return null;
  }
  return {
    chapterId,
    locale: LOCALE,
    flags: parsed.flags,
    values: parsed.values,
  };
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

function loadCast(
  locale: string,
  context: CliContext,
): { ok: true; value: LocaleCast | undefined } | { ok: false } {
  const castPath = resolve(context.repoRoot, VOICE_CAST_PATH);
  if (!existsSync(castPath)) return { ok: true, value: undefined };
  const charactersPath = resolve(context.repoRoot, CHARACTERS_PATH);
  const parsed = parseVoiceCastText(
    readFileSync(castPath, "utf-8"),
    VOICE_CAST_PATH,
    existsSync(charactersPath) ? readFileSync(charactersPath, "utf-8") : "",
  );
  if (!parsed.ok) {
    printDiagnostics(parsed.diagnostics, context, true);
    return { ok: false };
  }
  return { ok: true, value: parsed.value.locales.get(locale) };
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

/**
 * Appends a `{#L012}` ID to every spoken line without one in the scene files
 * whose emitted lines lack IDs. IDs a script still refers to (stale entries
 * included) are never handed out again. Returns how many IDs were added.
 */
function addLineIds(
  parsed: ParsedArgs,
  scenes: EmittedScene[],
  existing: ExistingScript[],
  context: CliContext,
): number {
  const files = new Set<string>();
  for (const scene of scenes) {
    for (const line of scene.lines) {
      if (line.id === null) files.add(line.sourceFile ?? scene.sceneFile);
    }
  }
  let added = 0;
  for (const sceneFile of files) {
    const path = sceneSourcePath(parsed.chapterId, sceneFile);
    const fullPath = resolve(context.repoRoot, path);
    const script = existing.find((s) => s.sceneFile === sceneFile);
    const reserved = script
      ? [...script.file.lines, ...script.file.stale].map((line) => line.id)
      : [];
    const result = addMissingLineIds(readFileSync(fullPath, "utf-8"), reserved);
    if (result.added === 0) continue;
    writeFileSync(fullPath, result.text);
    context.stdout(`[voice] added ${result.added} line IDs to ${path}`);
    added += result.added;
  }
  return added;
}

function runSync(args: string[], context: CliContext): number {
  const parsed = parseArgs(args, [], context);
  if (!parsed) return DIAGNOSTIC_EXIT_CODE;
  let scenes = loadEmittedScenes(parsed, context);
  if (!scenes) return DIAGNOSTIC_EXIT_CODE;
  const existing = loadExistingScripts(parsed, context);
  if (!existing) return DIAGNOSTIC_EXIT_CODE;
  let lineIds: number;
  try {
    lineIds = addLineIds(parsed, scenes, existing, context);
  } catch (cause) {
    context.stderr(`[voice] failed to add line IDs: ${errorMessage(cause)}`);
    return FAILURE_EXIT_CODE;
  }
  if (lineIds > 0) {
    scenes = loadEmittedScenes(parsed, context);
    if (!scenes) return DIAGNOSTIC_EXIT_CODE;
  }

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
  const cast = loadCast(parsed.locale, context);
  if (!cast.ok) return DIAGNOSTIC_EXIT_CODE;
  const clips = assignClipIds({
    chapterId: parsed.chapterId,
    files: result.writes.values(),
    castBySpeaker: approvedCastBySpeaker(cast.value),
    existingClipFiles: listVoiceClipFiles(context.repoRoot, parsed.locale),
  });

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

  const { added, kept, staled, droppedUntranslated, withoutId } = result.report;
  if (withoutId > 0) {
    context.stderr(
      `[voice] ${withoutId} spoken lines could not be given a line ID; run voice:validate for details.`,
    );
  }
  context.stdout(
    `[voice] ${parsed.chapterId} ${parsed.locale}: ${lineIds} line IDs added, ${added} entries added, ${kept} kept, ${staled} stale, ${droppedUntranslated} untranslated removed, ${clips} clip IDs assigned.`,
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
  const cast = loadCast(parsed.locale, context);
  if (!cast.ok) return DIAGNOSTIC_EXIT_CODE;

  const { diagnostics, summary } = validateChapterScripts({
    chapterId: parsed.chapterId,
    locale: parsed.locale,
    scenes,
    existing,
    glossary: glossary.value,
    castBySpeaker: approvedCastBySpeaker(cast.value),
  });
  printDiagnostics(diagnostics, context, parsed.flags.has("--verbose"));
  context.stdout(
    `[voice] ${parsed.chapterId} ${parsed.locale}: ${summary.uniqueLines} unique lines (${summary.emittedLines} emitted), ${summary.translated} translated, ${summary.untranslated} untranslated, ${summary.missing} missing, ${summary.changed} changed since translation, ${summary.stale} stale, ${summary.withoutId} without a line ID.`,
  );

  const strict = parsed.flags.has("--strict");
  const failing = diagnostics.some(
    (d) => d.severity === "error" || (strict && d.severity === "warning"),
  );
  return failing ? DIAGNOSTIC_EXIT_CODE : SUCCESS_EXIT_CODE;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loads the API key from the environment or `packages/scripts/.env`. */
function resolveClient(context: CliContext): TtsClient | null {
  if (context.client) return context.client;
  loadDotEnv(resolve(context.repoRoot, "packages/scripts"));
  const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
  if (apiKey.length === 0) {
    context.stderr(
      "[voice] ELEVENLABS_API_KEY is not set. Put it in packages/scripts/.env or the environment, or pass --dry-run.",
    );
    return null;
  }
  return createTtsClient({ apiKey });
}

function reportPaymentFailure(
  error: PaymentRequiredError,
  context: CliContext,
): number {
  context.stderr(
    `[voice] ${error.id}: ElevenLabs returned ${error.status} ${error.statusText} (billing or quota).`,
  );
  if (error.detail) context.stderr(`[voice] ${error.detail}`);
  context.stderr(
    "[voice] This usually means insufficient remaining credit or billing/API access for the current account.",
  );
  context.stderr(
    "[voice] Do not retry with --force. Top up your ElevenLabs credit, enable API billing, or upgrade the account, then re-run.",
  );
  return PAYMENT_REQUIRED_EXIT_CODE;
}

async function runAudition(
  args: string[],
  context: CliContext,
): Promise<number> {
  const parsed = parseFlags(
    args,
    ["--dry-run", "--force"],
    ["--candidate"],
    context,
  );
  if (!parsed) return DIAGNOSTIC_EXIT_CODE;
  const characterId = parsed.positional;
  if (characterId === undefined || !/^[a-z0-9_]+$/.test(characterId)) {
    context.stderr(USAGE);
    return DIAGNOSTIC_EXIT_CODE;
  }
  const cast = loadCast(LOCALE, context);
  if (!cast.ok) return DIAGNOSTIC_EXIT_CODE;
  if (!cast.value) {
    context.stderr(`[voice] ${VOICE_CAST_PATH} has no ${LOCALE} cast.`);
    return DIAGNOSTIC_EXIT_CODE;
  }
  const glossary = loadGlossary(LOCALE, context);
  if (!glossary.ok) return DIAGNOSTIC_EXIT_CODE;
  const planned = planAuditions({
    localeCast: cast.value,
    characterId,
    candidateVoiceId: parsed.values.get("--candidate"),
    read: glossaryReader(glossary.value?.value),
  });
  if (!planned.ok) {
    context.stderr(`[voice] ${planned.message}`);
    return DIAGNOSTIC_EXIT_CODE;
  }
  const force = parsed.flags.has("--force");
  const takes = planned.takes.filter(
    (take) => force || !existsSync(resolve(context.repoRoot, take.path)),
  );
  const characters = takes.reduce(
    (sum, take) => sum + take.request.body.text.length,
    0,
  );
  if (parsed.flags.has("--dry-run")) {
    for (const take of takes) {
      context.stdout(
        `[voice] would record ${take.path}: ${take.request.body.text}`,
      );
    }
    context.stdout(
      `[voice] ${characterId}: ${takes.length} takes, ${characters} characters (${planned.takes.length - takes.length} already recorded).`,
    );
    return SUCCESS_EXIT_CODE;
  }
  const client = resolveClient(context);
  if (!client) return DIAGNOSTIC_EXIT_CODE;
  for (const take of takes) {
    try {
      const bytes = await client.speak({
        id: `${characterId} audition ${take.candidate.name} #${take.lineNumber}`,
        voiceId: take.request.voiceId,
        body: take.request.body,
      });
      const fullPath = resolve(context.repoRoot, take.path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, bytes);
      context.stdout(`[voice] wrote ${take.path}`);
    } catch (error) {
      if (error instanceof PaymentRequiredError) {
        return reportPaymentFailure(error, context);
      }
      context.stderr(
        `[voice] audition ${take.path} failed: ${errorMessage(error)}`,
      );
      return FAILURE_EXIT_CODE;
    }
  }
  context.stdout(
    `[voice] ${characterId}: ${takes.length} takes recorded, ${characters} characters.`,
  );
  return SUCCESS_EXIT_CODE;
}

async function runGenerate(
  args: string[],
  context: CliContext,
): Promise<number> {
  const parsed = parseArgs(args, ["--dry-run", "--force"], context, [
    "--scene",
    "--speaker",
    "--only",
  ]);
  if (!parsed) return DIAGNOSTIC_EXIT_CODE;
  const scenes = loadEmittedScenes(parsed, context);
  if (!scenes) return DIAGNOSTIC_EXIT_CODE;
  const existing = loadExistingScripts(parsed, context);
  if (!existing) return DIAGNOSTIC_EXIT_CODE;
  const glossary = loadGlossary(parsed.locale, context);
  if (!glossary.ok) return DIAGNOSTIC_EXIT_CODE;
  const cast = loadCast(parsed.locale, context);
  if (!cast.ok) return DIAGNOSTIC_EXIT_CODE;

  const filters = {
    scene: parsed.values.get("--scene"),
    speaker: parsed.values.get("--speaker"),
    only: parsed.values.get("--only"),
  };
  const result = planVoiceGeneration({
    chapterId: parsed.chapterId,
    locale: parsed.locale,
    scenes,
    existing,
    localeCast: cast.value,
    read: glossaryReader(glossary.value?.value),
    existingClipFiles: listVoiceClipFiles(context.repoRoot, parsed.locale),
    filters,
    force: parsed.flags.has("--force"),
  });
  if (!result.ok) {
    printDiagnostics(result.diagnostics, context, true);
    return DIAGNOSTIC_EXIT_CODE;
  }
  const { plan } = result;
  if (
    filters.only !== undefined &&
    plan.targets.length === 0 &&
    plan.current === 0
  ) {
    context.stderr(
      `[voice] No voiced line in ${parsed.chapterId} has clip ${filters.only}${filters.scene || filters.speaker ? " with these filters" : ""}.`,
    );
    return DIAGNOSTIC_EXIT_CODE;
  }
  for (const pending of plan.pending) {
    context.stdout(
      `[voice] ${pending.characterId} is not approved yet: ${pending.lines} translated lines (${pending.characters} characters) get no clips.`,
    );
  }
  const summary = `${plan.targets.length} clips, ${plan.characters} characters (${plan.current} already current)`;
  if (parsed.flags.has("--dry-run")) {
    for (const target of plan.targets) {
      context.stdout(
        `[voice] would generate ${voiceOutputPath(parsed.locale, target.line.voice.clip)}: ${target.request.body.text}`,
      );
    }
    context.stdout(`[voice] ${parsed.chapterId} ${parsed.locale}: ${summary}.`);
    return SUCCESS_EXIT_CODE;
  }
  if (plan.targets.length === 0) {
    context.stdout(`[voice] ${parsed.chapterId} ${parsed.locale}: ${summary}.`);
    return SUCCESS_EXIT_CODE;
  }
  const client = resolveClient(context);
  if (!client) return DIAGNOSTIC_EXIT_CODE;

  let generated = 0;
  for (const target of plan.targets) {
    const code = await generateClip(target, parsed, client, context);
    if (code !== SUCCESS_EXIT_CODE) {
      context.stderr(
        `[voice] stopped after ${generated} of ${plan.targets.length} clips; finished clips are recorded in their scripts.`,
      );
      return code;
    }
    generated += 1;
  }
  context.stdout(
    `[voice] ${parsed.chapterId} ${parsed.locale}: generated ${summary}.`,
  );
  return SUCCESS_EXIT_CODE;
}

async function generateClip(
  target: VoiceTarget,
  parsed: ParsedArgs,
  client: TtsClient,
  context: CliContext,
): Promise<number> {
  const { clip } = target.line.voice;
  const { hash } = target.request;
  const cachePath = voiceCachePath(parsed.locale, clip, hash);
  const fullCache = resolve(context.repoRoot, cachePath);
  let outputPath: string | null = null;
  try {
    const reuse = !parsed.flags.has("--force") && existsSync(fullCache);
    const bytes = reuse
      ? new Uint8Array(readFileSync(fullCache))
      : await client.speak({
          id: clip,
          voiceId: target.request.voiceId,
          body: target.request.body,
        });
    if (reuse) context.stdout(`[voice] reusing cached take ${cachePath}`);
    ({ outputPath } = await writeVoiceClip({
      repoRoot: context.repoRoot,
      locale: parsed.locale,
      clip,
      hash,
      providerBytes: bytes,
      convert: context.convert,
    }));
    target.line.voice.ttsHash = hash;
    target.line.voice.generatedAt = context.now().toISOString();
    writeFileSync(
      resolve(context.repoRoot, target.script.path),
      serializeLocaleScript(target.script.file),
    );
    context.stdout(`[voice] wrote ${outputPath} (${hash})`);
    return SUCCESS_EXIT_CODE;
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      return reportPaymentFailure(error, context);
    }
    if (outputPath !== null) {
      context.stderr(
        `[voice] ${outputPath} was written but ${target.script.path} was not updated: ${errorMessage(error)}. Re-run voice:generate to record it (the cached take is reused).`,
      );
      return FAILURE_EXIT_CODE;
    }
    context.stderr(
      `[voice] failed to generate ${clip}: ${errorMessage(error)}`,
    );
    return FAILURE_EXIT_CODE;
  }
}

if (import.meta.main) {
  const exitCode = await runVoiceCli();
  process.exit(exitCode);
}
