import { describe, expect, it } from "vitest";
import {
  compareInventoryTargets,
  compileCaseRecordCorpus,
  emitCaseRecordProvenance,
  inventoryTargetKey,
  validateCaseRecordRequirement,
} from "./case-record-provenance";
import { parseInvestigationScene } from "./parser-investigation";
import { emptyStoryCatalog } from "./parser-story-catalog";
import type {
  ASTCaseRecordProvenance,
  ASTEvidence,
  ASTStatement,
  CaseRecordMetadataRequirement,
  CaseRecordProvenance,
  InventoryTarget,
  ProceduralStatus,
} from "./types";
import type { SceneRecord } from "./validator";

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

const NEUTRAL_PROVENANCE: CaseRecordProvenance = {
  sourceKind: "unspecified",
  representationLayer: "none",
  proceduralStatus: "unspecified",
  completeness: "unspecified",
  confidence: "unspecified",
  sourceGroupId: null,
  sourceLabel: null,
  proofCapabilities: [],
  supersedesRecordId: null,
};

function located<T extends object>(
  value: T,
  line: number,
  sourceFile = "chapter_1/investigation_scene_1.md",
): T & { sourceFile: string; line: number } {
  return { ...value, sourceFile, line };
}

function astProvenance(
  input: {
    sourceKind?: "digital" | "physical" | "testimony";
    representationLayer?: "raw" | "sync" | "summary" | "composite";
    proceduralStatus?: ProceduralStatus;
    completeness?: "complete" | "partial" | "cropped";
    confidence?: "unverified" | "corroborated" | "disputed";
    sourceGroupId?: string;
    sourceLabel?: string;
    proofCapabilities?: Array<
      | "time"
      | "order"
      | "route"
      | "identity"
      | "access"
      | "motive"
      | "source"
      | "credibility"
      | "procedure"
      | "causation"
    >;
    supersedes?: InventoryTarget;
    supersedesLine?: number;
    sourceGroupLine?: number;
  } = {},
): ASTCaseRecordProvenance {
  const sourceFile = "chapter_1/investigation_scene_1.md";
  return {
    sourceKind:
      input.sourceKind === undefined
        ? null
        : located({ value: input.sourceKind }, 31, sourceFile),
    representationLayer:
      input.representationLayer === undefined
        ? null
        : located({ value: input.representationLayer }, 32, sourceFile),
    proceduralStatus:
      input.proceduralStatus === undefined
        ? null
        : located({ value: input.proceduralStatus }, 33, sourceFile),
    completeness:
      input.completeness === undefined
        ? null
        : located({ value: input.completeness }, 34, sourceFile),
    confidence:
      input.confidence === undefined
        ? null
        : located({ value: input.confidence }, 35, sourceFile),
    sourceGroupId:
      input.sourceGroupId === undefined
        ? null
        : located(
            { value: input.sourceGroupId },
            input.sourceGroupLine ?? 36,
            sourceFile,
          ),
    sourceLabel:
      input.sourceLabel === undefined
        ? null
        : located({ value: input.sourceLabel }, 37, sourceFile),
    proofCapabilities: (input.proofCapabilities ?? []).map((value) =>
      located({ value }, 38, sourceFile),
    ),
    supersedes:
      input.supersedes === undefined
        ? null
        : located(input.supersedes, input.supersedesLine ?? 39, sourceFile),
  };
}

type TestCaseRecord = {
  target: InventoryTarget;
  line: number;
  provenance?: ASTCaseRecordProvenance;
};

function caseRecordScene(
  records: TestCaseRecord[],
  sceneId = "investigation_scene_1",
): SceneRecord {
  const sourceFile = `chapter_1/${sceneId}.md`;
  const evidenceManifest: ASTEvidence[] = [];
  const statementManifest: ASTStatement[] = [];

  for (const record of records) {
    if (record.target.kind === "evidence") {
      evidenceManifest.push({
        id: record.target.id,
        name: record.target.id,
        description: "Description.",
        details: "Details.",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: null,
        provenance: record.provenance ?? astProvenance(),
        onCollect: [],
        onReexamine: null,
        sourceFile,
        line: record.line,
      });
    } else {
      statementManifest.push({
        id: record.target.id,
        speaker: "Witness",
        content: "Statement.",
        provenance: record.provenance ?? astProvenance(),
        onAcquire: [],
        onReexamine: null,
        sourceFile,
        line: record.line,
      });
    }
  }

  return {
    chapterId: "chapter_1",
    file: `${sceneId}.md`,
    ast: {
      kind: "investigationScene",
      id: sceneId,
      title: "Investigation",
      intro: [],
      sublocations: [],
      evidenceManifest,
      statementManifest,
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [],
      sourceFile,
      line: 1,
    },
  };
}

