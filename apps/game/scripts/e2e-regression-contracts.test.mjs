import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
