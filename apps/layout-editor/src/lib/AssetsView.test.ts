// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import {
  expectedPath,
  publicPath,
  type AssetManifest,
  type AssetManifestEntry,
} from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AssetReport } from "@lyra/scripts/compile-scenes/orchestrator";
import type { CaseRecordProvenance } from "@lyra/scripts/compile-scenes/types";
import type {
  JSONInvestigationScene,
  JSONLinearScene,
  PortraitRef,
} from "@lyra/scripts/compile-scenes/types";
import AssetsView from "./AssetsView.svelte";
import type { WorkbenchAssetWorkspacePayload } from "./workbench-types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const clipboardWriteText = vi.fn();

// userEvent.setup() attaches its own jsdom clipboard stub over ours, so a
// test that asserts clipboard writes must re-stub AFTER its last setup call.
function stubClipboardWrite(): void {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWriteText },
    configurable: true,
  });
}

const CHARACTERS_YAML = `
characters:
  - id: hayasaka_akane
    displayNames:
      - 早坂茜
    portraitMode: portrait
    visualPrompt: attorney in dark suit
    expressions:
      standard:
        prompt: neutral
      concerned:
        prompt: worried
  - id: receptionist
    displayNames:
      - 受付
    portraitMode: none
    visualPrompt: hotel front desk
`;

const AUDIO_YAML = `
bgm:
  rain:
    prompt: soft tension
  step:
    prompt: bgm step
bgs:
  street_rain:
    prompt: rain
sfx:
  step:
    prompt: footstep
`;

function entryBase(input: {
  assetId: string;
  type: AssetManifestEntry["type"];
  entryPrompt: string;
}) {
  const promptParts = {
    globalStyle: "noir style",
    typePrompt: "",
    subjectPrompt: "",
    entryPrompt: input.entryPrompt,
  };
  return {
    assetId: input.assetId,
    expectedPath: expectedPath(input.assetId, input.type),
    publicPath: publicPath(input.assetId, input.type),
    promptParts,
    finalPrompt: Object.values(promptParts).filter(Boolean).join("\n\n"),
  };
}

