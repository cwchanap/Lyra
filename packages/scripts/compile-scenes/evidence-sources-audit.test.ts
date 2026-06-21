import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditEvidenceSources,
  auditGateShouldFail,
  findUntaggedHotspots,
  printReport,
  suggestEvidenceSource,
  type EvidenceSourceAuditItem,
  type EvidenceSourceAuditResult,
} from "./evidence-sources-audit";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("suggestEvidenceSource", () => {
  it("suggests visible for monitor and playback source wording", () => {
    expect(
      suggestEvidenceSource({
        label: "閉店監視器回放",
        description: "收銀台旁的小螢幕還能調出閉店前的畫面。",
      }),
    ).toBe("visible");
    expect(
      suggestEvidenceSource({
        label: "back room monitor",
        description: "A dim screen is still powered on.",
      }),
    ).toBe("visible");
    expect(
      suggestEvidenceSource({
        label: "Playback panel",
        description: "Counter playback source.",
      }),
    ).toBe("visible");
  });

  it("suggests hidden for system-only wording and visible when a local carrier is present", () => {
    expect(
      suggestEvidenceSource({
        label: "三宅打卡紀錄",
        description: "系統查詢留下的資料。",
      }),
    ).toBe("hidden");
    expect(
      suggestEvidenceSource({
        label: "System query",
        description: "Record lookup from the staff system.",
      }),
    ).toBe("hidden");
    expect(
      suggestEvidenceSource({
        label: "KAGAMI 摘要副本",
        description: "列印文件放在桌面。",
      }),
    ).toBe("visible");
    expect(
      suggestEvidenceSource({
        label: "承包商回函資料包",
        description: "窗口推來的回函資料包。",
      }),
    ).toBe("visible");
  });

  it("suggests visible for physical object wording and needs review for ambiguous wording", () => {
    expect(
      suggestEvidenceSource({
        label: "雨傘盒",
        description: "玄關的傘架旁有一個盒子。",
      }),
    ).toBe("visible");
    expect(
      suggestEvidenceSource({
        label: "Printed document",
        description: "Physical document on the desk.",
      }),
    ).toBe("visible");
    expect(
      suggestEvidenceSource({
        label: "吧台角落",
        description: "暗處有一點不自然。",
      }),
    ).toBe("needs-review");
  });

  it("suggests implied for spatial replay carriers", () => {
    expect(
      suggestEvidenceSource({
        label: "三宅23:06站位",
        description: "站在該點重建後場視線 replay。",
      }),
    ).toBe("implied");
    expect(
      suggestEvidenceSource({
        label: "店長23:20動線",
        description: "重走巡查 route replay。",
      }),
    ).toBe("implied");
    expect(
      suggestEvidenceSource({
        label: "standing point",
        description: "Sightline replay from the storage-room floor.",
      }),
    ).toBe("implied");
  });

  it("locks classifier precedence so a branch reorder is caught (regression guard)", () => {
    // Visible carrier words win over record/system words: 螢幕 + 文件 should
    // remain visible because the player has a concrete local click target.
    expect(
      suggestEvidenceSource({
        label: "螢幕上的文件",
        description: "Monitor screen showing a document.",
      }),
    ).toBe("visible");

    // RECORD with a visible carrier token → visible. This is the "打卡表"
    // case: 打卡 ∈ RECORD, 表 ∈ VISIBLE_CARRIER.
    expect(
      suggestEvidenceSource({
        label: "打卡表",
        description: "張貼在牆上的打卡表。",
      }),
    ).toBe("visible");

    // Visible carrier tokens also win when record/system wording is present.
    expect(
      suggestEvidenceSource({
        label: "系統雨傘",
        description: "Record of umbrellas in the system.",
      }),
    ).toBe("visible");

    // 白板 is a visible carrier and is NOT in RECORD_WORDS, so 白板 alone
    // classifies as visible.
    expect(
      suggestEvidenceSource({
        label: "會議白板",
        description: "白板上還留著字。",
      }),
    ).toBe("visible");

    // Pure RECORD wording with no visible carrier token → hidden.
    expect(
      suggestEvidenceSource({
        label: "打卡紀錄",
        description: "系統查詢的資料。",
      }),
    ).toBe("hidden");
  });

  it("uses word boundaries for English carrier words so substrings do not over-match", () => {
    // "pos" must not match "position": a description that only mentions a
    // position (no visible carrier, record, or spatial-replay token) should
    // stay needs-review rather than be suggested visible.
    expect(
      suggestEvidenceSource({
        label: "Late-night position",
        description: "A vague position on the clock face.",
      }),
    ).toBe("needs-review");

    // "monitor" must not match "monitoring": "monitoring system" is a system
    // record (hidden), not a visible monitor.
    expect(
      suggestEvidenceSource({
        label: "Monitoring system",
        description: "The staff monitoring system logs entries.",
      }),
    ).toBe("hidden");
  });

  it("keeps precedence stable on mixed CJK+ASCII input (regression guard)", () => {
    // Bilingual descriptions are common in this corpus. The classifier
    // lowercases the whole concatenated text before matching, so a CJK
    // visible-carrier token and an ASCII record token in the same string must
    // still resolve by the documented branch order
    // (spatial > visible > record > needs-review).

    // Visible carrier (CJK 螢幕) wins over a record word (ASCII "record").
    expect(
      suggestEvidenceSource({
        label: "螢幕 record",
        description: "Monitor screen showing a record.",
      }),
    ).toBe("visible");

    // Spatial replay (ASCII "route replay") wins over a visible carrier
    // (CJK 回放), even when both appear.
    expect(
      suggestEvidenceSource({
        label: "route replay 回放",
        description: "重建巡查動線。",
      }),
    ).toBe("implied");

    // ASCII-only record wording with a CJK record token → hidden.
    expect(
      suggestEvidenceSource({
        label: "打卡 system record",
        description: "系統留下的資料。",
      }),
    ).toBe("hidden");

    // The ASCII token "pos" is a complete word even when glued to CJK
    // characters (\b sits on the CJK/ASCII boundary), so it still classifies
    // visible — guards against a regression that only matched purely-ASCII
    // surrounding text.
    expect(
      suggestEvidenceSource({
        label: "吧台角落pos",
        description: "暗處有一點不自然。",
      }),
    ).toBe("visible");
  });
});

