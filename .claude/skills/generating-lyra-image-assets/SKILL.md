---
name: generating-lyra-image-assets
description: Use when generating or editing raster image assets for Lyra, including story backgrounds, character portraits, evidence icons, chapter starter packs, or missing asset files reported by scenes:compile.
---

# Generating Lyra Image Assets

## Purpose

This skill is the Lyra-specific SOP for raster image assets. It wraps the
system `imagegen` skill with this repo's scene compiler, asset paths, policy
dimensions, and verification requirements.

## Required Background

Before generating or editing images, load and follow the system `imagegen`
skill at:

`${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/SKILL.md`

If that skill/tool path is unavailable, tell the user to run the image request
in the Codex app. Do not substitute SVG placeholders, CSS mockups, or another
generation path for raster assets.

## Source Of Truth

- Asset policy: `static/assets/config/policy.yaml`
- Authored prompts:
  - `Background Prompt` on scene tags, sub-locations, or interrogation phases
  - `Image Prompt` on evidence manifest entries
  - portrait prompts from character/expression intent and current user request
- Expected asset paths are derived from asset IDs:
  - `background.chapter_1.scene_0.tag_001` ->
    `static/assets/backgrounds/chapter_1/scene_0/tag_001.png`
  - `portrait.soma_ritsu.standard` ->
    `static/assets/portraits/soma_ritsu/standard.png`
  - `evidence.coffee_receipt` ->
    `static/assets/evidence/coffee_receipt.png`

Do not hand-edit generated JSON under `src-tauri/resources/**`; regenerate it
with `bun run scenes:compile`.

## Workflow

1. Run or inspect `bun run scenes:compile` output when filling missing assets.
   Use the reported `assetId`, expected path, type, and authored prompt.
2. Read `static/assets/config/policy.yaml` before generating. Use its global
   style prompt, type prompt, dimensions, format, and transparency requirement.
3. Build one prompt per distinct asset. Include:
   - use case `illustration-story` for story backgrounds/portraits/evidence
   - target asset type and final path
   - the authored `Background Prompt` or `Image Prompt`
   - Lyra style: grounded anime neo-noir Japanese detective visual novel
   - constraints: no readable text, no logos, no watermark
   - for backgrounds: no foreground dialogue characters and leave lower-area
     composition usable for the dialogue UI; explicitly request a wide 16:9
     composition
   - for investigation/explore backgrounds that will host full-body standees:
     include visible floor or ground at the standee placement area and avoid
     foreground desks, tables, counters, or props blocking the lower body/feet
   - for portraits: explicitly request a vertical 3:4 character portrait
   - for evidence: explicitly request a square 1:1 object-focused icon
   - for portraits/evidence: transparent output workflow from `imagegen`
4. Use the built-in `image_gen` tool by default. For batches, issue one
   built-in call per asset; do not switch to CLI fallback just because there
   are many images.
5. For project-bound assets, copy the selected generated image from
   `$CODEX_HOME/generated_images/...` into the expected workspace path. Keep
   the original generated file in place.
6. Normalize the workspace PNG to the policy dimensions:
   - backgrounds: exact policy canvas, opaque PNG, preserving aspect ratio
   - portraits: exact policy canvas, RGBA, subject fitted without cropping and
     bottom-aligned
   - evidence: exact policy canvas, RGBA, subject fitted without cropping and
     centered
7. Inspect representative outputs with `view_image`, especially after alpha
   removal, cropping, or resizing.
8. Run verification:
   - `bun run scenes:compile`
   - a dimension scan for touched asset types
   - focused UI/e2e checks when portrait or evidence dimensions/layout changed
9. Report final workspace paths, whether built-in `image_gen` or CLI fallback
   was used, and any remaining unrelated asset warnings.

## Transparent Assets

Portraits and evidence use transparency. Stay on the built-in `imagegen` path
first:

1. Generate on a flat chroma-key background as instructed by the system
   `imagegen` skill.
2. Remove the key with:
   `${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py`
3. Validate alpha: transparent corners, plausible subject coverage, no obvious
   key fringe.
4. Repack to the exact policy canvas after alpha validation.

Ask before using CLI `gpt-image-1.5` true transparency unless the user already
requested CLI/API fallback.

## Size And Aspect Handling

The built-in `image_gen` tool accepts a prompt only; it cannot guarantee exact
pixel dimensions or a hard aspect ratio. Treat prompt text such as "16:9",
"portrait 3:4", or "square 1:1" as guidance, then verify the generated PNG
before committing it.

Use the target ratio from `static/assets/config/policy.yaml` for the asset type:

| Type | Policy canvas | Target ratio | Prompt cue |
| --- | --- | --- | --- |
| background | `1920x1080` | `16:9` | wide background plate |
| portrait | `768x1024` | `3:4` | vertical character portrait |
| evidence | `512x512` | `1:1` | square object icon |

Always repack final workspace files to the dimensions in
`static/assets/config/policy.yaml`, but never use non-uniform scaling that
stretches width and height by different factors. Use this order:

1. Measure the generated image dimensions.
2. If the generated aspect ratio is close to the policy ratio, resize uniformly
   to the policy canvas.
3. If the generated aspect ratio is not close, crop or pad to the policy ratio
   while preserving scale, then resize uniformly to the policy canvas.
4. Inspect the result before accepting it, especially for background
   composition and portrait placement.

For example, a generated `1672x941` background plate is close enough to resize
uniformly to `1920x1080` because its aspect ratio is effectively `16:9`. A
landscape portrait or rectangular evidence image is not close enough for its
asset type; crop/pad only if the subject still fits naturally, otherwise
regenerate with a stronger type-specific ratio cue.

If the user explicitly approves CLI/API fallback for exact-size generation,
choose a valid generation size supported by the model that matches the asset
ratio, then downscale proportionally to the policy canvas. Useful examples:
`2048x1152` or `3840x2160` for backgrounds, `768x1024` or `1536x2048` for
portraits, and square sizes for evidence. Do not request dimensions from models
that have size divisibility or range rules unless both dimensions satisfy that
model's requirements.

## Common Mistakes

- Leaving project-bound images only under `$CODEX_HOME/generated_images/...`.
- Saving portraits/evidence at generator canvas size instead of policy size.
- Stretching generated images to policy dimensions when their source aspect
  ratio does not match.
- Cropping transparent assets by visible pixels but forgetting to repack them
  to the declared canvas.
- Treating `batch` as permission to use CLI fallback.
- Adding filesystem paths to authored scene Markdown; writers author semantic
  prompts, not paths.
- Claiming assets are fixed without rerunning `scenes:compile` and dimension
  checks.
