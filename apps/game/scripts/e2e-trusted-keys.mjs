/**
 * Input-mode policy for packaged E2E keyboard coverage (HPA-830).
 *
 * `sendTrustedKey` in `e2e-tauri/helpers.ts` activates the app and posts
 * system-wide HID keys via macOS System Events, which can steal focus and —
 * in a focus race — deliver keystrokes to another application. It is never
 * run implicitly: trusted keys require BOTH macOS and an explicit
 * `LYRA_E2E_TRUSTED_KEYS=1` environment opt-in. Without it every platform
 * uses the reduced fallback (JS click handlers plus a synthetic WebDriver
 * Tab that the dialog's JS cycling handles), which sends no OS-global input
 * and is CI-only coverage, not trusted proof.
 */

export const TRUSTED_KEYS_ENV = "LYRA_E2E_TRUSTED_KEYS";

export function trustedKeysOptIn({ platform, env }) {
  return platform === "darwin" && env?.[TRUSTED_KEYS_ENV] === "1";
}

export function assertTrustedKeysAllowed({ platform, env }) {
  if (platform !== "darwin") {
    throw new Error(
      `sendTrustedKey requires macOS System Events; ${platform} has no trusted keyboard channel in this repo and must use its documented reduced-coverage fallback`,
    );
  }
  if (env?.[TRUSTED_KEYS_ENV] !== "1") {
    throw new Error(
      `sendTrustedKey is opt-in: set ${TRUSTED_KEYS_ENV}=1 (macOS only, idle desktop required) or use the reduced fallback; refusing to send OS-global keys implicitly`,
    );
  }
}
