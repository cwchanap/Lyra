import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function pageSource() {
  return readFileSync(join(process.cwd(), "src/routes/+page.svelte"), "utf8");
}

describe("+page Case File placement", () => {
  it("renders the Case File inside the GameShell menu slot instead of scene HUDs", () => {
    const source = pageSource();

    expect(source).toContain("{#snippet menu()}");
    expect(source).toContain("<CaseFilePanel");
    expect(source).not.toContain('placement="scene"');
    expect(source).not.toContain('gameState.value.mode.type !== "explore"');
  });

  it("keeps the selected Case File section on the page and resets it only for a replacement session", () => {
    const source = pageSource();

    expect(source).toContain(
      'let caseFileSection = $state<CaseFileSection>("objective")',
    );
    expect(source).toContain("bind:section={caseFileSection}");
    expect(source).toContain("if (epoch !== observedCaseFileEpoch)");
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
  it("mounts one popup outside the gameplay surfaces it makes inert", () => {
    const source = pageSource();

    expect(source).toContain('data-gameplay-root=""');
    expect(source).not.toContain("inert={rootInteractionBlocked}");
    expect(source).toContain("gameplayInert={gameplayInteractionBlocked}");
    expect(source).toContain("<AcquisitionPopup");
    expect(source).toContain("notification={acquisitionController.current}");
  });

  it("rewires the popup to busy, the shared error, and the single Continue action", () => {
    const source = pageSource();
    const popupStart = source.indexOf("<AcquisitionPopup");
    const popupEnd = source.indexOf("/>", popupStart);
    const popupSource = source.slice(popupStart, popupEnd);

    expect(popupSource).toContain("busy={acquisitionController.busy}");
    expect(popupSource).toContain("error={gameState.error}");
    expect(popupSource).toContain(
      "onContinue={acquisitionController.dismissCurrent}",
    );
    expect(popupSource).not.toContain("onRetry");
    expect(popupSource).not.toContain("onCancel");
    expect(popupSource).not.toContain("onContinueWithoutSaving");
    expect(source).not.toContain("acquisitionController.phase");
    expect(source).not.toContain("acquisitionController.size");
  });
});

describe("save/load canonical player copy", () => {
  function componentSource(name: string) {
    return readFileSync(
      join(process.cwd(), `src/lib/components/${name}.svelte`),
      "utf8",
    );
  }

  it("pins every required Traditional Chinese action and status", () => {
    const source = [
      pageSource(),
      componentSource("MainMenu"),
      componentSource("GameShell"),
      componentSource("SaveBrowser"),
      componentSource("SaveCard"),
      componentSource("AcquisitionPopup"),
      componentSource("SaveConfirmationDialog"),
    ].join("\n");

    for (const requiredCopy of [
      "繼續遊戲",
      "載入遊戲",
      "開始新遊戲",
      "儲存遊戲",
      "返回標題畫面",
      "自動存檔",
      "手動存檔",
      "儲存中…",
      "無法顯示預覽",
      "不儲存並開始遊戲",
      "捨棄未儲存進度並載入",
      "不儲存並結束遊戲",
      "重試",
      "取消",
    ]) {
      expect(source, requiredCopy).toContain(requiredCopy);
    }
  });

  it("does not retain the stale title New Game label", () => {
    expect(componentSource("MainMenu")).not.toContain("開始調查");
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
    expect(source).toMatch(
      /<div data-save-thumbnail-exclude="">\s*<ErrorBanner/,
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

  it("wires the proof wrapper instance into gameplay dispatch and waits for full capture persistence settlement", () => {
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
    expect(source).toContain("captureCommandInFlight={gameState.inFlight ||");
    expect(source).toContain(
      'persistenceStore.persistenceStatus.type === "pending" ||',
    );
    expect(source).toContain(
      'persistenceStore.thumbnailActivity.type === "capturing"}',
    );
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
    expect(adapterStart).toBeGreaterThan(-1);
    expect(proofWrapperStart).toBeGreaterThan(-1);
    const adapterSource = captureSource.slice(adapterStart, proofWrapperStart);

    expect(captureSource).toContain(
      'import.meta.env.VITE_LYRA_E2E_CAPTURE_PROOF === "1"',
    );
    // Diagnostics are gated by a packagedCaptureProofEnabled conditional
    // spread inside the consolidated createHtmlToImageGameplayCapture call so
    // the bundler can tree-shake them out of ordinary production captures.
    expect(adapterSource).toContain("packagedCaptureProofEnabled");
    expect(adapterSource).toContain("onRenderDiagnostic:");
    const conditionalStart = adapterSource.indexOf(
      "packagedCaptureProofEnabled",
    );
    const diagnosticStart = adapterSource.indexOf("onRenderDiagnostic:");
    expect(conditionalStart).toBeGreaterThan(-1);
    expect(diagnosticStart).toBeGreaterThan(conditionalStart);
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
      "data-capture-proof-render-",
      "data-capture-proof-raster-",
      "data-capture-proof-stage-",
      "data-capture-proof-svg-",
    ]) {
      expect(probeSource).not.toContain(removedAttribute);
    }
    expect(probeSource).toContain("data-capture-proof-last-render-diagnostic");
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

describe("+page Case File menu gating", () => {
  it("gates the Case File entry on shouldShowCaseFile so it hides after gameComplete", () => {
    const source = pageSource();

    // The menu snippet is always passed to GameShell, but its body guards
    // CaseFilePanel on shouldShowCaseFile(mode) (false for gameComplete).
    // The Case File button must therefore be gated by an explicit
    // caseFileMenuEnabled flag wired to the same helper, otherwise
    // it would render in every mode and open an empty submenu after
    // completion.
    expect(source).toContain(
      "caseFileMenuEnabled={shouldShowCaseFile(gameState.value.mode)}",
    );
  });
});

describe("+page interrogation presentation wiring", () => {
  it("keeps one stage around the existing mode chain and delegates Case File access to GameShell", () => {
    const source = pageSource();

    expect(source).toContain(
      'import InterrogationStage from "$lib/components/InterrogationStage.svelte";',
    );
    expect(source).toContain("isInterrogationPresentationActive");
    expect(source).toContain("currentInterrogationPhase");
    expect(source).toContain("let caseFileRequestId = $state(0)");
    expect(source).toContain("function openInterrogationCaseFile");
    expect(source).toContain('caseFileSection = "evidence"');
    expect(source).toContain("caseFileRequest = {");
    expect(source).toContain(
      "interrogationPresentation={interrogationPresentationActive}",
    );
    expect(source).toContain(
      "onCaseFileRequestHandled={handleCaseFileRequestHandled}",
    );
    expect(source).toContain("<InterrogationStage");
    expect(source).toContain("onOpenCaseFile={openInterrogationCaseFile}");
    expect(source).toContain("presentation:");
    expect(source).toContain(
      "interrogationPresentationPhase?.crossExam ?? null",
    );
    expect(source).toContain("</InterrogationStage>");
    expect(source.indexOf("<InterrogationStage")).toBeLessThan(
      source.indexOf('{#if gameState.value.mode.type === "dialogue"}'),
    );
  });
});
