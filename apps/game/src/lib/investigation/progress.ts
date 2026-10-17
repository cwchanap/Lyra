import type { CharacterView, SublocationView } from "../state/types";

/** Topics this character still has to be asked about. */
export function undiscussedTopicCount(character: CharacterView): number {
  return character.topics.filter((topic) => !topic.discussed).length;
}

/**
 * Hotspots and topics still open in one location. The view already carries
 * only unlocked targets, so this is the location's share of the auto
 * outro's remaining work.
 */
export function remainingTargetCount(sublocation: SublocationView): number {
  return (
    sublocation.hotspots.filter((hotspot) => !hotspot.inspected).length +
    sublocation.characters.reduce(
      (sum, character) => sum + undiscussedTopicCount(character),
      0,
    )
  );
}

export function remainingTargetsBySublocation(
  sublocations: SublocationView[],
): Record<string, number> {
  return Object.fromEntries(
    sublocations.map((sublocation) => [
      sublocation.id,
      remainingTargetCount(sublocation),
    ]),
  );
}
