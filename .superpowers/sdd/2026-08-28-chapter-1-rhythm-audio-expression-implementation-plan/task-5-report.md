# Task 5 portrait asset report

## Status

Complete. Exactly nine Chapter 1 expression portrait PNGs were generated with
the built-in `image_gen` tool, normalized, visually inspected, and committed.

Asset commit: `09ccf2ac7bf80a56f24b4f0834b104db18192e74`

Baseline: `cce0b331aa797162e1f412912651ea78f29a4e5a`

The asset commit contains only these nine PNGs. No story, runtime, audio,
progress, compiler, or generated-resource files were changed.

## Output files

| Character / expression | Destination |
| --- | --- |
| Soma / determined | `static/assets/portraits/soma_ritsu/determined.png` |
| Soma / shaken | `static/assets/portraits/soma_ritsu/shaken.png` |
| Soma / relieved | `static/assets/portraits/soma_ritsu/relieved.png` |
| Hayasaka / softened | `static/assets/portraits/hayasaka_akane/softened.png` |
| Miyake / relieved | `static/assets/portraits/miyake_sota/relieved.png` |
| Kamiya / skeptical | `static/assets/portraits/kamiya_mio/skeptical.png` |
| Kamiya / conceding | `static/assets/portraits/kamiya_mio/conceding.png` |
| Kitami / defensive | `static/assets/portraits/kitami_shuichi/defensive.png` |
| Kitami / cornered | `static/assets/portraits/kitami_shuichi/cornered.png` |

## Generation and reference mapping

Five standard portraits were opened with `view_image` at original resolution
before generation. Each asset used exactly one built-in `image_gen` call and
the corresponding `standard.png` as the sole identity/edit reference. There
were nine completed calls, no generation errors or timeouts, and no variants,
placeholders, or CLI generation fallback.

| Destination | Standard reference | Built-in generated source | Source file dimensions |
| --- | --- | --- | --- |
| `static/assets/portraits/soma_ritsu/determined.png` | `static/assets/portraits/soma_ritsu/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-5aee31e8-1233-442f-b481-a387afbd0cee.png` | 1086 x 1448 RGB |
| `static/assets/portraits/soma_ritsu/shaken.png` | `static/assets/portraits/soma_ritsu/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-7a397b09-2e94-4906-bb16-908348677505.png` | 1085 x 1450 RGB |
| `static/assets/portraits/soma_ritsu/relieved.png` | `static/assets/portraits/soma_ritsu/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-faedebc5-6f0f-4eb7-8ae0-8d51337dc521.png` | 1086 x 1448 RGB |
| `static/assets/portraits/hayasaka_akane/softened.png` | `static/assets/portraits/hayasaka_akane/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-72641dd5-4e06-4dac-ae93-317a68b3b6ad.png` | 1086 x 1448 RGB |
| `static/assets/portraits/miyake_sota/relieved.png` | `static/assets/portraits/miyake_sota/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-b744d80e-d2db-42b8-8345-89f5e959a5e0.png` | 1086 x 1448 RGB |
| `static/assets/portraits/kamiya_mio/skeptical.png` | `static/assets/portraits/kamiya_mio/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-94605bff-bdf0-45bb-a423-d7240e22bece.png` | 1086 x 1448 RGB |
| `static/assets/portraits/kamiya_mio/conceding.png` | `static/assets/portraits/kamiya_mio/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-99255e2c-4237-4845-aaf2-47d3b9d76081.png` | 1086 x 1448 RGB |
| `static/assets/portraits/kitami_shuichi/defensive.png` | `static/assets/portraits/kitami_shuichi/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-967b8097-ff08-47f1-b4cf-2aeb8866f905.png` | 1087 x 1447 RGB |
| `static/assets/portraits/kitami_shuichi/cornered.png` | `static/assets/portraits/kitami_shuichi/standard.png` | `/Users/chanwaichan/.codex/generated_images/01a04d92-2d71-7cc1-8097-474603bc9c04/exec-b2b6b681-58d4-493f-b61c-00eba5d9291f.png` | 1086 x 1448 RGB |

## Built-in prompt set

Every call used this shared prompt scaffold, with the per-asset expression
delta below:

```text
Use case: illustration-story.
Asset type: transparent vertical 3:4 half-body visual-novel portrait.
Input image: Image 1 is the sole identity and edit reference; preserve that
exact character identity.
Primary request: create exactly one final expression variant for the named
asset.
Subject and invariants: preserve face, age, hair, outfit, body, crop, prop,
lighting, and palette from the standard; change only the expression and the
smallest posture cue.
Style/medium: grounded anime neo-noir Japanese detective visual novel art.
Composition/framing: same vertical 3:4 half-body framing and bottom alignment;
do not shift or crop the subject.
Lighting/mood: preserve the reference lighting and palette; apply only the
requested emotional delta.
Constraints: genuinely transparent background, crisp edges, no background,
checkerboard, chroma matte, halo, chroma fringe, readable text, logo,
watermark, extra person, extra prop, restyling, sheet, or additional variant;
one asset only.
```

