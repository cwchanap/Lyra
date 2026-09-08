# HPA-136 Story Workbench Context-Aware AI Review Design

## Status

Planning design for **HPA-136 — [Story Workbench] Add context-aware AI review MVP**.

One ticket, one PR. This PR starts as planning-only and will carry the implementation after the design/plan is accepted; HPA-136 must not be split across follow-up implementation PRs.

Baseline: current `main` after HPA-135 / PR #84, with HPA-634 Reader, HPA-134 Assets, HPA-273 Plan, and HPA-135 focused reviewed source editing already landed.

## Goal

Add one small, explicit AI review partner to the existing Story Workbench:

```text
select an existing Workbench source
→ choose one relevant review lens
→ inspect/remove deterministic supporting context
→ Run review
→ inspect grounded structured findings
→ optionally hand one eligible replacement to HPA-135
→ human reviews exact diff and explicitly applies
```

The AI never writes source. HPA-135 remains the only story/prompt mutation boundary.

## Product cut

HPA-136 v1 is **not a chatbot and not a new top-level Workbench mode**. It is one contextual review panel opened from the source the author is already inspecting.

Supported entry points:

| Surface | Selection | Lenses | Replacement handoff |
|---|---|---|---|
| Reader | current scene | Story consistency | findings only |
| Reader | one dialogue line | Story consistency, Dialogue review | yes — existing HPA-135 dialogue target |
| Reader | one single-line action | Story consistency, Dialogue review | yes — existing HPA-135 action target |
| Plan | selected heading section | Story consistency | findings only |
| Assets | background/evidence manifest prompt | Prompt refinement | yes only when `assetPromptEditSource()` already returns a HPA-135 target |
| Assets | portrait/character expression prompt | Prompt refinement | findings only |

Explicitly out of v1:

- blank chat input or general-purpose assistant;
- whole-chapter rewrite;
- automatic review on selection change;
- background review daemon;
- multi-turn conversation state;
- embeddings, vector DB, RAG index, file-search tool, or repository-wide retrieval;
- AI-specific source mutation command;
- YAML writeback for character/expression/audio prompts;
- provider settings UI, model picker, marketplace, account system, metering, feedback store;
- image/audio generation;
- persistent review history.

## Existing seams to reuse

### Reader

`projectReaderScene()` remains the only scene walk. `ReaderView` already carries compiler-owned `ReaderEditableRef { carrierId, itemIndex }` on dialogue/actions and `ReaderGroup.sourceAnchor` for source identity.

AI review must consume these existing identities. It must not parse a second carrier grammar or search rendered text to rediscover a source.

### Assets

`load_asset_workspace` + `projectAssetWorkspace()` already expose:

- compiler manifest entries;
- `promptParts.globalStyle`;
- `promptParts.typePrompt`;
- `promptParts.subjectPrompt`;
- `promptParts.entryPrompt`;
- `finalPrompt`;
- concrete scene usages;
- scene-owned prompt identity through `assetPromptEditSource()`.

The AI context builder consumes these values directly. It does not rebuild prompt composition.

### Plan

HPA-273 already owns Story Bible and chapter-plan loading plus the Story Bible chapter overview and Aoba reveal contract. HPA-136 extends that projection only enough to expose exact heading source ranges for deterministic section excerpts.

It does not introduce a second Plan loader or story-canon database.

### Focused edit

HPA-135 already owns:

```text
openFocusedEdit(selection, replacement)
→ exact one-hunk diff
→ expectedHash/source guard
→ human Apply
→ one-line atomic write
→ bun run scenes:compile
→ refresh projections
```

HPA-136 may provide only the replacement string. It does not provide paths, line numbers, `nextContent`, hashes, or write commands.

## Interaction model

`App.svelte` continues to own one active author action. Add one contextual `AiReviewPanel` alongside the existing focused-edit review surface.

The panel lifecycle is intentionally small:

```text
idle
→ ready (selection + context chips visible)
→ running
→ result | failed | canceled
```

Rules:

- opening a new AI review selection replaces the old review selection/result;
- changing lens rebuilds deterministic default context and clears the old result;
- supporting context chips can be removed before Run;
- the selected source itself is required and cannot be removed;
- Run is always a button press;
- Cancel is a frontend generation fence: the UI discards the eventual response. v1 does not add a backend cancellation registry;
- no provider request starts from component mount, selection change, refresh, or background timer.

