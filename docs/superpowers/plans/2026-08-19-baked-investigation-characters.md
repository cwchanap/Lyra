# Baked Investigation Characters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every placed Chapter 1 investigation standee with a perspective-correct character baked into the background while preserving independent interaction regions and durable character identities.

**Architecture:** Extend the shared character-layout wire contract with an additive `kind: "baked"` geometry-only variant. The compiler, Rust schema, runtime, and layout editor preserve the existing sprite path but skip sprite asset resolution and rendering for baked layouts. Seven regenerated backgrounds own the character pixels, while eight layout rectangles continue to own interaction.

**Tech Stack:** TypeScript, Svelte 5, Vitest, Rust/Serde, Tauri, JSON sidecars, YAML asset catalogs, built-in OpenAI image generation, Pillow-based image normalization.

**Spec:** `docs/superpowers/specs/2026-08-19-baked-investigation-characters-design.md`

## Global Constraints

- Existing `kind: "sprite"` layouts must compile, emit, render, and edit unchanged.
- A baked layout contains exactly `kind`, `x`, `y`, `w`, and `h`; it has no `assetId` or `anchor` semantics.
- Layout sidecars remain `version: 1`.
- All eight in-scope character placements become independently clickable baked regions.
- All seven touched backgrounds remain opaque PNG files at exactly 1920×1080 and retain their existing semantic asset IDs and paths.
- The regenerated 神谷澪 portrait remains RGBA at exactly 768×1024.
- Generated images must preserve evidence props, hotspot landmarks, room geometry, lighting direction, and repeated-character outfit identity.
- The corrected 北見修一 standee keeps thin metal-frame glasses and the canonical office-worker outfit.
- Generated scene JSON under `apps/game/src-tauri/resources/**` is never hand-edited or committed.
- Use the built-in image-generation tool; do not switch to the CLI/API fallback without explicit user approval.

---

### Task 1: Shared Layout Contract and Compiler Parser

**Files:**
- Modify: `packages/scene-types/src/index.ts`
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/layout.ts`
- Test: `packages/scripts/compile-scenes/layout.test.ts`

**Interfaces:**
- Produces: `BakedCharacterLayout`, `CharacterLayout = SpriteLayout | BakedCharacterLayout`
- Produces: `parseCharacterLayout(rawLayout, sourceFile, targetPath)` accepting `sprite` and `baked`
- Preserves: `SpriteLayout` and `RectLayout`

- [ ] **Step 1: Write failing parser and application tests**

Add a `validBakedLayoutJson()` fixture and assertions equivalent to:

```ts
function validBakedLayoutJson() {
  return JSON.stringify({
    version: 1,
    sceneId: "investigation_scene_1",
    sublocations: {
      main_hall: {
        hotspots: {},
        characters: {
          witness: { kind: "baked", x: 0.42, y: 0.18, w: 0.2, h: 0.7 },
        },
      },
    },
  });
}

it("parses a baked character interaction region", () => {
  const result = parseInvestigationLayoutJson(
    validBakedLayoutJson(),
    sourceFile,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sublocations.main_hall?.characters.witness).toEqual({
    kind: "baked",
    x: 0.42,
    y: 0.18,
    w: 0.2,
    h: 0.7,
  });
});

it("rejects invalid baked character geometry", () => {
  const result = parseInvestigationLayoutJson(
    validBakedLayoutJson().replace('"w":0.2', '"w":0'),
    sourceFile,
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.errors.map((entry) => entry.code)).toContain("layoutInvalidSize");
});
```

Also apply the parsed baked sidecar to `minimalScene()` and assert the AST
character retains the exact five-field baked layout.

- [ ] **Step 2: Run the focused parser tests and observe RED**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/layout.test.ts
```

Expected: TypeScript/test failure because `kind: "baked"` is not part of the
shared character layout and the parser still requires `kind: "sprite"`.

