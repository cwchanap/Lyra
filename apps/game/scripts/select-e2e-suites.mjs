import { E2E_SUITE_IDS, normalizeE2eSuiteIds } from "./e2e-suite-registry.mjs";

function freezeRule(rule) {
  return Object.freeze({
    ...rule,
    patterns: Object.freeze([...rule.patterns]),
    excludedPatterns: Object.freeze([...(rule.excludedPatterns ?? [])]),
    suiteIds: Object.freeze([...rule.suiteIds]),
  });
}

// This map is the reviewable source of truth for path ownership. Rules union
// their suites; force-full infrastructure rules intentionally dominate them.
export const E2E_RISK_RULES = Object.freeze([
  freezeRule({
    id: "e2e-infrastructure",
    patterns: [
      ".github/workflows/ci.yml",
      "apps/game/e2e-tauri/**",
      "apps/game/scripts/*.test.mjs",
      "apps/game/scripts/build-e2e.mjs",
      "apps/game/scripts/cleanup-e2e-roots.mjs",
      "apps/game/scripts/e2e-*.mjs",
      "apps/game/scripts/plan-e2e-ci.mjs",
      "apps/game/scripts/require-e2e-binary.mjs",
      "apps/game/scripts/run-save-e2e.mjs",
      "apps/game/scripts/save-e2e-paths.mjs",
      "apps/game/scripts/select-e2e-suites.mjs",
      "apps/game/wdio.conf.ts",
      "apps/game/package.json",
    ],
    suiteIds: E2E_SUITE_IDS,
    forceFull: true,
  }),
  freezeRule({
    id: "story-and-compiler",
    patterns: [
      "docs/stories_plan/chapter_*/**",
      "static/stories_plan/chapter_*/**",
      "packages/scripts/compile-scenes.ts",
      "packages/scripts/compile-scenes/**",
      "packages/scene-types/**",
      "static/assets/config/**",
    ],
    suiteIds: ["smoke", "gameplay", "production-journey"],
  }),
  freezeRule({
    id: "capture",
    patterns: [
      "apps/game/src-tauri/src/game/save/capture.rs",
      "apps/game/src/lib/persistence/thumbnail-capture.*",
      "apps/game/src/lib/test-harnesses/capture-proof-*.ts",
    ],
    suiteIds: ["smoke", "capture-proof"],
  }),
  freezeRule({
    id: "exit-lifecycle",
    patterns: [
      "apps/game/src-tauri/src/game/save/coordinator/**/exit*.rs",
      "apps/game/src/lib/persistence/**/exit*.ts",
    ],
    suiteIds: ["smoke", "exit-lifecycle"],
  }),
  freezeRule({
    id: "persistence",
    patterns: [
      "apps/game/src/lib/components/Save*.svelte",
      "apps/game/src/lib/persistence/**",
      "apps/game/src-tauri/src/game/save/**",
    ],
    excludedPatterns: [
      "apps/game/src-tauri/src/game/save/capture.rs",
      "apps/game/src-tauri/src/game/save/coordinator/**/exit*.rs",
    ],
    suiteIds: [
      "smoke",
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ],
  }),
  freezeRule({
    id: "gameplay",
    patterns: [
      "apps/game/src/lib/components/ExploreView.svelte",
      "apps/game/src/lib/components/Investigation*.svelte",
      "apps/game/src/lib/components/SceneNavigation*.svelte",
      "apps/game/src-tauri/src/game/acquisition.rs",
      "apps/game/src-tauri/src/game/dialogue*.rs",
      "apps/game/src-tauri/src/game/navigation.rs",
      "apps/game/src-tauri/src/game/reveals.rs",
      "apps/game/src-tauri/src/game/story/**",
      "apps/game/src-tauri/src/game/unlock.rs",
    ],
    suiteIds: ["smoke", "gameplay", "production-journey"],
  }),
  // These acknowledgement surfaces bridge gameplay progress and persistence
  // without being exercised by the capture-proof or manual-save suites.
  freezeRule({
    id: "acquisition-acknowledgement",
    patterns: [
      "apps/game/src/lib/components/AcquisitionPopup.svelte",
      "apps/game/src/lib/state/acquisition-controller.svelte.ts",
    ],
    suiteIds: [
      "smoke",
      "gameplay",
      "production-journey",
      "save-core",
      "exit-lifecycle",
    ],
  }),
  // The dialogue root and its crossfade are both capture-proven persistence
  // carriers and the common progression surface for every packaged suite.
  freezeRule({
    id: "dialogue-capture-surface",
    patterns: [
      "apps/game/src/lib/components/DialogueBox.svelte",
      "apps/game/src/lib/components/CrossfadeImage.svelte",
      "apps/game/src/routes/+page.svelte",
    ],
    suiteIds: E2E_SUITE_IDS,
  }),
  // +layout.svelte installs window.__lyraE2e and renders the checkpoint-
  // generation marker that loadPackagedCheckpoint() waits on. Every gameplay
  // spec calls loadPackagedCheckpoint(); smoke does not. Without this rule a
  // bridge-only break passes smoke while gameplay fails on nightly/full CI.
  freezeRule({
    id: "checkpoint-bridge-surface",
    patterns: ["apps/game/src/routes/+layout.svelte"],
    suiteIds: ["smoke", "gameplay"],
  }),
  freezeRule({
    id: "general-ui",
    patterns: [
      "apps/game/src/routes/**",
      "apps/game/src/lib/audio/**",
      "apps/game/src/lib/assets/**",
      "apps/game/src/lib/components/**",
    ],
    suiteIds: ["smoke"],
  }),
]);