function sourceGroup(
  id: string,
  line: number,
): {
  id: string;
  label: string;
  summary: string;
  sourceFile: string;
  line: number;
} {
  return {
    id,
    label: id,
    summary: `${id} summary.`,
    sourceFile: "story_catalog.md",
    line,
  };
}

function compileRecords(
  records: TestCaseRecord[],
  groups: ReturnType<typeof sourceGroup>[] = [],
) {
  const catalog = emptyStoryCatalog("story_catalog.md");
  catalog.sourceGroups = groups;
  return compileCaseRecordCorpus(catalog, [caseRecordScene(records)]);
}

describe("case record corpus", () => {
  it("normalizes records once while preserving typed namespaces, origins, and deterministic indexes", () => {
    const catalog = emptyStoryCatalog("story_catalog.md");
    catalog.sourceGroups = [sourceGroup("shared_source", 40)];
    const scenes = [
      caseRecordScene([
        {
          target: { kind: "evidence", id: "z_record" },
          line: 21,
        },
        {
          target: { kind: "evidence", id: "shared" },
          line: 22,
          provenance: astProvenance({
            sourceKind: "digital",
            representationLayer: "composite",
            proceduralStatus: "reacquired",
            completeness: "complete",
            confidence: "corroborated",
            sourceGroupId: "shared_source",
            sourceLabel: "Shared feed",
            proofCapabilities: ["procedure", "time"],
          }),
        },
        {
          target: { kind: "statement", id: "shared" },
          line: 23,
          provenance: astProvenance({
            sourceKind: "testimony",
            sourceGroupId: "shared_source",
          }),
        },
        {
          target: { kind: "statement", id: "a_record" },
          line: 24,
        },
      ]),
    ];

    const result = compileCaseRecordCorpus(catalog, scenes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.recordsByKey.keys()].sort()).toEqual([
      "evidence:shared",
      "evidence:z_record",
      "statement:a_record",
      "statement:shared",
    ]);
    expect(result.value.recordsByKey.get("evidence:z_record")).toMatchObject({
      target: { kind: "evidence", id: "z_record" },
      chapterId: "chapter_1",
      sceneId: "investigation_scene_1",
      provenance: NEUTRAL_PROVENANCE,
      sourceFile: "chapter_1/investigation_scene_1.md",
      line: 21,
    });
    expect(
      result.value.recordsByKey.get("evidence:shared")?.provenance,
    ).toEqual({
      sourceKind: "digital",
      representationLayer: "composite",
      proceduralStatus: "reacquired",
      completeness: "complete",
      confidence: "corroborated",
      sourceGroupId: "shared_source",
      sourceLabel: "Shared feed",
      proofCapabilities: ["time", "procedure"],
      supersedesRecordId: null,
    });
    expect(result.value.evidenceIndex.map(({ id }) => id)).toEqual([
      "shared",
      "z_record",
    ]);
    expect(result.value.statementsIndex.map(({ id }) => id)).toEqual([
      "a_record",
      "shared",
    ]);
    expect(result.value.sourceGroups).toEqual([
      {
        id: "shared_source",
        label: "shared_source",
        summary: "shared_source summary.",
        members: [
          { kind: "evidence", id: "shared" },
          { kind: "statement", id: "shared" },
        ],
      },
    ]);
  });

  it("uses explicit typed keys and evidence-before-statement ordering", () => {
    expect(inventoryTargetKey({ kind: "evidence", id: "same" })).toBe(
      "evidence:same",
    );
    expect(inventoryTargetKey({ kind: "statement", id: "same" })).toBe(
      "statement:same",
    );
    const targets: InventoryTarget[] = [
      { kind: "statement", id: "a" },
      { kind: "evidence", id: "z" },
      { kind: "evidence", id: "a" },
      { kind: "statement", id: "z" },
    ];
    expect(targets.sort(compareInventoryTargets)).toEqual([
      { kind: "evidence", id: "a" },
      { kind: "evidence", id: "z" },
      { kind: "statement", id: "a" },
      { kind: "statement", id: "z" },
    ]);
  });

  it("rejects an undeclared group at the record Source Group line", () => {
    const result = compileRecords([
      {
        target: { kind: "evidence", id: "record" },
        line: 20,
        provenance: astProvenance({
          sourceGroupId: "missing_group",
          sourceGroupLine: 36,
        }),
      },
    ]);

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "caseRecordSourceGroupUnknown",
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 36,
        }),
      ],
    });
  });

  it("rejects an unused group at its heading", () => {
    const result = compileRecords(
      [{ target: { kind: "evidence", id: "ungrouped" }, line: 20 }],
      [sourceGroup("unused_group", 44)],
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "caseRecordSourceGroupUnused",
          sourceFile: "story_catalog.md",
          line: 44,
        }),
      ],
    });
  });

  it("accepts singletons, excludes null-group records, and warns exactly in group-ID order", () => {
    const result = compileRecords(
      [
        {
          target: { kind: "statement", id: "z_member" },
          line: 20,
          provenance: astProvenance({ sourceGroupId: "z_group" }),
        },
        {
          target: { kind: "evidence", id: "a_member" },
          line: 21,
          provenance: astProvenance({ sourceGroupId: "a_group" }),
        },
        {
          target: { kind: "evidence", id: "no_group" },
          line: 22,
        },
      ],
      [sourceGroup("z_group", 50), sourceGroup("a_group", 45)],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceGroups).toEqual([
      {
        id: "a_group",
        label: "a_group",
        summary: "a_group summary.",
        members: [{ kind: "evidence", id: "a_member" }],
      },
      {
        id: "z_group",
        label: "z_group",
        summary: "z_group summary.",
        members: [{ kind: "statement", id: "z_member" }],
      },
    ]);
    expect(result.value.warnings).toEqual([
      {
        code: "singletonSourceGroup",
        message: 'Source group "a_group" has one member: evidence:a_member.',
        sourceFile: "story_catalog.md",
        line: 45,
      },
      {
        code: "singletonSourceGroup",
        message: 'Source group "z_group" has one member: statement:z_member.',
        sourceFile: "story_catalog.md",
        line: 50,
      },
    ]);
  });
});

