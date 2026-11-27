import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { userInfo } from "node:os";
import { promisify } from "node:util";

/**
 * Scoped Linux/Xvfb trusted input transport and shared runner/worker
 * verification. `e2e-tauri/helpers.ts` supplies bounded window and pointer
 * probes; this module decides whether real XTEST input may be sent at all.
 *
 * Never implicit: XTEST input requires BOTH Linux and an explicit
 * `LYRA_E2E_XVFB_TRUSTED_KEYS=1` environment opt-in. Even then every check
 * below must pass before any event is sent:
 *
 *   1. DISPLAY/XAUTHORITY are set, and DISPLAY is a local `:<n>` number.
 *   2. XAUTHORITY names a securely permissioned run-private authority
 *      file — a regular file owned by this user with no group/other
 *      access, inside an equally private directory.
 *   3. That file contains at least one USABLE cookie record for this
 *      display (parsed Xau records, non-empty name+data). An empty or
 *      malformed authority file passes steps 2 but leaves Xorg accepting
 *      local connections without credentials.
 *   4. Live enforcement proof: an authorized X connection must succeed
 *      AND an unauthenticated one must be actively rejected (bounded
 *      probes, no key material logged).
 *   5. An `xvfb-run` process is a strict ANCESTOR of this WDIO worker — an
 *      Xvfb process merely serving the same display elsewhere in the table
 *      proves nothing about privacy.
 *   6. Exactly one Xvfb child of that xvfb-run serves the current DISPLAY
 *      (its `:<n>` argv token), does NOT run `-ac` (X access control
 *      disabled), and carries exactly one `-auth` argument equal to the
 *      current XAUTHORITY. Server authentication evidence lives in argv:
 *      an inherited XAUTHORITY environment alone does not enforce cookies
 *      (a run with XAUTHORITY=/dev/null still accepts connections).
 *   7. The app process matches the shared owned-process selector (exact
 *      configured e2e binary via /proc/<pid>/exe, parented by this worker
 *      or the WDIO launcher).
 *   8. xdotool finds exactly one visible window owned by that app pid, and
 *      both `_NET_WM_PID` and `getwindowpid` agree with it.
 *   9. The X input focus sits on that window before and after each event.
 *  10. Scene-nav and allowlisted investigation pointer events additionally
 *      require a hit-tested target, matching window geometry and pointer ownership.
 *
 * Every function throws rather than guess: the caller must surface the
 * failure as inconclusive coverage and must NOT fall back to OS-global
 * input on a shared or unverified display. Authorization also covers only
 * the seven named investigation targets below, never arbitrary targets.
 */

export const TRUSTED_XVFB_KEYS_ENV = "LYRA_E2E_XVFB_TRUSTED_KEYS";
export const X11_POINTER_STATE_FILENAME = "x11-pointer-state.json";
const revokedDisplaysKey = Symbol.for("lyra.e2e.x11.revokedDisplays");
const locallyRevokedDisplays = (globalThis[revokedDisplaysKey] ??= new Set());

export function createX11PointerState(statePath) {
  if (typeof statePath !== "string" || !path.isAbsolute(statePath)) {
    throw new Error("A runner-owned X11 pointer state path is required.");
  }
  const read = () => {
    const metadata = lstatSync(statePath);
    const directory = lstatSync(path.dirname(statePath));
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (process.geteuid &&
        (metadata.uid !== process.geteuid() ||
          directory.uid !== process.geteuid() ||
          (metadata.mode & 0o077) !== 0 ||
          (directory.mode & 0o022) !== 0))
    ) {
      throw new Error(
        "X11 pointer state is not a securely owned regular file.",
      );
    }
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (
      !state ||
      !["safe", "possible", "held", "poisoned"].includes(state.status) ||
      (["possible", "held"].includes(state.status) &&
        !["wheel", "click"].includes(state.button)) ||
      (state.testActive !== undefined && typeof state.testActive !== "boolean")
    ) {
      throw new Error("X11 pointer state is invalid.");
    }
    return state;
  };
  const write = (state) => {
    const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(state), {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, statePath);
  };
  const assertAllowed = (action) => {
    if (locallyRevokedDisplays.has(statePath)) {
      throw new Error("X11 display is unsafe after test termination.");
    }
    const state = read();
    if (
      (state.status === "safe" && !action.endsWith("-release")) ||
      (["possible", "held"].includes(state.status) &&
        action === `${state.button}-release`)
    ) {
      return;
    }
    throw new Error(`X11 display is unsafe for ${action}: ${state.status}`);
  };
  return {
    initialize() {
      writeFileSync(statePath, JSON.stringify({ status: "safe" }), {
        flag: "wx",
        mode: 0o600,
      });
    },
    read,
    isSafe() {
      try {
        const state = read();
        return state.status === "safe" && !state.testActive;
      } catch {
        return false;
      }
    },
    assertAllowed,
    beginTest() {
      assertAllowed("key");
      const state = read();
      if (state.status !== "safe" || state.testActive) {
        throw new Error("X11 display is unsafe for a new test.");
      }
      write({ ...state, testActive: true });
    },
    finishTest(completed) {
      const state = read();
      if (!state.testActive) {
        if (state.status === "poisoned") return;
        throw new Error("X11 test ownership was lost.");
      }
      if (
        locallyRevokedDisplays.has(statePath) ||
        !completed ||
        state.status !== "safe"
      ) {
        locallyRevokedDisplays.add(statePath);
        write({ ...state, status: "poisoned", testActive: false });
      } else {
        write({ status: "safe" });
      }
    },
    abortActiveTest() {
      const state = read();
      if (state.testActive) {
        locallyRevokedDisplays.add(statePath);
        write({ ...state, status: "poisoned", testActive: false });
      }
    },
    beginPress(button) {
      assertAllowed(`${button}-press`);
      write({ ...read(), status: "possible", button });
    },
    confirmPress(button) {
      const state = read();
      if (state.status !== "possible" || state.button !== button) {
        throw new Error("X11 pointer press state changed unexpectedly.");
      }
      write({ ...state, status: "held", button });
    },
    confirmRelease(button) {
      const state = read();
      if (
        !["possible", "held"].includes(state.status) ||
        state.button !== button
      ) {
        throw new Error("X11 pointer release state changed unexpectedly.");
      }
      if (state.status === "held") {
        write({ ...state, status: "safe", button: undefined });
      } else {
        write({ ...state, status: "poisoned" });
      }
    },
  };
}

