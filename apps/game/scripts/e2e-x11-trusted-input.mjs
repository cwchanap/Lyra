/**
 * HPA-831 scoped Linux/Xvfb trusted keyboard transport — pure, testable
 * verification logic. `e2e-tauri/helpers.ts` supplies the live `/proc`
 * process table and runs the bounded `xdotool`/`xprop` probes; this module
 * decides whether real XTEST keys may be sent at all.
 *
 * Never implicit: XTEST keys require BOTH Linux and an explicit
 * `LYRA_E2E_XVFB_TRUSTED_KEYS=1` environment opt-in. Even then every check
 * below must pass before any key is sent:
 *
 *   1. DISPLAY/XAUTHORITY are set, and DISPLAY is a local `:<n>` number.
 *   2. An `xvfb-run` process is a strict ANCESTOR of this WDIO worker — an
 *      Xvfb process merely serving the same display elsewhere in the table
 *      proves nothing about privacy.
 *   3. Exactly one Xvfb child of that xvfb-run serves the current DISPLAY
 *      (its `:<n>` argv token) AND is bound to the current XAUTHORITY via
 *      its `-auth` argv or its process environment — the xvfb-run private
 *      auth file this run inherited.
 *   4. The app process matches the shared owned-process selector (exact
 *      configured e2e binary via /proc/<pid>/exe, parented by this worker
 *      or the WDIO launcher).
 *   5. xdotool finds exactly one visible window owned by that app pid, and
 *      both `_NET_WM_PID` and `getwindowpid` agree with it.
 *   6. The X input focus sits on that window before and after each key.
 *
 * Every function throws rather than guess: the caller must surface the
 * failure as inconclusive coverage and must NOT fall back to OS-global
 * keys on a shared or unverified display.
 */

export const TRUSTED_XVFB_KEYS_ENV = "LYRA_E2E_XVFB_TRUSTED_KEYS";

/** DOM key name -> the keysym xdotool sends through XTEST. */
export const X11_TRUSTED_KEY_NAMES = { Enter: "Return", Tab: "Tab" };

export function trustedXvfbKeysOptIn({ platform, env }) {
  return platform === "linux" && env?.[TRUSTED_XVFB_KEYS_ENV] === "1";
}

export function assertTrustedXvfbKeysAllowed({ platform, env }) {
  if (platform !== "linux") {
    throw new Error(
      `XTEST trusted keys exist only for the scoped Linux/Xvfb path; ${platform} must use its documented channel`,
    );
  }
  if (env?.[TRUSTED_XVFB_KEYS_ENV] !== "1") {
    throw new Error(
      `XTEST trusted keys are opt-in: set ${TRUSTED_XVFB_KEYS_ENV}=1 only on a private xvfb-run display; refusing OS-global keys implicitly`,
    );
  }
}

function baseName(pathValue) {
  const slash = pathValue.lastIndexOf("/");
  return slash === -1 ? pathValue : pathValue.slice(slash + 1);
}

/**
 * xvfb-run is a shell script: under Linux `comm` keeps the script basename,
 * and the interpreter form (`sh /usr/bin/xvfb-run ...`) still carries the
 * script path in argv. A process is xvfb-run only when one of those is the
 * exact basename — a `run-xvfb-run.sh` look-alike does not match.
 */
function isXvfbRunProcess(entry) {
  if (entry.comm === "xvfb-run") return true;
  return (entry.argv ?? []).some((arg) => baseName(arg) === "xvfb-run");
}

function isXvfbProcess(entry) {
  if (entry.comm === "Xvfb") return true;
  const [program] = entry.argv ?? [];
  return typeof program === "string" && baseName(program) === "Xvfb";
}

/**
 * The display an Xvfb serves is its `:<n>` argv token (`Xvfb :99 ...`).
 * `-displayfd` mode carries no such token, so the served display cannot be
 * proven from argv — the caller fails closed.
 */
