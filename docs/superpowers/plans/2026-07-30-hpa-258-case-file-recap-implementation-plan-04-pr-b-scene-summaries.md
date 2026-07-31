# HPA-258 PR B Authored Scene Summaries — Implementation Tasks 10–12

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Follow the parent plan `2026-07-30-hpa-258-case-file-recap-implementation-plan.md`, execute these tasks in order, verify each red test fails for the intended reason, and commit only after the focused green commands pass.

## Task 10: Parse one tokenizer-compatible scene header in every scene parser

**Files:**
- Create: `packages/scripts/compile-scenes/parser-scene-header.ts`
- Create: `packages/scripts/compile-scenes/parser-scene-header.test.ts`
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/parser-linear.ts`
- Modify: `packages/scripts/compile-scenes/parser-linear.test.ts`
- Modify: `packages/scripts/compile-scenes/parser-investigation.ts`
- Modify: `packages/scripts/compile-scenes/parser-investigation.test.ts`
- Modify: `packages/scripts/compile-scenes/parser-interrogation.ts`
- Modify: `packages/scripts/compile-scenes/parser-interrogation.test.ts`

**Interfaces:**
- Consumes: existing `Token[]` from `tokenizer.ts`.
- Produces: `ParsedSceneHeader` and AST `summary`/`summaryAuthored` for Task 11.

- [ ] **Step 1: Write failing grammar tests**

Cover valid:

```markdown
# Scene 7: 雨水留下的時間

- **Summary:** 相馬重新回到雨鐘後場，開始懷疑摘要時間不是事件時間。
```

Cover dedicated failures:

- dash-less `**Summary:** ...` → `sceneSummaryMalformedSyntax`;
- `- **Summary:**` → `sceneSummaryBlank`;
- second Summary → `sceneSummaryDuplicate` at the second line;
- Summary after dialogue/scene tag/H2 → `sceneSummaryMisplaced`;
- malformed H1 → each parser’s established missing-title diagnostic.

- [ ] **Step 2: Write the linear carve-out regression**

Assert the immediate Summary is accepted, while `- **Unexpected:** value` after H1 still produces `linearSceneHasMetadata` and scene-tag-local Background/BGM/BGS metadata remains accepted.

- [ ] **Step 3: Run red**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-scene-header.test.ts \
  packages/scripts/compile-scenes/parser-linear.test.ts \
  packages/scripts/compile-scenes/parser-investigation.test.ts \
  packages/scripts/compile-scenes/parser-interrogation.test.ts
```

- [ ] **Step 4: Implement the shared header helper**

Keep the tokenizer’s ordinary metadata grammar unchanged. Recognize blank/dash-less Summary through narrow unknown-token checks inside `parseSceneHeader`. Consume only one immediate `metadata` token with key `Summary`; scan remaining tokens for duplicate/misplaced Summary syntax before returning.

If absent, use the exact deterministic fallback:

```ts
summary: title,
summaryAuthored: false,
```

- [ ] **Step 5: Start parser-specific loops at `nextTokenIndex`**

Linear starts its queue loop after the consumed header; investigation/interrogation initialize their cursors at the returned index. Remove duplicated title parsing from all three parsers.

- [ ] **Step 6: Green**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-scene-header.test.ts \
  packages/scripts/compile-scenes/parser-linear.test.ts \
  packages/scripts/compile-scenes/parser-investigation.test.ts \
  packages/scripts/compile-scenes/parser-interrogation.test.ts
rtk bun run check:scripts
```

- [ ] **Step 7: Commit**

```bash
rtk git add \
  packages/scripts/compile-scenes/parser-scene-header.ts \
  packages/scripts/compile-scenes/parser-scene-header.test.ts \
  packages/scripts/compile-scenes/types.ts \
  packages/scripts/compile-scenes/parser-linear.ts \
  packages/scripts/compile-scenes/parser-linear.test.ts \
  packages/scripts/compile-scenes/parser-investigation.ts \
  packages/scripts/compile-scenes/parser-investigation.test.ts \
  packages/scripts/compile-scenes/parser-interrogation.ts \
  packages/scripts/compile-scenes/parser-interrogation.test.ts