export async function deliverX11PointerPair({
  pointerState,
  button,
  press,
  release,
}) {
  pointerState.assertAllowed(`${button}-press`);
  let pressFailed = false;
  let pressError;
  try {
    await press();
  } catch (error) {
    pressFailed = true;
    pressError = error;
  }
  const state = pointerState.read();
  if (["possible", "held"].includes(state.status)) {
    if (state.button !== button) {
      throw new Error("A different X11 pointer button may be held.");
    }
    await release();
  } else if (!pressFailed) {
    throw new Error("X11 pointer press was not tracked.");
  }
  if (pressFailed) throw pressError;
  if (pointerState.read().status !== "safe") {
    throw new Error("X11 pointer release was not verified.");
  }
}

export function describeX11InputError(error) {
  return (
    (error instanceof Error ? error.message : String(error)) ||
    "Unknown X11 input error"
  );
}

export function assertX11DisplaySafe(
  getPointerState,
  bail,
  { abortActive = false } = {},
) {
  try {
    const pointerState = getPointerState();
    if (abortActive) pointerState.abortActiveTest();
    pointerState.assertAllowed("key");
  } catch (error) {
    bail();
    throw error;
  }
}

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
 * The `-auth <file>` values on an Xvfb command line, in order. `-auth` is
 * the server's authoritative authentication file; `-ac` disables access
 * control outright. An inherited XAUTHORITY environment variable is NOT
 * evidence — the server only reads it when no `-auth` is given, and a run
 * with XAUTHORITY=/dev/null still accepts read-only connections, so
 * environment alone can never prove cookie enforcement.
 */
function xvfbAuthArguments(entry) {
  const argv = entry.argv ?? [];
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "-auth") values.push(argv[index + 1] ?? null);
  }
  return values;
}

/**
 * The run-private authority file evidence, gathered by the caller from
 * fs.stat: a regular file owned by this user with no group/other
 * permission bits, inside a directory equally owned and permissioned.
 * Anything else (missing, foreign-owned, group/world-readable, or a
 * loosely permissioned parent directory another principal could replace
 * files in) leaves the "private" authority forgeable — fail closed.
 */
function assertSecureAuthorityFile({ authorityFile, xauthority }) {
  const evidence = authorityFile ?? {};
  const describe = `file(isFile=${evidence.isFile ?? "?"},mode=${typeof evidence.mode === "number" ? `0${(evidence.mode & 0o777).toString(8)}` : "?"},uid=${evidence.uid ?? "?"}) dir(isDirectory=${evidence.dirIsDirectory ?? "?"},mode=${typeof evidence.dirMode === "number" ? `0${(evidence.dirMode & 0o777).toString(8)}` : "?"},uid=${evidence.dirUid ?? "?"}) euid=${evidence.euid ?? "?"}`;
  if (
    evidence.isFile !== true ||
    evidence.dirIsDirectory !== true ||
    typeof evidence.mode !== "number" ||
    typeof evidence.dirMode !== "number" ||
    (evidence.mode & 0o077) !== 0 ||
    (evidence.dirMode & 0o077) !== 0 ||
    evidence.uid !== evidence.euid ||
    evidence.dirUid !== evidence.euid
  ) {
    throw new Error(
      `XAUTHORITY ${xauthority} is not a securely permissioned run-private authority file (${describe}) — display privacy cannot be proven; refusing XTEST keys`,
    );
  }
}

/**
 * Parse an Xauthority file's Xau records. Each record is big-endian:
 * CARD16 family, CARD16 address-length + bytes, CARD16 number-length +
 * bytes, CARD16 name-length + bytes, CARD16 data-length + bytes — packed,
 * no padding. The cookie `data` is skipped, never retained or returned:
 * only `dataLength` is exposed, so cookie bytes can never reach a log or
 * error message. A trailing partial record makes the whole file malformed
 * (throws) — a file Xorg could not fully load is not proof of enforcement.
 */
