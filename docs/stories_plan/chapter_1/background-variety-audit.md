# Chapter 1 background-variety audit

**Audit date:** 2026-08-07
**Ruleset:** compiler-owned Chapter 1 cue inventory; `keep`, `prompt-adjust`, `regenerate`, and `add-variant` decisions; Priority A only for material comprehension, usability, evidence, reveal, state, or continuity impact.
**Production analysis:** None present at the production freeze. The user-approved post-freeze P1 amendment split the former linear `scene_p1.md` into `investigation_scene_p1.md` and `analysis_scene_p1_5.md`; the current accepted manifest therefore has 17 scenes. P1.5 intentionally reuses the existing stationery-counter plate (`background.chapter_1.scene_p1.tag_002`) rather than adding a new background. HPA-265 later replaced the former linear `scene_8_5.md` with `analysis_scene_8_5.md`; the current accepted manifest and the live cue inventory below reflect that replacement, while the frozen historical baseline above is unchanged.

## Frozen production manifest

The ordered scene list copied from `chapter.md` at the audit freeze:

1. `scene_p0.md`
2. `scene_p1.md`
3. `scene_p2.md`
4. `scene_0.md`
5. `investigation_scene_1.md`
6. `scene_2.md`
7. `investigation_scene_3.md`
8. `interrogation_scene_4.md`
9. `scene_5.md`
10. `scene_6.md`
11. `investigation_scene_7.md`
12. `investigation_scene_8.md`
13. `scene_8_5.md`
14. `investigation_scene_9.md`
15. `interrogation_scene_10.md`
16. `scene_11.md`

## Current accepted manifest after the P1 amendment and HPA-265

The historical freeze above remains the 16-scene audit baseline. The current
compiler-derived manifest adds the approved P1 investigation/analysis split:

1. `scene_p0.md`
2. `investigation_scene_p1.md`
3. `analysis_scene_p1_5.md`
4. `scene_p2.md`
5. `scene_0.md`
6. `investigation_scene_1.md`
7. `scene_2.md`
8. `investigation_scene_3.md`
9. `interrogation_scene_4.md`
10. `scene_5.md`
11. `scene_6.md`
12. `investigation_scene_7.md`
13. `investigation_scene_8.md`
14. `analysis_scene_8_5.md`
15. `investigation_scene_9.md`
16. `interrogation_scene_10.md`
17. `scene_11.md`

## Methodology

`bun run scenes:compile` generated the current production manifests, then `bun run background-cues:audit --chapter chapter_1` supplied the 57 exact cue keys below. The review groups cues by physical location rather than filename. Within each group it compares stable geometry, recurring props, palette, and adjacent cue continuity against the camera angle, focal emphasis, and environment/state delta. The production plates were visually reviewed as four temporary contact sheets; no generated resource JSON was edited.

The audit distinguishes intentional holds from accidental repetition. In particular, the final KAGAMI hearing holds the same room and defense-side sightline through its evidence sequence: the changing focal objects (summary, time records, floor plan, authorization, lock excerpt, and chain) are the intended state progression. Reframing that uninterrupted sequence just to add variety would be gratuitous.

### Retired hearing plates

The former p2 time-record comparison plate and former p3 L-shaped floor-plan reconstruction plate are intentionally retired by the p1 multi-question merge. The current grammar cannot re-cue a phase-level visual for each question body, so no question-body `[場景：]` rescue is added. If playtesting finds the continuous hearing too flat, the fallback is to restore the phase split rather than add runtime machinery.

## Cue decisions

