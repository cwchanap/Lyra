# HPA-540 Pre-Release Save Compatibility Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop maintaining migrations for unshipped Lyra save formats, isolate development data from production data, and leave one strict current save decoder that HPA-260 can extend with Chapter 1 analysis state without introducing `SaveEnvelopeV3`.

**Architecture:** Keep Lyra's existing production-safety boundaries—atomic writes, strict bounded parsing, exact `contentRevision`, detached restore, exact recapture, stale-write guards, and serialized persistence—but change the compatibility promise. A compile-time runtime channel selects production, development, or E2E storage; development adds a path epoch, while the active decoder accepts only the current on-disk format. Persisted recap copy remains a validated, additive cache whose optional presentation fields may be absent without affecting authoritative restore.

**Tech Stack:** Bun 1.3.1, TypeScript 5.6, Node test runner, Vitest 4, Rust 2021/Serde, Tokio, Tauri 2, existing atomic-write-file storage and packaged WebDriver E2E suites.

**Plan Review Status:** Repository structure, current V1→V2 migration flow, Tauri development config, browser development server, save discovery, recap validation, E2E fixture unions, and HPA-260 integration points reviewed against `main` at `396974bedbe09a6175107a0155b4371bba34b2b3`.

## Global Constraints

- Merge/order contract: finish and merge HPA-508's spoiler-safe unfinished-scene summary behavior before the recap-cache task in this plan; then land HPA-540 before HPA-260.
- Before deleting legacy decoding, verify that no publicly distributed Lyra build promised save compatibility. If that premise is false, stop this plan and move the released shape into a reviewed legacy module.
- Keep the serialized key `schemaVersion` and its current numeric value `2`. In HPA-540 it is a strict current-format discriminator, not evidence that every earlier internal number must remain migratable.
- Do not create `SaveEnvelopeV3`, `SaveSnapshotV2`, a V2→V3 migration, an empty migration registry, or a generic schema framework.
- Production keeps identifier `com.chanwaichan.lyra` and the existing `<configured app data>/saves` root.
- Tauri development uses identifier `com.chanwaichan.lyra.dev` and `<configured app data>/saves-dev/epoch-1`; changing `DEVELOPMENT_SAVE_EPOCH` selects a clean namespace without reading or deleting the old one.
- Browser development uses its existing repository-local base and the same `saves-dev/epoch-1` suffix.
- E2E keeps identifier `com.chanwaichan.lyra.e2e`, its validated OS-temp override, and the existing `<override>/saves` root.
- Never let a debug build using the production identifier silently select the production root.
- Generated scene JSON, story catalog, and content manifest remain current-only compiler output; no generated-resource migration registry is added.
- Persisted recap copy is non-authoritative. Snapshot IDs and current packaged definitions remain the restore authority.
- Optional recap presentation fields deserialize with explicit default-to-`None` semantics. New saves may continue serializing `null`; omission and `null` are equivalent on read.
- A present recap copy must still match the snapshot and packaged definitions. Missing optional copy is tolerated; mismatched copy fails.
- Do not ignore `contentRevision`, drop unknown durable fields, guess removed definitions, advance stale dialogue cursors, normalize incompatible drafts, or partially restore an invalid snapshot.
- Preserve five autosave slots, three manual slots, Continue selection, stale overwrite/delete checks, thumbnail sidecars, acquisition acknowledgement, retry/cancel/without-saving flows, exit flush, typed IPC payloads, and event names.
- Do not decompose `SaveCoordinator`; that remains HPA-521.
- Do not add Chapter 2 or later-chapter compatibility work.

## File and Responsibility Map

### New documentation

- `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md` — binding pre-release compatibility policy, first-release freeze rule, storage-channel map, and HPA-260 extension contract.
- `docs/superpowers/plans/2026-08-03-hpa-540-pre-release-save-compatibility-implementation-plan.md` — this task-by-task plan.

### Storage namespace owners

- `apps/game/src-tauri/src/game/save/storage.rs` — `SaveRuntimeChannel`, development identifier/epoch constants, pure root resolution, production/E2E safety checks, and root tests.
- `apps/game/src-tauri/src/game/error.rs` — typed unsafe namespace/configuration diagnostic; remove the now-dead missing-migration diagnostic.
- `apps/game/src-tauri/src/lib.rs` — pass the compile-time runtime channel into root resolution; make `build_development_app_state` accept a development app-data base rather than a final save directory.
- `apps/game/src-tauri/tauri.dev.conf.json` — assign the development-only Tauri identifier.
- `apps/game/src-tauri/examples/dev_engine_server.rs` — pass the repository-local development app-data base so the shared epoch helper chooses the final root.
- `apps/game/scripts/save-e2e-paths.test.mjs` — assert production, development, and E2E identifiers are distinct and that the dev command actually loads `tauri.dev.conf.json`.

### Current save format owners

- `apps/game/src-tauri/src/game/save/schema.rs` — one strict current envelope decoder; remove V1 envelope/summary types; document recap-cache semantics.
- `apps/game/src-tauri/src/game/save/mod.rs` — remove the migration module declaration.
- `apps/game/src-tauri/src/game/save/storage.rs` — replace migration dispatch with current parsing; current-only readable recap extraction.
- `apps/game/src-tauri/src/game/save/restore.rs` — current envelope types only; preserve exact `contentRevision`, detached candidate, recapture, and public-view validation.
- `apps/game/src-tauri/src/game/save/capture.rs` — preserve HPA-508 completion-aware summary capture and current snapshot capture.
- `apps/game/src-tauri/src/game/test_support.rs` — current representative envelope helpers only.
- Delete `apps/game/src-tauri/src/game/save/migrations.rs`.
- Delete `apps/game/src-tauri/tests/fixtures/saves/v1-representative.json`.
- Create `apps/game/src-tauri/tests/fixtures/saves/current-representative.json`.
- `.prettierignore` — replace the deleted `v1-representative.json` entry with `current-representative.json`; keep the exact one-line golden fixture outside Prettier rewriting.