const manifest: AssetManifest = {
  enabled: true,
  entries: [
    {
      ...entryBase({
        assetId: "portrait.hayasaka_akane.standard",
        type: "portrait",
        entryPrompt: "neutral",
      }),
      type: "portrait",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_cues",
        characterId: "hayasaka_akane",
        expression: "standard",
      },
    },
    {
      ...entryBase({
        assetId: "background.chapter_1.scene_cues.hall",
        type: "background",
        entryPrompt: "rainy hall",
      }),
      type: "background",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_cues",
        unitId: "hall",
      },
    },
    {
      ...entryBase({
        assetId: "background.chapter_1.investigation_delta.hall",
        type: "background",
        entryPrompt: "delta hall",
      }),
      type: "background",
      source: {
        chapterId: "chapter_1",
        sceneId: "investigation_delta",
        unitId: "hall",
      },
    },
    {
      ...entryBase({
        assetId: "audio.bgm.rain",
        type: "audio",
        entryPrompt: "soft tension",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_cues",
        channel: "bgm",
        id: "rain",
      },
    },
    {
      ...entryBase({
        assetId: "audio.bgm.step",
        type: "audio",
        entryPrompt: "bgm step",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_cues",
        channel: "bgm",
        id: "step",
      },
    },
    {
      ...entryBase({
        assetId: "audio.bgs.street_rain",
        type: "audio",
        entryPrompt: "rain ambience",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_cues",
        channel: "bgs",
        id: "street_rain",
      },
    },
    {
      ...entryBase({
        assetId: "audio.sfx.step",
        type: "audio",
        entryPrompt: "footstep",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_cues",
        channel: "sfx",
        id: "step",
      },
    },
    {
      ...entryBase({
        assetId: "standee.npc1.default",
        type: "standee",
        entryPrompt: "npc standee",
      }),
      type: "standee",
      source: {
        chapterId: "chapter_1",
        sceneId: "investigation_delta",
        characterId: "npc1",
      },
    },
    {
      ...entryBase({
        assetId: "evidence.receipt",
        type: "evidence",
        entryPrompt: "torn receipt",
      }),
      type: "evidence",
      source: {
        chapterId: "chapter_1",
        sceneId: "investigation_delta",
        evidenceId: "receipt",
      },
    },
  ],
};

const report: AssetReport = {
  enabled: true,
  requested: { background: 2, portrait: 1, standee: 1, evidence: 1, audio: 4 },
  warnings: [
    {
      code: "assetFileMissing",
      message:
        'Expected file for "audio.bgm.step" is missing from static/assets.',
      sourceFile: "resources/assets/report.json",
      line: 0,
    },
  ],
};

// ---- scene fixtures ---------------------------------------------------------

const AKANE_STANDARD: PortraitRef = {
  characterId: "hayasaka_akane",
  expression: "standard",
  assetId: "portrait.hayasaka_akane.standard",
};
const AKANE_CONCERNED: PortraitRef = {
  characterId: "hayasaka_akane",
  expression: "concerned",
  assetId: "portrait.hayasaka_akane.concerned",
};

const cueLinearScene: JSONLinearScene = {
  type: "linear",
  id: "scene_cues",
  title: "Cues",
  summary: "",
  queue: [
    {
      kind: "sceneTag",
      text: "場景：現場",
      assetCue: {
        backgroundAssetId: "background.chapter_1.scene_cues.hall",
        bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
        bgs: { channel: "bgs", assetId: null },
      },
    },
    { kind: "line", speaker: "S", text: "a", portrait: AKANE_STANDARD },
  ],
  assetRefs: [],
};

const unresolvedLinearScene: JSONLinearScene = {
  type: "linear",
  id: "scene_x",
  title: "Unresolved",
  summary: "",
  queue: [{ kind: "line", speaker: "S", text: "a", portrait: AKANE_CONCERNED }],
  assetRefs: [],
};

const provenance = {
  sourceKind: "physical",
  representationLayer: "raw",
  proceduralStatus: "unspecified",
  completeness: "complete",
  confidence: "unverified",
  sourceGroupId: null,
  sourceLabel: null,
  proofCapabilities: [],
  supersedesRecordId: null,
} satisfies CaseRecordProvenance;

const deltaInvestigationScene: JSONInvestigationScene = {
  type: "investigation",
  id: "investigation_delta",
  title: "Delta",
  summary: "",
  map: null,
  intro: [],
  assetRefs: [],
  sublocations: [
    {
      id: "hall",
      label: "Hall",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "場景：大廳",
      backgroundAssetId: "background.chapter_1.investigation_delta.hall",
      bgm: null,
      bgs: { channel: "bgs", assetId: null },
      transitionDialogue: [],
      hotspots: [],
      characters: [
        {
          id: "npc1",
          name: "N1",
          role: "R",
          bio: "",
          layout: {
            kind: "sprite",
            assetId: "standee.npc1.default",
            x: 0.1,
            y: 0.1,
            w: 0.2,
            h: 0.3,
            anchor: "bottomCenter",
          },
          topics: [],
        },
      ],
    },
  ],
  evidenceManifest: [
    {
      id: "receipt",
      name: "Receipt",
      description: "A torn receipt.",
      details: "",
      imageAssetId: "evidence.receipt",
      sourceSublocationId: "hall",
      provenance,
      onCollect: [],
      onReexamine: null,
    },
  ],
  statementManifest: [],
  outro: { unlock: "auto", dialogue: [] },
};

function payloadFixture(): WorkbenchAssetWorkspacePayload {
  return {
    manifest,
    report,
    configSources: {
      characters: {
        path: "static/assets/config/characters.yaml",
        content: CHARACTERS_YAML,
      },
      audio: {
        path: "static/assets/config/audio.yaml",
        content: AUDIO_YAML,
      },
    },
    scenes: [
      {
        chapterId: "chapter_1",
        sceneId: "scene_cues",
        sourcePath: "docs/stories_plan/chapter_1/scene_cues.md",
        scene: cueLinearScene,
      },
      {
        chapterId: "chapter_1",
        sceneId: "scene_x",
        sourcePath: "docs/stories_plan/chapter_1/scene_x.md",
        scene: unresolvedLinearScene,
      },
      {
        chapterId: "chapter_1",
        sceneId: "investigation_delta",
        sourcePath: "docs/stories_plan/chapter_1/investigation_delta.md",
        scene: deltaInvestigationScene,
      },
    ],
    // Presence-only, Rust `load_asset_workspace` shape (repo-relative
    // `static/assets/...` — publicPath-shaped entries masked F1):
    // portrait.standard and audio.bgm.step are missing from disk;
    // "unlisted.ogg" exists on disk but has no manifest row.
    existingAssetPaths: [
      expectedPath("background.chapter_1.scene_cues.hall", "background"),
      expectedPath(
        "background.chapter_1.investigation_delta.hall",
        "background",
      ),
      expectedPath("audio.bgm.rain", "audio"),
      expectedPath("audio.bgs.street_rain", "audio"),
      expectedPath("audio.sfx.step", "audio"),
      expectedPath("standee.npc1.default", "standee"),
      expectedPath("evidence.receipt", "evidence"),
      "static/assets/audio/bgm/unlisted.ogg",
    ],
  };
}

function renderAssets(
  overrides: {
    selectedChapterId?: string | null;
    selectedSceneId?: string | null;
    onSelectScene?: (chapterId: string, sceneId: string) => void;
  } = {},
) {
  return render(AssetsView, {
    selectedChapterId: "chapter_1",
    selectedSceneId: "scene_cues",
    onSelectScene: vi.fn(),
    ...overrides,
  });
}

async function openLibrary(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await screen.findByLabelText("Scene cue rows");
  await user.click(screen.getByRole("tab", { name: "Library" }));
  return screen.getByLabelText("Asset library");
}

/**
 * Payload variant whose investigation scene adds one sprite-layout character
 * referencing the existing portrait manifest entry, proving related sprite
 * usages join by parsed portrait identity without new diagnostics.
 */
function payloadWithPortraitSprite(): WorkbenchAssetWorkspacePayload {
  const base = payloadFixture();
  const scene = base.scenes[2]!.scene;
  if (scene.type !== "investigation") throw new Error("fixture drift");
  const withSprite: JSONInvestigationScene = {
    ...scene,
    sublocations: scene.sublocations.map((sub) => ({
      ...sub,
      characters: [
        ...sub.characters,
        {
          id: "npc2",
          name: "N2",
          role: "R",
          bio: "",
          layout: {
            kind: "sprite",
            assetId: "portrait.hayasaka_akane.standard",
            x: 0.1,
            y: 0.1,
            w: 0.2,
            h: 0.3,
            anchor: "bottomCenter",
          },
          topics: [],
        },
      ],
    })),
  };
  return {
    ...base,
    scenes: base.scenes.map((candidate, index) =>
      index === 2 && candidate.scene.type === "investigation"
        ? { ...candidate, scene: withSprite }
        : candidate,
    ),
  };
}

describe("AssetsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(
      async (command: string, _args?: InvokeArgs) => {
        if (command === "load_asset_workspace") return payloadFixture();
        throw new Error(`unexpected invoke: ${command}`);
      },
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
  });

  it("renders the loading state, then ordered cue rows for the selected scene", async () => {
    const { container } = renderAssets();

    expect(screen.getByText("Loading asset workspace…")).toBeInTheDocument();

    const cueList = await screen.findByLabelText("Scene cue rows");
    const assetOrder = [
      ...cueList.querySelectorAll<HTMLButtonElement>("button[data-asset-id]"),
    ].map((button) => button.dataset.assetId);
    expect(assetOrder).toEqual([
      "background.chapter_1.scene_cues.hall",
      "audio.bgm.rain",
      "portrait.hayasaka_akane.standard",
    ]);

    expect(within(cueList).getAllByText("main")).toHaveLength(2);
    expect(within(cueList).getByText("· item 0")).toBeInTheDocument();
    expect(within(cueList).getByText("· item 1")).toBeInTheDocument();
    expect(within(cueList).getByText("BGM Set")).toBeInTheDocument();
    expect(within(cueList).getByText("BGS Stop")).toBeInTheDocument();
    expect(within(cueList).getByText("Present")).toBeInTheDocument();
    expect(within(cueList).getByText("Missing")).toBeInTheDocument();
    expect(
      within(cueList).getByText("expression: standard"),
    ).toBeInTheDocument();

    const backgroundPreview = within(cueList).getByRole("img", {
      name: "background.chapter_1.scene_cues.hall",
    });
    expect(backgroundPreview).toHaveAttribute(
      "src",
      "/assets/backgrounds/chapter_1/scene_cues/hall.png",
    );

    expect(container.textContent).toContain(
      "docs/stories_plan/chapter_1/scene_cues.md",
    );
  });

  it("renders structural inherit/stop states, sprite, and evidence rows", async () => {
    renderAssets({ selectedSceneId: "investigation_delta" });

    const cueList = await screen.findByLabelText("Scene cue rows");
    const rows = [...cueList.querySelectorAll("[data-cue-row]")];
    expect(rows).toHaveLength(3);

    expect(rows[0]).toHaveTextContent("sublocation:hall");
    expect(
      within(rows[0] as HTMLElement).getByText("BGM Inherit"),
    ).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText("BGS Stop"),
    ).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByRole("img", {
        name: "background.chapter_1.investigation_delta.hall",
      }),
    ).toHaveAttribute(
      "src",
      "/assets/backgrounds/chapter_1/investigation_delta/hall.png",
    );

    expect(rows[1]).toHaveTextContent("character:npc1");
    expect(rows[1]).toHaveTextContent("standee.npc1.default");
    expect(rows[2]).toHaveTextContent("evidence:receipt");
    expect(rows[2]).toHaveTextContent("evidence.receipt");
  });

  it("keeps unresolved cue assets visible without a preview", async () => {
    renderAssets({ selectedSceneId: "scene_x" });

    const cueList = await screen.findByLabelText("Scene cue rows");
    expect(
      within(cueList).getByText("portrait.hayasaka_akane.concerned"),
    ).toBeInTheDocument();
    expect(within(cueList).getByText("Unresolved")).toBeInTheDocument();
    expect(within(cueList).queryByRole("img")).not.toBeInTheDocument();
  });

  it("switches exactly the three accessible sections without a router", async () => {
    const user = userEvent.setup();
    renderAssets();
    await screen.findByLabelText("Scene cue rows");

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Scene cues",
      "Library",
      "Characters",
    ]);
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "assets-tab-cues",
    );

    await user.click(screen.getByRole("tab", { name: "Library" }));
    expect(screen.getByLabelText("Asset library")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scene cue rows")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Characters" }));
    expect(
      screen.getByRole("region", { name: "Characters" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Asset library")).not.toBeInTheDocument();
  });

  it("filters the Library by kind and search without creating rows from existingAssetPaths", async () => {
    const user = userEvent.setup();
    renderAssets();
    const library = await openLibrary();

    // Presence-only: the unlisted file on disk never becomes a Library row.
    expect(within(library).queryByText(/unlisted/u)).not.toBeInTheDocument();
    expect(within(library).getAllByRole("listitem")).toHaveLength(9);

    await user.selectOptions(screen.getByLabelText("Kind"), "bgm");
    expect(within(library).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(library).getByRole("button", { name: "audio.bgm.rain" }),
    ).toBeInTheDocument();
    expect(
      within(library).getByRole("button", { name: "audio.bgm.step" }),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Kind"), "all");
    const searchBox = screen.getByLabelText("Search assets");
    await user.type(searchBox, "STREET");
    expect(within(library).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(library).getByRole("button", { name: "audio.bgs.street_rain" }),
    ).toBeInTheDocument();
  });

  it("selects the corresponding Library item from a cue asset id and auditions BGM", async () => {
    const user = userEvent.setup();
    renderAssets();
    await screen.findByLabelText("Scene cue rows");

    await user.click(screen.getByRole("button", { name: "audio.bgm.rain" }));

    expect(screen.getByRole("tab", { name: "Library" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const inspector = screen.getByLabelText("Asset inspector");
    expect(
      within(inspector).getByRole("heading", { name: "audio.bgm.rain" }),
    ).toBeInTheDocument();
    expect(within(inspector).getByText("Kind: bgm")).toBeInTheDocument();

    const audio = inspector.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("src", "/assets/audio/bgm/rain.ogg");
    expect(within(inspector).queryByRole("img")).not.toBeInTheDocument();
  });

  it("inspects a Library asset with exact manifest identity, prompts, presence, and usages", async () => {
    const user = userEvent.setup();
    renderAssets();
    await openLibrary();
    await user.click(
      screen.getByRole("button", { name: "portrait.hayasaka_akane.standard" }),
    );

    const inspector = screen.getByLabelText("Asset inspector");
    expect(
      within(inspector).getByRole("heading", {
        name: "portrait.hayasaka_akane.standard",
      }),
    ).toBeInTheDocument();
    expect(within(inspector).getByText("Kind: portrait")).toBeInTheDocument();
    expect(within(inspector).getByText("Missing")).toBeInTheDocument();
    expect(
      within(inspector).getByText(
        "static/assets/portraits/hayasaka_akane/standard.png",
      ),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByText(
        "/assets/portraits/hayasaka_akane/standard.png",
      ),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByText("chapterId: chapter_1"),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByText("sceneId: scene_cues"),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByText("characterId: hayasaka_akane"),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByText("expression: standard"),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByText("Global style: noir style"),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByText("Entry prompt: neutral"),
    ).toBeInTheDocument();
    expect(inspector.querySelector("[data-final-prompt]")?.textContent).toBe(
      "noir style\n\nneutral",
    );

    const preview = within(inspector).queryByRole("img", {
      name: "portrait.hayasaka_akane.standard",
    });
    // F3: previews render only when the file is present; this fixture keeps
    // portrait.standard absent from disk, so the inspector shows no image.
    expect(preview).not.toBeInTheDocument();
    expect(within(inspector).queryByRole("img")).not.toBeInTheDocument();

    expect(within(inspector).getByText("Usages: 1")).toBeInTheDocument();
    expect(
      within(inspector).getByRole("button", {
        name: "chapter_1 / scene_cues · main · portrait",
      }),
    ).toBeInTheDocument();
  });

  it("shows BGM/BGS set cues as library usages and previews only present files", async () => {
    const user = userEvent.setup();
    renderAssets();
    await openLibrary();

    // F2: the scene_cues bgm Set cue is a concrete usage row with its role.
    await user.click(screen.getByRole("button", { name: "audio.bgm.rain" }));
    const inspector = screen.getByLabelText("Asset inspector");
    expect(within(inspector).getByText("Usages: 1")).toBeInTheDocument();
    expect(
      within(inspector).getByRole("button", {
        name: "chapter_1 / scene_cues · main · bgm",
      }),
    ).toBeInTheDocument();
    // Present BGM keeps its audition control.
    expect(inspector.querySelector("audio")).not.toBeNull();
    expect(within(inspector).queryByRole("img")).not.toBeInTheDocument();

    // F3: a present background previews; missing assets preview nothing.
    await user.click(
      screen.getByRole("button", {
        name: "background.chapter_1.scene_cues.hall",
      }),
    );
    expect(
      within(screen.getByLabelText("Asset inspector")).getByRole("img", {
        name: "background.chapter_1.scene_cues.hall",
      }),
    ).toHaveAttribute(
      "src",
      "/assets/backgrounds/chapter_1/scene_cues/hall.png",
    );

    await user.click(screen.getByRole("button", { name: "audio.bgm.step" }));
    const missing = screen.getByLabelText("Asset inspector");
    expect(within(missing).getByText("Missing")).toBeInTheDocument();
    expect(within(missing).queryByRole("img")).not.toBeInTheDocument();
    expect(missing.querySelector("audio")).toBeNull();
  });

  it("shows asset-relevant diagnostics only for the inspected asset", async () => {
    const user = userEvent.setup();
    renderAssets();
    await openLibrary();

    await user.click(screen.getByRole("button", { name: "audio.bgm.step" }));
    const inspector = screen.getByLabelText("Asset inspector");
    expect(
      within(inspector).getByText(/assetFileMissing/u),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByText(
        /Expected file for "audio\.bgm\.step" is missing/u,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "audio.bgm.rain" }));
    expect(
      within(screen.getByLabelText("Asset inspector")).queryByText(
        /assetFileMissing/u,
      ),
    ).not.toBeInTheDocument();
  });

  it("does not prefix-match a longer asset id sharing the selected id's prefix", async () => {
    // `audio.bgm.step` is a prefix of `audio.bgm.step_alt`. A plain
    // `message.includes(id)` would surface the `step_alt` diagnostic under
    // `step`. The real `assetFileMissing` producer emits
    // `(assetId: <id>, type: <type>)` (unquoted, comma-delimited); the
    // `assetUsageUnresolved` producer emits `references "<id>"` (quoted).
    const user = userEvent.setup();
    const payload = payloadFixture();
    payload.manifest = {
      ...payload.manifest,
      entries: [
        ...payload.manifest.entries,
        {
          ...entryBase({
            assetId: "audio.bgm.step_alt",
            type: "audio",
            entryPrompt: "alt step",
          }),
          type: "audio",
          source: {
            chapterId: "chapter_1",
            sceneId: "scene_cues",
            channel: "bgm",
            id: "step_alt",
          },
        },
      ],
    };
    payload.report = {
      ...payload.report,
      warnings: [
        {
          code: "assetFileMissing",
          message:
            "Expected asset file not found: static/assets/audio/bgm/step_alt.ogg (assetId: audio.bgm.step_alt, type: audio)",
          sourceFile: "static/assets/audio/bgm/step_alt.ogg",
          line: 1,
        },
      ],
    };
    mockInvoke.mockImplementation(() => Promise.resolve(payload));
    renderAssets();
    await openLibrary();

    // Inspecting the prefix id must NOT surface the longer id's diagnostic.
    await user.click(screen.getByRole("button", { name: "audio.bgm.step" }));
    expect(
      within(screen.getByLabelText("Asset inspector")).queryByText(
        /assetId: audio\.bgm\.step_alt/u,
      ),
    ).not.toBeInTheDocument();

    // Inspecting the longer id DOES surface its own diagnostic.
    await user.click(
      screen.getByRole("button", { name: "audio.bgm.step_alt" }),
    );
    expect(
      within(screen.getByLabelText("Asset inspector")).getByText(
        /assetId: audio\.bgm\.step_alt/u,
      ),
    ).toBeInTheDocument();
  });

  it("copies the prompt and source reference, showing a visible failure state", async () => {
    const user = userEvent.setup();
    renderAssets();
    await openLibrary();
    await user.click(screen.getByRole("button", { name: "audio.bgm.rain" }));
    const inspector = screen.getByLabelText("Asset inspector");

    // All userEvent.setup() calls have run; reclaim the clipboard from the
    // user-event stub so writes land on our spy.
    stubClipboardWrite();

    await user.click(
      within(inspector).getByRole("button", { name: "Copy prompt" }),
    );
    // The copy handler is async; the visible status flushes the write call.
    expect(await screen.findByText("Copied prompt")).toBeInTheDocument();
    expect(clipboardWriteText).toHaveBeenLastCalledWith(
      "noir style\n\nsoft tension",
    );

    await user.click(
      within(inspector).getByRole("button", { name: "Copy source" }),
    );
    expect(await screen.findByText("Copied source")).toBeInTheDocument();
    expect(clipboardWriteText).toHaveBeenLastCalledWith(
      "docs/stories_plan/chapter_1/scene_cues.md",
    );

    clipboardWriteText.mockRejectedValueOnce(new Error("denied"));
    await user.click(
      within(inspector).getByRole("button", { name: "Copy prompt" }),
    );
    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
  });

  it("displays the authored global file for a global background source", async () => {
    // A global manifest entry has no chapter/scene owner: the source
    // reference must be the authored file itself, never a fabricated
    // chapter/scene path.
    const user = userEvent.setup();
    const payload = payloadFixture();
    payload.manifest = {
      ...payload.manifest,
      entries: [
        ...payload.manifest.entries,
        {
          ...entryBase({
            assetId: "background.city_map.tokyo",
            type: "background",
            entryPrompt: "tokyo city map",
          }),
          type: "background",
          source: { globalFile: "docs/stories_plan/city_map.json" },
        },
      ],
    };
    mockInvoke.mockImplementation(async () => payload);
    renderAssets();
    await openLibrary();
    await user.click(
      screen.getByRole("button", { name: "background.city_map.tokyo" }),
    );
    const inspector = screen.getByLabelText("Asset inspector");
    expect(
      within(inspector).getByText(
        "globalFile: docs/stories_plan/city_map.json",
      ),
    ).toBeInTheDocument();
    expect(
      within(inspector).queryByText(/^chapterId:/u),
    ).not.toBeInTheDocument();

    // All userEvent.setup() calls have run; reclaim the clipboard from the
    // user-event stub so writes land on our spy.
    stubClipboardWrite();
    await user.click(
      within(inspector).getByRole("button", { name: "Copy source" }),
    );
    expect(await screen.findByText("Copied source")).toBeInTheDocument();
    expect(clipboardWriteText).toHaveBeenLastCalledWith(
      "docs/stories_plan/city_map.json",
    );
  });

  it("selecting a usage navigates by chapter and scene ids only", async () => {
    const onSelectScene = vi.fn();
    const user = userEvent.setup();
    renderAssets({ onSelectScene });
    await openLibrary();
    await user.click(
      screen.getByRole("button", { name: "portrait.hayasaka_akane.standard" }),
    );

    const inspector = screen.getByLabelText("Asset inspector");
    await user.click(
      within(inspector).getByRole("button", {
        name: "chapter_1 / scene_cues · main · portrait",
      }),
    );

    expect(onSelectScene).toHaveBeenCalledExactlyOnceWith(
      "chapter_1",
      "scene_cues",
    );
  });

  it("Refresh rereads the asset workspace snapshot", async () => {
    const user = userEvent.setup();
    renderAssets();
    await screen.findByLabelText("Scene cue rows");
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Scene cue rows")).toBeInTheDocument();
  });

  it("renders character identity and expression grids only for portraitMode characters", async () => {
    const user = userEvent.setup();
    renderAssets();
    await screen.findByLabelText("Scene cue rows");

    await user.click(screen.getByRole("tab", { name: "Characters" }));
    const region = screen.getByRole("region", { name: "Characters" });

    const portrait = within(region).getByRole("article", {
      name: "hayasaka_akane",
    });
    expect(within(portrait).getByText("早坂茜")).toBeInTheDocument();
    expect(
      within(portrait).getByText("attorney in dark suit"),
    ).toBeInTheDocument();

    const grid = within(portrait).getByLabelText("Expressions");
    const rows = [
      ...grid.querySelectorAll<HTMLElement>("[data-expression-row]"),
    ];
    expect(rows.map((row) => row.dataset.expressionId)).toEqual([
      "standard",
      "concerned",
    ]);

    const standard = within(rows[0]!);
    expect(standard.getByText("Missing")).toBeInTheDocument();
    expect(standard.getByText("Usages: 1")).toBeInTheDocument();
    expect(standard.getByText("neutral")).toBeInTheDocument();
    expect(
      standard.getByText("static/assets/portraits/hayasaka_akane/standard.png"),
    ).toBeInTheDocument();
    expect(
      standard.getByRole("button", { name: "chapter_1 / scene_cues" }),
    ).toBeInTheDocument();

    // One concrete occurrence in scene_x makes `concerned` referenced: a

    // warning or error.
    const concerned = within(rows[1]!);
    expect(concerned.getByText("Usages: 1")).toBeInTheDocument();
    expect(concerned.getByText("worried")).toBeInTheDocument();
    expect(concerned.queryByText(/warning/i)).not.toBeInTheDocument();

    const none = within(region).getByRole("article", { name: "receptionist" });
    expect(within(none).getByText("受付")).toBeInTheDocument();
    expect(within(none).getByText("hotel front desk")).toBeInTheDocument();
    expect(
      within(none).queryByLabelText("Expressions"),
    ).not.toBeInTheDocument();
    expect(within(none).queryByText(/usages/i)).not.toBeInTheDocument();
  });

  it("lists grouped scenes and related sprite usages per expression", async () => {
    const onSelectScene = vi.fn();
    const user = userEvent.setup();
    mockInvoke.mockImplementation(async () => payloadWithPortraitSprite());
    renderAssets({ onSelectScene });
    await screen.findByLabelText("Scene cue rows");

    await user.click(screen.getByRole("tab", { name: "Characters" }));
    const portrait = screen.getByRole("article", { name: "hayasaka_akane" });
    const rows = [
      ...within(portrait)
        .getByLabelText("Expressions")
        .querySelectorAll<HTMLElement>("[data-expression-row]"),
    ];
    const standard = within(rows[0]!);
    expect(
      standard.getByRole("button", { name: "chapter_1 / scene_cues" }),
    ).toBeInTheDocument();

    await user.click(
      standard.getByRole("button", {
        name: "chapter_1 / investigation_delta · character:npc2 · sprite",
      }),
    );
    expect(onSelectScene).toHaveBeenCalledExactlyOnceWith(
      "chapter_1",
      "investigation_delta",
    );
  });

  it("surfaces existing workspace diagnostics without approval status", async () => {
    const broken = payloadFixture();
    broken.configSources = {
      characters: {
        path: "static/assets/config/characters.yaml",
        content: "characters: [unclosed\n",
      },
      audio: broken.configSources.audio,
    };
    mockInvoke.mockImplementation(async () => broken);

    renderAssets();
    await screen.findByLabelText("Scene cue rows");

    const panel = screen.getByLabelText("Asset diagnostics");
    const codes = [
      ...panel.querySelectorAll<HTMLElement>("[data-diagnostic-code]"),
    ].map((item) => item.dataset.diagnosticCode);
    // Exactly the existing facts: compiler report warning (missing file),
    // shared config-read failure, unresolved manifest join. Nothing else.
    expect(codes).toEqual([
      "assetFileMissing",
      "assetConfigUnreadable",
      "assetUsageUnresolved",
    ]);
    expect(
      within(panel).getByText(
        /Expected file for "audio\.bgm\.step" is missing/u,
      ),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/approv/i)).not.toBeInTheDocument();
  });

  it("keeps the newer workspace when an older load resolves last", async () => {
    const user = userEvent.setup();
    const pending: Array<(payload: WorkbenchAssetWorkspacePayload) => void> =
      [];
    mockInvoke.mockImplementation(
      async () =>
        new Promise<WorkbenchAssetWorkspacePayload>((resolve) => {
          pending.push(resolve);
        }),
    );

    renderAssets();
    await screen.findByText("Loading asset workspace…");

    // Refresh stays clickable during a pending load; each load gets its own
    // deferred snapshot promise.
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(pending).toHaveLength(2);

    const newer = payloadFixture();
    newer.manifest = {
      ...newer.manifest,
      entries: [
        ...newer.manifest.entries,
        {
          ...entryBase({
            assetId: "audio.bgm.later",
            type: "audio",
            entryPrompt: "later",
          }),
          type: "audio",
          source: {
            chapterId: "chapter_1",
            sceneId: "scene_cues",
            channel: "bgm",
            id: "later",
          },
        },
      ],
    };
    pending[1]!(newer); // newer generation resolves first
    pending[0]!(payloadFixture()); // older generation resolves last

    // The older response must not overwrite the newer workspace.
    const library = await openLibrary();
    expect(
      await within(library).findByRole("button", { name: "audio.bgm.later" }),
    ).toBeInTheDocument();
    expect(within(library).getAllByRole("listitem")).toHaveLength(10);
  });
});
