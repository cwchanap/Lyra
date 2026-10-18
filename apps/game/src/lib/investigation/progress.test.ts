import { describe, expect, it } from "vitest";
import type { SublocationView } from "../state/types";
import {
  remainingTargetCount,
  remainingTargetsBySublocation,
} from "./progress";

function sublocation(
  id: string,
  hotspots: Array<[string, boolean]>,
  topics: Array<[string, boolean]>,
): SublocationView {
  return {
    id,
    label: id,
    sceneTag: id,
    hotspots: hotspots.map(([hotspotId, inspected]) => ({
      id: hotspotId,
      label: hotspotId,
      description: hotspotId,
      inspected,
      layout: null,
    })),
    characters: [
      {
        id: `${id}-witness`,
        name: "Witness",
        role: "Witness",
        bio: "Witness",
        layout: null,
        topics: topics.map(([topicId, discussed]) => ({
          id: topicId,
          label: topicId,
          discussed,
        })),
      },
    ],
  };
}

describe("investigation progress", () => {
  it("counts uninspected hotspots and undiscussed topics", () => {
    expect(
      remainingTargetCount(
        sublocation(
          "room",
          [
            ["desk", true],
            ["drawer", false],
          ],
          [
            ["alibi", false],
            ["motive", true],
          ],
        ),
      ),
    ).toBe(2);
  });

  it("maps each location to its remaining targets", () => {
    expect(
      remainingTargetsBySublocation([
        sublocation("room", [["desk", true]], [["alibi", true]]),
        sublocation("yard", [["gate", false]], []),
      ]),
    ).toEqual({ room: 0, yard: 1 });
  });
});
