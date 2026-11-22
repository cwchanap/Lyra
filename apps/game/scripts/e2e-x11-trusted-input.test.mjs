import assert from "node:assert/strict";
import test from "node:test";
import { selectOwnedE2eAppProcessId } from "./e2e-trusted-key-process.mjs";
import {
  TRUSTED_XVFB_KEYS_ENV,
  assertTrustedXvfbKeysAllowed,
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

function proc(pid, ppid, comm, argv = [], extra = {}) {
  return { pid, ppid, comm, argv, exe: null, environ: [], ...extra };
}

/**
 * The observed private-container topology: xvfb-run (a shell script, comm
 * keeps the script basename) spawns Xvfb AND the runner subtree, so it is a
 * strict ancestor of the WDIO worker.
 */
function privateXvfbTable({ xvfbArgv, xvfbEnviron } = {}) {
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
      ],
      { environ: xvfbEnviron ?? [`XAUTHORITY=${XAUTHORITY}`, "PATH=/usr/bin"] },
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
    proc(999, 1, "Xvfb", ["Xvfb", ":99", "-nolisten", "tcp"], {
      environ: [`XAUTHORITY=${XAUTHORITY}`],
    }),
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
    proc(26, 20, "Xvfb", ["Xvfb", ":99", "-nolisten", "tcp"], {
      environ: [`XAUTHORITY=${XAUTHORITY}`],
    }),
  ];
  assert.throws(() => verify(table), /has 2 Xvfb children serving DISPLAY :99/);
});

test("rejects an Xvfb child with no XAUTHORITY binding", () => {
  const table = privateXvfbTable({ xvfbEnviron: ["PATH=/usr/bin"] });
  assert.throws(() => verify(table), /not bound to this run's XAUTHORITY/);
});

test("rejects an Xvfb child bound to a different auth file", () => {
  const table = privateXvfbTable({
    xvfbEnviron: ["XAUTHORITY=/tmp/other-run/Xauthority.zzz"],
  });
  assert.throws(() => verify(table), /not bound to this run's XAUTHORITY/);
});

test("accepts the expected private ancestry (environ-bound auth)", () => {
  assert.deepEqual(verify(privateXvfbTable()), {
    xvfbRunPid: 20,
    xvfbPid: 25,
  });
});

test("accepts the -auth argv binding variant", () => {
  const table = privateXvfbTable({
    xvfbArgv: [
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
    xvfbEnviron: ["PATH=/usr/bin"],
  });
  assert.deepEqual(verify(table), { xvfbRunPid: 20, xvfbPid: 25 });
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
