import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveE2eBinaryPath } from "../scripts/e2e-binary-path.mjs";
import {
  selectE2eAppProcessId,
  selectOwnedE2eAppProcessId,
} from "../scripts/e2e-trusted-key-process.mjs";
import {
  assertTrustedKeysAllowed,
  trustedKeysOptIn,
} from "../scripts/e2e-trusted-keys.mjs";
import {
  X11_TRUSTED_KEY_NAMES,
  assertTrustedXvfbKeysAllowed,
  assertX11AuthenticationEnforced,
  assertX11WindowOwnership,
  deliverXvfbTrustedKey,
  parseNetWmPid,
  parseXdotoolDecimal,
  selectUniqueX11WindowId,
  trustedXvfbKeysOptIn,
  verifyPrivateXvfbAncestry,
} from "../scripts/e2e-x11-trusted-input.mjs";
import {
  anchors,
  DIALOGUE_DRAIN_CAP,
  STORY_CLEARED_STORAGE_KEY,
} from "./production-anchors";
import {
  CASE_FILE_PREFERRED_VIEWPORT,
  caseFileViewportNativeSize,
  meetsCaseFileViewportTarget,
  validDevicePixelRatio,
  type CssViewportSize,
} from "../src/lib/e2e/case-file-viewport";
import type {
  AnalysisBoardView,
  GameStateView,
  PendingAcquisitionView,
} from "$lib/state/types";
import type { E2eCheckpointId } from "$lib/e2e/checkpoints";
import {
  drainPendingAcquisitionsWithinCap,
  soleMapDestinationId,
} from "$lib/e2e/pending-acquisition-drain";
import { publicPathForAssetId } from "@lyra/asset-paths";
import {
  gatedAcquisitionViolation,
  type CompositorGateExpectations,
} from "../src/lib/e2e/acquisition-compositor-gate";
import {
  cssRectToImageRegion,
  decodePng,
  expectPaintedRegion,
  regionPixelMetrics,
  type ImageRegion,
  type RegionPixelMetrics,
} from "../src/lib/e2e/screenshot-pixels";
import {
  probeScrollGeometryDom,
  scrollGeometrySettled,
  type ScrollGeometrySample,
} from "../src/lib/e2e/scroll-geometry";
import {
  probeImagePresenceDom,
  runImageEvidenceProof,
} from "../src/lib/e2e/image-evidence-proof";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const TRUSTED_MAC_KEY_CODES = { Enter: 36, Tab: 48 } as const;

export type TrustedMacKeyName = keyof typeof TRUSTED_MAC_KEY_CODES;

/**
 * True only when this run explicitly opted into trusted OS-global keys via
 * `LYRA_E2E_TRUSTED_KEYS=1` on macOS. Every suite must derive its input mode
 * from this and print the selected mode; the default on every platform is the
 * reduced fallback (JS clicks + synthetic Tab) that sends no global keys.
 */
export function e2eTrustedKeysEnabled(): boolean {
  return trustedKeysOptIn({ platform: process.platform, env: process.env });
}

/**
 * Resolve the unix PID of THIS WebDriver session's packaged e2e app process.
 */
export async function resolveE2eLyraProcessId(): Promise<number> {
  const { stdout } = await promisify(execFile)("ps", [
    "-axo",
    "pid=,ppid=,comm=",
  ]);
  return selectE2eAppProcessId({
    psOutput: stdout,
    expectedExecutablePath: resolveE2eBinaryPath(appRoot),
    currentPid: process.pid,
    currentPpid: process.ppid,
  });
}

/**
 * Deliver a real HID-level keyboard event to the packaged e2e app via
 * AppleScript System Events `key code`. WebDriver `browser.keys` arrives in
 * this stack as untrusted DOM events (isTrusted=false), so WebKit never runs
 * native default actions like focused-button Enter activation — System Events
 * keystrokes are the trusted channel on macOS.
 *
 * Opt-in guard: this is an explicit `LYRA_E2E_TRUSTED_KEYS=1` tool, never a
 * default path — invoking it without the opt-in (or off macOS) throws before
 * touching any process, so accidental calls fail closed.
 *
 * Safety guards: the target process is resolved from `ps` by the shared
 * selector (`scripts/e2e-trusted-key-process.mjs`) and must (a) be running
 * the EXACT configured e2e binary — the same `resolveE2eBinaryPath` value
 * `wdio.conf.ts` hands to tauri-service, so a dev binary, another checkout's
 * e2e app, or any path merely containing "target-e2e" never matches — and
 * (b) belong to THIS WebDriver session, meaning its parent is the WDIO
 * launcher (which onPrepare spawns the app from) or this worker (per-worker
 * spawn); if this worker is itself orphaned (launcher died, reparented to
 * launchd), the selector aborts before choosing any target. If the test app
 * exits, or only a look-alike/orphaned process
 * remains, the selector refuses and no key is sent; AppleScript targets the
 * resolved unix id, so a name match alone can never win. The app is then
 * activated and verified frontmost immediately before the keystroke, and the
 * frontmost check repeats after delivery so a focus race fails the test
 * loudly. These checks narrow the race window but cannot make wrong-app
 * delivery impossible (the pre-delivery check can be beaten and the
 * post-delivery check fires after the fact) — run packaged E2E on an idle
 * desktop.
 */
export async function sendTrustedKey(key: TrustedMacKeyName): Promise<void> {
  assertTrustedKeysAllowed({ platform: process.platform, env: process.env });
  const keyCode = TRUSTED_MAC_KEY_CODES[key];
  const pid = await resolveE2eLyraProcessId();
  const script = [
    'tell application "System Events"',
    `  set appProcess to first application process whose unix id is ${pid}`,
    "  set frontmost of appProcess to true",
    "  delay 0.3",
    `  if frontmost of appProcess is not true then error "lyra e2e app did not become frontmost; refusing to send trusted ${key}"`,
    `  key code ${keyCode}`,
    "  delay 0.2",
    `  if frontmost of appProcess is not true then error "frontmost application changed while delivering trusted ${key}; aborting"`,
    "end tell",
  ].join("\n");
  try {
    await promisify(execFile)("osascript", ["-e", script]);
  } catch (error) {
    const err = error as { message?: string; stderr?: string };
    const detail = [err.message, err.stderr]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(" | ");
    throw new Error(
      `trusted ${key} delivery to lyra pid ${pid} failed (System Events permission or process/window state); refusing to fake the journey with untrusted input — osascript: ${detail}`,
      { cause: error },
    );
  }
}

// --- HPA-831 scoped Linux/Xvfb trusted keyboard transport -----------------
//
// On the packaged Linux runner the embedded WebDriver reaches the app only
// as synthetic DOM KeyboardEvents (tauri-plugin-wdio-webdriver executor.rs
// dispatches keydown/keyup), so Tab/Enter can never run native focus
// traversal or trusted activation — run c0da417f showed six WebDriver Tabs
// leave focus on body. The narrow fix for the commission -> scene_2 focus
// segment is real XTEST keys via xdotool, gated as hard as the macOS path:
//
//   * explicit opt-in: linux AND LYRA_E2E_XVFB_TRUSTED_KEYS=1;
//   * a PRIVATE xvfb-run display owned by this run's ancestry — verified
//     from /proc, never inferred from a matching display number: xvfb-run
//     must be a strict ancestor of this worker, exactly one Xvfb child of
//     it must serve DISPLAY with a single matching `-auth` argument and
//     no `-ac`, and XAUTHORITY must name a securely permissioned
//     run-private authority file (an inherited env value alone proves no
//     cookie enforcement);
//   * PROOF that authority is enforced: the file must parse to at least
//     one usable cookie record for this display (an empty/malformed file
//     loads zero records and Xorg then accepts local clients), and two
//     bounded xdpyinfo probes must show an authorized connection
//     succeeding while an unauthenticated one is actively rejected — a
//     cookie file alone is not enforcement;
//   * the app process running the exact configured e2e binary
//     (/proc/<pid>/exe; `ps comm` on Linux is only a basename) and spawned
//     by this WDIO worker or launcher — the shared selector's exact rules;
//   * exactly one visible window whose _NET_WM_PID and getwindowpid both
//     equal that app pid;
//   * the X input focus on that verified window before and after each key.
//
// xdotool `key` (no --window) uses XTEST — the same channel hardware input
// takes — whereas `--window` would be XSendEvent, which WebKitGTK may
// distrust the same way it distrusts the embedded transport. Every check
// fails closed: any uncertainty throws, the segment reports inconclusive,
// and no key is ever sent to a shared or unverified display/window.
// External commands run through execFile with a timeout and argument
// arrays — no shell, no string interpolation.

export type TrustedX11KeyName = keyof typeof X11_TRUSTED_KEY_NAMES;

const X11_EXTERNAL_COMMAND_TIMEOUT_MS = 10_000;

type LinuxProcEntry = {
  pid: number;
  ppid: number;
  comm: string;
  argv: string[];
  exe: string | null;
};

/** fs.stat + content evidence for the run-private authority file,
 * evaluated by assertSecureAuthorityFile/assertUsableAuthorityCookies in
 * e2e-x11-trusted-input.mjs. `content` holds the Xauthority bytes — the
 * verifier never logs cookie data. */
type X11AuthorityFileEvidence = {
  isFile: boolean;
  mode: number;
  uid: number;
  dirIsDirectory: boolean;
  dirMode: number;
  dirUid: number;
  euid: number;
  content: Uint8Array;
};

/**
 * True only when this run explicitly opted into the scoped XTEST path via
 * `LYRA_E2E_XVFB_TRUSTED_KEYS=1` on Linux. Callers must still send through
 * sendXvfbTrustedKey, which re-verifies the private display, process, and
 * window ownership before every key.
 */
export function e2eXvfbTrustedKeysEnabled(): boolean {
  return trustedXvfbKeysOptIn({ platform: process.platform, env: process.env });
}

/** Bounded, shell-free external probe used for every xdotool/xprop/
 * xdpyinfo call; `env` lets the auth probes pin XAUTHORITY per attempt. */
async function execBounded(
  file: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const { stdout } = await promisify(execFile)(file, args, {
    timeout: X11_EXTERNAL_COMMAND_TIMEOUT_MS,
    env: options.env ?? process.env,
  });
  return stdout;
}

/**
 * The live Linux process table from /proc: pid/ppid from stat (parsed after
 * the final ')' so a comm containing parentheses cannot shift the fields),
 * argv from its NUL-separated file, and the kernel-resolved
 * executable target of /proc/<pid>/exe — the robust executable identity
 * `ps comm` cannot provide on Linux. Processes that exit mid-scan or deny
 * a read contribute only the fields that could be proven.
 */
function linuxProcessTable(): LinuxProcEntry[] {
  const entries: LinuxProcEntry[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      if (closeParen === -1) continue;
      const fields = stat
        .slice(closeParen + 1)
        .trim()
        .split(/\s+/);
      const ppid = Number(fields[1]);
      if (!Number.isInteger(ppid)) continue;
      const comm = readFileSync(`/proc/${name}/comm`, "utf8").trim();
      const argv = readFileSync(`/proc/${name}/cmdline`, "utf8")
        .split("\0")
        .filter((part) => part.length > 0);
      let exe: string | null = null;
      try {
        exe = readlinkSync(`/proc/${name}/exe`);
        if (exe.endsWith(" (deleted)")) {
          exe = exe.slice(0, -" (deleted)".length);
        }
      } catch {
        // Unreadable or exited — a null exe can never equal the configured
        // e2e binary path, so the entry fails closed on its own.
      }
      entries.push({ pid: Number(name), ppid, comm, argv, exe });
    } catch {
      // Process exited between readdir and the reads; skip it.
    }
  }
  return entries;
}

/**
 * fs.stat + content evidence for the run-private authority file xvfb-run
 * created for this display: a regular file owned by this user with no
 * group/other access, inside an equally private directory, whose bytes
 * parse to usable Xau cookie records — an Xauthority another principal
 * could read or replace, or one loading zero records, leaves the
 * "private" display forgeable or unenforced. An unreadable path is itself
 * unprovable privacy: throw, never guess. The bytes are evidence only —
 * cookie contents are never logged.
 */
function readAuthorityFileEvidence(
  xauthority: string,
): X11AuthorityFileEvidence {
  try {
    const fileStat = statSync(xauthority);
    const dirStat = statSync(path.dirname(xauthority));
    return {
      isFile: fileStat.isFile(),
      mode: fileStat.mode & 0o777,
      uid: fileStat.uid,
      dirIsDirectory: dirStat.isDirectory(),
      dirMode: dirStat.mode & 0o777,
      dirUid: dirStat.uid,
      euid: process.geteuid?.() ?? -1,
      content: readFileSync(xauthority),
    };
  } catch (error) {
    throw new Error(
      `cannot inspect run-private XAUTHORITY ${xauthority} — display privacy cannot be proven; refusing XTEST keys`,
      { cause: error },
    );
  }
}

/**
 * Resolve and fully verify the XTEST target for THIS key: the private
 * xvfb-run display owned by this run's ancestry, this session's exact e2e
 * app process, and the unique visible window it owns. Throws on any
 * uncertainty — the checks are re-run per key because the app, its window,
 * or the focus can change between keys.
 */
async function resolveXvfbTrustedTarget(): Promise<{
  appPid: number;
  windowId: number;
}> {
  assertTrustedXvfbKeysAllowed({
    platform: process.platform,
    env: process.env,
  });
  const processes = linuxProcessTable();
  const xauthority = process.env.XAUTHORITY;
  verifyPrivateXvfbAncestry({
    processes,
    currentPid: process.pid,
    display: process.env.DISPLAY,
    xauthority,
    authorityFile:
      typeof xauthority === "string" && xauthority.length > 0
        ? readAuthorityFileEvidence(xauthority)
        : undefined,
  });
  // The ancestry/-auth/cookie checks above prove the authority SHOULD be
  // in force; these two bounded xdpyinfo probes prove it IS — the
  // authorized connection succeeds, then an unauthenticated one is
  // actively rejected for a connection-level reason (never a timeout or
  // unrelated failure). An authority file Xorg ignores is not enforcement.
  await assertX11AuthenticationEnforced({
    display: process.env.DISPLAY,
    xauthority,
    probe: (probeXauthority: string) =>
      execBounded("xdpyinfo", [], {
        env: { ...process.env, XAUTHORITY: probeXauthority },
      }),
  });
  const appPid = selectOwnedE2eAppProcessId({
    entries: processes.flatMap((entry) =>
      entry.exe === null
        ? []
        : [
            {
              pid: entry.pid,
              ppid: entry.ppid,
              executablePath: entry.exe,
            },
          ],
    ),
    expectedExecutablePath: resolveE2eBinaryPath(appRoot),
    currentPid: process.pid,
    currentPpid: process.ppid,
  });
  const windowId = selectUniqueX11WindowId({
    searchOutput: await execBounded("xdotool", [
      "search",
      "--onlyvisible",
      "--pid",
      String(appPid),
    ]),
    appPid,
  });
  // `xdotool search --pid` already filters by _NET_WM_PID; confirm it (and
  // the independent getwindowpid answer) anyway so a stale or racing window
  // id can never be keyed.
  const netWmPid = parseNetWmPid(
    await execBounded("xprop", ["-id", String(windowId), "_NET_WM_PID"]),
  );
  const windowOwnerPid = parseXdotoolDecimal(
    await execBounded("xdotool", ["getwindowpid", String(windowId)]),
  );
  assertX11WindowOwnership({ windowId, netWmPid, windowOwnerPid, appPid });
  return { appPid, windowId };
}

/**
 * Deliver one real XTEST key (Tab/Enter) to the verified e2e window on the
 * private xvfb-run display. The preflight -> focus -> key -> post-focus
 * sequence is the shared `deliverXvfbTrustedKey` orchestration (the same
 * function the tests drive with fakes): resolveXvfbTrustedTarget runs all
 * private-display/process/window verification before any xdotool command,
 * `execBounded` provides the timeout-bounded shell-free calls, and the
 * focus-before/after checks fail inconclusive rather than keying an
 * unverified window.
 */