- [ ] **Step 3: Add the shared tagged union**

In `packages/scene-types/src/index.ts`, add:

```ts
export type BakedCharacterLayout = {
  kind: "baked";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CharacterLayout = SpriteLayout | BakedCharacterLayout;
```

Change `InvestigationLayoutSidecar.sublocations[*].characters` to
`Record<string, CharacterLayout>`.

In `packages/scripts/compile-scenes/types.ts`, import and re-export
`BakedCharacterLayout` and `CharacterLayout`, then change AST character layout
and `JSONCharacterLayout` from `SpriteLayout` to `CharacterLayout`.

- [ ] **Step 4: Implement discriminated character parsing**

In `layout.ts`, replace the unconditional `parseSpriteLayout` call with:

```ts
function parseCharacterLayout(
  rawLayout: unknown,
  sourceFile: string,
  targetPath: string,
): { value: CharacterLayout | null; errors: CompileError[] } {
  const layout = asRecord(rawLayout);
  if (layout?.kind === "sprite") {
    return parseSpriteLayout(rawLayout, sourceFile, targetPath);
  }
  if (layout?.kind === "baked") {
    return parseBakedCharacterLayout(layout, sourceFile, targetPath);
  }
  return {
    value: null,
    errors: [
      error(
        sourceFile,
        "layoutInvalidCharacterKind",
        `${targetPath} character layout kind must be "sprite" or "baked".`,
      ),
    ],
  };
}
```

`parseBakedCharacterLayout` must construct `{ kind: "baked", x, y, w, h }`,
reuse `validateRectNumbers` and `validateGeometry`, and never synthesize an
asset ID or anchor.

- [ ] **Step 5: Run focused tests and script type-check**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/layout.test.ts
bun run check:scripts
```

Expected: both commands pass.

- [ ] **Step 6: Commit the shared parser slice**

```bash
git add packages/scene-types/src/index.ts packages/scripts/compile-scenes/types.ts packages/scripts/compile-scenes/layout.ts packages/scripts/compile-scenes/layout.test.ts
git commit -m "feat: add baked character layout contract"
```

---

### Task 2: Compiler Emission and Asset-Enrichment Regression Coverage

**Files:**
- Test: `packages/scripts/compile-scenes/assets/enrich.test.ts`
- Test: `packages/scripts/compile-scenes/emitter.test.ts`

**Interfaces:**
- Consumes: `CharacterLayout` from Task 1
- Produces: emitted `{ kind: "baked", x, y, w, h }` JSON
- Guarantees: baked layouts add no asset reference or manifest request

- [ ] **Step 1: Write failing emitter and enrichment tests**

Add an emitter case with this AST layout:

```ts
layout: {
  kind: "baked",
  x: 0.38,
  y: 0.2,
  w: 0.22,
  h: 0.68,
},
```

Assert the emitted character layout equals the same object.

Add an enrichment test using a baked character and assert:

```ts
expect(result.errors).toEqual([]);
expect(ast.assetRefs).not.toContainEqual(
  expect.objectContaining({ type: "standee" }),
);
expect(result.manifest.entries.map((entry) => entry.assetId)).not.toContain(
  "standee.hayasaka_akane.standard",
);
```

- [ ] **Step 2: Run focused compiler tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts
```

Expected: both new regression cases pass. The emitter already preserves layout
objects and `enrichCharacterSpriteLayout` already guards on `kind === "sprite"`;
if either case fails, fix only the failed boundary before continuing.

- [ ] **Step 3: Verify the existing enrichment boundary remains minimal**

Confirm the asset boundary still contains this single guard:

```ts
function enrichCharacterSpriteLayout(
  character: ASTCharacter,
  context: EnrichContext,
): void {
  if (character.layout?.kind !== "sprite") return;
  const assetId = character.layout.assetId;
  // Existing sprite enrichment remains unchanged below this point.
}
```

