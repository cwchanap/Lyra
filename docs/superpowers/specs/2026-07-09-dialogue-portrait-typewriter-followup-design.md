# Dialogue Portrait Placement and Text Reveal Follow-Up

## Context

The scene image crossfade feature removes black flashes when scene images change,
but dialogue portraits still have one follow-up defect: if a portrait keeps the
same image source while moving from the right side to the left side, the existing
image layer updates its placement class in place. This can flash the previous
portrait on the wrong side instead of fading it out from its old side.

Dialogue text also appears instantly after each advance. The desired visual novel
behavior is that the next line reveals gradually over the same pacing window as
the portrait transition.

## Design

- Dialogue portrait transitions use a layer identity that includes both the
  portrait image URL and the side placement. A same-image right-to-left or
  left-to-right move creates a new crossfade layer instead of mutating the live
  layer.
- Dialogue portrait transitions use a 1500 ms duration.
- Dialogue `action` and `line` text reveal over 1500 ms. Scene-tag placeholder
  text remains instant.
- If the player clicks or presses Space/Enter while text is still revealing, the
  current text completes immediately and the dialogue does not advance. The next
  click or key press advances normally.
- The implementation stays inside the existing Svelte frontend components:
  `CrossfadeImage.svelte` gains an optional transition key, and
  `DialogueBox.svelte` owns the portrait key and typewriter reveal state.

## Verification

- Add a `CrossfadeImage` regression for same-source placement/key changes.
- Add `DialogueBox` regressions for right-to-left portrait movement, 1500 ms
  portrait duration, gradual text reveal, and complete-before-advance input.
- Run the focused component tests and `bun run --cwd apps/game check`.
