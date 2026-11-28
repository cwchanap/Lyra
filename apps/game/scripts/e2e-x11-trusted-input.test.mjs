import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import test from "node:test";
import Mocha from "mocha";
import { testFnWrapper } from "@wdio/utils";
import { tsImport } from "tsx/esm/api";
import { selectOwnedE2eAppProcessId } from "./e2e-trusted-key-process.mjs";
import * as x11 from "./e2e-x11-trusted-input.mjs";
import {
  EMPTY_XAUTHORITY_PROBE,
  TRUSTED_XVFB_KEYS_ENV,
  assertTrustedXvfbKeysAllowed,
  assertUsableAuthorityCookies,
  assertX11AuthenticationEnforced,
  assertX11WindowOwnership,
  parseLocalDisplayNumber,
  parseNetWmPid,
  parseXauthorityRecords,
  parseXdotoolDecimal,
  selectUniqueX11WindowId,
  trustedXvfbKeysOptIn,
  verifyPrivateXvfbAncestry,
} from "./e2e-x11-trusted-input.mjs";

const untrackedPointerState = {
  assertAllowed() {},
  beginPress() {},
  confirmPress() {},
  confirmRelease() {},
};
const deliverXvfbTrustedKey = (options) =>
  x11.deliverXvfbTrustedKey({
    pointerState: untrackedPointerState,
    ...options,
  });

// Security gate regression (HPA-831): the scoped Linux/Xvfb XTEST path must
// fail closed on every unverifiable shape — missing/shared display, wrong
// binary, wrong process parent, foreign or ambiguous window — and only the
// fully verified private ancestry may proceed.

const DISPLAY = ":99";
const XAUTHORITY = "/tmp/xvfb-run.Abc123/Xauthority.dEf456";
const CONFIGURED_E2E_PATH =
  "/checkouts/lyra/apps/game/src-tauri/target-e2e/debug/lyra";

/** One Xau record: CARD16 family + four length-prefixed big-endian fields
 * (address, number, name, data) — the exact wire shape xvfb-run writes
 * through xauth. `data` is the cookie itself; tests assert it is never
 * retained in parsed output. */
function xauthRecord({
  family = 256,
  address = "run-host",
  number = "99",
  name = "MIT-MAGIC-COOKIE-1",
  data = Buffer.alloc(16, 0x5a),
} = {}) {
  const u16 = (value) => {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16BE(value);
    return bytes;
  };
  return Buffer.concat([
    u16(family),
    u16(Buffer.byteLength(address)),
    Buffer.from(address, "utf8"),
    u16(Buffer.byteLength(number)),
    Buffer.from(number, "utf8"),
    u16(Buffer.byteLength(name)),
    Buffer.from(name, "utf8"),
    u16(data.length),
    data,
  ]);
}

/** The fs.stat + content evidence a real xvfb-run mktemp file/dir pair
 * produces: 0600 file inside a 0700 directory, both owned by the run's
 * user, holding one usable cookie record for the served display. */
const PRIVATE_AUTHORITY_FILE = {
  isFile: true,
  mode: 0o600,
  uid: 1000,
  dirIsDirectory: true,
  dirMode: 0o700,
  dirUid: 1000,
  euid: 1000,
  content: xauthRecord(),
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

for (const [name, content] of [
  // The reviewer's round-2 reproduction: a size-0 regular file with
  // 0600/0700 evidence loaded ZERO Xorg records — Xorg then accepts any
  // local client. Stat-shape checks alone must never be enough.
  ["an empty file", Buffer.alloc(0)],
  ["a truncated record header", Buffer.from([0x00, 0x01, 0x00])],
  [
    "a field that overruns the file",
    Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x04]), Buffer.from("ab")]),
  ],
  ["a record for a different display only", xauthRecord({ number: "100" })],
  ["a record with an unnamed auth scheme", xauthRecord({ name: "" })],
  ["a record with an empty cookie", xauthRecord({ data: Buffer.alloc(0) })],
  ["non-byte content", "not an Xauthority file"],
]) {
  test(`rejects unusable cookie evidence: ${name}`, () => {
    const evidence = { ...PRIVATE_AUTHORITY_FILE, content };
    assert.throws(
      () => verify(privateXvfbTable(), { authorityFile: evidence }),
      /no provable cookie records|no usable cookie/,
    );
  });
}

test("accepts cookie evidence when a usable record for the display exists", () => {
  for (const content of [
    xauthRecord(),
    Buffer.concat([xauthRecord({ number: "100" }), xauthRecord()]),
    Buffer.concat([xauthRecord({ name: "XDM-AUTHORIZATION-1" })]),
  ]) {
    assert.deepEqual(
      verify(privateXvfbTable(), {
        authorityFile: { ...PRIVATE_AUTHORITY_FILE, content },
      }),
      { xvfbRunPid: 20, xvfbPid: 25 },
    );
  }
});

test("parseXauthorityRecords never retains cookie bytes", () => {
  const records = parseXauthorityRecords(xauthRecord());
  assert.equal(records.length, 1);
  // Only dataLength is exposed — the record object must not carry the
  // cookie itself (or any raw field bytes) into a loggable shape.
  assert.deepEqual(records[0], {
    family: 256,
    address: "run-host",
    number: "99",
    name: "MIT-MAGIC-COOKIE-1",
    dataLength: 16,
  });
  assert.equal("data" in records[0], false);
});

test("assertUsableAuthorityCookies wraps malformed bytes with file context", () => {
  assert.throws(
    () =>
      assertUsableAuthorityCookies({
        authorityFile: {
          ...PRIVATE_AUTHORITY_FILE,
          content: Buffer.from([0xff]),
        },
        displayNumber: 99,
        xauthority: XAUTHORITY,
      }),
    new RegExp(
      `XAUTHORITY ${XAUTHORITY.replace(/[/.]/g, (c) => `\\${c}`)} yields no provable cookie records`,
    ),
  );
});

// --- Live enforcement proof: assertX11AuthenticationEnforced drives the
// same positive-then-negative probe sequence helpers.ts wires to bounded
// xdpyinfo calls. The ordering is what makes a negative failure mean
// "authentication rejected" rather than "server/tool missing".

function scriptedProbe(outcomes) {
  const calls = [];
  const probe = async (xauthorityPath) => {
    calls.push(xauthorityPath);
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return "connected";
  };
  return { calls, probe };
}

const displayOpenRejection = () => {
  const error = new Error(
    `Command failed: xdpyinfo\nxdpyinfo: unable to open display ":99".`,
  );
  error.code = 1;
  return error;
};

// What a real xdpyinfo negative probe emits on a cookie-protected private
// display: Xlib prints the server's auth-rejection reason to stderr before
// the tool's own open failure line.
const credentialRejection = () => {
  const error = new Error(
    `Command failed: xdpyinfo\nNo protocol specified\nxdpyinfo: unable to open display ":99".`,
  );
  error.code = 1;
  return error;
};

test("enforcement proof requires the authorized connection to succeed first", async () => {
  const { calls, probe } = scriptedProbe([
    new Error("spawn xdpyinfo ENOENT"),
    displayOpenRejection(),
  ]);
  await assert.rejects(
    () =>
      assertX11AuthenticationEnforced({
        display: DISPLAY,
        xauthority: XAUTHORITY,
        probe,
      }),
    /authorized X connection to DISPLAY :99 failed.*cannot be established/,
  );
  assert.deepEqual(
    calls,
    [XAUTHORITY],
    "the negative probe must never run when the authorized one fails",
  );
});

test("enforcement proof rejects an accepted unauthenticated connection", async () => {
  const { calls, probe } = scriptedProbe(["ok", "ok"]);
  await assert.rejects(
    () =>
      assertX11AuthenticationEnforced({
        display: DISPLAY,
        xauthority: XAUTHORITY,
        probe,
      }),
    /was ACCEPTED — the server does not enforce/,
  );
  assert.deepEqual(calls, [XAUTHORITY, EMPTY_XAUTHORITY_PROBE]);
});

test("enforcement proof accepts only a credential-level negative rejection", async () => {
  const { calls, probe } = scriptedProbe(["ok", credentialRejection()]);
  await assertX11AuthenticationEnforced({
    display: DISPLAY,
    xauthority: XAUTHORITY,
    probe,
  });
  assert.deepEqual(
    calls,
    [XAUTHORITY, EMPTY_XAUTHORITY_PROBE],
    "positive probe must run before the unauthenticated one",
  );
});

test("enforcement proof rejects a bare display-open failure", async () => {
  // "unable to open display" without a credential-specific rejection is
  // indistinguishable from a display that died between the two probes.
  const { probe } = scriptedProbe(["ok", displayOpenRejection()]);
  await assert.rejects(
    () =>
      assertX11AuthenticationEnforced({
        display: DISPLAY,
        xauthority: XAUTHORITY,
        probe,
      }),
    /failed for an indistinguishable reason/,
  );
});