export async function sendXvfbTrustedKey(
  key: TrustedX11KeyName,
): Promise<void> {
  await deliverXvfbTrustedKey({
    key,
    resolveTarget: resolveXvfbTrustedTarget,
    run: (args: string[]) => execBounded("xdotool", args),
  });
}

type TauriInternals = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

type E2eCheckpointBrowserBridge = {
  loadCheckpoint: (id: E2eCheckpointId) => Promise<void>;
};

export type ObservedCssViewport = CssViewportSize & {
  devicePixelRatio: number;
};

export async function observedCssViewport(): Promise<ObservedCssViewport> {
  return browser.execute(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
}

/**
 * The macOS Tauri WDIO executor applies setWindowSize dimensions as physical
 * pixels. Measure the CSS viewport first, request a DPR-scaled native size,
 * then compensate for any platform window chrome before layout assertions.
 */
export async function ensureCaseFileViewport(): Promise<ObservedCssViewport> {
  let viewport = await observedCssViewport();
  let { width: requestedWidth, height: requestedHeight } =
    caseFileViewportNativeSize(viewport.devicePixelRatio);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await browser.setWindowSize(requestedWidth, requestedHeight);
    try {
      await browser.waitUntil(
        async () => {
          viewport = await observedCssViewport();
          return meetsCaseFileViewportTarget(viewport);
        },
        {
          timeout: 10000,
          interval: 100,
          timeoutMsg: "Case File viewport did not reach its CSS target.",
        },
      );
    } catch (error) {
      // The next iteration compensates for platform chrome from the observed
      // CSS shortfall rather than assuming a fixed title-bar size.
      console.log(
        `[CaseFileE2E] viewport attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (meetsCaseFileViewportTarget(viewport)) {
      console.log(
        `[CaseFileE2E] CSS viewport ${viewport.width}x${viewport.height} at DPR ${viewport.devicePixelRatio}`,
      );
      return viewport;
    }

    const devicePixelRatio = validDevicePixelRatio(viewport.devicePixelRatio);
    requestedWidth += Math.ceil(
      Math.max(0, CASE_FILE_PREFERRED_VIEWPORT.width - viewport.width) *
        devicePixelRatio,
    );
    requestedHeight += Math.ceil(
      Math.max(0, CASE_FILE_PREFERRED_VIEWPORT.height - viewport.height) *
        devicePixelRatio,
    );
  }

  throw new Error(
    `Case File viewport remained ${viewport.width}x${viewport.height} at DPR ${viewport.devicePixelRatio}.`,
  );
}

/** The game window's default and minimum size (tauri.conf.json). */
export const MINIMUM_WINDOW = { width: 800, height: 600 } as const;

/**
 * Shrinks the window to the game's real 800x600 minimum and waits for the CSS
 * viewport to settle exactly there (DPR-compensated, retrying against
 * window-manager clamps in either direction). Shared by the placement suites
 * and the HPA-705 evidence-tray geometry gate so there is only one resize
 * algorithm.
 */
export async function ensureMinimumWindowViewport(): Promise<void> {
  const matches = (viewport: { width: number; height: number }) =>
    viewport.width === MINIMUM_WINDOW.width &&
    viewport.height === MINIMUM_WINDOW.height;
  let viewport = await observedCssViewport();
  if (matches(viewport)) return;
  const requested = caseFileViewportNativeSize(
    viewport.devicePixelRatio,
    MINIMUM_WINDOW,
  );
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await browser.setWindowSize(requested.width, requested.height);
    try {
      await browser.waitUntil(
        async () => matches((viewport = await observedCssViewport())),
        {
          timeout: 10000,
          interval: 100,
          timeoutMsg: "viewport did not settle at the 800x600 minimum window",
        },
      );
    } catch (error) {
      // Keep the retry tolerance — a slow-clamping WM may need a corrected
      // request — but hang on to the failure for the final error instead of
      // dropping it.
      lastError = error;
    }
    if (matches(viewport)) return;
    const scale = validDevicePixelRatio(viewport.devicePixelRatio);
    // Signed correction: the WM can clamp a request in either direction, so
    // overshoots must shrink as well as shortfalls grow.
    requested.width += Math.ceil(
      (MINIMUM_WINDOW.width - viewport.width) * scale,
    );
    requested.height += Math.ceil(
      (MINIMUM_WINDOW.height - viewport.height) * scale,
    );
  }
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `viewport did not settle at the 800x600 minimum window (last observed ${viewport.width}x${viewport.height})`,
    { cause: detail === "null" ? undefined : detail },
  );
}

export type MockupCaptureResult = {
  requested: CssViewportSize;
  observed: ObservedCssViewport;
  screenshotPath: string;
  metadataPath: string;
  strict: boolean;
};

function assertNonEmptyArtifact(filePath: string): void {
  if (!existsSync(filePath) || statSync(filePath).size === 0) {
    throw new Error(`Mockup capture artifact is missing or empty: ${filePath}`);
  }
}

function meetsRequestedViewportTarget(
  viewport: CssViewportSize,
  requested: CssViewportSize,
): boolean {
  return (
    viewport.width >= requested.width && viewport.height >= requested.height
  );
}

/**
 * Requests a target CSS viewport for visual evidence while retaining the
 * observed dimensions when native window chrome or DPR prevents an exact fit.
 * Strict mode is deliberately checked only after both artifacts are written.
 */
export async function captureMockupViewport(input: {
  name: string;
  requested: CssViewportSize;
  outputDirectory: string;
}): Promise<MockupCaptureResult> {
  mkdirSync(input.outputDirectory, { recursive: true });

  let observed = await observedCssViewport();
  let { width: requestedWidth, height: requestedHeight } =
    caseFileViewportNativeSize(observed.devicePixelRatio, input.requested);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await browser.setWindowSize(requestedWidth, requestedHeight);
    try {
      await browser.waitUntil(
        async () => {
          observed = await observedCssViewport();
          return meetsRequestedViewportTarget(observed, input.requested);
        },
        {
          timeout: 10000,
          interval: 100,
          timeoutMsg: "Mockup capture viewport did not reach its CSS target.",
        },
      );
    } catch (error) {
      console.log(
        `[MockupE2E] viewport attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (meetsRequestedViewportTarget(observed, input.requested)) break;

    const devicePixelRatio = validDevicePixelRatio(observed.devicePixelRatio);
    requestedWidth += Math.ceil(
      Math.max(0, input.requested.width - observed.width) * devicePixelRatio,
    );
    requestedHeight += Math.ceil(
      Math.max(0, input.requested.height - observed.height) * devicePixelRatio,
    );
  }

  // Always take one final measurement after the compensation attempts. The
  // screenshot filename and sidecar must describe the viewport that was
  // actually captured, including when strict mode will reject its size.
  observed = await observedCssViewport();
  const strict = process.env.LYRA_E2E_REQUIRE_EXACT_CAPTURE_VIEWPORT === "1";
  const observedSuffix = `css-${observed.width}x${observed.height}`;
  const screenshotPath = path.join(
    input.outputDirectory,
    `${input.name}-${observedSuffix}.png`,
  );
  const metadataPath = screenshotPath.replace(/\.png$/, ".json");

  let hiddenCaptureProofProbe: { previousDisplay: string } | null = null;
  try {
    hiddenCaptureProofProbe = await browser.execute((probeSelector: string) => {
      const probe = document.querySelector<HTMLElement>(probeSelector);
      if (!probe) return null;
      const previousDisplay = probe.style.display;
      probe.style.display = "none";
      return { previousDisplay };
    }, anchors.captureProof.probe);
    await browser.saveScreenshot(screenshotPath);
  } finally {
    if (hiddenCaptureProofProbe) {
      await browser.execute(
        (probeSelector: string, previousDisplay: string) => {
          const probe = document.querySelector<HTMLElement>(probeSelector);
          if (probe) probe.style.display = previousDisplay;
        },
        anchors.captureProof.probe,
        hiddenCaptureProofProbe.previousDisplay,
      );
    }
  }
  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        requested: input.requested,
        observed: { width: observed.width, height: observed.height },
        devicePixelRatio: observed.devicePixelRatio,
        strict,
      },
      null,
      2,
    )}\n`,
  );
  assertNonEmptyArtifact(screenshotPath);
  assertNonEmptyArtifact(metadataPath);

  const result: MockupCaptureResult = {
    requested: input.requested,
    observed,
    screenshotPath,
    metadataPath,
    strict,
  };
  console.log(
    `[MockupE2E] ${input.name}: requested ${input.requested.width}x${input.requested.height}, observed ${observed.width}x${observed.height} at DPR ${observed.devicePixelRatio}; PNG=${screenshotPath}; JSON=${metadataPath}; strict=${strict}`,
  );

  if (
    strict &&
    (observed.width !== input.requested.width ||
      observed.height !== input.requested.height)
  ) {
    throw new Error(
      `Exact mockup capture viewport unavailable: requested ${input.requested.width}x${input.requested.height}, observed ${observed.width}x${observed.height}`,
    );
  }

  return result;
}

export async function invokePackagedCommand<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await browser.execute(
    async (
      selectedCommand: string,
      selectedArgs: Record<string, unknown>,
    ): Promise<
      { ok: true; value: unknown } | { ok: false; error: unknown }
    > => {
      const internals = (
        window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
      ).__TAURI_INTERNALS__;
      if (!internals) {
        return {
          ok: false,
          error: {
            code: "tauriUnavailable",
            message: "Tauri internals are unavailable.",
          },
        };
      }
      try {
        return {
          ok: true,
          value: await internals.invoke(selectedCommand, selectedArgs),
        };
      } catch (error) {
        return { ok: false, error };
      }
    },
    command,
    args,
  );
  if (!result.ok) {
    const payload = result.error;
    const message =
      payload !== null &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof (payload as { message: unknown }).message === "string"
        ? (payload as { message: string }).message
        : String(payload);
    throw new Error(message, { cause: payload });
  }
  return result.value as T;
}

const LIST_SAVES_PROBE_TIMEOUT_MS = 10_000;

type ListSavesProbeError = { probeError: string };

type ListSavesProbeSlot = {
  reference?: { type?: string; slot?: number };
};

type ListSavesManualSlotProbe =
  | ListSavesProbeSlot
  | ListSavesProbeError
  | { diagnosticError: string }
  | null;

function diagnosticErrorDetail(error: unknown): { diagnosticError: string } {
  return {
    diagnosticError: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Probe `list_saves` inside one page-side execute so a hung native invoke
 * cannot leave an uncancelled WebDriver command in flight. The page returns
 * either the matching manual slot or a timeout/error marker; callers capture
 * rendered DOM in a separate execute afterward.
 */
async function probeListSavesManualSlot(
  slot: number,
): Promise<ListSavesManualSlotProbe> {
  try {
    return await browser.execute(
      async (slotNumber: number, timeoutMs: number) => {
        const internals = (
          window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
        ).__TAURI_INTERNALS__;
        if (!internals) {
          return { probeError: "Tauri internals are unavailable." };
        }

        const invokePromise = internals
          .invoke("list_saves")
          .then((value) => {
            const slots = (
              value as { browser?: { slots?: ListSavesProbeSlot[] } }
            ).browser?.slots;
            return (
              slots?.find(
                (candidate) =>
                  candidate.reference?.type === "manual" &&
                  candidate.reference?.slot === slotNumber,
              ) ?? null
            );
          })
          .catch((error: unknown) => {
            const message =
              error !== null &&
              typeof error === "object" &&
              "message" in error &&
              typeof (error as { message: unknown }).message === "string"
                ? (error as { message: string }).message
                : String(error);
            return { probeError: message };
          });

        const timeoutPromise = new Promise<ListSavesProbeError>((resolve) => {
          setTimeout(
            () =>
              resolve({
                probeError: "list_saves probe did not settle within 10s",
              }),
            timeoutMs,
          );
        });

        return Promise.race([invokePromise, timeoutPromise]);
      },
      slot,
      LIST_SAVES_PROBE_TIMEOUT_MS,
    );
  } catch (error) {
    return diagnosticErrorDetail(error);
  }
}

export async function loadPackagedCheckpoint(
  id: E2eCheckpointId,
): Promise<void> {
  const selector = "[data-e2e-checkpoint-generation]";
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        return (
          (window as Window & { __lyraE2e?: E2eCheckpointBrowserBridge })
            .__lyraE2e !== undefined
        );
      }),
    {
      timeout: 30000,
      timeoutMsg: "packaged checkpoint frontend bridge did not initialize",
    },
  );
  const previousGeneration = await browser.execute((markerSelector: string) => {
    const marker = document.querySelector(markerSelector);
    return Number(marker?.getAttribute("data-e2e-checkpoint-generation") ?? 0);
  }, selector);
  const settlement = await browser.execute(async (selectedId) => {
    const bridge = (
      window as Window & { __lyraE2e?: E2eCheckpointBrowserBridge }
    ).__lyraE2e;
    if (!bridge) {
      return { ok: false as const, message: "bridge unavailable" };
    }
    try {
      await bridge.loadCheckpoint(selectedId);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : JSON.stringify(error),
      };
    }
  }, id);
  if (!settlement.ok) {
    throw new Error(`loadPackagedCheckpoint(${id}): ${settlement.message}`);
  }
  await browser.waitUntil(
    async () =>
      browser.execute(
        (markerSelector: string, prior: number) => {
          const marker = document.querySelector(markerSelector);
          const next = Number(
            marker?.getAttribute("data-e2e-checkpoint-generation") ?? 0,
          );
          return next > prior;
        },
        selector,
        previousGeneration,
      ),
    {
      timeout: 90000,
      timeoutMsg: `checkpoint ${id} did not publish a new rendered generation`,
    },
  );
}

export type PackagedCommandSettlement<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        failureToken?: string;
      };
    };

/**
 * Observes an expected command rejection without returning its rejected
 * object through WebDriver. Packaged WebKit turns a rejected Tauri object
 * into an execute/sync protocol failure (`[object Object]`) before the Node
 * caller can inspect it. Settle the invoke inside the page, copy only the
 * public GameError fields to a DOM attribute, then read that plain JSON in a
 * later synchronous probe.
 */
export async function settlePackagedCommand<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<PackagedCommandSettlement<T>> {
  const requestId = `${Date.now()}-${Math.random()}`;
  const attribute = "data-save-command-settlement";
  const started = await browser.execute(
    (
      selectedCommand: string,
      selectedArgs: Record<string, unknown>,
      settlementAttribute: string,
      settlementRequestId: string,
    ) => {
      const root = document.documentElement;
      root.removeAttribute(settlementAttribute);
      const internals = (
        window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
      ).__TAURI_INTERNALS__;
      const settle = (result: unknown) => {
        root.setAttribute(
          settlementAttribute,
          JSON.stringify({
            requestId: settlementRequestId,
            result,
          }),
        );
      };
      if (!internals) {
        settle({
          ok: false,
          error: {
            code: "tauriUnavailable",
            message: "Tauri internals are unavailable.",
          },
        });
        return true;
      }
      const reject = (error: unknown) => {
        const source =
          error !== null && typeof error === "object"
            ? (error as Record<string, unknown>)
            : {};
        settle({
          ok: false,
          error: {
            code:
              typeof source.code === "string"
                ? source.code
                : "unknownCommandError",
            message:
              typeof source.message === "string"
                ? source.message
                : String(error),
            ...(typeof source.failureToken === "string"
              ? { failureToken: source.failureToken }
              : {}),
          },
        });
      };
      try {
        void internals
          .invoke(selectedCommand, selectedArgs)
          .then((value) => settle({ ok: true, value }), reject);
      } catch (error) {
        reject(error);
      }
      return true;
    },
    command,
    args,
    attribute,
    requestId,
  );
  if (!started) throw new Error(`command ${command} could not be started`);

  await browser.pause(100);
  let settlement: PackagedCommandSettlement<T> | null = null;
  await browser.waitUntil(
    async () => {
      const serialized = await browser.execute(
        (settlementAttribute: string) =>
          document.documentElement.getAttribute(settlementAttribute),
        attribute,
      );
      if (!serialized) return false;
      const parsed = JSON.parse(serialized) as {
        requestId?: unknown;
        result?: PackagedCommandSettlement<T>;
      };
      if (parsed.requestId !== requestId || !parsed.result) return false;
      settlement = parsed.result;
      return true;
    },
    {
      timeout: 30000,
      interval: 250,
      timeoutMsg: `command ${command} did not settle`,
    },
  );
  await browser.execute(
    (settlementAttribute: string) =>
      document.documentElement.removeAttribute(settlementAttribute),
    attribute,
  );
  if (!settlement) throw new Error(`command ${command} settlement is missing`);
  return settlement;
}

export function assertSaveE2ePhase(
  expected: string | readonly string[],
): string {
  const phase = process.env.LYRA_SAVE_E2E_PHASE;
  const accepted = typeof expected === "string" ? [expected] : [...expected];
  if (!phase || !accepted.includes(phase)) {
    throw new Error(
      `Expected save e2e phase ${accepted.join(" or ")}, got ${String(phase)}.`,
    );
  }
  return phase;
}

export async function currentPackagedDocumentIdentity(): Promise<string> {
  return browser.execute(() => {
    const root = document.documentElement;
    const existing = root.dataset.saveDocumentIdentity;
    if (existing) return existing;
    const identity = `${performance.timeOrigin}:${crypto.randomUUID()}`;
    root.dataset.saveDocumentIdentity = identity;
    return identity;
  });
}

export function getPackagedGameState(): Promise<GameStateView> {
  return invokePackagedCommand<GameStateView>("get_state");
}

async function packagedGameplayCommandGeneration(): Promise<number> {
  return browser.execute(
    (probe: string) =>
      Number(
        document
          .querySelector(probe)
          ?.getAttribute("data-capture-proof-completed-generation") ?? "0",
      ),
    anchors.captureProof.probe,
  );
}

async function waitForPackagedGameplayCommandSettled(
  beforeGeneration: number,
  timeoutMsg: string,
): Promise<void> {
  const result = await browser.executeAsync(
    (
      probe: string,
      baselineGeneration: number,
      done: (result: {
        settled: boolean;
        generation: number;
        status: string | null;
      }) => void,
    ) => {
      const element = document.querySelector(probe);
      if (!element) {
        done({ settled: false, generation: 0, status: null });
        return;
      }
      let completed = false;
      const observer = new MutationObserver(() => settle());
      const finish = (outcome: {
        settled: boolean;
        generation: number;
        status: string | null;
      }) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        observer.disconnect();
        done(outcome);
      };
      const settle = () => {
        const generation = Number(
          element.getAttribute("data-capture-proof-completed-generation") ??
            "0",
        );
        const status = element.getAttribute(
          "data-capture-proof-command-status",
        );
        if (generation > baselineGeneration && status === "idle") {
          finish({ settled: true, generation, status });
        }
      };
      observer.observe(element, {
        attributes: true,
        attributeFilter: [
          "data-capture-proof-completed-generation",
          "data-capture-proof-command-status",
        ],
      });
      const timeout = setTimeout(() => {
        finish({
          settled: false,
          generation: Number(
            element.getAttribute("data-capture-proof-completed-generation") ??
              "0",
          ),
          status: element.getAttribute("data-capture-proof-command-status"),
        });
      }, 90000);
      settle();
    },
    anchors.captureProof.probe,
    beforeGeneration,
  );
  if (!result.settled) {
    throw new Error(
      `${timeoutMsg} (generation ${result.generation}, status ${String(result.status)})`,
    );
  }
}

async function waitForPackagedDomTransition(
  presentSelector: string,
  absentSelector: string,
  timeoutMsg: string,
): Promise<void> {
  // The embedded WebDriver holds WebKit's script executor for the full
  // duration of execute/async, which prevents Tauri invoke callbacks from
  // reaching the page. Leave one command-free window first, then keep the
  // synchronous probes sparse enough for the callback to settle between them.
  await browser.pause(500);
  await browser.waitUntil(
    async () =>
      browser.execute(
        (requiredSelector: string, removedSelector: string) =>
          Boolean(document.querySelector(requiredSelector)) &&
          !document.querySelector(removedSelector),
        presentSelector,
        absentSelector,
      ),
    {
      timeout: 90000,
      interval: 500,
      timeoutMsg,
    },
  );
}

export async function waitForPackagedGameState(
  predicate: (state: GameStateView) => boolean,
  timeout = 30000,
  timeoutMsg = "packaged game state did not reach the expected condition",
): Promise<GameStateView> {
  let last: GameStateView | null = null;
  await browser.waitUntil(
    async () => {
      try {
        last = await getPackagedGameState();
        return predicate(last);
      } catch {
        return false;
      }
    },
    { timeout, interval: 100, timeoutMsg },
  );
  if (!last) throw new Error(timeoutMsg);
  return last;
}

export function analysisBoard(
  state: GameStateView,
  id: string,
): AnalysisBoardView {
  if (state.scene.kind !== "analysis") {
    throw new Error(`expected Analysis scene, got ${state.scene.kind}`);
  }
  const board = state.scene.visibleBoards.find(
    (candidate) => candidate.id === id,
  );
  if (!board) throw new Error(`analysis board ${id} is not visible`);
  return board;
}

// B4 selected this one synthetic PointerEvent transport for packaged WebKit.
// Keep Classify and Order on this path; there is intentionally no W3C attempt
// or runtime/test fallback.
export async function dragAnalysisCardSynthetic(
  cardId: string,
  targetId: string,
): Promise<void> {
  let dispatched: boolean;
  try {
    dispatched = await browser.execute(
      (selectedCardId: string, selectedTargetId: string) => {
        const card = document.querySelector<HTMLElement>(
          `[data-analysis-card-id="${selectedCardId}"]`,
        );
        const target = document.querySelector<HTMLElement>(
          `[data-analysis-drop-target="${selectedTargetId}"]`,
        );
        if (!card || !target) return false;

        // Keep the synthetic destination inside the viewport so the production
        // elementsFromPoint() resolver sees the same target on every board.
        target.scrollIntoView({ block: "center", inline: "center" });

        const center = (element: HTMLElement) => {
          const rect = element.getBoundingClientRect();
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
        };
        const source = center(card);
        const destination = center(target);
        const pointerId = 621;
        const dispatch = (type: string, init: PointerEventInit) =>
          card.dispatchEvent(new PointerEvent(type, init));

        dispatch("pointerdown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: source.x,
          clientY: source.y,
        });
        dispatch("pointermove", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: -1,
          buttons: 1,
          clientX: destination.x,
          clientY: destination.y,
        });
        dispatch("pointerup", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 0,
          clientX: destination.x,
          clientY: destination.y,
        });
        return true;
      },
      cardId,
      targetId,
    );
  } catch (error) {
    throw new Error(
      `analysis drag dispatch failed for ${cardId} -> ${targetId}`,
      { cause: error },
    );
  }
  if (!dispatched) {
    throw new Error(`analysis drag hooks missing for ${cardId} -> ${targetId}`);
  }
}

export async function waitForAnalysisBoard(
  sceneId: string,
  boardId: string,
): Promise<GameStateView> {
  return waitForPackagedGameState(
    (state) =>
      state.scene.kind === "analysis" &&
      state.scene.id === sceneId &&
      state.mode.type === "analysis" &&
      state.mode.boardId === boardId,
    30000,
    `analysis board ${boardId} did not become active`,
  );
}

export async function waitForClassifyDraft(
  expectedGroupByCard: Record<string, string>,
): Promise<GameStateView> {
  try {
    return await waitForPackagedGameState((state) => {
      const board = analysisBoard(state, "evidence_packages");
      if (board.kind !== "classify" || board.draft.kind !== "classify") {
        return false;
      }
      const actual = board.draft.groupByCard;
      return (
        Object.keys(actual).length ===
          Object.keys(expectedGroupByCard).length &&
        Object.entries(expectedGroupByCard).every(
          ([cardId, groupId]) => actual[cardId] === groupId,
        )
      );
    });
  } catch (error) {
    throw new Error(
      `classify draft never matched ${JSON.stringify(expectedGroupByCard)}`,
      { cause: error },
    );
  }
}

export async function waitForButton(
  accessibleName: string,
  timeout = 15000,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((name: string) => {
        return Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).some(
          (button) =>
            !button.disabled &&
            (button.getAttribute("aria-label") === name ||
              (button.textContent ?? "").trim().includes(name)),
        );
      }, accessibleName),
    {
      timeout,
      interval: 100,
      timeoutMsg: `enabled button ${accessibleName} did not appear`,
    },
  );
}

export async function clickButton(accessibleName: string): Promise<void> {
  await waitForButton(accessibleName);
  const clicked = await browser.execute((name: string) => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (candidate) =>
        candidate.getAttribute("aria-label") === name ||
        (candidate.textContent ?? "").trim().includes(name),
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, accessibleName);
  if (!clicked) {
    throw new Error(`button ${accessibleName} was missing or disabled`);
  }
}

export async function clickDialogButton(
  heading: string,
  accessibleName: string,
): Promise<void> {
  await waitForDialog(heading);
  const clicked = await browser.execute(
    (expectedHeading: string, expectedName: string) => {
      const dialog = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).find(
        (candidate) =>
          (candidate.getAttribute("aria-label") ?? "").includes(
            expectedHeading,
          ) ||
          Array.from(candidate.querySelectorAll("h2")).some((title) =>
            (title.textContent ?? "").includes(expectedHeading),
          ),
      );
      const button = Array.from(
        dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find(
        (candidate) =>
          candidate.getAttribute("aria-label") === expectedName ||
          (candidate.textContent ?? "").trim() === expectedName,
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    heading,
    accessibleName,
  );
  if (!clicked) {
    throw new Error(
      `dialog ${heading} button ${accessibleName} was missing or disabled`,
    );
  }
}

export async function clickPersistenceBrowserButton(
  accessibleName: string,
): Promise<void> {
  await browser.waitUntil(
    async () => elementExists('[aria-label="存檔瀏覽器"]'),
    {
      timeout: 15000,
      interval: 100,
      timeoutMsg: "persistence browser did not appear",
    },
  );
  const clicked = await browser.execute((expectedName: string) => {
    const saveBrowser = document.querySelector('[aria-label="存檔瀏覽器"]');
    const button = Array.from(
      saveBrowser?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find(
      (candidate) =>
        candidate.getAttribute("aria-label") === expectedName ||
        (candidate.textContent ?? "").trim() === expectedName,
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, accessibleName);
  if (!clicked) {
    throw new Error(
      `persistence browser button ${accessibleName} was missing or disabled`,
    );
  }
}

export async function waitForDialog(
  heading: string,
  timeout = 15000,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedHeading: string) => {
        return Array.from(document.querySelectorAll('[role="dialog"]')).some(
          (dialog) =>
            (dialog.getAttribute("aria-label") ?? "").includes(
              expectedHeading,
            ) ||
            Array.from(dialog.querySelectorAll("h2")).some((title) =>
              (title.textContent ?? "").includes(expectedHeading),
            ),
        );
      }, heading),
    {
      timeout,
      interval: 100,
      timeoutMsg: `dialog ${heading} did not appear`,
    },
  );
}

export async function dialogText(heading: string): Promise<string> {
  return browser.execute((expectedHeading: string) => {
    const dialog = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).find(
      (candidate) =>
        (candidate.getAttribute("aria-label") ?? "").includes(
          expectedHeading,
        ) ||
        Array.from(candidate.querySelectorAll("h2")).some((title) =>
          (title.textContent ?? "").includes(expectedHeading),
        ),
    );
    return (dialog?.textContent ?? "").trim();
  }, heading);
}

export async function waitForNoDialog(
  heading: string,
  timeout = 15000,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedHeading: string) => {
        return !Array.from(document.querySelectorAll('[role="dialog"]')).some(
          (dialog) =>
            (dialog.getAttribute("aria-label") ?? "").includes(
              expectedHeading,
            ) ||
            Array.from(dialog.querySelectorAll("h2")).some((title) =>
              (title.textContent ?? "").includes(expectedHeading),
            ),
        );
      }, heading),
    {
      timeout,
      interval: 100,
      timeoutMsg: `dialog ${heading} remained open`,
    },
  );
}

export async function jumpToProductionScene(sceneId: string): Promise<void> {
  await openGameMenu();
  await clickButton(anchors.sceneSelect);
  await browser.waitUntil(
    async () => elementExists('[aria-label="場景跳轉"]'),
    {
      timeout: 15000,
      timeoutMsg: "scene navigation panel did not appear",
    },
  );
  const beforeGeneration = await packagedGameplayCommandGeneration();
  await clickButton(sceneId);
  await waitForPackagedGameplayCommandSettled(
    beforeGeneration,
    `scene ${sceneId} command did not settle`,
  );
  await waitForPackagedGameState(
    (state) => state.scene.id === sceneId,
    30000,
    `scene ${sceneId} did not become current`,
  );
}

/**
 * Scene Select jump that names the chapter too. Scene ids restart per
 * chapter (both chapters have scene_0 and investigation_scene_map_01), and
 * the panel only lists the expanded chapter's scenes, so expand the target
 * chapter first and click the scene inside its own list.
 */
export async function jumpToProductionChapterScene(
  chapterId: string,
  sceneId: string,
): Promise<void> {
  await openGameMenu();
  await clickButton(anchors.sceneSelect);
  await browser.waitUntil(
    async () => elementExists('[aria-label="場景跳轉"]'),
    {
      timeout: 15000,
      timeoutMsg: "scene navigation panel did not appear",
    },
  );
  const listId = `scene-list-${chapterId}`;
  if (!(await elementExists(`#${listId}`))) {
    const expanded = await browser.execute((controls: string) => {
      const header = document.querySelector<HTMLButtonElement>(
        `button[aria-controls="${controls}"]`,
      );
      if (!header) return false;
      header.click();
      return true;
    }, listId);
    if (!expanded) {
      throw new Error(`chapter ${chapterId} is missing from Scene Select`);
    }
    await browser.waitUntil(async () => elementExists(`#${listId}`), {
      timeout: 15000,
      timeoutMsg: `chapter ${chapterId} scene list did not expand`,
    });
  }
  const beforeGeneration = await packagedGameplayCommandGeneration();
  const clicked = await browser.execute(
    (list: string, id: string) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`#${list} button`),
      ).find((candidate) =>
        (candidate.querySelector("small")?.textContent ?? "")
          .trim()
          .endsWith(`· ${id}`),
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    listId,
    sceneId,
  );
  if (!clicked) {
    throw new Error(`scene ${chapterId}/${sceneId} was missing or disabled`);
  }
  await waitForPackagedGameplayCommandSettled(
    beforeGeneration,
    `scene ${chapterId}/${sceneId} command did not settle`,
  );
  await waitForPackagedGameState(
    (state) => state.chapter.id === chapterId && state.scene.id === sceneId,
    30000,
    `scene ${chapterId}/${sceneId} did not become current`,
  );
}