describe("auditEvidenceSources", () => {
  it("reports evidence-revealing hotspots from chapter manifests with current metadata and suggestions", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "lyra-evidence-audit-"));
    tempRoots.push(sourceRoot);
    const chapterRoot = join(sourceRoot, "chapter_7");
    mkdirSync(chapterRoot, { recursive: true });
    writeFileSync(
      join(chapterRoot, "chapter.md"),
      `
# Chapter 7: fixture

**Summary:** fixture chapter.

## Scenes
1. investigation_scene_1.md
2. scene_2.md
`.trim(),
    );
    writeFileSync(
      join(chapterRoot, "investigation_scene_1.md"),
      `
# Scene 1: audit fixture

## Intro

**相馬律**：確認現場。

## Sub-location: front_room {#front_room}
- **Status:** unlocked
- **Background Prompt:** Rainy Tokyo cafe front room at night.

[場景：雨夜的咖啡館前廳。]

### Hotspot: 閉店監視器回放 {#cctv_playback}
- **Description:** 收銀台旁的小螢幕還能調出閉店前的監視器畫面。
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** implied
- **Scene Source Prompt:** Small security monitor beside the register.

**相馬律**：影像還在。

### Hotspot: 三宅打卡紀錄 {#timecard}
- **Description:** 從系統查詢到三宅的打卡紀錄。
- **Reveals:** [evidence:timecard_record]

**相馬律**：紀錄對不上。

### Hotspot: 普通杯子 {#cup}
- **Description:** 普通的杯子。

**相馬律**：只是杯子。

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** 閉店監視器截圖
- **Description:** 截圖。
- **Details:** 截圖顯示有人經過。
- **Image Prompt:** Square CCTV screenshot evidence icon.

#### On Collect

**相馬律**：取得截圖。

### evidence:timecard_record {#timecard_record}
- **Name:** 三宅打卡紀錄
- **Description:** 打卡紀錄。
- **Details:** 紀錄顯示時間不一致。
- **Image Prompt:** Square timecard record evidence icon.

#### On Collect

**相馬律**：取得紀錄。

## Statement Manifest

## Outro

**相馬律**：先整理證據。
`.trim(),
    );

    const { items, problems } = auditEvidenceSources([
      join(sourceRoot, "missing_root"),
      sourceRoot,
    ]);

    expect(problems).toEqual([]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sceneFile: "chapter_7/investigation_scene_1.md",
      sublocationId: "front_room",
      hotspotId: "cctv_playback",
      hotspotLabel: "閉店監視器回放",
      hotspotDescription: "收銀台旁的小螢幕還能調出閉店前的監視器畫面。",
      currentSource: "implied",
      sceneSourcePrompt: "Small security monitor beside the register.",
      backgroundPrompt: "Rainy Tokyo cafe front room at night.",
      suggestedSource: "visible",
      evidence: [
        {
          id: "cctv_screenshot",
          name: "閉店監視器截圖",
          imagePrompt: "Square CCTV screenshot evidence icon.",
        },
      ],
    });
    expect(items[1]).toMatchObject({
      hotspotId: "timecard",
      currentSource: null,
      sceneSourcePrompt: null,
      suggestedSource: "hidden",
      evidence: [
        {
          id: "timecard_record",
          name: "三宅打卡紀錄",
          imagePrompt: "Square timecard record evidence icon.",
        },
      ],
    });
  });

  it("skips a malformed chapter and continues auditing valid chapters", () => {
    // Regression guard: the audit must not abort on a single parse error.
    // A chapter with a malformed manifest is surfaced as a structured
    // problem (and on stderr) and skipped; sibling valid chapters are still
    // reported.
    const sourceRoot = mkdtempSync(join(tmpdir(), "lyra-evidence-audit-"));
    tempRoots.push(sourceRoot);

    // Malformed chapter: missing the required "# Chapter <N>: <title>" H1.
    const brokenRoot = join(sourceRoot, "chapter_1");
    mkdirSync(brokenRoot, { recursive: true });
    writeFileSync(
      join(brokenRoot, "chapter.md"),
      ["**Summary:** broken.", "## Scenes", "1. investigation_scene_1.md"].join(
        "\n",
      ),
    );

    // Valid chapter alongside it.
    const validRoot = join(sourceRoot, "chapter_2");
    mkdirSync(validRoot, { recursive: true });
    writeFileSync(
      join(validRoot, "chapter.md"),
      `
# Chapter 2: fixture

**Summary:** fixture chapter.

## Scenes
1. investigation_scene_1.md
`.trim(),
    );
    writeFileSync(
      join(validRoot, "investigation_scene_1.md"),
      `
# Scene 1: skip fixture

## Intro

**相馬律**：確認現場。

## Sub-location: front_room {#front_room}
- **Status:** unlocked
- **Background Prompt:** Rainy Tokyo cafe front room at night.

[場景：雨夜的咖啡館前廳。]

### Hotspot: 閉店監視器回放 {#cctv_playback}
- **Description:** 收銀台旁的小螢幕還能調出閉店前的監視器畫面。
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** implied

**相馬律**：影像還在。

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** 閉店監視器截圖
- **Description:** 截圖。
- **Details:** 截圖顯示有人經過。
- **Image Prompt:** Square CCTV screenshot evidence icon.

#### On Collect

**相馬律**：取得截圖。

## Statement Manifest

## Outro

**相馬律**：先整理證據。
`.trim(),
    );

    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { items, problems } = auditEvidenceSources([sourceRoot]);
    errorLog.mockRestore();

    // The valid chapter's hotspot is reported despite the sibling parse error.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sceneFile: "chapter_2/investigation_scene_1.md",
      hotspotId: "cctv_playback",
    });
    // The malformed chapter is surfaced as a structured problem, not swallowed.
    expect(problems).toContainEqual({
      sceneFile: "chapter_1/chapter.md",
      kind: "chapterParseError",
      message: expect.any(String),
    });
  });

  it("skips a missing chapter.md and a missing scene file without aborting", () => {
    // Regression guard: readFileSync must not throw and terminate the audit
    // when chapter.md is absent or when a manifest references a scene file
    // that does not exist on disk. Both must be surfaced on stderr and the
    // audit must continue reporting valid chapters.
    const sourceRoot = mkdtempSync(join(tmpdir(), "lyra-evidence-audit-"));
    tempRoots.push(sourceRoot);

    // Chapter A: directory exists but chapter.md is missing entirely.
    const noManifestRoot = join(sourceRoot, "chapter_1");
    mkdirSync(noManifestRoot, { recursive: true });

    // Chapter B: valid manifest, but it lists a scene file that does not exist
    // alongside a second valid scene that should still be reported.
    const partialRoot = join(sourceRoot, "chapter_2");
    mkdirSync(partialRoot, { recursive: true });
    writeFileSync(
      join(partialRoot, "chapter.md"),
      `
# Chapter 2: fixture

**Summary:** fixture chapter.

## Scenes
1. investigation_scene_missing.md
2. investigation_scene_1.md
`.trim(),
    );
    writeFileSync(
      join(partialRoot, "investigation_scene_1.md"),
      `
# Scene 1: io fixture

## Intro

**相馬律**：確認現場。

## Sub-location: front_room {#front_room}
- **Status:** unlocked
- **Background Prompt:** Rainy Tokyo cafe front room at night.

[場景：雨夜的咖啡館前廳。]

### Hotspot: 閉店監視器回放 {#cctv_playback}
- **Description:** 收銀台旁的小螢幕還能調出閉店前的監視器畫面。
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** implied

**相馬律**：影像還在。

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** 閉店監視器截圖
- **Description:** 截圖。
- **Details:** 截圖顯示有人經過。
- **Image Prompt:** Square CCTV screenshot evidence icon.

#### On Collect

**相馬律**：取得截圖。

## Statement Manifest

## Outro

**相馬律**：先整理證據。
`.trim(),
    );

    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { items, problems } = auditEvidenceSources([sourceRoot]);
    errorLog.mockRestore();

    // The valid scene from chapter_2 is still reported despite the sibling
    // missing manifest and missing scene file.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sceneFile: "chapter_2/investigation_scene_1.md",
      hotspotId: "cctv_playback",
    });
    // Missing chapter.md and missing scene file are both surfaced as
    // structured problems with distinct kinds.
    expect(problems).toContainEqual({
      sceneFile: "chapter_1/chapter.md",
      kind: "chapterReadError",
      message: expect.any(String),
    });
    expect(problems).toContainEqual({
      sceneFile: "chapter_2/investigation_scene_missing.md",
      kind: "sceneReadError",
      message: expect.any(String),
    });
  });

  it("surfaces a malformed Evidence Source value as a structured scene problem", () => {
    // The audit's purpose is to flag migration work, including bad metadata.
    // A hotspot with an invalid `Evidence Source: garbage` produces a parser
    // error (hotspotEvidenceSourceInvalid); the audit must surface it as a
    // structured problem rather than silently skipping the scene.
    const sourceRoot = mkdtempSync(join(tmpdir(), "lyra-evidence-audit-"));
    tempRoots.push(sourceRoot);

    const chapterRoot = join(sourceRoot, "chapter_1");
    mkdirSync(chapterRoot, { recursive: true });
    writeFileSync(
      join(chapterRoot, "chapter.md"),
      `
# Chapter 1: fixture

**Summary:** fixture chapter.

## Scenes
1. investigation_scene_1.md
`.trim(),
    );
    writeFileSync(
      join(chapterRoot, "investigation_scene_1.md"),
      `
# Scene 1: malformed source fixture

## Intro

**相馬律**：確認現場。

## Sub-location: front_room {#front_room}
- **Status:** unlocked
- **Background Prompt:** Rainy Tokyo cafe front room at night.

[場景：雨夜的咖啡館前廳。]

### Hotspot: 閉店監視器回放 {#cctv_playback}
- **Description:** 收銀台旁的小螢幕還能調出閉店前的監視器畫面。
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** bogus-source

**相馬律**：影像還在。

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** 閉店監視器截圖
- **Description:** 截圖。
- **Details:** 截圖顯示有人經過。
- **Image Prompt:** Square CCTV screenshot evidence icon.

#### On Collect

**相馬律**：取得截圖。

## Statement Manifest

## Outro

**相馬律**：先整理證據。
`.trim(),
    );

    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { items, problems } = auditEvidenceSources([sourceRoot]);
    errorLog.mockRestore();

    // The malformed scene contributed no hotspot items...
    expect(items).toHaveLength(0);
    // ...but its parse error is surfaced as a structured scene problem.
    expect(problems).toContainEqual({
      sceneFile: "chapter_1/investigation_scene_1.md",
      kind: "sceneParseError",
      message: expect.stringContaining("bogus-source"),
    });
  });
});