test("enforcement proof rejects a timed-out/killed negative probe", async () => {
  for (const outcome of [
    Object.assign(new Error("Command timed out after 10000ms"), {
      killed: true,
      signal: "SIGTERM",
    }),
    Object.assign(new Error("Command was killed"), {
      killed: true,
    }),
  ]) {
    const { probe } = scriptedProbe(["ok", outcome]);
    await assert.rejects(
      () =>
        assertX11AuthenticationEnforced({
          display: DISPLAY,
          xauthority: XAUTHORITY,
          probe,
        }),
      /did not fail.*enforcement is unproven/,
    );
  }
});

test("enforcement proof rejects an indistinguishable negative failure", async () => {
  const { probe } = scriptedProbe([
    "ok",
    new Error("xdpyinfo: some unrelated failure"),
  ]);
  await assert.rejects(
    () =>
      assertX11AuthenticationEnforced({
        display: DISPLAY,
        xauthority: XAUTHORITY,
        probe,
      }),
    /failed for an indistinguishable reason/,
  );
});

test("enforcement proof guards unset DISPLAY/XAUTHORITY", async () => {
  for (const [overrides, matcher] of [
    [{ display: undefined }, /DISPLAY is unset/],
    [{ display: "" }, /DISPLAY is unset/],
    [{ xauthority: undefined }, /XAUTHORITY is unset/],
    [{ xauthority: "" }, /XAUTHORITY is unset/],
  ]) {
    let probeCalls = 0;
    await assert.rejects(
      () =>
        assertX11AuthenticationEnforced({
          display: DISPLAY,
          xauthority: XAUTHORITY,
          probe: async () => {
            probeCalls += 1;
            return "ok";
          },
          ...overrides,
        }),
      matcher,
    );
    assert.equal(
      probeCalls,
      0,
      `missing input must stop before any probe: ${JSON.stringify(overrides)}`,
    );
  }
});

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

test("accepts xvfb-run itself running as PID 1 (container entrypoint)", () => {
  // A container whose entrypoint is `xvfb-run -a ...` has no init layer —
  // xvfb-run IS pid 1 and still owns both the Xvfb and the runner subtree.
  const table = [
    proc(1, 0, "xvfb-run", [
      "/usr/bin/sh",
      "/usr/bin/xvfb-run",
      "-a",
      "node",
      "apps/game/scripts/run-save-e2e.mjs",
    ]),
    proc(25, 1, "Xvfb", [
      "Xvfb",
      ":99",
      "-screen",
      "0",
      "640x480x24",
      "-nolisten",
      "tcp",
      "-auth",
      XAUTHORITY,
    ]),
    proc(30, 1, "node", ["node", "apps/game/scripts/run-save-e2e.mjs"]),
    proc(42, 30, "node", ["node", "wdio-launcher"]),
    proc(700, 42, "node", ["node", "wdio-worker"], { exe: "/usr/bin/node" }),
    proc(583, 42, "lyra", [CONFIGURED_E2E_PATH], {
      exe: CONFIGURED_E2E_PATH,
    }),
  ];
  assert.deepEqual(verify(table), { xvfbRunPid: 1, xvfbPid: 25 });
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

test("owned-process selector rejects a stale binary whose exe was unlinked", () => {
  // A rebuild replacing the configured binary leaves the still-running
  // process's /proc/<pid>/exe target suffixed with " (deleted)". That
  // process must fail the exact-path check, or the journey would send
  // trusted keys to — and report evidence from — the previous build.
  const entries = privateXvfbTable().map((entry) => ({
    pid: entry.pid,
    ppid: entry.ppid,
    executablePath:
      entry.pid === 583
        ? `${CONFIGURED_E2E_PATH} (deleted)`
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
      ["getwindowfocus", "-f"],
      ["windowfocus", "--sync", String(TARGET_WINDOW)],
      ["getwindowfocus", "-f"],
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
    ["getwindowfocus", "-f"],
    ["key", "Return"],
    ["getwindowfocus", "-f"],
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
    ["getwindowfocus", "-f"],
    ["key", "Tab"],
    ["getwindowfocus", "-f"],
  ]);
});

test("delivery reasserts focus with windowfocus --sync before the key", async () => {
  // Packaged-run 9662855e reproduced this path: a bare `getwindowfocus`
  // errors BadWindow at PointerRoot; `-f` prints 1 (a legitimate
  // non-target focus), so focus is reasserted and the key delivered.
  const { calls, run } = recordingRun([42, TARGET_WINDOW, TARGET_WINDOW]);
  await deliverXvfbTrustedKey({
    key: "Enter",
    resolveTarget: okResolver(),
    run,
  });
  assert.deepEqual(calls, [
    ["getwindowfocus", "-f"],
    ["windowfocus", "--sync", String(TARGET_WINDOW)],
    ["getwindowfocus", "-f"],
    ["key", "Return"],
    ["getwindowfocus", "-f"],
  ]);
});

test("delivery treats initial PointerRoot focus (id 1) as non-target", async () => {
  // The exact observed packaged failure: initial getwindowfocus -f
  // prints 1 (PointerRoot, no window focused). The sequence must be
  // focus-probe -> windowfocus --sync -> recheck -> key -> recheck, with
  // no key until the recheck proves the verified window has focus.
  const { calls, run } = recordingRun([1, TARGET_WINDOW, TARGET_WINDOW]);
  await deliverXvfbTrustedKey({
    key: "Tab",
    resolveTarget: okResolver(),
    run,
  });
  assert.deepEqual(calls, [
    ["getwindowfocus", "-f"],
    ["windowfocus", "--sync", String(TARGET_WINDOW)],
    ["getwindowfocus", "-f"],
    ["key", "Tab"],
    ["getwindowfocus", "-f"],
  ]);
});

test("delivery sends no key when PointerRoot persists after windowfocus", async () => {
  const { calls, run } = recordingRun([1, 1]);
  await assert.rejects(
    () =>
      deliverXvfbTrustedKey({
        key: "Enter",
        resolveTarget: okResolver(),
        run,
      }),
    /focus did not move to verified window 2097155 \(focused: 1\)/,
  );
  assert.deepEqual(
    calls,
    [
      ["getwindowfocus", "-f"],
      ["windowfocus", "--sync", String(TARGET_WINDOW)],
      ["getwindowfocus", "-f"],
    ],
    "no key may be sent while the verified window is unfocused",
  );
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

// --- End-to-end orchestration: the real resolve-side asserts run inside
// deliverXvfbTrustedKey's resolveTarget, so a failed authority or
// enforcement check can never reach a single xdotool command.

test("delivery sends no xdotool command on empty/malformed authority evidence", async () => {
  for (const content of [Buffer.alloc(0), Buffer.from([0x00, 0x01])]) {
    const { calls, run } = recordingRun([TARGET_WINDOW]);
    await assert.rejects(
      () =>
        deliverXvfbTrustedKey({
          key: "Tab",
          resolveTarget: async () => {
            // The same verifyPrivateXvfbAncestry helpers.ts runs — with
            // the reviewer's size-0 / malformed authority shapes.
            verifyPrivateXvfbAncestry({
              processes: privateXvfbTable(),
              currentPid: 700,
              display: DISPLAY,
              xauthority: XAUTHORITY,
              authorityFile: { ...PRIVATE_AUTHORITY_FILE, content },
            });
            return { appPid: TARGET_PID, windowId: TARGET_WINDOW };
          },
          run,
        }),
      /no provable cookie records|no usable cookie/,
    );
    assert.deepEqual(
      calls,
      [],
      "no XTEST/key command may run when cookie evidence is unusable",
    );
  }
});

test("delivery sends no xdotool command when auth enforcement is unproven", async () => {
  const { calls, run } = recordingRun([TARGET_WINDOW]);
  const { probe } = scriptedProbe(["ok", "ok"]); // negative ACCEPTED
  await assert.rejects(
    () =>
      deliverXvfbTrustedKey({
        key: "Enter",
        resolveTarget: async () => {
          await assertX11AuthenticationEnforced({
            display: DISPLAY,
            xauthority: XAUTHORITY,
            probe,
          });
          return { appPid: TARGET_PID, windowId: TARGET_WINDOW };
        },
        run,
      }),
    /was ACCEPTED — the server does not enforce/,
  );
  assert.deepEqual(
    calls,
    [],
    "no XTEST/key command may run when authentication is unenforced",
  );
});

test("delivery sends no xdotool command when the authorized probe fails", async () => {
  const { calls, run } = recordingRun([TARGET_WINDOW]);
  const { probe } = scriptedProbe([new Error("spawn xdpyinfo ENOENT")]);
  await assert.rejects(
    () =>
      deliverXvfbTrustedKey({
        key: "Tab",
        resolveTarget: async () => {
          await assertX11AuthenticationEnforced({
            display: DISPLAY,
            xauthority: XAUTHORITY,
            probe,
          });
          return { appPid: TARGET_PID, windowId: TARGET_WINDOW };
        },
        run,
      }),
    /authorized X connection to DISPLAY :99 failed/,
  );
  assert.deepEqual(calls, []);
});

const POINTER_TARGET = {
  point: { x: 100, y: 100 },
  bounds: { left: 90, top: 90, right: 130, bottom: 130 },
  viewport: { width: 800, height: 600 },
  devicePixelRatio: 1,
};

function trackedPointerState(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "lyra-pointer-state-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = x11.createX11PointerState(
    path.join(directory, "x11-pointer-state.json"),
  );
  state.initialize();
  return state;
}

function displayClaimFixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "lyra-display-claim-"));
  const xauthority = path.join(directory, "Xauthority");
  writeFileSync(xauthority, xauthRecord(), { mode: 0o600 });
  const fixture = {
    directory,
    identity: {
      xauthority,
      display: DISPLAY,
      xvfbPid: 25,
      xvfbRunPid: 20,
      xvfbStart: "12345",
      runnerPid: 30,
      pointerStatePath: path.join(directory, "pointer-state.json"),
    },
  };
  t.after(() => {
    rmSync(displayClaimPath(fixture), { force: true });
    if (existsSync(directory)) chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  });
  return fixture;
}

function displayClaimPath({ identity }) {
  const key = createHash("sha256")
    .update(path.resolve(identity.xauthority))
    .digest("hex");
  return path.join(
    realpathSync(userInfo().homedir),
    ".cache",
    "lyra-e2e-x11-claims",
    `.lyra-e2e-x11-claim-${key}.json`,
  );
}

test(
  "the display claim binds workers to one runner and Xvfb start identity",
  { skip: process.platform !== "linux" },
  (t) => {
    const { identity } = displayClaimFixture(t);
    const processes = privateXvfbTable();
    x11.claimXvfbDisplay(identity);
    assert.doesNotThrow(() =>
      x11.assertXvfbDisplayClaim({ ...identity, processes, currentPid: 700 }),
    );
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({
        ...identity,
        xvfbStart: "12346",
        processes,
        currentPid: 700,
      }),
    );
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({
        ...identity,
        pointerStatePath: `${identity.pointerStatePath}.other`,
        processes,
        currentPid: 700,
      }),
    );
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({ ...identity, processes, currentPid: 5 }),
    );
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({ ...identity, processes, currentPid: 30 }),
    );
    assert.throws(() => x11.claimXvfbDisplay(identity));
    assert.throws(() =>
      x11.claimXvfbDisplay({ ...identity, xvfbStart: "12346" }),
    );
  },
);

