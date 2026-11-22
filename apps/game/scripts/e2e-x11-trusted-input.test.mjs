import assert from "node:assert/strict";
import test from "node:test";
import { selectOwnedE2eAppProcessId } from "./e2e-trusted-key-process.mjs";
import {
  TRUSTED_XVFB_KEYS_ENV,
  assertTrustedXvfbKeysAllowed,
  assertX11WindowOwnership,
  deliverXvfbTrustedKey,
  parseLocalDisplayNumber,
  parseNetWmPid,
  parseXdotoolDecimal,
  selectUniqueX11WindowId,
  trustedXvfbKeysOptIn,
  verifyPrivateXvfbAncestry,
} from "./e2e-x11-trusted-input.mjs";

// Security gate regression (HPA-831): the scoped Linux/Xvfb XTEST path must
// fail closed on every unverifiable shape — missing/shared display, wrong
// binary, wrong process parent, foreign or ambiguous window — and only the
// fully verified private ancestry may proceed.

const DISPLAY = ":99";
const XAUTHORITY = "/tmp/xvfb-run.Abc123/Xauthority.dEf456";
const CONFIGURED_E2E_PATH =
  "/checkouts/lyra/apps/game/src-tauri/target-e2e/debug/lyra";

/** The fs.stat evidence a real xvfb-run mktemp file/dir pair produces:
 * 0600 file inside a 0700 directory, both owned by the run's user. */
const PRIVATE_AUTHORITY_FILE = {
  isFile: true,
  mode: 0o600,
  uid: 1000,
  dirIsDirectory: true,
  dirMode: 0o700,
  dirUid: 1000,
  euid: 1000,
};

function proc(pid, ppid, comm, argv = [], extra = {}) {
  return { pid, ppid, comm, argv, exe: null, ...extra };
}

/**
 * The observed acceptance-container topology: xvfb-run (a shell script,
 * comm keeps the script basename) spawns Xvfb AND the runner subtree, so
 * it is a strict ancestor of the WDIO worker. The container's Xvfb argv
 * carries an explicit `-auth /tmp/xvfb-run.…/Xauthority.…` (observed ps
 * output), which is the only admissible cookie-enforcement evidence.
 */
function privateXvfbTable({ xvfbArgv } = {}) {
  return [
    proc(1, 0, "init", ["/sbin/init"]),
    proc(5, 1, "sh", ["sh", "-c", "container command"]),
    proc(20, 5, "xvfb-run", [
      "/usr/bin/sh",
      "/usr/bin/xvfb-run",
      "-a",
      "node",
      "apps/game/scripts/run-save-e2e.mjs",
    ]),
    proc(
      25,
      20,
      "Xvfb",
      xvfbArgv ?? [
        "Xvfb",
        ":99",
        "-screen",
        "0",
        "640x480x24",
        "-nolisten",
        "tcp",
        "-auth",
        XAUTHORITY,
      ],
    ),
    proc(30, 20, "node", ["node", "apps/game/scripts/run-save-e2e.mjs"]),
    proc(42, 30, "node", ["node", "wdio-launcher"]),
    proc(700, 42, "node", ["node", "wdio-worker"], {
      exe: "/usr/bin/node",
    }),
    proc(583, 42, "lyra", [CONFIGURED_E2E_PATH], {
      exe: CONFIGURED_E2E_PATH,
    }),
  ];
}

function verify(table, overrides = {}) {
  return verifyPrivateXvfbAncestry({
    processes: table,
    currentPid: 700,
    display: DISPLAY,
    xauthority: XAUTHORITY,
    authorityFile: PRIVATE_AUTHORITY_FILE,
    ...overrides,
  });
}

