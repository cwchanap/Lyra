import { describe, expect, it } from "vitest";
import { parseInvestigationScene } from "./parser-investigation";

function evidenceScene(metadata: string): string {
  return `
# Scene 1: provenance

## Intro

**A**：開始。

## Sub-location: room {#room}
- **Status:** unlocked

[場景：房間。]

## Evidence Manifest

### evidence:record {#record}
- **Name:** 紀錄
- **Description:** 用於驗證的紀錄。
- **Details:** 細節。
${metadata}

#### On Collect

**A**：收下。

## Statement Manifest

## Outro

**A**：結束。
`.trim();
}

describe("case record provenance metadata", () => {
  it.each([
    [
      "Source Knid",
      "- **Source Knid:** digital",
      "caseRecordMetadataUnknownKey",
      18,
    ],
    [
      "duplicate Source Kind",
      "- **Source Kind:** digital\n- **Source Kind:** testimony",
      "caseRecordMetadataDuplicateKey",
      19,
    ],
    [
      "blank provenance value",
      "- **Source Kind:**",
      "caseRecordMetadataBlank",
      18,
    ],
    [
      "invalid enum",
      "- **Source Kind:** printed",
      "caseRecordProvenanceInvalidValue",
      18,
    ],
    [
      "duplicate capability",
      "- **Proof Capabilities:** [time, time]",
      "caseRecordProofCapabilityDuplicate",
      18,
    ],
    [
      "unbracketed capability list",
      "- **Proof Capabilities:** time, source",
      "caseRecordProofCapabilityMalformed",
      18,
    ],
    [
      "empty capability entry",
      "- **Proof Capabilities:** [time, ]",
      "caseRecordProofCapabilityMalformed",
      18,
    ],
    [
      "malformed supersedes target",
      "- **Supersedes:** evidence:",
      "caseRecordSupersedesMalformed",
      18,
    ],
  ])("rejects %s at its authored line", (_label, metadata, code, line) => {
    const result = parseInvestigationScene(
      evidenceScene(metadata),
      "provenance.md",
      "provenance",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code, line });
    if (code === "caseRecordMetadataDuplicateKey") {
      expect(result.error.message).toContain("line 18");
    }
  });
});
