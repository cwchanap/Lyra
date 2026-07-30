import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { compile, formatErrors } from "./orchestrator";

const INVESTIGATION_TEMPLATE = readFileSync(
  fileURLToPath(
    new URL(
      "../__fixtures__/valid/chapter_1/investigation_scene_1.md",
      import.meta.url,
    ),
  ),
  "utf8",
);
const INTERROGATION_TEMPLATE = readFileSync(
  fileURLToPath(
    new URL(
      "../__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md",
      import.meta.url,
    ),
  ),
  "utf8",
);

function replaceOnce(
  input: string,
  anchor: string,
  replacement: string,
  label: string,
): string {
  const first = input.indexOf(anchor);
  if (first === -1) {
    throw new Error(
      `replaceOnce: ${label} anchor not found in template: ${anchor}`,
    );
  }
  if (input.indexOf(anchor, first + anchor.length) !== -1) {
    throw new Error(
      `replaceOnce: ${label} anchor is not unique in template: ${anchor}`,
    );
  }
  return input.replace(anchor, replacement);
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

type CorpusOrder = "forward" | "reverse";

type CompiledCatalog = {
  schemaVersion: number;
  facts: Array<{ id: string }>;
  sourceGroups: Array<{
    id: string;
    label: string;
    summary: string;
    members: Array<{ kind: "evidence" | "statement"; id: string }>;
  }>;
  evidenceIndex: Array<{
    id: string;
    chapterId: string;
    sceneId: string;
    provenance: Record<string, unknown>;
  }>;
  statementsIndex: Array<{
    id: string;
    chapterId: string;
    sceneId: string;
    provenance: Record<string, unknown>;
  }>;
};

type OutputTreeEntry =
  | { path: string; kind: "directory" }
  | { path: string; kind: "file"; base64Contents: string };

const COLLIDING_RECORD_ID = "camera_exhibit";

const EXPECTED_STATEMENT_PROVENANCE = {
  sourceKind: "testimony",
  representationLayer: "raw",
  proceduralStatus: "lead",
  completeness: "complete",
  confidence: "corroborated",
  sourceGroupId: "mixed_station_source",
  sourceLabel: "Station witness interview",
  proofCapabilities: ["identity", "credibility"],
  supersedesRecordId: null,
};

function evidenceEntry(
  id: string,
  status: "lead" | "reacquired" | "exhibit",
  capabilities: string[],
  supersedes: string | null,
): string {
  return `### evidence:${id} {#${id}}

- **Name:** ${id}
- **Description:** ${id} description.
- **Details:** ${id} details.
- **Source Sublocation:** main_hall
- **Source Kind:** digital
- **Representation Layer:** sync
- **Procedural Status:** ${status}
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** mixed_station_source
- **Source Label:** Station camera export
- **Proof Capabilities:** [${capabilities.join(", ")}]${
    supersedes === null ? "" : `\n- **Supersedes:** evidence:${supersedes}`
  }

#### On Collect

**相馬律**：已取得 ${id}。
`;
}

function statementEntry(): string {
  return `### statement:${COLLIDING_RECORD_ID} {#${COLLIDING_RECORD_ID}}

- **Speaker:** 證人
- **Content:** 「車站時鐘與攝影機一致。」
- **Source Kind:** testimony
- **Representation Layer:** raw
- **Procedural Status:** lead
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** mixed_station_source
- **Source Label:** Station witness interview
- **Proof Capabilities:** [credibility, identity]

#### On Acquire

**證人**：我核對過車站時鐘。
`;
}

function storyCatalogSource(): string {
  return `# Story Catalog

## Facts

### Fact: Clock corroboration {#fact_clock}

- **Summary:** The witness corroborates the station clock.
- **Details:** Direct statement support.
- **Category:** timeline

### Fact: Camera timeline {#fact_timeline}

- **Summary:** The camera timeline follows from clock corroboration.
- **Details:** Direct and transitive case-record support.
- **Category:** timeline

## Source Groups

### Source Group: 車站時鐘與攝影機來源 {#mixed_station_source}

- **Summary:** 同一車站來源的攝影機版本與證人核對紀錄。
`;
}

function writeCorpus(order: CorpusOrder): {
  sourceRoot: string;
  outputRoot: string;
} {
  const sourceRoot = mkdtempSync(
    resolve(tmpdir(), `lyra-provenance-integration-${order}-source-`),
  );
  const outputRoot = mkdtempSync(
    resolve(tmpdir(), `lyra-provenance-integration-${order}-output-`),
  );
  tempRoots.push(sourceRoot, outputRoot);
  const chapterRoot = resolve(sourceRoot, "chapter_1");
  mkdirSync(chapterRoot);

  writeFileSync(
    resolve(chapterRoot, "chapter.md"),
    `# Chapter 1: Provenance integration

**Summary:** Compiler boundary fixture.

## Scenes

${(order === "forward"
  ? ["investigation_scene_1.md", "interrogation_scene_2.md"]
  : ["interrogation_scene_2.md", "investigation_scene_1.md"]
)
  .map((file, index) => `${index + 1}. ${file}`)
  .join("\n")}
`,
  );

  const entries = {
    camera_lead: evidenceEntry(
      "camera_lead",
      "lead",
      order === "forward" ? ["source", "time"] : ["time", "source"],
      null,
    ),
    camera_reacquired: evidenceEntry(
      "camera_reacquired",
      "reacquired",
      order === "forward"
        ? ["procedure", "route", "time"]
        : ["time", "procedure", "route"],
      "camera_lead",
    ),
    camera_exhibit: evidenceEntry(
      "camera_exhibit",
      "exhibit",
      order === "forward"
        ? ["causation", "identity", "source", "time", "procedure"]
        : ["procedure", "source", "identity", "causation", "time"],
      "camera_reacquired",
    ),
  };
  const evidenceOrder =
    order === "forward"
      ? ["camera_lead", "camera_reacquired", "camera_exhibit"]
      : ["camera_exhibit", "camera_reacquired", "camera_lead"];
  const investigation = replaceOnce(
    replaceOnce(
      INVESTIGATION_TEMPLATE,
      "- **Reveals:** [evidence:coffee, sublocation:back_room]",
      "- **Reveals:** [evidence:coffee, evidence:camera_exhibit, evidence:camera_lead, evidence:camera_reacquired, sublocation:back_room]",
      "investigation reveals",
    ),
    "## Statement Manifest",
    `${evidenceOrder.map((id) => entries[id as keyof typeof entries]).join("\n")}\n## Statement Manifest`,
    "investigation statement manifest",
  );
  writeFileSync(
    resolve(chapterRoot, "investigation_scene_1.md"),
    investigation,
  );

  const interrogation = replaceOnce(
    replaceOnce(
      INTERROGATION_TEMPLATE,
      "- **Reveals:** [statement:wakatsuki_entered_for_beans]",
      `- **Reveals:** [statement:wakatsuki_entered_for_beans, statement:${COLLIDING_RECORD_ID}]`,
      "interrogation reveals",
    ),
    "## Outro",
    `${statementEntry()}\n## Outro`,
    "interrogation outro",
  );
  writeFileSync(
    resolve(chapterRoot, "interrogation_scene_2.md"),
    interrogation,
  );
  writeFileSync(resolve(sourceRoot, "story_catalog.md"), storyCatalogSource());

  return { sourceRoot, outputRoot };
}

function compileCorpus(order: CorpusOrder): {
  sourceRoot: string;
  outputRoot: string;
  catalog: CompiledCatalog;
} {
  const roots = writeCorpus(order);
  const result = compile(roots);
  if (!result.ok) {
    throw new Error(`Compile failed:\n${formatErrors(result.errors)}`);
  }
  return {
    ...roots,
    catalog: JSON.parse(
      readFileSync(resolve(roots.outputRoot, "story_catalog.json"), "utf8"),
    ) as CompiledCatalog,
  };
}

function readScene(
  outputRoot: string,
  file: string,
): {
  evidenceManifest: Array<{
    id: string;
    provenance: Record<string, unknown>;
  }>;
  statementManifest: Array<{
    id: string;
    provenance: Record<string, unknown>;
  }>;
} {
  return JSON.parse(
    readFileSync(resolve(outputRoot, "chapter_1", file), "utf8"),
  );
}

function seedCompilerOutputTree(outputRoot: string): OutputTreeEntry[] {
  mkdirSync(resolve(outputRoot, "chapter_1", "nested"), { recursive: true });
  mkdirSync(resolve(outputRoot, "chapter_9"), { recursive: true });
  writeFileSync(resolve(outputRoot, "chapters.json"), "old chapters\n");
  writeFileSync(resolve(outputRoot, "story_catalog.json"), "old catalog\n");
  writeFileSync(
    resolve(outputRoot, "save_content_manifest.json"),
    "old save manifest\n",
  );
  writeFileSync(
    resolve(outputRoot, "chapter_1", "investigation_scene_1.json"),
    "old investigation\n",
  );
  writeFileSync(
    resolve(outputRoot, "chapter_1", "nested", "legacy.bin"),
    Uint8Array.from([0, 255, 10, 13]),
  );
  writeFileSync(
    resolve(outputRoot, "chapter_9", "stale_scene.json"),
    "old stale scene\n",
  );
  writeFileSync(resolve(outputRoot, ".gitkeep"), "preserve me\n");
  return snapshotOutputTree(outputRoot);
}

function snapshotOutputTree(
  outputRoot: string,
  relativeRoot = "",
): OutputTreeEntry[] {
  const absoluteRoot =
    relativeRoot === "" ? outputRoot : resolve(outputRoot, relativeRoot);
  return readdirSync(absoluteRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): OutputTreeEntry[] => {
      const relativePath =
        relativeRoot === "" ? entry.name : `${relativeRoot}/${entry.name}`;
      if (entry.isDirectory()) {
        return [
          { path: relativePath, kind: "directory" },
          ...snapshotOutputTree(outputRoot, relativePath),
        ];
      }
      return [
        {
          path: relativePath,
          kind: "file",
          base64Contents: readFileSync(
            resolve(outputRoot, relativePath),
          ).toString("base64"),
        },
      ];
    });
}