test(
  "a fresh private authority permits a fresh display with a reused display number",
  { skip: process.platform !== "linux" },
  (t) => {
    const first = displayClaimFixture(t);
    const second = displayClaimFixture(t);
    x11.claimXvfbDisplay(first.identity);
    assert.doesNotThrow(() => x11.claimXvfbDisplay(second.identity));
  },
);

test(
  "fresh Xvfb processes can use distinct authority files in one private directory",
  { skip: process.platform !== "linux" },
  (t) => {
    const { directory, identity } = displayClaimFixture(t);
    const freshAuthority = path.join(directory, "Xauthority-fresh");
    writeFileSync(freshAuthority, xauthRecord(), { mode: 0o600 });
    const fresh = {
      ...identity,
      xauthority: freshAuthority,
      xvfbStart: "12346",
    };
    t.after(() =>
      rmSync(displayClaimPath({ identity: fresh }), { force: true }),
    );
    x11.claimXvfbDisplay(identity);
    assert.doesNotThrow(() => x11.claimXvfbDisplay(fresh));
  },
);

test(
  "recreating an authority directory cannot erase its prior claim",
  { skip: process.platform !== "linux" },
  (t) => {
    const { directory, identity } = displayClaimFixture(t);
    x11.claimXvfbDisplay(identity);
    rmSync(directory, { recursive: true });
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(identity.xauthority, xauthRecord(), { mode: 0o600 });
    assert.throws(() =>
      x11.claimXvfbDisplay({ ...identity, xvfbStart: "12346" }),
    );
  },
);

test(
  "changing HOME or TMPDIR cannot bypass an authority claim",
  { skip: process.platform !== "linux" },
  (t) => {
    const { directory, identity } = displayClaimFixture(t);
    const home = process.env.HOME;
    const temp = process.env.TMPDIR;
    t.after(() => {
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
      if (temp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = temp;
    });
    x11.claimXvfbDisplay(identity);
    process.env.HOME = directory;
    process.env.TMPDIR = directory;
    assert.throws(() => x11.claimXvfbDisplay(identity));
  },
);

test(
  "display claims fail closed on insecure, missing, symlinked, or corrupt files",
  { skip: process.platform !== "linux" },
  (t) => {
    const insecure = displayClaimFixture(t);
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({
        ...insecure.identity,
        processes: privateXvfbTable(),
        currentPid: 700,
      }),
    );
    chmodSync(insecure.identity.xauthority, 0o644);
    assert.throws(() => x11.claimXvfbDisplay(insecure.identity), /secure/i);
    chmodSync(insecure.identity.xauthority, 0o600);
    chmodSync(insecure.directory, 0o755);
    assert.throws(() => x11.claimXvfbDisplay(insecure.identity), /secure/i);
    chmodSync(insecure.directory, 0o700);
    assert.throws(() =>
      x11.claimXvfbDisplay({ ...insecure.identity, xvfbStart: "" }),
    );
    assert.throws(() =>
      x11.claimXvfbDisplay({ ...insecure.identity, display: "remote:99" }),
    );
    assert.throws(() =>
      x11.claimXvfbDisplay({
        ...insecure.identity,
        xauthority: path.join(insecure.directory, "missing"),
      }),
    );
    const alias = path.join(insecure.directory, "alias");
    symlinkSync(insecure.identity.xauthority, alias);
    assert.throws(() =>
      x11.claimXvfbDisplay({ ...insecure.identity, xauthority: alias }),
    );
    const hardlinked = displayClaimFixture(t);
    linkSync(
      hardlinked.identity.xauthority,
      path.join(hardlinked.directory, "hardlink"),
    );
    assert.throws(() => x11.claimXvfbDisplay(hardlinked.identity));

    const linked = displayClaimFixture(t);
    const target = path.join(linked.directory, "do-not-touch");
    writeFileSync(target, "unchanged", { mode: 0o600 });
    x11.claimXvfbDisplay(linked.identity);
    rmSync(displayClaimPath(linked));
    symlinkSync(target, displayClaimPath(linked));
    assert.throws(() => x11.claimXvfbDisplay(linked.identity));
    assert.equal(readFileSync(target, "utf8"), "unchanged");
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({
        ...linked.identity,
        processes: privateXvfbTable(),
        currentPid: 700,
      }),
    );

    const linkedClaim = displayClaimFixture(t);
    x11.claimXvfbDisplay(linkedClaim.identity);
    linkSync(
      displayClaimPath(linkedClaim),
      path.join(linkedClaim.directory, "claim-hardlink"),
    );
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({
        ...linkedClaim.identity,
        processes: privateXvfbTable(),
        currentPid: 700,
      }),
    );

    const corrupt = displayClaimFixture(t);
    x11.claimXvfbDisplay(corrupt.identity);
    const claim = displayClaimPath(corrupt);
    chmodSync(claim, 0o666);
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({
        ...corrupt.identity,
        processes: privateXvfbTable(),
        currentPid: 700,
      }),
    );
    chmodSync(claim, 0o600);
    writeFileSync(claim, "{");
    assert.throws(() =>
      x11.assertXvfbDisplayClaim({
        ...corrupt.identity,
        processes: privateXvfbTable(),
        currentPid: 700,
      }),
    );
  },
);

test(
  "a non-regular authority file is rejected without waiting on it",
  { skip: process.platform !== "linux" },
  (t) => {
    const { directory, identity } = displayClaimFixture(t);
    const fifo = path.join(directory, "fifo");
    assert.equal(spawnSync("mkfifo", ["-m", "600", fifo]).status, 0);
    const moduleUrl = new URL("./e2e-x11-trusted-input.mjs", import.meta.url)
      .href;
    const source = `import { claimXvfbDisplay } from ${JSON.stringify(moduleUrl)}; claimXvfbDisplay(JSON.parse(process.env.TEST_IDENTITY));`;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          TEST_IDENTITY: JSON.stringify({ ...identity, xauthority: fifo }),
        },
      },
    );
    assert.equal(child.error, undefined, child.error?.message);
    assert.notEqual(child.status, 0);
  },
);

const deliverXvfbTrustedPointer = (options) =>
  x11.deliverXvfbTrustedPointer({
    pointerState: untrackedPointerState,
    ...options,
  });

function pointerRun({
  geometry = `WINDOW=${TARGET_WINDOW}\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\nSCREEN=0\n`,
  pointer = `X=110\nY=120\nSCREEN=0\nWINDOW=${TARGET_WINDOW}\n`,
  focus = [TARGET_WINDOW, TARGET_WINDOW],
} = {}) {
  const calls = [];
  const remaining = [...focus];
  return {
    calls,
    run: async (args) => {
      calls.push(args);
      if (args[0] === "getwindowgeometry") return geometry;
      if (args[0] === "getmouselocation") return pointer;
      if (args[0] === "getwindowfocus")
        return String(remaining.shift() ?? TARGET_WINDOW);
      return "";
    },
  };
}

const namedInvestigationState = {
  chapter: { id: "chapter_1" },
  scene: {
    kind: "investigation",
    id: "investigation_scene_9",
    currentSublocationId: "contractor_desk",
  },
  mode: { type: "explore" },
};

