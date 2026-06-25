import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  audioCacheRelativePath,
  audioOutputRelativePath,
  pruneAudioCache,
  writeGeneratedAudioFile,
  type AudioConverter,
} from "./audio-files";
import {
  createElevenLabsClient,
  endpointForChannel,
  PaymentRequiredError,
} from "./elevenlabs-client";
import {
  DIAGNOSTIC_EXIT_CODE,
  FAILURE_EXIT_CODE,
  PAYMENT_REQUIRED_EXIT_CODE,
  SUCCESS_EXIT_CODE,
} from "./exit-codes";
import { applyGenerationMetadataToPlan } from "./plan-writeback";
import { parseSoundPlanText, validateSoundPlan } from "./sound-plan";
import type {
  SoundPlanChannel,
  SoundPlanDiagnostic,
  SoundPlanEntry,
} from "./types";

const DEFAULT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const USAGE =
  "Usage: audio:generate <plan.yaml> [--dry-run] [--only <id>] [--force]";

export { PAYMENT_REQUIRED_EXIT_CODE };

export type GenerateCliOptions = {
  repoRoot?: string;
  cwd?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  /**
   * Test seam for the mp3 -> ogg transcoder. When omitted the real
   * `convertWithFfmpeg` (which shells out to ffmpeg with libvorbis) is used.
   * Tests inject a fake so the happy path can run without a local ffmpeg.
   */
  convert?: AudioConverter;
};

export type GenerationTarget = {
  entry: SoundPlanEntry;
  outputPath: string;
};

export function planGeneration(input: {
  repoRoot: string;
  planPath: string;
  dryRun: boolean;
  force: boolean;
  only?: string | undefined;
  apiKey?: string | undefined;
}): {
  diagnostics: SoundPlanDiagnostic[];
  toGenerate: GenerationTarget[];
  allEntries: SoundPlanEntry[];
} {
  const planFullPath = resolve(input.repoRoot, input.planPath);
  let text: string;
  try {
    text = readFileSync(planFullPath, "utf-8");
  } catch (error) {
    return {
      diagnostics: [
        {
          code: "audioGeneratePlanReadFailed",
          path: input.planPath,
          message: `Failed to read sound plan: ${errorMessage(error)}`,
        },
      ],
      toGenerate: [],
      allEntries: [],
    };
  }

  const parsed = parseSoundPlanText(text, input.planPath);
  if (!parsed.ok)
    return {
      diagnostics: parsed.diagnostics,
      toGenerate: [],
      allEntries: [],
    };

  const diagnostics = validateSoundPlan(parsed.value);
  if (diagnostics.length > 0)
    return { diagnostics, toGenerate: [], allEntries: [] };

  if (
    input.only !== undefined &&
    !parsed.value.entries.some((entry) => entry.id === input.only)
  ) {
    return {
      diagnostics: [
        {
          code: "audioGenerateOnlyNotFound",
          path: "--only",
          message: `No sound plan entry has id "${input.only}" for --only.`,
        },
      ],
      toGenerate: [],
      allEntries: [],
    };
  }

  // An id that exists but is proposed/rejected would otherwise pass the
  // existence check above, get filtered by status in the loop below, leave
  // nothing to generate, and exit 0 with no output — a silent-success trap.
  // Surface it explicitly so the user knows the command did nothing.
  if (input.only !== undefined) {
    const onlyEntry = parsed.value.entries.find(
      (entry) => entry.id === input.only,
    );
    if (
      onlyEntry &&
      onlyEntry.status !== "approved" &&
      onlyEntry.status !== "generated"
    ) {
      return {
        diagnostics: [
          {
            code: "audioGenerateOnlyNotApproved",
            path: "--only",
            message: `Entry "${input.only}" has status "${onlyEntry.status}". --only requires an entry with status "approved" or "generated".`,
          },
        ],
        toGenerate: [],
        allEntries: [],
      };
    }
  }

  const toGenerate: GenerationTarget[] = [];
  for (const entry of parsed.value.entries) {
    if (input.only !== undefined && entry.id !== input.only) continue;
    if (entry.status !== "approved" && entry.status !== "generated") continue;

    const outputPath = generatedOutputPath(entry);
    if (!input.force && existsSync(resolve(input.repoRoot, outputPath))) {
      continue;
    }
    toGenerate.push({ entry, outputPath });
  }

  if (
    !input.dryRun &&
    toGenerate.length > 0 &&
    (input.apiKey ?? "").trim() === ""
  ) {
    return {
      diagnostics: [
        {
          code: "audioGenerateMissingApiKey",
          path: "ELEVENLABS_API_KEY",
          message:
            "ELEVENLABS_API_KEY is required for audio generation. Set it in packages/scripts/.env or export it as an environment variable.",
        },
      ],
      toGenerate: [],
      allEntries: [],
    };
  }

  return { diagnostics: [], toGenerate, allEntries: parsed.value.entries };
}