export async function saveManualSlot(
  slot: 1 | 2 | 3,
  displayName: string,
  overwrite = false,
): Promise<void> {
  await waitForPersistenceIdle();
  await openGameMenu();
  await clickButton(anchors.saveGame);
  try {
    await browser.waitUntil(
      async () => elementExists('[aria-label="存檔瀏覽器"]'),
      { timeout: 30000, timeoutMsg: "manual save browser did not appear" },
    );
  } catch (error) {
    const rendered = await browser.execute(() => ({
      bodyText: (document.body.textContent ?? "").trim().slice(-2000),
      dialogs: Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).map((dialog) => ({
        ariaLabel: dialog.getAttribute("aria-label"),
        headings: Array.from(dialog.querySelectorAll("h2")).map((heading) =>
          (heading.textContent ?? "").trim(),
        ),
        text: (dialog.textContent ?? "").trim().slice(0, 500),
      })),
      buttons: Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      )
        .map((button) => ({
          ariaLabel: button.getAttribute("aria-label"),
          text: (button.textContent ?? "").trim().slice(0, 120),
          disabled: button.disabled,
        }))
        .slice(-20),
    }));
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
  await clickButton(`選擇手動存檔 ${slot}`);
  await waitForDialog(anchors.nameSave);
  const value = await browser.execute((name: string) => {
    const input = document.querySelector<HTMLInputElement>("#manual-save-name");
    if (!input) return null;
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value;
  }, displayName);
  if (value !== displayName) throw new Error("manual save name input missing");
  await clickDialogButton(anchors.nameSave, anchors.continueName);
  if (overwrite) {
    await waitForDialog(`覆寫手動存檔 ${slot}`);
    await clickDialogButton(`覆寫手動存檔 ${slot}`, anchors.confirmOverwrite);
  }
  await waitForPersistenceLayersClosed(
    `manual slot ${slot} save flow did not close the persistence layers and game menu`,
  );
  // The name/confirmation layer replaces SaveBrowser before the async capture
  // and save have finished. The closed game menu above is therefore the
  // completion signal: performManualSave closes it only after persistence
  // succeeds. Reopen the browser so callers can inspect the refreshed card and
  // continue exercising load/delete/preview behavior in the same phase.
  await openGameMenu();
  await clickButton(anchors.saveGame);
  try {
    await browser.waitUntil(
      async () => elementExists('[aria-label="存檔瀏覽器"]'),
      {
        timeout: 90000,
        timeoutMsg: "refreshed manual save browser did not appear",
      },
    );
  } catch (error) {
    const nativeSlot = await probeListSavesManualSlot(slot);
    const rendered = await browser
      .execute(() => ({
        bodyText: (document.body.textContent ?? "").trim().slice(-2000),
        saveBrowserText:
          document.querySelector('[aria-label="存檔瀏覽器"]')?.textContent ??
          null,
        dialogs: Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"]'),
        ).map((dialog) => ({
          ariaLabel: dialog.getAttribute("aria-label"),
          headings: Array.from(dialog.querySelectorAll("h2")).map((heading) =>
            (heading.textContent ?? "").trim(),
          ),
          text: (dialog.textContent ?? "").trim().slice(0, 500),
        })),
        buttons: Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        )
          .map((button) => ({
            ariaLabel: button.getAttribute("aria-label"),
            text: (button.textContent ?? "").trim().slice(0, 120),
            disabled: button.disabled,
          }))
          .slice(-20),
      }))
      .catch(diagnosticErrorDetail);
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `native=${JSON.stringify(nativeSlot ?? null)}`,
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
  try {
    await browser.waitUntil(
      async () =>
        browser.execute(
          (slotNumber: number, expectedName: string) => {
            const card = document.querySelector(
              `article[data-slot-type="manual"][data-slot-number="${slotNumber}"]`,
            );
            return (card?.textContent ?? "").includes(expectedName);
          },
          slot,
          displayName,
        ),
      {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `manual slot ${slot} did not show ${displayName}`,
      },
    );
  } catch (error) {
    const nativeSlot = await probeListSavesManualSlot(slot);
    const rendered = await browser
      .execute(() => ({
        browserText:
          document.querySelector('[aria-label="存檔瀏覽器"]')?.textContent ??
          null,
        cards: Array.from(
          document.querySelectorAll<HTMLElement>(
            "article[data-slot-type][data-slot-number]",
          ),
        ).map((card) => ({
          type: card.dataset.slotType ?? null,
          slot: card.dataset.slotNumber ?? null,
          text: (card.textContent ?? "").trim(),
        })),
      }))
      .catch(diagnosticErrorDetail);
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `native=${JSON.stringify(nativeSlot ?? null)}`,
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

export async function waitForPersistenceLayersClosed(
  timeoutMsg = "persistence layers and game menu did not close",
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((gameMenuHeading: string) => {
        const saveBrowserOpen =
          document.querySelector('[aria-label="存檔瀏覽器"]') !== null;
        const gameMenuOpen = Array.from(
          document.querySelectorAll('[role="dialog"]'),
        ).some((dialog) =>
          Array.from(dialog.querySelectorAll("h2")).some((heading) =>
            (heading.textContent ?? "").includes(gameMenuHeading),
          ),
        );
        return !saveBrowserOpen && !gameMenuOpen;
      }, anchors.gameMenu),
    {
      timeout: 90000,
      interval: 100,
      timeoutMsg,
    },
  );
}