describe("case record supersession graph", () => {
  it("accepts equal and advancing procedural status", () => {
    const result = compileRecords([
      {
        target: { kind: "evidence", id: "lead_a" },
        line: 20,
        provenance: astProvenance({ proceduralStatus: "lead" }),
      },
      {
        target: { kind: "evidence", id: "lead_b" },
        line: 21,
        provenance: astProvenance({
          proceduralStatus: "lead",
          supersedes: { kind: "evidence", id: "lead_a" },
          supersedesLine: 41,
        }),
      },
      {
        target: { kind: "evidence", id: "reacquired" },
        line: 22,
        provenance: astProvenance({
          proceduralStatus: "reacquired",
          supersedes: { kind: "evidence", id: "lead_b" },
          supersedesLine: 42,
        }),
      },
      {
        target: { kind: "evidence", id: "exhibit" },
        line: 23,
        provenance: astProvenance({
          proceduralStatus: "exhibit",
          supersedes: { kind: "evidence", id: "reacquired" },
          supersedesLine: 43,
        }),
      },
    ]);

    expect(result.ok).toBe(true);
  });

  it.each([
    [
      "unknown predecessor",
      [
        {
          target: { kind: "evidence", id: "successor" } as const,
          line: 20,
          provenance: astProvenance({
            supersedes: { kind: "evidence", id: "missing" },
            supersedesLine: 61,
          }),
        },
      ],
      "caseRecordSupersessionUnknown",
      61,
    ],
    [
      "cross-kind predecessor",
      [
        {
          target: { kind: "statement", id: "previous" } as const,
          line: 20,
        },
        {
          target: { kind: "evidence", id: "successor" } as const,
          line: 21,
          provenance: astProvenance({
            supersedes: { kind: "evidence", id: "previous" },
            supersedesLine: 62,
          }),
        },
      ],
      "caseRecordSupersessionKindMismatch",
      62,
    ],
    [
      "self predecessor",
      [
        {
          target: { kind: "evidence", id: "self" } as const,
          line: 20,
          provenance: astProvenance({
            supersedes: { kind: "evidence", id: "self" },
            supersedesLine: 63,
          }),
        },
      ],
      "caseRecordSupersessionSelf",
      63,
    ],
  ])(
    "rejects %s at the successor Supersedes line",
    (_label, records, code, line) => {
      const result = compileRecords(records);

      expect(result).toEqual({
        ok: false,
        errors: [
          expect.objectContaining({
            code,
            sourceFile: "chapter_1/investigation_scene_1.md",
            line,
          }),
        ],
      });
    },
  );

  it("rejects a fork at the later successor Supersedes line", () => {
    const result = compileRecords([
      { target: { kind: "evidence", id: "root" }, line: 20 },
      {
        target: { kind: "evidence", id: "branch_a" },
        line: 21,
        provenance: astProvenance({
          supersedes: { kind: "evidence", id: "root" },
          supersedesLine: 64,
        }),
      },
      {
        target: { kind: "evidence", id: "branch_b" },
        line: 22,
        provenance: astProvenance({
          supersedes: { kind: "evidence", id: "root" },
          supersedesLine: 65,
        }),
      },
    ]);

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "caseRecordSupersessionFork",
          line: 65,
        }),
      ],
    });
  });

  it.each([
    [
      "two-node",
      [
        {
          target: { kind: "evidence", id: "a" } as const,
          line: 20,
          provenance: astProvenance({
            supersedes: { kind: "evidence", id: "b" },
            supersedesLine: 71,
          }),
        },
        {
          target: { kind: "evidence", id: "b" } as const,
          line: 21,
          provenance: astProvenance({
            supersedes: { kind: "evidence", id: "a" },
            supersedesLine: 72,
          }),
        },
      ],
    ],
    [
      "longer",
      [
        {
          target: { kind: "evidence", id: "a" } as const,
          line: 20,
          provenance: astProvenance({
            supersedes: { kind: "evidence", id: "c" },
            supersedesLine: 73,
          }),
        },
        {
          target: { kind: "evidence", id: "b" } as const,
          line: 21,
          provenance: astProvenance({
            supersedes: { kind: "evidence", id: "a" },
            supersedesLine: 74,
          }),
        },
        {
          target: { kind: "evidence", id: "c" } as const,
          line: 22,
          provenance: astProvenance({
            supersedes: { kind: "evidence", id: "b" },
            supersedesLine: 75,
          }),
        },
      ],
    ],
  ])("rejects a %s cycle at a successor Supersedes line", (_label, records) => {
    const result = compileRecords(records);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "caseRecordSupersessionCycle",
        sourceFile: "chapter_1/investigation_scene_1.md",
      }),
    );
    expect([71, 72, 73, 74, 75]).toContain(
      result.errors.find(({ code }) => code === "caseRecordSupersessionCycle")
        ?.line,
    );
  });

  it.each([
    ["exhibit to reacquired", "exhibit", "reacquired", 81],
    ["explicit lead to omitted unspecified", "lead", undefined, 82],
  ] as const)(
    "rejects procedural regression for %s",
    (_label, predecessorStatus, successorStatus, line) => {
      const result = compileRecords([
        {
          target: { kind: "evidence", id: "predecessor" },
          line: 20,
          provenance: astProvenance({
            proceduralStatus: predecessorStatus,
          }),
        },
        {
          target: { kind: "evidence", id: "successor" },
          line: 21,
          provenance: astProvenance({
            ...(successorStatus === undefined
              ? {}
              : { proceduralStatus: successorStatus }),
            supersedes: { kind: "evidence", id: "predecessor" },
            supersedesLine: line,
          }),
        },
      ]);

      expect(result).toEqual({
        ok: false,
        errors: [
          expect.objectContaining({
            code: "caseRecordProceduralStatusRegression",
            line,
          }),
        ],
      });
    },
  );
});

