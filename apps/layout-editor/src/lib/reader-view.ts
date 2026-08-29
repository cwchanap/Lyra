import type { ReaderGroup, ReaderItem, ReaderScene } from "./workbench-types";

export type ReaderFilter = {
  showCues: boolean;
  speaker: string | null;
  showBranches: boolean;
  search: string;
};

function normalizeSearch(search: string): string {
  return search.trim().toLocaleLowerCase();
}

function itemMatches(
  item: ReaderItem,
  filter: ReaderFilter,
  search: string,
): boolean {
  if (
    (item.kind === "sceneTag" || item.kind === "action") &&
    !filter.showCues
  ) {
    return false;
  }
  if (
    item.kind === "line" &&
    filter.speaker !== null &&
    item.speaker !== filter.speaker
  ) {
    return false;
  }
  if (search) {
    const textMatch = item.text.toLocaleLowerCase().includes(search);
    const speakerMatch =
      item.kind === "line" && item.speaker.toLocaleLowerCase().includes(search);
    if (!textMatch && !speakerMatch) return false;
  }
  return true;
}

function filterGroup(
  group: ReaderGroup,
  filter: ReaderFilter,
  search: string,
): ReaderGroup | null {
  if (!filter.showBranches && group.flow === "branch") return null;
  const items = group.items.filter((item) => itemMatches(item, filter, search));
  const children = group.children
    .map((child) => filterGroup(child, filter, search))
    .filter((child): child is ReaderGroup => child !== null);
  if (items.length === 0 && children.length === 0) return null;
  return { ...group, items, children };
}

/**
 * Filters a reader scene by the given criteria (cues, speaker, branches, search).
 */
export function filterReaderScene(
  scene: ReaderScene,
  filter: ReaderFilter,
): ReaderScene {
  const search = normalizeSearch(filter.search);
  return {
    ...scene,
    groups: scene.groups
      .map((group) => filterGroup(group, filter, search))
      .filter((group): group is ReaderGroup => group !== null),
  };
}