export async function runGenerateCommand(
  args: string[],
  options: GenerateCliOptions = {},
): Promise<number> {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const convert = options.convert;

  const parsed = parseGenerateArgs(args);
  if (!parsed.ok) {
    printDiagnostics(parsed.diagnostics, stderr);
    return DIAGNOSTIC_EXIT_CODE;
  }

  // .env lives in packages/scripts/ (the package root). Resolve relative to
  // the active repo root so the command is testable with a temp dir: in tests
  // <tempRoot>/packages/scripts/.env does not exist and loadDotEnv is a no-op.
  loadDotEnv(resolve(repoRoot, "packages/scripts"));
  const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
  const result = planGeneration({
    repoRoot,
    planPath: parsed.value.planPath,
    dryRun: parsed.value.dryRun,
    force: parsed.value.force,
    only: parsed.value.only,
    apiKey,
  });

  if (result.diagnostics.length > 0) {
    printDiagnostics(result.diagnostics, stderr);
    return DIAGNOSTIC_EXIT_CODE;
  }

  if (parsed.value.dryRun) {
    for (const target of result.toGenerate) {
      stdout(`[audio] would generate ${target.outputPath}`);
    }
    return SUCCESS_EXIT_CODE;
  }

  const client = createElevenLabsClient({ apiKey });
  const planFullPath = resolve(repoRoot, parsed.value.planPath);
  for (const target of result.toGenerate) {
    // Tracks whether the .ogg reached its final path before a downstream
    // step threw. If so, the generic "failed to generate" message would hide
    // an orphaned output and (combined with the skip-on-exists gate) silently
    // strand the entry with the plan still saying "approved".
    let outputWritten = false;
    try {
      const cachedProviderPath = resolve(
        repoRoot,
        audioCacheRelativePath(target.entry.channel, target.entry.id),
      );
      const providerBytes =
        !parsed.value.force && existsSync(cachedProviderPath)
          ? readFileSync(cachedProviderPath)
          : await client.generate({
              id: target.entry.id,
              channel: target.entry.channel,
              prompt: target.entry.prompt,
              loop: target.entry.loop,
              intendedDurationSeconds: target.entry.intendedDurationSeconds,
            });
      if (!parsed.value.force && existsSync(cachedProviderPath)) {
        stdout(
          `[audio] reusing cached mp3 ${audioCacheRelativePath(target.entry.channel, target.entry.id)}`,
        );
      }
      // Build the write args conditionally so we don't pass `convert: undefined`
      // to an exactOptionalPropertyTypes-strict `convert?` parameter.
      const writeArgs: {
        repoRoot: string;
        channel: SoundPlanChannel;
        id: string;
        providerBytes: Uint8Array;
        convert?: AudioConverter;
      } = {
        repoRoot,
        channel: target.entry.channel,
        id: target.entry.id,
        providerBytes,
      };
      if (convert !== undefined) writeArgs.convert = convert;
      await writeGeneratedAudioFile(writeArgs);
      outputWritten = true;
      // Per-entry metadata write-back (spec L280-291): persist provider,
      // endpoint, prompt hash, timestamp, output path, and forced flag so the
      // plan is the audit trail. Written after each entry so a mid-batch
      // failure still records completed entries.
      const promptHash = createHash("sha256")
        .update(target.entry.prompt)
        .digest("hex")
        .slice(0, 12);
      applyGenerationMetadataToPlan(planFullPath, {
        entryId: target.entry.id,
        provider: "elevenlabs",
        endpoint: endpointForChannel(target.entry.channel),
        promptHash,
        generatedAt: new Date().toISOString(),
        outputPath: target.outputPath,
        forced: parsed.value.force,
        normalizationNotes: "converted from mp3 to ogg via ffmpeg libvorbis",
      });
      stdout(
        `[audio] wrote ${target.outputPath} (prompt ${promptHash}) and updated plan`,
      );
    } catch (error) {
      // 402 / quota-exhaustion is a billing/credit problem, not a transient or
      // input error. Surface actionable guidance and a distinct exit code, and
      // (per the CLAUDE.md contract) steer away from a credit-burning --force
      // retry. ElevenLabs frequently returns quota problems as 401 with a
      // quota_exceeded body — the client normalizes both into this error.
      if (error instanceof PaymentRequiredError) {
        stderr(
          `[audio] ${error.channel}/${error.id}: ElevenLabs returned ${error.status} ${error.statusText} (billing or quota).`,
        );
        if (error.detail) {
          stderr(`[audio] ${error.detail}`);
        }
        stderr(
          "[audio] This usually means insufficient remaining credit or billing/API access for the current account.",
        );
        stderr(
          "[audio] Do not retry with --force. Top up your ElevenLabs credit, enable API billing, or upgrade the account, then re-run.",
        );
        return PAYMENT_REQUIRED_EXIT_CODE;
      }
      if (outputWritten) {
        // The .ogg is on disk but the plan was not updated — disk and plan are
        // now inconsistent. Surface that distinctly so the user knows the file
        // exists and how to reconcile, rather than reporting a plain failure
        // that (with the skip-on-exists gate) would silently strand the entry.
        stderr(
          `[audio] ${target.entry.channel}/${target.entry.id}: output was written to ${target.outputPath} but plan write-back failed: ${errorMessage(error)}`,
        );
        stderr(
          `[audio] The plan still says "${target.entry.status}". Re-run with --only ${target.entry.id} --force to record provenance, or verify the file manually.`,
        );
        return FAILURE_EXIT_CODE;
      }
      stderr(
        `[audio] failed to generate ${target.entry.channel}/${target.entry.id}: ${errorMessage(error)}`,
      );
      return FAILURE_EXIT_CODE;
    }
  }

  // Prune stale cache entries after a successful full run (not --only, not
  // --dry-run — those target subsets and must not evict unselected entries).
  // Cache MP3s are regenerable, so deleting orphans is safe.
  if (parsed.value.only === undefined) {
    const validKeys = new Set(
      result.allEntries.map((e) => `${e.channel}/${e.id}`),
    );
    const pruned = pruneAudioCache(repoRoot, validKeys);
    for (const path of pruned) {
      stdout(`[audio] pruned stale cache: ${path}`);
    }
  }

  return SUCCESS_EXIT_CODE;
}

