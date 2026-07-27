import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createHpa392E2eAppDataDir,
  guardedRemoveHpa392E2eAppDataDir,
  validateHpa392E2eAppDataDir,
} from "./hpa-392-e2e-paths.mjs";

const holders = [];

function holder(prefix = "lyra-hpa-392-path-test-") {
  const value = mkdtempSync(path.join(tmpdir(), prefix));
  holders.push(value);
  return value;
}

test.afterEach(() => {
  for (const directory of holders.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts only an absolute generated lyra-hpa-392 child of the OS temp root", () => {
  const generated = createHpa392E2eAppDataDir();
  holders.push(generated);

  assert.equal(path.isAbsolute(generated), true);
  assert.equal(path.dirname(generated), realpathSync(tmpdir()));
  assert.match(path.basename(generated), /^lyra-hpa-392-/);
  assert.equal(validateHpa392E2eAppDataDir(generated), generated);
});

test("refuses missing, relative, temp-root, home, production, and wrong-prefix paths", () => {
  const valid = holder("lyra-hpa-392-");
  const production = holder("lyra-hpa-392-production-");
  const wrongPrefix = holder("not-lyra-save-proof-");
  const missing = path.join(tmpdir(), "lyra-hpa-392-does-not-exist");

  const rejected = [
    undefined,
    "",
    "relative/lyra-hpa-392-test",
    tmpdir(),
    homedir(),
    production,
    wrongPrefix,
    missing,
  ];

  for (const candidate of rejected) {
    assert.throws(
      () =>
        validateHpa392E2eAppDataDir(candidate, {
          productionAppDataDir: production,
        }),
      /unsafe HPA-392 E2E app-data directory/i,
      String(candidate),
    );
  }

  assert.equal(
    validateHpa392E2eAppDataDir(valid, {
      productionAppDataDir: production,
    }),
    realpathSync(valid),
  );
});

test(
  "refuses a prefixed symlink whose canonical target escapes the temp root",
  { skip: process.platform === "win32" },
  () => {
    const linkHolder = holder("hpa-path-link-holder-");
    const outside = path.resolve(process.cwd());
    const link = path.join(linkHolder, "lyra-hpa-392-symlink");
    symlinkSync(outside, link, "dir");

    assert.throws(
      () => validateHpa392E2eAppDataDir(link),
      /unsafe HPA-392 E2E app-data directory/i,
    );
    assert.equal(realpathSync(outside), outside);
  },
);

test("revalidates immediately before cleanup and removes only the validated directory", () => {
  const generated = holder("lyra-hpa-392-");
  const sentinel = path.join(generated, "sentinel.txt");
  writeFileSync(sentinel, "test-owned");

  guardedRemoveHpa392E2eAppDataDir(generated);

  assert.throws(() => readFileSync(sentinel));
  assert.throws(() => validateHpa392E2eAppDataDir(generated));
});

test(
  "revalidation blocks cleanup after a validated path is replaced by a symlink escape",
  { skip: process.platform === "win32" },
  () => {
    const generated = holder("lyra-hpa-392-");
    const outside = holder("outside-hpa-proof-");
    const sentinel = path.join(outside, "keep.txt");
    writeFileSync(sentinel, "keep");

    assert.equal(
      validateHpa392E2eAppDataDir(generated),
      realpathSync(generated),
    );
    rmSync(generated, { recursive: true });
    symlinkSync(outside, generated, "dir");

    assert.throws(
      () => guardedRemoveHpa392E2eAppDataDir(generated),
      /unsafe HPA-392 E2E app-data directory/i,
    );
    assert.equal(readFileSync(sentinel, "utf8"), "keep");
  },
);

test("refuses nested prefixed directories rather than broadening cleanup scope", () => {
  const parent = holder("lyra-hpa-392-parent-");
  const nested = path.join(parent, "lyra-hpa-392-nested");
  mkdirSync(nested);

  assert.throws(
    () => validateHpa392E2eAppDataDir(nested),
    /unsafe HPA-392 E2E app-data directory/i,
  );
});