test("opt-in selects XTEST keys on Linux only and only for the exact value 1", () => {
  assert.equal(
    trustedXvfbKeysOptIn({ platform: "linux", env: {} }),
    false,
    "linux must default to no OS-global keys",
  );
  assert.throws(() =>
    assertTrustedXvfbKeysAllowed({ platform: "linux", env: {} }),
  );
  for (const platform of ["darwin", "win32"]) {
    assert.equal(
      trustedXvfbKeysOptIn({ platform, env: { [TRUSTED_XVFB_KEYS_ENV]: "1" } }),
      false,
      `${platform} has no XTEST channel even with the opt-in`,
    );
    assert.throws(() =>
      assertTrustedXvfbKeysAllowed({
        platform,
        env: { [TRUSTED_XVFB_KEYS_ENV]: "1" },
      }),
    );
  }
  for (const value of ["0", "true", "yes", "", "on"]) {
    assert.equal(
      trustedXvfbKeysOptIn({
        platform: "linux",
        env: { [TRUSTED_XVFB_KEYS_ENV]: value },
      }),
      false,
      `value ${JSON.stringify(value)} must not opt in`,
    );
  }
  assert.equal(
    trustedXvfbKeysOptIn({
      platform: "linux",
      env: { [TRUSTED_XVFB_KEYS_ENV]: "1" },
    }),
    true,
  );
  assert.doesNotThrow(() =>
    assertTrustedXvfbKeysAllowed({
      platform: "linux",
      env: { [TRUSTED_XVFB_KEYS_ENV]: "1" },
    }),
  );
});

test("rejects when DISPLAY is unset", () => {
  assert.throws(
    () => verify(privateXvfbTable(), { display: undefined }),
    /DISPLAY is unset/,
  );
  assert.throws(
    () => verify(privateXvfbTable(), { display: "" }),
    /DISPLAY is unset/,
  );
});

test("rejects non-local DISPLAY forms (remote/forwarded X)", () => {
  for (const display of ["remotehost:99.0", "localhost:10.0", "unix/:99"]) {
    assert.throws(
      () => verify(privateXvfbTable(), { display }),
      /local xvfb-run DISPLAY/,
    );
  }
});

test("rejects when XAUTHORITY is unset", () => {
  assert.throws(
    () => verify(privateXvfbTable(), { xauthority: undefined }),
    /XAUTHORITY is unset/,
  );
});

test("rejects when the worker is missing from the process table", () => {
  const table = privateXvfbTable().filter((entry) => entry.pid !== 700);
  assert.throws(() => verify(table), /missing from the process table/);
});

test("rejects a shared display: matching Xvfb exists but no xvfb-run ancestor", () => {
  // The trap shape: a foreign Xvfb serving :99 sits in the table (parented
  // to init), and the worker chain contains no xvfb-run at all. Matching
  // display alone must never count as privacy.
  const table = [
    proc(1, 0, "init", ["/sbin/init"]),
    proc(42, 1, "node", ["node", "wdio-launcher"]),
    proc(700, 42, "node", ["node", "wdio-worker"], { exe: "/usr/bin/node" }),
    proc(999, 1, "Xvfb", [
      "Xvfb",
      ":99",
      "-nolisten",
      "tcp",
      "-auth",
      XAUTHORITY,
    ]),
  ];
  assert.throws(() => verify(table), /no xvfb-run process is an ancestor/);
});

test("rejects a foreign Xvfb that is not a child of the xvfb-run ancestor", () => {
  const table = privateXvfbTable().map((entry) =>
    entry.pid === 25 ? { ...entry, ppid: 1 } : entry,
  );
  assert.throws(() => verify(table), /no Xvfb child serving DISPLAY :99/);
});

test("rejects an Xvfb child serving a different display than DISPLAY", () => {
  const table = privateXvfbTable({
    xvfbArgv: [
      "Xvfb",
      ":100",
      "-screen",
      "0",
      "640x480x24",
      "-nolisten",
      "tcp",
    ],
  });
  assert.throws(() => verify(table), /no Xvfb child serving DISPLAY :99/);
});

test("rejects -displayfd Xvfb whose served display is unprovable", () => {
  const table = privateXvfbTable({
    xvfbArgv: ["Xvfb", "-displayfd", "1", "-screen", "0", "640x480x24"],
  });
  assert.throws(() => verify(table), /no Xvfb child serving DISPLAY :99/);
});

test("rejects two Xvfb children of xvfb-run serving the same display", () => {
  const table = [
    ...privateXvfbTable(),
    proc(26, 20, "Xvfb", [
      "Xvfb",
      ":99",
      "-nolisten",
      "tcp",
      "-auth",
      XAUTHORITY,
    ]),
  ];
  assert.throws(() => verify(table), /has 2 Xvfb children serving DISPLAY :99/);
});

test("rejects -ac access-control-disabled Xvfb even when -auth matches", () => {
  const table = privateXvfbTable({
    xvfbArgv: ["Xvfb", ":99", "-ac", "-nolisten", "tcp", "-auth", XAUTHORITY],
  });
  assert.throws(() => verify(table), /-ac — X access control is disabled/);
});