test("scene-nav pointer rejects a changed late hit before native input", async (t) => {
  for (const action of ["move", "click-press", "click-release"]) {
    const pointerState = trackedPointerState(t);
    if (action === "click-release") {
      pointerState.beginPress("click");
      pointerState.confirmPress("click");
    }
    const transport = pointerRun();
    let samples = 0;
    await assert.rejects(
      () =>
        x11.deliverXvfbTrustedSceneNavPointer({
          action,
          region: "last-chip",
          measureTarget: async () => {
            if (++samples === 2)
              throw new Error("scene-nav target is occluded");
            return POINTER_TARGET;
          },
          resolveTarget: okResolver(),
          run: transport.run,
          pointerState,
        }),
      /occluded/,
    );
    assert.equal(samples, 2);
    assert.equal(
      transport.calls.some(([command]) =>
        ["mousemove", "mousedown", "mouseup"].includes(command),
      ),
      false,
    );
  }
});

test("named investigation pointer accepts only the seven authorized ids in their live scene", async () => {
  assert.equal(typeof x11.deliverXvfbTrustedInvestigationPointer, "function");
  for (const id of ["phone_screenshot", "__proto__", "anything"]) {
    let sampled = false;
    const transport = pointerRun();
    await assert.rejects(() =>
      x11.deliverXvfbTrustedInvestigationPointer({
        id,
        action: "move",
        readState: async () => namedInvestigationState,
        measureTarget: async () => {
          sampled = true;
          return { ...POINTER_TARGET, hitTarget: id };
        },
        resolveTarget: okResolver(),
        run: transport.run,
        pointerState: untrackedPointerState,
      }),
    );
    assert.equal(sampled, false);
    assert.deepEqual(transport.calls, []);
  }
  for (const state of [
    { ...namedInvestigationState, chapter: { id: "chapter_2" } },
    { ...namedInvestigationState, mode: { type: "dialogue" } },
    {
      ...namedInvestigationState,
      scene: {
        ...namedInvestigationState.scene,
        currentSublocationId: "confront_kitami",
      },
    },
  ]) {
    const transport = pointerRun();
    await assert.rejects(() =>
      x11.deliverXvfbTrustedInvestigationPointer({
        id: "workorder",
        action: "move",
        readState: async () => state,
        measureTarget: async () => ({
          ...POINTER_TARGET,
          hitTarget: "workorder",
        }),
        resolveTarget: okResolver(),
        run: transport.run,
        pointerState: untrackedPointerState,
      }),
    );
    assert.deepEqual(transport.calls, []);
  }
});

test("named investigation pointer rejects wrong hits and foreign windows before injection", async () => {
  assert.equal(typeof x11.deliverXvfbTrustedInvestigationPointer, "function");
  for (const [hitTarget, geometry] of [
    ["access_permission_list", undefined],
    ["workorder", "WINDOW=999\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\nSCREEN=0\n"],
  ]) {
    const transport = pointerRun({ geometry });
    await assert.rejects(() =>
      x11.deliverXvfbTrustedInvestigationPointer({
        id: "workorder",
        action: "move",
        readState: async () => namedInvestigationState,
        measureTarget: async () => ({ ...POINTER_TARGET, hitTarget }),
        resolveTarget: okResolver(),
        run: transport.run,
        pointerState: untrackedPointerState,
      }),
    );
    assert.equal(
      transport.calls.some(([command]) => command === "mousemove"),
      false,
    );
  }
});

test("named investigation pointer rejects context or target changes during native preflight", async (t) => {
  for (const [action, change] of [
    ["move", "hit"],
    ["move", "point"],
    ["move", "mode"],
    ["move", "bounds"],
    ["click-press", "hit"],
    ["click-press", "mode"],
  ]) {
    const pointerState = trackedPointerState(t);
    const transport = pointerRun();
    let preflight = false;
    const run = async (args) => {
      const result = await transport.run(args);
      if (args[0] === "getwindowfocus") preflight = true;
      return result;
    };
    await assert.rejects(
      () =>
        x11.deliverXvfbTrustedInvestigationPointer({
          id: "workorder",
          action,
          readState: async () =>
            preflight && change === "mode"
              ? { ...namedInvestigationState, mode: { type: "dialogue" } }
              : namedInvestigationState,
          measureTarget: async () => ({
            ...POINTER_TARGET,
            point:
              preflight && change === "point"
                ? { x: 101, y: 100 }
                : POINTER_TARGET.point,
            bounds:
              preflight && change === "bounds"
                ? { ...POINTER_TARGET.bounds, right: 131 }
                : POINTER_TARGET.bounds,
            hitTarget:
              preflight && change === "hit"
                ? "access_permission_list"
                : "workorder",
          }),
          resolveTarget: okResolver(),
          run,
          pointerState,
        }),
      /Investigation pointer|Unauthorized investigation pointer/,
    );
    assert.equal(
      transport.calls.some(([command]) =>
        ["mousemove", "mousedown", "mouseup"].includes(command),
      ),
      false,
      `${action}: ${change}`,
    );
    assert.equal(pointerState.read().status, "safe");
  }
});

test("late named-target mismatch rejects release and poisons the active display", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  const release = pointerRun();
  let preflight = false;
  pointerState.beginTest();
  await assert.rejects(() =>
    x11.deliverX11PointerPair({
      pointerState,
      button: "click",
      press: () =>
        x11.deliverXvfbTrustedInvestigationPointer({
          id: "workorder",
          action: "click-press",
          readState: async () => namedInvestigationState,
          measureTarget: async () => ({
            ...POINTER_TARGET,
            hitTarget: "workorder",
          }),
          resolveTarget: okResolver(),
          run: press.run,
          pointerState,
        }),
      release: () =>
        x11.deliverXvfbTrustedInvestigationPointer({
          id: "workorder",
          action: "click-release",
          readState: async () => namedInvestigationState,
          measureTarget: async () => ({
            ...POINTER_TARGET,
            hitTarget: preflight ? "access_permission_list" : "workorder",
          }),
          resolveTarget: okResolver(),
          run: async (args) => {
            const result = await release.run(args);
            if (args[0] === "getmouselocation") preflight = true;
            return result;
          },
          pointerState,
        }),
    }),
  );
  assert.equal(
    press.calls.some(([command]) => command === "mousedown"),
    true,
  );
  assert.equal(
    release.calls.some(([command]) => command === "mouseup"),
    false,
  );
  pointerState.finishTest(false);
  assert.equal(pointerState.read().status, "poisoned");
});

for (const [action, change] of [
  ["move", "geometry"],
  ["move", "focus"],
  ["click-press", "geometry"],
  ["click-press", "focus"],
  ["click-press", "pointer-window"],
  ["click-press", "pointer-position"],
]) {
  test(`named ${action} rejects changed native ${change} during DOM recheck`, async (t) => {
    const pointerState = trackedPointerState(t);
    const transport = pointerRun();
    let samples = 0;
    const run = async (args) => {
      const result = await transport.run(args);
      if (samples < 2) return result;
      if (change === "geometry" && args[0] === "getwindowgeometry")
        return result.replace("X=10", "X=11");
      if (change === "focus" && args[0] === "getwindowfocus") return "999";
      if (change === "pointer-window" && args[0] === "getmouselocation")
        return result.replace(`WINDOW=${TARGET_WINDOW}`, "WINDOW=999");
      if (change === "pointer-position" && args[0] === "getmouselocation")
        return result.replace("X=110", "X=111");
      return result;
    };
    await assert.rejects(() =>
      x11.deliverXvfbTrustedInvestigationPointer({
        id: "workorder",
        action,
        readState: async () => namedInvestigationState,
        measureTarget: async () => {
          samples++;
          return { ...POINTER_TARGET, hitTarget: "workorder" };
        },
        resolveTarget: okResolver(),
        run,
        pointerState,
      }),
    );
    assert.equal(samples, 2);
    assert.equal(
      transport.calls.some(([command]) =>
        ["mousemove", "mousedown", "mouseup"].includes(command),
      ),
      false,
    );
    assert.equal(pointerState.read().status, "safe");
  });
}

test("named press rechecks the root-pointer fallback after DOM recheck", async (t) => {
  const pointerState = trackedPointerState(t);
  const transport = pointerRun({
    pointer: "X=110\nY=120\nSCREEN=0\nWINDOW=0\n",
  });
  let samples = 0;
  await assert.rejects(
    () =>
      x11.deliverXvfbTrustedInvestigationPointer({
        id: "workorder",
        action: "click-press",
        readState: async () => namedInvestigationState,
        measureTarget: async () => {
          samples++;
          return { ...POINTER_TARGET, hitTarget: "workorder" };
        },
        resolveTarget: okResolver(),
        run: transport.run,
        readRootPointer: async () =>
          `X=110\nY=120\nSCREEN=0\nWINDOW=${samples >= 2 ? 999 : TARGET_WINDOW}\n`,
        pointerState,
      }),
    /pointer no longer belongs/,
  );
  assert.equal(
    transport.calls.some(([command]) => command === "mousedown"),
    false,
  );
  assert.equal(pointerState.read().status, "safe");
});