Expression deltas supplied to the nine calls:

- Soma `determined`: focused brows and set chin, quiet professional resolve.
- Soma `shaken`: controlled shock and tension, slightly widened eyes, taut
  brows, restrained lips, and slight neck/shoulder tension; no theatrical gasp,
  anger, or tears.
- Soma `relieved`: soft controlled exhale, eased eyes and brow, quiet relief;
  no broad smile.
- Hayasaka `softened`: gentle gaze, subtle warmth, relaxed eyes, and a barely
  softened mouth.
- Miyake `relieved`: tired tension release, softened eyes and brow, unclenched
  jaw, and a small exhale in the mouth/shoulders.
- Kamiya `skeptical`: restrained narrowed evaluating gaze and subtle brow
  tension; no anger or sneer.
- Kamiya `conceding`: controlled acceptance, softened eyes, relaxed brow,
  faint acknowledging mouth, and settled chin; no broad smile.
- Kitami `defensive`: guarded knitted brows, tight mouth, and the smallest
  shoulder lift; not aggressive or fearful.
- Kitami `cornered`: contained anxiety behind glasses, anxious eyes, raised
  inner brows, tight mouth, and a small shoulder lift; no panic or tears.

## Normalization and alpha QA

The built-in responses were RGB files with a baked checkerboard matte despite
the transparency request. The repository's flat-key `remove_chroma_key.py`
utility was checked, but a checkerboard needs per-pixel matte handling rather
than a single chroma color. The final cleanup used a one-off local
Python/Pillow pass (no new repository helper or dependency):

1. Estimate the two neutral checker colors from the generated image border and
   identify checker pixels by border flood-fill plus enclosed-hole detection.
2. Compute a local alpha matte at checker/subject contours, unblend edge RGB
   against the checker colors, and set RGB to zero wherever alpha is zero.
3. Resize with premultiplied alpha using uniform scaling, bottom-align the
   visible subject, and save as exact 768 x 1024 RGBA PNG.

This was image normalization/post-processing, not an alternate generation
path. All nine final files report the exact same `file -b` output:

```text
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
PNG image data, 768 x 1024, 8-bit/color RGBA, non-interlaced
```

The alpha inspection found alpha zero at all four corners of every output.
The following coverage evidence uses Pillow's `Image.getbbox()` convention
(left, top, right-exclusive, bottom-exclusive); every visible subject reaches
the bottom edge and none has an opaque full-frame background.

| Output | Alpha=0 pixels | Partial-alpha pixels | Visible bbox |
| --- | ---: | ---: | --- |
| `soma_ritsu/determined.png` | 352,756 | 12,964 | `(102, 7, 724, 1024)` |
| `soma_ritsu/shaken.png` | 334,740 | 13,797 | `(81, 3, 725, 1024)` |
| `soma_ritsu/relieved.png` | 347,746 | 13,633 | `(82, 7, 710, 1024)` |
| `hayasaka_akane/softened.png` | 344,076 | 12,227 | `(56, 15, 743, 1024)` |
| `miyake_sota/relieved.png` | 376,317 | 11,161 | `(124, 0, 691, 1024)` |
| `kamiya_mio/skeptical.png` | 468,712 | 11,680 | `(169, 34, 653, 1024)` |
| `kamiya_mio/conceding.png` | 470,370 | 11,769 | `(167, 24, 646, 1024)` |
| `kitami_shuichi/defensive.png` | 402,144 | 9,746 | `(126, 47, 662, 1024)` |
| `kitami_shuichi/cornered.png` | 402,319 | 9,919 | `(139, 44, 673, 1024)` |

## Visual QA

All nine final outputs were inspected with `view_image` after normalization.
The identity anchors, outfit, props, framing, lighting, and palette remained
stable while the requested expression delta was visible:

- `soma_ritsu/determined.png`: tousled black hair, gray eyes, rolled-sleeve
  white shirt, loose black tie, dark trousers/belt, and worn brown folio;
  focused brows and set chin read as quiet resolve.
- `soma_ritsu/shaken.png`: the same Soma anchors and folio; widened eyes and
  held facial/neck tension read as controlled shock, not theatrical panic.
- `soma_ritsu/relieved.png`: the same Soma anchors and folio; eased eyes and
  softened mouth read as restrained relief.
