import type { ASTStoryCatalog, CompileError, Located } from "./types";

export type StoryCatalogParseResult =
  | { ok: true; value: ASTStoryCatalog }
  | { ok: false; errors: CompileError[] };

type Section = "Facts" | "Questions" | "Objectives" | "Authorizations";
type ItemKind = "Fact" | "Question" | "Objective" | "Authorization";

type Item = {
  kind: ItemKind;
  id: string;
  label: string;
  line: number;
  fields: Map<string, { value: string; line: number }>;
  invalid: boolean;
};

const SECTION_ORDER: Section[] = [
  "Facts",
  "Questions",
  "Objectives",
  "Authorizations",
];

const ITEM_KIND_BY_SECTION: Record<Section, ItemKind> = {
  Facts: "Fact",
  Questions: "Question",
  Objectives: "Objective",
  Authorizations: "Authorization",
};

const FIELDS_BY_KIND: Record<ItemKind, readonly string[]> = {
  Fact: ["Summary", "Details", "Category"],
  Question: ["Summary", "Resolved By"],
  Objective: ["Summary", "Kind", "Sort Order"],
  Authorization: ["Summary", "Granting Authority"],
};

const ID_RE = /^[a-z0-9_]+$/;
const H2_RE = /^##\s+(.+?)\s*$/;
const H3_RE =
  /^###\s+(Fact|Question|Objective|Authorization):\s+(.+?)\s+\{#([^}]*)\}\s*$/;
const METADATA_RE = /^-\s+\*\*([^*]+):\*\*(?:\s(.*))?$/;

export function emptyStoryCatalog(sourceFile: string): ASTStoryCatalog {
  return {
    facts: [],
    questions: [],
    objectives: [],
    authorizations: [],
    sourceFile,
    line: 1,
  };
}

