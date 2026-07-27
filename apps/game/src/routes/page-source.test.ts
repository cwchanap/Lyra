import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function pageSource() {
  return readFileSync(join(process.cwd(), "src/routes/+page.svelte"), "utf8");
}

describe("+page inventory placement", () => {
  it("renders inventory inside the GameShell menu slot instead of scene HUDs", () => {
    const source = pageSource();

    expect(source).toContain("{#snippet menu()}");
    expect(source).toContain("<InventoryPanel");
    expect(source).not.toContain('placement="scene"');
    expect(source).not.toContain('gameState.value.mode.type !== "explore"');
  });

  it("binds the inventory panel open state to the page so it survives menu close/reopen", () => {
    const source = pageSource();

    // The expand/collapse state is hoisted to the page via bind:open so the
    // dossier does not reset every time the Escape menu closes and reopens.
    expect(source).toContain("let inventoryPanelOpen = $state(false)");
    expect(source).toContain("bind:open={inventoryPanelOpen}");
  });
});

describe("ExploreView HUD placement", () => {
  function exploreViewSource() {
    return readFileSync(
      join(process.cwd(), "src/lib/components/ExploreView.svelte"),
      "utf8",
    );
  }

  it("renders the sublocation nav through the scene HUD instead of above the scene", () => {
    const source = exploreViewSource();

    expect(source).toContain("{#snippet sceneHud()}");
    expect(source).toContain('placement="scene"');
    expect(source).toContain("{@render hud()}");
    expect(source).not.toContain("<SublocationNav\n    sublocations=");
  });
});

describe("+page gameplay audio wiring", () => {
  it("mounts GameplayAudio whenever a game state exists", () => {
    const source = pageSource();

    expect(source).toContain(
      'import GameplayAudio from "$lib/components/GameplayAudio.svelte";',
    );
    expect(source).toContain("<GameplayAudio mode={gameState.value.mode} />");
  });
});

describe("+page acquisition popup ownership", () => {
  it("mounts one popup outside an inert gameplay root", () => {
    const source = pageSource();

    expect(source).toContain('data-gameplay-root=""');
    expect(source).toContain("inert={acquisitionController.blocking}");
    expect(source).toContain("<AcquisitionPopup");
    expect(source).toContain("notification={acquisitionController.current}");
  });
});

