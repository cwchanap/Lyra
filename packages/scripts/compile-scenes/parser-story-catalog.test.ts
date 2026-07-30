import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emptyStoryCatalog, parseStoryCatalog } from "./parser-story-catalog";

const SOURCE_FILE = "story_catalog.md";

const CANONICAL_CATALOG = `# Story Catalog

## Facts

### Fact: 門鎖時間線不一致 {#door_timeline_conflict}
- **Summary:** 兩份時間紀錄無法同時成立。
- **Details:** 門鎖與咖啡機紀錄存在矛盾。
- **Category:** timeline

## Questions

### Question: 誰修改了時間紀錄？ {#who_changed_timeline}

- **Summary:** 確認哪份紀錄遭到修改。
- **Resolved By:** [fact:door_timeline_conflict]

## Objectives

### Objective: 查明時間線矛盾 {#resolve_timeline}
- **Summary:** 比對所有可驗證的時間來源。
- **Kind:** primary
- **Sort Order:** 10

## Authorizations

### Authorization: 調閱門鎖紀錄 {#access_lock_logs}
- **Summary:** 允許取得原始門鎖稽核資料。
- **Granting Authority:** 警視廳搜查一課

## Source Groups

### Source Group: 澀谷活動 Program Composite {#shibuya_program_composite}
- **Summary:** 同一活動方 Program Composite 輸出衍生的紀錄。`;

function validFact(id = "fact_one"): string {
  return `### Fact: Fact ${id} {#${id}}
- **Summary:** Summary.
- **Details:** Details.
- **Category:** timeline`;
}

function catalogWithFacts(facts: string): string {
  return `# Story Catalog

## Facts

${facts}`;
}

function catalogWithObjectiveSortOrder(sortOrder: string): string {
  return `# Story Catalog

## Objectives

### Objective: Objective {#objective_one}
- **Summary:** Summary.
- **Kind:** primary
- **Sort Order:** ${sortOrder}`;
}

function sourceGroupCatalog(definition: string): string {
  return `# Story Catalog

## Source Groups

${definition}`;
}

function validSourceGroup(id = "shibuya_program_composite"): string {
  return `### Source Group: Source group ${id} {#${id}}
- **Summary:** Records derived from one underlying source.`;
}

function errorsFor(source: string) {
  const result = parseStoryCatalog(source, SOURCE_FILE);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected catalog parsing to fail.");
  return result.errors;
}

