import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// These tests treat the changed `.claude/skills/*/SKILL.md` files and
// `CLAUDE.md` as authored contract data: they check frontmatter shape,
// verify the documentation no longer makes claims this PR retired (Analysis
// scenes being threshold-board-only), and cross-check every fixture path and
// compiler error code the docs cite against the real repo/compiler source so
// the docs cannot silently drift from what the compiler actually implements.

const SKILLS_ROOT = ".claude/skills";

const CHANGED_SKILLS = [
  "subagent-driven-story-writing",
  "writing-analysis-scene",
  "writing-chapter-manifest",
  "writing-interrogation-scene",
  "writing-investigation-scene",
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function skillPath(skill: string): string {
  return `${SKILLS_ROOT}/${skill}/SKILL.md`;
}

// Prose in these markdown files hard-wraps at different columns per file, so
// phrase checks that span a line break normalize whitespace first rather than
// hard-coding one file's exact wrap point.
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new Error("expected a --- delimited frontmatter block");
  }
  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s?(.*)$/);
    if (kv) {
      currentKey = kv[1]!;
      fields[currentKey] = kv[2]!;
    } else if (currentKey) {
      fields[currentKey] += `\n${line}`;
    }
  }
  return fields;
}

// Concatenated compiler source used to confirm every analysis-related error
// code the skill docs cite is actually implemented.
function analysisCompilerSourceText(): string {
  return [
    "packages/scripts/compile-scenes/parser-analysis.ts",
    "packages/scripts/compile-scenes/validator-analysis.ts",
    "packages/scripts/compile-scenes/validator.ts",
  ]
    .map((path) => readRepoFile(path))
    .join("\n");
}

describe("changed SKILL.md frontmatter", () => {
  it.each(CHANGED_SKILLS)(
    "%s/SKILL.md declares a name matching its directory and a non-trivial description",
    (skill) => {
      const content = readRepoFile(skillPath(skill));
      const frontmatter = parseFrontmatter(content);

      expect(frontmatter.name).toBe(skill);
      expect(frontmatter.description).toBeTruthy();
      expect(frontmatter.description!.length).toBeGreaterThan(20);
    },
  );
});

describe("writing-analysis-scene/SKILL.md — Analysis board kind contract", () => {
  const content = readRepoFile(skillPath("writing-analysis-scene"));

  it("frontmatter description covers all three board kinds instead of threshold only", () => {
    const { description } = parseFrontmatter(content);
    expect(description).toContain(
      "Analysis boards (classify, order, or threshold)",
    );
  });

  it("states the Chapter 1 contract supports classify, order, and threshold kinds", () => {
    expect(content).toContain("**Chapter 1 contract:**");
    expect(content).toMatch(
      /three board kinds documented by\s+this skill: `classify`, `order`, and `threshold`/,
    );
  });

  it("no longer claims the runtime rejects classify/order boards as unsupported", () => {
    expect(content).not.toMatch(/runtime loader rejects/i);
    expect(content).not.toMatch(/not shippable/i);
    expect(content).not.toContain("**Runtime boundary:**");
    expect(content).not.toMatch(
      /parser-only from an authoring\/runtime perspective/i,
    );
  });

  it("documents a dedicated field section for every board kind", () => {
    expect(content).toContain("## Classify board fields");
    expect(content).toContain("## Order board fields");
    expect(content).toContain("## Threshold board fields");
  });

  it("documents Group as classify-only and Incorrect Selection as threshold-only in the skeleton", () => {
    expect(content).toMatch(
      /### Group: <label> \{#group_id\}\s*<!-- classify only -->/,
    );
    expect(content).toMatch(
      /### Incorrect Selection\s*<!-- threshold only, optional -->/,
    );
  });

  it("lists Kind as classify | order | threshold in the Board (H2) required fields", () => {
    expect(content).toContain("- **Kind:** classify | order | threshold");
    expect(content).toContain("`Kind: classify | order | threshold`");
  });

  it("documents classify group fields and warns against authoring acceptedGroupByCard", () => {
    expect(content).toContain("## Classify board fields");
    expect(content).toMatch(
      /`Accepted Cards: \[card_id, \.\.\.\]` names the displayed cards accepted by that/,
    );
    expect(content).toMatch(
      /`acceptedGroupByCard` is the\s*normalized compiler output, never a writer-authored field\./,
    );
  });

  it("documents the order board's Accepted Order and contiguous-prefix Fixed Anchors rule", () => {
    expect(content).toMatch(
      /`Accepted Order: \[card_id, \.\.\.\]` must contain every displayed card exactly/,
    );
    expect(content).toMatch(
      /occupy a contiguous prefix of positions `1\.\.N`/,
    );
    expect(content).toContain("analysisOrderAnchorNotPrefix");
  });

  it("scopes practice binding rules to be board-kind agnostic, with threshold-only mixing/neutrality constraints", () => {
    expect(content).toContain(
      "## Practice-card binding and threshold provenance",
    );
    expect(content).toContain(
      "Practice-card binding for every board kind:",
    );
    expect(content).toContain("Threshold-only practice constraints:");
  });

  it("adds an Orchestrator handoff section naming the Kind decision and request/authorization boundary", () => {
    expect(content).toContain("## Orchestrator handoff");
    expect(content).toContain(
      "the intended Kind (`classify`, `order`, or `threshold`) for every board",
    );
    expect(content).toMatch(/request-vs-authorization boundary/);
  });

  it("Self-check and Common Mistakes sections cover classify/order specific failure modes", () => {
    expect(content).toMatch(
      /classify: groups provide `Description` and `Accepted Cards`/,
    );
    expect(content).toMatch(
      /order: `Accepted Order` contains every displayed card exactly once/,
    );
    expect(content).toContain(
      "| Writing `acceptedGroupByCard` in a classify board |",
    );
    expect(content).toContain(
      "| Fixed anchors start after position 1 |",
    );
  });

  it.each([
    "packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md",
    "packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/",
    "docs/stories_plan/chapter_1/analysis_scene_p1_5.md",
  ])("cites fixture path %s which exists in the repo", (fixturePath) => {
    expect(content).toContain(fixturePath);
    expect(existsSync(resolve(process.cwd(), fixturePath))).toBe(true);
  });

  it("every analysis*/practiceCardSourceDuplicate error code cited resolves to real compiler source", () => {
    const codes = new Set(
      [...content.matchAll(/\b(?:analysis[A-Z]\w*|practiceCardSourceDuplicate)\b/g)].map(
        (m) => m[0],
      ),
    );

    expect(codes.size).toBeGreaterThan(5);

    const source = analysisCompilerSourceText();
    for (const code of codes) {
      expect(source).toContain(code);
    }
  });
});