### Frontend and packaged-test mirrors

- `apps/game/e2e-tauri/save-fixtures.ts` — one current envelope type, no V1/V2 union.
- `apps/game/e2e-tauri/save-seed.e2e.ts` — current-format assertions and recap behavior only.
- `apps/game/e2e-tauri/save-management.e2e.ts` — remove migration-only branches if present; retain corrupt, incompatible, overwrite, delete, and invalid-newest behavior.
- `apps/game/src/lib/persistence/types.ts` — no wire redesign; retain `schemaVersion` metadata and nullable recap view.
- `apps/game/src/lib/persistence/types.test.ts` and `apps/game/src/lib/components/SaveRecapDetails.test.ts` — current metadata and missing-copy presentation coverage.

---

### Task 1: Prove the Compatibility Premise and Record the Policy

**Files:**
- Create: `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`
- Modify: `CLAUDE.md`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs` (module-level/current-format comments only)

**Interfaces:**
- Consumes: HPA-540's no-shipped-save precondition and the existing current save subsystem.
- Produces: a repository-visible rule that later tasks and HPA-260 must follow; no runtime behavior change.

- [ ] **Step 1: Audit releases, tags, distribution notes, and compatibility promises**

Run from the repository root:

```bash
gh release list --repo cwchanap/Lyra
git tag --list
git log --all --decorate --oneline --grep='release\|save compatibility\|backward compatibility'
rg -n --hidden \
  'save compatibility|backward-compatible save|preserve player saves|released save schema|public build' \
  README.md CLAUDE.md docs .github apps packages
```

Expected result for this plan to continue:

```text
No GitHub release, tag, installer note, README statement, or distribution document promises compatibility for an already shipped Lyra save format.
```

If any result contradicts that statement, stop before Task 2 and revise HPA-540 so that the released format remains readable from `save/legacy/<release>.rs`.

- [ ] **Step 2: Write the binding policy document**

Create `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md` with these exact decisions:

```markdown
# HPA-540 Pre-Release Save Compatibility Policy

## Status

Accepted for active Chapter 1 development. This policy assumes no publicly
shipped Lyra build has promised save compatibility.

## Pre-release rule

- Unshipped save formats are disposable.
- The runtime accepts one current format.
- Additive presentation cache fields are optional and default to absence.
- Breaking durable-state changes increment `DEVELOPMENT_SAVE_EPOCH`; they do
  not add migrations.
- Development roots are isolated from production and E2E roots.
- Exact `contentRevision` remains mandatory.
- Generated content resources are current-only and are regenerated.

## First release rule

At the first public release, record the current on-disk discriminator as the
first supported released schema, commit golden saves, and begin explicit
migrations only from formats that were actually shipped. Do not renumber the
existing `schemaVersion` merely to make the release label start at one.

## Safety invariants

Atomic writes, directory synchronization, thumbnail ownership, strict bounded
parsing, detached restore, exact recapture, stale-write protection, acquisition
durability, and exit flushing are independent of backward compatibility and
remain required.

## HPA-260 contract

HPA-260 adds `Analysis` to the current scene-progress snapshot and round-trips
current classify/order/threshold drafts. It does not create an envelope V3,
snapshot V2, or migration. Deep analysis states are reached through
deterministic current-content checkpoints.
```

- [ ] **Step 3: Link the policy from contributor guidance**

Add a short `Persistence compatibility` subsection to `CLAUDE.md`:

```markdown
### Persistence compatibility

- Read `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`
  before changing persisted state.
- Before the first public release, do not create migrations for internal save
  shapes. Additive recap fields are optional; breaking durable changes bump the
  development save epoch.
- Never relax `contentRevision`, detached restore, exact recapture, or atomic
  storage to preserve a development save.
- HPA-260 must add analysis state to the current snapshot without an envelope
  or snapshot version fork.
```

- [ ] **Step 4: Add a current-format ownership comment in `schema.rs`**

Place this immediately above the current format constant:

```rust
// Pre-release policy: this is the only active on-disk format discriminator.
// Earlier internal formats are not migrated. The first public release freezes
// the then-current value as the first supported released contract.
pub(crate) const SAVE_SCHEMA_VERSION: u32 = 2;
```

Do not change the numeric value or serialized key in this task.

- [ ] **Step 5: Run documentation and formatting checks**

```bash
bun run format:check
git diff --check
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md \
  docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md \
  apps/game/src-tauri/src/game/save/schema.rs
git commit -m "docs: define pre-release save compatibility policy"
```

---

### Task 2: Isolate Production, Tauri Development, Browser Development, and E2E Roots

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src-tauri/tauri.dev.conf.json`
- Modify: `apps/game/src-tauri/examples/dev_engine_server.rs`
- Modify: `apps/game/scripts/save-e2e-paths.test.mjs`
- Test: inline tests in `apps/game/src-tauri/src/game/save/storage.rs`
- Test: inline tests in `apps/game/src-tauri/src/lib.rs`
- Test: `apps/game/scripts/save-e2e-paths.test.mjs`

**Interfaces:**
- Produces:
  - `DEVELOPMENT_APP_IDENTIFIER: &str`
  - `DEVELOPMENT_SAVE_EPOCH: u32`
  - `SaveRuntimeChannel::{Production, Development, E2e}`
  - `current_save_runtime_channel() -> SaveRuntimeChannel`
  - `development_save_root(base: &Path) -> PathBuf`
  - `resolve_save_root(..., channel: SaveRuntimeChannel) -> Result<PathBuf, GameError>`