- `hayasaka_akane/softened.png`: black low ponytail, navy blazer/trousers,
  white crew-neck shirt, and black folio; gentle gaze and subtle warmth read
  as softened.
- `miyake_sota/relieved.png`: tousled black hair, black work jacket, gray
  button shirt, dark waist apron, and hands in pockets; tired eyes/jaw release
  read as relief.
- `kamiya_mio/skeptical.png`: tight bun, charcoal double-breasted suit, and
  white high-neck blouse; narrowed assessing gaze reads as skeptical.
- `kamiya_mio/conceding.png`: the same Kamiya anchors and framing; softened
  eyes, relaxed brow, and settled chin read as controlled acceptance.
- `kitami_shuichi/defensive.png`: black hair, rectangular glasses, blue work
  jacket, gray shirt, and black lanyard/badge; knitted brows, tight mouth, and
  slight shoulder lift read as guarded defense.
- `kitami_shuichi/cornered.png`: the same Kitami anchors and glasses; anxious
  eyes and restrained shoulder tension read as contained anxiety without
  panic.

The controller independently viewed all nine final files and found the
identity, outfit, crop, and expression deltas coherent.

## Scene transition inspection

The authored/compiled expression transitions were checked against the final
asset set without editing scene files:

- Scene 5: `scene_5.md:129-131` uses Soma `shaken` for the controlled shock
  beat.
- Scene 9: `investigation_scene_9.md:266-268` uses Kitami `defensive`,
  `:291-293` uses Kitami `cornered`, and `:399-405` uses Soma `determined`.
- Scene 10: `interrogation_scene_10.md:80-84` uses Kamiya `skeptical`, and
  `:301-307` uses Kamiya `conceding`.
- Scene 11: `scene_11.md:30-32` uses Miyake `relieved`, and `:64-66` uses
  Hayasaka `softened`. The Aoba bridge at `:166-178` keeps Soma
  expression-neutral/standard.
- The additional Soma relief use remains at
  `analysis_scene_8_5.md:181-183`.

## Verification

- `bun run scenes:compile` — pass; 1 chapter, 17 scenes; asset totals were
  backgrounds 52, portraits 26, standees 0, evidence 30, and audio 18. The
  only remaining compiler note is the pre-existing singleton source group
  `victim_phone_device` with one member
  `evidence:victim_phone_notification`.
- `bun run --cwd apps/game test` — pass; 66 test files, 1,115 tests. Existing
  jsdom canvas/media-not-implemented diagnostics were non-failing.
- `bun run --cwd apps/game check` — pass; `svelte-check found 0 errors and 0
  warnings`.
- `git diff --check` — pass.

## SHA-256

| Output | SHA-256 |
| --- | --- |
| `static/assets/portraits/soma_ritsu/determined.png` | `4403256d7200304ebded396592a9f4bf564291934886473cc50474e81e3d1031` |
| `static/assets/portraits/soma_ritsu/shaken.png` | `c11ab2ca7920abd755d7ec0ff200fafa1217fd0de6bfcca4b115280a679573e4` |
| `static/assets/portraits/soma_ritsu/relieved.png` | `48b4e98a2e8ac42a2f6df4f78f4e419dc98b200c035f88da4380e43896c90673` |
| `static/assets/portraits/hayasaka_akane/softened.png` | `a8cabf409762c9170273d7ea7b0b7d9eaeb10df583574ee048523a892cf0a07a` |
| `static/assets/portraits/miyake_sota/relieved.png` | `6487b83aea0910919c65e85200a70db43cc83ea1ac70b829255853265b680796` |
| `static/assets/portraits/kamiya_mio/skeptical.png` | `d90cf417170aef752fc217d4ae3aa8c7407f3934b5a20c454a05e61ddad63065` |
| `static/assets/portraits/kamiya_mio/conceding.png` | `37e5efa88a4557b5f7a4540a44390bb64a1aaba6e73117906927a111720b9e0a` |
| `static/assets/portraits/kitami_shuichi/defensive.png` | `a2c67b037608c45add0beda6083f3f21228f49919317e9471217131be5d2ecb2` |
| `static/assets/portraits/kitami_shuichi/cornered.png` | `a1070bb8de68c060fdf4de6bc6eab3314a587a80bcad50d6ce222bb1eb0af495` |

## Concerns and limitations

- The generator baked an RGB checkerboard into all nine responses even though
  transparency was requested. The explicit Pillow matte cleanup removed the
  checkerboard and the final alpha/file/visual checks passed; this remains the
  only generation concern.
- Transition verification was source/compiled-reference inspection plus
  static asset QA. No additional interactive packaged-Tauri playthrough was
  performed in this asset-only task.