test("rejects an Xvfb child with no -auth argument at all", () => {
  // The reviewer's fake: matching XAUTHORITY may be inherited through the
  // environment, but without `-auth` the server does not enforce this
  // run's cookie — a read-only connection still succeeds. Environment
  // alone must never pass.
  const table = privateXvfbTable({
    xvfbArgv: ["Xvfb", ":99", "-screen", "0", "640x480x24", "-nolisten", "tcp"],
  });
  assert.throws(() => verify(table), /no -auth.*inherited XAUTHORITY/);
});

test("rejects a conflicting -auth path even when the process environment matches", () => {
  // Reproduced from review: an Xvfb fixture carrying a matching
  // XAUTHORITY in its environment AND a foreign `-auth` was previously
  // accepted. The explicit argv binding is authoritative — a foreign
  // `-auth` means the server trusts a different file.
  const table = privateXvfbTable({
    xvfbArgv: [
      "Xvfb",
      ":99",
      "-nolisten",
      "tcp",
      "-auth",
      "/tmp/other-run/Xauthority.zzz",
    ],
  }).map((entry) =>
    entry.pid === 25
      ? { ...entry, environ: [`XAUTHORITY=${XAUTHORITY}`] }
      : entry,
  );
  assert.throws(() => verify(table), /1 -auth arguments/);
});

test("rejects two -auth arguments even when one matches XAUTHORITY", () => {
  const table = privateXvfbTable({
    xvfbArgv: [
      "Xvfb",
      ":99",
      "-auth",
      XAUTHORITY,
      "-auth",
      "/tmp/other/Xauthority",
    ],
  });
  assert.throws(() => verify(table), /2 -auth arguments/);
});

test("rejects a trailing -auth flag with no value", () => {
  const table = privateXvfbTable({
    xvfbArgv: ["Xvfb", ":99", "-nolisten", "tcp", "-auth"],
  });
  assert.throws(() => verify(table), /missing value/);
});

for (const [name, evidence] of [
  ["world/group-readable file", { ...PRIVATE_AUTHORITY_FILE, mode: 0o644 }],
  [
    "world/group-traversable parent dir",
    { ...PRIVATE_AUTHORITY_FILE, dirMode: 0o755 },
  ],
  ["foreign-owned file", { ...PRIVATE_AUTHORITY_FILE, uid: 1001 }],
  ["foreign-owned parent dir", { ...PRIVATE_AUTHORITY_FILE, dirUid: 1001 }],
  ["non-regular file", { ...PRIVATE_AUTHORITY_FILE, isFile: false }],
  [
    "non-directory parent",
    { ...PRIVATE_AUTHORITY_FILE, dirIsDirectory: false },
  ],
  ["absent evidence", undefined],
]) {
  test(`rejects insecure run-private authority evidence: ${name}`, () => {
    assert.throws(
      () => verify(privateXvfbTable(), { authorityFile: evidence }),
      /not a securely permissioned run-private authority file/,
    );
  });
}

test("accepts the expected private ancestry (container -auth argv + private file)", () => {
  assert.deepEqual(verify(privateXvfbTable()), {
    xvfbRunPid: 20,
    xvfbPid: 25,
  });
});

test("accepts the private ancestry on a DISPLAY with an explicit screen", () => {
  assert.deepEqual(verify(privateXvfbTable(), { display: ":99.0" }), {
    xvfbRunPid: 20,
    xvfbPid: 25,
  });
});

test("owned-process selector accepts the session app by exact exe and parent", () => {
  const entries = privateXvfbTable().map((entry) => ({
    pid: entry.pid,
    ppid: entry.ppid,
    executablePath: entry.exe ?? `/unrelated/${entry.comm}`,
  }));
  assert.equal(
    selectOwnedE2eAppProcessId({
      entries,
      expectedExecutablePath: CONFIGURED_E2E_PATH,
      currentPid: 700,
      currentPpid: 42,
    }),
    583,
  );
});