describe("printReport", () => {
  it("prints hotspot descriptions, evidence image prompts, and a problems section", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Problems section is routed to stderr so it is not buried when stdout is
    // captured; the hotspot report stays on stdout.
    const errLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let stdout: string;
    let stderr: string;

    try {
      printReport({
        items: [
          {
            sceneFile: "chapter_1/investigation_scene_1.md",
            sublocationId: "office",
            hotspotId: "summary",
            hotspotLabel: "KAGAMI summary",
            hotspotDescription: "Printed file on the desk.",
            currentSource: "visible",
            sceneSourcePrompt: null,
            backgroundPrompt: null,
            suggestedSource: "visible",
            evidence: [
              {
                id: "kagami_summary",
                name: "KAGAMI Summary",
                imagePrompt: "Square printed summary evidence icon.",
              },
              {
                id: "missing_prompt",
                name: "Missing Prompt",
                imagePrompt: null,
              },
            ],
          },
        ],
        problems: [
          {
            sceneFile: "chapter_2/investigation_scene_1.md",
            kind: "sceneParseError",
            message: `Hotspot "cctv" has invalid Evidence Source "bogus".`,
          },
        ],
      });
      stdout = log.mock.calls.map((call) => call.join(" ")).join("\n");
      stderr = errLog.mock.calls.map((call) => call.join(" ")).join("\n");
    } finally {
      log.mockRestore();
      errLog.mockRestore();
    }

    // Hotspot report on stdout.
    expect(stdout).toContain("description: Printed file on the desk.");
    expect(stdout).toContain(
      "imagePrompt: Square printed summary evidence icon.",
    );
    expect(stdout).toContain("imagePrompt: missing");
    // Problems section is on stderr with kind + scene + message.
    expect(stderr).toContain("Problems (1):");
    expect(stderr).toContain("[sceneParseError]");
    expect(stderr).toContain("chapter_2/investigation_scene_1.md");
    expect(stderr).toContain("bogus");
    // ...and NOT duplicated on stdout.
    expect(stdout).not.toContain("Problems (1):");
  });
});