test("named release rejects native pointer change during DOM recheck and poisons display", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  const release = pointerRun();
  let samples = 0;
  const common = {
    id: "workorder",
    readState: async () => namedInvestigationState,
    resolveTarget: okResolver(),
    pointerState,
  };
  pointerState.beginTest();
  await assert.rejects(() =>
    x11.deliverX11PointerPair({
      pointerState,
      button: "click",
      press: () =>
        x11.deliverXvfbTrustedInvestigationPointer({
          ...common,
          action: "click-press",
          measureTarget: async () => ({
            ...POINTER_TARGET,
            hitTarget: "workorder",
          }),
          run: press.run,
        }),
      release: () =>
        x11.deliverXvfbTrustedInvestigationPointer({
          ...common,
          action: "click-release",
          measureTarget: async () => {
            samples++;
            return { ...POINTER_TARGET, hitTarget: "workorder" };
          },
          run: async (args) => {
            const result = await release.run(args);
            return samples >= 2 && args[0] === "getmouselocation"
              ? result.replace(`WINDOW=${TARGET_WINDOW}`, "WINDOW=999")
              : result;
          },
        }),
    }),
  );
  assert.equal(
    press.calls.some(([command]) => command === "mousedown"),
    true,
  );
  assert.equal(
    release.calls.some(([command]) => command === "mouseup"),
    false,
  );
  pointerState.finishTest(false);
  assert.equal(pointerState.read().status, "poisoned");
});

test("named investigation pointer requires the complete trusted sequence on the exact target", () => {
  assert.equal(typeof x11.assertInvestigationPointerEvents, "function");
  const events = ["pointerdown", "pointerup", "click"].map((type) => ({
    type,
    trusted: true,
    targetId: "workorder",
  }));
  assert.equal(x11.assertInvestigationPointerEvents(events, "workorder"), true);
  assert.equal(x11.assertInvestigationPointerEvents([], "workorder"), false);
  for (const broken of [
    events.slice(0, 2),
    [
      events[0],
      { ...events[1], targetId: "access_permission_list" },
      events[2],
    ],
    [events[0], { ...events[1], trusted: false }, events[2]],
  ]) {
    assert.throws(() =>
      x11.assertInvestigationPointerEvents(broken, "workorder"),
    );
  }
});

test("the named pointer allowlist binds every id to one chapter, scene and location", async () => {
  for (const [id, chapter, scene, location] of [
    ["stacked_ledgers", "chapter_1", "investigation_scene_8", "office_corner"],
    ["workorder", "chapter_1", "investigation_scene_9", "contractor_desk"],
    [
      "access_permission_list",
      "chapter_1",
      "investigation_scene_9",
      "contractor_desk",
    ],
    [
      "material_kit_list",
      "chapter_1",
      "investigation_scene_9",
      "contractor_desk",
    ],
    ["to_confront", "chapter_1", "investigation_scene_9", "contractor_desk"],
    [
      "stream_wall_screen",
      "chapter_2",
      "investigation_scene_4",
      "stream_wall_plaza",
    ],
    [
      "ob_van_monitor",
      "chapter_2",
      "investigation_scene_4",
      "control_room_perimeter",
    ],
  ]) {
    const transport = pointerRun();
    await x11.deliverXvfbTrustedInvestigationPointer({
      id,
      action: "move",
      readState: async () => ({
        chapter: { id: chapter },
        scene: {
          kind: "investigation",
          id: scene,
          currentSublocationId: location,
        },
        mode: { type: "explore" },
      }),
      measureTarget: async (approved) => {
        assert.equal(approved, id);
        return { ...POINTER_TARGET, hitTarget: approved };
      },
      resolveTarget: okResolver(),
      run: transport.run,
      pointerState: untrackedPointerState,
    });
    assert.deepEqual(transport.calls.at(-2), ["mousemove", "110", "120"]);
  }
});

test("a named pointer pair never releases at a mismatched hit and poisons the display", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  const release = pointerRun();
  const common = {
    id: "workorder",
    readState: async () => namedInvestigationState,
    resolveTarget: okResolver(),
    pointerState,
  };
  pointerState.beginTest();
  await assert.rejects(
    () =>
      x11.deliverX11PointerPair({
        pointerState,
        button: "click",
        press: () =>
          x11.deliverXvfbTrustedInvestigationPointer({
            ...common,
            action: "click-press",
            measureTarget: async () => ({
              ...POINTER_TARGET,
              hitTarget: "workorder",
            }),
            run: press.run,
          }),
        release: () =>
          x11.deliverXvfbTrustedInvestigationPointer({
            ...common,
            action: "click-release",
            measureTarget: async () => ({
              ...POINTER_TARGET,
              hitTarget: "access_permission_list",
            }),
            run: release.run,
          }),
      }),
    /hit-test mismatch/,
  );
  assert.equal(
    press.calls.some(([command]) => command === "mousedown"),
    true,
  );
  assert.equal(
    release.calls.some(([command]) => command === "mouseup"),
    false,
  );
  pointerState.finishTest(false);
  assert.equal(pointerState.read().status, "poisoned");
  assert.throws(() => pointerState.assertAllowed("move"), /unsafe/);
});

test("test ownership remains active through a verified pointer pair", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  const release = pointerRun();
  pointerState.beginTest();
  await x11.deliverX11PointerPair({
    pointerState,
    button: "click",
    press: () =>
      x11.deliverXvfbTrustedPointer({
        action: "click-press",
        target: POINTER_TARGET,
        resolveTarget: okResolver(),
        run: press.run,
        pointerState,
      }),
    release: () =>
      x11.deliverXvfbTrustedPointer({
        action: "click-release",
        target: POINTER_TARGET,
        resolveTarget: okResolver(),
        run: release.run,
        pointerState,
      }),
  });
  assert.equal(pointerState.isSafe(), false);
  assert.equal(pointerState.read().testActive, true);
  pointerState.finishTest(true);
  assert.equal(pointerState.isSafe(), true);
});

test("revoked pending move and key preflights cannot change focus or send input", async (t) => {
  for (const action of ["move", "key"]) {
    const pointerState = trackedPointerState(t);
    pointerState.beginTest();
    let resume;
    const preflight = new Promise((resolve) => {
      resume = resolve;
    });
    const transport = pointerRun({ focus: [42, TARGET_WINDOW] });
    const operation =
      action === "move"
        ? x11.deliverXvfbTrustedPointer({
            action: "move",
            target: POINTER_TARGET,
            resolveTarget: () => preflight,
            run: transport.run,
            pointerState,
          })
        : x11.deliverXvfbTrustedKey({
            key: "Tab",
            resolveTarget: () => preflight,
            run: transport.run,
            pointerState,
          });
    pointerState.finishTest(false);
    resume({ appPid: TARGET_PID, windowId: TARGET_WINDOW });
    await assert.rejects(operation, /unsafe/i);
    assert.deepEqual(
      transport.calls.filter(([command]) =>
        ["windowfocus", "mousemove", "mousedown", "mouseup", "key"].includes(
          command,
        ),
      ),
      [],
    );
  }
});

test("pointer preflight failure sends no XTEST commands", async () => {
  const { run, calls } = pointerRun();
  await assert.rejects(
    () =>
      deliverXvfbTrustedPointer({
        action: "move",
        target: POINTER_TARGET,
        resolveTarget: async () => {
          throw new Error("unverified display");
        },
        run,
      }),
    /unverified display/,
  );
  assert.deepEqual(calls, []);
});

test("pointer sends no XTEST commands when private authority cannot be proven", async () => {
  const { run, calls } = pointerRun();
  await assert.rejects(
    () =>
      deliverXvfbTrustedPointer({
        action: "move",
        target: POINTER_TARGET,
        resolveTarget: async () => {
          verifyPrivateXvfbAncestry({
            processes: privateXvfbTable(),
            currentPid: 700,
            display: DISPLAY,
            xauthority: XAUTHORITY,
            authorityFile: {
              ...PRIVATE_AUTHORITY_FILE,
              content: Buffer.alloc(0),
            },
          });
          return { appPid: TARGET_PID, windowId: TARGET_WINDOW };
        },
        run,
      }),
    /no usable cookie/,
  );
  assert.deepEqual(calls, []);
});

test("pointer sends no XTEST commands when X authentication is unenforced", async () => {
  const { run, calls } = pointerRun();
  const { probe } = scriptedProbe(["ok", "ok"]);
  await assert.rejects(
    () =>
      deliverXvfbTrustedPointer({
        action: "move",
        target: POINTER_TARGET,
        resolveTarget: async () => {
          await assertX11AuthenticationEnforced({
            display: DISPLAY,
            xauthority: XAUTHORITY,
            probe,
          });
          return { appPid: TARGET_PID, windowId: TARGET_WINDOW };
        },
        run,
      }),
    /was ACCEPTED/,
  );
  assert.deepEqual(calls, []);
});

test("pointer refuses coordinates outside the verified window or target", async () => {
  for (const target of [
    { ...POINTER_TARGET, point: { x: 801, y: 100 } },
    { ...POINTER_TARGET, point: { x: 85, y: 100 } },
    { ...POINTER_TARGET, point: { x: NaN, y: 100 } },
    { ...POINTER_TARGET, devicePixelRatio: 2 },
  ]) {
    const { run, calls } = pointerRun();
    await assert.rejects(() =>
      deliverXvfbTrustedPointer({
        action: "move",
        target,
        resolveTarget: okResolver(),
        run,
      }),
    );
    assert.equal(
      calls.some(([command]) => command === "mousemove"),
      false,
    );
  }
});