- Preserves: the existing production and E2E final roots.

- [ ] **Step 1: Write failing pure root-resolution tests**

Add tests in `storage.rs` before changing production code:

```rust
#[test]
fn production_namespace_keeps_the_existing_root() {
    let configured = Path::new("/app-data/com.chanwaichan.lyra");
    let production = Path::new("/app-data/com.chanwaichan.lyra");

    assert_eq!(
        resolve_save_root_for_channel(
            configured,
            production,
            PRODUCTION_APP_IDENTIFIER,
            SaveRuntimeChannel::Production,
            None,
        )
        .unwrap(),
        configured.join("saves")
    );
}

#[test]
fn development_namespace_is_identifier_and_epoch_isolated() {
    let configured = Path::new("/app-data/com.chanwaichan.lyra.dev");

    assert_eq!(
        resolve_save_root_for_channel(
            configured,
            Path::new("/app-data/com.chanwaichan.lyra"),
            DEVELOPMENT_APP_IDENTIFIER,
            SaveRuntimeChannel::Development,
            None,
        )
        .unwrap(),
        configured
            .join("saves-dev")
            .join(format!("epoch-{DEVELOPMENT_SAVE_EPOCH}"))
    );
}

#[test]
fn production_and_development_reject_each_others_identifiers() {
    let configured = Path::new("/app-data");

    for (channel, identifier) in [
        (SaveRuntimeChannel::Production, DEVELOPMENT_APP_IDENTIFIER),
        (SaveRuntimeChannel::Development, PRODUCTION_APP_IDENTIFIER),
    ] {
        assert_eq!(
            resolve_save_root_for_channel(
                configured,
                configured,
                identifier,
                channel,
                None,
            )
            .unwrap_err()
            .code,
            "unsafeSaveNamespace"
        );
    }
}

#[test]
fn e2e_identifier_mismatch_keeps_the_existing_guard_diagnostic() {
    assert_eq!(
        resolve_save_root_for_channel(
            Path::new("/configured"),
            Path::new("/production"),
            PRODUCTION_APP_IDENTIFIER,
            SaveRuntimeChannel::E2e,
            None,
        )
        .unwrap_err()
        .code,
        "unsafeE2eAppDataRoot"
    );
}
```

Keep the existing canonical-temp E2E tests and adapt them to pass `SaveRuntimeChannel::E2e`.

- [ ] **Step 2: Add a failing config contract test**

At the top of `save-e2e-paths.test.mjs`, add:

```js
test("production, development, and E2E Tauri identifiers are distinct", () => {
  const root = new URL("../src-tauri/tauri.conf.json", import.meta.url);
  const dev = new URL("../src-tauri/tauri.dev.conf.json", import.meta.url);
  const e2e = new URL("../src-tauri/tauri.e2e.conf.json", import.meta.url);

  const production = JSON.parse(readFileSync(root, "utf8"));
  const development = JSON.parse(readFileSync(dev, "utf8"));
  const packagedE2e = JSON.parse(readFileSync(e2e, "utf8"));

  assert.equal(production.identifier, "com.chanwaichan.lyra");
  assert.equal(development.identifier, "com.chanwaichan.lyra.dev");
  assert.equal(packagedE2e.identifier, "com.chanwaichan.lyra.e2e");
  assert.equal(new Set([
    production.identifier,
    development.identifier,
    packagedE2e.identifier,
  ]).size, 3);
});
```

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::storage::tests -- --nocapture
node --test apps/game/scripts/save-e2e-paths.test.mjs
```

Expected: FAIL because the channel API and development identifier do not exist yet.

- [ ] **Step 3: Implement the explicit channel and epoch**

In `storage.rs`, add beside the existing application identifiers:

```rust
pub(crate) const PRODUCTION_APP_IDENTIFIER: &str = "com.chanwaichan.lyra";
pub(crate) const DEVELOPMENT_APP_IDENTIFIER: &str = "com.chanwaichan.lyra.dev";
pub(crate) const E2E_APP_IDENTIFIER: &str = "com.chanwaichan.lyra.e2e";
pub(crate) const DEVELOPMENT_SAVE_EPOCH: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SaveRuntimeChannel {
    Production,
    Development,
    E2e,
}

pub(crate) const fn current_save_runtime_channel() -> SaveRuntimeChannel {
    #[cfg(feature = "e2e")]
    {
        SaveRuntimeChannel::E2e
    }
    #[cfg(all(not(feature = "e2e"), debug_assertions))]
    {
        SaveRuntimeChannel::Development
    }
    #[cfg(all(not(feature = "e2e"), not(debug_assertions)))]
    {
        SaveRuntimeChannel::Production
    }
}

pub(crate) fn development_save_root(base: &Path) -> PathBuf {
    base.join("saves-dev")
        .join(format!("epoch-{DEVELOPMENT_SAVE_EPOCH}"))
}
```

Refactor `resolve_save_root` into a thin environment wrapper plus a pure helper:

```rust
pub(crate) fn resolve_save_root(
    configured_app_data: &Path,
    production_app_data: &Path,
    app_identifier: &str,
    channel: SaveRuntimeChannel,
) -> Result<PathBuf, GameError> {
    let e2e_override = std::env::var_os(E2E_APP_DATA_ENV).map(PathBuf::from);
    resolve_save_root_for_channel(
        configured_app_data,
        production_app_data,
        app_identifier,
        channel,
        e2e_override.as_deref(),
    )
}