describe("+page save-thumbnail boundary", () => {
  it("marks exactly one real gameplay root and keeps page overlays outside or excluded", () => {
    const source = pageSource();

    expect(source.match(/data-save-thumbnail-root/g)).toHaveLength(1);
    expect(source).toContain('data-save-thumbnail-root=""');
    expect(source.indexOf('data-save-thumbnail-root=""')).toBeLessThan(
      source.indexOf("<GameShell"),
    );
    expect(source.indexOf("</GameShell>")).toBeLessThan(
      source.indexOf("<AcquisitionPopup"),
    );
    expect(source).toContain(
      '<div data-save-thumbnail-exclude="">\n          <ErrorBanner',
    );
    expect(source).toContain(
      '<div class="menu-error" data-save-thumbnail-exclude="">',
    );
  });

  it("excludes the Escape menu while retaining the shell HUD in the capture root", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/components/GameShell.svelte"),
      "utf8",
    );

    expect(source).toContain('class="game-menu-scrim"');
    expect(source).toContain('data-save-thumbnail-exclude=""');
    expect(source.indexOf("{#if open}")).toBeLessThan(
      source.indexOf('class="game-menu-scrim"'),
    );
    expect(source.indexOf('data-save-thumbnail-exclude=""')).toBeGreaterThan(
      source.indexOf('class="game-menu-scrim"'),
    );
  });

  it("excludes only the decorative rain canvas before html-to-image cloning", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/components/GameAtmosphere.svelte"),
      "utf8",
    );

    expect(source).toMatch(
      /<canvas class="rain" data-save-thumbnail-exclude="" bind:this=\{canvas\}/,
    );
    expect(source.match(/<canvas/g)).toHaveLength(1);
    expect(source).toContain("packaged WebKit");
    expect(source).toContain("CSS atmosphere layers");
  });

  it("marks only clone-layout artwork so packaged SVG normalization cannot mutate live positioning", () => {
    const component = (name: string) =>
      readFileSync(
        join(process.cwd(), `src/lib/components/${name}.svelte`),
        "utf8",
      );
    const shell = component("GameShell");
    const atmosphere = component("GameAtmosphere");
    const backdrop = component("SceneBackdrop");
    const dialogue = component("DialogueBox");
    const investigation = component("InvestigationSceneSurface");
    const capture = readFileSync(
      join(process.cwd(), "src/lib/persistence/thumbnail-capture.ts"),
      "utf8",
    );

    expect(shell).toContain('data-save-thumbnail-layout="main"');
    expect(atmosphere).toContain('data-save-thumbnail-layout="atmosphere"');
    expect(atmosphere).toContain('data-save-thumbnail-atmosphere-wash=""');
    expect(backdrop).toContain('data-save-thumbnail-layout="backdrop"');
    expect(backdrop).toContain('imageClass="background-image"');
    expect(backdrop).toContain('"save-thumbnail-asset-role": "background"');
    expect(dialogue).toContain("imageClass={`portrait ${portraitPlacement}`}");
    expect(dialogue).toContain('"save-thumbnail-asset-role": "portrait"');
    expect(dialogue).toContain('data-save-thumbnail-layer="over-portrait"');
    expect(investigation).toContain('imageClass="background-image"');
    expect(investigation).toContain(
      '"save-thumbnail-asset-role": "background"',
    );
    expect(capture).toContain("normalizeGameplayCaptureSvg(serializedSvgUrl)");
    expect(capture).toContain("THUMBNAIL_ASSET_ROLE_ATTRIBUTE");
    expect(capture).not.toContain('root.style.setProperty("--save-thumbnail');
  });

  it("compile-gates the closed packaged proof outside the capture root", () => {
    const source = pageSource();
    const probeSource = readFileSync(
      join(
        process.cwd(),
        "src/lib/test-harnesses/PackagedCaptureProofProbe.svelte",
      ),
      "utf8",
    );

    expect(source).toContain(
      'import.meta.env.VITE_LYRA_E2E_CAPTURE_PROOF === "1"',
    );
    expect(source).toContain("<PackagedCaptureProofProbe");
    expect(source.indexOf("</GameShell>")).toBeLessThan(
      source.indexOf("<PackagedCaptureProofProbe"),
    );
    expect(source.indexOf("<PackagedCaptureProofProbe")).toBeLessThan(
      source.indexOf("<AcquisitionPopup"),
    );
    expect(probeSource).toContain('data-save-thumbnail-exclude=""');
    expect(probeSource).toContain('"list_saves"');
    expect(probeSource).not.toContain("window.");
    expect(probeSource).not.toContain("eval(");
  });

  it("wires the proof wrapper instance into gameplay dispatch and exposes only owning-command settlement", () => {
    const source = pageSource();
    const captureSource = readFileSync(
      join(process.cwd(), "src/lib/persistence/thumbnail-capture.ts"),
      "utf8",
    );
    const gameClientSource = readFileSync(
      join(process.cwd(), "src/lib/state/game-client.svelte.ts"),
      "utf8",
    );

    expect(captureSource).toContain(
      "packagedCaptureProof?.capture ?? htmlToImageGameplayCapture",
    );
    expect(gameClientSource).toContain(
      "captureResult = await gameplayThumbnailCapture.capture(request)",
    );
    expect(source).toContain("captureCommandInFlight={gameState.inFlight}");
  });

  it("tree-shakes proof-only diagnostics out of ordinary production capture", () => {
    const captureSource = readFileSync(
      join(process.cwd(), "src/lib/persistence/thumbnail-capture.ts"),
      "utf8",
    );
    const probeSource = readFileSync(
      join(
        process.cwd(),
        "src/lib/test-harnesses/PackagedCaptureProofProbe.svelte",
      ),
      "utf8",
    );
    const adapterStart = captureSource.indexOf(
      "const htmlToImageGameplayCapture",
    );
    const proofWrapperStart = captureSource.indexOf(
      "const packagedCaptureProof =",
      adapterStart,
    );
    const adapterSource = captureSource.slice(adapterStart, proofWrapperStart);
    const ordinaryBranchStart = adapterSource.indexOf(
      ": createHtmlToImageGameplayCapture({",
    );

    expect(captureSource).toContain(
      'import.meta.env.VITE_LYRA_E2E_CAPTURE_PROOF === "1"',
    );
    expect(ordinaryBranchStart).toBeGreaterThan(0);
    expect(adapterSource.slice(0, ordinaryBranchStart)).toContain(
      "onRenderDiagnostic:",
    );
    expect(adapterSource.slice(ordinaryBranchStart)).not.toContain(
      "onRenderDiagnostic:",
    );
    for (const removedDiagnostic of [
      "createPackagedRenderTimingTracker",
      "createPackagedRasterizerTimingTracker",
      "createPackagedCaptureStageDiagnostic",
      "locatePackagedCloneHang",
      'from "html-to-image/es/',
    ]) {
      expect(captureSource).not.toContain(removedDiagnostic);
    }
    for (const removedAttribute of [
      "data-hpa-392-capture-proof-render-",
      "data-hpa-392-capture-proof-raster-",
      "data-hpa-392-capture-proof-stage-",
      "data-hpa-392-capture-proof-svg-",
    ]) {
      expect(probeSource).not.toContain(removedAttribute);
    }
    expect(probeSource).toContain(
      "data-hpa-392-capture-proof-last-render-diagnostic",
    );
    expect(captureSource).toContain("includeStyleProperties:");
    expect(captureSource).toContain(
      "? curatedCaptureOptions(baseRenderOptions)",
    );
    for (const property of [
      "display",
      "flex-direction",
      "grid-template-columns",
      "position",
      "width",
      "padding",
      "overflow",
      "clip-path",
      "transform",
      "opacity",
      "background-image",
      "border-radius",
      "box-shadow",
      "color",
      "font-family",
      "text-shadow",
      "object-fit",
      "filter",
      "visibility",
      "--save-crossfade-opacity",
      "--save-crossfade-transition",
    ]) {
      expect(captureSource).toContain(`"${property}"`);
    }
  });
});
describe("+page scene navigation wiring", () => {
  it("passes scene navigation through the GameShell sceneMenu snippet", () => {
    const source = pageSource();

    expect(source).toContain("{#snippet sceneMenu()}");
    expect(source).toContain("<SceneNavigationPanel");
    expect(source).toContain("sceneMenuEnabled={sceneNavigationEnabled}");
    expect(source).toContain("sceneNavigationEnabled");
    expect(source).toContain("handleJumpToScene");
  });

  it("marks story cleared when gameComplete is observed", () => {
    const source = pageSource();

    expect(source).toContain("saveStoryClearedOnce()");
    expect(source).toContain('gameState.value?.mode.type === "gameComplete"');
  });

  it("closes the menu after scene jump resolves", () => {
    const source = pageSource();

    expect(source).toContain("await jumpToScene(chapterId, sceneId)");
    expect(source).toContain("gameMenuOpen = false");
  });
});

describe("+page evidence menu gating", () => {
  it("gates the evidence menu entry on shouldShowInventoryPanel so it hides after gameComplete", () => {
    const source = pageSource();

    // The menu snippet is always passed to GameShell, but its body guards
    // <InventoryPanel> on shouldShowInventoryPanel(mode) (false for
    // gameComplete). The Evidence button must therefore be gated by an
    // explicit evidenceMenuEnabled flag wired to the same helper, otherwise
    // it would render in every mode and open an empty submenu after
    // completion.
    expect(source).toContain(
      "evidenceMenuEnabled={shouldShowInventoryPanel(gameState.value.mode)}",
    );
  });
});
