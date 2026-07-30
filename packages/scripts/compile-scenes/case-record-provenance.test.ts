import { describe, expect, it } from "vitest";
import { emitCaseRecordProvenance } from "./case-record-provenance";
import { parseInvestigationScene } from "./parser-investigation";
import type { ASTCaseRecordProvenance } from "./types";

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

describe("emitCaseRecordProvenance", () => {
  it("emits the locked neutral defaults for an all-absent AST", () => {
    const provenance: ASTCaseRecordProvenance = {
      sourceKind: null,
      representationLayer: null,
      proceduralStatus: null,
      completeness: null,
      confidence: null,
      sourceGroupId: null,
      sourceLabel: null,
      proofCapabilities: [],
      supersedes: null,
    };

    expect(emitCaseRecordProvenance(provenance)).toEqual({
      sourceKind: "unspecified",
      representationLayer: "none",
      proceduralStatus: "unspecified",
      completeness: "unspecified",
      confidence: "unspecified",
      sourceGroupId: null,
      sourceLabel: null,
      proofCapabilities: [],
      supersedesRecordId: null,
    });
  });

  it("orders already-valid proof capabilities by the canonical rank", () => {
    const provenance: ASTCaseRecordProvenance = {
      sourceKind: null,
      representationLayer: null,
      proceduralStatus: null,
      completeness: null,
      confidence: null,
      sourceGroupId: null,
      sourceLabel: null,
      proofCapabilities: [
        { value: "procedure", sourceFile: "provenance.md", line: 9 },
        { value: "time", sourceFile: "provenance.md", line: 9 },
        { value: "identity", sourceFile: "provenance.md", line: 9 },
        { value: "source", sourceFile: "provenance.md", line: 9 },
      ],
      supersedes: null,
    };

    expect(emitCaseRecordProvenance(provenance).proofCapabilities).toEqual([
      "time",
      "identity",
      "source",
      "procedure",
    ]);
  });
});
