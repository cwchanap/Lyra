import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeGeneratedAudioFile } from "./audio-files";
import {
  createElevenLabsClient,
  endpointForChannel,
  PaymentRequiredError,
} from "./elevenlabs-client";
import { applyGenerationMetadataToPlan } from "./plan-writeback";
import { parseSoundPlanText, validateSoundPlan } from "./sound-plan";
import type { SoundPlanDiagnostic, SoundPlanEntry } from "./types";

const DEFAULT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const USAGE =
  "Usage: audio:generate <plan.yaml> [--dry-run] [--only <id>] [--force]";

/**
 * Exit code returned when ElevenLabs signals a billing/credit problem (402).
 * Distinct from the generic failure code (1) and the usage/diagnostic code (2)
 * so CI and scripts can branch on "needs top-up, do not retry" without parsing
 * stderr.
 */
export const PAYMENT_REQUIRED_EXIT_CODE = 3;

export type GenerateCliOptions = {
  repoRoot?: string;
  cwd?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
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
  only?: string;
  apiKey?: string;
}): { diagnostics: SoundPlanDiagnostic[]; toGenerate: GenerationTarget[] } {
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
    };
  }

  const parsed = parseSoundPlanText(text, input.planPath);
  if (!parsed.ok) return { diagnostics: parsed.diagnostics, toGenerate: [] };

  const diagnostics = validateSoundPlan(parsed.value);
  if (diagnostics.length > 0) return { diagnostics, toGenerate: [] };

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
    };
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
    };
  }

  return { diagnostics: [], toGenerate };
}

export async function runGenerateCommand(
  args: string[],
  options: GenerateCliOptions = {},
): Promise<number> {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;

  const parsed = parseGenerateArgs(args);
  if (!parsed.ok) {
    printDiagnostics(parsed.diagnostics, stderr);
    return 2;
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
    return 2;
  }

  if (parsed.value.dryRun) {
    for (const target of result.toGenerate) {
      stdout(`[audio] would generate ${target.outputPath}`);
    }
    return 0;
  }

  const client = createElevenLabsClient({ apiKey });
  const planFullPath = resolve(repoRoot, parsed.value.planPath);
  for (const target of result.toGenerate) {
    try {
      const providerBytes = await client.generate({
        id: target.entry.id,
        channel: target.entry.channel,
        prompt: target.entry.prompt,
        loop: target.entry.loop,
        intendedDurationSeconds: target.entry.intendedDurationSeconds,
      });
      await writeGeneratedAudioFile({
        repoRoot,
        channel: target.entry.channel,
        id: target.entry.id,
        providerBytes,
      });
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
      // 402 is a billing/credit problem, not a transient or input error.
      // Surface actionable guidance and a distinct exit code, and (per the
      // CLAUDE.md contract) steer away from a credit-burning --force retry.
      if (error instanceof PaymentRequiredError) {
        stderr(
          `[audio] ${error.channel}/${error.id}: ElevenLabs returned 402 Payment Required.`,
        );
        stderr(
          "[audio] This usually means insufficient remaining credit or billing/API access for the current account.",
        );
        stderr(
          "[audio] Do not retry with --force. Top up your ElevenLabs credit, enable API billing, or upgrade the account, then re-run.",
        );
        return PAYMENT_REQUIRED_EXIT_CODE;
      }
      stderr(
        `[audio] failed to generate ${target.entry.channel}/${target.entry.id}: ${errorMessage(error)}`,
      );
      return 1;
    }
  }

  return 0;
}

type ParsedGenerateArgs = {
  planPath: string;
  dryRun: boolean;
  force: boolean;
  only?: string;
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
  return `static/assets/audio/${entry.channel}/${entry.id}.ogg`;
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
