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
- **Granting Authority:** 警視廳搜查一課`;

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
      sourceFile: SOURCE_FILE,
      line: 1,
    });
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