const ALLOW_ANY_REQUIREMENT: CaseRecordMetadataRequirement = {
  allowedSourceKinds: null,
  allowedRepresentationLayers: null,
  allowedProceduralStatuses: null,
  prohibitedProceduralStatuses: [],
  allowedCompleteness: null,
  allowedConfidence: null,
  requireSourceGroup: false,
  requiredProofCapabilities: [],
};

describe("case record metadata requirement", () => {
  const record = {
    id: "candidate",
    provenance: {
      sourceKind: "digital",
      representationLayer: "composite",
      proceduralStatus: "lead",
      completeness: "cropped",
      confidence: "disputed",
      sourceGroupId: null,
      sourceLabel: "Candidate",
      proofCapabilities: ["time", "route"],
      supersedesRecordId: null,
    } satisfies CaseRecordProvenance,
  };
  const requirementLocation = {
    sourceFile: "analysis_scene.md",
    line: 91,
  };

  it.each([
    ["source kind", { allowedSourceKinds: ["physical"] }],
    ["representation layer", { allowedRepresentationLayers: ["raw"] }],
    ["allowed procedural status", { allowedProceduralStatuses: ["exhibit"] }],
    [
      "prohibited procedural status",
      { prohibitedProceduralStatuses: ["lead"] },
    ],
    ["completeness", { allowedCompleteness: ["complete"] }],
    ["confidence", { allowedConfidence: ["corroborated"] }],
    ["required source group", { requireSourceGroup: true }],
    [
      "required proof capabilities",
      { requiredProofCapabilities: ["identity"] },
    ],
  ] satisfies Array<[string, Partial<CaseRecordMetadataRequirement>]>)(
    "fails %s independently at the requirement",
    (_label, override) => {
      const errors = validateCaseRecordRequirement(
        record,
        { ...ALLOW_ANY_REQUIREMENT, ...override },
        requirementLocation,
      );

      expect(errors).toEqual([
        expect.objectContaining({
          code: "caseRecordRequirementFailed",
          message: expect.stringContaining("candidate"),
          sourceFile: "analysis_scene.md",
          line: 91,
        }),
      ]);
    },
  );

  it("lets a prohibited status win over an allowed status", () => {
    const errors = validateCaseRecordRequirement(
      record,
      {
        ...ALLOW_ANY_REQUIREMENT,
        allowedProceduralStatuses: ["lead"],
        prohibitedProceduralStatuses: ["lead"],
      },
      requirementLocation,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("prohibited");
  });
});