// Minimal item factory for gate tests. Only the fields the gate reads
// (currentSource, sceneFile, sublocationId, hotspotId) need to be filled;
// the rest mirrors the type with placeholders.
function auditItem(
  overrides: Partial<EvidenceSourceAuditItem>,
): EvidenceSourceAuditItem {
  return {
    sceneFile: "chapter_1/investigation_scene_1.md",
    sublocationId: "front_room",
    hotspotId: "hotspot",
    hotspotLabel: "label",
    hotspotDescription: "description",
    currentSource: "visible",
    sceneSourcePrompt: null,
    backgroundPrompt: null,
    suggestedSource: "visible",
    evidence: [],
    ...overrides,
  };
}

function auditResult(
  overrides: Partial<EvidenceSourceAuditResult> = {},
): EvidenceSourceAuditResult {
  return { items: [], problems: [], ...overrides };
}

describe("findUntaggedHotspots", () => {
  it("returns only hotspots whose currentSource is null", () => {
    const result = auditResult({
      items: [
        auditItem({ hotspotId: "tagged_visible", currentSource: "visible" }),
        auditItem({ hotspotId: "untagged", currentSource: null }),
        auditItem({ hotspotId: "tagged_hidden", currentSource: "hidden" }),
        auditItem({ hotspotId: "also_untagged", currentSource: null }),
      ],
    });

    expect(findUntaggedHotspots(result).map((item) => item.hotspotId)).toEqual([
      "untagged",
      "also_untagged",
    ]);
  });

  it("ignores suggestedSource — advisory suggestions must not gate the build", () => {
    // A hotspot with no authored tag but a confident classifier suggestion
    // is still a build failure: the gate keys off currentSource, not
    // suggestedSource.
    const result = auditResult({
      items: [
        auditItem({
          hotspotId: "needs_tag",
          currentSource: null,
          suggestedSource: "visible",
        }),
      ],
    });

    expect(findUntaggedHotspots(result)).toHaveLength(1);
  });

  it("returns an empty array when every hotspot has a tag", () => {
    const result = auditResult({
      items: [
        auditItem({ currentSource: "visible" }),
        auditItem({ currentSource: "hidden" }),
        auditItem({ currentSource: "implied" }),
      ],
    });

    expect(findUntaggedHotspots(result)).toEqual([]);
  });

  it("returns an empty array when there are no items", () => {
    expect(findUntaggedHotspots(auditResult())).toEqual([]);
  });
});