test("owned-process selector rejects a wrong binary (dev path basename match)", () => {
  const entries = privateXvfbTable().map((entry) => ({
    pid: entry.pid,
    ppid: entry.ppid,
    executablePath:
      entry.pid === 583
        ? "/checkouts/lyra/apps/game/src-tauri/target/debug/lyra"
        : (entry.exe ?? `/unrelated/${entry.comm}`),
  }));
  assert.throws(
    () =>
      selectOwnedE2eAppProcessId({
        entries,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    /no process is running the configured e2e binary/,
  );
});

test("owned-process selector rejects the exact binary under a foreign parent", () => {
  const entries = privateXvfbTable().map((entry) => ({
    pid: entry.pid,
    ppid: entry.pid === 583 ? 5 : entry.ppid,
    executablePath: entry.exe ?? `/unrelated/${entry.comm}`,
  }));
  assert.throws(
    () =>
      selectOwnedE2eAppProcessId({
        entries,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    /is not owned by this WebDriver session/,
  );
});

test("owned-process selector aborts when the worker is orphaned", () => {
  const entries = privateXvfbTable().map((entry) => ({
    pid: entry.pid,
    ppid: entry.ppid,
    executablePath: entry.exe ?? `/unrelated/${entry.comm}`,
  }));
  assert.throws(
    () =>
      selectOwnedE2eAppProcessId({
        entries,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 1,
      }),
    /launcher pid 1 is invalid/,
  );
});

test("selectUniqueX11WindowId requires exactly one visible window", () => {
  assert.equal(
    selectUniqueX11WindowId({ searchOutput: "2097155\n", appPid: 583 }),
    2097155,
  );
  assert.throws(
    () => selectUniqueX11WindowId({ searchOutput: "", appPid: 583 }),
    /no visible window/,
  );
  assert.throws(
    () =>
      selectUniqueX11WindowId({
        searchOutput: "2097155\n2097156\n",
        appPid: 583,
      }),
    /2 visible windows \[2097155, 2097156\].*ambiguous/,
  );
  assert.throws(
    () => selectUniqueX11WindowId({ searchOutput: "garbage\n", appPid: 583 }),
    /unparseable xdotool window id/,
  );
});

test("parseNetWmPid reads the CARDINAL pid and rejects absent properties", () => {
  assert.equal(parseNetWmPid("_NET_WM_PID(CARDINAL) = 583\n"), 583);
  assert.equal(parseNetWmPid("_NET_WM_PID:  not found.\n"), null);
});

test("parseXdotoolDecimal reads window ids and pids, rejects garbage", () => {
  assert.equal(parseXdotoolDecimal("2097155\n"), 2097155);
  assert.equal(parseXdotoolDecimal("garbage"), null);
  assert.equal(parseXdotoolDecimal(""), null);
  assert.equal(parseXdotoolDecimal("0"), null);
});

test("parseLocalDisplayNumber accepts local display forms only", () => {
  assert.equal(parseLocalDisplayNumber(":99"), 99);
  assert.equal(parseLocalDisplayNumber(":99.0"), 99);
  assert.equal(parseLocalDisplayNumber(":99.1"), 99);
  assert.equal(parseLocalDisplayNumber("localhost:99"), null);
  assert.equal(parseLocalDisplayNumber(""), null);
  assert.equal(parseLocalDisplayNumber(undefined), null);
});

// --- Foreign-window ownership branches (the helpers.ts preflight checks) --

test("assertX11WindowOwnership accepts a window both probes agree is the app pid", () => {
  assert.doesNotThrow(() =>
    assertX11WindowOwnership({
      windowId: 2097155,
      netWmPid: 583,
      windowOwnerPid: 583,
      appPid: 583,
    }),
  );
});

test("assertX11WindowOwnership rejects a foreign window _NET_WM_PID", () => {
  assert.throws(
    () =>
      assertX11WindowOwnership({
        windowId: 2097155,
        netWmPid: 999,
        windowOwnerPid: 583,
        appPid: 583,
      }),
    /_NET_WM_PID 999, expected verified e2e app pid 583/,
  );
  assert.throws(
    () =>
      assertX11WindowOwnership({
        windowId: 2097155,
        netWmPid: null,
        windowOwnerPid: 583,
        appPid: 583,
      }),
    /_NET_WM_PID absent/,
  );
});

test("assertX11WindowOwnership rejects a foreign getwindowpid answer", () => {
  assert.throws(
    () =>
      assertX11WindowOwnership({
        windowId: 2097155,
        netWmPid: 583,
        windowOwnerPid: 999,
        appPid: 583,
      }),
    /getwindowpid 2097155 reports 999/,
  );
  assert.throws(
    () =>
      assertX11WindowOwnership({
        windowId: 2097155,
        netWmPid: 583,
        windowOwnerPid: null,
        appPid: 583,
      }),
    /getwindowpid 2097155 reports unparseable/,
  );
});

// --- Delivery orchestration: the same deliverXvfbTrustedKey helpers.ts
// calls, driven with a recording `run` and a scripted `resolveTarget` so a
// preflight failure can never reach the `key` command.

const TARGET_WINDOW = 2097155;
const TARGET_PID = 583;

function recordingRun(focusedIds) {
  const calls = [];
  const sequence = [...focusedIds];
  const run = async (args) => {
    calls.push([...args]);
    if (args[0] === "getwindowfocus") {
      const next = sequence.shift();
      return String(next === undefined ? TARGET_WINDOW : next);
    }
    return "";
  };
  return { calls, run };
}

function okResolver() {
  return async () => ({ appPid: TARGET_PID, windowId: TARGET_WINDOW });
}

test("delivery sends no xdotool command when target resolution fails", async () => {
  const { calls, run } = recordingRun([TARGET_WINDOW]);
  await assert.rejects(
    () =>
      deliverXvfbTrustedKey({
        key: "Enter",
        resolveTarget: async () => {
          assertX11WindowOwnership({
            windowId: TARGET_WINDOW,
            netWmPid: 999,
            windowOwnerPid: 999,
            appPid: TARGET_PID,
          });
          return { appPid: TARGET_PID, windowId: TARGET_WINDOW };
        },
        run,
      }),
    /_NET_WM_PID 999/,
  );
  assert.deepEqual(calls, [], "no xdotool call may run on preflight failure");
});

test("delivery refuses the key when focus never reaches the verified window", async () => {
  const { calls, run } = recordingRun([42, 42]);
  await assert.rejects(
    () =>
      deliverXvfbTrustedKey({
        key: "Tab",
        resolveTarget: okResolver(),
        run,
      }),
    /focus did not move to verified window 2097155.*refusing trusted Tab/,
  );
  assert.deepEqual(
    calls,
    [
      ["getwindowfocus"],
      ["windowfocus", "--sync", String(TARGET_WINDOW)],
      ["getwindowfocus"],
    ],
    "no key command may be delivered while focus is unverified",
  );
});

test("delivery rejects after post-delivery focus loss", async () => {
  const { calls, run } = recordingRun([TARGET_WINDOW, 42]);
  await assert.rejects(
    () =>
      deliverXvfbTrustedKey({
        key: "Enter",
        resolveTarget: okResolver(),
        run,
      }),
    /focus left verified window 2097155 \(now 42\)/,
  );
  assert.deepEqual(calls, [
    ["getwindowfocus"],
    ["key", "Return"],
    ["getwindowfocus"],
  ]);
});

test("delivery runs focus-check, key, focus-recheck when already focused", async () => {
  const { calls, run } = recordingRun([TARGET_WINDOW, TARGET_WINDOW]);
  await deliverXvfbTrustedKey({
    key: "Tab",
    resolveTarget: okResolver(),
    run,
  });
  assert.deepEqual(calls, [
    ["getwindowfocus"],
    ["key", "Tab"],
    ["getwindowfocus"],
  ]);
});

test("delivery reasserts focus with windowfocus --sync before the key", async () => {
  const { calls, run } = recordingRun([42, TARGET_WINDOW, TARGET_WINDOW]);
  await deliverXvfbTrustedKey({
    key: "Enter",
    resolveTarget: okResolver(),
    run,
  });
  assert.deepEqual(calls, [
    ["getwindowfocus"],
    ["windowfocus", "--sync", String(TARGET_WINDOW)],
    ["getwindowfocus"],
    ["key", "Return"],
    ["getwindowfocus"],
  ]);
});

test("delivery wraps an xdotool failure with key/window context", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push([...args]);
    if (args[0] === "key") {
      const error = new Error("Command failed: xdotool key Return");
      error.stderr = "xdotool: no such window";
      throw error;
    }
    return args[0] === "getwindowfocus" ? String(TARGET_WINDOW) : "";
  };
  await assert.rejects(
    () =>
      deliverXvfbTrustedKey({
        key: "Enter",
        resolveTarget: okResolver(),
        run,
      }),
    /trusted Enter delivery to window 2097155 \(e2e app pid 583\) failed — xdotool key:.*no such window.*inconclusive/,
  );
});