Do not add a baked asset type, placeholder request, or unrelated production
change when the regression tests already pass.

- [ ] **Step 4: Run focused tests and script type-check**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts
bun run check:scripts
```

Expected: both commands pass.

- [ ] **Step 5: Commit compiler pipeline support**

```bash
git add packages/scripts/compile-scenes/assets/enrich.test.ts packages/scripts/compile-scenes/emitter.test.ts
git commit -m "test: cover baked character scene emission"
```

---

### Task 3: Rust Scene Schema

**Files:**
- Modify/Test: `apps/game/src-tauri/src/game/schema.rs`

**Interfaces:**
- Consumes: compiler JSON `{ kind: "baked", x, y, w, h }`
- Produces: `CharacterLayoutJson::Baked { x, y, w, h }`

- [ ] **Step 1: Write the failing Serde test**

Extend the existing character-layout test with a direct enum deserialization:

```rust
let parsed: CharacterLayoutJson = serde_json::from_value(json!({
    "kind": "baked",
    "x": 0.42,
    "y": 0.18,
    "w": 0.2,
    "h": 0.7
})).unwrap();

assert!(matches!(
    parsed,
    CharacterLayoutJson::Baked { .. }
));
```

- [ ] **Step 2: Run the Rust test and observe RED**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml deserializes_character_layout -- --nocapture
```

Expected: unknown variant `baked`.

- [ ] **Step 3: Add the Rust enum variant**

```rust
pub enum CharacterLayoutJson {
    Sprite {
        asset_id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        anchor: CharacterLayoutAnchorJson,
    },
    Baked {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
}
```

- [ ] **Step 4: Run focused Rust tests**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml deserializes_character_layout -- --nocapture
```

Expected: pass for both sprite and baked fixtures.

- [ ] **Step 5: Commit Rust support**

```bash
git add apps/game/src-tauri/src/game/schema.rs
git commit -m "feat: deserialize baked character layouts"
```

---

### Task 4: Runtime Interaction Without Sprite Rendering

**Files:**
- Modify: `apps/game/src/lib/state/types.ts`
- Modify: `apps/game/src/lib/components/InvestigationSceneSurface.svelte`
- Test: `apps/game/src/lib/components/InvestigationSceneSurface.test.ts`

**Interfaces:**
- Consumes: `CharacterLayout` tagged union
- Produces: identical semantic character button behavior for sprite and baked layouts
- Guarantees: only sprite layouts call `resolveStoryAsset`

- [ ] **Step 1: Write the failing baked-runtime test**

Create a sublocation fixture whose character layout is:

```ts
layout: { kind: "baked", x: 0.34, y: 0.2, w: 0.24, h: 0.68 },
```

Render the component, then assert:

```ts
const characterButton = screen.getByRole("button", { name: "詢問：早坂茜" });
expect(characterButton).toBeInTheDocument();
expect(characterButton.querySelector("img")).toBeNull();
expect(resolveStoryAsset).not.toHaveBeenCalledWith(
  expect.stringMatching(/^(portrait|standee)\./),
  expect.anything(),
);
await fireEvent.click(characterButton);
expect(screen.getByRole("dialog")).toBeInTheDocument();
```

Keep the existing background-resolution expectation separate because the
background must still load.

- [ ] **Step 2: Run the component test and observe RED**

```bash
bun run --cwd apps/game test src/lib/components/InvestigationSceneSurface.test.ts
```

Expected: TypeScript/runtime failure from reading `layout.assetId` on a baked
layout.

- [ ] **Step 3: Add the frontend union and narrow asset work**

In `state/types.ts` define:

```ts
export type CharacterLayout =
  | {
      kind: "sprite";
      assetId: string;
      x: number;
      y: number;
      w: number;
      h: number;
      anchor: "bottomCenter";
    }
  | {
      kind: "baked";
      x: number;
      y: number;
      w: number;
      h: number;
    };