test("pointer refuses malformed or foreign window geometry", async () => {
  for (const geometry of [
    "X=10\nY=20\nWIDTH=800\nHEIGHT=600\n",
    "WINDOW=999\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\nSCREEN=0\n",
    `WINDOW=${TARGET_WINDOW}\nX=10\nY=20\nWIDTH=801\nHEIGHT=600\nSCREEN=0\n`,
  ]) {
    const { run, calls } = pointerRun({ geometry });
    await assert.rejects(() =>
      deliverXvfbTrustedPointer({
        action: "move",
        target: POINTER_TARGET,
        resolveTarget: okResolver(),
        run,
      }),
    );
    assert.equal(
      calls.some(([command]) => command === "mousemove"),
      false,
    );
  }
});

test("pointer refuses presses when pointer location or ownership changed", async () => {
  for (const pointer of [
    "X=110\nY=120\nSCREEN=0\nWINDOW=0\n",
    "X=110\nY=120\nSCREEN=0\nWINDOW=999\n",
    `X=111\nY=120\nSCREEN=0\nWINDOW=${TARGET_WINDOW}\n`,
    "malformed",
  ]) {
    const { run, calls } = pointerRun({ pointer });
    await assert.rejects(() =>
      deliverXvfbTrustedPointer({
        action: "click-press",
        target: POINTER_TARGET,
        resolveTarget: okResolver(),
        run,
      }),
    );
    assert.equal(
      calls.some(([command]) => command === "mousedown"),
      false,
    );
  }
});

test("pointer can verify the raw root child when xdotool reports no client window", async () => {
  const { run, calls } = pointerRun({
    pointer: "X=110\nY=120\nSCREEN=0\nWINDOW=0\n",
  });
  const result = await deliverXvfbTrustedPointer({
    action: "wheel-press",
    target: POINTER_TARGET,
    resolveTarget: okResolver(),
    run,
    readRootPointer: async () =>
      `X=110\nY=120\nSCREEN=0\nWINDOW=${TARGET_WINDOW}\n`,
  });
  assert.deepEqual(calls.at(-2), ["mousedown", "7"]);
  assert.equal(result.pointerSource, "xquerypointer");
});

test("pointer refuses a foreign or mismatched raw root-child result", async () => {
  for (const raw of [
    "X=110\nY=120\nSCREEN=0\nWINDOW=999\n",
    "X=110\nY=120\nSCREEN=0\nWINDOW=0\n",
    `X=111\nY=120\nSCREEN=0\nWINDOW=${TARGET_WINDOW}\n`,
    "malformed",
  ]) {
    const { run, calls } = pointerRun({
      pointer: "X=110\nY=120\nSCREEN=0\nWINDOW=0\n",
    });
    await assert.rejects(() =>
      deliverXvfbTrustedPointer({
        action: "wheel-press",
        target: POINTER_TARGET,
        resolveTarget: okResolver(),
        run,
        readRootPointer: async () => raw,
      }),
    );
    assert.equal(
      calls.some(([command]) => command === "mousedown"),
      false,
    );
  }
});

test("pointer refuses a failed raw probe and never uses it for a foreign client", async () => {
  for (const reported of [0, 999]) {
    const { run, calls } = pointerRun({
      pointer: `X=110\nY=120\nSCREEN=0\nWINDOW=${reported}\n`,
    });
    let probes = 0;
    await assert.rejects(() =>
      deliverXvfbTrustedPointer({
        action: "click-press",
        target: POINTER_TARGET,
        resolveTarget: okResolver(),
        run,
        readRootPointer: async () => {
          probes += 1;
          throw new Error("raw query unavailable");
        },
      }),
    );
    assert.equal(probes, reported === 0 ? 1 : 0);
    assert.equal(
      calls.some(([command]) => command === "mousedown"),
      false,
    );
  }
});

test("pointer checks focus before and after every injected event", async () => {
  const before = pointerRun({ focus: [42, 42] });
  await assert.rejects(() =>
    deliverXvfbTrustedPointer({
      action: "move",
      target: POINTER_TARGET,
      resolveTarget: okResolver(),
      run: before.run,
    }),
  );
  assert.equal(
    before.calls.some(([command]) => command === "mousemove"),
    false,
  );

  const after = pointerRun({ focus: [TARGET_WINDOW, 42] });
  await assert.rejects(() =>
    deliverXvfbTrustedPointer({
      action: "click-press",
      target: POINTER_TARGET,
      resolveTarget: okResolver(),
      run: after.run,
    }),
  );
  assert.equal(
    after.calls.some(([command]) => command === "mousedown"),
    true,
  );
});

test("pointer delivers only verified scene-nav actions to the owned window", async () => {
  const move = pointerRun();
  const verifiedMove = await deliverXvfbTrustedPointer({
    action: "move",
    target: POINTER_TARGET,
    resolveTarget: okResolver(),
    run: move.run,
  });
  assert.deepEqual(verifiedMove, {
    action: "move",
    appPid: TARGET_PID,
    windowId: TARGET_WINDOW,
    x: 110,
    y: 120,
  });
  assert.deepEqual(move.calls.at(-2), ["mousemove", "110", "120"]);
  for (const [action, expected] of [
    ["wheel-press", ["mousedown", "7"]],
    ["wheel-release", ["mouseup", "7"]],
    ["click-press", ["mousedown", "1"]],
    ["click-release", ["mouseup", "1"]],
  ]) {
    const { run, calls } = pointerRun();
    await deliverXvfbTrustedPointer({
      action,
      target: POINTER_TARGET,
      resolveTarget: okResolver(),
      run,
    });
    assert.deepEqual(calls.at(-2), expected);
    assert.deepEqual(calls.at(-1), ["getwindowfocus", "-f"]);
  }
  const bad = pointerRun();
  await assert.rejects(() =>
    deliverXvfbTrustedPointer({
      action: "anything-else",
      target: POINTER_TARGET,
      resolveTarget: okResolver(),
      run: bad.run,
    }),
  );
  assert.deepEqual(bad.calls, []);
});

test("trusted scene-nav input failures are not reported as unavailable", () => {
  assert.equal(
    x11.assertSceneNavWheelProgress([{ trusted: false, deltaX: 1 }], 0, 0),
    false,
  );
  assert.throws(
    () =>
      x11.assertSceneNavWheelProgress(
        [{ trusted: true, deltaX: 1, targetInChips: true }],
        0,
        0,
      ),
    /trusted.*scroll/i,
  );
  assert.throws(
    () =>
      x11.assertSceneNavWheelProgress(
        [{ trusted: true, deltaX: 0, targetInChips: true }],
        0,
        5,
      ),
    /trusted.*direction/i,
  );
  assert.equal(
    x11.assertSceneNavWheelProgress(
      [{ trusted: true, deltaX: 1, targetInChips: true }],
      0,
      5,
    ),
    true,
  );
  assert.equal(
    x11.assertSceneNavTabProgress({ key: "Tab", trusted: false }, 1, 0),
    false,
  );
  assert.throws(
    () =>
      x11.assertSceneNavTabProgress(
        { key: "Tab", trusted: true, targetIndex: 0 },
        1,
        0,
      ),
    /trusted.*focus/i,
  );
  assert.equal(
    x11.assertSceneNavTabProgress(
      { key: "Tab", trusted: true, targetIndex: 0 },
      1,
      1,
    ),
    true,
  );
});

test("a delivered fourth Tab must reveal the final scene chip", () => {
  assert.throws(
    () =>
      x11.assertSceneNavTabProgress(
        { key: "Tab", trusted: true, targetIndex: 3 },
        4,
        4,
        false,
      ),
    /trusted.*visib/i,
  );
});

test("trusted pointer release retargeted away from the last chip fails", () => {
  assert.equal(typeof x11.assertSceneNavPointerEvents, "function");
  assert.throws(
    () =>
      x11.assertSceneNavPointerEvents([
        {
          type: "pointerdown",
          trusted: true,
          targetIsLast: true,
          lastVisible: true,
        },
        {
          type: "pointerup",
          trusted: true,
          targetIsLast: false,
          lastVisible: true,
        },
      ]),
    /trusted.*target/i,
  );
});

test("a partially delivered trusted click cannot be marked inconclusive", () => {
  for (const type of ["pointerdown", "pointerup", "click"]) {
    assert.throws(
      () =>
        x11.assertSceneNavPointerEvents([
          { type, trusted: true, targetIsLast: true, lastVisible: true },
        ]),
      /incomplete|missing/i,
    );
  }
});