describe("canonical three-board fixture matches writing-analysis-scene/SKILL.md's kind claims", () => {
  const fixture = readRepoFile(
    "packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md",
  );

  it("contains a classify board with Group blocks and Accepted Cards", () => {
    expect(fixture).toMatch(/-\s*\*\*Kind:\*\*\s*classify/);
    expect(fixture).toContain("### Group:");
    expect(fixture).toContain("Accepted Cards:");
  });

  it("contains an order board (local_event_sequence) with Accepted Order and a one-based Fixed Anchor", () => {
    expect(fixture).toContain("## Board: 本機事件順序 {#local_event_sequence}");
    expect(fixture).toMatch(/-\s*\*\*Kind:\*\*\s*order/);
    expect(fixture).toMatch(/Accepted Order:\*\*\s*\[event_1841, event_1842, event_1843, event_1844\]/);
    expect(fixture).toMatch(/Fixed Anchors:\*\*\s*\[event_1841@1\]/);
  });

  it("contains a threshold board", () => {
    expect(fixture).toMatch(/-\s*\*\*Kind:\*\*\s*threshold/);
  });
});

describe("analysis-order-anchor-not-prefix invalid fixture demonstrates the documented failure", () => {
  const fixture = readRepoFile(
    "packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/chapter_1/analysis_scene_8_5.md",
  );
  const expectedError = readRepoFile(
    "packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/expected-error.txt",
  );

  it("uses a single fixed anchor at a non-1 position, breaking the contiguous-prefix rule", () => {
    expect(fixture).toMatch(/Fixed Anchors:\*\*\s*\[event_1843@3\]/);
  });

  it("expects the exact analysisOrderAnchorNotPrefix error code documented in the skill", () => {
    expect(expectedError.trim()).toBe("analysisOrderAnchorNotPrefix");
  });
});

describe("subagent-driven-story-writing/SKILL.md delegates the Analysis board contract", () => {
  const content = readRepoFile(skillPath("subagent-driven-story-writing"));

  it("delegates board-contract ownership to writing-analysis-scene instead of restating it", () => {
    const normalized = normalizeWhitespace(content);
    expect(normalized).toContain(
      normalizeWhitespace(
        "**For analysis scenes: delegate the board contract to `writing-analysis-scene`.**",
      ),
    );
    expect(normalized).toContain(
      normalizeWhitespace(
        "the intended **Kind** (`classify`, `order`, or `threshold`) for every board",
      ),
    );
    expect(normalized).toContain(
      normalizeWhitespace(
        "The writer invokes `writing-analysis-scene` for all remaining kind-specific fields and validation rules.",
      ),
    );
  });

  it("no longer duplicates threshold-specific metadata field names in the orchestrator brief", () => {
    expect(content).not.toContain("Minimum Selected");
    expect(content).not.toContain("Required Proof Capabilities");
    expect(content).not.toContain("Allowed Procedural Statuses");
    expect(content).not.toContain("Require Source Group");
  });

  it("still lists writing-analysis-scene as a related skill", () => {
    expect(content).toMatch(/`writing-analysis-scene`;/);
  });
});

