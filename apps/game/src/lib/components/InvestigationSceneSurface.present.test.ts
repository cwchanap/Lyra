import { render, screen, waitFor, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeCoordinator } from "$lib/state/escape-coordinator";
import InvestigationSceneSurface from "./InvestigationSceneSurface.svelte";
import type {
  CharacterView,
  FeedbackLine,
  Inventory,
  SublocationView,
} from "../state/types";
import { neutralEvidenceRecordView } from "../state/test-fixtures";

const clerk = (layout: CharacterView["layout"]): CharacterView => ({
  id: "clerk",
  name: "店員",
  role: "店員",
  bio: "當晚值班。",
  acceptsPresent: true,
  layout,
  topics: [
    { id: "shift", label: "值班", discussed: false, requiresPresent: false },
    {
      id: "receipt_reaction",
      label: "那張收據",
      discussed: false,
      requiresPresent: true,
    },
  ],
});

function shop(character: CharacterView): SublocationView {
  return {
    id: "shop",
    label: "店內",
    sceneTag: "便利店",
    intentionalOverlaps: [],
    hotspots: [],
    characters: [character],
  };
}

const inventory: Inventory = {
  evidence: [
    neutralEvidenceRecordView({
      id: "receipt",
      name: "收據",
      description: "印著 REPRINT。",
      details: "",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "investigation_scene_1",
    }),
  ],
  statements: [],
};

function renderSurface(
  character: CharacterView,
  presentFeedback: { characterId: string; line: FeedbackLine } | null = null,
) {
  const onPresent = vi.fn();
  const onInterview = vi.fn();
  render(InvestigationSceneSurface, {
    sublocation: shop(character),
    onInspect: vi.fn(),
    onInterview,
    inventory,
    onPresent,
    presentFeedback,
  });
  return { onPresent, onInterview };
}

afterEach(() => {
  resetEscapeCoordinator();
});

describe("InvestigationSceneSurface 出示紀錄", () => {
  it("hides an undiscussed Present topic and offers 出示紀錄 instead", async () => {
    const user = userEvent.setup();
    renderSurface(clerk({ kind: "baked", x: 0.5, y: 0.2, w: 0.2, h: 0.6 }));

    await user.click(screen.getByRole("button", { name: /詢問：店員/ }));
    const topics = screen.getByRole("dialog", { name: "店員詢問項目" });

    expect(within(topics).getByRole("button", { name: /值班/ })).toBeVisible();
    expect(
      within(topics).queryByRole("button", { name: /那張收據/ }),
    ).not.toBeInTheDocument();
    expect(
      within(topics).getByRole("button", { name: /出示紀錄/ }),
    ).toBeVisible();
  });

  it("shows a held record to the character and closes the tray", async () => {
    const user = userEvent.setup();
    const { onPresent } = renderSurface(clerk(null));

    await user.click(screen.getByRole("button", { name: /出示紀錄/ }));
    const tray = screen.getByRole("dialog", { name: "出示紀錄" });
    expect(tray).toHaveTextContent("店員");
    await user.click(within(tray).getByRole("button", { name: /收據/ }));

    expect(onPresent).toHaveBeenCalledExactlyOnceWith(
      "clerk",
      "evidence",
      "receipt",
    );
    expect(
      screen.queryByRole("dialog", { name: "出示紀錄" }),
    ).not.toBeInTheDocument();
  });

  it("returns focus to 出示紀錄 when the tray closes", async () => {
    const user = userEvent.setup();
    renderSurface(clerk(null));

    const show = screen.getByRole("button", { name: /出示紀錄/ });
    await user.click(show);
    await user.click(screen.getByRole("button", { name: /收回/ }));

    expect(
      screen.queryByRole("dialog", { name: "出示紀錄" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(show).toHaveFocus());
  });

  it("lists a discussed Present topic for re-examination and shows the wrong-pick reply", () => {
    const character = clerk(null);
    character.topics[1]!.discussed = true;
    renderSurface(character, {
      characterId: "clerk",
      line: { speaker: "店員", text: "這跟我無關吧。" },
    });

    expect(screen.getByRole("button", { name: /那張收據/ })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("店員這跟我無關吧。");
  });
});