export function parseXauthorityRecords(content) {
  if (!(content instanceof Uint8Array)) {
    throw new Error(
      `authority file content is not bytes (${typeof content}) — cannot prove usable cookie records`,
    );
  }
  const records = [];
  let offset = 0;
  const u16 = () => {
    if (offset + 2 > content.length) {
      throw new Error(
        `authority file is malformed: truncated field at offset ${offset} of ${content.length} bytes`,
      );
    }
    const value = (content[offset] << 8) | content[offset + 1];
    offset += 2;
    return value;
  };
  const field = () => {
    const length = u16();
    if (offset + length > content.length) {
      throw new Error(
        `authority file is malformed: field of ${length} bytes overruns ${content.length}-byte file`,
      );
    }
    const value = content.slice(offset, offset + length);
    offset += length;
    return value;
  };
  while (offset < content.length) {
    const family = u16();
    const address = Buffer.from(field()).toString("utf8");
    const number = Buffer.from(field()).toString("utf8");
    const name = Buffer.from(field()).toString("utf8");
    const data = field();
    records.push({ family, address, number, name, dataLength: data.length });
  }
  return records;
}

/**
 * `assertSecureAuthorityFile` proves the file is private; this proves it
 * is USEFUL — at least one well-formed Xau record for this display with a
 * non-empty auth name and cookie data. An empty file (the reviewer's
 * 0600/0700 size-0 reproduction), a truncated record, or records that
 * cover no display we connect to all leave Xorg accepting unauthenticated
 * local clients — fail closed on every one.
 */
export function assertUsableAuthorityCookies({
  authorityFile,
  displayNumber,
  xauthority,
}) {
  let records;
  try {
    records = parseXauthorityRecords(authorityFile?.content);
  } catch (error) {
    const err = error ?? {};
    throw new Error(
      `XAUTHORITY ${xauthority} yields no provable cookie records (${typeof err.message === "string" ? err.message : String(error)}) — Xorg treats an unloadable authority file as no enforcement; refusing XTEST keys`,
      { cause: error },
    );
  }
  const usable = records.filter(
    (record) =>
      record.number === String(displayNumber) &&
      record.name.length > 0 &&
      record.dataLength > 0,
  );
  if (usable.length === 0) {
    const seen =
      records.length === 0
        ? "no cookie records at all"
        : `records only for [${records
            .map(
              (record) =>
                `display ${JSON.stringify(record.number)}, ${record.name.length ? "named" : "unnamed"} auth, ${record.dataLength}-byte cookie`,
            )
            .join("; ")}]`;
    throw new Error(
      `XAUTHORITY ${xauthority} holds no usable cookie for display :${displayNumber} (${seen}) — Xorg treats zero supported records as no enforcement; refusing XTEST keys`,
    );
  }
}

/** `:<n>` or `:<n>.<screen>` -> n; anything else (remote/host forms) -> null. */
export function parseLocalDisplayNumber(display) {
  const match = /^:(\d+)(?:\.\d+)?$/.exec(display ?? "");
  return match === null ? null : Number(match[1]);
}

/**
 * Prove this worker runs under a private xvfb-run display owned by this
 * test-run ancestry. `processes` is the live `/proc` table
 * (`{pid, ppid, comm, argv, exe}`) and `authorityFile` the caller-gathered
 * fs.stat + content evidence for XAUTHORITY. Returns the verified
 * `{xvfbRunPid, xvfbPid}` pair or throws — uncertainty always fails closed.
 */