test("trusted wheel and click delivery cannot hide wrong targets or a missing click", () => {
  assert.throws(
    () =>
      x11.assertSceneNavWheelProgress(
        [{ trusted: true, deltaX: 86, targetInChips: false }],
        0,
        86,
      ),
    /target/i,
  );
  assert.throws(
    () =>
      x11.assertSceneNavPointerEvents([
        {
          type: "pointerdown",
          trusted: true,
          targetIsLast: true,
          lastVisible: true,
        },
        {
          type: "pointerup",
          trusted: true,
          targetIsLast: true,
          lastVisible: true,
        },
      ]),
    /incomplete/i,
  );
  assert.deepEqual(
    x11.assertSceneNavPointerEvents([
      {
        type: "pointerdown",
        trusted: true,
        targetIsLast: true,
        lastVisible: true,
      },
      {
        type: "pointerup",
        trusted: true,
        targetIsLast: true,
        lastVisible: true,
      },
      { type: "click", trusted: true, targetIsLast: true, lastVisible: true },
      { type: "click", trusted: false, targetIsLast: false },
    ]),
    { down: true, up: true, click: true },
  );
});

test("trusted pointer delivery requires the last chip to be visible", () => {
  assert.throws(
    () =>
      x11.assertSceneNavPointerEvents([
        {
          type: "pointerup",
          trusted: true,
          targetIsLast: true,
          lastVisible: false,
        },
      ]),
    /visible/i,
  );
});

test("press postcheck failure attempts only a fully verified release", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun({ focus: [TARGET_WINDOW, 42] });
  const release = pointerRun();
  let releasePreflights = 0;
  await assert.rejects(
    () =>
      x11.deliverX11PointerPair({
        pointerState,
        button: "click",
        press: () =>
          x11.deliverXvfbTrustedPointer({
            action: "click-press",
            target: POINTER_TARGET,
            resolveTarget: okResolver(),
            run: press.run,
            pointerState,
          }),
        release: () =>
          x11.deliverXvfbTrustedPointer({
            action: "click-release",
            target: POINTER_TARGET,
            resolveTarget: async () => {
              releasePreflights += 1;
              return { appPid: TARGET_PID, windowId: TARGET_WINDOW };
            },
            run: release.run,
            pointerState,
          }),
      }),
    /focus left/,
  );
  assert.equal(releasePreflights, 1);
  assert.ok(release.calls.some(([command]) => command === "getmouselocation"));
  assert.ok(release.calls.some(([command]) => command === "mouseup"));
  assert.equal(pointerState.read().status, "poisoned");
  const later = pointerRun();
  await assert.rejects(() =>
    x11.deliverXvfbTrustedKey({
      key: "Tab",
      resolveTarget: okResolver(),
      run: later.run,
      pointerState,
    }),
  );
  assert.deepEqual(later.calls, []);
});

for (const pending of ["press", "post-press focus"]) {
  test(`revocation while ${pending} is in flight prevents later input`, async (t) => {
    const pointerState = trackedPointerState(t);
    const press = pointerRun();
    const release = pointerRun();
    let notifyStarted;
    let resume;
    const started = new Promise((resolve) => {
      notifyStarted = resolve;
    });
    const delayed = new Promise((resolve) => {
      resume = resolve;
    });
    let focusChecks = 0;
    pointerState.beginTest();
    const operation = x11.deliverX11PointerPair({
      pointerState,
      button: "click",
      press: () =>
        x11.deliverXvfbTrustedPointer({
          action: "click-press",
          target: POINTER_TARGET,
          resolveTarget: okResolver(),
          run: async (args) => {
            const result = await press.run(args);
            const hold =
              (pending === "press" && args[0] === "mousedown") ||
              (pending === "post-press focus" &&
                args[0] === "getwindowfocus" &&
                ++focusChecks === 2);
            if (hold) {
              notifyStarted();
              await delayed;
            }
            return result;
          },
          pointerState,
        }),
      release: () =>
        x11.deliverXvfbTrustedPointer({
          action: "click-release",
          target: POINTER_TARGET,
          resolveTarget: okResolver(),
          run: release.run,
          pointerState,
        }),
    });
    await started;
    assert.equal(pointerState.read().status, "possible");
    pointerState.finishTest(false);
    resume();
    await assert.rejects(operation);
    assert.equal(pointerState.read().status, "poisoned");
    assert.deepEqual(release.calls, []);
    assert.throws(() => pointerState.beginTest(), /unsafe/);
    const later = pointerRun();
    await assert.rejects(() =>
      x11.deliverXvfbTrustedKey({
        key: "Enter",
        resolveTarget: okResolver(),
        run: later.run,
        pointerState,
      }),
    );
    assert.deepEqual(later.calls, []);
  });
}

test("a falsy press error is not swallowed after a verified release", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  const release = pointerRun();
  let focusChecks = 0;
  let rejected = false;
  try {
    await x11.deliverX11PointerPair({
      pointerState,
      button: "click",
      press: () =>
        x11.deliverXvfbTrustedPointer({
          action: "click-press",
          target: POINTER_TARGET,
          resolveTarget: okResolver(),
          run: async (args) => {
            if (args[0] === "getwindowfocus" && ++focusChecks === 2) {
              throw undefined;
            }
            return press.run(args);
          },
          pointerState,
        }),
      release: () =>
        x11.deliverXvfbTrustedPointer({
          action: "click-release",
          target: POINTER_TARGET,
          resolveTarget: okResolver(),
          run: release.run,
          pointerState,
        }),
    });
  } catch {
    rejected = true;
  }
  assert.equal(pointerState.read().status, "poisoned");
  assert.equal(rejected, true);
});

test("empty trusted-input errors remain classifiable as errors", () => {
  assert.equal(x11.describeX11InputError(""), "Unknown X11 input error");
  assert.equal(
    x11.describeX11InputError(new Error("")),
    "Unknown X11 input error",
  );
  assert.equal(
    x11.describeX11InputError(new Error("focus lost")),
    "focus lost",
  );
});

test("press precheck failure never attempts a cleanup release", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  let releases = 0;
  await assert.rejects(
    () =>
      x11.deliverX11PointerPair({
        pointerState,
        button: "wheel",
        press: () =>
          x11.deliverXvfbTrustedPointer({
            action: "wheel-press",
            target: POINTER_TARGET,
            resolveTarget: async () => {
              throw new Error("press target unverified");
            },
            run: press.run,
            pointerState,
          }),
        release: async () => {
          releases += 1;
        },
      }),
    /press target unverified/,
  );
  assert.equal(releases, 0);
  assert.deepEqual(press.calls, []);
  assert.equal(pointerState.read().status, "safe");
});

test("release precheck failure blocks all later pointer and keyboard input", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun({ focus: [TARGET_WINDOW, 42] });
  const release = pointerRun();
  await assert.rejects(
    () =>
      x11.deliverX11PointerPair({
        pointerState,
        button: "click",
        press: () =>
          x11.deliverXvfbTrustedPointer({
            action: "click-press",
            target: POINTER_TARGET,
            resolveTarget: okResolver(),
            run: press.run,
            pointerState,
          }),
        release: () =>
          x11.deliverXvfbTrustedPointer({
            action: "click-release",
            target: POINTER_TARGET,
            resolveTarget: async () => {
              throw new Error("release target unverified");
            },
            run: release.run,
            pointerState,
          }),
      }),
    /release target unverified/,
  );
  assert.equal(
    release.calls.some(([command]) => command === "mouseup"),
    false,
  );
  const later = pointerRun();
  await assert.rejects(() =>
    x11.deliverXvfbTrustedPointer({
      action: "move",
      target: POINTER_TARGET,
      resolveTarget: okResolver(),
      run: later.run,
      pointerState,
    }),
  );
  await assert.rejects(() =>
    x11.deliverXvfbTrustedKey({
      key: "Tab",
      resolveTarget: okResolver(),
      run: later.run,
      pointerState,
    }),
  );
  assert.deepEqual(later.calls, []);
});

test("ambiguous press delivery stays poisoned even after verified release", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  const release = pointerRun();
  let releasePreflights = 0;
  await assert.rejects(
    () =>
      x11.deliverX11PointerPair({
        pointerState,
        button: "wheel",
        press: () =>
          x11.deliverXvfbTrustedPointer({
            action: "wheel-press",
            target: POINTER_TARGET,
            resolveTarget: okResolver(),
            run: async (args) => {
              await press.run(args);
              if (args[0] === "mousedown") throw new Error("press timed out");
              return args[0] === "getwindowgeometry"
                ? `WINDOW=${TARGET_WINDOW}\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\nSCREEN=0\n`
                : args[0] === "getmouselocation"
                  ? `X=110\nY=120\nSCREEN=0\nWINDOW=${TARGET_WINDOW}\n`
                  : args[0] === "getwindowfocus"
                    ? String(TARGET_WINDOW)
                    : "";
            },
            pointerState,
          }),
        release: () =>
          x11.deliverXvfbTrustedPointer({
            action: "wheel-release",
            target: POINTER_TARGET,
            resolveTarget: async () => {
              releasePreflights += 1;
              return { appPid: TARGET_PID, windowId: TARGET_WINDOW };
            },
            run: release.run,
            pointerState,
          }),
      }),
    /press timed out/,
  );
  assert.equal(releasePreflights, 1);
  assert.ok(release.calls.some(([command]) => command === "mouseup"));
  assert.equal(pointerState.read().status, "poisoned");
  const later = pointerRun();
  await assert.rejects(() =>
    x11.deliverXvfbTrustedKey({
      key: "Enter",
      resolveTarget: okResolver(),
      run: later.run,
      pointerState,
    }),
  );
  await assert.rejects(() =>
    x11.deliverXvfbTrustedPointer({
      action: "move",
      target: POINTER_TARGET,
      resolveTarget: okResolver(),
      run: later.run,
      pointerState,
    }),
  );
  assert.deepEqual(later.calls, []);
});