describe("auditGateShouldFail", () => {
  it("passes a clean result with no problems and no untagged hotspots", () => {
    expect(
      auditGateShouldFail(
        auditResult({
          items: [auditItem({ currentSource: "visible" })],
        }),
      ),
    ).toBe(false);
  });

  it("fails when any hotspot is missing an Evidence Source tag", () => {
    expect(
      auditGateShouldFail(
        auditResult({
          items: [
            auditItem({ hotspotId: "ok", currentSource: "visible" }),
            auditItem({ hotspotId: "missing", currentSource: null }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("fails when problems is non-empty even if every hotspot is tagged", () => {
    // Mirrors validate-docs-scenes.ts: a non-empty problems list means the
    // audit could not fully process the corpus, so the build fails even
    // though the visible hotspots are all tagged.
    expect(
      auditGateShouldFail(
        auditResult({
          items: [auditItem({ currentSource: "visible" })],
          problems: [
            {
              sceneFile: "chapter_1/chapter.md",
              kind: "chapterParseError",
              message: "boom",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("fails when both problems and untagged hotspots are present", () => {
    expect(
      auditGateShouldFail(
        auditResult({
          items: [auditItem({ currentSource: null })],
          problems: [
            {
              sceneFile: "chapter_1/chapter.md",
              kind: "sceneReadError",
              message: "missing",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("passes an empty result (no items, no problems)", () => {
    expect(auditGateShouldFail(auditResult())).toBe(false);
  });
});
