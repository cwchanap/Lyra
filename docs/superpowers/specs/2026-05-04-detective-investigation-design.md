# Detective Investigation Phase 1 Design

Date: 2026-05-04
Status: Approved for implementation planning

## Summary

Build the first playable slice of a simple detective game inspired by Ace Attorney, focused only on investigation mechanics. Courtroom play is deferred to a later phase. Phase 1 should prove that the app can run a small case where the player inspects a scene, interviews people, collects clues, fills fixed deduction prompts, submits a theory, and receives deterministic feedback.

The project is a Tauri 2 desktop app with a SvelteKit SPA frontend. Rust should own the investigation engine and expose it through Tauri commands. Svelte should render the investigation workbench and send player actions to Rust.

## Goals

- Provide one playable placeholder demo case.
- Focus on mechanics over story quality.
- Support a workbench UI with `Scene`, `People`, `Evidence`, and `Deduction Board` tabs.
- Store and validate case state in Rust.
- Use fixed deduction prompts rather than a freeform graph.
- Require the player to submit a full theory before correctness feedback appears.
- Keep data contracts serializable so future JSON case loading and save files are straightforward.
- Add Rust engine coverage for the core investigation rules.

## Non-Goals

- Courtroom sequences, testimony cross-examination, objections, or trial flow.
- A case editor or external case import.
- Rich narrative branching.
- Save/load persistence.
- Browser-only server features, SvelteKit endpoints, SSR, or any Node server dependency.
- Full end-to-end browser testing in the first slice.

## Approved Direction

Use a Rust investigation engine rather than keeping most rules in Svelte. Rust owns the embedded demo case, current investigation state, reveal and unlock rules, and deduction validation. Svelte owns only presentation state, such as the active tab, selected character, selected deduction slot, and draft board answers.

This gives Phase 1 a clean gameplay boundary: the frontend can never decide whether an answer is correct. It asks Rust for the current case state, sends actions, and renders returned results.

## Player Loop

1. Start the demo case.
2. Inspect the `Scene` tab to reveal or collect evidence from a small set of hotspots.
3. Visit `People` to read character profiles and interview available topics.
4. Review collected clues in `Evidence`.
5. Fill every fixed prompt in `Deduction Board` using collected evidence or known statements.
6. Submit the full theory.
7. Receive overall feedback plus per-slot feedback after submission.
8. Revise and resubmit if the theory is wrong.

## Demo Case Scope

The placeholder case should be small but complete:

- One location.
- Two or three characters.
- A small set of inspectable hotspots.
- A handful of evidence items and statements.
- One deduction board with fixed slots, such as cause, key clue, timeline, or culprit.

Story text only needs to make the mechanics understandable. The case content can be simple and direct, but it should exercise the engine paths: scene inspection, evidence discovery, interview topics, unlocks, deduction submission, failed theory feedback, and successful theory feedback.

## Rust Engine

The Rust side should define serializable domain types for:

- Case metadata: id, title, summary, and current status.
- Scene hotspots: id, label, description, locked or inspected state, and optional evidence reveal.
- Characters: id, name, role, profile text, and available interview topics.
- Interview topics: id, label, prompt or response text, locked state, and optional statement reveal.
- Evidence: id, label, description, collected state, and optional detail text.
- Statements: id, speaker, text, discovered state, and related topic.
- Deduction slots: id, prompt, accepted answer ids, candidate answer ids, and feedback text.
- Deduction submission feedback: complete or incomplete status, overall result, per-slot result, and guidance.

Suggested commands:

- `start_case()` initializes or resets the demo case and returns the public case state.
- `get_case_state()` returns the current public case state.
- `inspect_hotspot(hotspot_id)` marks a hotspot inspected, applies reveals or unlocks, and returns updated state.
- `interview_character(character_id, topic_id)` records the interview, applies statement reveals or unlocks, and returns updated state.
- `submit_deduction(answers)` validates a complete board submission and returns deduction feedback plus updated state.

Rust can keep state in managed Tauri state for Phase 1. The design should not require filesystem access yet.

## Frontend UI

The first screen should be the actual investigation workbench, not a marketing or landing page. It should replace the scaffolded starter screen.

Layout:

- Header with case title and status.
- Tab navigation for `Scene`, `People`, `Evidence`, and `Deduction Board`.
- Primary content area for the selected tab.
- Secondary detail area for selected evidence, selected character, or current feedback.

Tab behavior:

- `Scene` shows inspectable hotspots as deterministic controls. Inspected hotspots should be visibly marked.
- `People` shows character profiles and interview topics. Locked topics should remain visible but disabled with a concise reason.
- `Evidence` shows collected evidence and known statements. It should not show undiscovered items as selectable answers.
- `Deduction Board` shows fixed slots. Each slot is filled from collected evidence or known statements. The board is submitted as a full theory.

Feedback:

- No per-slot correctness before submission.
- After submission, show overall result and per-slot pass/fail feedback.
- Wrong submissions leave the board editable.
- Incomplete submissions should not be treated as wrong theories; they should prompt the player to fill all slots.

## Data Flow

On app load in Phase 1, Svelte calls `start_case()` and renders the returned public state. Later refresh actions can call `get_case_state()` without resetting progress. Player actions call a Rust command and replace the current frontend copy of case state with the response. The deduction board can keep draft answers locally until the player submits.

All IDs used by the frontend should come from Rust responses. The frontend should send IDs back to Rust without duplicating rules or answer keys.

## Error Handling

Rust should return typed, serializable errors for:

- Unknown hotspot, character, topic, slot, or answer IDs.
- Attempts to inspect or interview locked content.
- Incomplete deduction submissions.
- Malformed deduction submissions, such as duplicate slot answers or answers for unknown slots.

The frontend should show short inline messages and keep the workbench usable. Errors should not crash the app or erase local draft answers unless the case is reset.

## Testing And Verification

Rust engine tests should cover:

- Starting the demo case.
- Inspecting hotspots and collecting evidence.
- Unlocking or revealing interview topics or statements.
- Rejecting unknown IDs.
- Rejecting locked actions.
- Rejecting incomplete deduction submissions.
- Returning failed theory feedback for wrong answers.
- Returning success feedback for the correct complete theory.

Frontend verification for Phase 1 should include `bun run check`. Rust verification should include `cd src-tauri && cargo check`. If frontend behavior becomes complex enough, add lightweight tests later, but Phase 1 does not require an end-to-end suite.

## Implementation Constraints

- Keep SvelteKit in SPA mode. Do not add `+page.server.ts`, `+server.ts`, SSR-only features, or server hooks.
- Use Svelte 5 runes and event attributes, matching the existing codebase.
- Use Bun commands for frontend tasks.
- Register every new Tauri command in `tauri::generate_handler![...]`.
- Add Tauri capability permissions only if new plugins or APIs require them.
- Keep the first implementation small enough to be playable and verifiable in one pass.