fn resolve_save_root_for_channel(
    configured_app_data: &Path,
    production_app_data: &Path,
    app_identifier: &str,
    channel: SaveRuntimeChannel,
    e2e_override: Option<&Path>,
) -> Result<PathBuf, GameError> {
    match channel {
        SaveRuntimeChannel::Production => {
            require_identifier(app_identifier, PRODUCTION_APP_IDENTIFIER)?;
            Ok(configured_app_data.join("saves"))
        }
        SaveRuntimeChannel::Development => {
            require_identifier(app_identifier, DEVELOPMENT_APP_IDENTIFIER)?;
            Ok(development_save_root(configured_app_data))
        }
        SaveRuntimeChannel::E2e => validate_e2e_app_data_root(
            e2e_override,
            production_app_data,
            app_identifier,
        ),
    }
}

fn require_identifier(actual: &str, expected: &str) -> Result<(), GameError> {
    if actual == expected {
        Ok(())
    } else {
        Err(GameError::unsafe_save_namespace())
    }
}
```

Keep `validate_e2e_app_data_root`'s canonicalization, temp-root, home, production, prefix, and symlink defenses unchanged.

- [ ] **Step 4: Add the typed namespace error**

In `error.rs`:

```rust
pub fn unsafe_save_namespace() -> Self {
    Self::new(
        "unsafeSaveNamespace",
        "The runtime save namespace does not match the application identifier.",
    )
}
```

Do not reuse a corruption or storage-write error for this startup configuration failure.

- [ ] **Step 5: Wire Tauri startup and the development server**

In `lib.rs`, import `current_save_runtime_channel`, `development_save_root` only where needed, and pass the channel:

```rust
let save_root = resolve_save_root(
    &configured_app_data,
    &production_app_data,
    &app.config().identifier,
    current_save_runtime_channel(),
)
.map_err(|error| std::io::Error::other(error.message))?;
```

Change the hidden development builder to accept a base directory:

```rust
#[doc(hidden)]
pub fn build_development_app_state(
    resources_dir: PathBuf,
    development_app_data: PathBuf,
) -> Result<AppState, GameError> {
    build_app_state_with_storage(
        resources_dir,
        game::save::storage::development_save_root(&development_app_data),
        Arc::new(ProductionSaveFilesystem),
    )
}
```

In `dev_engine_server.rs`, pass:

```rust
PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("target/dev-engine-server")
```

instead of the existing final `target/dev-engine-server/saves` path.

- [ ] **Step 6: Give Tauri development its own identifier**

Replace `tauri.dev.conf.json` with:

```json
{
  "identifier": "com.chanwaichan.lyra.dev",
  "build": {
    "beforeDevCommand": null
  }
}
```

Do not change `tauri.conf.json` or `tauri.e2e.conf.json`.

- [ ] **Step 7: Add a builder-level development root test**

In `lib.rs` tests:

```rust
#[test]
fn development_app_state_uses_the_shared_epoch_root() {
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources/scenes");
    let base = tempfile::tempdir().unwrap();

    let state = build_development_app_state(
        resources,
        base.path().to_path_buf(),
    )
    .unwrap();

    assert_eq!(
        state.save_root,
        base.path()
            .join("saves-dev")
            .join(format!(
                "epoch-{}",
                crate::game::save::storage::DEVELOPMENT_SAVE_EPOCH
            ))
    );
}
```

Run `bun run scenes:compile` before this focused test so `resources/scenes` contains the current generated package.

- [ ] **Step 8: Run focused namespace tests**

```bash
bun run scenes:compile
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::storage::tests
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  development_app_state_uses_the_shared_epoch_root
node --test apps/game/scripts/save-e2e-paths.test.mjs
bun run --cwd apps/game check:e2e
```

Expected: all pass; production and E2E path expectations remain byte-for-byte unchanged.

- [ ] **Step 9: Commit**

```bash
git add apps/game/src-tauri/src/game/save/storage.rs \
  apps/game/src-tauri/src/game/error.rs \
  apps/game/src-tauri/src/lib.rs \
  apps/game/src-tauri/tauri.dev.conf.json \
  apps/game/src-tauri/examples/dev_engine_server.rs \
  apps/game/scripts/save-e2e-paths.test.mjs
git commit -m "feat: isolate development save namespaces"
```

---

### Task 3: Replace the Legacy Fixture and Collapse Decoding to One Current Format

**Files:**
- Create: `apps/game/src-tauri/tests/fixtures/saves/current-representative.json`
- Delete: `apps/game/src-tauri/tests/fixtures/saves/v1-representative.json`
- Delete: `apps/game/src-tauri/src/game/save/migrations.rs`
- Modify: `apps/game/src-tauri/src/game/save/mod.rs`
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `.prettierignore`

**Interfaces:**
- Keeps: `parse_schema_version(bytes) -> Result<u32, GameError>`.
- Produces: `parse_current_envelope(bytes) -> Result<SaveEnvelopeV2, GameError>` as the only active decoder.
- Removes: `SaveEnvelopeV1`, `SaveSummaryV1`, `migrate_to_current`, `decode_summary_by_version`, `MIGRATION_REGISTRY`, and `missingSaveSchemaMigration`.

- [ ] **Step 1: Generate a current golden fixture before deleting the legacy one**

Run this one-time deterministic conversion while the old fixture still exists:

```bash
python3 - <<'PY'
import json
from pathlib import Path

root = Path("apps/game/src-tauri/tests/fixtures/saves")
source = json.loads((root / "v1-representative.json").read_text())
source["schemaVersion"] = 2
source["summary"]["chapterSummary"] = None
source["summary"]["sceneSummary"] = None
source["summary"]["activePrimaryObjectiveSummary"] = None
(root / "current-representative.json").write_text(
    json.dumps(source, separators=(",", ":"), ensure_ascii=False) + "\n"
)
PY
```

Check the result:

```bash
python3 -m json.tool \
  apps/game/src-tauri/tests/fixtures/saves/current-representative.json \
  >/dev/null
