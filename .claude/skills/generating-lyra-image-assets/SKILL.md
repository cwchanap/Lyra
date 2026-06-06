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
     composition usable for the dialogue UI
   - for portraits/evidence: transparent output workflow from `imagegen`
4. Use the built-in `image_gen` tool by default. For batches, issue one
   built-in call per asset; do not switch to CLI fallback just because there
   are many images.
5. For project-bound assets, copy the selected generated image from
   `$CODEX_HOME/generated_images/...` into the expected workspace path. Keep
   the original generated file in place.
6. Normalize the workspace PNG to the policy dimensions:
   - backgrounds: exact policy canvas, opaque PNG
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

## Common Mistakes

- Leaving project-bound images only under `$CODEX_HOME/generated_images/...`.
- Saving portraits/evidence at generator canvas size instead of policy size.
- Cropping transparent assets by visible pixels but forgetting to repack them
  to the declared canvas.
- Treating `batch` as permission to use CLI fallback.
- Adding filesystem paths to authored scene Markdown; writers author semantic
  prompts, not paths.
- Claiming assets are fixed without rerunning `scenes:compile` and dimension
  checks.
