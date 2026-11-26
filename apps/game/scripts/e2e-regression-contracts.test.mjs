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
      new RegExp(`sendXvfbTrustedSceneNavPointer\\("${action}"`),
    );
  }
  assert.match(
    pointer,
    /assertSceneNavWheelProgress\([\s\S]*?before\.position[\s\S]*?wheel\.position/,
  );
  assert.match(pointer, /expect\(wheel\.lastVisible\)\.toBe\(true\)/);
  assert.match(
    pointer,
    /if \(delivered\)[\s\S]*?expect\(\s*pointerEvents\.some/,
  );
  assert.match(
    pointer,
    /if \(delivered\)[\s\S]*?await advanceDialogueUntil[\s\S]*?currentSublocationId === "police_review_van"/,
  );
  assert.match(keyboard, /sendXvfbTrustedKey\("Tab"\)/);
  assert.match(
    keyboard,
    /assertSceneNavTabProgress\(\s*event,\s*index \+ 1,\s*keyboard\.activeIndex,?\s*\)/,
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