const GLOBSTAR_SENTINEL = "\u0000";

function patternMatches(pattern, changedPath) {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replaceAll("**", GLOBSTAR_SENTINEL)
    .replaceAll("*", "[^/]*")
    .replaceAll(GLOBSTAR_SENTINEL, ".*");
  return new RegExp(`^${escaped}$`).test(changedPath);
}

function matchesRule(rule, changedPath) {
  return (
    rule.patterns.some((pattern) => patternMatches(pattern, changedPath)) &&
    !rule.excludedPatterns.some((pattern) =>
      patternMatches(pattern, changedPath),
    )
  );
}

function isDocumentationPath(changedPath) {
  return (
    changedPath.startsWith("docs/") ||
    changedPath.endsWith(".md") ||
    (changedPath.startsWith("static/stories_plan/") &&
      changedPath.endsWith(".md"))
  );
}

function normalizeChangedPaths(changedPaths) {
  if (!Array.isArray(changedPaths))
    throw new Error("Changed paths must be an array.");
  const normalized = new Set();
  for (const changedPath of changedPaths) {
    if (typeof changedPath !== "string" || changedPath.length === 0)
      throw new Error("Changed paths must be non-empty strings.");
    normalized.add(changedPath.replace(/^\.\//, ""));
  }
  return [...normalized].sort();
}

function forcedFullTrigger({ forceFull, eventName, ref }) {
  if (forceFull) return "manual-override";
  if (eventName === "schedule") return "nightly";
  if (eventName === "workflow_dispatch") return "workflow-dispatch";
  if (ref?.startsWith("refs/tags/")) return "tag";
  if (ref === "refs/heads/main") return "main";
  return null;
}

/**
 * Selects the canonical-order union of every matching E2E risk rule without
 * doing filesystem or GitHub Actions I/O.
 */
export function selectE2eSuites({
  changedPaths,
  forceFull = false,
  eventName = "pull_request",
  ref = "",
} = {}) {
  const normalizedPaths = normalizeChangedPaths(changedPaths);
  const matchedRules = new Map();
  const unmatchedPaths = [];
  const riskSuiteIds = new Set();
  let forcedFullReason = forcedFullTrigger({ forceFull, eventName, ref });

  for (const changedPath of normalizedPaths) {
    const matchingRules = E2E_RISK_RULES.filter((rule) =>
      matchesRule(rule, changedPath),
    );
    if (matchingRules.length === 0) {
      if (!isDocumentationPath(changedPath)) unmatchedPaths.push(changedPath);
      continue;
    }
    for (const rule of matchingRules) {
      const paths = matchedRules.get(rule.id) ?? [];
      paths.push(changedPath);
      matchedRules.set(rule.id, paths);
      rule.suiteIds.forEach((suiteId) => riskSuiteIds.add(suiteId));
      if (rule.forceFull && forcedFullReason === null)
        forcedFullReason = rule.id;
    }
  }

  if (unmatchedPaths.length > 0 && forcedFullReason === null)
    forcedFullReason = "unmatched-non-documentation-path";

  const riskSelectedSuites =
    riskSuiteIds.size === 0 ? [] : normalizeE2eSuiteIds([...riskSuiteIds]);
  const forcedFull = forcedFullReason !== null;
  const suiteIds = forcedFull ? [...E2E_SUITE_IDS] : riskSelectedSuites;

  return Object.freeze({
    changedPaths: Object.freeze(normalizedPaths),
    matchedRules: Object.freeze(
      [...matchedRules.entries()].map(([id, paths]) =>
        Object.freeze({ id, paths: Object.freeze(paths) }),
      ),
    ),
    unmatchedPaths: Object.freeze(unmatchedPaths),
    riskSelectedSuites: Object.freeze(riskSelectedSuites),
    suiteIds: Object.freeze(suiteIds),
    skip: suiteIds.length === 0,
    forcedFull,
    forcedFullReason,
  });
}