function xvfbServedDisplayNumber(entry) {
  for (const arg of (entry.argv ?? []).slice(1)) {
    const match = /^:(\d+)(?:\.\d+)?$/.exec(arg);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Evidence that this Xvfb reads the run's private auth file: an `-auth`
 * argv value (some xvfb-run variants) or the XAUTHORITY recorded in the
 * Xvfb process's own environment (Debian-derived scripts export it).
 */
function xvfbAuthorityBinding(entry) {
  const argv = entry.argv ?? [];
  const authIndex = argv.indexOf("-auth");
  const authArg = authIndex === -1 ? null : (argv[authIndex + 1] ?? null);
  const envEntry = (entry.environ ?? []).find((pair) =>
    pair.startsWith("XAUTHORITY="),
  );
  return {
    authArg,
    envAuthority: envEntry?.slice("XAUTHORITY=".length) ?? null,
  };
}

/** `:<n>` or `:<n>.<screen>` -> n; anything else (remote/host forms) -> null. */
export function parseLocalDisplayNumber(display) {
  const match = /^:(\d+)(?:\.\d+)?$/.exec(display ?? "");
  return match === null ? null : Number(match[1]);
}

/**
 * Prove this worker runs under a private xvfb-run display owned by this
 * test-run ancestry. `processes` is the live `/proc` table
 * (`{pid, ppid, comm, argv, exe, environ}`). Returns the verified
 * `{xvfbRunPid, xvfbPid}` pair or throws — uncertainty always fails closed.
 */
export function verifyPrivateXvfbAncestry({
  processes,
  currentPid,
  display,
  xauthority,
}) {
  if (typeof display !== "string" || display.length === 0) {
    throw new Error(
      "trusted XTEST keys require a private xvfb-run display but DISPLAY is unset; refusing OS-global keys on an unverified display",
    );
  }
  const displayNumber = parseLocalDisplayNumber(display);
  if (displayNumber === null) {
    throw new Error(
      `trusted XTEST keys require a local xvfb-run DISPLAY, got ${JSON.stringify(display)}; refusing OS-global keys on an unverified display`,
    );
  }
  if (typeof xauthority !== "string" || xauthority.length === 0) {
    throw new Error(
      `trusted XTEST keys require the xvfb-run private auth file but XAUTHORITY is unset for DISPLAY ${display}; refusing OS-global keys on an unverified display`,
    );
  }

  const byPid = new Map();
  for (const entry of processes) byPid.set(entry.pid, entry);
  const self = byPid.get(currentPid);
  if (self === undefined) {
    throw new Error(
      `worker pid ${currentPid} is missing from the process table — xvfb-run ancestry cannot be proven; refusing XTEST keys`,
    );
  }

  // Walk strict ancestors of the worker until an xvfb-run process appears.
  // A matching Xvfb anywhere else in the table is not evidence of privacy.
  let xvfbRun = null;
  const visited = new Set([currentPid]);
  let cursor = self;
  while (cursor.ppid > 1 && !visited.has(cursor.ppid)) {
    const parent = byPid.get(cursor.ppid);
    if (parent === undefined) break;
    visited.add(parent.pid);
    if (isXvfbRunProcess(parent)) {
      xvfbRun = parent;
      break;
    }
    cursor = parent;
  }
  if (xvfbRun === null) {
    throw new Error(
      `no xvfb-run process is an ancestor of worker pid ${currentPid}: DISPLAY ${display} is not provably private to this test run — refusing XTEST keys on a shared/unverified display`,
    );
  }

  // The privacy proof is the ownership edge: xvfb-run spawned BOTH this
  // worker's ancestry and the Xvfb that serves our DISPLAY. An Xvfb with a
  // matching display but any other parent is a foreign server — reject.
  const serving = processes.filter(
    (entry) =>
      entry.ppid === xvfbRun.pid &&
      isXvfbProcess(entry) &&
      xvfbServedDisplayNumber(entry) === displayNumber,
  );
  if (serving.length === 0) {
    const children = processes
      .filter((entry) => entry.ppid === xvfbRun.pid && isXvfbProcess(entry))
      .map(
        (entry) => `${entry.pid} (display :${xvfbServedDisplayNumber(entry)})`,
      )
      .join(", ");
    throw new Error(
      `xvfb-run pid ${xvfbRun.pid} has no Xvfb child serving DISPLAY ${display} (Xvfb children: ${children || "none"}) — the display is not provably owned by this run; refusing XTEST keys`,
    );
  }
  if (serving.length !== 1) {
    throw new Error(
      `xvfb-run pid ${xvfbRun.pid} has ${serving.length} Xvfb children serving DISPLAY ${display} [${serving.map((entry) => entry.pid).join(", ")}]; refusing XTEST keys on an ambiguous display`,
    );
  }

  const xvfb = serving[0];
  const { authArg, envAuthority } = xvfbAuthorityBinding(xvfb);
  if (authArg !== xauthority && envAuthority !== xauthority) {
    throw new Error(
      `Xvfb pid ${xvfb.pid} serving DISPLAY ${display} is not bound to this run's XAUTHORITY ${xauthority} (-auth argv: ${authArg ?? "absent"}, environ: ${envAuthority ?? "absent"}) — display privacy cannot be proven; refusing XTEST keys`,
    );
  }
  return { xvfbRunPid: xvfbRun.pid, xvfbPid: xvfb.pid };
}

/** Parse `xdotool search --onlyvisible --pid` stdout into window ids. */
export function parseXdotoolWindowIds(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const id = Number(line);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(
          `unparseable xdotool window id line ${JSON.stringify(line)}; refusing XTEST keys`,
        );
      }
      return id;
    });
}

/**
 * The target must be exactly one visible window owned by the app pid —
 * zero means the app window is gone (unverified), more than one means the
 * delivery target is ambiguous. Both fail closed.
 */
export function selectUniqueX11WindowId({ searchOutput, appPid }) {
  const unique = [...new Set(parseXdotoolWindowIds(searchOutput))];
  if (unique.length === 0) {
    throw new Error(
      `xdotool search --onlyvisible --pid ${appPid} found no visible window — the e2e app window is unverified; refusing XTEST keys`,
    );
  }
  if (unique.length !== 1) {
    throw new Error(
      `xdotool search --onlyvisible --pid ${appPid} found ${unique.length} visible windows [${unique.join(", ")}] — the XTEST target is ambiguous; refusing XTEST keys`,
    );
  }
  return unique[0];
}

/** `_NET_WM_PID(CARDINAL) = 583` -> 583; "not found"/garbage -> null. */
export function parseNetWmPid(output) {
  const match = /_NET_WM_PID\(\w+\)\s*=\s*(\d+)/.exec(output);
  return match === null ? null : Number(match[1]);
}

/**
 * Single positive integer on stdout (`xdotool getwindowpid`,
 * `xdotool getwindowfocus`) -> the number; anything else -> null.
 */
export function parseXdotoolDecimal(output) {
  const value = output.trim();
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
