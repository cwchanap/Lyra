import { describe, expect, it } from "vitest";
import type {
  ReaderFlow,
  ReaderGroup,
  ReaderItem,
  ReaderScene,
} from "./workbench-types";
import { filterReaderScene, type ReaderFilter } from "./reader-view";

const line = (speaker: string, text: string): ReaderItem => ({
  kind: "line",
  speaker,
  text,
});
const action = (text: string): ReaderItem => ({ kind: "action", text });
const sceneTag = (text: string): ReaderItem => ({ kind: "sceneTag", text });
const notice = (text: string): ReaderItem => ({
  kind: "notice",
  noticeKind: "reveal",
  text,
});

function group(
  id: string,
  items: ReaderItem[],
  children: ReaderGroup[] = [],
  flow: ReaderFlow = "main",
): ReaderGroup {
  return {
    id,
    kind: "topic",
    label: id,
    flow,
    sourceAnchor: `#${id}`,
    items,
    children,
  };
}

function fixtureScene(): ReaderScene {
  return {
    id: "scene_x",
    type: "interrogation",
    title: "Fixture Scene",
    sourcePath: "docs/stories_plan/chapter_1/scene_x.md",
    presentation: [],
    groups: [
      group("intro", [
        sceneTag("場景：偵訊室"),
        line("相馬律", "intro line"),
        action("slams the folder"),
      ]),
      group(
        "phase1",
        [notice("Reveals question: q2")],
        [
          group(
            "line:l1",
            [line("證人", "testimony content")],
            [group("press", [line("相馬律", "press line")], [], "branch")],
          ),
          group("wrong", [line("相馬律", "wrong line")], [], "branch"),
        ],
      ),
    ],
  };
}

const baseFilter: ReaderFilter = {
  showCues: true,
  speaker: null,
  showBranches: true,
  search: "",
};

function findGroup(scene: ReaderScene, id: string): ReaderGroup | undefined {
  const stack = [...scene.groups];
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (!candidate) break;
    if (candidate.id === id) return candidate;
    stack.push(...candidate.children);
  }
  return undefined;
}

describe("filterReaderScene", () => {
  it("hides cue items (sceneTag/action) without touching dialogue or notices", () => {
    const filtered = filterReaderScene(fixtureScene(), {
      ...baseFilter,
      showCues: false,
    });
    expect(findGroup(filtered, "intro")?.items).toEqual([
      line("相馬律", "intro line"),
    ]);
    expect(findGroup(filtered, "phase1")?.items).toEqual([
      notice("Reveals question: q2"),
    ]);
  });

  it("drops nonmatching speaker lines while retaining their ancestor groups", () => {
    const filtered = filterReaderScene(fixtureScene(), {
      ...baseFilter,
      speaker: "證人",
    });
    expect(findGroup(filtered, "intro")?.items).toEqual([
      sceneTag("場景：偵訊室"),
      action("slams the folder"),
    ]);
    const phase = findGroup(filtered, "phase1");
    expect(phase).toBeDefined();
    expect(findGroup(filtered, "line:l1")).toBeDefined();
    expect(findGroup(filtered, "press")).toBeUndefined();
    expect(findGroup(filtered, "wrong")).toBeUndefined();
  });

  it("drops branch-flow groups when showBranches is false", () => {
    const filtered = filterReaderScene(fixtureScene(), {
      ...baseFilter,
      showBranches: false,
    });
    expect(findGroup(filtered, "press")).toBeUndefined();
    expect(findGroup(filtered, "wrong")).toBeUndefined();
    expect(findGroup(filtered, "line:l1")).toBeDefined();
    expect(findGroup(filtered, "phase1")).toBeDefined();
  });

  it("matches search case-insensitively and retains ancestors of matching descendants", () => {
    const filtered = filterReaderScene(fixtureScene(), {
      ...baseFilter,
      search: "  TESTIMONY  ",
    });
    expect(findGroup(filtered, "intro")).toBeUndefined();
    const phase = findGroup(filtered, "phase1");
    expect(phase).toBeDefined();
    expect(phase?.items).toEqual([]);
    expect(findGroup(filtered, "line:l1")?.items).toEqual([
      line("證人", "testimony content"),
    ]);
  });

  it("omits empty groups and keeps the scene boundary envelope", () => {
    const scene = fixtureScene();
    scene.groups.push(group("empty", []));
    const filtered = filterReaderScene(scene, baseFilter);
    expect(findGroup(filtered, "empty")).toBeUndefined();

    const emptied = filterReaderScene(scene, {
      ...baseFilter,
      search: "no such text anywhere",
    });
    expect(emptied.groups).toEqual([]);
    expect(emptied.title).toBe("Fixture Scene");
    expect(emptied.sourcePath).toBe("docs/stories_plan/chapter_1/scene_x.md");
  });

  it("does not mutate the scene it filters", () => {
    const scene = fixtureScene();
    const snapshot = structuredClone(scene);
    filterReaderScene(scene, {
      showCues: false,
      speaker: "證人",
      showBranches: false,
      search: "testimony",
    });
    expect(scene).toEqual(snapshot);
  });
});