describe("case-record provenance compiler integration", () => {
  it("emits one canonical v2 corpus across investigation evidence, interrogation statements, and input order", () => {
    const forward = compileCorpus("forward");
    const reverse = compileCorpus("reverse");

    const canonicalBoundary = (catalog: CompiledCatalog) => ({
      sourceGroups: catalog.sourceGroups,
      evidenceIndex: catalog.evidenceIndex,
      statementsIndex: catalog.statementsIndex,
    });
    assert.deepStrictEqual(
      canonicalBoundary(forward.catalog),
      canonicalBoundary(reverse.catalog),
    );

    expect(forward.catalog.schemaVersion).toBe(2);
    expect(forward.catalog.facts.map(({ id }) => id)).toEqual([
      "fact_clock",
      "fact_timeline",
    ]);
    expect(forward.catalog.sourceGroups).toEqual([
      {
        id: "mixed_station_source",
        label: "車站時鐘與攝影機來源",
        summary: "同一車站來源的攝影機版本與證人核對紀錄。",
        members: [
          { kind: "evidence", id: "camera_exhibit" },
          { kind: "evidence", id: "camera_lead" },
          { kind: "evidence", id: "camera_reacquired" },
          { kind: "statement", id: COLLIDING_RECORD_ID },
        ],
      },
    ]);

    const investigation = readScene(
      forward.outputRoot,
      "investigation_scene_1.json",
    );
    const interrogation = readScene(
      forward.outputRoot,
      "interrogation_scene_2.json",
    );
    const emittedRecords = [
      ...investigation.evidenceManifest
        .filter(({ id }) => id.startsWith("camera_"))
        .map((record) => ({ kind: "evidence" as const, ...record })),
      ...interrogation.statementManifest
        .filter(({ id }) => id === COLLIDING_RECORD_ID)
        .map((record) => ({ kind: "statement" as const, ...record })),
    ];
    for (const emitted of emittedRecords) {
      const index =
        emitted.kind === "evidence"
          ? forward.catalog.evidenceIndex
          : forward.catalog.statementsIndex;
      const catalogRecord = index.find(({ id }) => id === emitted.id);
      expect(catalogRecord).toBeDefined();
      assert.deepStrictEqual(emitted.provenance, catalogRecord!.provenance);
    }

    expect(
      forward.catalog.evidenceIndex.find(({ id }) => id === "camera_exhibit")!
        .provenance,
    ).toEqual({
      sourceKind: "digital",
      representationLayer: "sync",
      proceduralStatus: "exhibit",
      completeness: "complete",
      confidence: "corroborated",
      sourceGroupId: "mixed_station_source",
      sourceLabel: "Station camera export",
      proofCapabilities: [
        "time",
        "identity",
        "source",
        "procedure",
        "causation",
      ],
      supersedesRecordId: "evidence:camera_reacquired",
    });
    const sceneStatement = interrogation.statementManifest.find(
      ({ id }) => id === COLLIDING_RECORD_ID,
    );
    expect(sceneStatement).toBeDefined();
    expect(sceneStatement!.provenance).toEqual(EXPECTED_STATEMENT_PROVENANCE);
    expect(
      forward.catalog.statementsIndex.find(
        ({ id }) => id === COLLIDING_RECORD_ID,
      ),
    ).toEqual({
      id: COLLIDING_RECORD_ID,
      chapterId: "chapter_1",
      sceneId: "interrogation_scene_2",
      provenance: EXPECTED_STATEMENT_PROVENANCE,
    });
  });

  it.each([
    {
      label: "duplicate metadata",
      expectedCode: "caseRecordMetadataDuplicateKey",
      mutate(source: string) {
        return source.replace(
          "- **Source Kind:** digital",
          "- **Source Kind:** digital\n- **Source Kind:** physical",
        );
      },
    },
    {
      label: "unknown metadata",
      expectedCode: "caseRecordMetadataUnknownKey",
      mutate(source: string) {
        return source.replace(
          "- **Source Kind:** digital",
          "- **Source Knid:** digital",
        );
      },
    },
  ])(
    "rejects $label before replacing compiler output",
    ({ expectedCode, mutate }) => {
      const { sourceRoot, outputRoot } = writeCorpus("forward");
      const scenePath = resolve(
        sourceRoot,
        "chapter_1/investigation_scene_1.md",
      );
      writeFileSync(scenePath, mutate(readFileSync(scenePath, "utf8")));
      const before = seedCompilerOutputTree(outputRoot);

      const result = compile({ sourceRoot, outputRoot });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: expectedCode }),
      );
      expect(snapshotOutputTree(outputRoot)).toEqual(before);
    },
  );

  it("rejects an authored Source Groups Members field before replacing compiler output", () => {
    const { sourceRoot, outputRoot } = writeCorpus("forward");
    const catalogPath = resolve(sourceRoot, "story_catalog.md");
    writeFileSync(
      catalogPath,
      readFileSync(catalogPath, "utf8").replace(
        "- **Summary:** 同一車站來源的攝影機版本與證人核對紀錄。",
        "- **Summary:** 同一車站來源的攝影機版本與證人核對紀錄。\n- **Members:** [evidence:camera_lead]",
      ),
    );
    const before = seedCompilerOutputTree(outputRoot);

    const result = compile({ sourceRoot, outputRoot });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "storyCatalogUnknownField" }),
    );
    expect(snapshotOutputTree(outputRoot)).toEqual(before);
  });
});