| Cue key | Location family | Current function | Continuity anchors | Variety finding | Decision | Priority | Proposed function | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `chapter_1/scene_p0.json::/queue/0/assetCue/backgroundAssetId` | Tokyo station platform | Rainy-city prologue establish | Wet track edge, blue rain palette, distant information glow | Wide platform gives the chapter a transit-scale opening distinct from later streets | keep | B | Retain wide impersonal city entry | Accepted |
| `chapter_1/scene_p0.json::/queue/5/assetCue/backgroundAssetId` | Kichijoji arcade | Shelter-under-awning transition | Arcade roof, wet paving, vending glow | Tighter arcade enclosure changes the transit scale without breaking rain continuity | keep | B | Retain sheltered pedestrian rhythm | Accepted |
| `chapter_1/scene_p0.json::/queue/9/assetCue/backgroundAssetId` | Tokyo crossing | System-in-the-city escalation | Umbrella field, wet asphalt, screen glow | Open crossing and reflected signals materially differ from the arcade | keep | B | Retain public-information pressure | Accepted |
| `chapter_1/scene_p0.json::/queue/15/assetCue/backgroundAssetId` | Legal-aid exterior | Institutional handoff | Rainy street, billboard glow, anonymous walkers | Legal frontage shifts focal emphasis from crowds to procedural promise | keep | B | Retain institution-at-night establish | Accepted |
| `chapter_1/investigation_scene_p1.json::/intro/0/assetCue/backgroundAssetId` | Stationery shop exterior | Small-case arrival establish | Warm glass, awning, wet shopping street | Front elevation cleanly introduces the shop against the cool rain | keep | B | Retain arrival geography | Accepted |
| `chapter_1/investigation_scene_p1.json::/sublocations/0/backgroundAssetId` | Stationery/copy shop interior | Receipt-dispute workspace | Wooden counter, copier, register, paper shelves | Interior changes palette and focal evidence surface while preserving the storefront relation | keep | B | Retain counter evidence stage | Accepted |
| `chapter_1/analysis_scene_p1_5.json::/intro/0/assetCue/backgroundAssetId` | Stationery/copy shop interior | P1.5 existing-counter reuse | Wooden counter, copier, register, paper shelves | The analysis returns to the already established counter, so the shared evidence surface gives the handoff continuity without a gratuitous new plate | keep | B | Retain the existing counter for the P1.5 evidence comparison | Accepted; user-approved post-freeze P1.5 existing-counter reuse |
| `chapter_1/scene_p2.json::/queue/0/assetCue/backgroundAssetId` | Rain Bell front room | Ordinary-day cafe establish | Warm wood, rain-streaked windows, counter | Wide daylight cafe plate is distinct from later night-investigation views | keep | B | Retain ordinary working-space baseline | Accepted |
| `chapter_1/scene_p2.json::/queue/10/assetCue/backgroundAssetId` | Rain Bell back corridor | Slow-clock operational clue | Narrow corridor, stacked boxes, old clock | Corridor compression isolates the time clue from the open cafe | keep | B | Retain clock-focused service passage | Accepted |
| `chapter_1/scene_p2.json::/queue/13/assetCue/backgroundAssetId` | Rain Bell entrance | Masuda arrival threshold | Glass door, wet street, warm interior | Door-facing angle supplies arrival context rather than duplicating the front-room hold | keep | B | Retain threshold and weather contrast | Accepted |
| `chapter_1/scene_p2.json::/queue/31/assetCue/backgroundAssetId` | Rain Bell counter | Closing procedure setup | Espresso machine, whiteboard, counter wood | Counter-side close view shifts focus to operations and closure state | keep | B | Retain procedure-focused service view | Accepted |
| `chapter_1/scene_p2.json::/queue/40/assetCue/backgroundAssetId` | Rain Bell front room/street | Ordinary day turns ominous | Window table, latte remnant, rain-dark street | Interior/exterior dusk blend advances weather and emotional state from the opening daytime plate | keep | B | Retain dusk foreshadowing plate | Accepted |
| `chapter_1/scene_0.json::/queue/0/assetCue/backgroundAssetId` | KAGAMI abstract interface | Machine-summary cold open | Black field, ordered luminous rows, blue-white logic | Non-literal interface sharply breaks from physical Tokyo spaces | keep | B | Retain abstract system perspective | Accepted |
| `chapter_1/scene_0.json::/queue/12/assetCue/backgroundAssetId` | Police meeting corridor | Summary enters institution | Pale fluorescent hall, monitor, bench | Corridor converts the abstract system into an empty procedural environment | keep | B | Retain institutional transition | Accepted |
| `chapter_1/scene_0.json::/queue/20/assetCue/backgroundAssetId` | Soma office | Human review counterpoint | Worn desk, lamp pool, case papers | Warm desk focus contrasts with both the interface and police corridor | keep | B | Retain analyst-at-desk frame | Accepted |
| `chapter_1/investigation_scene_1.json::/intro/0/assetCue/backgroundAssetId` | Soma office exterior | Investigation arrival establish | Narrow street, rain, second-floor light | Exterior locates the office before the exploration view | keep | B | Retain exterior-to-interior handoff | Accepted |
| `chapter_1/investigation_scene_1.json::/sublocations/0/backgroundAssetId` | Soma office interior | File-review exploration hub | Worn desk, paper stacks, coffee machine | Interior gives selectable geometry and props after the exterior establish | keep | B | Retain exploration-readable office layout | Accepted |
| `chapter_1/scene_2.json::/queue/0/assetCue/backgroundAssetId` | Hayasaka office | Family commission intake | Case papers, thermos, rice-ball bag, rainy daylight | Personal tabletop anchors distinguish it from Soma's darker office | keep | B | Retain client-emotion workspace | Accepted |
| `chapter_1/scene_2.json::/queue/28/assetCue/backgroundAssetId` | Review-board entry | Procedural threshold | Service window, metal door, cold light | Narrow counter-window creates a new institutional depth cue | keep | B | Retain gatekeeping transition | Accepted |
| `chapter_1/scene_2.json::/queue/41/assetCue/backgroundAssetId` | Review-board exterior | Legal-pressure release | Stone steps, wet street, pale morning | Exterior widens from the entry window and resets the scene's breathing room | keep | B | Retain exterior pause | Accepted |
| `chapter_1/investigation_scene_3.json::/intro/0/assetCue/backgroundAssetId` | Rain Bell exterior after closing | Crime-site establish | Wet glass, dark facade, rain reflections | Night exterior is materially darker and tenser than Chapter P2 cafe daylight | keep | B | Retain post-closing mystery establish | Accepted |
| `chapter_1/investigation_scene_3.json::/sublocations/0/backgroundAssetId` | Rain Bell front room | Front-room exploration | Counter, register, umbrella stand, wet door | Inside-front angle gives playable prop geometry after the exterior establish | keep | B | Retain front-room evidence surface | Accepted |
| `chapter_1/investigation_scene_3.json::/sublocations/1/backgroundAssetId` | Rain Bell back corridor | Sightline obstruction inquiry | L-turn, paper cups, cake boxes, fire door | Narrow corridor isolates the obstruction and changes depth direction | keep | B | Retain blocked-sightline view | Accepted |
| `chapter_1/investigation_scene_3.json::/sublocations/2/backgroundAssetId` | Rain Bell inner storage | Occlusion clue | High shelves, dust, sensor-light edge | Storage entrance further compresses the corridor and hides depth intentionally | keep | B | Retain occluded inner threshold | Accepted |
| `chapter_1/interrogation_scene_4.json::/intro/0/assetCue/backgroundAssetId` | Police waiting area | Pre-interrogation tension | Vending glow, bench, rain-dark windows | Waiting area separates anticipation from the actual questioning room | keep | B | Retain quiet institutional hold | Accepted |
| `chapter_1/interrogation_scene_4.json::/phases/0/backgroundAssetId` | Police interrogation room | Miyake questioning stage | Small table, hard lamps, rain-dark window | Room shift brings focus inward without requiring needless camera changes inside the phase | keep | B | Retain focused questioning view | Accepted |
| `chapter_1/scene_5.json::/queue/0/assetCue/backgroundAssetId` | Review-board hearing room | First formal hearing establish | Long table, sparse gallery, cool window light | Room-wide empty/neutral composition sets institutional scale | keep | B | Retain hearing-room establish | Accepted |
| `chapter_1/scene_5.json::/queue/29/assetCue/backgroundAssetId` | Review-board hearing room | Defense-side pressure | Same long table, officials across, pushed chair | Defense-side angle and chair state provide a meaningful in-room shift | keep | B | Retain defense perspective | Accepted |
| `chapter_1/scene_5.json::/queue/67/assetCue/backgroundAssetId` | Review-board hallway | Hearing aftermath | Fluorescent hall, damp marks, distant officers | Hallway exits the table geometry and releases the scene | keep | B | Retain procedural aftermath | Accepted |
| `chapter_1/scene_6.json::/queue/0/assetCue/backgroundAssetId` | Kichijoji awning | Rainy regroup establish | Awning roof, wet paving, storefront warmth | Broad covered street holds the pair outside the hearing environment | keep | B | Retain regrouping shelter | Accepted |
| `chapter_1/scene_6.json::/queue/22/assetCue/backgroundAssetId` | Kichijoji awning/recycling point | Umbrella-sleeve clue | Same awning, recycling bin, transparent umbrella cue | Prop focal shift makes the nearby repeated corner narratively useful | keep | B | Retain clue-focused corner angle | Accepted |
| `chapter_1/scene_6.json::/queue/26/assetCue/backgroundAssetId` | Convenience-store entrance | Witness movement beat | Store threshold, rain easing, commuter traffic | Entrance framing changes the corner into a visible movement corridor | keep | B | Retain threshold witness context | Accepted |
| `chapter_1/scene_6.json::/queue/31/assetCue/backgroundAssetId` | Kichijoji awning | Post-tension reset | Same awning, bin, cleaner reflections, brighter sky | Environmental state advances from rain pressure to clearing calm | keep | B | Retain weather-resolution beat | Accepted |
| `chapter_1/investigation_scene_7.json::/intro/0/assetCue/backgroundAssetId` | Rain Bell rear threshold | Re-entry establish | Back door, non-slip mat, wet alley | Threshold establishes the back route before hotspot inspection | keep | B | Retain rear-access overview | Accepted |
| `chapter_1/investigation_scene_7.json::/sublocations/0/backgroundAssetId` | Rain Bell rear threshold | Water-trace inspection | Same mat, sleeve, wet alley | Stable rear-door geometry is necessary for comparing the water state | keep | B | Retain trace-focused close exploration | Accepted |
| `chapter_1/investigation_scene_7.json::/sublocations/1/backgroundAssetId` | Rain Bell inner storage | Discovery reconstruction | Metal shelves, stopped clock, impact mark, sensor light | Cold storage palette and deeper view materially advance the re-entry path | keep | B | Retain reveal-capable storage view | Accepted |
| `chapter_1/investigation_scene_8.json::/intro/0/assetCue/backgroundAssetId` | Rain Bell manager-office corner | Maintenance-page establish | Warm lamp, boxes, account books, maintenance screen | Wide office-corner view gives the evidence chain a stable origin | keep | B | Retain evidence-location establish | Accepted |
| `chapter_1/investigation_scene_8.json::/sublocations/0/backgroundAssetId` | Rain Bell manager-office corner | Maintenance-screen exploration | Same screen, account books, boxes | Tighter office corner directs attention to the screen after the wide establish | keep | B | Retain readable exploration focal point | Accepted |
| `chapter_1/investigation_scene_8.json::/sublocations/1/backgroundAssetId` | Rain Bell fixed panel | Formal evidence capture | Same maintenance hardware, paperwork, harder light | State changes from discovery to documented chain-of-custody | keep | B | Retain formalized evidence state | Accepted |
| `chapter_1/analysis_scene_8_5.json::/intro/0/assetCue/backgroundAssetId` | Rain Bell fixed panel | Progress recap | Same maintenance hardware, evidence table, harder work light | Existing fixed-panel continuity keeps the analysis recap grounded in the evidence handoff | keep | B | Retain fixed-panel recap continuity | Accepted |
| `chapter_1/analysis_scene_8_5.json::/boards/0/common/resultDialogue/3/assetCue/backgroundAssetId` | Rain Bell fixed panel | Classify-to-order evidence handoff | Same maintenance hardware, evidence table, harder work light | Reusing the fixed-panel plate makes the board boundary a formalized evidence-state handoff without adding a raster | keep | B | Retain fixed-panel handoff boundary | Accepted; user-approved HPA-265 board boundary reuse |
| `chapter_1/investigation_scene_9.json::/intro/0/assetCue/backgroundAssetId` | KAGAMI contractor records office | Records-handoff establish | Glass window, file cabinets, reply packet, daylight | Wide service-window geometry establishes bureaucratic distance | keep | B | Retain constrained-records establish | Accepted |
| `chapter_1/investigation_scene_9.json::/sublocations/0/backgroundAssetId` | KAGAMI contractor service desk | Packet/detail exploration | Same partition, cabinets, limited packet | Desk-focused version preserves location continuity while isolating the responsive document surface | keep | B | Retain document-response focal point | Accepted |
| `chapter_1/investigation_scene_9.json::/sublocations/1/backgroundAssetId` | White interview room | Kitami confrontation | Plain walls, exposed fluorescent tubes, forensic sheets | Deliberate move away from the records counter gives confrontation a neutral pressure chamber | keep | B | Retain confrontation isolation | Accepted |
| `chapter_1/interrogation_scene_10.json::/intro/0/assetCue/backgroundAssetId` | KAGAMI final hearing | Final-review establish | Long table, cart, gallery, daylight | Broad formal room establishes the shared procedural arena | keep | B | Retain final-hearing overview | Accepted |
| `chapter_1/interrogation_scene_10.json::/phases/0/backgroundAssetId` | KAGAMI final hearing | Summary-versus-records opening | Same table, officials, case materials | First continuous phase changes the table focal object, not the room | keep | B | Retain uninterrupted hearing sightline | Accepted; same-view control |
| `chapter_1/interrogation_scene_10.json::/phases/1/backgroundAssetId` | KAGAMI final hearing | Limited-record authorization gate | Same table, presiding position, authorization form | Formal gate is legible as a state change through the centered authorization focus | keep | B | Retain uninterrupted hearing sightline | Accepted; same-view control |
| `chapter_1/interrogation_scene_10.json::/phases/2/backgroundAssetId` | KAGAMI final hearing | Doorlock-excerpt comparison | Same table, parallel record stacks, daylight | Parallel stacks give a new evidence relationship without breaking the hearing hold | keep | B | Retain uninterrupted hearing sightline | Accepted; same-view control |
| `chapter_1/interrogation_scene_10.json::/phases/3/backgroundAssetId` | KAGAMI final hearing | Final evidence-chain synthesis | Same table, work order, credential, memo, umbrella comparison | Culminating chain deliberately reuses the room while maximizing table-object contrast | keep | B | Retain uninterrupted hearing sightline | Accepted; same-view control |
| `chapter_1/interrogation_scene_10.json::/outro/dialogue/0/assetCue/backgroundAssetId` | KAGAMI final hearing | Formal ruling boundary | Same table, work order, credential, memo, umbrella comparison | Existing p5 plate carries the ruling without introducing a new hearing raster | keep | B | Retain final-hearing ruling boundary | Accepted; user-approved p5 plate reuse |
| `chapter_1/scene_11.json::/queue/0/assetCue/backgroundAssetId` | Rain Bell front room aftermath | Case-resolution cafe return | Half-reset tables, counter, wet windows, soft afternoon | Calm reopening reverses the closing-night palette and state | keep | B | Retain post-case emotional release | Accepted |
| `chapter_1/scene_11.json::/queue/32/assetCue/backgroundAssetId` | Rain Bell front room evidence hold | Latte-and-clock unresolved beat | Window table, latte cup, old clock with post-impact dial crack | Tighter table focus changes the cafe's function from social room to unresolved clue | keep | B | Retain clue-focused cafe hold | Accepted |
| `chapter_1/scene_11.json::/queue/41/assetCue/backgroundAssetId` | Rain Bell front room post-box hold | Clock-boxed closing beat | Counter without the clock, closed cardboard box in the corner, umbrella stand at frame edge | Post-box state cue keeps the authored boxing visually true instead of contradicting the counter-clock plate | keep | B | Retain post-box state cue | Accepted |
| `chapter_1/scene_11.json::/queue/45/assetCue/backgroundAssetId` | Soma office at night | USB discovery | Worn desk, lamp, laptop, rainy city window | First office-night plate introduces the new case object | keep | B | Retain USB focal reveal | Accepted |
| `chapter_1/scene_11.json::/queue/63/assetCue/backgroundAssetId` | Soma office at night | Transfer-list escalation | Same desk, laptop, practical lamp, added papers and phone | Same-view continuity is earned because the prop state visibly accumulates | keep | B | Retain evidence-accumulation hold | Accepted |
| `chapter_1/scene_11.json::/queue/69/assetCue/backgroundAssetId` | Rain Bell/news follow-up entrance | Lawful media bridge | Rain Bell entrance after rain, umbrella stand at the frame edge | Existing blue-umbrella exterior plate is reused for the legal public-media bridge; no private USB material shares the frame | keep | B | Retain public follow-up bridge | Accepted; existing tag_006 reuse |
| `chapter_1/scene_11.json::/queue/78/assetCue/backgroundAssetId` | Rain Bell exterior late night | Blue-umbrella coda | Dark storefront, wet street, umbrella stand | Exterior returns to the cafe with a new lone-object focal clue | keep | B | Retain final exterior mystery hook | Accepted; existing tag_006 reuse |

## Coverage result

The compiler-owned inventory contains **57** cue occurrences. This report has **57** decision rows with the exact current cue keys, no duplicates, no stale keys, and allowed decision/priority values. There are **0 Priority A** decisions; all retained decisions are B-priority. This structural pass adds the approved Scene 8.5 classify-to-order handoff, the Scene 10 ruling boundary, and the Scene 11 public-media bridge while reusing existing plates; it also recouples queue-index keys after the authored dialogue cuts.