rtk git commit -m "feat: parse authored scene summaries"
```

---

## Task 11: Emit scene summaries and expose them through Rust/public views

**Files:**
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/emitter.ts`
- Modify: `packages/scripts/compile-scenes/emitter.test.ts`
- Modify: `packages/scripts/compile-scenes/save-content-manifest.test.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/view.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: Rust scene/schema tests and fixtures under `apps/game/src-tauri/tests/fixtures/`
- Modify: `apps/game/src/lib/state/types.ts`
- Modify: frontend fixtures/tests constructing `SceneView`

**Interfaces:**
- Consumes: AST summaries from Task 10.
- Produces: emitted `summary: string`, Rust scene summaries, and `SceneView.summary` for save capture/UI.

- [ ] **Step 1: Write failing emitter and hash tests**

Assert every emitted scene type contains `summary`, `summaryAuthored` is absent from JSON, and changing only summary changes `contentRevision`.

- [ ] **Step 2: Write failing Rust serde/view tests**

Deserialize one scene of each kind with Summary and assert `GameEngine::scene_view()` exposes exact copy. Missing `summary` in newly emitted/current fixtures must fail Rust serde; compatibility is handled at compiler fixture level, not runtime defaulting.

- [ ] **Step 3: Run red**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/emitter.test.ts \
  packages/scripts/compile-scenes/save-content-manifest.test.ts \
  packages/scripts/compile-scenes.test.ts
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml scene -- --nocapture
```

- [ ] **Step 4: Emit and mirror Summary**

Add `summary: ast.summary` beside each scene title in the three emitters and JSON types. Add required `summary: String` to the three Rust scene structs and all `SceneView` variants. Update scene identity/view builders without adding Summary to `@lyra/scene-types`.

- [ ] **Step 5: Update fixtures and snapshots mechanically**

Regenerate compiler snapshots through tests; update Rust JSON fixture scenes with deterministic summaries. Do not edit generated production resource JSON.

- [ ] **Step 6: Green**

```bash
rtk bun run test:scripts
rtk bun run check:scripts
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml scene -- --nocapture
rtk bun run check
```

- [ ] **Step 7: Commit**

```bash
rtk git add \
  packages/scripts/compile-scenes \
  packages/scripts/__snapshots__ \
  apps/game/src-tauri/src/game/schema.rs \
  apps/game/src-tauri/src/game/view.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/tests/fixtures \
  apps/game/src/lib/state/types.ts \
  apps/game/src/lib
rtk git commit -m "feat: emit scene recap summaries"
```

---

## Task 12: Backfill Chapter 1 summaries and document the authoring contract

**Files:**
- Modify the 16 manifested files under `docs/stories_plan/chapter_1/`:
  - `scene_p0.md`
  - `scene_p1.md`
  - `scene_p2.md`
  - `scene_0.md`
  - `investigation_scene_1.md`
  - `scene_2.md`
  - `investigation_scene_3.md`
  - `interrogation_scene_4.md`
  - `scene_5.md`
  - `scene_6.md`
  - `investigation_scene_7.md`
  - `investigation_scene_8.md`
  - `scene_8_5.md`
  - `investigation_scene_9.md`
  - `interrogation_scene_10.md`
  - `scene_11.md`
- Modify: `.claude/skills/writing-detective-game-dialogue/SKILL.md`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`
- Modify: `CLAUDE.md`
- Modify: `packages/scene-types/src/index.ts` comments
- Modify: `packages/scripts/compile-scenes.test.ts`

**Interfaces:**
- Consumes: scene Summary grammar from Task 10.
- Produces: production-authored summaries and no-fallback audit.

- [ ] **Step 1: Add the production audit test first**

Compile the manifested Chapter 1 AST and assert every scene has `summaryAuthored === true`. The test must report filenames missing authored copy.

- [ ] **Step 2: Run red**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes.test.ts
```

Expected: failure listing all 16 files.

- [ ] **Step 3: Add exact summaries immediately after each H1**

Use these approved lines:

| File | Authored Summary |
| --- | --- |
| `scene_p0.md` | `- **Summary:** 東京雨夜裡，KAGAMI 證據摘要試點悄悄成為城市日常，而沒有人注意資訊如何先替案件排好故事。` |
| `scene_p1.md` | `- **Summary:** 相馬以一張重印收據拆開「記錄時間」與「事件時間」，並與堅持保留紙本痕跡的早坂建立最初搭檔節奏。` |
| `scene_p2.md` | `- **Summary:** 命案發生前的雨鐘咖啡館仍只是普通工作場所，三宅、增田、舊掛鐘與閉店流程留下日後會被重新閱讀的日常痕跡。` |
| `scene_0.md` | `- **Summary:** KAGAMI 將門鎖、鏡頭與打卡紀錄整理成三宅犯案的乾淨結論，而畫面外已有一個家庭被摘要壓住。` |
| `investigation_scene_1.md` | `- **Summary:** 相馬在自己的事務所接下三宅案，先相信三條互相吻合的摘要紀錄，再被早坂要求親自走過現場。` |
| `scene_2.md` | `- **Summary:** 三宅母親正式委託相馬與早坂，兩人取得審查會入口，也明白今天真正要保住的是重新檢視證據的權利。` |
| `investigation_scene_3.md` | `- **Summary:** 相馬第一次調查雨鐘咖啡館，記下閉店流程、L 型後場、第二杯咖啡與被降權的外包動線，卻仍看見所有表面紀錄指向三宅。` |
| `interrogation_scene_4.md` | `- **Summary:** 相馬拆開三宅對母親電話與蛋糕盒的小謊，確認他的隱瞞不能證明殺人，但也還不足以推翻摘要。` |
| `scene_5.md` | `- **Summary:** 第一輪證據摘要審查會中，三宅的員工憑證、監視器與打卡紀錄壓過模糊第三者線索，相馬第一次敗給「最好對得上的故事」。` |
| `scene_6.md` | `- **Summary:** 相馬與早坂在商店街避雨，把人證、現場物件與系統摘要重新分開，決定回到雨鐘親自重走現場。` |
| `investigation_scene_7.md` | `- **Summary:** 雨宮的匿名訊息迫使相馬重看雨水痕跡、手機通知與舊掛鐘，並透過兩次走位確認三宅當時根本看不見屍體。` |
| `investigation_scene_8.md` | `- **Summary:** 店長截圖只作線索入口；經鑑識固定後的本機順序證明外包憑證早於三宅事件，但仍只足以建立第三者。` |
| `scene_8_5.md` | `- **Summary:** 相馬與早坂停下來整理已證明的命題：三宅不該被放在摘要時間裡，但真正更早進入後場的人仍待確認。` |
| `investigation_scene_9.md` | `- **Summary:** 外包維護工單、增田的低調備忘與資料盜賣壓力把更早進入後場的第三者收束到北見修一。` |
| `interrogation_scene_10.md` | `- **Summary:** 最終審查會拆開本機順序與伺服器合併時間，證明門鎖沒有說謊，錯的是摘要替真實紀錄補上的意思。` |
| `scene_11.md` | `- **Summary:** 三宅獲釋後以過甜的金木犀拿鐵向相馬道謝；夜裡，無法解開的 ZW_A16.lock 與無主藍傘留下更大的案件陰影。` |

- [ ] **Step 4: Update authoring guidance**

Every scene skill template must show `- **Summary:**` directly after H1 and state that it is one-sentence player recap copy, not a beat list. Clarify in `CLAUDE.md` and `@lyra/scene-types` comments that the package owns compiler/editor byte-identical shared subsets, not full runtime scene JSON.

- [ ] **Step 5: Green and compile production scenes**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes.test.ts
rtk bun run scenes:compile
rtk bun run check:scripts
```

Verify generated resources remain ignored/untracked:

```bash
rtk git status --short apps/game/src-tauri/resources
```

Expected: no tracked generated JSON changes.

- [ ] **Step 6: Commit**

```bash
rtk git add \
  docs/stories_plan/chapter_1 \
  .claude/skills/writing-detective-game-dialogue/SKILL.md \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md \
  CLAUDE.md \
  packages/scene-types/src/index.ts \
  packages/scripts/compile-scenes.test.ts
rtk git commit -m "content: author chapter one scene recaps"
```

---