## Selection contract

Keep review selection separate from provider payloads so UI identity never comes from model output.

```ts
export type AiReviewLens =
  | "storyConsistency"
  | "dialogue"
  | "promptRefinement";

export type AiReviewSelection =
  | {
      kind: "readerScene";
      chapterId: string;
      sceneId: string;
      scene: ReaderScene;
    }
  | {
      kind: "readerItem";
      chapterId: string;
      sceneId: string;
      scene: ReaderScene;
      group: ReaderGroup;
      ref: ReaderEditableRef;
      item: Extract<ReaderItem, { kind: "line" | "action" }>;
      editSelection: PendingFocusedEditSelection;
    }
  | {
      kind: "planSection";
      documentId: string;
      anchor: string;
    }
  | {
      kind: "assetPrompt";
      assetId: string;
      entry: AssetManifestEntry;
      usages: AssetSceneUsage[];
      editSelection: PendingFocusedEditSelection | null;
    };
```

`PendingFocusedEditSelection` should move out of `App.svelte` into the focused-edit module as an exported type because HPA-136 needs to carry the exact same pre-source-load selection into the existing HPA-135 handoff. Do not invent `AiEditTarget` path/line fields.

## Deterministic context model

All context is constructed locally before any network call.

```ts
export type AiReviewContextItem = {
  ref: string;
  kind:
    | "selection"
    | "sceneProjection"
    | "chapterPlan"
    | "storyBible"
    | "revealBoundary"
    | "characterVoice"
    | "promptLayer"
    | "usageImpact";
  label: string;
  sourceRef: string;
  content: string;
  approxChars: number;
  required: boolean;
};

export type AiReviewMissingContext = {
  kind: AiReviewContextItem["kind"];
  label: string;
  reason: string;
};
```

`approxChars` is `content.length`, shown as an intentionally approximate payload-size hint. Do not add a tokenizer dependency for v1.

`ref` is a stable request-local key. `sourceRef` is human-readable provenance such as:

```text
docs/stories_plan/chapter_1/scene_2.md

docs/stories_plan/chapter_1_plan.md#beat-2-委託與程序入口-三宅母親求助

docs/stories_plan/final_story_bible.md#第一幕青葉提問契約

docs/stories_plan/characters.md#相馬律

static/assets/config/policy.yaml :: globalStylePrompt
static/assets/config/characters.yaml :: soma_ritsu.visualPrompt
```

Supporting items are removable. Missing deterministic context is rendered separately and is never silently substituted with a fuzzy match.

## Exact section extraction

### Plan headings

Extend the existing `PlanHeading` projection with source range metadata:

```ts
export type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
  line: number;
  endLine: number;
};
```

`endLine` is the line before the next heading at the same or higher level, or EOF. The token walk already has heading lines, so this is an additive projection — no second Markdown parser.

A helper returns an exact section excerpt from a selected document/anchor. If the anchor does not exist, context is missing.

### Reader scene → chapter-plan Beat

For the normal authored scene families, derive a candidate beat label only from the scene id:

```text
scene_2                 → 2
investigation_scene_3   → 3
analysis_scene_8_5      → 8.5
interrogation_scene_10  → 10
```

Then require exactly one top-level chapter-plan heading beginning with `Beat <label>：`.

Do **not** guess for `scene_p0`, `investigation_scene_p1`, `investigation_scene_map_01`, or any future id that does not match the closed numeric pattern. Those cases visibly report `Parent chapter-plan section unavailable for this scene id`.

This deliberately prefers missing context over a false canon relationship.

### Story Bible chapter section

Use the selected chapter number plus the HPA-273 Story Bible chapter-overview row. Require an exact chapter heading matching that chapter/title family. If no exact section exists, report missing.

### Aoba reveal boundary

Use only HPA-273's parsed `aobaReveal.stages`. Match the current chapter number to exactly one stage. The context chip contains `mustEstablish` and `mustNotEstablish` and links to the existing Aoba reveal heading.

For Chapter 1 / Chapter 2 this preserves the current canon boundary: Chapter 1 names Aoba without explaining the public footage; Chapter 2 establishes that the famous footage is a post-fire official reenactment without revealing the later left/right/A-90 answer.

No AI prompt is allowed to infer extra Aoba relationships from `ZW_A16.lock` or asset names.

## Character voice reference

Dialogue review needs the authored reviewer/writer reference `docs/stories_plan/characters.md`, which HPA-273 does not currently load.