describe("writing-chapter-manifest/SKILL.md analysis_scene row reflects the delegated contract", () => {
  const content = readRepoFile(skillPath("writing-chapter-manifest"));

  it("describes analysis_scene_<K>.md as a compiler-validated Analysis scene owned by writing-analysis-scene", () => {
    expect(content).toContain(
      "| `analysis_scene_<K>.md` | Compiler-validated Analysis scene; board contract is owned by `writing-analysis-scene` |",
    );
  });

  it("no longer claims the runtime only exposes threshold boards for analysis scenes", () => {
    expect(content).not.toMatch(/threshold-board only/i);
    expect(content).not.toMatch(/threshold boards only/i);
  });
});

describe("writing-interrogation-scene/SKILL.md and writing-investigation-scene/SKILL.md — board-kind agnostic Analysis predicates", () => {
  const files = {
    "writing-interrogation-scene": readRepoFile(
      skillPath("writing-interrogation-scene"),
    ),
    "writing-investigation-scene": readRepoFile(
      skillPath("writing-investigation-scene"),
    ),
  };

  it.each(Object.entries(files))(
    "%s/SKILL.md references any packaged Analysis board supported by the current runtime contract",
    (_name, content) => {
      expect(normalizeWhitespace(content)).toContain(
        normalizeWhitespace(
          "Qualified Analysis predicates may reference any packaged Analysis board supported by the current `writing-analysis-scene`/runtime contract",
        ),
      );
    },
  );

  it.each(Object.entries(files))(
    "%s/SKILL.md no longer states the runtime rejects classify/order analysis boards",
    (_name, content) => {
      expect(content).not.toMatch(/rejects classify\/order boards/i);
      expect(content).not.toMatch(/does not expand the playable analysis surface/i);
      expect(content).not.toMatch(/only threshold analysis boards/i);
    },
  );

  it("writing-investigation-scene/SKILL.md drops the stale 'classify/order boards are not runtime-playable' clause", () => {
    expect(files["writing-investigation-scene"]).not.toMatch(
      /classify\/order boards are not runtime-playable/i,
    );
    expect(files["writing-investigation-scene"]).toContain(
      "Do not use unresolved or placeholder analysis ids.",
    );
  });

  it("writing-interrogation-scene/SKILL.md keeps the fully-qualified analysis predicate examples", () => {
    expect(files["writing-interrogation-scene"]).toContain(
      "analysis_scene:<chapter_id>@<scene_id> completed",
    );
    expect(files["writing-interrogation-scene"]).toContain(
      "analysis_board:<chapter_id>@<scene_id>@<board_id> completed",
    );
  });
});

describe("CLAUDE.md — analysis_scene_<K>.md description matches the delegated board-kind contract", () => {
  const content = readRepoFile("CLAUDE.md");

  it("describes analysis_scene_<K>.md as Analysis workbench scenes owned by writing-analysis-scene", () => {
    expect(normalizeWhitespace(content)).toContain(
      normalizeWhitespace(
        "`analysis_scene_<K>.md` - compiler-validated Analysis workbench scenes. Authored via `writing-analysis-scene`, which owns the supported board kinds and kind-specific authoring contract.",
      ),
    );
  });

  it("no longer claims the analysis runtime/frontend contract currently exposes threshold boards only", () => {
    expect(content).not.toMatch(/threshold boards only/i);
    expect(content).not.toMatch(/Author threshold-board content via/i);
  });

  it("still lists writing-analysis-scene among the authored playable content skills", () => {
    expect(content).toContain("`writing-analysis-scene`");
  });
});

describe("regression: no changed doc reintroduces the retired threshold-only Analysis runtime claim", () => {
  const changedFiles: Record<string, string> = {
    "CLAUDE.md": readRepoFile("CLAUDE.md"),
    ...Object.fromEntries(
      CHANGED_SKILLS.map((skill) => [skill, readRepoFile(skillPath(skill))]),
    ),
  };

  const retiredPhrases = [
    /rejects classify\/order boards/i,
    /only threshold analysis boards/i,
    /threshold-board only/i,
    /threshold boards only/i,
    /runtime loader rejects those kinds as unsupported/i,
    /does not expand the playable analysis surface/i,
  ];

  it.each(Object.entries(changedFiles))(
    "%s contains none of the retired threshold-only claims",
    (_name, content) => {
      for (const phrase of retiredPhrases) {
        expect(content).not.toMatch(phrase);
      }
    },
  );
});