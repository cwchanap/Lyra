import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("the map keyboard proof uses both verified native keys or is inconclusive", () => {
  const source = readFileSync(
    new URL("../e2e-tauri/investigation-layout.e2e.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    'it("crosses the same first destination with Tab and Enter',
  );
  assert.notEqual(start, -1);
  const proof = source.slice(start, source.indexOf("// --- HPA-853", start));
  assert.match(proof, /e2eXvfbTrustedKeysEnabled\(\)/);
  assert.match(proof, /this\.skip\(\)/);
  assert.match(proof, /inconclusive/i);
  assert.match(proof, /map-keyboard-coverage-gap\.json/);
  assert.match(proof, /coverage: "inconclusive"/);
  assert.match(proof, /anchors\.mapOverviewSelector/);
  assert.match(proof, /sendXvfbTrustedKey\(key\)/);
  assert.match(proof, /deliverMapKey\("Tab"\)/);
  assert.match(proof, /data-map-destination/);
  assert.match(proof, /deliverMapKey\("Enter"\)/);
  assert.doesNotMatch(proof, /browser\.keys|\.click\(/);
});

test("scene-nav trusted input is scoped and separates delivery from behavior", () => {
  const dir = new URL("../e2e-tauri/", import.meta.url);
  const source = readFileSync(
    new URL("investigation-layout.e2e.ts", dir),
    "utf8",
  );
  const pointerStart = source.indexOf(
    'it("exercises the real five-chip scene navigation overflow"',
  );
  const keyboardStart = source.indexOf(
    'it("traverses and activates the last scene chip with trusted keyboard input"',
  );
  assert.ok(pointerStart >= 0 && keyboardStart > pointerStart);
  const pointer = source.slice(pointerStart, keyboardStart);
  const keyboard = source.slice(
    keyboardStart,
    source.indexOf(
      "for (const sceneNumber of HPA853_SCENE_NUMBERS)",
      keyboardStart,
    ),
  );
  for (const action of [
    "move",
    "wheel-press",
    "wheel-release",
    "click-press",
    "click-release",
  ]) {
    assert.match(
      pointer,
      new RegExp(`sendXvfbTrustedSceneNavPointer\\(\\s*"${action}"`),
    );
  }
  assert.match(
    pointer,
    /assertSceneNavWheelProgress\([\s\S]*?before\.position[\s\S]*?wheel\.position/,
  );
  assert.match(pointer, /expect\(wheel\.lastVisible\)\.toBe\(true\)/);
  assert.match(pointer, /assertSceneNavPointerEvents\(pointerEvents\)/);
  assert.match(
    pointer,
    /delivered\.down && delivered\.up[\s\S]*?await advanceDialogueUntil[\s\S]*?currentSublocationId === "police_review_van"/,
  );
  assert.match(keyboard, /sendXvfbTrustedKey\("Tab"\)/);
  assert.match(
    keyboard,
    /assertSceneNavTabProgress\(\s*event,\s*index \+ 1,\s*keyboard\.activeIndex,\s*keyboard\.lastVisible,?\s*\)/,
  );
  assert.match(keyboard, /expect\(keyboard\.lastVisible\)\.toBe\(true\)/);
  assert.match(keyboard, /sendXvfbTrustedKey\("Enter"\)/);
  assert.match(
    keyboard,
    /if \(enterTrusted\)[\s\S]*?await advanceDialogueUntil[\s\S]*?currentSublocationId === "police_review_van"/,
  );
  assert.doesNotMatch(
    pointer + keyboard,
    /browser\.keys|\.action\(|last\.click\(/,
  );
  assert.match(pointer, /coverage: "inconclusive"/);
  assert.match(keyboard, /coverage: "inconclusive"/);
  assert.match(pointer, /this\.skip\(\)/);
  assert.match(keyboard, /this\.skip\(\)/);
  const scripted = source.slice(
    source.indexOf("async function enterSublocationThroughNav"),
    source.indexOf(
      "/** The keyed surface",
      source.indexOf("async function enterSublocationThroughNav"),
    ),
  );
  assert.match(scripted, /Active scene chip .*did not scroll into view/);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    if (file === "helpers.ts" || file === "investigation-layout.e2e.ts")
      continue;
    const other = readFileSync(new URL(file, dir), "utf8");
    assert.doesNotMatch(other, /sendXvfbTrustedSceneNavPointer/);
    if (file !== "production-journey.e2e.ts") {
      assert.doesNotMatch(other, /sendXvfbTrustedKey/);
    }
  }
  const helper = readFileSync(new URL("helpers.ts", dir), "utf8");
  assert.match(
    helper,
    /deliverXvfbTrustedPointer\(\{[\s\S]*?resolveTarget: resolveXvfbTrustedTarget/,
  );
  assert.match(helper, /readRootPointer:[\s\S]*?XQueryPointer/);
});

test("scene-nav observes pointer delivery at document capture", () => {
  const source = readFileSync(
    new URL("../e2e-tauri/investigation-layout.e2e.ts", import.meta.url),
    "utf8",
  );
  const pointer = source.slice(
    source.indexOf(
      'it("exercises the real five-chip scene navigation overflow"',
    ),
    source.indexOf('it("traverses and activates the last scene chip'),
  );
  const clicks = pointer.slice(pointer.indexOf("hpa852PointerEvents"));
  assert.match(clicks, /document\.addEventListener\([\s\S]*?capture:\s*true/);
  assert.match(clicks, /targetIsLast/);
  assert.ok(
    clicks.indexOf("assertSceneNavPointerEvents(pointerEvents)") <
      clicks.indexOf("if (clickError &&"),
  );
  assert.ok(
    clicks.indexOf("await advanceDialogueUntil") <
      clicks.indexOf("if (clickError &&"),
  );
  const keyboard = source.slice(
    source.indexOf('it("traverses and activates the last scene chip'),
    source.indexOf("for (const sceneNumber of HPA853_SCENE_NUMBERS)"),
  );
  assert.ok(
    keyboard.indexOf("assertSceneNavTabProgress(") <
      keyboard.indexOf("if (trusted && keyError)"),
  );
  assert.match(keyboard, /targetIndex/);
  assert.match(keyboard, /expect\(enterEvent\.targetIndex\)\.toBe\(4\)/);
});

test("poisoned X11 state prevents later test bodies and runner retries", () => {
  const source = readFileSync(
    new URL("../e2e-tauri/investigation-layout.e2e.ts", import.meta.url),
    "utf8",
  );
  const config = readFileSync(
    new URL("../wdio.conf.ts", import.meta.url),
    "utf8",
  );
  const helper = readFileSync(
    new URL("../e2e-tauri/helpers.ts", import.meta.url),
    "utf8",
  );
  const runner = readFileSync(
    new URL("./run-save-e2e.mjs", import.meta.url),
    "utf8",
  );
  const journey = readFileSync(
    new URL("../e2e-tauri/production-journey.e2e.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /beforeEach\(async function[\s\S]*?assertSafeXvfbDisplay\(this, true\)[\s\S]*?resetE2eStorage/,
  );
  assert.match(
    source,
    /afterEach\(function[\s\S]*?assertSafeXvfbDisplay\(this, true\)/,
  );
  assert.match(helper, /suite\.bail\(true\)/);
  assert.match(config, /maxInstances:\s*1/);
  assert.match(config, /specFileRetries:\s*0/);
  assert.match(config, /bail:[\s\S]*?trustedXvfbKeysOptIn/);
  assert.match(
    helper,
    /deliverXvfbTrustedKey\(\{[\s\S]*?pointerState:\s*xvfbPointerState\(\)/,
  );
  assert.match(
    helper,
    /pointerState\.assertAllowed\(action\)[\s\S]*?browser\.execute/,
  );
  assert.match(runner, /LYRA_E2E_X11_POINTER_STATE:\s*pointerStatePath/);
  assert.match(config, /beforeTest\(\)[\s\S]*?\.beginTest\(\)/);
  assert.match(config, /afterTest\([\s\S]*?\.finishTest\(/);
  assert.match(
    journey,
    /afterEach\(function[\s\S]*?assertSafeXvfbDisplay\(this, true\)/,
  );
  assert.match(
    runner,
    /verifyLivePrivateXvfbSession\(\)[\s\S]*?claimXvfbDisplay\(/,
  );
  assert.match(
    helper,
    /verifyLivePrivateXvfbSession\(\)[\s\S]*?assertXvfbDisplayClaim\(/,
  );
});

test("exit acquisition is acknowledged and quit without a later save or mutation", () => {
  const source = readFileSync(
    new URL("../e2e-tauri/save-exit.e2e.ts", import.meta.url),
    "utf8",
  );
  const proof = source.slice(
    source.indexOf("async function exitAfterOrdinaryAcknowledgement"),
    source.indexOf("async function proveFailureCancelAndBypass"),
  );
  assert.ok(proof.indexOf("await proveExploreMenuSaveLoad()") >= 0);
  assert.ok(
    proof.indexOf("await proveExploreMenuSaveLoad()") <
      proof.indexOf("await jsClick(hotspot)"),
  );
  const afterAcknowledgement = proof.slice(
    proof.indexOf("await acknowledgeAcquisitionDomFirst(current)"),
  );
  assert.match(afterAcknowledgement, /await requestAndFinish\("quit"\)/);
  assert.doesNotMatch(
    afterAcknowledgement,
    /saveManualSlot|jumpToProductionScene|drainCurrentDialogue|waitForPersistenceIdle|jsClick/,
  );
});