Add one fixed backend read seam:

```text
load_story_review_references
```

Payload v1:

```ts
{
  characters: { path: "docs/stories_plan/characters.md", content: string }
}
```

The backend resolves a hard-coded repo-relative file under the existing workspace root. There is no arbitrary-path argument.

The frontend reuses the same Markdown heading-section extractor to find the character section for the selected line's exact speaker. A valid match is one unique `###` heading whose plain text is either the speaker or begins with `<speaker>（...）`.

If the speaker has no unique section, Dialogue review shows missing voice context. It does not ask the model to infer personality from the whole repository.

## Context by lens

### Story consistency

Default supporting context, when deterministically available:

1. required selected source / selected public Reader projection;
2. exact parent chapter-plan Beat section;
3. exact Story Bible chapter section;
4. matching Aoba reveal-boundary row.

The model checks only high-value source-supported issues:

- canon contradiction;
- premature reveal;
- failure to establish a required reveal that the supplied section explicitly requires;
- obvious timeline, fair-play, location, or capability conflict directly supported by the supplied sources.

No general taste rewrite and no whole-chapter rewrite.

### Dialogue review

Default supporting context:

1. required selected dialogue/action;
2. containing Reader group as local scene context;
3. exact selected speaker's `characters.md` section when applicable;
4. exact parent chapter-plan Beat section when available.

Review dimensions:

- character voice mismatch;
- repeated exposition;
- pacing/readability inside the local selection/group.

The existing repository vocabulary remains authoritative; HPA-136 does not recreate the nine-axis batch semantic-review framework inside the Workbench.

### Prompt refinement

Default supporting context comes only from the selected manifest entry and Assets projection:

- global style (`static/assets/config/policy.yaml :: globalStylePrompt`);
- type policy (`static/assets/config/policy.yaml :: types.<type>.prompt`);
- subject/identity prompt when non-empty;
- entry prompt;
- concrete usage impact from `AssetSceneUsage[]`.

The selected prompt/layer is required. Other layers are removable context.

For scene-owned background/evidence prompts, suggestions default to replacing the editable `entryPrompt` only.

For portrait/character prompt review, HPA-136 can produce findings about the existing identity/expression layering, but **replacement handoff is disabled in v1** because HPA-135 intentionally deferred YAML writeback. HPA-136 must not add a second YAML writer merely to satisfy AI suggestions.

Shared/global/type layer suggestions are findings only in v1. Usage impact remains visible so the author knows the blast radius.

## Provider request contract

The provider receives no filesystem access and no tool access. The frontend constructs this bounded request:

```ts
export type AiReviewProviderRequest = {
  lens: AiReviewLens;
  selectedSourceRef: string;
  selectedText: string;
  context: Array<{
    ref: string;
    sourceRef: string;
    kind: AiReviewContextItem["kind"];
    content: string;
  }>;
  missingContext: AiReviewMissingContext[];
  replacementTargetRef: string | null;
};
```

Only active, non-removed context items are serialized.

No repo path outside these explicit source refs is sent, no files are uploaded, and no provider-side search/retrieval tool is enabled.

## Structured result contract

Use the existing semantic-review severity vocabulary without creating a new scale:

```ts
export type AiReviewSeverity = "Blocker" | "Important" | "Minor";

export type AiReviewResult = {
  lens: AiReviewLens;
  reviewedSourceRefs: string[];
  findings: Array<{
    severity: AiReviewSeverity;
    summary: string;
    explanation: string;
    supportingSourceRefs: string[];
  }>;
  uncertainty: string[];
  impact: null | {
    sourceRefs: string[];
    shared: boolean;
    note: string;
  };
  replacement: null | {
    targetRef: string;
    replacementText: string;
    rationale: string;
  };
  noChange: boolean;
};
```

Hard limits in the JSON Schema:

- maximum 6 findings;
- at most one replacement because `replacement` is one nullable object, not an array;
- `additionalProperties: false` on every object;
- all object fields required, using nullable fields where absence is allowed.

The provider's `impact` is explanatory only. HPA-135's locally derived impact remains authoritative at edit-review time.

## Local response validation

Structured Outputs is necessary but not sufficient. Add a small handwritten TypeScript validator rather than a new schema library.

A result is accepted only when:

1. the result shape is exact enough for the local contract;
2. returned `lens` equals the request lens;
3. every `reviewedSourceRefs`, `supportingSourceRefs`, and `impact.sourceRefs` value is from the request's selected source/context refs;
4. every finding has at least one supporting source ref;
5. `replacement.targetRef` exactly equals the locally supplied `replacementTargetRef`;
6. a replacement is rejected when the selection has no HPA-135 target;
7. replacement text contains no CR/LF because every HPA-135 v1 editable target is one physical line;
8. `noChange: true` implies zero findings and no replacement;
9. `noChange: false` requires at least one finding;
10. malformed/unknown refs are a failed review, not a partially trusted result.

The model cannot select a file, line, hash, semantic target kind, or write payload.

## Human-controlled replacement handoff

Expose one action on a validated eligible replacement:

```text
Review replacement
```

It calls the existing HPA-135 orchestration with the existing `PendingFocusedEditSelection` and the AI's replacement string as the initial replacement:

```ts
beginFocusedEditReview(selection, replacementText)
```

From that point HPA-136 is out of the mutation path. HPA-135 resolves the current source, proves compiled/source identity, creates `nextContent`, renders the exact diff, derives impact, checks the expected hash, waits for explicit Apply, writes one line, and runs `bun run scenes:compile`.

There is **no** `apply_ai_review`, `apply_ai_replacement`, or provider-accessible write command.

## Provider choice: OpenAI Responses API

Use one provider only: OpenAI Responses API.

Default model: `gpt-5.6-luna`, chosen as the current cost-sensitive GPT-5.6 model for this hobby-project MVP. Allow a local environment override through `LYRA_OPENAI_MODEL`; do not expose a UI model selector.

Local developer configuration:

```text
OPENAI_API_KEY=<local secret>
LYRA_OPENAI_MODEL=gpt-5.6-luna   # optional; this is the default
```

The Tauri/Rust backend owns the API key. The browser/Svelte layer never receives it.

Provider request:

```text
POST https://api.openai.com/v1/responses
Authorization: Bearer $OPENAI_API_KEY
Content-Type: application/json
```

Use:

- `store: false`;
- no `conversation` / `previous_response_id`;
- no tools;
- no background mode;
- no streaming;
- bounded `max_output_tokens` (target 1800);
- low text verbosity;
- Responses API `text.format` with `type: "json_schema"`, `strict: true`, and the HPA-136 result schema.

Official references checked for this design on 2026-09-07:

- `https://developers.openai.com/api/docs/guides/structured-outputs`
- `https://platform.openai.com/docs/models`

Structured Outputs is used because the official guide supports strict `text.format` JSON Schema output on Responses API. There is no function calling because HPA-136 expects structured review data, not model-driven app actions.

## Backend provider seam

Create a focused Rust module instead of growing `lib.rs` further:

```text
apps/layout-editor/src-tauri/src/ai_review.rs
```

Responsibilities:

- deserialize the bounded provider request;
- read `OPENAI_API_KEY` and optional model override;
- build the Responses API JSON body;
- execute exactly one HTTPS request with a fixed timeout (target 60 seconds);
- extract `output_text` from the response;
- return the JSON text/value to the frontend;
- normalize provider/config/response failures.

`lib.rs` only wires `mod ai_review`, the `run_ai_review` Tauri command, and the invoke handler. Make only the minimum `pub(crate)` visibility changes required to reuse `EditorError`.

Add `reqwest` with rustls + JSON and no default TLS features. Do not add an OpenAI SDK abstraction or generic provider trait hierarchy in Rust.

Normalized error codes:

```text
aiProviderConfigMissing
aiProviderRequestFailed
aiProviderInvalidResponse
```

Provider response schema validation still happens in TypeScript because that is the domain contract used by the UI and fake-provider tests; Rust owns transport/envelope sanity only.

## Test seam

UI/domain code consumes one narrow injectable function:

```ts
export type AiReviewProvider = (
  request: AiReviewProviderRequest,
) => Promise<unknown>;
```

Production implementation calls the Tauri `run_ai_review` command. Tests inject a fake provider.

No ordinary test or build may issue network traffic.

Rust tests cover pure request-envelope generation and response-output extraction without hitting OpenAI. Component/App tests cover provider success/failure/cancel through the fake.

## Real Chapter 1 acceptance slice

Use real Chapter 1 authored content for a deterministic manual verification:

1. Reader: select a normal numeric scene/dialogue line; run Dialogue review with its exact character section and parent Beat context visible.
2. Reader: run Story consistency and verify Story Bible/Aoba context is explicit and removable where available.
3. Plan: select the Story Bible Aoba/reveal heading and run findings-only Story consistency.
4. Assets: select a scene-owned Chapter 1 background/evidence prompt; verify global/type/subject/entry layers and usage impact are visible; run Prompt refinement.
5. If the result has a valid replacement, hand it into HPA-135 and stop before Apply unless intentionally doing the documented throwaway smoke.

Real-provider smoke is opt-in and manual because it spends API quota and needs `OPENAI_API_KEY`. CI never runs it.

## Error behavior

- Missing API key: panel stays usable and shows local configuration error after explicit Run.
- Missing deterministic context: visible before Run; review may proceed with remaining context and the missing list is sent to the model.
- Provider HTTP/timeout/refusal/error: failed review, no replacement handoff.
- Structured JSON parse/schema/reference validation failure: failed review, no findings are treated as trusted and no handoff is available.
- User Cancel: generation changes; late provider completion is discarded.
- Selection/lens changes while a request is in flight: old generation is stale and cannot overwrite the new panel state.
- HPA-135 source becomes stale after the review: existing HPA-135 stale handling wins; AI review does not relocate text or retry writes.

## File structure

Create:

- `apps/layout-editor/src/lib/ai-review.ts` — result/request types, JSON Schema constant, handwritten validation.
- `apps/layout-editor/src/lib/ai-review.test.ts` — schema/reference/replacement/no-change validation.
- `apps/layout-editor/src/lib/ai-review-context.ts` — deterministic selection/context construction and section extraction.
- `apps/layout-editor/src/lib/ai-review-context.test.ts` — exact/missing context cases.
- `apps/layout-editor/src/lib/AiReviewPanel.svelte` — chips, lenses, run/cancel/result UI.
- `apps/layout-editor/src/lib/AiReviewPanel.test.ts` — fake-provider component behavior.
- `apps/layout-editor/src-tauri/src/ai_review.rs` — OpenAI transport/envelope.

Modify:

- `apps/layout-editor/src/lib/focused-edit.ts` — export reusable pending selection type.
- `apps/layout-editor/src/lib/workbench-types.ts` — fixed story-review reference payload and Plan heading range additions as needed.
- `apps/layout-editor/src/lib/plan-workspace.ts` + tests — exact source ranges/section helper.
- `apps/layout-editor/src/lib/workbench-api.ts` — fixed reference loader + `runAiReview` invoke.
- `apps/layout-editor/src/lib/ReaderView.svelte` + tests — contextual Review affordances.
- `apps/layout-editor/src/lib/AssetsView.svelte` + tests — prompt Review affordances, including findings-only portrait review.
- `apps/layout-editor/src/lib/PlanView.svelte` + tests — selected-section Story consistency affordance.
- `apps/layout-editor/src/App.svelte` + `App.test.ts` — one active AI selection/panel, context orchestration, HPA-135 handoff.
- `apps/layout-editor/src-tauri/src/lib.rs` + tests — fixed review-reference read command and AI command registration.
- `apps/layout-editor/src-tauri/Cargo.toml` / `Cargo.lock` — `reqwest`.

No production game runtime file or authored story file needs to change for HPA-136.

## Acceptance criteria

HPA-136 is complete when:

- an author can explicitly run Story consistency, Dialogue review, and Prompt refinement from relevant real Chapter 1 Workbench selections;
- exact outgoing context is visible as required/removable items with provenance and approximate size before Run;
- deterministic missing context is visible rather than guessed;
- Story consistency can include the existing Story Bible/Aoba reveal boundary without full-corpus retrieval;
- Dialogue review can include the exact `characters.md` voice section;
- Prompt refinement shows compiler-owned prompt layers and usage impact;
- AI output is strict-schema structured and locally reference-validated;
- malformed/ungrounded output cannot expose replacement handoff;
- at most one eligible replacement enters the existing HPA-135 review flow;
- character/portrait/shared prompt review does not create YAML writes in this ticket;
- source mutation still requires HPA-135's explicit human Apply, hash/source checks, and `scenes:compile` validation;
- one OpenAI provider path works from local developer environment configuration;
- automated tests stay fully offline;
- no RAG/vector DB/chat loop/provider framework/persistent review store/background agent is added;
- all work lands in this single HPA-136 PR.