describe("parseStoryCatalog", () => {
  it("parses the canonical document with source-located definitions and references", () => {
    const result = parseStoryCatalog(CANONICAL_CATALOG, SOURCE_FILE);

    expect(result).toMatchObject({
      ok: true,
      value: {
        facts: [{ id: "door_timeline_conflict", line: 5 }],
        questions: [
          {
            id: "who_changed_timeline",
            resolvedByFactIds: [{ id: "door_timeline_conflict", line: 15 }],
          },
        ],
        objectives: [
          { id: "resolve_timeline", kind: "primary", sortOrder: 10 },
        ],
        authorizations: [{ id: "access_lock_logs" }],
        sourceGroups: [{ id: "shibuya_program_composite", line: 32 }],
      },
    });
  });

  it("parses the fixture's final source-group registry", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../__fixtures__/story_catalog/valid/story_catalog.md",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(parseStoryCatalog(source, SOURCE_FILE)).toMatchObject({
      ok: true,
      value: {
        sourceGroups: [
          {
            id: "shibuya_program_composite",
            label: "澀谷活動 Program Composite",
            summary: "同一活動方 Program Composite 輸出衍生的紀錄。",
          },
        ],
      },
    });
  });

  it("accepts omitted and empty sections", () => {
    expect(parseStoryCatalog("# Story Catalog", SOURCE_FILE)).toMatchObject({
      ok: true,
      value: {
        facts: [],
        questions: [],
        objectives: [],
        authorizations: [],
        sourceGroups: [],
      },
    });

    expect(
      parseStoryCatalog(
        `# Story Catalog

## Facts

## Questions

## Objectives

## Authorizations`,
        SOURCE_FILE,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        facts: [],
        questions: [],
        objectives: [],
        authorizations: [],
        sourceGroups: [],
      },
    });
  });

  it("preserves authored item order", () => {
    const result = parseStoryCatalog(
      catalogWithFacts(`${validFact("second")}

${validFact("first")}`),
      SOURCE_FILE,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { facts: [{ id: "second" }, { id: "first" }] },
    });
  });

  it("accepts literal empty Resolved By lists", () => {
    const result = parseStoryCatalog(
      `# Story Catalog

## Questions

### Question: Open question {#open_question}
- **Summary:** It remains open.
- **Resolved By:** []`,
      SOURCE_FILE,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        questions: [{ id: "open_question", resolvedByFactIds: [] }],
      },
    });
  });

  it("creates an empty catalog for an absent authored file", () => {
    expect(emptyStoryCatalog(SOURCE_FILE)).toEqual({
      facts: [],
      questions: [],
      objectives: [],
      authorizations: [],
      sourceGroups: [],
      sourceFile: SOURCE_FILE,
      line: 1,
    });
  });

  it("reports a blank required field without also reporting it as missing", () => {
    const errors = errorsFor(
      catalogWithFacts(
        `### Fact: Fact {#fact_one}
- **Summary:** 
- **Details:** Details.
- **Category:** timeline`,
      ),
    );

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "storyCatalogMalformed",
        sourceFile: SOURCE_FILE,
        line: 6,
      }),
    );
    expect(errors).not.toContainEqual(
      expect.objectContaining({ code: "storyCatalogMissingField", line: 5 }),
    );
  });

  it("accumulates independently detectable objective semantic errors", () => {
    const errors = errorsFor(
      `# Story Catalog

## Objectives

### Objective: Objective {#objective_one}
- **Summary:** Summary.
- **Kind:** tertiary
- **Sort Order:** 1.5`,
    );

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "storyCatalogMalformed",
        sourceFile: SOURCE_FILE,
        line: 7,
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "storyCatalogMalformed",
        sourceFile: SOURCE_FILE,
        line: 8,
      }),
    );
  });

  it.each([
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    [String(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER],
  ])("accepts safe-integer Sort Order boundary %s", (source, expected) => {
    const result = parseStoryCatalog(
      catalogWithObjectiveSortOrder(source),
      SOURCE_FILE,
    );

    expect(result).toMatchObject({
      ok: true,
      value: { objectives: [{ sortOrder: expected }] },
    });
  });

  it.each(["9007199254740992", "-9007199254740992", "1e100"])(
    "rejects unsafe or exponent Sort Order %s at the metadata line",
    (sortOrder) => {
      expect(errorsFor(catalogWithObjectiveSortOrder(sortOrder))).toEqual([
        expect.objectContaining({
          code: "storyCatalogMalformed",
          sourceFile: SOURCE_FILE,
          line: 8,
        }),
      ]);
    },
  );

  it("reports one accurate diagnostic for a malformed first nonblank H1", () => {
    expect(errorsFor("\n\n# Catalog")).toEqual([
      expect.objectContaining({
        code: "storyCatalogMalformed",
        sourceFile: SOURCE_FILE,
        line: 3,
      }),
    ]);
  });

  it("validates Resolved By even when its definition ID is invalid", () => {
    const errors = errorsFor(
      `# Story Catalog

## Questions

### Question: Question {#Question_One}
- **Summary:** Summary.
- **Resolved By:** [evidence:record]`,
    );

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "invalidGlobalDefinitionId",
        sourceFile: SOURCE_FILE,
        line: 5,
      }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "storyCatalogMalformed",
        sourceFile: SOURCE_FILE,
        line: 7,
      }),
    );
  });

  it.each([
    ["malformed H1", "# Catalog", "storyCatalogMalformed", 1],
    [
      "unknown H2",
      "# Story Catalog\n\n## Unknown",
      "storyCatalogUnknownSection",
      3,
    ],
    [
      "out-of-order H2",
      "# Story Catalog\n\n## Questions\n\n## Facts",
      "storyCatalogSectionOutOfOrder",
      5,
    ],
    [
      "repeated H2",
      "# Story Catalog\n\n## Facts\n\n## Facts",
      "storyCatalogDuplicateSection",
      5,
    ],
    [
      "repeated source-group H2",
      "# Story Catalog\n\n## Source Groups\n\n## Source Groups",
      "storyCatalogDuplicateSection",
      5,
    ],
    [
      "source-group H2 before authorizations",
      "# Story Catalog\n\n## Source Groups\n\n## Authorizations",
      "storyCatalogSectionOutOfOrder",
      5,
    ],
    [
      "misplaced H3",
      "# Story Catalog\n\n### Fact: Fact {#fact_one}",
      "storyCatalogMalformed",
      3,
    ],
    [
      "mismatched H3",
      "# Story Catalog\n\n## Facts\n\n### Question: Question {#question_one}",
      "storyCatalogMalformed",
      5,
    ],
    [
      "malformed source-group H3",
      sourceGroupCatalog("### Source Group: Missing identifier"),
      "storyCatalogMalformed",
      5,
    ],
    [
      "blank source-group label",
      sourceGroupCatalog(
        "### Source Group:  {#shibuya_program_composite}\n- **Summary:** Summary.",
      ),
      "storyCatalogMalformed",
      5,
    ],
    [
      "invalid source-group slug",
      sourceGroupCatalog(validSourceGroup("Shibuya-Program")),
      "invalidGlobalDefinitionId",
      5,
    ],
    [
      "missing source-group Summary",
      sourceGroupCatalog(
        "### Source Group: Source group {#shibuya_program_composite}",
      ),
      "storyCatalogMissingField",
      5,
    ],
    [
      "blank source-group Summary",
      sourceGroupCatalog(
        "### Source Group: Source group {#shibuya_program_composite}\n- **Summary:** ",
      ),
      "storyCatalogMalformed",
      6,
    ],
    [
      "repeated source-group Summary",
      sourceGroupCatalog(`${validSourceGroup()}\n- **Summary:** Again.`),
      "storyCatalogDuplicateField",
      7,
    ],
    [
      "unknown source-group field",
      sourceGroupCatalog(`${validSourceGroup()}\n- **Unknown:** metadata`),
      "storyCatalogUnknownField",
      7,
    ],
    [
      "authored source-group Members",
      sourceGroupCatalog(
        `${validSourceGroup()}\n- **Members:** [evidence:record]`,
      ),
      "storyCatalogUnknownField",
      7,
    ],
    [
      "unknown metadata",
      catalogWithFacts(`${validFact()}\n- **Unknown:** metadata`),
      "storyCatalogUnknownField",
      9,
    ],
    [
      "missing metadata",
      catalogWithFacts(
        `### Fact: Fact {#fact_one}\n- **Summary:** Summary.\n- **Details:** Details.`,
      ),
      "storyCatalogMissingField",
      5,
    ],
    [
      "repeated metadata",
      catalogWithFacts(`${validFact()}\n- **Summary:** Again.`),
      "storyCatalogDuplicateField",
      9,
    ],
    [
      "blank required value",
      catalogWithFacts(
        `### Fact: Fact {#fact_one}\n- **Summary:** \n- **Details:** Details.\n- **Category:** timeline`,
      ),
      "storyCatalogMalformed",
      6,
    ],
    [
      "bad objective kind",
      `# Story Catalog\n\n## Objectives\n\n### Objective: Objective {#objective_one}\n- **Summary:** Summary.\n- **Kind:** tertiary\n- **Sort Order:** 1`,
      "storyCatalogMalformed",
      7,
    ],
    [
      "bad objective sort order",
      `# Story Catalog\n\n## Objectives\n\n### Objective: Objective {#objective_one}\n- **Summary:** Summary.\n- **Kind:** primary\n- **Sort Order:** 1.5`,
      "storyCatalogMalformed",
      8,
    ],
    [
      "blank Resolved By",
      `# Story Catalog\n\n## Questions\n\n### Question: Question {#question_one}\n- **Summary:** Summary.\n- **Resolved By:** `,
      "storyCatalogMalformed",
      7,
    ],
    [
      "malformed Resolved By reference",
      `# Story Catalog\n\n## Questions\n\n### Question: Question {#question_one}\n- **Summary:** Summary.\n- **Resolved By:** [evidence:record]`,
      "storyCatalogMalformed",
      7,
    ],
    [
      "uppercase definition ID",
      catalogWithFacts(validFact("Fact_One")),
      "invalidGlobalDefinitionId",
      5,
    ],
    [
      "hyphenated definition ID",
      catalogWithFacts(validFact("fact-one")),
      "invalidGlobalDefinitionId",
      5,
    ],
    [
      "Unicode definition ID",
      catalogWithFacts(validFact("事實")),
      "invalidGlobalDefinitionId",
      5,
    ],
    [
      "uppercase reference ID",
      `# Story Catalog\n\n## Questions\n\n### Question: Question {#question_one}\n- **Summary:** Summary.\n- **Resolved By:** [fact:Fact_One]`,
      "invalidGlobalDefinitionId",
      7,
    ],
  ])("reports %s at its authored line", (_name, source, code, line) => {
    const errors = errorsFor(source);
    expect(errors).toContainEqual(
      expect.objectContaining({ code, sourceFile: SOURCE_FILE, line }),
    );
  });
});