```

In the component effect, resolve only characters satisfying
`character.layout.kind === "sprite"`. In the button, keep the highlight, name,
ARIA state, disabled state, and click handler for every layout, but wrap the
preview crop in:

```svelte
{#if character.layout.kind === "sprite"}
  <!-- existing sprite preview/loading branch -->
{/if}
```

Make `portraitAssetId`, crop loading, and portrait error handling accept only
the narrowed sprite-layout character type.

- [ ] **Step 4: Run focused runtime tests and app check**

```bash
bun run --cwd apps/game test src/lib/components/InvestigationSceneSurface.test.ts
bun run --cwd apps/game check
```

Expected: both commands pass and existing sprite tests remain green.

- [ ] **Step 5: Commit runtime support**

```bash
git add apps/game/src/lib/state/types.ts apps/game/src/lib/components/InvestigationSceneSurface.svelte apps/game/src/lib/components/InvestigationSceneSurface.test.ts
git commit -m "feat: keep baked investigation characters interactive"
```

---

### Task 5: Layout Editor Support

**Files:**
- Modify: `apps/layout-editor/src/lib/layout-types.ts`
- Modify: `apps/layout-editor/src/lib/layout-geometry.ts`
- Modify: `apps/layout-editor/src/lib/layout-store.svelte.ts`
- Modify: `apps/layout-editor/src/lib/EditorCanvas.svelte`
- Test: `apps/layout-editor/src/lib/layout-geometry.test.ts`
- Test: `apps/layout-editor/src/lib/layout-store.test.ts`
- Test: `apps/layout-editor/src/lib/EditorCanvas.test.ts`

**Interfaces:**
- Consumes: shared `CharacterLayout`
- Produces: `clampCharacterLayout(layout: CharacterLayout): CharacterLayout`
- Produces: move/resize/edit support that preserves the `baked` discriminator

- [ ] **Step 1: Write failing geometry and store tests**

Add tests equivalent to:

```ts
const baked = {
  kind: "baked" as const,
  x: 0.8,
  y: 0.75,
  w: 0.4,
  h: 0.5,
};

expect(clampCharacterLayout(baked)).toEqual({
  kind: "baked",
  x: 0.6,
  y: 0.5,
  w: 0.4,
  h: 0.5,
});
```

Call `setCharacterLayout` with a baked layout and assert the stored layout has
no `assetId` or `anchor` and retains `kind: "baked"`.

- [ ] **Step 2: Write the failing canvas test**

Render a scene with a baked character, then assert:

```ts
expect(screen.getByText("背景內建角色")).toBeInTheDocument();
expect(container.querySelector(".character-preview-crop img")).toBeNull();
```

Trigger one move or resize interaction using the existing pointer-event helper
and assert the final `onCharacterLayoutChange` call retains `kind: "baked"`.

- [ ] **Step 3: Run editor tests and observe RED**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-geometry.test.ts src/lib/layout-store.test.ts src/lib/EditorCanvas.test.ts
```

Expected: type/test failures because editor character paths require
`SpriteLayout`.

- [ ] **Step 4: Generalize editor types and geometry**

Re-export `BakedCharacterLayout` and `CharacterLayout` from `layout-types.ts`,
and change `InvestigationSceneJson.characters[*].layout` to
`CharacterLayout | null`.

Replace `clampSpriteLayout` at the store boundary with:

```ts
export function clampCharacterLayout(
  layout: CharacterLayout,
): CharacterLayout {
  const box = clampLayoutBox(layout);
  return layout.kind === "sprite"
    ? {
        kind: "sprite",
        assetId: layout.assetId,
        ...box,
        anchor: layout.anchor,
      }
    : { kind: "baked", ...box };
}
```

Update the move and resize generics, drag state, callback, commit path, and
normalizer to use `RectLayout | CharacterLayout`. `normalizeCharacterLayout`
must return baked layouts unchanged and only convert portrait IDs to standee
IDs for sprites.

- [ ] **Step 5: Render an editor-only baked marker**

In the character target, branch on the layout kind. Keep the existing image
preview for sprites; for baked layouts render:

```svelte
<span
  class="pointer-events-none absolute inset-0 grid place-items-center border border-dashed border-[#7d5e9f] bg-[#7d5e9f]/10 text-[0.68rem] font-bold text-[#563a76]"
>
  背景內建角色
</span>
```

Keep the character name label and all resize handles outside the branch.

- [ ] **Step 6: Run editor tests and check**

```bash
bun run --cwd apps/layout-editor test src/lib/layout-geometry.test.ts src/lib/layout-store.test.ts src/lib/EditorCanvas.test.ts
bun run --cwd apps/layout-editor check
```

Expected: both commands pass.

- [ ] **Step 7: Commit editor support**

```bash
git add apps/layout-editor/src/lib/layout-types.ts apps/layout-editor/src/lib/layout-geometry.ts apps/layout-editor/src/lib/layout-store.svelte.ts apps/layout-editor/src/lib/EditorCanvas.svelte apps/layout-editor/src/lib/layout-geometry.test.ts apps/layout-editor/src/lib/layout-store.test.ts apps/layout-editor/src/lib/EditorCanvas.test.ts
git commit -m "feat: edit baked character interaction regions"
```

---

### Task 6: Character Identity Documentation and Generation Prompts

**Files:**
- Modify: `docs/stories_plan/characters.md`
- Modify: `static/assets/config/characters.yaml`

**Interfaces:**
- Produces: one durable visual identity per portrait-mode character
- Produces: prompt-level constraints used by future portrait and standee generation

- [ ] **Step 1: Add the 13-character visual identity matrix**

Add a section to `characters.md` with these identity anchors:

| Character | Silhouette / posture | Outfit and palette | Signature detail | Must contrast with |
| --- | --- | --- | --- | --- |
| 相馬律 | slim, slightly forward, observant | rolled white sleeves, charcoal trousers, muted brown | worn leather case folder | 北見's withdrawn office-worker shape |
| 早坂茜 | sturdy, grounded, direct | practical navy jacket, casual off-white inner layer, warm brown leather | organized document shoulder bag, loose low tie | 神谷's rigid graphite prosecutor line |
| 三宅母親 | softly rounded, hands held close | modest moss and warm beige everyday layers | convenience-store rice-ball bag | 高瀨's apron-and-work stance |
| 書記官 | compact upright counter posture | plain black office suit, cool white shirt | thin glasses and dark ID lanyard | 神谷's high-status tailored silhouette |
| 店長高瀨 | work-worn, shoulders slightly lowered | faded rust apron, loose olive/brown clothes | cleaning cloth at one hand | 三宅母親's domestic softness |
| 片瀨美咲 | petite, quick, weight tipped toward exit | youthful café uniform, muted teal apron | colorful hair tie and tiny earrings | 高瀨's heavier tired silhouette |
| 三宅蒼太 | slim, hunched, guarded | plain café shirt, practical gray-green jacket | tired downcast eyes | 相馬's attentive forward posture |
| 神谷澪 | lean, angular, rigid vertical line | cool graphite longline/double-breasted suit, high-neck ivory blouse, silver accent | severe sculpted tied-back hair, no bag | 早坂's sturdy navy/casual/warm-leather identity |
| 黑瀨徹 | broad, weathered, planted | rumpled brown-gray field coat, worn dark shoes | large hands and flattened rice-ball wrapper | contractor supervisor's neat office silhouette |
| 北見修一 | medium soft build, shoulders drawn inward | forgettable beige/gray business-casual layers | slipping thin metal glasses, dark ID lanyard, creased card | 相馬's youthful rolled-sleeve silhouette |
| 承包商主管 | rectangular middle-management posture | pressed cool-gray shirt and conservative muted tie | neat side-part and clipboard | 黑瀨's rumpled field texture |
| 店主 | relaxed neighborhood-shop stance | indigo work overshirt, cream apron, warm paper tones | paper cutter or stack of copy paper | 高瀨's café apron and fatigue |
| 增田圭 | narrow discreet silhouette, guarded side angle | low-profile slate commuter coat over ordinary workwear | compact USB case or folded memo | 北見's glasses, lanyard, and softer build |

Refine the prose settings for 早坂 and 神谷 so they explicitly carry their
matrix identities without changing story role or personality.

- [ ] **Step 2: Strengthen every portrait-mode `visualPrompt`**

Update each of the 13 prompts in `characters.yaml` to include its matrix
silhouette, palette, outfit, and signature prop. Add explicit negative contrast
only where collision risk is high. For 神谷, encode:

```yaml
visualPrompt: >
  Japanese female prosecutor in her early thirties, lean angular build and
  sharper cheekbones, rigid vertical institutional posture, glossy black hair
  in a severe sculpted low chignon, cool graphite longline double-breasted suit
  with sharp lapels, high-neck ivory blouse and one restrained silver bar pin,
  no shoulder bag, no casual inner shirt, visually distinct from the sturdier
  warm-toned defense attorney Hayasaka.
```

Preserve every character ID, display name, portrait mode, expression key, and
expression meaning.

- [ ] **Step 3: Validate asset configuration through scene compilation**

```bash
bun run scenes:compile
```

Expected: 17 scenes compile, asset warnings remain zero, and only the known
unrelated singleton layout warning may remain.

- [ ] **Step 4: Commit identity guidance**

```bash
git add docs/stories_plan/characters.md static/assets/config/characters.yaml
git commit -m "docs: distinguish character visual identities"
```

---

### Task 7: Generate and Normalize Production Art

**Files:**
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_1/office.png`
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_3/front.png`
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_7/back_door.png`
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_8/office_corner.png`
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_8/fixed_panel.png`
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_9/confront_kitami.png`
- Modify: `static/assets/portraits/kamiya_mio/standard.png`
- Preserve modification: `static/assets/standees/kitami_shuichi/standard.png`
- Create audit artifacts: `tmp/image-audit/baked-investigation-contact-sheet.png`
- Create audit artifacts: `tmp/image-audit/baked-investigation-interaction-regions.png`

**Interfaces:**
- Consumes: existing backgrounds as edit targets and existing standees/portraits as identity references
- Produces: seven opaque 1920×1080 background plates and one RGBA 768×1024 Kamiya portrait

- [ ] **Step 1: Inspect every edit target and character reference**

Use `view_image` on the seven existing backgrounds, the five relevant standees,
the approved Scene 9 baked audit image, and the current Hayasaka/Kamiya
portraits. Record stable anchors and intended deltas in the execution notes:

- Scene 1: preserve desk, files, coffee machine, cans, paper stacks; add Hayasaka without covering hotspots.
- Scene 3: preserve counter records, screen, signs, umbrella, locker; add Takase at counter and Katase tidying in a separate corner.
- Scene 7 back door: preserve fire door, umbrella sleeve, floor water, drain, and shelf; add Kurose scanning the floor.
- Scene 7 inner: preserve reenactment marks, bean can, phone-drop area, clock, and scuff; add Kurose at clear depth beside evidence.
- Scene 8 office corner: preserve phone screenshot, ledgers, doorway; add tired standing Takase with consistent apron/outfit.
- Scene 8 fixed panel: preserve fixed record and open panel; add Kurose supervising beside, not over, the record.
- Scene 9: use the approved baked audit plate; preserve seated Kitami's glasses, lanyard, business-casual outfit, creased card, and evidence pages.

- [ ] **Step 2: Generate one built-in edit per background**

For each background call the built-in image tool separately with the background
as the edit target and the relevant standee(s) as identity references. Use this
shared prompt frame plus the scene-specific delta above:

```text
Use case: illustration-story
Asset type: Lyra investigation background plate, final 1920x1080 PNG
Primary request: Bake the referenced character(s) naturally into the existing background at physically plausible human scale.
Style/medium: preserve the existing grounded anime neo-noir Japanese detective visual-novel rendering exactly.
Composition/framing: preserve the wide 16:9 camera, all room geometry, furniture perspective, evidence props, and hotspot landmarks; integrate posture, depth, occlusion, and floor contact naturally.
Lighting/mood: match the existing plate's direction, color temperature, rain atmosphere, and shadows.
Constraints: preserve character face, hair, outfit, palette, and signature accessories from the identity reference; keep each character visually separated and clickable; do not cover evidence; no readable text, logos, or watermark.
Avoid: changing the camera, moving furniture, deleting props, adding people, duplicate limbs, scale mismatch, floating feet, costume drift.
```

Use the approved Scene 9 candidate rather than regenerating it unless visual QA
finds a defect.

- [ ] **Step 3: Generate the Kamiya portrait**

Use the current Kamiya portrait as the edit target and Hayasaka only as a
negative comparison reference:

```text
Use case: illustration-story
Asset type: transparent vertical 3:4 Lyra dialogue portrait
Primary request: Redesign 神谷澪 as a visually unique early-thirties Japanese prosecutor while retaining a calm, precise, restrained expression.
Subject: lean angular face and silhouette, sharper cheekbones, glossy black hair in a severe sculpted low chignon, rigid vertical posture, cool graphite longline double-breasted prosecutor suit with sharp lapels, high-neck ivory blouse, restrained silver bar pin, no bag.
Style/medium: grounded anime neo-noir Japanese detective visual novel, matching Lyra's portrait rendering quality.
Constraints: genuinely transparent background, full subject fitted without cropping, no text, logo, or watermark; clearly different face, hair, build, palette, lapels, inner layer, and accessories from Hayasaka.
Avoid: Hayasaka's sturdy build, loose low tie, navy practical jacket, casual crew-neck inner shirt, warm leather bag, or facial structure.
```

- [ ] **Step 4: Copy selected outputs into audit paths and normalize**

Keep generator originals under the Codex generated-images directory. Copy
selected candidates into `tmp/image-audit/`, then use Pillow with uniform
resize plus centered crop for backgrounds and transparent contain/pad for the
portrait. The normalization must implement:

```py
# Background: ImageOps.fit(image.convert("RGB"), (1920, 1080),
#                          method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
# Portrait: ImageOps.contain(image.convert("RGBA"), (768, 1024),
#                            method=Image.Resampling.LANCZOS), then paste it
#           bottom-centered on Image.new("RGBA", (768, 1024), (0, 0, 0, 0)).
```

Copy only visually accepted normalized candidates to the production paths.

- [ ] **Step 5: Inspect outputs and iterate one defect at a time**

Use `view_image` for every normalized candidate. Reject a candidate if it
changes a hotspot landmark, obscures evidence, drifts outfit or face identity,
has implausible scale/occlusion, or violates dimensions. For a rejected image,
issue one targeted image edit that names only the observed defect while
repeating all preservation constraints.

- [ ] **Step 6: Produce visual QA sheets**

Create a labeled contact sheet of the seven final backgrounds and a second
sheet with hotspot rectangles plus the measured character regions. Keep these
under `tmp/image-audit/` for review; do not add them to the commit.

- [ ] **Step 7: Verify image dimensions and alpha**

Run a Pillow scan asserting:

```py
assert background.size == (1920, 1080)
assert background.mode in ("RGB", "RGBA")
assert portrait.size == (768, 1024)
assert portrait.mode == "RGBA"
assert portrait.getpixel((0, 0))[3] == 0
assert portrait.getpixel((767, 0))[3] == 0
```

Expected: all assertions pass.

The accepted files remain a reviewed working-tree batch until Task 8 migrates
the matching interaction layouts. This avoids an intermediate commit that
would render both the baked character and the old standee.

---

### Task 8: Migrate Interaction Regions and Verify the Whole Feature

**Files:**
- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.layout.json`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_8.layout.json`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_9.layout.json`
- Modify: the seven production backgrounds listed in Task 7
- Modify: `static/assets/portraits/kamiya_mio/standard.png`
- Preserve modification: `static/assets/standees/kitami_shuichi/standard.png`

**Interfaces:**
- Consumes: final baked character pixel bounds from Task 7
- Produces: eight baked interaction rectangles aligned to visible characters

- [ ] **Step 1: Replace sprite layouts with measured baked regions**

For each visible character, measure the pixel bounding box `(left, top, right,
bottom)` on the final 1920×1080 background. Add a 2% canvas margin without
overlapping another character, clamp to the canvas, and write:

```json
{
  "kind": "baked",
  "x": "left_with_margin / 1920",
  "y": "top_with_margin / 1080",
  "w": "(right_with_margin - left_with_margin) / 1920",
  "h": "(bottom_with_margin - top_with_margin) / 1080"
}
```

Write the evaluated decimal numbers rounded to six places, not the formulas.
Remove `assetId` and `anchor` from all eight migrated entries. Keep every
hotspot rectangle unchanged unless the visual overlay proves the regenerated
prop moved; a moved landmark causes image rejection before a hotspot edit.

- [ ] **Step 2: Compile the migrated live scenes**

```bash
bun run scenes:compile
```

Expected: tests pass, 17 scenes compile, asset warnings are zero, and the known
unrelated singleton layout warning may remain.

- [ ] **Step 3: Run cross-stack verification**

```bash
bun run test:scripts
bun run check:scripts
bun run --cwd apps/game test src/lib/components/InvestigationSceneSurface.test.ts
bun run --cwd apps/layout-editor test
bun run check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run lint:all
```

Expected: every command exits successfully.

- [ ] **Step 4: Inspect final overlays**

Open `tmp/image-audit/baked-investigation-contact-sheet.png` and
`tmp/image-audit/baked-investigation-interaction-regions.png`. Confirm all seven
backgrounds preserve evidence landmarks, all eight interaction boxes cover one
and only one character, repeated outfits match, Kitami wears glasses and his
lanyard, and Kamiya no longer resembles Hayasaka.

- [ ] **Step 5: Commit production art and matching interaction layouts together**

```bash
git add docs/stories_plan/chapter_1/investigation_scene_1.layout.json docs/stories_plan/chapter_1/investigation_scene_3.layout.json docs/stories_plan/chapter_1/investigation_scene_7.layout.json docs/stories_plan/chapter_1/investigation_scene_8.layout.json docs/stories_plan/chapter_1/investigation_scene_9.layout.json static/assets/backgrounds/chapter_1/investigation_scene_1/office.png static/assets/backgrounds/chapter_1/investigation_scene_3/front.png static/assets/backgrounds/chapter_1/investigation_scene_7/back_door.png static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png static/assets/backgrounds/chapter_1/investigation_scene_8/office_corner.png static/assets/backgrounds/chapter_1/investigation_scene_8/fixed_panel.png static/assets/backgrounds/chapter_1/investigation_scene_9/confront_kitami.png static/assets/portraits/kamiya_mio/standard.png static/assets/standees/kitami_shuichi/standard.png
git commit -m "feat: bake investigation characters into scenes"
```

- [ ] **Step 6: Review final branch scope**

```bash
git status --short
git log --oneline --decorate -10
git diff main...HEAD --stat
git diff --check main...HEAD
```

Expected: only the intended audit artifacts remain untracked; committed source,
tests, docs, sidecars, and production art match the approved design.