type ParsedGenerateArgs = {
  planPath: string;
  dryRun: boolean;
  force: boolean;
  only?: string | undefined;
};

function parseGenerateArgs(
  args: string[],
):
  | { ok: true; value: ParsedGenerateArgs }
  | { ok: false; diagnostics: SoundPlanDiagnostic[] } {
  const diagnostics: SoundPlanDiagnostic[] = [];
  const positionals: string[] = [];
  let dryRun = false;
  let force = false;
  let only: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    // The loop bound guarantees index is in range, but
    // noUncheckedIndexedAccess types args[index] as string | undefined.
    if (arg === undefined) continue;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--only") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        diagnostics.push({
          code: "audioCliMissingArg",
          path: "--only",
          message: `Missing value for --only. ${USAGE}`,
        });
        continue;
      }
      only = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      diagnostics.push({
        code: "audioCliUnknownFlag",
        path: arg,
        message: `Unknown flag "${arg}". ${USAGE}`,
      });
      continue;
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) {
    diagnostics.push({
      code: "audioCliMissingArg",
      path: "",
      message: USAGE,
    });
  }
  for (const extra of positionals.slice(1)) {
    diagnostics.push({
      code: "audioCliUnexpectedArg",
      path: extra,
      message: `Unexpected argument "${extra}". ${USAGE}`,
    });
  }

  if (diagnostics.length > 0 || positionals[0] === undefined) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    value: {
      planPath: positionals[0],
      dryRun,
      force,
      only,
    },
  };
}

function generatedOutputPath(entry: SoundPlanEntry): string {
  return audioOutputRelativePath(entry.channel, entry.id);
}

function printDiagnostics(
  diagnostics: SoundPlanDiagnostic[],
  stderr: (message: string) => void = console.error,
): void {
  for (const diagnostic of diagnostics) {
    stderr(formatDiagnostic(diagnostic));
  }
}

function formatDiagnostic(diagnostic: SoundPlanDiagnostic): string {
  if (diagnostic.path) {
    return `[${diagnostic.code}] ${diagnostic.path}: ${diagnostic.message}`;
  }
  return `[${diagnostic.code}] ${diagnostic.message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads KEY=VALUE pairs from a `.env` file at `dir/.env` into
 * `process.env`. Existing environment variables take precedence — this only
 * fills in values that are not already set, so explicit `KEY=val bun run`
 * invocations and CI environment variables still win.
 *
 * Skips blank lines and `#` comments. Strips surrounding single/double
 * quotes from values.
 */
export function loadDotEnv(dir: string): void {
  const envPath = resolve(dir, ".env");
  if (!existsSync(envPath)) return;
  let text: string;
  try {
    text = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    if (key === "") continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eqIndex + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