test("release postcheck failure leaves the display unsafe", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  const release = pointerRun({ focus: [TARGET_WINDOW, 42] });
  await assert.rejects(
    () =>
      x11.deliverX11PointerPair({
        pointerState,
        button: "click",
        press: () =>
          x11.deliverXvfbTrustedPointer({
            action: "click-press",
            target: POINTER_TARGET,
            resolveTarget: okResolver(),
            run: press.run,
            pointerState,
          }),
        release: () =>
          x11.deliverXvfbTrustedPointer({
            action: "click-release",
            target: POINTER_TARGET,
            resolveTarget: okResolver(),
            run: release.run,
            pointerState,
          }),
      }),
    /focus left/,
  );
  assert.ok(release.calls.some(([command]) => command === "mouseup"));
  assert.equal(pointerState.isSafe(), false);
  assert.throws(() => pointerState.assertAllowed("key"), /unsafe/);
});

test("a release callback that does not clear tracked state cannot succeed", async (t) => {
  const pointerState = trackedPointerState(t);
  const press = pointerRun();
  await assert.rejects(
    () =>
      x11.deliverX11PointerPair({
        pointerState,
        button: "click",
        press: () =>
          x11.deliverXvfbTrustedPointer({
            action: "click-press",
            target: POINTER_TARGET,
            resolveTarget: okResolver(),
            run: press.run,
            pointerState,
          }),
        release: async () => {},
      }),
    /release.*verified/i,
  );
  assert.equal(pointerState.isSafe(), false);
});

test("a new pointer pair never attempts cleanup on an already unsafe display", async (t) => {
  const pointerState = trackedPointerState(t);
  pointerState.beginPress("click");
  let presses = 0;
  let releases = 0;
  await assert.rejects(() =>
    x11.deliverX11PointerPair({
      pointerState,
      button: "click",
      press: async () => {
        presses += 1;
        throw new Error("blocked press");
      },
      release: async () => {
        releases += 1;
      },
    }),
  );
  assert.equal(presses, 0);
  assert.equal(releases, 0);
});

test(
  "foreign-writable pointer state is not trusted",
  { skip: !process.geteuid },
  (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "lyra-pointer-mode-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const statePath = path.join(directory, "x11-pointer-state.json");
    const pointerState = x11.createX11PointerState(statePath);
    pointerState.initialize();
    chmodSync(statePath, 0o666);
    assert.equal(pointerState.isSafe(), false);
    assert.throws(() => pointerState.assertAllowed("key"));
  },
);

test(
  "failed timeout revocation blocks input across module instances",
  { skip: !process.geteuid || process.geteuid() === 0 },
  async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "lyra-revocation-io-"));
    t.after(() => {
      chmodSync(directory, 0o700);
      rmSync(directory, { recursive: true, force: true });
    });
    const statePath = path.join(directory, "x11-pointer-state.json");
    const state = x11.createX11PointerState(statePath);
    state.initialize();
    state.beginTest();
    const secondModule = await tsImport(
      "./e2e-x11-trusted-input.mjs",
      import.meta.url,
    );
    const otherState = secondModule.createX11PointerState(statePath);
    chmodSync(directory, 0o500);
    assert.throws(() => state.finishTest(false));
    assert.equal(state.isSafe(), false);
    assert.throws(() => otherState.assertAllowed("key"), /unsafe/i);
  },
);

test("a poisoned display bails before later Mocha tests can send input", async (t) => {
  const pointerState = trackedPointerState(t);
  const mocha = new Mocha({ reporter: class {} });
  const suite = Mocha.Suite.create(mocha.suite, "private display");
  let laterActions = 0;
  suite.addTest(
    new Mocha.Test("detect poisoned display", function () {
      pointerState.beginPress("click");
      x11.assertX11DisplaySafe(
        () => pointerState,
        () => this.test.parent.bail(true),
      );
    }),
  );
  suite.addTest(
    new Mocha.Test("later pointer and keyboard", () => {
      laterActions += 1;
    }),
  );
  const failures = await new Promise((resolve) => mocha.run(resolve));
  assert.equal(failures, 1);
  assert.equal(laterActions, 0);
});

test("the afterEach poison guard also prevents later Mocha test bodies", async (t) => {
  const pointerState = trackedPointerState(t);
  const mocha = new Mocha({ reporter: class {} });
  const suite = Mocha.Suite.create(mocha.suite, "private display");
  let laterActions = 0;
  suite.afterEach("check held pointer", function () {
    x11.assertX11DisplaySafe(
      () => pointerState,
      () => this.currentTest.parent.bail(true),
    );
  });
  suite.addTest(
    new Mocha.Test("leave an uncertain press", () => {
      pointerState.beginPress("wheel");
    }),
  );
  suite.addTest(
    new Mocha.Test("later pointer and keyboard", () => {
      laterActions += 1;
    }),
  );
  const failures = await new Promise((resolve) => mocha.run(resolve));
  assert.equal(failures, 1);
  assert.equal(laterActions, 0);
});

for (const timeout of ["WDIO", "Mocha"]) {
  test(
    `a ${timeout} timeout during pointer preflight prevents late and later input`,
    { skip: process.platform !== "linux" },
    async (t) => {
      const directory = mkdtempSync(path.join(tmpdir(), "lyra-wdio-timeout-"));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const statePath = path.join(directory, "x11-pointer-state.json");
      const pointerState = x11.createX11PointerState(statePath);
      pointerState.initialize();
      const previousOptIn = process.env.LYRA_E2E_XVFB_TRUSTED_KEYS;
      const previousPath = process.env.LYRA_E2E_X11_POINTER_STATE;
      process.env.LYRA_E2E_XVFB_TRUSTED_KEYS = "1";
      process.env.LYRA_E2E_X11_POINTER_STATE = statePath;
      t.after(() => {
        if (previousOptIn === undefined)
          delete process.env.LYRA_E2E_XVFB_TRUSTED_KEYS;
        else process.env.LYRA_E2E_XVFB_TRUSTED_KEYS = previousOptIn;
        if (previousPath === undefined)
          delete process.env.LYRA_E2E_X11_POINTER_STATE;
        else process.env.LYRA_E2E_X11_POINTER_STATE = previousPath;
      });
      const { config } = await tsImport("../wdio.conf.ts", import.meta.url);
      const mocha = new Mocha({ reporter: class {} });
      const suite = Mocha.Suite.create(mocha.suite, "private display timeout");
      suite.timeout(timeout === "Mocha" ? 50 : 1500);
      let resolvePreflight;
      const preflight = new Promise((resolve) => {
        resolvePreflight = resolve;
      });
      const press = pointerRun();
      const release = pointerRun();
      let operation;
      let firstWrapper;
      let laterInputs = 0;
      const wrap = (body) =>
        function () {
          const wrapped = testFnWrapper.call(
            { _runnable: { _timeout: timeout === "WDIO" ? 50 : 1000 } },
            "Test",
            { specFn: body, specFnArgs: [] },
            {
              beforeFn: config.beforeTest ? [config.beforeTest] : [],
              beforeFnArgs: () => [{}, {}],
            },
            {
              afterFn: config.afterTest ? [config.afterTest] : [],
              afterFnArgs: () => [{}, {}],
            },
            "timeout-regression",
          );
          firstWrapper ??= wrapped;
          return wrapped;
        };
      suite.afterEach(function () {
        x11.assertX11DisplaySafe(
          () => pointerState,
          () => this.currentTest.parent.bail(true),
          { abortActive: true },
        );
      });
      suite.addTest(
        new Mocha.Test(
          "times out during native preflight",
          wrap(() => {
            operation = x11.deliverX11PointerPair({
              pointerState,
              button: "click",
              press: () =>
                x11.deliverXvfbTrustedPointer({
                  action: "click-press",
                  target: POINTER_TARGET,
                  resolveTarget: () => preflight,
                  run: press.run,
                  pointerState,
                }),
              release: () =>
                x11.deliverXvfbTrustedPointer({
                  action: "click-release",
                  target: POINTER_TARGET,
                  resolveTarget: okResolver(),
                  run: release.run,
                  pointerState,
                }),
            });
            return operation;
          }),
        ).timeout(timeout === "Mocha" ? 50 : 1000),
      );
      suite.addTest(
        new Mocha.Test(
          "later input",
          wrap(() => {
            laterInputs += 1;
          }),
        ),
      );
      const failures = await new Promise((resolve) => mocha.run(resolve));
      assert.ok(failures >= 1);
      resolvePreflight({ appPid: TARGET_PID, windowId: TARGET_WINDOW });
      await operation.catch(() => {});
      await firstWrapper.catch(() => {});
      assert.deepEqual(
        [...press.calls, ...release.calls].filter(([command]) =>
          ["mousedown", "mouseup", "mousemove", "key"].includes(command),
        ),
        [],
      );
      assert.equal(laterInputs, 0);
      assert.equal(pointerState.isSafe(), false);
    },
  );
}