```

Expected: valid JSON with `schemaVersion: 2` and the same authoritative snapshot bytes/values as the old fixture.

- [ ] **Step 2: Rewrite schema characterization tests to use the current fixture directly**

Replace the legacy helper in `schema.rs` tests with:

```rust
const REPRESENTATIVE: &str =
    include_str!("../../../tests/fixtures/saves/current-representative.json");

fn current_representative() -> &'static str {
    REPRESENTATIVE
}
```

Replace the legacy round-trip test with:

```rust
#[test]
fn current_representative_fixture_round_trips_exactly() {
    let save: SaveEnvelopeV2 = serde_json::from_str(REPRESENTATIVE).unwrap();
    assert_eq!(
        format!("{}\n", serde_json::to_string(&save).unwrap()),
        REPRESENTATIVE
    );
    assert_eq!(
        parse_current_envelope(REPRESENTATIVE.as_bytes()).unwrap(),
        save
    );
}
```

Rename the inventory test to `current_save_inventory_keeps_immutable_record_definitions_out_of_the_save` and deserialize `SaveEnvelopeV2`.

Add the old-format rejection:

```rust
#[test]
fn unshipped_old_format_is_rejected_without_migration() {
    let mut old: serde_json::Value =
        serde_json::from_str(REPRESENTATIVE).unwrap();
    old["schemaVersion"] = serde_json::json!(1);

    assert_eq!(
        parse_current_envelope(old.to_string().as_bytes())
            .unwrap_err()
            .code,
        "unsupportedSaveSchemaVersion"
    );
}
```

- [ ] **Step 3: Run the rewritten tests and confirm they fail against the migration-owned code**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::schema::tests
```

Expected: FAIL until direct current decoding and legacy-type removal are implemented.

- [ ] **Step 4: Remove active legacy types and decode directly**

In `schema.rs`:

- Delete `SAVE_SCHEMA_VERSION_V1`, `SAVE_SCHEMA_VERSION_V2`.
- Delete `SaveSummaryV1`.
- Delete `SaveEnvelopeV1`.
- Keep `SAVE_SCHEMA_VERSION: u32 = 2`.
- Keep `SaveEnvelopeV2`, `SaveSummaryV2`, `SaveSnapshotV1`, and nested current snapshot types unchanged to avoid rename-only churn.

Replace `parse_current_envelope` with:

```rust
pub(crate) fn parse_current_envelope(
    bytes: &[u8],
) -> Result<SaveEnvelopeV2, GameError> {
    let version = parse_schema_version(bytes)?;
    if version != SAVE_SCHEMA_VERSION {
        return Err(GameError::unsupported_save_schema_version());
    }

    let envelope = serde_json::from_slice::<SaveEnvelopeV2>(bytes)
        .map_err(|error| GameError::new(
            "malformedSaveJson",
            error.to_string(),
        ))?;
    validate_envelope(&envelope)?;
    Ok(envelope)
}
```

The version gate must happen before strict full decoding so a future/old discriminator with additional fields reports `unsupportedSaveSchemaVersion`, not a misleading malformed-JSON error.

- [ ] **Step 5: Remove migration dispatch from storage**

Delete the migration imports. Replace:

```rust
fn migrate_and_validate_envelope(
    bytes: &[u8],
) -> Result<SaveEnvelopeV2, GameError> {
    let envelope = migrate_to_current(bytes)?;
    validate_envelope(&envelope)?;
    Ok(envelope)
}
```

with:

```rust
fn parse_and_validate_envelope(
    bytes: &[u8],
) -> Result<SaveEnvelopeV2, GameError> {
    super::schema::parse_current_envelope(bytes)
}
```

Update `discover_slot`, `read_save_envelope`, `read_save_thumbnail`, and any test helper call sites to use the new name.

In `readable_metadata`, replace version dispatch with current-only decoding while retaining snapshot/package validation:

```rust
let summary = object
    .get("summary")
    .and_then(|value| {
        let version = parse_schema_version(bytes).ok()?;
        if version != SAVE_SCHEMA_VERSION {
            return None;
        }
        serde_json::from_value::<SaveSummaryV2>(value.clone()).ok()
    })
    .filter(|summary| {
        object
            .get("snapshot")
            .and_then(|value| {
                serde_json::from_value::<SaveSnapshotV1>(
                    value.clone(),
                )
                .ok()
            })
            .is_some_and(|snapshot| {
                validate_save_summary(
                    definitions,
                    &snapshot,
                    summary,
                )
                .is_ok()
            })
    });
```

- [ ] **Step 6: Remove the migration module and dead diagnostic**

- Delete `apps/game/src-tauri/src/game/save/migrations.rs`.
- Remove `pub(crate) mod migrations;` from `save/mod.rs`.
- Delete `GameError::missing_save_schema_migration`.
- Replace all fixture conversion helpers in `restore.rs`, `capture.rs`, `storage.rs`, and `test_support.rs` with direct current-fixture decoding.
- Delete `v1-representative.json`.
- Update `.prettierignore` to name `current-representative.json` instead of the deleted file.

Do not edit historical design/implementation documents merely because they describe the old implementation.

- [ ] **Step 7: Prove the migration surface is gone**

Run:

```bash
rg -n \
  'SaveEnvelopeV1|SaveSummaryV1|migrate_to_current|decode_summary_by_version|MIGRATION_REGISTRY|missingSaveSchemaMigration|v1-representative' \
  apps packages .prettierignore \
  --glob '!docs/superpowers/**'
```

Expected: no matches.

- [ ] **Step 8: Run focused Rust persistence tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::schema::tests
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::storage
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture
```

Expected: all pass; old `schemaVersion: 1` is invalid rather than migrated.

- [ ] **Step 9: Commit**

```bash
git add -A apps/game/src-tauri/src/game/save \
  apps/game/src-tauri/src/game/test_support.rs \
  apps/game/src-tauri/tests/fixtures/saves \
  apps/game/src-tauri/src/game/error.rs \
  .prettierignore