export function parseStoryCatalog(
  source: string,
  sourceFile: string,
): StoryCatalogParseResult {
  const lines = source.split(/\r?\n/);
  const errors: CompileError[] = [];
  const catalog = emptyStoryCatalog(sourceFile);
  const seenSections = new Set<Section>();
  let currentSection: Section | null = null;
  let currentItem: Item | null = null;
  let sawH1 = false;
  let firstContentSeen = false;

  const report = (line: number, code: string, message: string) => {
    errors.push({ code, message, sourceFile, line });
  };

  const finalizeItem = () => {
    if (!currentItem) return;
    const item = currentItem;
    currentItem = null;

    const requiredFields = FIELDS_BY_KIND[item.kind];
    for (const field of requiredFields) {
      if (!item.fields.has(field)) {
        item.invalid = true;
        report(
          item.line,
          "storyCatalogMissingField",
          `${item.kind} ${item.id} requires ${field}.`,
        );
      }
    }

    if (item.invalid) return;

    const summary = item.fields.get("Summary")?.value;
    if (!summary) return;

    switch (item.kind) {
      case "Fact": {
        const details = item.fields.get("Details")?.value;
        const category = item.fields.get("Category")?.value;
        if (!details || !category) return;
        catalog.facts.push({
          id: item.id,
          label: item.label,
          summary,
          details,
          category,
          sourceFile,
          line: item.line,
        });
        return;
      }
      case "Question": {
        const resolvedBy = item.fields.get("Resolved By");
        if (!resolvedBy) return;
        const resolvedByFactIds = parseResolvedBy(
          resolvedBy.value,
          sourceFile,
          resolvedBy.line,
          report,
        );
        if (!resolvedByFactIds) return;
        catalog.questions.push({
          id: item.id,
          label: item.label,
          summary,
          resolvedByFactIds,
          sourceFile,
          line: item.line,
        });
        return;
      }
      case "Objective": {
        const kindField = item.fields.get("Kind");
        const sortOrderField = item.fields.get("Sort Order");
        if (!kindField || !sortOrderField) return;
        if (kindField.value !== "primary" && kindField.value !== "secondary") {
          report(
            kindField.line,
            "storyCatalogMalformed",
            `Objective ${item.id} Kind must be primary or secondary.`,
          );
          return;
        }
        if (!/^-?\d+$/.test(sortOrderField.value)) {
          report(
            sortOrderField.line,
            "storyCatalogMalformed",
            `Objective ${item.id} Sort Order must be a base-10 integer.`,
          );
          return;
        }
        const sortOrder = Number(sortOrderField.value);
        if (!Number.isFinite(sortOrder)) {
          report(
            sortOrderField.line,
            "storyCatalogMalformed",
            `Objective ${item.id} Sort Order must be finite.`,
          );
          return;
        }
        catalog.objectives.push({
          id: item.id,
          label: item.label,
          summary,
          kind: kindField.value,
          sortOrder,
          sourceFile,
          line: item.line,
        });
        return;
      }
      case "Authorization": {
        const grantingAuthority = item.fields.get("Granting Authority")?.value;
        if (!grantingAuthority) return;
        catalog.authorizations.push({
          id: item.id,
          label: item.label,
          summary,
          grantingAuthority,
          sourceFile,
          line: item.line,
        });
      }
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    const text = (lines[index] ?? "").trim();
    if (text === "") continue;

    if (!firstContentSeen) {
      firstContentSeen = true;
      if (text !== "# Story Catalog") {
        report(
          line,
          "storyCatalogMalformed",
          'Story catalog must start with exactly "# Story Catalog".',
        );
      } else {
        sawH1 = true;
      }
      continue;
    }

    if (text.startsWith("# ")) {
      finalizeItem();
      report(
        line,
        "storyCatalogMalformed",
        'Story catalog must contain exactly one "# Story Catalog" heading.',
      );
      continue;
    }

    const h2 = H2_RE.exec(text);
    if (h2) {
      finalizeItem();
      const sectionName = h2[1] ?? "";
      if (!isSection(sectionName)) {
        report(
          line,
          "storyCatalogUnknownSection",
          `Unknown story catalog section: ${sectionName}.`,
        );
        currentSection = null;
        continue;
      }
      if (seenSections.has(sectionName)) {
        report(
          line,
          "storyCatalogDuplicateSection",
          `Story catalog section ${sectionName} appears more than once.`,
        );
        currentSection = sectionName;
        continue;
      }
      const sectionIndex = SECTION_ORDER.indexOf(sectionName);
      const lastSectionIndex = Math.max(
        -1,
        ...[...seenSections].map((section) => SECTION_ORDER.indexOf(section)),
      );
      if (sectionIndex < lastSectionIndex) {
        report(
          line,
          "storyCatalogSectionOutOfOrder",
          `Story catalog section ${sectionName} is out of canonical order.`,
        );
      }
      seenSections.add(sectionName);
      currentSection = sectionName;
      continue;
    }

    if (text.startsWith("##") && !text.startsWith("###")) {
      finalizeItem();
      report(
        line,
        "storyCatalogMalformed",
        `Malformed story catalog heading: ${text}.`,
      );
      continue;
    }

    const h3 = H3_RE.exec(text);
    if (text.startsWith("###")) {
      finalizeItem();
      if (!currentSection) {
        report(
          line,
          "storyCatalogMalformed",
          "Story catalog definitions must follow a recognized H2 section.",
        );
        continue;
      }
      if (!h3) {
        report(
          line,
          "storyCatalogMalformed",
          `Malformed definition heading: ${text}.`,
        );
        continue;
      }
      const kind = h3[1] as ItemKind;
      const label = (h3[2] ?? "").trim();
      const id = h3[3] ?? "";
      if (kind !== ITEM_KIND_BY_SECTION[currentSection]) {
        report(
          line,
          "storyCatalogMalformed",
          `${kind} heading does not belong in ${currentSection}.`,
        );
        continue;
      }
      if (label === "") {
        report(
          line,
          "storyCatalogMalformed",
          "Story catalog definition labels must not be blank.",
        );
        continue;
      }
      if (!ID_RE.test(id)) {
        report(
          line,
          "invalidGlobalDefinitionId",
          `Invalid global definition id: ${id}.`,
        );
      }
      currentItem = {
        kind,
        id,
        label,
        line,
        fields: new Map(),
        invalid: !ID_RE.test(id),
      };
      continue;
    }

    const metadata = METADATA_RE.exec(text);
    if (metadata) {
      if (!currentItem) {
        report(
          line,
          "storyCatalogMalformed",
          "Story catalog metadata must belong to a definition.",
        );
        continue;
      }
      const key = (metadata[1] ?? "").trim();
      const value = (metadata[2] ?? "").trim();
      if (!FIELDS_BY_KIND[currentItem.kind].includes(key)) {
        currentItem.invalid = true;
        report(
          line,
          "storyCatalogUnknownField",
          `${currentItem.kind} ${currentItem.id} does not allow ${key}.`,
        );
        continue;
      }
      if (currentItem.fields.has(key)) {
        currentItem.invalid = true;
        report(
          line,
          "storyCatalogDuplicateField",
          `${currentItem.kind} ${currentItem.id} repeats ${key}.`,
        );
        continue;
      }
      if (value === "") {
        currentItem.invalid = true;
        report(
          line,
          "storyCatalogMalformed",
          `${currentItem.kind} ${currentItem.id} ${key} must not be blank.`,
        );
        continue;
      }
      currentItem.fields.set(key, { value, line });
      continue;
    }

    report(
      line,
      "storyCatalogMalformed",
      `Unexpected story catalog content: ${text}.`,
    );
  }

  finalizeItem();
  if (!sawH1 && !errors.some((error) => error.line === 1)) {
    report(
      1,
      "storyCatalogMalformed",
      'Story catalog must start with exactly "# Story Catalog".',
    );
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: catalog };
}

function isSection(value: string): value is Section {
  return SECTION_ORDER.includes(value as Section);
}

function parseResolvedBy(
  value: string,
  sourceFile: string,
  line: number,
  report: (line: number, code: string, message: string) => void,
): Array<Located<{ id: string }>> | null {
  if (value === "[]") return [];
  if (!value.startsWith("[") || !value.endsWith("]")) {
    report(
      line,
      "storyCatalogMalformed",
      'Resolved By must be a bracketed list of "fact:<id>" references.',
    );
    return null;
  }

  const entries = value.slice(1, -1).split(",");
  const references: Array<Located<{ id: string }>> = [];
  let valid = true;
  for (const entry of entries) {
    const reference = entry.trim();
    const factMatch = /^fact:(.*)$/.exec(reference);
    if (!factMatch) {
      report(
        line,
        "storyCatalogMalformed",
        `Resolved By entry must be fact:<id>; got ${reference}.`,
      );
      valid = false;
      continue;
    }
    const id = factMatch[1] ?? "";
    if (!ID_RE.test(id)) {
      report(
        line,
        "invalidGlobalDefinitionId",
        `Invalid global definition id: ${id}.`,
      );
      valid = false;
      continue;
    }
    references.push({ id, sourceFile, line });
  }
  return valid ? references : null;
}
