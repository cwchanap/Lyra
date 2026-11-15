import assert from "node:assert/strict";
import test from "node:test";
import {
  TRUSTED_KEYS_ENV,
  assertTrustedKeysAllowed,
  trustedKeysOptIn,
} from "./e2e-trusted-keys.mjs";

// Input-mode policy regression (HPA-830 final review): trusted OS-global keys
// are never implicit. Default packaged E2E on every platform uses the reduced
// fallback (JS clicks + synthetic Tab); `sendTrustedKey` additionally refuses
// to run without the explicit opt-in so accidental calls fail closed.

test("default (no opt-in) never selects trusted keys on any platform", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    assert.equal(
      trustedKeysOptIn({ platform, env: {} }),
      false,
      `${platform} must default to the reduced fallback`,
    );
    assert.throws(
      () => assertTrustedKeysAllowed({ platform, env: {} }),
      `${platform} must refuse sendTrustedKey without the opt-in`,
    );
  }
});

test("opt-in selects trusted keys on macOS only", () => {
  assert.equal(
    trustedKeysOptIn({ platform: "darwin", env: { [TRUSTED_KEYS_ENV]: "1" } }),
    true,
  );
  assert.doesNotThrow(() =>
    assertTrustedKeysAllowed({
      platform: "darwin",
      env: { [TRUSTED_KEYS_ENV]: "1" },
    }),
  );
  for (const platform of ["linux", "win32"]) {
    assert.equal(
      trustedKeysOptIn({ platform, env: { [TRUSTED_KEYS_ENV]: "1" } }),
      false,
      `${platform} has no trusted keyboard channel even with the opt-in`,
    );
    assert.throws(() =>
      assertTrustedKeysAllowed({
        platform,
        env: { [TRUSTED_KEYS_ENV]: "1" },
      }),
    );
  }
});

test("only the exact value 1 opts in", () => {
  for (const value of ["0", "true", "yes", "", "on"]) {
    assert.equal(
      trustedKeysOptIn({
        platform: "darwin",
        env: { [TRUSTED_KEYS_ENV]: value },
      }),
      false,
      `value ${JSON.stringify(value)} must not opt in`,
    );
  }
});