export function verifyPrivateXvfbAncestry({
  processes,
  currentPid,
  display,
  xauthority,
  authorityFile,
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
  assertSecureAuthorityFile({ authorityFile, xauthority });
  assertUsableAuthorityCookies({ authorityFile, displayNumber, xauthority });

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
  // Every ancestor present in the table is checked — including PID 1, which
  // IS xvfb-run in a container whose entrypoint is `xvfb-run -a ...`.
  let xvfbRun = null;
  const visited = new Set([currentPid]);
  let cursor = self;
  for (;;) {
    const parent = byPid.get(cursor.ppid);
    if (parent === undefined || visited.has(parent.pid)) break;
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
  if ((xvfb.argv ?? []).includes("-ac")) {
    throw new Error(
      `Xvfb pid ${xvfb.pid} serving DISPLAY ${display} runs with -ac — X access control is disabled and any client may connect; display privacy cannot be proven; refusing XTEST keys`,
    );
  }
  const authArguments = xvfbAuthArguments(xvfb);
  if (authArguments.length !== 1 || authArguments[0] !== xauthority) {
    const found =
      authArguments.length === 0
        ? "no -auth — an inherited XAUTHORITY environment alone does not prove server cookie enforcement"
        : `${authArguments.length} -auth arguments [${authArguments.map((value) => value ?? "missing value").join(", ")}]`;
    throw new Error(
      `Xvfb pid ${xvfb.pid} serving DISPLAY ${display} does not bind this run's XAUTHORITY ${xauthority} through exactly one -auth argument (${found}) — display privacy cannot be proven; refusing XTEST keys`,
    );
  }
  return { xvfbRunPid: xvfbRun.pid, xvfbPid: xvfb.pid };
}

function xvfbClaimPath(identity, create) {
  const uid = process.geteuid?.();
  const home = realpathSync(userInfo().homedir);
  const homeStat = lstatSync(home);
  if (
    !Number.isInteger(uid) ||
    !homeStat.isDirectory() ||
    homeStat.uid !== uid ||
    (homeStat.mode & 0o022) !== 0
  ) {
    throw new Error("Xvfb claim home directory is not secure.");
  }
  const cache = path.join(home, ".cache");
  const registry = path.join(cache, "lyra-e2e-x11-claims");
  for (const [directory, forbiddenMode] of [
    [cache, 0o022],
    [registry, 0o077],
  ]) {
    if (create) {
      try {
        mkdirSync(directory, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    const metadata = lstatSync(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== uid ||
      (metadata.mode & forbiddenMode) !== 0
    ) {
      throw new Error("Xvfb claim registry is not secure.");
    }
  }
  const authorityKey = createHash("sha256")
    .update(path.resolve(identity.xauthority))
    .digest("hex");
  return path.join(registry, `.lyra-e2e-x11-claim-${authorityKey}.json`);
}

function readAuthorityEvidence(xauthority) {
  if (typeof xauthority !== "string" || !path.isAbsolute(xauthority)) {
    throw new Error("XAUTHORITY must be an absolute private file.");
  }
  const directory = path.dirname(xauthority);
  const file = lstatSync(xauthority);
  const dir = lstatSync(directory);
  if (
    file.nlink !== 1 ||
    realpathSync(xauthority) !== path.resolve(xauthority) ||
    realpathSync(directory) !== path.resolve(directory)
  ) {
    throw new Error("XAUTHORITY must not use symbolic or hard links.");
  }
  const evidence = {
    isFile: file.isFile(),
    mode: file.mode & 0o777,
    uid: file.uid,
    dirIsDirectory: dir.isDirectory(),
    dirMode: dir.mode & 0o777,
    dirUid: dir.uid,
    euid: process.geteuid?.() ?? -1,
  };
  assertSecureAuthorityFile({ authorityFile: evidence, xauthority });
  return { ...evidence, content: readFileSync(xauthority) };
}

function privateAuthorityDirectory(xauthority, display) {
  const displayNumber = parseLocalDisplayNumber(display);
  if (displayNumber === null)
    throw new Error("X11 display identity is unknown.");
  const authorityFile = readAuthorityEvidence(xauthority);
  assertUsableAuthorityCookies({ authorityFile, displayNumber, xauthority });
  return path.dirname(xauthority);
}

function linuxProcessTable() {
  const entries = [];
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
        .filter(Boolean);
      let exe = null;
      try {
        exe = readlinkSync(`/proc/${name}/exe`);
      } catch {
        // An unreadable executable cannot identify the owned app.
      }
      entries.push({
        pid: Number(name),
        ppid,
        comm,
        argv,
        exe,
        start: fields[19],
      });
    } catch {
      // Processes can disappear during the scan.
    }
  }
  return entries;
}

export async function verifyLivePrivateXvfbSession({
  env = process.env,
  currentPid = process.pid,
  probe = (authority) =>
    promisify(execFile)("xdpyinfo", [], {
      timeout: 10_000,
      env: { ...env, XAUTHORITY: authority },
    }),
} = {}) {
  assertTrustedXvfbKeysAllowed({ platform: process.platform, env });
  const xauthority = env.XAUTHORITY;
  const display = env.DISPLAY;
  const processes = linuxProcessTable();
  const authorityFile =
    typeof xauthority === "string" && xauthority.length > 0
      ? readAuthorityEvidence(xauthority)
      : undefined;
  const identity = verifyPrivateXvfbAncestry({
    processes,
    currentPid,
    display,
    xauthority,
    authorityFile,
  });
  const xvfbStart = processes.find(
    (entry) => entry.pid === identity.xvfbPid,
  )?.start;
  if (!/^[1-9]\d*$/.test(xvfbStart ?? "")) {
    throw new Error("Xvfb process start identity is unknown.");
  }
  await assertX11AuthenticationEnforced({ display, xauthority, probe });
  return { ...identity, xvfbStart, display, xauthority, processes };
}

function validateXvfbClaimIdentity(identity) {
  if (
    !Number.isSafeInteger(identity.xvfbPid) ||
    identity.xvfbPid <= 0 ||
    !Number.isSafeInteger(identity.xvfbRunPid) ||
    identity.xvfbRunPid <= 0 ||
    !Number.isSafeInteger(identity.runnerPid) ||
    identity.runnerPid <= 0 ||
    typeof identity.xvfbStart !== "string" ||
    !/^[1-9]\d*$/.test(identity.xvfbStart) ||
    typeof identity.pointerStatePath !== "string" ||
    !path.isAbsolute(identity.pointerStatePath)
  ) {
    throw new Error("Xvfb runner identity is unknown.");
  }
  return privateAuthorityDirectory(identity.xauthority, identity.display);
}

export function claimXvfbDisplay(identity) {
  validateXvfbClaimIdentity(identity);
  const {
    xauthority,
    display,
    xvfbPid,
    xvfbRunPid,
    xvfbStart,
    runnerPid,
    pointerStatePath,
  } = identity;
  writeFileSync(
    xvfbClaimPath(identity, true),
    JSON.stringify({
      xauthority,
      display,
      xvfbPid,
      xvfbRunPid,
      xvfbStart,
      runnerPid,
      pointerStatePath,
    }),
    { flag: "wx", mode: 0o600 },
  );
}

export function assertXvfbDisplayClaim({ processes, currentPid, ...identity }) {
  validateXvfbClaimIdentity({ ...identity, runnerPid: 1 });
  const claimPath = xvfbClaimPath(identity, false);
  const metadata = lstatSync(claimPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.uid !== process.geteuid?.() ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size > 4096
  ) {
    throw new Error("Xvfb runner claim is not a secure regular file.");
  }
  const claim = JSON.parse(readFileSync(claimPath, "utf8"));
  if (!Number.isSafeInteger(claim?.runnerPid) || claim.runnerPid <= 0) {
    throw new Error("Xvfb runner identity is unknown.");
  }
  for (const key of [
    "xauthority",
    "display",
    "xvfbPid",
    "xvfbRunPid",
    "xvfbStart",
    "pointerStatePath",
  ]) {
    if (claim?.[key] !== identity[key]) {
      throw new Error("Xvfb runner claim does not match this display.");
    }
  }
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const seen = new Set();
  const worker = byPid.get(currentPid);
  let cursor = worker && byPid.get(worker.ppid);
  while (
    cursor &&
    !seen.has(cursor.pid) &&
    cursor.pid !== identity.xvfbRunPid
  ) {
    seen.add(cursor.pid);
    if (cursor.pid === claim.runnerPid) return;
    cursor = byPid.get(cursor.ppid);
  }
  throw new Error("Xvfb runner claim is not an ancestor of this worker.");
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

/**
 * `_NET_WM_PID` and `xdotool getwindowpid` must BOTH equal the verified app
 * pid. `xdotool search --pid` already filtered on the first, but a stale
 * window id, a reparented/foreign window, or a racing map can still slip
 * one probe — a mismatch on either fails closed rather than keying an
 * unverified window.
 */
export function assertX11WindowOwnership({
  windowId,
  netWmPid,
  windowOwnerPid,
  appPid,
}) {
  if (netWmPid !== appPid) {
    throw new Error(
      `window ${windowId} reports _NET_WM_PID ${netWmPid ?? "absent"}, expected verified e2e app pid ${appPid} — refusing XTEST keys to an unverified window`,
    );
  }
  if (windowOwnerPid !== appPid) {
    throw new Error(
      `xdotool getwindowpid ${windowId} reports ${windowOwnerPid ?? "unparseable"}, expected verified e2e app pid ${appPid} — refusing XTEST keys to an unverified window`,
    );
  }
}

/**
 * The preflight -> focus -> key -> post-focus delivery sequence, shared by
 * production (`sendXvfbTrustedKey` in helpers.ts) and the orchestration
 * tests — never mirrored. `resolveTarget` performs all private-display,
 * process, and window verification and may throw before ANY xdotool
 * command runs; `run` executes one bounded `xdotool` argv call and returns
 * stdout. The X input focus must belong to the verified window before the
 * key is sent (`windowfocus --sync` reasserts it in the no-WM
 * environment) and is re-checked after delivery; any failure aborts
 * before `key` is delivered and a post-delivery focus loss still fails
 * inconclusive. Focus probes use `getwindowfocus -f`: at the legitimate
 * initial PointerRoot state a bare `getwindowfocus` exits non-zero with
 * "XGetInputFocus ... BadWindow" (observed in the packaged image), while
 * `-f` prints the PointerRoot id and exits 0 — a non-target id still
 * drives `windowfocus --sync`, never the key. The checks narrow but
 * cannot eliminate the focus race (another client could take focus
 * between the check and the XTEST event), so the opt-in stays limited to
 * the private xvfb-run runner.
 */
export async function deliverXvfbTrustedKey({
  key,
  resolveTarget,
  run,
  pointerState,
}) {
  pointerState.assertAllowed("key");
  const keyName = X11_TRUSTED_KEY_NAMES[key];
  if (typeof keyName !== "string") {
    throw new Error(
      `unsupported trusted X11 key ${JSON.stringify(key)} — refusing to send XTEST keys`,
    );
  }
  const { appPid, windowId } = await resolveTarget();
  const xdotool = async (args) => {
    try {
      return await run(args);
    } catch (error) {
      const err = error ?? {};
      const detail = [err.message, err.stderr]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(" | ");
      throw new Error(
        `trusted ${key} delivery to window ${windowId} (e2e app pid ${appPid}) failed — xdotool ${args[0]}: ${detail || String(error)}; keyboard coverage is inconclusive`,
        { cause: error },
      );
    }
  };
  const focusedWindow = async () =>
    parseXdotoolDecimal(await xdotool(["getwindowfocus", "-f"]));

  if ((await focusedWindow()) !== windowId) {
    pointerState.assertAllowed("key");
    await xdotool(["windowfocus", "--sync", String(windowId)]);
    const focused = await focusedWindow();
    if (focused !== windowId) {
      throw new Error(
        `X input focus did not move to verified window ${windowId} (focused: ${focused ?? "unparseable"}) — refusing trusted ${key}; keyboard coverage is inconclusive`,
      );
    }
  }
  pointerState.assertAllowed("key");
  await xdotool(["key", keyName]);
  const focusedAfter = await focusedWindow();
  if (focusedAfter !== windowId) {
    throw new Error(
      `X input focus left verified window ${windowId} (now ${focusedAfter ?? "unparseable"}) while delivering trusted ${key}; keyboard coverage is inconclusive`,
    );
  }
}

const SCENE_NAV_POINTER_ACTIONS = {
  move: null,
  "wheel-press": ["mousedown", "7"],
  "wheel-release": ["mouseup", "7"],
  "click-press": ["mousedown", "1"],
  "click-release": ["mouseup", "1"],
};

const INVESTIGATION_POINTER_TARGETS = Object.freeze({
  stacked_ledgers: ["chapter_1", "investigation_scene_8", "office_corner"],
  workorder: ["chapter_1", "investigation_scene_9", "contractor_desk"],
  access_permission_list: [
    "chapter_1",
    "investigation_scene_9",
    "contractor_desk",
  ],
  material_kit_list: ["chapter_1", "investigation_scene_9", "contractor_desk"],
  to_confront: ["chapter_1", "investigation_scene_9", "contractor_desk"],
  stream_wall_screen: [
    "chapter_2",
    "investigation_scene_4",
    "stream_wall_plaza",
  ],
  ob_van_monitor: [
    "chapter_2",
    "investigation_scene_4",
    "control_room_perimeter",
  ],
});

export function isAuthorizedInvestigationPointerId(id) {
  return (
    typeof id === "string" && Object.hasOwn(INVESTIGATION_POINTER_TARGETS, id)
  );
}

export function assertInvestigationPointerEvents(events, id) {
  if (!isAuthorizedInvestigationPointerId(id)) {
    throw new Error("Unauthorized investigation pointer target");
  }
  const trusted = events.filter((event) => event.trusted);
  if (trusted.length === 0) return false;
  if (
    trusted.length !== 3 ||
    trusted.some(
      (event, index) =>
        event.type !== ["pointerdown", "pointerup", "click"][index] ||
        event.targetId !== id,
    )
  ) {
    throw new Error(
      "Trusted investigation pointer delivery was partial or retargeted",
    );
  }
  return true;
}

export async function deliverXvfbTrustedInvestigationPointer({
  id,
  action,
  readState,
  measureTarget,
  resolveTarget,
  run,
  readRootPointer,
  pointerState,
}) {
  if (
    !isAuthorizedInvestigationPointerId(id) ||
    !["move", "click-press", "click-release"].includes(action)
  ) {
    throw new Error("Unauthorized investigation pointer request");
  }
  pointerState.assertAllowed(action);
  const [chapter, scene, sublocation] = INVESTIGATION_POINTER_TARGETS[id];
  const sample = async () => {
    const state = await readState();
    if (
      state?.chapter?.id !== chapter ||
      state?.scene?.kind !== "investigation" ||
      state.scene.id !== scene ||
      state.scene.currentSublocationId !== sublocation ||
      state?.mode?.type !== "explore" ||
      state.pendingAcquisition
    ) {
      throw new Error("Unauthorized investigation pointer scene or mode");
    }
    const target = await measureTarget(id);
    if (target?.hitTarget !== id) {
      throw new Error("Investigation pointer hit-test mismatch");
    }
    return target;
  };
  const target = await sample();
  return deliverXvfbTrustedPointer({
    action,
    target,
    resolveTarget,
    run,
    readRootPointer,
    pointerState,
    revalidate: async () => {
      const fresh = await sample();
      if (
        fresh.point?.x !== target.point?.x ||
        fresh.point?.y !== target.point?.y ||
        fresh.viewport?.width !== target.viewport?.width ||
        fresh.viewport?.height !== target.viewport?.height ||
        fresh.devicePixelRatio !== target.devicePixelRatio ||
        ["left", "top", "right", "bottom"].some(
          (key) => fresh.bounds?.[key] !== target.bounds?.[key],
        )
      ) {
        throw new Error(
          "Investigation pointer target changed during preflight",
        );
      }
    },
  });
}

export function assertSceneNavWheelProgress(events, before, after) {
  const trusted = events.filter((event) => event.trusted);
  if (trusted.length === 0) return false;
  if (trusted.some((event) => !event.targetInChips)) {
    throw new Error("trusted scene-nav wheel reached the wrong target");
  }
  if (!trusted.some((event) => event.deltaX > 0)) {
    throw new Error("trusted scene-nav wheel delivered the wrong direction");
  }
  if (!(after > before)) {
    throw new Error("trusted scene-nav wheel did not scroll");
  }
  return true;
}

export function assertSceneNavTabProgress(
  event,
  expectedIndex,
  actualIndex,
  lastVisible,
) {
  if (!event?.trusted) return false;
  if (
    event.key !== "Tab" ||
    event.targetIndex !== expectedIndex - 1 ||
    expectedIndex !== actualIndex
  ) {
    throw new Error("trusted scene-nav Tab did not reach the expected focus");
  }
  if (expectedIndex === 4 && !lastVisible) {
    throw new Error("trusted scene-nav Tab did not make the last chip visible");
  }
  return true;
}

export function assertSceneNavPointerEvents(events) {
  const trusted = events.filter((event) => event.trusted);
  if (trusted.some((event) => !event.targetIsLast)) {
    throw new Error("trusted scene-nav pointer event reached the wrong target");
  }
  if (trusted.some((event) => !event.lastVisible)) {
    throw new Error("trusted scene-nav pointer target was not visible");
  }
  const down = trusted.some((event) => event.type === "pointerdown");
  const up = trusted.some((event) => event.type === "pointerup");
  const click = trusted.some((event) => event.type === "click");
  if ((down || up || click) && !(down && up && click)) {
    throw new Error("trusted scene-nav pointer sequence is incomplete");
  }
  return { down, up, click };
}

function xdotoolShellNumbers(output, keys) {
  const values = {};
  for (const line of output.trim().split("\n")) {
    const match = /^([A-Z]+)=(-?\d+)$/.exec(line.trim());
    if (!match || Object.hasOwn(values, match[1])) {
      throw new Error("unparseable or ambiguous xdotool geometry");
    }
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value)) {
      throw new Error("unparseable or ambiguous xdotool geometry");
    }
    values[match[1]] = value;
  }
  if (keys.some((key) => !Object.hasOwn(values, key))) {
    throw new Error("incomplete xdotool geometry");
  }
  return values;
}

/**
 * Inject one narrowly scoped scene-nav pointer event after the same full
 * private-display/process/window preflight used by keys. `target` is a fresh
 * DOM hit-tested viewport sample; no event is sent if its CSS coordinates,
 * native window geometry or focus cannot be proven. Presses/releases also
 * require the current pointer position and owner to match.
 */
export async function deliverXvfbTrustedPointer({
  action,
  target,
  resolveTarget,
  run,
  readRootPointer,
  pointerState,
  revalidate = undefined,
}) {
  pointerState.assertAllowed(action);
  if (!Object.hasOwn(SCENE_NAV_POINTER_ACTIONS, action)) {
    throw new Error(
      `unsupported scene-nav pointer action ${JSON.stringify(action)}`,
    );
  }
  const { appPid, windowId } = await resolveTarget();
  const geometry = xdotoolShellNumbers(
    await run(["getwindowgeometry", "--shell", String(windowId)]),
    ["WINDOW", "X", "Y", "WIDTH", "HEIGHT", "SCREEN"],
  );
  const { point, bounds, viewport, devicePixelRatio } = target ?? {};
  const values = [
    point?.x,
    point?.y,
    bounds?.left,
    bounds?.top,
    bounds?.right,
    bounds?.bottom,
    viewport?.width,
    viewport?.height,
    devicePixelRatio,
  ];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    geometry.WINDOW !== windowId ||
    geometry.SCREEN !== 0 ||
    geometry.X < 0 ||
    geometry.Y < 0 ||
    devicePixelRatio <= 0 ||
    geometry.WIDTH !== Math.round(viewport.width * devicePixelRatio) ||
    geometry.HEIGHT !== Math.round(viewport.height * devicePixelRatio) ||
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.right > viewport.width ||
    bounds.bottom > viewport.height ||
    bounds.left >= bounds.right ||
    bounds.top >= bounds.bottom ||
    point.x < bounds.left ||
    point.x >= bounds.right ||
    point.y < bounds.top ||
    point.y >= bounds.bottom
  ) {
    throw new Error(
      `unverified scene-nav pointer coordinates for window ${windowId} (pid ${appPid}): ${JSON.stringify({ geometry, target })}`,
    );
  }
  const x = geometry.X + Math.floor(point.x * devicePixelRatio);
  const y = geometry.Y + Math.floor(point.y * devicePixelRatio);
  const focusedWindow = async () =>
    parseXdotoolDecimal(await run(["getwindowfocus", "-f"]));
  if ((await focusedWindow()) !== windowId) {
    pointerState.assertAllowed(action);
    await run(["windowfocus", "--sync", String(windowId)]);
    if ((await focusedWindow()) !== windowId) {
      throw new Error(
        `focus did not reach verified scene-nav window ${windowId}`,
      );
    }
  }
  let pointerSource;
  if (action !== "move") {
    let pointer = xdotoolShellNumbers(
      await run(["getmouselocation", "--shell"]),
      ["X", "Y", "SCREEN", "WINDOW"],
    );
    pointerSource = "xdotool";
    if (pointer.WINDOW === 0 && readRootPointer) {
      // Without WM_STATE, xdotool may lose the raw root-child window ID.
      pointer = xdotoolShellNumbers(await readRootPointer(), [
        "X",
        "Y",
        "SCREEN",
        "WINDOW",
      ]);
      pointerSource = "xquerypointer";
    }
    if (
      pointer.WINDOW !== windowId ||
      pointer.SCREEN !== geometry.SCREEN ||
      pointer.X !== x ||
      pointer.Y !== y
    ) {
      throw new Error(
        `pointer no longer belongs to verified scene-nav target in window ${windowId}: ${JSON.stringify({ pointer, expected: { x, y } })}`,
      );
    }
  }
  if (revalidate) await revalidate();
  const button = action.split("-")[0];
  if (action.endsWith("-press")) pointerState.beginPress(button);
  else pointerState.assertAllowed(action);
  // xdotool's --sync can hang when the pointer is already at the target.
  await run(
    action === "move"
      ? ["mousemove", String(x), String(y)]
      : SCENE_NAV_POINTER_ACTIONS[action],
  );
  if (action.endsWith("-press")) pointerState.confirmPress(button);
  if ((await focusedWindow()) !== windowId) {
    throw new Error(
      `focus left verified scene-nav window ${windowId} during ${action}`,
    );
  }
  if (action.endsWith("-release")) pointerState.confirmRelease(button);
  return {
    action,
    appPid,
    windowId,
    x,
    y,
    ...(pointerSource ? { pointerSource } : {}),
  };
}

/**
 * A guaranteed-empty authority file: connecting with it presents no
 * credentials, exactly the controller's `XAUTHORITY=/dev/null xdpyinfo`
 * probe inside the acceptance image.
 */
export const EMPTY_XAUTHORITY_PROBE = "/dev/null";

/**
 * Live proof the verified display actually ENFORCES the authority file —
 * the only check that distinguishes a real cookie requirement from an
 * `-auth` pointing at a file Xorg ignored (empty/malformed authority loads
 * zero records, and Xorg then accepts local clients unconditionally).
 *
 * `probe(xauthorityPath)` performs ONE bounded X connection attempt and
 * resolves on success (production: `xdpyinfo` under an env with the given
 * XAUTHORITY — no shell, no key material in the command line). Sequence:
 *
 *   1. `probe(xauthority)` must succeed. If the authorized connection
 *      fails, the display/tooling state is unproven (absent server,
 *      missing binary, and timeout are indistinguishable here) — fail
 *      closed before even attempting the negative check.
 *   2. `probe(EMPTY_XAUTHORITY_PROBE)` must be ACTIVELY REJECTED with a
 *      credential-specific failure — the server's auth rejection reason
 *      ("No protocol specified" on this MIT-MAGIC-COOKIE Xvfb, verified
 *      live via xdotool; Xorg's "Authorization required" on others). An
 *      ACCEPTED unauthenticated connection means zero enforcement — fail.
 *      A killed/timed-out/crashed probe, an unrelated error, or a generic
 *      display-open failure (e.g. a bare "unable to open display", which a
 *      display that died between the two probes also produces) means a
 *      credential rejection was never observed — also fail closed.
 *
 * The positive-then-negative ordering is what makes the negative failure
 * attributable to authentication: the server was proven reachable by the
 * immediately preceding authorized connection.
 */
export async function assertX11AuthenticationEnforced({
  display,
  xauthority,
  probe,
}) {
  if (typeof display !== "string" || display.length === 0) {
    throw new Error(
      "cannot prove X authentication enforcement: DISPLAY is unset; refusing XTEST keys",
    );
  }
  if (typeof xauthority !== "string" || xauthority.length === 0) {
    throw new Error(
      "cannot prove X authentication enforcement: XAUTHORITY is unset; refusing XTEST keys",
    );
  }
  try {
    await probe(xauthority);
  } catch (error) {
    const err = error ?? {};
    const detail = [err.message, err.stderr]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(" | ");
    throw new Error(
      `authorized X connection to DISPLAY ${display} failed (${detail || String(error)}) — server reachability and probe health are unproven, so authentication enforcement cannot be established; refusing XTEST keys`,
      { cause: error },
    );
  }

  let negativeError = null;
  try {
    await probe(EMPTY_XAUTHORITY_PROBE);
  } catch (error) {
    negativeError = error;
  }
  if (negativeError === null) {
    throw new Error(
      `unauthenticated X connection to DISPLAY ${display} (empty authority ${EMPTY_XAUTHORITY_PROBE}) was ACCEPTED — the server does not enforce this run's authority file; refusing XTEST keys`,
    );
  }

  const err = negativeError ?? {};
  const detail = [err.message, err.stderr]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" | ");
  const killedOrTimedOut =
    err.killed === true ||
    (typeof err.signal === "string" && err.signal.length > 0) ||
    /timed? ?out/i.test(detail);
  if (killedOrTimedOut) {
    throw new Error(
      `unauthenticated X connection to DISPLAY ${display} did not fail (${detail || "killed/timed out"}) — a rejected connection must fail, not hang or die; enforcement is unproven, refusing XTEST keys`,
      { cause: negativeError },
    );
  }
  if (
    !/no protocol specified|authorization required|authentication|access denied/i.test(
      detail,
    )
  ) {
    throw new Error(
      `unauthenticated X connection to DISPLAY ${display} failed for an indistinguishable reason (${detail || String(negativeError)}) — only a credential-level rejection proves authentication is enforced; refusing XTEST keys`,
      { cause: negativeError },
    );
  }
}
