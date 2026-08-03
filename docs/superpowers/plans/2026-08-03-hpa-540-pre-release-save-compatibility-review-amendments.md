# HPA-540 Implementation Plan Review Amendments

> **Status:** Normative corrections to `2026-08-03-hpa-540-pre-release-save-compatibility-implementation-plan.md`. Implementers must read this file first. Where this document conflicts with the original plan, this document wins.

## Review disposition

| Review item | Disposition | Action |
|---|---|---|
| Current-fixture summary field order | Valid, blocking | Replace Task 3 Step 1 with the deterministic object reconstruction below. |
| HPA-508 is not merged and preserves migration coverage | Valid dependency/coupling | Do not execute Task 4 until HPA-508 is merged; explicitly collapse HPA-508 migration-preservation tests during Tasks 3 and 5. |
| Debug identifier guard breaks ad-hoc startup without the dev config | Valid, intentional fail-closed behavior | Document the supported development command and the expected `unsafeSaveNamespace` failure. |
| Browser dev save root moves | Valid, intentional one-time reset | Document that the old root is left untouched and is not migrated. |
| Missing recap copy is not rebuilt | Valid observation; no defect | Explicitly choose “render no prose when absent” for HPA-540. Do not add a second completion-aware recap projection yet. |
| Replacing `tauri.dev.conf.json` is brittle | Valid | Preserve all existing keys and set only the `identifier` field. |
| `bunx vitest` differs from repository commands | Valid | Use the canonical `bun run --cwd apps/game test ...` form. |
| Audit grep may match the new policy later | Harmless | No change; the audit runs before the policy is added and is evidence for the PR precondition. |

---

## Amendment 1: Replace Task 3 Step 1 fixture generation

The original script appends the three V2 recap-copy keys to the old V1 object. JSON insertion order would then differ from `SaveSummaryV2` declaration order, causing the byte-exact `serde_json::to_string` round-trip assertion to fail.

Use this script instead:

```bash
python3 - <<'PY'
import json
from pathlib import Path

root = Path("apps/game/src-tauri/tests/fixtures/saves")
source = json.loads((root / "v1-representative.json").read_text())
source["schemaVersion"] = 2

summary = source["summary"]
source["summary"] = {
    "chapterId": summary["chapterId"],
    "chapterTitle": summary["chapterTitle"],
    "chapterSummary": None,
    "sceneId": summary["sceneId"],
    "sceneTitle": summary["sceneTitle"],
    "sceneSummary": None,
    "activePrimaryObjectiveId": summary["activePrimaryObjectiveId"],
    "activePrimaryObjectiveLabel": summary["activePrimaryObjectiveLabel"],
    "activePrimaryObjectiveSummary": None,
}

(root / "current-representative.json").write_text(
    json.dumps(source, separators=(",", ":"), ensure_ascii=False) + "\n"
)
PY
```

Then verify both JSON validity and the expected key order before deleting the V1 fixture:

```bash
python3 - <<'PY'
import json
from pathlib import Path

path = Path("apps/game/src-tauri/tests/fixtures/saves/current-representative.json")
value = json.loads(path.read_text())
assert list(value["summary"]) == [
    "chapterId",
    "chapterTitle",
    "chapterSummary",
    "sceneId",
    "sceneTitle",
    "sceneSummary",
    "activePrimaryObjectiveId",
    "activePrimaryObjectiveLabel",
    "activePrimaryObjectiveSummary",
]
assert value["schemaVersion"] == 2
PY
```

Add this comment immediately above the byte-exact Rust fixture test:

```rust
// This fixture intentionally locks UTF-8 text and struct-declaration key order.
// `serde_json::to_string` emits UTF-8 and serializes struct fields in declaration order.
```

Do not weaken the exact fixture assertion to parsed-value equality; the current fixture is intended to characterize the encoder’s on-disk output.

---

## Amendment 2: Make the HPA-508 merge boundary explicit

HPA-508 is currently Todo and its approved scope deliberately preserves V1 → V2 migration and partial readable-metadata behavior. HPA-540 removes that unshipped migration surface. Therefore:

1. The implementation PR must not execute Task 4 until HPA-508 is merged into `main` and the HPA-540 branch has rebased.
2. Tasks 1–3 may be developed before that rebase, but the implementation PR is not mergeable until all six tasks are complete against the merged HPA-508 behavior.
3. During Task 3, search HPA-508’s new Rust tests for assumptions that `schemaVersion: 1` migrates or exposes migrated recap fields. Replace those cases with current-format or unsupported-format cases.
4. During Task 5, remove any HPA-508 frontend/E2E branch whose only purpose is V1 → V2 migration. Preserve its actual spoiler assertions:
   - unfinished investigation summary is absent;
   - unfinished interrogation/hearing summary is absent;
   - linear-scene summary is absent;
   - completed eligible scenes may expose safe summary copy.

Required search after rebasing HPA-508:

```bash
rg -n \
  'schema.?v1|schemaVersion.*1|migrat|sceneSummary|unfinished.*summary' \
  apps/game/src-tauri/src/game/save \
  apps/game/src-tauri/tests \
  apps/game/src/lib \
  apps/game/e2e-tauri
```

Classify every match as one of:

- current spoiler-safety behavior to retain;
- unshipped migration behavior to remove;
- historical documentation outside the runtime/test surface.

The required merge order remains:

```text
HPA-508 → HPA-540 → HPA-260
```

---

## Amendment 3: Document fail-closed development startup

Task 2 intentionally derives `SaveRuntimeChannel::Development` from a non-E2E debug build and requires identifier `com.chanwaichan.lyra.dev`. As a result, launching a debug shell with the production config must fail rather than silently reading production saves.

Add this contributor guidance to the HPA-540 policy and `CLAUDE.md`:

```markdown
### Development Tauri startup

Use `bun run dev:game` (or `bun run --cwd apps/game dev:tauri`) for the game
Tauri development loop. These commands load
`apps/game/src-tauri/tauri.dev.conf.json`, whose identifier is
`com.chanwaichan.lyra.dev`.

A bare `cargo run --manifest-path apps/game/src-tauri/Cargo.toml` or
`tauri dev` without `-c src-tauri/tauri.dev.conf.json` loads the production
identifier in a debug build. The app intentionally fails startup with
`unsafeSaveNamespace`; this prevents a debug build from reading or writing the
production save root.
```

Add a config-contract assertion that the documented commands still include the dev config:

```js
const gamePackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
assert.match(
  gamePackage.scripts["dev:tauri"],
  /tauri dev -c src-tauri\/tauri\.dev\.conf\.json/,
);
```

Do not soften `require_identifier` to make unsupported ad-hoc commands work.

---

## Amendment 4: Record the browser-dev one-time reset

When `build_development_app_state` changes from accepting the final root to accepting a development app-data base, the browser development server moves from:

```text
apps/game/src-tauri/target/dev-engine-server/saves
```

to:

```text
apps/game/src-tauri/target/dev-engine-server/saves-dev/epoch-1
```

This is an intentional one-time development-data reset.

Add this to the policy and PR implementation notes:

- Do not copy or migrate the old `target/dev-engine-server/saves` contents.
- Do not delete the old directory automatically.
- The first run after HPA-540 starts with an empty browser-development save browser.
- Developers may inspect or manually delete the old repository-local directory later.
- Production and E2E roots are unaffected.

This behavior demonstrates the epoch policy rather than constituting a migration requirement.

---

## Amendment 5: Explicitly choose no recap reconstruction in HPA-540

HPA-540 allows missing recap copy to be rebuilt from current packaged definitions, but does not require it. For this implementation, choose the simpler behavior:

> If an optional persisted recap-copy field is absent or `null`, the public save metadata leaves it `null`, and the UI renders the validated chapter/scene titles without recap prose.

Rationale:

- New saves already capture current safe copy where allowed.
- HPA-508 makes scene-summary eligibility dependent on saved completion state.
- Rebuilding prose in discovery would require a second completion-aware projection mirroring capture semantics, creating a new drift and spoiler surface.
- No shipped format requires richer fallback UX.
- Exact `contentRevision` and required title/ID validation remain strict.

Add this policy text:

```markdown
### Missing recap cache fields

HPA-540 does not reconstruct absent recap prose. For a valid current-format
save, missing optional recap-copy fields remain absent in `SaveMetadataView`.
The Save Browser and Continue UI still show validated chapter/scene titles and
objective labels, but omit the missing prose. A future completion-aware
projection may be added only if real player-facing value justifies duplicating
capture eligibility rules.
```

Keep Task 4’s frontend assertion that zero `recap-summary-copy` elements render when all optional copy is absent.

Never rebuild `sceneSummary` solely from the current scene definition; doing so would reveal unfinished-scene outcomes and violate HPA-508.

---

## Amendment 6: Preserve development config keys

Replace Task 2 Step 6’s wording with:

> Edit `apps/game/src-tauri/tauri.dev.conf.json`, preserving all existing keys, and set the top-level `identifier` to `com.chanwaichan.lyra.dev`.

The expected current result is:

```json
{
  "identifier": "com.chanwaichan.lyra.dev",
  "build": {
    "beforeDevCommand": null
  }
}
```

Do not instruct an implementer to wholesale replace the file if later rebases add unrelated development configuration.

---

## Amendment 7: Use canonical frontend test commands

Replace Task 4 Step 7’s frontend command with:

```bash
bun run --cwd apps/game test \
  src/lib/components/SaveRecapDetails.test.ts \
  src/lib/persistence/types.test.ts
```

Replace Task 5 Step 4’s frontend command with:

```bash
bun run --cwd apps/game test \
  src/lib/persistence/types.test.ts \
  src/lib/components/SaveCard.test.ts \
  src/lib/components/SaveBrowser.test.ts \
  src/lib/components/SaveRecapDetails.test.ts
```

The Rust, Node, type-check, and packaged E2E commands remain unchanged.

---

## Revised execution readiness

The documentation PR may merge now. The runtime implementation should begin only when either:

1. HPA-508 is already merged; or
2. the implementer deliberately stops after Tasks 1–3, waits for HPA-508, rebases, and then completes Tasks 4–6 in the same implementation PR.

The preferred path is to merge HPA-508 first, then execute HPA-540 end to end. This avoids carrying two temporary recap/migration semantics in one branch.