git commit -m "refactor: use one current pre-release save format"
```

---

### Task 4: Make Recap Copy Explicitly Additive and Non-Authoritative

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/schema.rs`
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/save/storage.rs`
- Modify: `apps/game/src/lib/components/SaveRecapDetails.test.ts`
- Modify: `apps/game/src/lib/persistence/types.test.ts`

**Interfaces:**
- Keeps wire key: `summary`.
- Keeps UI type: `SaveSummaryView`.
- Changes semantics: `SaveSummaryV2` is validated persisted recap cache; snapshot/package remain authoritative.
- Requires the merged HPA-508 rule: unfinished scenes capture `scene_summary: None`.

- [ ] **Step 1: Rebase on the merged HPA-508 implementation**

Run:

```bash
git fetch origin
git rebase origin/main
rg -n 'scene_summary: None|sceneSummary.*null|unfinished.*scene.*summary' \
  apps/game/src-tauri/src/game/save \
  apps/game/src/lib \
  apps/game/e2e-tauri
```

Expected: HPA-508 tests and capture logic are present. If not present, stop this task and merge HPA-508 first; do not duplicate its behavior inside HPA-540.

- [ ] **Step 2: Write failing cache-absence tests**

In `schema.rs` tests:

```rust
#[test]
fn optional_recap_copy_may_be_omitted_without_a_format_bump() {
    let mut value: serde_json::Value =
        serde_json::from_str(REPRESENTATIVE).unwrap();

    for field in [
        "chapterSummary",
        "sceneSummary",
        "activePrimaryObjectiveSummary",
    ] {
        value["summary"]
            .as_object_mut()
            .unwrap()
            .remove(field);
    }

    let parsed = parse_current_envelope(
        value.to_string().as_bytes(),
    )
    .unwrap();

    assert_eq!(parsed.summary.chapter_summary, None);
    assert_eq!(parsed.summary.scene_summary, None);
    assert_eq!(
        parsed.summary.active_primary_objective_summary,
        None
    );
}
```

In `restore.rs` tests, use the existing `resources_and_engine`, `envelope`, and `load_current_definitions` helpers:

```rust
#[test]
fn absent_optional_recap_copy_does_not_change_authoritative_restore() {
    let (_guard, resources, engine) = resources_and_engine();
    let mut save = envelope(&engine);
    let original_snapshot = save.snapshot.clone();
    save.summary.chapter_summary = None;
    save.summary.scene_summary = None;
    save.summary.active_primary_objective_summary = None;
    let definitions = load_current_definitions(&resources).unwrap();

    let candidate =
        build_restore_candidate(resources, &definitions, save).unwrap();

    assert_eq!(
        capture_checkpoint_v2(&candidate.engine)
            .unwrap()
            .snapshot,
        original_snapshot
    );
}

#[test]
fn present_recap_copy_must_match_current_definitions() {
    let (_guard, resources, engine) = resources_and_engine();

    assert_eq!(
        assert_rejected_without_live_mutation(
            &resources,
            &engine,
            |save| {
                save.summary.chapter_summary =
                    Some("tampered recap".into());
            },
        ),
        "invalidSaveProgress"
    );
}
```

Run the focused tests. Expected: the omission test may already pass because `Option` has Serde absence semantics, but the explicit cache documentation and cross-layer test are still required.

- [ ] **Step 3: Document and make default semantics explicit**

Above `SaveSummaryV2` add:

```rust
/// Persisted display cache for Save Browser and Continue.
///
/// This object is not authoritative game state. Restore uses `snapshot` plus
/// current packaged definitions. Optional presentation copy may be absent in
/// an older current-format file; when present it must match the authoritative
/// snapshot/package projection.
```

Annotate presentation-copy fields:

```rust
#[serde(default)]
pub(crate) chapter_summary: Option<String>,
#[serde(default)]
pub(crate) scene_summary: Option<String>,
#[serde(default)]
pub(crate) active_primary_objective_summary: Option<String>,
```

Do not add `skip_serializing_if`; new saves should keep producing explicit `null` where the current frontend/E2E contract expects it.

- [ ] **Step 4: Preserve authoritative restore boundaries**

Keep `validate_save_summary`'s required checks for:

- chapter ID/title;
- scene ID/title;
- active primary objective ID/label.

Keep its `is_none_or(...)` behavior for optional copy:

```rust
let recap_copy_matches =
    summary.chapter_summary
        .as_ref()
        .is_none_or(|value| value == &chapter.summary)
    && summary.scene_summary
        .as_ref()
        .is_none_or(|value| value == scene_summary)
    && summary.active_primary_objective_summary
        .as_ref()
        .is_none_or(|value| {
            Some(value) == active_primary_objective_summary.as_ref()
        });
