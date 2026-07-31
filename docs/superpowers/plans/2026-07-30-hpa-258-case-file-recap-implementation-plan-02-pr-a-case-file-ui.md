# HPA-258 PR A Case File Model and UI — Implementation Tasks 4–6

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Follow the parent plan `2026-07-30-hpa-258-case-file-recap-implementation-plan.md`, execute these tasks in order, verify each red test fails for the intended reason, and commit only after the focused green commands pass.

## Task 4: Define the frontend Case File contract and pure model

**Files:**
- Modify: `apps/game/src/lib/state/types.ts`
- Modify: `apps/game/src/lib/state/test-fixtures.ts`
- Create: `apps/game/src/lib/case-file/types.ts`
- Create: `apps/game/src/lib/case-file/labels.ts`
- Create: `apps/game/src/lib/case-file/case-file-model.ts`
- Create: `apps/game/src/lib/case-file/case-file-model.test.ts`

**Interfaces:**
- Consumes: Rust wire fields from Tasks 2–3.
- Produces: normalized `CaseFileModel`, section counts, relation lookup, objective grouping, and visibility helpers for Tasks 5–8.

- [ ] **Step 1: Mirror the Rust wire exactly**

Add `SceneLocationContextView`, `SourceGroupReferenceView`, and `OriginContextView`; narrow `supersedesRecordId` to `EncodedInventoryTarget | null`; add `acquisitionContext`/`sourceGroup` to record types and `originContext` to facts/authorizations. Update neutral test fixture factories to require a deterministic acquisition context.

- [ ] **Step 2: Write failing normalization tests**

Use evidence and statement records sharing slug `shared`, plus a cross-kind acquired chain:

```ts
expect(recordKey({ kind: "evidence", id: "shared" })).toBe("evidence:shared");
expect(recordKey({ kind: "statement", id: "shared" })).toBe("statement:shared");
expect(parseEncodedRecordTarget("statement:shared")).toEqual({
  kind: "statement",
  id: "shared",
});
expect(parseEncodedRecordTarget("fact:shared")).toBeNull();
```

- [ ] **Step 3: Write failing model tests**

Cover:

- active primary only from `activePrimary && !completed`;
- incomplete secondaries in authored order;
- completed objectives sorted `sortOrder` descending then ID, split 3/remainder;
- open questions before resolved;
- section counts from visible arrays only;
- `supportingRecords` and `supportingFactIds` normalized to keys;
- acquired successor reverse map from redacted predecessor strings;
- same-slug cross-kind collision resistance;
- cross-kind successor navigation;
- malformed/dangling edge omitted without raw-ID output;
- all-neutral provenance returns false from `hasVisibleProvenance`.

- [ ] **Step 4: Run red**

```bash
rtk bun run --cwd apps/game test src/lib/case-file/case-file-model.test.ts
```

Expected: module/type failures.

- [ ] **Step 5: Implement the pure model**

Use explicit functions:

```ts
export function buildCaseFileModel(state: GameStateView): CaseFileModel;
export function recordKey(target: InventoryTarget): CaseFileKey;
export function factKey(id: string): CaseFileKey;
export function parseEncodedRecordTarget(value: string): InventoryTarget | null;
export function hasVisibleProvenance(
  record: EvidenceRecord | StatementRecord,
  acquiredSuccessor: InventoryTarget | null,
): boolean;
```

Never use a bare record slug as a map key. Build successor edges only after confirming both predecessor and successor keys exist in the acquired lookup.

- [ ] **Step 6: Green and type-check**

```bash
rtk bun run --cwd apps/game test src/lib/case-file/case-file-model.test.ts
rtk bun run check
```

- [ ] **Step 7: Commit**

```bash
rtk git add \
  apps/game/src/lib/state/types.ts \
  apps/game/src/lib/state/test-fixtures.ts \
  apps/game/src/lib/case-file
rtk git commit -m "feat: model spoiler safe case file"
```

---

## Task 5: Build the accessible six-section Case File shell

**Files:**
- Create: `apps/game/src/lib/components/case-file/CaseFilePanel.svelte`
- Create: `apps/game/src/lib/components/case-file/CaseFileSectionNav.svelte`
- Create: `apps/game/src/lib/components/case-file/CaseFileItemList.svelte`
- Create: `apps/game/src/lib/components/case-file/CaseFileObjectiveSection.svelte`
- Create: `apps/game/src/lib/components/case-file/CaseFileFactDetail.svelte`
- Create: `apps/game/src/lib/components/case-file/CaseFileQuestionDetail.svelte`
- Create: `apps/game/src/lib/components/case-file/CaseFileAuthorizationDetail.svelte`
- Create: `apps/game/src/lib/components/case-file/CaseFilePanel.test.ts`
- Create: `apps/game/src/lib/test-harnesses/CaseFilePanelHarness.svelte`