export async function closePersistenceBrowserToGameplay(): Promise<void> {
  await clickPersistenceBrowserButton("返回");
  await browser.waitUntil(
    async () => !(await elementExists('[aria-label="存檔瀏覽器"]')),
    { timeout: 15000, timeoutMsg: "persistence browser did not close" },
  );
  const menuOpen = await browser.execute((heading: string) => {
    return Array.from(document.querySelectorAll('[role="dialog"]')).some(
      (dialog) =>
        Array.from(dialog.querySelectorAll("h2")).some((title) =>
          (title.textContent ?? "").includes(heading),
        ),
    );
  }, anchors.gameMenu);
  if (menuOpen) await clickButton(anchors.continueInvestigation);
}

export function dialogueFingerprint(state: GameStateView): string {
  if (state.mode.type !== "dialogue") return "";
  return JSON.stringify(state.mode.current);
}

export async function drainCurrentDialogue(
  expectedMode: "explore" | "interrogation",
  cap = 200,
): Promise<GameStateView> {
  await advanceDialogueUntil(async () => {
    try {
      return (await getPackagedGameState()).mode.type === expectedMode;
    } catch {
      return false;
    }
  }, cap);
  return waitForPackagedGameState(
    (state) => state.mode.type === expectedMode,
    15000,
    `dialogue did not drain to ${expectedMode}`,
  );
}

export async function waitForAcquisitionOrdinal(
  ordinal: number,
): Promise<GameStateView> {
  return waitForPackagedGameState(
    (state) => state.pendingAcquisition?.ordinal === ordinal,
    30000,
    `acquisition ordinal ${ordinal} did not become current`,
  );
}

// --- HPA-831 Task 1: acquisition evidence-image diagnostics + compositor gate
//
// Two independent proofs per affected record while its popup is still open:
//   (A) SOURCE — `img.decode()` + canvas pixel sample of `img.evidence-image`
//       proves the served bytes decode to real pixels. Universal for every
//       evidence acquisition with a non-empty imageAssetId.
//   (B) COMPOSITED — decode the WDIO screenshot PNG in THIS Node process and
//       sample the painted `.acquisition-card .visual` region. Only runs for
//       the recordIds the journey opts into (the two HPA-831 records plus
//       the doorlock comparison) because a screenshot per popup is expensive.
//       Source success alone can never catch the WebKitGTK/Xvfb empty-frame
//       paint failure; the screenshot crop is the objective gate.

export type AcquisitionImageTiming =
  | { status: "unavailable" }
  | { status: "recorded"; entries: Array<{ duration: number }> };

export type AcquisitionImageCanvasMetrics =
  | {
      alphaPixels: number;
      distinctBuckets: number;
      luminanceMean: number;
      luminanceStdDev: number;
      minLuminance: number;
      maxLuminance: number;
    }
  | { error: string };

export type AcquisitionImageInspection = {
  preDecode: {
    complete: boolean;
    currentSrc: string;
    naturalWidth: number;
    naturalHeight: number;
  };
  resourceTiming: AcquisitionImageTiming;
  decode: { ok: true; decodeMs: number } | { ok: false; error: string };
  postDecode: {
    complete: boolean;
    currentSrc: string;
    naturalWidth: number;
    naturalHeight: number;
  };
  canvas: AcquisitionImageCanvasMetrics;
};

export type AcquisitionCompositorGate = {
  /** recordId -> the authored imageAssetId its popup must report —
   * scoped by record (not by whatever imageAssetId the pending view
   * happens to carry) so a null or wrong asset id fails loudly instead
   * of silently skipping the screenshot proof. */
  expectedAssetIds: CompositorGateExpectations;
  outputDirectory: string;
  /** recordId -> crop screenshot path, recorded only AFTER a crop proof
   * passes — a thrown proof must never count as coverage. */
  receipts: Map<string, string>;
};

let acquisitionCompositorGate: AcquisitionCompositorGate | null = null;

/** Arms (or disarms with null) the expensive compositor crop check. The
 * journey scopes it to the affected acquisitions and always clears it in
 * `finally` so unrelated popups keep the cheap source-only path. */
export function setAcquisitionCompositorGate(
  gate: {
    expectedAssetIds: CompositorGateExpectations;
    outputDirectory: string;
  } | null,
): void {
  acquisitionCompositorGate =
    gate === null ? null : { ...gate, receipts: new Map() };
}

/** recordId -> crop screenshot path for every gated record whose
 * compositor proof already passed under the armed gate. */
export function acquisitionCompositorReceipts(): ReadonlyMap<string, string> {
  return new Map(acquisitionCompositorGate?.receipts ?? []);
}

type CssRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ScreenshotRegionPaintResult = {
  screenshotPath: string;
  metricsPath: string;
  cssRect: CssRectLike;
  /** Nearest y-scrollable ancestor's CSS rect (`null` when the element is
   * not inside a scrollport) — the crop is intersected with it because the
   * scrollport clips those pixels away; sampling them would read unrelated
   * painted content, not the image. */
  scrollportRect: CssRectLike | null;
  /** cssRect ∩ scrollportRect ∩ viewport — the only pixels actually painted
   * for the element; the crop is taken from this, never the raw DOM rect. */
  visibleCssRect: CssRectLike;
  cssViewport: { width: number; height: number };
  devicePixelRatio: number;
  /** Actual screenshotSize ÷ cssViewportSize on each axis — recorded so a
   * non-1x device scale can never silently corrupt the crop mapping. */
  screenshotScale: { x: number; y: number };
  pngSize: { width: number; height: number };
  region: ImageRegion;
  metrics: RegionPixelMetrics;
};

