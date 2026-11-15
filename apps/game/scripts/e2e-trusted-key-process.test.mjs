import assert from "node:assert/strict";
import test from "node:test";
import { selectE2eAppProcessId } from "./e2e-trusted-key-process.mjs";

// Realistic shapes taken from `ps -axo pid=,ppid=,comm=` on macOS (fields
// separated by runs of whitespace, full executable path last).
const CONFIGURED_E2E_PATH =
  "/checkouts/lyra/apps/game/src-tauri/target-e2e/debug/lyra";
const CONFIGURED_E2E_DEV_PATH =
  "/checkouts/lyra/apps/game/src-tauri/target/debug/lyra";
const OTHER_WORKTREE_E2E_PATH =
  "/checkouts/lyra-review/apps/game/src-tauri/target-e2e/debug/lyra";
const SUBSTRING_LOOKALIKE_PATH = "/srv/target-e2e-review/bin/lyra";

function psLine(pid, ppid, executablePath) {
  return `  ${pid}  ${ppid} ${executablePath}`;
}

test("accepts the app spawned by the WebDriver launcher of this run", () => {
  const psOutput = [
    "  1     1 /sbin/launchd",
    psLine(500, 42, CONFIGURED_E2E_PATH),
    "  900    1 /Applications/Safari.app/Contents/MacOS/Safari",
  ].join("\n");

  assert.equal(
    selectE2eAppProcessId({
      psOutput,
      expectedExecutablePath: CONFIGURED_E2E_PATH,
      currentPid: 700,
      currentPpid: 42,
    }),
    500,
  );
});

test("accepts the app spawned directly by the worker (per-worker mode)", () => {
  const psOutput = [
    psLine(500, 700, CONFIGURED_E2E_PATH),
    psLine(700, 42, "/usr/local/bin/node"),
  ].join("\n");

  assert.equal(
    selectE2eAppProcessId({
      psOutput,
      expectedExecutablePath: CONFIGURED_E2E_PATH,
      currentPid: 700,
      currentPpid: 42,
    }),
    500,
  );
});

test("rejects a dev-binary look-alike with the same executable name", () => {
  const psOutput = psLine(500, 42, CONFIGURED_E2E_DEV_PATH);

  assert.throws(
    () =>
      selectE2eAppProcessId({
        psOutput,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    /no process is running the configured e2e binary/,
  );
});

test("rejects another worktree's e2e binary with a different checkout path", () => {
  const psOutput = psLine(500, 42, OTHER_WORKTREE_E2E_PATH);

  assert.throws(
    () =>
      selectE2eAppProcessId({
        psOutput,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    /no process is running the configured e2e binary/,
  );
});

test("rejects a path that only contains target-e2e as a substring", () => {
  const psOutput = psLine(500, 42, SUBSTRING_LOOKALIKE_PATH);

  assert.throws(
    () =>
      selectE2eAppProcessId({
        psOutput,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    /no process is running the configured e2e binary/,
  );
});

test("rejects an orphaned same-path process reparented after its run died", () => {
  const psOutput = psLine(500, 1, CONFIGURED_E2E_PATH);

  assert.throws(
    () =>
      selectE2eAppProcessId({
        psOutput,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    /is not owned by this WebDriver session \(worker 700, launcher 42\)/,
  );
});

test("rejects a same-path process with an unrelated live parent", () => {
  const psOutput = psLine(500, 999, CONFIGURED_E2E_PATH);

  assert.throws(
    () =>
      selectE2eAppProcessId({
        psOutput,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    /parent 999\) is not owned by this WebDriver session/,
  );
});

test("refuses to guess when several same-path processes match", () => {
  const psOutput = [
    psLine(500, 42, CONFIGURED_E2E_PATH),
    psLine(501, 700, CONFIGURED_E2E_PATH),
  ].join("\n");

  assert.throws(
    () =>
      selectE2eAppProcessId({
        psOutput,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    /expected exactly one process running the configured e2e binary.*found 2 \[500, 501\]/s,
  );
});

test("rejection messages name the configured executable path", () => {
  const psOutput = psLine(500, 42, CONFIGURED_E2E_DEV_PATH);

  assert.throws(
    () =>
      selectE2eAppProcessId({
        psOutput,
        expectedExecutablePath: CONFIGURED_E2E_PATH,
        currentPid: 700,
        currentPpid: 42,
      }),
    (error) => error.message.includes(CONFIGURED_E2E_PATH),
  );
});