**Interfaces:**
- Consumes: `CaseFileModel`, `CaseFileSection`, `CaseFileKey` from Task 4.
- Produces: bindable `section`, section/selection navigation, and relation callback used by record details in Task 6.

- [ ] **Step 1: Write failing section and accessibility tests**

Assert six visible Traditional Chinese section labels, visible-only counts, active tab state, Up/Down roving focus, Enter activation, default focus marker, neutral empty states, and no catalog-total wording.

Use this focus contract:

```html
<button
  role="tab"
  aria-selected="true"
  data-submenu-initial-focus
>
  目前目標
</button>
```

- [ ] **Step 2: Write failing selection/relation tests**

Assert selecting an item updates the detail heading without moving list focus; following a support link selects the destination and focuses its heading after `tick`; `返回上一項` restores the prior section/key; stale targets fall back to section heading/first row without displaying the raw key.

- [ ] **Step 3: Run red**

```bash
rtk bun run --cwd apps/game test src/lib/components/case-file/CaseFilePanel.test.ts
```

- [ ] **Step 4: Implement the shell**

`CaseFilePanel` props:

```ts
let {
  state,
  section = $bindable<CaseFileSection>("objective"),
  reexamineEnabled,
  onReexamineEvidence,
  onReexamineStatement,
  disabled = false,
}: {
  state: GameStateView;
  section?: CaseFileSection;
  reexamineEnabled: boolean;
  onReexamineEvidence: (id: string) => void;
  onReexamineStatement: (id: string) => void;
  disabled?: boolean;
} = $props();
```

Keep `selectedKey` and one-level `backTarget` local. Revalidate selection whenever the model changes.

- [ ] **Step 5: Implement non-record sections**

Objective detail shows active primary, incomplete secondaries, three recent completed, and a disclosure button for earlier completed. Facts show exact origin context plus direct acquired record/fact support links. Questions show open/resolved and link only to a visible resolving fact. Authorizations show grantor, permitted scope (`summary`), and origin context. Migration origin renders `已匯入的進度`.

- [ ] **Step 6: Green**

```bash
rtk bun run --cwd apps/game test src/lib/components/case-file/CaseFilePanel.test.ts
rtk bun run check
```

- [ ] **Step 7: Commit**

```bash
rtk git add \
  apps/game/src/lib/components/case-file \
  apps/game/src/lib/test-harnesses/CaseFilePanelHarness.svelte
rtk git commit -m "feat: add case file navigation"
```

---

## Task 6: Render record details, provenance, images, and acquired-only history

**Files:**
- Create: `apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte`
- Create: `apps/game/src/lib/components/case-file/CaseFileRecordDetail.test.ts`
- Modify: `apps/game/src/lib/components/case-file/CaseFilePanel.svelte`
- Modify: `apps/game/src/lib/components/case-file/CaseFileItemList.svelte`
- Reuse: `apps/game/src/lib/assets/story-assets.ts`

**Interfaces:**
- Consumes: selected evidence/statement, acquisition context, source group, acquired predecessor/successor from Task 4.
- Produces: inspectable record details and explicit re-examination action.

- [ ] **Step 1: Write failing neutral/annotated tests**

Assert:

- neutral legacy record shows the established name/description/details and acquisition titles but no provenance headings/chips;
- annotated record shows only non-neutral fields;
- proof capability labels use a fixed Traditional Chinese map;
- source display prefers `sourceLabel`, then group label;
- group summary does not expose members;
- a superseded acquired record remains enabled and marked `已被後續紀錄取代`;
- no hidden predecessor/successor placeholder appears.

- [ ] **Step 2: Write failing image/re-examination tests**

Port the current placeholder behavior from `InventoryPanel`: async resolution, missing-asset placeholder, no repeated warning for a placeholder, and cleanup on record change. Assert the detail row itself is always inspectable while a separate `重新檢視` button is enabled only when `reexamineEnabled && !disabled`.

- [ ] **Step 3: Run red**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/case-file/CaseFileRecordDetail.test.ts \
  src/lib/components/case-file/CaseFilePanel.test.ts
```

- [ ] **Step 4: Implement exact label maps**

Add in `labels.ts` complete maps for source kind, representation layer, procedural status, completeness, confidence, and all ten proof capabilities. Return null for neutral enum values rather than a visible “未指定”.

- [ ] **Step 5: Implement acquired-only lineage controls**

Render previous/next only when the model resolves the acquired target. Call the panel relation callback with normalized keys. Never parse or display a target that is absent from the acquired lookup.

- [ ] **Step 6: Green**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/case-file/CaseFileRecordDetail.test.ts \
  src/lib/components/case-file/CaseFilePanel.test.ts
rtk bun run check
```

- [ ] **Step 7: Commit**

```bash
rtk git add \
  apps/game/src/lib/components/case-file \
  apps/game/src/lib/case-file/labels.ts
rtk git commit -m "feat: render case record details"
```

---