```

Do not use recap copy to select chapter/scene, restore dialogue, restore story state, or decide completion.

- [ ] **Step 5: Keep invalid/incompatible metadata conservative**

Replace the existing V1-migration discovery test in `storage.rs` with a current public-view test using `discovery_fixture`, `FakeFilesystem`, and `discover_saves`:

```rust
#[test]
fn unsupported_format_keeps_safe_name_and_time_but_hides_recap() {
    let (_guard, _resources, context, template) =
        discovery_fixture();
    let fs = FakeFilesystem::new();
    let mut value = serde_json::to_value(&template).unwrap();
    value["schemaVersion"] = serde_json::json!(1);
    fs.put_file(
        slot_path(SaveSlotRef::Auto { slot: 1 }),
        serde_json::to_vec(&value).unwrap(),
        UNIX_EPOCH + Duration::from_secs(80),
    );

    let view = discover_saves(&fs, &root(), &context);
    let SaveSlotStatusView::Invalid {
        metadata: Some(metadata),
        diagnostic,
    } = &view.slots[0].status
    else {
        panic!("unsupported save was not exposed as invalid");
    };

    assert_eq!(diagnostic.code, "unsupportedSaveSchemaVersion");
    assert_eq!(
        metadata.display_name.as_deref(),
        Some(template.display_name.as_str())
    );
    assert_eq!(
        metadata.saved_at.as_deref(),
        Some(template.saved_at.as_str())
    );
    assert!(metadata.summary.is_none());
}
```

The invalid save remains discoverable, replaceable, and deletable; it never receives recap reconstructed from current content.

- [ ] **Step 6: Add frontend null-copy coverage**

In `SaveRecapDetails.test.ts`, render a valid summary with all three optional copy fields `null` and assert:

```ts
expect(screen.getByText(summary.chapterTitle)).toBeInTheDocument();
expect(screen.getByText(summary.sceneTitle)).toBeInTheDocument();
expect(
  screen.getByText("沒有進行中的主要目標"),
).toBeInTheDocument();
expect(screen.queryAllByTestId("recap-summary-copy")).toHaveLength(0);
```

In `persistence/types.test.ts`, keep `schemaVersion` numeric and the three fields nullable; do not introduce a versioned frontend union.

- [ ] **Step 7: Run recap and restore tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::schema::tests
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::storage
bunx vitest run \
  apps/game/src/lib/components/SaveRecapDetails.test.ts \
  apps/game/src/lib/persistence/types.test.ts
```

Expected: all pass, including HPA-508's unfinished-scene spoiler tests.

- [ ] **Step 8: Commit**

```bash
git add apps/game/src-tauri/src/game/save/schema.rs \
  apps/game/src-tauri/src/game/save/capture.rs \
  apps/game/src-tauri/src/game/save/restore.rs \
  apps/game/src-tauri/src/game/save/storage.rs \
  apps/game/src/lib/components/SaveRecapDetails.test.ts \
  apps/game/src/lib/persistence/types.test.ts
git commit -m "refactor: treat save recap as additive cache"
```

---

### Task 5: Remove Legacy Frontend/E2E Mirrors and Retain Current-Format Coverage

**Files:**
- Modify: `apps/game/e2e-tauri/save-fixtures.ts`
- Modify: `apps/game/e2e-tauri/save-seed.e2e.ts`
- Modify: `apps/game/e2e-tauri/save-management.e2e.ts` if it contains migration-only assertions
- Modify: `apps/game/e2e-tauri/save-resume.e2e.ts` if it narrows the old union
- Modify: `apps/game/src/lib/persistence/types.test.ts`
- Test: `apps/game/e2e-tauri/*.ts` through `check:e2e`
- Test: packaged save suites

**Interfaces:**
- Produces one TypeScript disk mirror:
  - `CURRENT_SAVE_SCHEMA_VERSION = 2`
  - `SaveE2eSaveEnvelope`
- Removes `SaveE2eSaveEnvelopeV1`, `SaveE2eSaveEnvelopeV2`, and schema-version narrowing branches.

- [ ] **Step 1: Write the single current E2E envelope type**

Replace the V1/V2 union in `save-fixtures.ts` with:

```ts
export const CURRENT_SAVE_SCHEMA_VERSION = 2 as const;

export type SaveE2eSaveSummary = {
  chapterId: string;
  chapterTitle: string;
  chapterSummary: string | null;
  sceneId: string;
  sceneTitle: string;
  sceneSummary: string | null;
  activePrimaryObjectiveId: string | null;
  activePrimaryObjectiveLabel: string | null;
  activePrimaryObjectiveSummary: string | null;
};

export type SaveE2eSaveEnvelope = {
  schemaVersion: typeof CURRENT_SAVE_SCHEMA_VERSION;
  contentRevision: string;
  saveId: string;
  saveType: "auto" | "manual";
  slot: number;
  savedAt: string;
  displayName: string;
  thumbnail: SaveE2eThumbnailDescriptor;
  summary: SaveE2eSaveSummary;
  snapshot: {
    chapterId: string;
    sceneId: string;
    scene: SaveE2eSceneSnapshot;
    activeDialogue: {
      activeSegmentIndex: number;
      itemCursor: number;
      queueGen: number;
    } | null;
    lastVisualCue: SaveE2eVisualCueSnapshot;
    inventory: SaveE2eInventorySnapshot;
    [key: string]: unknown;
  };
};
```

Rename the stale `Save schema v1 inventory payload` comment to `Current save inventory payload`.

- [ ] **Step 2: Remove version-narrowing branches**

In `save-seed.e2e.ts`, replace:

```ts
expect(unicodeEnvelope.schemaVersion).toBe(2);
if (unicodeEnvelope.schemaVersion !== 2) {
  throw new Error("new manual save was not written with schema version 2");
}
```

with:

```ts
expect(unicodeEnvelope.schemaVersion).toBe(
  CURRENT_SAVE_SCHEMA_VERSION,
);
```

Import the constant from `save-fixtures.ts`. Remove branches whose only purpose was narrowing the V1/V2 union.

Keep assertions for:

- current recap fields;
- exact snapshot scene state;
- inventory and visual cue persistence;
- Continue metadata;
- invalid-newest behavior;
- corruption and thumbnail fallback.

- [ ] **Step 3: Remove migration-only packaged scenarios**

Search:

```bash
rg -n \
  'schema-v1|schema v1|migrat|SaveE2eSaveEnvelopeV1|SaveE2eSaveEnvelopeV2' \
  apps/game/e2e-tauri apps/game/src/lib
```

For each result:

- Delete cases that prove V1→V2 migration.
- Keep cases that prove unsupported/corrupt saves remain visible and deliberately replaceable.
- Keep `schemaVersion` in `SaveMetadataView`; it remains useful diagnostics.

Do not remove current-format restart/resume coverage.

- [ ] **Step 4: Run type and frontend tests**

```bash
bun run --cwd apps/game check:e2e
bunx vitest run \
  apps/game/src/lib/persistence/types.test.ts \
  apps/game/src/lib/components/SaveCard.test.ts \
  apps/game/src/lib/components/SaveBrowser.test.ts \
  apps/game/src/lib/components/SaveRecapDetails.test.ts
node --test apps/game/scripts/save-e2e-paths.test.mjs
```

Expected: all pass with one E2E envelope shape.

- [ ] **Step 5: Run the packaged save suite**

```bash
bun run --cwd apps/game test:e2e:save
```

Expected suites:

```text
capture-proof
save-core
save-management
exit-lifecycle
```

They must still prove current-format manual save/autosave, restart/resume, five-slot rotation, invalid-newest handling, overwrite/delete, thumbnail fallback, acknowledgement durability, and exit flush/recovery.

- [ ] **Step 6: Commit**

```bash
git add apps/game/e2e-tauri \
  apps/game/src/lib/persistence/types.test.ts \
  apps/game/scripts/save-e2e-paths.test.mjs
git commit -m "test: remove unshipped save migration mirrors"
```

---

### Task 6: Lock the HPA-260 Extension Contract and Run the Final Gate

**Files:**
- Modify: `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`
- Modify: `CLAUDE.md` only if verification reveals missing guidance
- No production code changes unless a failing invariant test requires a focused fix

**Interfaces:**
- Produces: a verified HPA-260 handoff:
  - add `Analysis` to the current scene-progress snapshot;
  - no new envelope/snapshot version;
  - exact current-format round trip;
  - deterministic deep-state checkpoints.

- [ ] **Step 1: Add the post-HPA-540 HPA-260 checklist to the policy**

Append:

```markdown
## HPA-260 implementation checklist

- Extend the current `SceneProgressSnapshotV1` enum with `Analysis`; do not
  create a parallel enum or envelope.
- Persist only mutable analysis state: available/active board IDs, typed
  classify/order/threshold drafts, completion, accepted resolution, minimal
  feedback, and result-dialogue position.
- Keep immutable board definitions and accepted solutions in packaged content.
- Increment `DEVELOPMENT_SAVE_EPOCH` only if an already-written current
  development snapshot cannot be decoded safely after a breaking edit.
- Add representative current-format round trips and deterministic analysis
  checkpoints; do not check in saves from earlier prototypes.
```

This deliberately keeps the existing internal type name. HPA-260 may rename it only if the rename is incidental to the files it must already edit; a rename is not a reason to fork the format.

- [ ] **Step 2: Prove only the intended current compatibility symbols remain**

Run:

```bash
rg -n \
  'SaveEnvelopeV1|SaveSummaryV1|migrate_to_current|decode_summary_by_version|MIGRATION_REGISTRY|missingSaveSchemaMigration|v1-representative|SaveE2eSaveEnvelopeV1|SaveE2eSaveEnvelopeV2' \
  apps packages .prettierignore \
  --glob '!docs/superpowers/**'
```

Expected: no matches.

Run:

```bash
rg -n \
  'SAVE_SCHEMA_VERSION|DEVELOPMENT_SAVE_EPOCH|DEVELOPMENT_APP_IDENTIFIER|SaveRuntimeChannel' \
  apps/game/src-tauri apps/game/e2e-tauri apps/game/scripts
```

Expected:

- one current schema constant;
- one development epoch constant;
- one development identifier constant;
- root selection centralized in `storage.rs`.

- [ ] **Step 3: Run the complete non-packaged verification matrix**

```bash
bun run scenes:compile
bun run check:scripts
bun run test
bun run check
bun run --cwd apps/game check:e2e
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run lint:all
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Re-run the packaged persistence gate after the final rebase**

```bash
bun run --cwd apps/game test:e2e:save
```

Expected: all selected packaged suites pass using production IPC/resources and the isolated E2E root.

- [ ] **Step 5: Perform the required self-review**

Record these checks in the PR description:

```markdown
## HPA-540 self-review

- [ ] Confirmed no shipped save-compatibility promise existed.
- [ ] Production identifier/root and slot behavior are unchanged.
- [ ] Debug Tauri cannot select the production namespace.
- [ ] Browser development uses the shared development epoch.
- [ ] E2E temp-root and cleanup defenses are unchanged.
- [ ] Runtime decodes one current format.
- [ ] V1→V2 migration code, fixture, diagnostics, and TypeScript union are gone.
- [ ] Optional recap copy is non-authoritative and HPA-508 remains spoiler-safe.
- [ ] `contentRevision`, detached restore, exact recapture, and public-view
      validation remain strict.
- [ ] Atomic write, sidecar, autosave, acknowledgement, stale-selection, and
      exit tests remain green.
- [ ] HPA-260 can add current analysis state without a migration chain.
```

- [ ] **Step 6: Commit the final handoff documentation**

```bash
git add docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md \
  CLAUDE.md
git commit -m "docs: lock analysis save extension contract"
```

---

## Execution Notes

- Implement this as one PR with the six reviewable commits above. The storage namespace commit must land before legacy decoding is removed so development immediately stops reading old production-path saves.
- Do not mix HPA-521 file decomposition into this branch.
- HPA-508 should merge first because both tasks touch recap capture/validation; rebase before Task 4 rather than resolving two competing summary semantics afterward.
- HPA-260 starts only after the final packaged save suite is green.
- Historical specs/plans that accurately describe the old implementation remain historical records and are not rewritten.
