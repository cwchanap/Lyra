// =============================================================================
// packages/scripts/audio/plan-writeback.ts
//
// Per-entry generation metadata write-back (spec L280-291). After each
// successful generation, the plan YAML is updated so the entry records:
//   - status transitions approved -> generated
//   - provider, endpoint, promptHash, generatedAt, outputPath, forced
//   - optional durationSeconds and normalizationNotes when known
//
// Uses the yaml library's Document API (parseDocument / toString) to preserve
// authoring comments and block-scalar styles elsewhere in the file. Writes
// per-entry so a mid-batch failure still persists completed entries.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";

export type GenerationMetadata = {
  entryId: string;
  provider: string;
  endpoint: string;
  promptHash: string;
  generatedAt: string;
  outputPath: string;
  forced: boolean;
  durationSeconds?: number;
  normalizationNotes?: string;
};

/**
 * Read the plan at `planPath`, update the entry matching `metadata.entryId`
 * in place (status -> generated, plus all supplied metadata fields), and write
 * the file back. Preserves comments and formatting of untouched nodes.
 *
 * Throws if the entry id is not found — the caller should treat that as a
 * programmer error (the generation step only targets ids from the same plan).
 */
export function applyGenerationMetadataToPlan(
  planPath: string,
  metadata: GenerationMetadata,
): void {
  const text = readFileSync(planPath, "utf-8");
  const doc = YAML.parseDocument(text);

  const entries = doc.get("entries");
  if (!YAML.isSeq(entries)) {
    throw new Error(
      `Could not write generation metadata: plan has no entries array.`,
    );
  }

  let updated = false;
  for (const node of entries.items) {
    if (!YAML.isMap(node)) continue;
    const idNode = node.get("id");
    if (typeof idNode !== "string" || idNode !== metadata.entryId) continue;

    node.set("status", "generated");
    node.set("provider", metadata.provider);
    node.set("endpoint", metadata.endpoint);
    node.set("promptHash", metadata.promptHash);
    node.set("generatedAt", metadata.generatedAt);
    node.set("outputPath", metadata.outputPath);
    node.set("forced", metadata.forced);
    if (metadata.durationSeconds !== undefined) {
      node.set("durationSeconds", metadata.durationSeconds);
    }
    if (metadata.normalizationNotes !== undefined) {
      node.set("normalizationNotes", metadata.normalizationNotes);
    }
    updated = true;
    break;
  }

  if (!updated) {
    throw new Error(
      `Could not write generation metadata: entry "${metadata.entryId}" not found in plan.`,
    );
  }

  writeFileSync(planPath, doc.toString());
}