function intersectCssRects(a: CssRectLike, b: CssRectLike): CssRectLike {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * The shared compositor proof: save a WDIO screenshot, decode the PNG in the
 * Node test process, map `selector`'s CSS rect into image pixels by the real
 * scale ratio, and assert the cropped region has distinguishable,
 * non-single-color content. The screenshot and its metrics JSON are written
 * BEFORE the assertion so a failing paint keeps its evidence on disk.
 * Callers pass the painted element: `.acquisition-card .visual` for the
 * popup, `img.case-file-record-image` for Case File.
 *
 * `scrollIntoView` is for elements inside a scrollable container (the Case
 * File submenu's `.game-menu-extra` at 800x600): the element is scrolled
 * into view, its rect is re-read until stable, and the crop is intersected
 * with the nearest scrollport's rect — the only painted image area — so a
 * below-the-fold record can't sample clipped-away or unrelated pixels.
 */
export async function assertScreenshotRegionPainted(input: {
  selector: string;
  label: string;
  screenshotPath: string;
  /** CSS px to shave off each side (skips 1px borders + AA fringe). */
  insetCssPx?: number;
  /** Scroll the element into view and intersect the crop with its nearest
   * y-scrollable ancestor. Required for elements inside a scrollport. */
  scrollIntoView?: boolean;
}): Promise<ScreenshotRegionPaintResult> {
  // The serialized page script lives in src/lib/e2e/scroll-geometry.ts so
  // the identical function WebDriver serializes is exercised by vitest.
  const readTarget = () =>
    browser.execute(
      probeScrollGeometryDom,
      input.selector,
      input.scrollIntoView === true,
    );

  let target = await readTarget();
  if (!target) {
    throw new Error(
      `${input.label}: element ${input.selector} is not mounted for the screenshot crop`,
    );
  }
  if (target.rect.width <= 0 || target.rect.height <= 0) {
    throw new Error(
      `${input.label}: ${input.selector} has an empty rect ${JSON.stringify(target.rect)}`,
    );
  }
  if (input.scrollIntoView === true) {
    // scrollIntoView scrolls every clipped ancestor synchronously, but the
    // layout can settle over a frame or two — re-read until two consecutive
    // samples agree so the crop maps the painted pixels, not a mid-scroll
    // frame. A still-moving element when the bounded wait expires is NOT a
    // usable anchor: fail with the geometry trail instead of cropping
    // whatever the last rectangle happened to cover.
    const samples: ScrollGeometrySample[] = [
      { rect: target.rect, scrollport: target.scrollport },
    ];
    let settled = false;
    for (let attempt = 0; attempt < 6 && !settled; attempt += 1) {
      await browser.pause(150);
      const next = await readTarget();
      if (!next) {
        throw new Error(
          `${input.label}: element ${input.selector} unmounted while scrolling into view`,
        );
      }
      target = next;
      samples.push({ rect: next.rect, scrollport: next.scrollport });
      settled = scrollGeometrySettled(samples);
    }
    if (!settled) {
      throw new Error(
        `${input.label}: ${input.selector} geometry never stabilized during ` +
          `the scroll-into-view wait — a still-moving rect cannot anchor ` +
          `the screenshot crop (samples: ${JSON.stringify(samples)})`,
      );
    }
  }
  const viewportRect: CssRectLike = {
    left: 0,
    top: 0,
    width: target.viewport.width,
    height: target.viewport.height,
  };
  const visibleCssRect = intersectCssRects(
    intersectCssRects(target.rect, target.scrollport ?? viewportRect),
    viewportRect,
  );
  if (visibleCssRect.width <= 0 || visibleCssRect.height <= 0) {
    throw new Error(
      `${input.label}: ${input.selector} has no painted area inside its ` +
        `scrollport/viewport (rect=${JSON.stringify(target.rect)}, ` +
        `scrollport=${JSON.stringify(target.scrollport)}, ` +
        `viewport=${JSON.stringify(target.viewport)})`,
    );
  }
  mkdirSync(path.dirname(input.screenshotPath), { recursive: true });
  await browser.saveScreenshot(input.screenshotPath);
  const png = decodePng(readFileSync(input.screenshotPath));
  const screenshotScale = {
    x: png.width / target.viewport.width,
    y: png.height / target.viewport.height,
  };
  const region = cssRectToImageRegion(
    visibleCssRect,
    target.viewport,
    { width: png.width, height: png.height },
    input.insetCssPx ?? 0,
  );
  const metrics = regionPixelMetrics(png, region);
  const metricsPath = input.screenshotPath.replace(/\.png$/, ".json");
  writeFileSync(
    metricsPath,
    `${JSON.stringify(
      {
        label: input.label,
        selector: input.selector,
        cssRect: target.rect,
        scrollportRect: target.scrollport,
        visibleCssRect,
        cssViewport: target.viewport,
        devicePixelRatio: target.devicePixelRatio,
        screenshotScale,
        pngSize: { width: png.width, height: png.height },
        region,
        metrics,
        screenshotPath: input.screenshotPath,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `[ScreenshotCrop] ${input.label}: cssRect=${JSON.stringify(target.rect)} scrollport=${JSON.stringify(target.scrollport)} visible=${JSON.stringify(visibleCssRect)} viewport=${target.viewport.width}x${target.viewport.height} dpr=${target.devicePixelRatio} png=${png.width}x${png.height} scale=${screenshotScale.x.toFixed(3)}x${screenshotScale.y.toFixed(3)} region=${JSON.stringify(region)} buckets=${metrics.distinctBuckets} lumMean=${metrics.luminanceMean.toFixed(1)} lumStd=${metrics.luminanceStdDev.toFixed(2)} dominant=${metrics.dominantBucketShare.toFixed(3)} png=${input.screenshotPath}`,
  );
  expectPaintedRegion(metrics, input.label);
  return {
    screenshotPath: input.screenshotPath,
    metricsPath,
    cssRect: target.rect,
    scrollportRect: target.scrollport,
    visibleCssRect,
    cssViewport: target.viewport,
    devicePixelRatio: target.devicePixelRatio,
    screenshotScale,
    pngSize: { width: png.width, height: png.height },
    region,
    metrics,
  };
}

export type ImageElementInspection = {
  mountWaitMs: number;
  inspection: AcquisitionImageInspection;
};

/**
 * The shared source-image proof (plan B.4): wait for the image matching
 * `expectedPathFragment` under `selector`, then inspect it — pre-decode
 * `complete`/`currentSrc`, resource-timing entries (absence is reported as
 * `unavailable`, never fatal), `img.decode()`, post-decode dimensions and a
 * capture-proof-style canvas pixel sample. Used by the acquisition popup
 * (`.acquisition-card img.evidence-image`) and Case File
 * (`img.case-file-record-image`).
 */
export async function inspectImageElement(input: {
  selector: string;
  expectedPathFragment: string;
  label: string;
  timeoutMs?: number;
}): Promise<ImageElementInspection> {
  const mountStart = Date.now();
  await browser.waitUntil(
    async () =>
      browser.execute(
        (sel: string, pathFragment: string) => {
          return Array.from(
            document.querySelectorAll<HTMLImageElement>(sel),
          ).some((image) =>
            (image.currentSrc || image.src).includes(pathFragment),
          );
        },
        input.selector,
        input.expectedPathFragment,
      ),
    {
      timeout: input.timeoutMs ?? 30000,
      interval: 100,
      timeoutMsg: `${input.label}: image ${input.selector} for ${input.expectedPathFragment} did not mount`,
    },
  );
  const mountWaitMs = Date.now() - mountStart;

  const inspection = await browser.executeAsync<
    AcquisitionImageInspection | { error: string },
    [string, string]
  >(
    async (
      sel: string,
      pathFragment: string,
      done: (result: AcquisitionImageInspection | { error: string }) => void,
    ) => {
      const image = Array.from(
        document.querySelectorAll<HTMLImageElement>(sel),
      ).find((candidate) =>
        (candidate.currentSrc || candidate.src).includes(pathFragment),
      );
      if (!image) {
        done({
          error: `image ${sel} for ${pathFragment} unmounted before inspection`,
        });
        return;
      }
      const currentSrc = image.currentSrc || image.src;
      let resourceTiming: AcquisitionImageTiming;
      try {
        const entries = performance.getEntriesByName(currentSrc);
        resourceTiming =
          entries.length === 0
            ? { status: "unavailable" }
            : {
                status: "recorded",
                entries: entries.map((entry) => ({
                  duration: Math.round(entry.duration),
                })),
              };
      } catch {
        resourceTiming = { status: "unavailable" };
      }
      const preDecode = {
        complete: image.complete,
        currentSrc,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
      let decode: AcquisitionImageInspection["decode"];
      const decodeStart = performance.now();
      try {
        await Promise.race([
          image.decode(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("img.decode() timed out")),
              30000,
            ),
          ),
        ]);
        decode = {
          ok: true,
          decodeMs: Math.round(performance.now() - decodeStart),
        };
      } catch (error) {
        decode = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const postDecode = {
        complete: image.complete,
        currentSrc: image.currentSrc || image.src,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
      let canvas: AcquisitionImageCanvasMetrics;
      try {
        const surface = document.createElement("canvas");
        surface.width = image.naturalWidth;
        surface.height = image.naturalHeight;
        const context = surface.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("canvas 2d context unavailable");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          surface.width,
          surface.height,
        ).data;
        let alphaPixels = 0;
        for (let offset = 3; offset < pixels.length; offset += 4) {
          if ((pixels[offset] ?? 0) > 0) alphaPixels += 1;
        }
        const buckets = new Set<number>();
        let sampleCount = 0;
        let lumSum = 0;
        let lumSq = 0;
        let lumMin = 0;
        let lumMax = 0;
        // Every 64th byte = every 16th pixel, the capture-proof sample stride.
        for (let offset = 0; offset < pixels.length; offset += 64) {
          const r = pixels[offset] ?? 0;
          const g = pixels[offset + 1] ?? 0;
          const b = pixels[offset + 2] ?? 0;
          buckets.add(((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5));
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          sampleCount += 1;
          lumSum += lum;
          lumSq += lum * lum;
          if (sampleCount === 1 || lum < lumMin) lumMin = lum;
          if (lum > lumMax) lumMax = lum;
        }
        const mean = sampleCount === 0 ? 0 : lumSum / sampleCount;
        const variance =
          sampleCount === 0 ? 0 : lumSq / sampleCount - mean * mean;
        canvas = {
          alphaPixels,
          distinctBuckets: buckets.size,
          luminanceMean: mean,
          luminanceStdDev: Math.sqrt(Math.max(0, variance)),
          minLuminance: lumMin,
          maxLuminance: lumMax,
        };
      } catch (error) {
        canvas = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
      done({ preDecode, resourceTiming, decode, postDecode, canvas });
    },
    input.selector,
    input.expectedPathFragment,
  );

  if ("error" in inspection) {
    throw new Error(`${input.label}: ${inspection.error}`);
  }
  return { mountWaitMs, inspection };
}

/** One-line diagnostics for an inspected image — every log carries the full
 * timing source, so the affected records can be compared in the run log. */
export function formatImageInspection(
  label: string,
  mountWaitMs: number,
  inspection: AcquisitionImageInspection,
): string {
  const timing =
    inspection.resourceTiming.status === "unavailable"
      ? "unavailable"
      : `entries=${JSON.stringify(inspection.resourceTiming.entries.map((entry) => entry.duration))}ms`;
  return (
    `${label} mountWait=${mountWaitMs}ms ` +
    `preDecode={complete:${inspection.preDecode.complete},natural:${inspection.preDecode.naturalWidth}x${inspection.preDecode.naturalHeight}} ` +
    `timing=${timing} ` +
    (inspection.decode.ok
      ? `decode=${inspection.decode.decodeMs}ms`
      : `decodeError=${inspection.decode.error}`) +
    ` postDecode={complete:${inspection.postDecode.complete},natural:${inspection.postDecode.naturalWidth}x${inspection.postDecode.naturalHeight}} ` +
    `src=${inspection.postDecode.currentSrc} ` +
    ("error" in inspection.canvas
      ? `canvasError=${inspection.canvas.error}`
      : `canvas={alphaPx:${inspection.canvas.alphaPixels},buckets:${inspection.canvas.distinctBuckets},lumMean:${inspection.canvas.luminanceMean.toFixed(1)},lumStd:${inspection.canvas.luminanceStdDev.toFixed(2)},lumRange:${inspection.canvas.minLuminance.toFixed(0)}-${inspection.canvas.maxLuminance.toFixed(0)}}`)
  );
}

/**
 * The shared source asserts (plan A.3 / B): decode succeeded, `complete` held
 * after decode, natural dimensions are non-zero, the src is NOT the SVG
 * missing-asset placeholder, and the canvas sample proves the source carries
 * real non-single-color pixels — without any universal brightness threshold
 * (a legitimately dark evidence image must not fail).
 */
export function assertInspectedImage(
  inspection: AcquisitionImageInspection,
  label: string,
): void {
  if (!inspection.decode.ok) {
    throw new Error(
      `${label}: img.decode() rejected — ${inspection.decode.error}`,
    );
  }
  if (!inspection.postDecode.complete) {
    throw new Error(`${label}: img.complete is still false after decode()`);
  }
  if (
    inspection.postDecode.naturalWidth <= 0 ||
    inspection.postDecode.naturalHeight <= 0
  ) {
    throw new Error(
      `${label}: decoded image has no dimensions (${inspection.postDecode.naturalWidth}x${inspection.postDecode.naturalHeight})`,
    );
  }
  if (inspection.postDecode.currentSrc.startsWith("data:image/svg")) {
    throw new Error(
      `${label}: img resolved to the SVG missing-asset placeholder (${inspection.postDecode.currentSrc.slice(0, 120)})`,
    );
  }
  if ("error" in inspection.canvas) {
    throw new Error(
      `${label}: source canvas sample failed — ${inspection.canvas.error}`,
    );
  }
  if (
    inspection.canvas.alphaPixels === 0 ||
    inspection.canvas.distinctBuckets < 4
  ) {
    throw new Error(
      `${label}: decoded source has no real pixels (alphaPixels=${inspection.canvas.alphaPixels}, distinctBuckets=${inspection.canvas.distinctBuckets}, luminanceStdDev=${inspection.canvas.luminanceStdDev.toFixed(2)})`,
    );
  }
}

/**
 * Failure evidence for the HPA-831 image proofs (round-4 review finding):
 * mount, decode, placeholder, source-canvas, and wrong/null-asset failures
 * all throw BEFORE the gated screenshot, which would lose the exact frame
 * the plan requires preserved. While the 800x600 window is still up, save a
 * full viewport screenshot (raw — the missing image is often the failure
 * itself, so nothing depends on its geometry) plus a structured
 * diagnostics JSON with whatever inspection state was collected, then let
 * the original error propagate. Never throws: every capture step is
 * guarded so failure evidence can never hide the real failure.
 */
export async function captureImageFailureDiagnostics(input: {
  label: string;
  /** Selector probed for presence/state diagnostics only. */
  selector: string;
  screenshotPath: string;
  error: unknown;
  diagnostics?: Record<string, unknown>;
}): Promise<void> {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error);
  // The serialized page script lives in
  // src/lib/e2e/image-evidence-proof.ts so vitest exercises the identical
  // function WebDriver serializes.
  let imageProbe: unknown;
  try {
    imageProbe = await browser.execute(probeImagePresenceDom, input.selector);
  } catch (probeError) {
    imageProbe = {
      probeError:
        probeError instanceof Error ? probeError.message : String(probeError),
    };
  }
  try {
    mkdirSync(path.dirname(input.screenshotPath), { recursive: true });
    await browser.saveScreenshot(input.screenshotPath);
  } catch (screenshotError) {
    console.error(
      `[ImageFailure] ${input.label}: viewport screenshot capture failed:`,
      screenshotError,
    );
  }
  const diagnosticsPath = input.screenshotPath.replace(/\.png$/, ".json");
  try {
    writeFileSync(
      diagnosticsPath,
      `${JSON.stringify(
        {
          label: input.label,
          error: message,
          selector: input.selector,
          image: imageProbe ?? null,
          screenshotPath: input.screenshotPath,
          diagnostics: input.diagnostics ?? null,
        },
        null,
        2,
      )}\n`,
    );
  } catch (writeError) {
    console.error(
      `[ImageFailure] ${input.label}: diagnostics write failed:`,
      writeError,
    );
  }
  console.log(
    `[ImageFailure] ${input.label}: ${message} — viewport screenshot ` +
      `${input.screenshotPath}; diagnostics ${diagnosticsPath}`,
  );
}

/**
 * (A) Source proof for one evidence acquisition whose popup is still open,
 * then (B) the gated compositor crop when the journey armed this recordId.
 * Everything runs BEFORE the popup's CONTINUE click so the screenshot
 * catches the visible popup. The sequencing lives in
 * src/lib/e2e/image-evidence-proof.ts so vitest exercises the identical
 * orchestration: a scoped record's mount/source/identity failure saves the
 * required failure evidence before the journey restores the viewport, and
 * a thrown crop can never produce a compositor receipt.
 */
async function verifyAcquisitionEvidenceImage(
  current: Pick<PendingAcquisitionView, "id" | "recordId" | "title"> & {
    imageAssetId: string;
  },
): Promise<void> {
  const imageAssetId = current.imageAssetId;
  const expectedPath = publicPathForAssetId(imageAssetId, "evidence");
  const label = `acquisition ${current.id} (${imageAssetId})`;
  const gate = acquisitionCompositorGate;
  // (B) Composited-paint proof, scoped by recordId: the gate keys on the
  // record, and the asset mapping was already asserted by the caller, so
  // a gated record can never quietly skip its crop.
  const scoped = gate?.expectedAssetIds.has(current.recordId) === true;
  const safeName = imageAssetId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const screenshotPath =
    gate === null
      ? ""
      : path.join(gate.outputDirectory, `acquisition-${safeName}-popup.png`);
  await runImageEvidenceProof({
    inspect: () =>
      inspectImageElement({
        selector: ".acquisition-card img.evidence-image",
        expectedPathFragment: expectedPath,
        label,
      }),
    report: ({ mountWaitMs, inspection }) =>
      console.log(
        `[AcquisitionImage] ${imageAssetId} record=${current.id} title="${current.title}" ` +
          formatImageInspection(label, mountWaitMs, inspection),
      ),
    assert: ({ inspection }) => assertInspectedImage(inspection, label),
    provePainted: scoped
      ? async () => {
          await assertScreenshotRegionPainted({
            selector: ".acquisition-card .visual",
            label: `acquisition popup ${imageAssetId} (${current.id})`,
            screenshotPath,
            insetCssPx: 2,
          });
        }
      : undefined,
    // The receipt lands only after a passing crop — a thrown proof must
    // never count this record as covered.
    onReceipt: scoped
      ? () => {
          gate?.receipts.set(current.recordId, screenshotPath);
        }
      : undefined,
    captureFailure: async ({ error, inspection }) => {
      // Failure evidence is required for the records this ticket scopes;
      // ungated records keep the plain error path.
      if (!scoped || gate === null) return;
      await captureImageFailureDiagnostics({
        label,
        selector: ".acquisition-card img.evidence-image",
        screenshotPath: path.join(
          gate.outputDirectory,
          `acquisition-${safeName}-failure.png`,
        ),
        error,
        diagnostics: {
          recordId: current.recordId,
          imageAssetId,
          inspection,
        },
      });
    },
  });
}

export async function startAcquisitionAcknowledgement(
  current: Pick<
    PendingAcquisitionView,
    "id" | "recordId" | "title" | "recordKind" | "imageAssetId"
  >,
): Promise<void> {
  await waitForButton("CONTINUE", 90000);
  const currentCardMatches = await browser.execute((currentTitle: string) => {
    const card = document.querySelector(".acquisition-card");
    return (
      (card?.querySelector(".item-title")?.textContent ?? "").trim() ===
      currentTitle
    );
  }, current.title);
  if (!currentCardMatches) {
    throw new Error(
      `acquisition ${current.id} was not the current DOM notification`,
    );
  }
  // HPA-831: a recordId the armed compositor gate scoped must carry its
  // authored imageAssetId — a null or wrong id fails here instead of
  // silently skipping the crop proof; ungated records (including
  // legitimate null-asset ones) stay exempt.
  const gateViolation = gatedAcquisitionViolation(
    acquisitionCompositorGate?.expectedAssetIds ?? null,
    current,
  );
  if (gateViolation !== null) {
    // A wrong/null assetId on a gated record is the same required-failure
    // evidence case as a mount/source failure — save the 800x600 frame and
    // structured diagnostics before the viewport restore, then throw.
    if (acquisitionCompositorGate !== null) {
      const safeId = current.recordId.replace(/[^a-zA-Z0-9_-]/g, "_");
      await captureImageFailureDiagnostics({
        label: `acquisition ${current.id} (imageAssetId ${String(current.imageAssetId)})`,
        selector: ".acquisition-card img.evidence-image",
        screenshotPath: path.join(
          acquisitionCompositorGate.outputDirectory,
          `acquisition-${safeId}-identity-failure.png`,
        ),
        error: new Error(gateViolation),
        diagnostics: {
          recordId: current.recordId,
          imageAssetId: current.imageAssetId,
          recordKind: current.recordKind,
          title: current.title,
        },
      });
    }
    throw new Error(gateViolation);
  }
  // HPA-831: evidence popups carrying a real image asset get the source
  // decode/canvas proof (and the gated screenshot-crop proof) while the popup
  // is still visible — statements and null-asset evidence keep the fast path.
  if (current.recordKind === "evidence" && current.imageAssetId) {
    await verifyAcquisitionEvidenceImage({
      id: current.id,
      recordId: current.recordId,
      title: current.title,
      imageAssetId: current.imageAssetId,
    });
  }
  await clickButton("CONTINUE");
}

export async function waitForAcquisitionDomSettlement(
  current: Pick<PendingAcquisitionView, "id" | "title">,
): Promise<void> {
  // Never invoke get_state until the owning acknowledgement command has
  // updated or removed the keyed popup. A concurrent Tauri invoke can occupy
  // the WebView response path needed to settle the Svelte command.
  await browser.waitUntil(
    async () =>
      browser.execute((currentTitle: string) => {
        const card = document.querySelector(".acquisition-card");
        if (!card) return true;
        const nextTitle = (
          card.querySelector(".item-title")?.textContent ?? ""
        ).trim();
        const continueButton = Array.from(
          card.querySelectorAll<HTMLButtonElement>("button"),
        ).find((button) =>
          (button.textContent ?? "").trim().includes("CONTINUE"),
        );
        return nextTitle !== currentTitle && continueButton?.disabled === false;
      }, current.title),
    {
      timeout: 90000,
      interval: 100,
      timeoutMsg: `acquisition ${current.id} popup did not settle`,
    },
  );
}

export async function acknowledgeAcquisitionDomFirst(
  current: Pick<
    PendingAcquisitionView,
    "id" | "recordId" | "title" | "recordKind" | "imageAssetId"
  >,
): Promise<void> {
  await startAcquisitionAcknowledgement(current);
  await waitForAcquisitionDomSettlement(current);
}

export async function dismissAllPendingAcquisitions(
  options: { cap?: number } = {},
): Promise<void> {
  const { cap = 50 } = options;
  await drainPendingAcquisitionsWithinCap({
    cap,
    readCurrent: async () => {
      const state = await getPackagedGameState();
      const current = state.pendingAcquisition;
      if (current) return current;
      await waitForNoDialog(anchors.evidenceAcquired, 90000);
      await waitForPersistenceIdle();
      return (await getPackagedGameState()).pendingAcquisition;
    },
    acknowledge: async (current) => {
      await acknowledgeAcquisitionDomFirst(current);
      await waitForPackagedGameState(
        (next) => next.pendingAcquisition?.id !== current.id,
        30000,
        `acquisition ${current.id} did not advance`,
      );
    },
  });
}

export async function returnToTitle(): Promise<void> {
  await openGameMenu();
  await clickButton(anchors.returnToTitle);
  await waitForPackagedDomTransition(
    `[aria-label="${anchors.mainMenu}"]`,
    "[data-gameplay-root]",
    "title screen did not appear",
  );
}

export async function continueFromTitle(): Promise<void> {
  await waitForButton(anchors.continueGame, 30000);
  await clickButton(anchors.continueGame);
  await waitForPackagedDomTransition(
    "[data-gameplay-root]",
    `[aria-label="${anchors.mainMenu}"]`,
    "Continue did not leave the title screen",
  );
  await waitForPackagedGameState(
    () => true,
    30000,
    "Continue did not install a packaged game state",
  );
}

export async function openTitleLoadBrowser(): Promise<void> {
  await waitForButton(anchors.loadGame, 30000);
  await clickButton(anchors.loadGame);
  await browser.waitUntil(
    async () => elementExists('[aria-label="存檔瀏覽器"]'),
    { timeout: 30000, timeoutMsg: "title load browser did not appear" },
  );
}

export async function loadTitleSlot(
  type: "auto" | "manual",
  slot: number,
): Promise<void> {
  await openTitleLoadBrowser();
  await clickButton(`選擇${type === "auto" ? "自動存檔" : "手動存檔"} ${slot}`);
  await waitForPackagedDomTransition(
    "[data-gameplay-root]",
    `[aria-label="${anchors.mainMenu}"]`,
    `title load of ${type}-${slot} did not install gameplay`,
  );
  await waitForPackagedGameState(
    () => true,
    30000,
    `title load of ${type}-${slot} did not install gameplay`,
  );
}

export async function clickSaveCardButton(
  type: "auto" | "manual",
  slot: number,
  label: "載入" | "刪除" | "選擇",
): Promise<void> {
  const clicked = await browser.execute(
    (slotType: "auto" | "manual", slotNumber: number, buttonLabel: string) => {
      const card = document.querySelector(
        `article[data-slot-type="${slotType}"][data-slot-number="${slotNumber}"]`,
      );
      const button = Array.from(
        card?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((candidate) =>
        (candidate.textContent ?? "").trim().includes(buttonLabel),
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    type,
    slot,
    label,
  );
  if (!clicked) {
    throw new Error(`${type}-${slot} ${label} action was unavailable`);
  }
}

export async function saveCardText(
  type: "auto" | "manual",
  slot: number,
): Promise<string> {
  return browser.execute(
    (slotType: "auto" | "manual", slotNumber: number) => {
      const card = document.querySelector(
        `article[data-slot-type="${slotType}"][data-slot-number="${slotNumber}"]`,
      );
      return (card?.textContent ?? "").trim();
    },
    type,
    slot,
  );
}

export async function waitForPersistenceIdle(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const status = await invokePackagedCommand<{ type: string }>(
        "get_persistence_status",
      );
      const thumbnail = await invokePackagedCommand<{ type: string }>(
        "get_thumbnail_activity",
      );
      return status.type === "healthy" && thumbnail.type !== "capturing";
    },
    {
      timeout: 90000,
      interval: 100,
      timeoutMsg: "persistence did not settle to healthy",
    },
  );
}

export async function requestWindowClose(): Promise<void> {
  await browser.execute(() => {
    const internals = (
      window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
    ).__TAURI_INTERNALS__;
    if (!internals) throw new Error("Tauri internals are unavailable.");
    void internals.invoke("plugin:window|close", { label: "main" });
  });
}

export async function requestApplicationQuit(): Promise<void> {
  await browser.execute(() => {
    const internals = (
      window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
    ).__TAURI_INTERNALS__;
    if (!internals) throw new Error("Tauri internals are unavailable.");
    void internals.invoke("e2e_request_application_quit");
  });
}

export function isPackagedDisconnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:invalid session|no such window|session.*(?:closed|deleted)|window.*closed|disconnected|econnrefused|connection refused|failed to connect|terminated)/i.test(
    message,
  );
}

export async function waitForPackagedDisconnect(
  timeout = 30000,
): Promise<void> {
  const retireDisconnectedSession = () => {
    // The app owns this successful shutdown. Once the embedded driver has
    // disappeared, prevent WDIO teardown from issuing DELETE against the dead
    // port and converting the proven disconnect into an ECONNREFUSED failure.
    delete (browser as unknown as { sessionId?: string }).sessionId;
  };
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if ((await browser.getWindowHandles()).length === 0) {
        retireDisconnectedSession();
        return;
      }
    } catch (error) {
      if (isPackagedDisconnectError(error)) {
        retireDisconnectedSession();
        return;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("packaged process remained connected after exit flush");
}

/** DialogueBox renders a visible advance button as a sibling of the
 * click-to-advance .box div. Testimony changes only its player-facing label;
 * both names remain the same advance target for the packaged journey. */
export const advanceDialogueSelector = [
  `button[aria-label="${anchors.advanceDialogue}"]`,
  `button[aria-label="${anchors.advanceTestimony}"]`,
].join(", ");

/** The option buttons of an on-screen 推理 prompt (DialogueBox). */
const deductionOptionSelector = `ol[aria-label="${anchors.deductionOptions}"] button`;

/**
 * Main-menu cards animate with opacity 0 (fill-mode both). Under WebDriver the
 * WebView can keep animations frozen when focus is flaky, so isDisplayed()
 * (checkVisibility + opacity) hangs forever. Prefer existence + JS click.
 */
/**
 * DialogueBox skips the JS typewriter when prefers-reduced-motion is reduce.
 * Without this, each advance needs two clicks (complete reveal, then advance)
 * and a 273-line intro exceeds the drain cap / suite budget.
 *
 * Also disable CSS transitions/animations: when the WebView is unfocused under
 * WDIO, transitions freeze at their starting values (opacity 0 on menu cards
 * and character highlight), so isDisplayed/getCSSProperty hang or assert 0.
 */
export async function forceReducedMotion(): Promise<void> {
  await browser.execute(() => {
    try {
      const original = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        const mql = original(query);
        if (
          typeof query === "string" &&
          query.includes("prefers-reduced-motion")
        ) {
          Object.defineProperty(mql, "matches", {
            configurable: true,
            get: () => true,
          });
        }
        return mql;
      }) as typeof window.matchMedia;
    } catch {
      // ignore — drain still double-clicks as fallback
    }
    try {
      if (!document.getElementById("lyra-e2e-no-motion")) {
        const style = document.createElement("style");
        style.id = "lyra-e2e-no-motion";
        style.textContent =
          "*, *::before, *::after { transition: none !important; animation: none !important; animation-delay: 0s !important; }";
        document.head.appendChild(style);
      }
    } catch {
      // ignore
    }
  });
}

/** Script timeout while waiting out a reload; see {@link reloadDocument}. */
const RELOAD_POLL_SCRIPT_TIMEOUT_MS = 2000;

/**
 * Reload the page and return once the new document is in place. The embedded
 * WebDriver's refresh only calls `location.reload()` and returns, so the next
 * script can land in the unloading document and never answer. At the
 * session's 30 s script timeout that stalled about a third of all refreshes
 * for 30 s each; a short timeout while polling makes a lost reply a quick
 * retry instead.
 */
async function reloadDocument(failureLabel: string): Promise<void> {
  const marker = "data-e2e-pre-reload";
  await browser.execute((name: string) => {
    document.documentElement.setAttribute(name, "");
  }, marker);
  const { script } = await browser.getTimeouts();
  await browser.refresh();
  await browser.setTimeout({ script: RELOAD_POLL_SCRIPT_TIMEOUT_MS });
  try {
    await browser.waitUntil(
      async () =>
        browser.execute(
          (name: string) =>
            document.readyState === "complete" &&
            !document.documentElement.hasAttribute(name),
          marker,
        ),
      {
        timeout: 30000,
        interval: 100,
        timeoutMsg: `${failureLabel} did not replace the prior document`,
      },
    );
  } finally {
    await browser.setTimeout({ script: script ?? 30000 });
  }
}

export async function waitForShell(): Promise<void> {
  await forceReducedMotion();
  await browser.waitUntil(
    async () => {
      return browser.execute((label: string) => {
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.some((b) => (b.textContent ?? "").includes(label));
      }, anchors.startButton);
    },
    {
      timeout: 60000,
      timeoutMsg: "main menu start control did not appear in DOM",
      interval: 250,
    },
  );
}

async function waitForCaptureProofShell(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (label: string) =>
          Array.from(document.querySelectorAll("button")).some((button) =>
            (button.textContent ?? "").includes(label),
          ),
        anchors.startButton,
      ),
    {
      timeout: 60000,
      timeoutMsg: "capture proof main-menu start control did not appear",
      interval: 250,
    },
  );
}

export async function resetCaptureProofStorage(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => typeof window.localStorage !== "undefined"),
    { timeout: 30000, timeoutMsg: "capture proof localStorage unavailable" },
  );
  await browser.execute((clearanceKey: string) => {
    const toRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("lyra.")) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
    window.localStorage.setItem(clearanceKey, "true");
  }, STORY_CLEARED_STORAGE_KEY);
  await reloadDocument("capture proof refresh");
  await waitForCaptureProofShell();
}

export async function startCaptureProofAtScene(
  sceneId: string,
  expectedEntryDialogue: string,
): Promise<void> {
  const started = await browser.execute((label: string) => {
    document.getAnimations?.().forEach((animation) => {
      try {
        animation.finish();
      } catch {
        // The menu remains directly clickable even if one animation cannot finish.
      }
    });
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => (candidate.textContent ?? "").includes(label),
    );
    button?.click();
    return button !== undefined;
  }, anchors.startButton);
  if (!started) throw new Error("capture proof start control missing");

  await browser.waitUntil(async () => elementExists(advanceDialogueSelector), {
    timeout: 30000,
    timeoutMsg: "capture proof dialogue did not appear after start",
  });
  await browser.keys("Escape");
  await browser.waitUntil(
    async () =>
      browser.execute(
        (heading: string) =>
          Array.from(document.querySelectorAll('[role="dialog"]')).some(
            (dialog) =>
              Array.from(dialog.querySelectorAll("h2")).some((title) =>
                (title.textContent ?? "").includes(heading),
              ),
          ),
        anchors.gameMenu,
      ),
    { timeout: 10000, timeoutMsg: "capture proof game menu did not open" },
  );
  await jsClickButtonContaining(anchors.sceneSelect);
  await browser.waitUntil(
    async () => elementExists('[aria-label="場景跳轉"]'),
    { timeout: 10000, timeoutMsg: "capture proof scene picker did not open" },
  );
  const selected = await browser.execute((expectedSceneId: string) => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[aria-label="場景跳轉"] button',
      ),
    ).find((candidate) =>
      (candidate.textContent ?? "").includes(expectedSceneId),
    );
    button?.click();
    return button !== undefined;
  }, sceneId);
  if (!selected) {
    throw new Error(`capture proof scene ${sceneId} was not selectable`);
  }
  await browser.waitUntil(
    async () =>
      browser.execute((expected: string) => {
        const line = document.querySelector(
          ".text-line, .text-action, .text-scene",
        );
        return (line?.textContent ?? "").includes(expected);
      }, expectedEntryDialogue),
    {
      timeout: 30000,
      timeoutMsg: `capture proof scene ${sceneId} did not expose its entry dialogue`,
    },
  );
}

export async function clickStartButton(): Promise<void> {
  await waitForShell();
  await browser.waitUntil(
    async () =>
      browser.execute((label: string) => {
        const button = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).find(
          (candidate) =>
            candidate.getAttribute("aria-label") === label ||
            (candidate.textContent ?? "").includes(label),
        );
        return !!button && !button.disabled;
      }, anchors.startButton),
    {
      timeout: 30000,
      interval: 100,
      timeoutMsg: "main menu start control stayed disabled after discovery",
    },
  );
  const clicked = await browser.execute((label: string) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find((b) => (b.textContent ?? "").includes(label));
    if (!btn || (btn as HTMLButtonElement).disabled) return false;
    // Finish entrance animations so layout/hit-testing is stable.
    document.getAnimations?.().forEach((a) => {
      try {
        a.finish();
      } catch {
        /* ignore */
      }
    });
    (btn as HTMLButtonElement).click();
    return true;
  }, anchors.startButton);
  if (!clicked) {
    throw new Error("clickStartButton: start control not found");
  }
}

export async function resetE2eStorage(): Promise<void> {
  await browser.waitUntil(
    async () => {
      return browser.execute(() => typeof window.localStorage !== "undefined");
    },
    { timeout: 30000, timeoutMsg: "localStorage unavailable" },
  );
  await browser.execute((key: string) => {
    window.localStorage.removeItem(key);
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("lyra.")) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  }, STORY_CLEARED_STORAGE_KEY);
  await reloadDocument("ordinary E2E setup refresh");
  // Re-apply motion stubs after navigation (refresh drops injected scripts).
  await waitForShell();
}

export async function resetE2eStorageWithStoryClearance(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => typeof window.localStorage !== "undefined"),
    { timeout: 30000, timeoutMsg: "localStorage unavailable" },
  );
  await browser.execute((clearanceKey: string) => {
    const toRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("lyra.")) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
    window.localStorage.setItem(clearanceKey, "true");
  }, STORY_CLEARED_STORAGE_KEY);
  await reloadDocument("save e2e setup refresh");
  await waitForShell();
  const value = await browser.execute((clearanceKey: string) => {
    return window.localStorage.getItem(clearanceKey);
  }, STORY_CLEARED_STORAGE_KEY);
  if (value !== "true") {
    throw new Error(
      `resetE2eStorageWithStoryClearance: ${STORY_CLEARED_STORAGE_KEY} did not persist across refresh (got ${JSON.stringify(value)})`,
    );
  }
}

export async function startFromMenu(): Promise<void> {
  await clickStartButton();
  try {
    await browser.waitUntil(
      async () => {
        const status = await browser.execute(
          (sel: string, label: string) => {
            if (document.querySelector(sel) !== null) {
              return { started: true, error: null };
            }

            const error = document.querySelector(
              "[role='alert'], .error-banner",
            );
            if (error) {
              return {
                started: false,
                error:
                  (error.textContent ?? "").trim() ||
                  "New Game reported an empty error.",
              };
            }

            const button = Array.from(
              document.querySelectorAll<HTMLButtonElement>("button"),
            ).find(
              (candidate) =>
                candidate.getAttribute("aria-label") === label ||
                (candidate.textContent ?? "").includes(label),
            );

            // A freshly launched WebView can expose the server-rendered menu
            // just before Svelte attaches its click handler. Retrying is safe
            // only while the control remains enabled: the handler disables it
            // synchronously before awaiting the native start command.
            if (button && !button.disabled) {
              button.click();
            }
            return { started: false, error: null };
          },
          advanceDialogueSelector,
          anchors.startButton,
        );
        if (status.error) {
          throw new Error(`New Game failed: ${status.error}`);
        }
        return status.started;
      },
      {
        timeout: 90000,
        timeoutMsg: "dialogue advance control did not appear after start",
        interval: 200,
      },
    );
  } catch (e) {
    // Surface the on-screen error banner (if any) so resource/IPC failures
    // are diagnosable instead of just "did not appear after start".
    const diag = await browser.execute(async (mainMenuLabel: string) => {
      const banner = document.querySelector("[role='alert'], .error-banner");
      const diagnosticWindow = window as Window & {
        __TAURI_INTERNALS__?: TauriInternals;
        __saveE2eRuntimeErrors?: string[];
      };
      const internals = diagnosticWindow.__TAURI_INTERNALS__;
      let nativeState:
        | { ok: true; value: unknown }
        | { ok: false; error: string };
      try {
        nativeState = internals
          ? { ok: true, value: await internals.invoke("get_state", {}) }
          : { ok: false, error: "Tauri internals are unavailable." };
      } catch (error) {
        nativeState = {
          ok: false,
          error:
            error instanceof Error
              ? (error.stack ?? error.message)
              : JSON.stringify(error),
        };
      }
      return {
        url: window.location.href,
        documentIdentity:
          document.documentElement.dataset.saveDocumentIdentity ?? null,
        titleVisible:
          document.querySelector(`[aria-label="${mainMenuLabel}"]`) !== null,
        gameplayRootVisible:
          document.querySelector("[data-gameplay-root]") !== null,
        captureRootVisible:
          document.querySelector("[data-save-thumbnail-root]") !== null,
        tauriInternals: internals !== undefined,
        errorBanner: banner ? (banner.textContent ?? "").trim() : null,
        runtimeErrors: diagnosticWindow.__saveE2eRuntimeErrors ?? [],
        bodyText: (document.body.textContent ?? "").trim(),
        buttons: Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).map((button) => ({
          ariaLabel: button.getAttribute("aria-label"),
          text: (button.textContent ?? "").trim(),
          disabled: button.disabled,
        })),
        nativeState,
      };
    }, anchors.mainMenu);
    console.error("[startFromMenu diagnostic]", JSON.stringify(diag));
    throw e;
  }
}

export async function waitTypewriterIdle(): Promise<void> {
  try {
    await browser.waitUntil(
      async () => {
        return browser.execute((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return false;
          return el.getAttribute("aria-disabled") !== "true";
        }, advanceDialogueSelector);
      },
      {
        // A real packaged autosave captures the gameplay root before the next
        // mutation becomes interactive. Keep this aligned with the 90-second
        // packaged command/capture deadline used by the HPA phase helpers: a
        // fresh macOS build can exceed 60 seconds while WebKit embeds fonts.
        timeout: 90000,
        timeoutMsg: "dialogue advance stayed aria-disabled",
        interval: 100,
      },
    );
  } catch (error) {
    const [native, rendered] = await Promise.all([
      getPackagedGameState().catch((stateError: unknown) => ({
        diagnosticError:
          stateError instanceof Error ? stateError.message : String(stateError),
      })),
      browser.execute(
        (sel: string, captureProbe: string) => {
          const advance = document.querySelector<HTMLElement>(sel);
          return {
            advance: advance
              ? {
                  ariaDisabled: advance.getAttribute("aria-disabled"),
                  text: (advance.textContent ?? "").trim(),
                }
              : null,
            visibleDialogue:
              document.querySelector(".text-line, .text-action, .text-scene")
                ?.textContent ?? null,
            dialogs: Array.from(
              document.querySelectorAll<HTMLElement>('[role="dialog"]'),
            ).map((dialog) => ({
              ariaLabel: dialog.getAttribute("aria-label"),
              text: (dialog.textContent ?? "").trim().slice(0, 1000),
            })),
            captureProof: document
              .querySelector(captureProbe)
              ?.getAttribute("data-capture-proof-command-status"),
          };
        },
        advanceDialogueSelector,
        anchors.captureProof.probe,
      ),
    ]);
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `native=${JSON.stringify(native)}`,
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
  // Typewriter can take up to ~1.5s after enable; settle briefly. Under
  // prefers-reduced-motion (always forced in e2e via forceReducedMotion) the
  // JS typewriter is skipped and the full line is rendered when the advance
  // button re-enables, so the settle is pure overhead on every advance.
  // Skipping it keeps full-chapter organic drains within the gameplay chain
  // budget; the non-reduced-motion path still settles as before.
  const reducedMotion = await browser.execute(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  if (!reducedMotion) {
    await browser.pause(150);
  }
}

export async function advanceDialogueOnce(): Promise<boolean> {
  await waitTypewriterIdle();
  // Under prefers-reduced-motion (always forced in e2e) the JS typewriter is
  // skipped, so a single click advances immediately; a second synchronous
  // click would carry a stale queueToken and be rejected as Unchanged by
  // advance_dialogue (a wasted IPC round-trip). Without reduced-motion the
  // first click may only complete the typewriter reveal, so a second click is
  // still needed to advance.
  return browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.click();
    if (!reducedMotion) el.click();
    return true;
  }, advanceDialogueSelector);
}

/**
 * Fast dialogue drain for the organic production route: advances dialogue
 * using DOM-only checks per step (no IPC round-trip per advance) and only
 * calls the predicate (IPC) when the advance control disappears (mode
 * transition) or switches to the testimony label (cross-exam). This cuts
 * per-advance overhead from ~5 browser.execute calls to ~1, which is the
 * difference between fitting and not fitting the gameplay chain budget.
 *
 * Returns when the predicate becomes true or the advance control switches to
 * the testimony label (cross-exam). Hitting the cap throws by default; pass
 * `throwOnCap: false` to return instead, so a caller with its own bounded
 * loop can re-check state across a long linear stretch. The caller
 * (drainOrganicRoute) re-checks the full game state at the top of its next
 * iteration, so overshooting a mode transition by one advance is harmless.
 */
export async function drainDialogueFast(
  predicate: () => Promise<boolean>,
  cap: number = DIALOGUE_DRAIN_CAP,
  { throwOnCap = true }: { throwOnCap?: boolean } = {},
): Promise<void> {
  for (let i = 0; i < cap; i++) {
    // Single DOM execute: check the advance button, detect cross-exam, and
    // click if it's a regular advance. Returns:
    //   "advanced"  — clicked the regular advance button, continue
    //   "testimony" — advance button is the testimony label (cross-exam)
    //   "disabled"  — button present but aria-disabled (command in flight)
    //   "none"      — no advance button (mode transition)
    const result = await browser.execute(
      (sel: string, testimonyLabel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return "none";
        if (el.getAttribute("aria-disabled") === "true") return "disabled";
        const label = el.getAttribute("aria-label");
        if (label === testimonyLabel) return "testimony";
        el.click();
        return "advanced";
      },
      advanceDialogueSelector,
      anchors.advanceTestimony,
    );
    if (result === "advanced") continue;
    if (result === "testimony") {
      // Cross-exam entered — let the caller handle 反駁. Check the predicate
      // once so the caller's stop condition is evaluated at this transition.
      if (await predicate()) return;
      return;
    }
    if (result === "disabled") {
      // Command still in flight; wait briefly for the button to re-enable.
      // Under reduced-motion this is just the IPC round-trip, so 50ms is
      // enough. The outer cap prevents an infinite loop.
      await browser.pause(50);
      continue;
    }
    // result === "none": advance control gone. A 推理 prompt has no advance
    // control; answer it and keep draining.
    if (await answerDeductionPrompt()) continue;
    // Otherwise a mode transition. Check the predicate (IPC) and handle the
    // transition grace, same as advanceDialogueUntil.
    if (await predicate()) return;
    try {
      await browser.waitUntil(
        async () => {
          if (await predicate()) return true;
          // Pending city-map gate: click the sole destination pin.
          if (await clickSoleMapDestination()) return true;
          // The advance control, or a 推理 prompt (which has none).
          return browser.execute(
            (sel: string) => document.querySelector(sel) !== null,
            `${advanceDialogueSelector}, ${deductionOptionSelector}`,
          );
        },
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg:
            "drainDialogueFast: advance control did not return and predicate did not become true",
        },
      );
    } catch (error) {
      const lastText = await lastVisibleDialogueText();
      throw new Error(
        `drainDialogueFast: advance control unavailable at step ${i}; predicate still false; last visible text: ${JSON.stringify(lastText)}`,
        { cause: error },
      );
    }
    if (await predicate()) return;
    // Advance control reappeared — continue draining from the next step.
  }
  if (!throwOnCap) return;
  const lastText = await lastVisibleDialogueText();
  throw new Error(
    `drainDialogueFast: exceeded cap ${cap}; predicate still false; last visible text: ${JSON.stringify(lastText)}`,
  );
}

type DeductionPromptState = {
  question: string;
  feedback: string | null;
  options: string[];
  enabled: boolean;
};

type DeductionAnswer = (typeof anchors.deductionAnswers)[number];

async function readDeductionPrompt(): Promise<DeductionPromptState | null> {
  return browser.execute((sel: string) => {
    const options = Array.from(
      document.querySelectorAll<HTMLButtonElement>(sel),
    );
    if (options.length === 0) return null;
    return {
      question: (
        document.querySelector(".text-prompt")?.textContent ?? ""
      ).trim(),
      feedback:
        document.querySelector(".prompt-feedback")?.textContent?.trim() ?? null,
      // Each option is a number key span (aria-hidden) and its label span.
      options: options.map((option) =>
        (
          option.querySelector(":scope > span:not(.prompt-option-key)")
            ?.textContent ?? ""
        ).trim(),
      ),
      enabled: options.every(
        (option) => option.getAttribute("aria-disabled") !== "true",
      ),
    };
  }, deductionOptionSelector);
}

/**
 * Answers the 推理 prompt on screen, if there is one, with its authored answer
 * from anchors.deductionAnswers. A prompt has no advance control and moves on
 * only through its correct option. The drain checks the chapter, scene,
 * question and options against the entry, then clicks only the expected
 * answer, so a reworded prompt or a changed answer fails here instead of being
 * guessed past. Returns false when no prompt is showing.
 */
export async function answerDeductionPrompt(): Promise<boolean> {
  if (!(await readDeductionPrompt())) return false;
  // The question types out like a line, so wait until it reads as a known
  // prompt and its options take clicks.
  let prompt: DeductionPromptState | null = null;
  let expected: DeductionAnswer | undefined;
  await browser
    .waitUntil(
      async () => {
        prompt = await readDeductionPrompt();
        if (!prompt) return true;
        const question = prompt.question;
        expected = anchors.deductionAnswers.find(
          (entry) => entry.question === question,
        );
        return expected !== undefined && prompt.enabled;
      },
      { timeout: 5000, interval: 50 },
    )
    .catch(() => undefined);
  const shown = prompt as DeductionPromptState | null;
  if (!shown) return true;
  if (!expected) {
    throw new Error(
      `answerDeductionPrompt: no anchors.deductionAnswers entry for the prompt ${JSON.stringify(shown.question)}`,
    );
  }
  if (!shown.enabled) {
    throw new Error(
      `answerDeductionPrompt: options stayed disabled for ${JSON.stringify(shown.question)}`,
    );
  }
  const { chapter, scene } = await getPackagedGameState();
  if (chapter.id !== expected.chapter || scene.id !== expected.scene) {
    throw new Error(
      `answerDeductionPrompt: prompt ${JSON.stringify(shown.question)} showed in ${chapter.id}/${scene.id}, expected ${expected.chapter}/${expected.scene}`,
    );
  }
  if (
    shown.options.length !== expected.options.length ||
    shown.options.some((label, i) => label !== expected!.options[i])
  ) {
    throw new Error(
      `answerDeductionPrompt: options for ${JSON.stringify(shown.question)} were ${JSON.stringify(shown.options)}, expected ${JSON.stringify(expected.options)}`,
    );
  }
  const index = shown.options.indexOf(expected.answer);
  if (index < 0) {
    throw new Error(
      `answerDeductionPrompt: answer ${JSON.stringify(expected.answer)} is not among its options`,
    );
  }
  await browser.execute(
    (sel: string, i: number) => {
      document.querySelectorAll<HTMLButtonElement>(sel)[i]?.click();
    },
    deductionOptionSelector,
    index,
  );
  // The correct option moves the queue on; a wrong one would show its reply
  // and keep the prompt.
  const question = expected.question;
  let last: DeductionPromptState | null = shown;
  await browser
    .waitUntil(
      async () => {
        last = await readDeductionPrompt();
        return last === null || last.question !== question;
      },
      { timeout: 10000, interval: 50 },
    )
    .catch(() => undefined);
  const after = last as DeductionPromptState | null;
  if (after && after.question === question) {
    throw new Error(
      `answerDeductionPrompt: the authored answer ${JSON.stringify(expected.answer)} did not clear ${JSON.stringify(question)}; reply shown: ${JSON.stringify(after.feedback)}`,
    );
  }
  return true;
}

/**
 * Read the currently visible dialogue line/narration/scene text so capped
 * drain failures report what was on screen (see flake policy in the design
 * spec). Returns "" when no dialogue text element is present.
 */
export async function lastVisibleDialogueText(): Promise<string> {
  return browser.execute(() => {
    const el = document.querySelector(
      ".text-line, .text-action, .text-scene, .text-prompt",
    );
    return el ? (el.textContent ?? "").trim() : "";
  });
}

/**
 * Advance dialogue until `predicate` returns true or cap is hit.
 * Cap must be intro-length + margin (see production-anchors).
 */
export async function advanceDialogueUntil(
  predicate: () => Promise<boolean>,
  cap: number = DIALOGUE_DRAIN_CAP,
): Promise<void> {
  for (let i = 0; i < cap; i++) {
    // Check the predicate before every advance so the drain stops as soon as
    // the target state is reached — e.g. when an acquisition popup appears
    // mid-dialogue. Without this guard the loop would advance past the popup,
    // dismissing it and draining dialogue the popup was supposed to interrupt.
    if (await predicate()) return;
    const hasAdvance = await browser.execute((sel: string) => {
      return document.querySelector(sel) !== null;
    }, advanceDialogueSelector);
    if (!hasAdvance) {
      if (await predicate()) return;
      // A 推理 prompt has no advance control; answer it and keep draining.
      if (await answerDeductionPrompt()) continue;
      // The advance selector can be transiently absent during a mode
      // transition. Right after a hotspot click, jsClick only dispatches the
      // DOM event while inspect_hotspot is still awaiting IPC — the app
      // remains in explore mode with no advance selector until the response
      // re-renders into dialogue. Symmetrically, when a dialogue queue
      // exhausts, the app transitions out of dialogue and the selector
      // disappears while the target mode renders. Wait briefly for either the
      // predicate to become true (the transition completed into the target
      // state) or the advance selector to reappear (the transition completed
      // into a new dialogue) before declaring a terminal failure. Without
      // this grace, the drain throws at step 0 during the IPC window.
      try {
        await browser.waitUntil(
          async () => {
            if (await predicate()) return true;
            // Pending city-map gate (HPA-601 §11): a mapped wrapper parks
            // Explore on the city map with no advance control. The sole
            // enabled destination is the only way forward; click it once and
            // let the loop drain the entered dialogue. Several enabled
            // destinations fail deterministically via the pure helper.
            if (await clickSoleMapDestination()) return true;
            // The advance control, or a 推理 prompt (which has none).
            return browser.execute(
              (sel: string) => document.querySelector(sel) !== null,
              `${advanceDialogueSelector}, ${deductionOptionSelector}`,
            );
          },
          {
            timeout: 5000,
            interval: 100,
            timeoutMsg:
              "advanceDialogueUntil: advance control did not return and predicate did not become true",
          },
        );
      } catch (error) {
        const lastText = await lastVisibleDialogueText();
        throw new Error(
          `advanceDialogueUntil: advance control unavailable at step ${i}; predicate still false; last visible text: ${JSON.stringify(lastText)}`,
          { cause: error },
        );
      }
      if (await predicate()) return;
      // The selector reappeared — continue draining from the next step.
      continue;
    }
    // A queue-exhausting command can remove the control during the short
    // settle between waitTypewriterIdle() and the atomic DOM click. Let the
    // capped outer loop re-check its predicate and existing transition grace
    // instead of treating that legitimate mode transition as a terminal
    // missing-control failure.
    if (!(await advanceDialogueOnce()) && (await predicate())) return;
  }
  const lastText = await lastVisibleDialogueText();
  throw new Error(
    `advanceDialogueUntil: exceeded cap ${cap}; predicate still false; last visible text: ${JSON.stringify(lastText)}`,
  );
}

export async function elementExists(selector: string): Promise<boolean> {
  return browser.execute((sel: string) => {
    return document.querySelector(sel) !== null;
  }, selector);
}

/**
 * HPA-601 §11: IDs of currently enabled city-map destination buttons. The
 * sole-destination decision itself stays in the pure helper
 * (`soleMapDestinationId`); this seam only queries the DOM.
 */
export async function enabledMapDestinationIds(): Promise<string[]> {
  return browser.execute((selector: string) => {
    return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
      .filter((button) => !button.disabled)
      .map((button) => button.getAttribute("data-map-destination"))
      .filter((id): id is string => id !== null);
  }, anchors.mapDestinationSelector);
}

/**
 * Generic production drain support for the pending city map: when Explore has
 * no current sublocation, the wrapper renders only `[data-map-destination]`
 * pins and no advance control. Query the enabled pins, decide through the
 * pure helper (several enabled pins fail deterministically instead of
 * guessing), and click the sole one. Returns false when no map decision is
 * pending; wrapper scene IDs are never consulted.
 */
export async function clickSoleMapDestination(): Promise<boolean> {
  const ids = await enabledMapDestinationIds();
  const sole = soleMapDestinationId(ids);
  if (sole === null) return false;
  const clicked = await browser.execute(
    (selector: string, destinationId: string) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(selector),
      ).find(
        (candidate) =>
          !candidate.disabled &&
          candidate.getAttribute("data-map-destination") === destinationId,
      );
      if (!button) return false;
      button.click();
      return true;
    },
    anchors.mapDestinationSelector,
    sole,
  );
  // Transient disappearance (button found by enabledMapDestinationIds but
  // gone by the time this execute runs) is a race during DOM transitions.
  // Return false so advanceDialogueUntil's browser.waitUntil polling retries
  // instead of aborting; the surrounding timeout handles persistent failure.
  if (!clicked) return false;
  return true;
}

export async function elementTextIncludes(
  selector: string,
  text: string,
): Promise<boolean> {
  return browser.execute(
    (sel: string, needle: string) => {
      const el = document.querySelector(sel);
      return !!el && (el.textContent ?? "").includes(needle);
    },
    selector,
    text,
  );
}

export async function drainToInvestigationExplore(): Promise<void> {
  await startFromMenu();
  await advanceDialogueUntil(async () => {
    // Use DOM existence to detect the mode transition without coupling this
    // dialogue drain to the longer persistence-owned capture deadline.
    const sub = await browser.execute((label: string) => {
      return Array.from(document.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").includes(label),
      );
    }, anchors.sublocationLabel);
    if (sub) return true;
    return elementExists(
      `button[aria-label="${anchors.hotspotEvidence.label}"]`,
    );
  });
  // The explore DOM renders before the autosave thumbnail submission settles.
  // Investigation controls are deliberately disabled throughout that owned
  // command phase, and HTMLElement.click() is a no-op for disabled buttons.
  // Do not hand control to a test until the canonical production hotspot is
  // actually interactive.
  await waitForButton(anchors.hotspotEvidence.label, 90000);
}

async function isGameMenuDialogOpen(): Promise<boolean> {
  return browser.execute((heading: string) => {
    return Array.from(document.querySelectorAll('[role="dialog"]')).some(
      (dialog) =>
        Array.from(dialog.querySelectorAll("h2")).some((headingNode) =>
          (headingNode.textContent ?? "").includes(heading),
        ),
    );
  }, anchors.gameMenu);
}

export async function openGameMenu(): Promise<void> {
  // The InterrogationEvidenceTray claims Escape via claimEscape(resume) while
  // mounted, and resume() is the 收回 (withdraw) operation. GameShell's Escape
  // handler dispatches to closeTopmostEscapeClaim() before opening the menu,
  // so any Escape sent while the tray exists retracts Present rather than
  // opening the menu. The generic Escape fallback below is therefore only safe
  // when no Present tray is mounted.
  //
  // Split the two paths: when the tray exists, stay on the direct
  // [data-interrogation-game-menu] button (waiting for it to become enabled
  // if a command is mid-flight) and never send Escape. Only use the Escape
  // retry/fallback loop when there is no Present tray.
  const presentTrayExists = await browser.execute(
    () => document.querySelector("[data-interrogation-game-menu]") !== null,
  );

  if (presentTrayExists) {
    // The tray's 遊戲選單 button receives disabled={gameState.inFlight}, so it
    // is temporarily disabled while a command (e.g. autosave thumbnail
    // submission) is in flight. Wait for it to clear, then click. Do NOT fall
    // back to Escape here — that would retract Present and silently change the
    // state the caller expects to preserve.
    try {
      await browser.waitUntil(
        async () => {
          const clicked = await browser.execute(() => {
            const button = document.querySelector<HTMLButtonElement>(
              "[data-interrogation-game-menu]",
            );
            if (!button || button.disabled) return false;
            button.click();
            return true;
          });
          return clicked;
        },
        {
          timeout: 15000,
          interval: 100,
          timeoutMsg:
            "interrogation Present game-menu button did not become clickable",
        },
      );
      await browser.waitUntil(isGameMenuDialogOpen, {
        timeout: 15000,
        interval: 100,
        timeoutMsg: "game menu dialog did not open from interrogation Present",
      });
      return;
    } catch (error) {
      // Surface diagnostics rather than falling through to Escape, which would
      // retract Present and mask the real failure.
      const rendered = await browser.execute(() => ({
        activeElement:
          document.activeElement instanceof HTMLElement
            ? {
                tag: document.activeElement.tagName,
                ariaLabel: document.activeElement.getAttribute("aria-label"),
                text: (document.activeElement.textContent ?? "")
                  .trim()
                  .slice(0, 200),
              }
            : null,
        presentButton: (() => {
          const button = document.querySelector<HTMLButtonElement>(
            "[data-interrogation-game-menu]",
          );
          if (!button) return null;
          return {
            disabled: button.disabled,
            text: (button.textContent ?? "").trim(),
          };
        })(),
        dialogs: Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"]'),
        ).map((dialog) => ({
          ariaLabel: dialog.getAttribute("aria-label"),
          headings: Array.from(dialog.querySelectorAll("h2")).map((heading) =>
            (heading.textContent ?? "").trim(),
          ),
          text: (dialog.textContent ?? "").trim().slice(0, 500),
        })),
      }));
      let native:
        | {
            mode: GameStateView["mode"];
            scene: GameStateView["scene"];
            pendingAcquisition: GameStateView["pendingAcquisition"];
          }
        | { diagnosticError: string };
      try {
        const state = await getPackagedGameState();
        native = {
          mode: state.mode,
          scene: state.scene,
          pendingAcquisition: state.pendingAcquisition,
        };
      } catch (diagnosticError) {
        native = {
          diagnosticError:
            diagnosticError instanceof Error
              ? diagnosticError.message
              : String(diagnosticError),
        };
      }
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `native=${JSON.stringify(native)}`,
          `rendered=${JSON.stringify(rendered)}`,
        ].join("\n"),
        { cause: error },
      );
    }
  }

  try {
    await browser.waitUntil(
      async () => {
        if (await isGameMenuDialogOpen()) return true;
        // GameShell deliberately swallows Escape while a gameplay command and
        // its owned thumbnail submission are still in flight. Retry with a new
        // physical key event until that bounded frontend phase has settled.
        await browser.keys("Escape");
        return false;
      },
      {
        timeout: 15000,
        interval: 100,
        timeoutMsg: "game menu dialog did not open",
      },
    );
  } catch (error) {
    const rendered = await browser.execute(() => ({
      activeElement:
        document.activeElement instanceof HTMLElement
          ? {
              tag: document.activeElement.tagName,
              ariaLabel: document.activeElement.getAttribute("aria-label"),
              text: (document.activeElement.textContent ?? "")
                .trim()
                .slice(0, 200),
            }
          : null,
      dialogs: Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).map((dialog) => ({
        ariaLabel: dialog.getAttribute("aria-label"),
        headings: Array.from(dialog.querySelectorAll("h2")).map((heading) =>
          (heading.textContent ?? "").trim(),
        ),
        text: (dialog.textContent ?? "").trim().slice(0, 500),
      })),
      buttons: Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).map((button) => ({
        ariaLabel: button.getAttribute("aria-label"),
        text: (button.textContent ?? "").trim().slice(0, 200),
        disabled: button.disabled,
      })),
    }));
    let native:
      | {
          mode: GameStateView["mode"];
          scene: GameStateView["scene"];
          pendingAcquisition: GameStateView["pendingAcquisition"];
        }
      | { diagnosticError: string };
    try {
      const state = await getPackagedGameState();
      native = {
        mode: state.mode,
        scene: state.scene,
        pendingAcquisition: state.pendingAcquisition,
      };
    } catch (diagnosticError) {
      native = {
        diagnosticError:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
      };
    }
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `native=${JSON.stringify(native)}`,
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

export async function seedStoryCleared(): Promise<void> {
  await browser.execute((key: string) => {
    window.localStorage.setItem(key, "true");
  }, STORY_CLEARED_STORAGE_KEY);
  await reloadDocument("seedStoryCleared refresh");
  await waitForShell();
  // Assert persistence so storage-isolation failures surface during setup,
  // before the test body runs with a missing clearance flag.
  const value = await browser.execute((key: string) => {
    return window.localStorage.getItem(key);
  }, STORY_CLEARED_STORAGE_KEY);
  if (value !== "true") {
    throw new Error(
      `seedStoryCleared: ${STORY_CLEARED_STORAGE_KEY} did not persist across refresh (got ${JSON.stringify(value)})`,
    );
  }
}

/**
 * Undo {@link seedStoryCleared} from the title screen. The reload matters: the
 * frontend reads the flag into memory at startup and only persists a clear
 * while that copy is unset, so removing the key alone leaves a seeded run.
 */
export async function forgetStoryCleared(): Promise<void> {
  await browser.execute((key: string) => {
    window.localStorage.removeItem(key);
  }, STORY_CLEARED_STORAGE_KEY);
  await reloadDocument("forgetStoryCleared refresh");
  await waitForShell();
  const value = await browser.execute((key: string) => {
    return window.localStorage.getItem(key);
  }, STORY_CLEARED_STORAGE_KEY);
  if (value !== null) {
    throw new Error(
      `forgetStoryCleared: ${STORY_CLEARED_STORAGE_KEY} survived the refresh (got ${JSON.stringify(value)})`,
    );
  }
}

export async function jsClick(selector: string): Promise<void> {
  const ok = await browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!ok) throw new Error(`jsClick: no element for ${selector}`);
}

export async function jsClickButtonContaining(text: string): Promise<void> {
  const ok = await browser.execute((label: string) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(label),
    );
    if (!btn) return false;
    (btn as HTMLButtonElement).click();
    return true;
  }, text);
  if (!ok) throw new Error(`jsClickButtonContaining: no button with ${text}`);
}

/** Collect kagami_summary evidence and dismiss acquisition UI back to explore/dialogue.
 *
 * Acquisition popups are deferred while an authored on_collect dialogue queue
 * plays (game-client.svelte.ts buffers the notification until the queue
 * drains). So the 物證取得 popup does NOT appear immediately after clicking
 * the hotspot — it surfaces only once the on_collect dialogue finishes.
 * This mirrors the page.test.ts "delayed acquisition after dialogue" pattern:
 * drain dialogue first, then expect the popup, then CONTINUE. */
export async function collectKagamiSummaryEvidence(): Promise<void> {
  const hotspotSel = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
  await clickButton(anchors.hotspotEvidence.label);
  // Drain the on_collect dialogue queue. The popup surfaces once the queue
  // empties and the deferred acquisition notification flushes. If the hotspot
  // has no on_collect dialogue, the predicate is true on the first check and
  // this returns immediately.
  await advanceDialogueUntil(async () => {
    return browser.execute((heading: string) => {
      return Array.from(document.querySelectorAll('[role="dialog"]')).some(
        (d) =>
          Array.from(d.querySelectorAll("h2")).some((h) =>
            (h.textContent ?? "").includes(heading),
          ),
      );
    }, anchors.evidenceAcquired);
  }, 40);
  await jsClickButtonContaining("CONTINUE");
  // After CONTINUE, drain any residual dialogue until explore is usable again.
  await advanceDialogueUntil(async () => {
    if (await elementExists(`button[aria-label="${anchors.character.label}"]`))
      return true;
    return elementExists(hotspotSel);
  }, 40);
  // Dismissing the acquisition popup can trigger another autosave capture.
  // The explore DOM returns before its controls are interactive, so wait for
  // the next action used by callers instead of handing back a disabled button.
  await waitForButton(anchors.character.label, 90000);
}

async function p1PracticeHotspotIsInspected(
  accessibleName: string,
): Promise<boolean> {
  return browser.execute((name: string) => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.getAttribute("aria-label") === name);
    return (
      button?.classList.contains("done") === true ||
      button?.classList.contains("inspected") === true
    );
  }, accessibleName);
}

/**
 * Completes the authored P1 tutorial through the same hotspot and
 * analysis-board controls a fresh player uses. It deliberately never uses an
 * E2E checkpoint or a native state mutation.
 */
export async function completeP1PracticeTutorial(): Promise<void> {
  const { p1Practice } = anchors;
  const lastHotspotIndex = p1Practice.hotspotLabels.length - 1;

  // The fresh journey starts in scene_p0, so reach P1's exploration surface
  // through its authored dialogue rather than assuming the controls are
  // already mounted.
  try {
    await advanceDialogueUntil(
      () =>
        elementExists(`button[aria-label="${p1Practice.hotspotLabels[0]}"]`),
      DIALOGUE_DRAIN_CAP,
    );
  } catch (error) {
    throw new Error(
      `completeP1PracticeTutorial: prologue did not reach the P1 exploration surface ("${p1Practice.hotspotLabels[0]}"): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  for (const [index, hotspotLabel] of p1Practice.hotspotLabels.entries()) {
    try {
      await waitForButton(hotspotLabel, 90000);
      await clickButton(hotspotLabel);
      // Wait for the inspect command to enter its authored dialogue before the
      // drain predicate can observe the re-rendered exploration surface. The
      // final hotspot may settle straight into the analysis board once its
      // inspection dialogue is exhausted, so accept either the advance control
      // or the iteration's target state.
      const reachedTarget =
        index === lastHotspotIndex
          ? () => elementExists(`[aria-label="${p1Practice.analysisBoard}"]`)
          : () => p1PracticeHotspotIsInspected(hotspotLabel);
      await browser.waitUntil(
        async () =>
          (await reachedTarget()) || elementExists(advanceDialogueSelector),
        {
          timeout: 90000,
          interval: 100,
          timeoutMsg: `completeP1PracticeTutorial: hotspot "${hotspotLabel}" did not enter its inspection dialogue or reach its target state`,
        },
      );
      await advanceDialogueUntil(reachedTarget, 40);
    } catch (error) {
      const hotspotStage =
        index === lastHotspotIndex
          ? `did not open the analysis board ("${p1Practice.analysisBoard}")`
          : "did not complete inspection";
      throw new Error(
        `completeP1PracticeTutorial: hotspot "${hotspotLabel}" ${hotspotStage}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  for (const cardLabel of p1Practice.acceptedCards) {
    try {
      await clickButton(cardLabel);
    } catch (error) {
      throw new Error(
        `completeP1PracticeTutorial: accepting analysis card "${cardLabel}" failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  try {
    await clickButton(p1Practice.submit);
  } catch (error) {
    throw new Error(
      `completeP1PracticeTutorial: analysis-board submission ("${p1Practice.submit}") failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  // A correct submission transitions into the authored result dialogue. The
  // caller drains it and the remaining prologue to the existing KAGAMI anchor.
  try {
    await waitForButton(anchors.advanceDialogue, 90000);
  } catch (error) {
    throw new Error(
      `completeP1PracticeTutorial: post-submission result dialogue did not appear: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
