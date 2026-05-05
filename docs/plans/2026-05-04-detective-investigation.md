# Detective Investigation Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a playable investigation-only detective game slice with a Rust-owned case engine and Svelte workbench UI.

**Architecture:** Rust owns the embedded demo case, game state, unlock rules, and deduction validation, exposed through Tauri commands. Svelte owns only presentation state: selected tab, selected item, transient errors, and draft deduction answers. The app stays a SvelteKit SPA served by Tauri; no server routes, SSR, or filesystem access are required.

**Tech Stack:** Tauri 2, Rust 2021, serde, SvelteKit SPA, Svelte 5 runes, TypeScript, Bun.

---

## Context

Approved design spec: `docs/superpowers/specs/2026-05-04-detective-investigation-design.md`

Current scaffold:

- `src-tauri/src/lib.rs` contains only the starter `greet` command.
- `src/routes/+page.svelte` contains the starter Tauri/Svelte welcome screen.
- `src/routes/+layout.ts` already disables SSR and must stay that way.
- `src-tauri/Cargo.toml` already includes `serde` and `serde_json`.

Implementation rules:

- Keep all gameplay rules out of Svelte.
- Register every Tauri command in `tauri::generate_handler![...]`.
- Use Svelte 5 runes and event attributes like `onclick={...}`.
- Use `bun run check` for frontend verification.
- Use `cd src-tauri && cargo test` and `cd src-tauri && cargo check` for Rust verification.

---

### Task 1: Add Rust Engine Types And Initial Case State

**Files:**
- Create: `src-tauri/src/investigation.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create the engine module with serializable public state types**

Add `src-tauri/src/investigation.rs` with the initial types and state constructor:

```rust
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaseState {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub status: CaseStatus,
    pub scene: SceneState,
    pub characters: Vec<CharacterState>,
    pub evidence: Vec<EvidenceState>,
    pub statements: Vec<StatementState>,
    pub deduction_slots: Vec<DeductionSlotState>,
    pub last_feedback: Option<DeductionFeedback>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CaseStatus {
    Investigating,
    Solved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SceneState {
    pub title: String,
    pub description: String,
    pub hotspots: Vec<HotspotState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HotspotState {
    pub id: String,
    pub label: String,
    pub description: String,
    pub inspected: bool,
    pub locked: bool,
    pub locked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CharacterState {
    pub id: String,
    pub name: String,
    pub role: String,
    pub profile: String,
    pub topics: Vec<TopicState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TopicState {
    pub id: String,
    pub label: String,
    pub response: String,
    pub discussed: bool,
    pub locked: bool,
    pub locked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceState {
    pub id: String,
    pub label: String,
    pub description: String,
    pub detail: String,
    pub collected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatementState {
    pub id: String,
    pub speaker: String,
    pub text: String,
    pub discovered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeductionSlotState {
    pub id: String,
    pub prompt: String,
    pub candidate_answer_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeductionFeedback {
    pub complete: bool,
    pub solved: bool,
    pub message: String,
    pub slot_results: Vec<DeductionSlotResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeductionSlotResult {
    pub slot_id: String,
    pub correct: bool,
    pub guidance: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeductionAnswer {
    pub slot_id: String,
    pub answer_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvestigationError {
    pub code: String,
    pub message: String,
}

pub type InvestigationResult<T> = Result<T, InvestigationError>;

#[derive(Debug, Clone)]
pub struct InvestigationEngine {
    state: CaseState,
    hotspot_reveals: HashMap<String, Vec<Reveal>>,
    topic_reveals: HashMap<(String, String), Vec<Reveal>>,
    accepted_answers: HashMap<String, HashSet<String>>,
}

#[derive(Debug, Clone)]
enum Reveal {
    Evidence(&'static str),
    Statement(&'static str),
    Topic {
        character_id: &'static str,
        topic_id: &'static str,
    },
}

impl Default for InvestigationEngine {
    fn default() -> Self {
        Self::new_demo_case()
    }
}

impl InvestigationEngine {
    pub fn new_demo_case() -> Self {
        let state = CaseState {
            id: "demo-office".to_string(),
            title: "The Locked Study".to_string(),
            summary: "A mechanism-first demo case about reconstructing what happened in a private study.".to_string(),
            status: CaseStatus::Investigating,
            scene: SceneState {
                title: "Professor Vale's Study".to_string(),
                description: "A quiet study with a desk, a wall clock, and a locked balcony door.".to_string(),
                hotspots: vec![
                    HotspotState {
                        id: "desk".to_string(),
                        label: "Desk".to_string(),
                        description: "A writing desk with a fresh ink smear near the blotter.".to_string(),
                        inspected: false,
                        locked: false,
                        locked_reason: None,
                    },
                    HotspotState {
                        id: "clock".to_string(),
                        label: "Wall Clock".to_string(),
                        description: "The clock has stopped at 9:10.".to_string(),
                        inspected: false,
                        locked: false,
                        locked_reason: None,
                    },
                    HotspotState {
                        id: "balcony".to_string(),
                        label: "Balcony Door".to_string(),
                        description: "The balcony door is locked from the inside.".to_string(),
                        inspected: false,
                        locked: false,
                        locked_reason: None,
                    },
                ],
            },
            characters: vec![
                CharacterState {
                    id: "iris".to_string(),
                    name: "Iris Vale".to_string(),
                    role: "Assistant".to_string(),
                    profile: "The professor's assistant, calm but protective of the study.".to_string(),
                    topics: vec![
                        TopicState {
                            id: "timeline".to_string(),
                            label: "Her Timeline".to_string(),
                            response: "Iris says she delivered tea at 9:00 and returned when the alarm rang.".to_string(),
                            discussed: false,
                            locked: false,
                            locked_reason: None,
                        },
                        TopicState {
                            id: "ink".to_string(),
                            label: "Ink Smear".to_string(),
                            response: "Iris admits the professor used red ink only for urgent corrections.".to_string(),
                            discussed: false,
                            locked: true,
                            locked_reason: Some("Find a reason to ask about the desk.".to_string()),
                        },
                    ],
                },
                CharacterState {
                    id: "marlow".to_string(),
                    name: "Detective Marlow".to_string(),
                    role: "Investigator".to_string(),
                    profile: "The official investigator assigned to secure the room.".to_string(),
                    topics: vec![TopicState {
                        id: "door".to_string(),
                        label: "Locked Door".to_string(),
                        response: "Marlow confirms the balcony latch can only be set from inside the room.".to_string(),
                        discussed: false,
                        locked: true,
                        locked_reason: Some("Inspect the balcony door first.".to_string()),
                    }],
                },
            ],
            evidence: vec![
                EvidenceState {
                    id: "ink-smear".to_string(),
                    label: "Red Ink Smear".to_string(),
                    description: "Fresh red ink on the desk blotter.".to_string(),
                    detail: "The smear is still wet and points toward the stopped clock.".to_string(),
                    collected: false,
                },
                EvidenceState {
                    id: "stopped-clock".to_string(),
                    label: "Stopped Clock".to_string(),
                    description: "A wall clock stopped at 9:10.".to_string(),
                    detail: "The minute hand is bent, as if it was forced to stop.".to_string(),
                    collected: false,
                },
                EvidenceState {
                    id: "inside-latch".to_string(),
                    label: "Inside Latch".to_string(),
                    description: "The balcony latch was set from inside the study.".to_string(),
                    detail: "The door could not have been locked by someone standing outside.".to_string(),
                    collected: false,
                },
            ],
            statements: vec![
                StatementState {
                    id: "iris-tea".to_string(),
                    speaker: "Iris Vale".to_string(),
                    text: "I delivered tea at 9:00 and did not enter again until the alarm rang.".to_string(),
                    discovered: false,
                },
                StatementState {
                    id: "marlow-latch".to_string(),
                    speaker: "Detective Marlow".to_string(),
                    text: "The balcony latch can only be set from inside the room.".to_string(),
                    discovered: false,
                },
            ],
            deduction_slots: vec![
                DeductionSlotState {
                    id: "time-marker".to_string(),
                    prompt: "Which clue anchors the incident time?".to_string(),
                    candidate_answer_ids: vec![],
                },
                DeductionSlotState {
                    id: "locked-room".to_string(),
                    prompt: "Which clue explains why the room looked sealed?".to_string(),
                    candidate_answer_ids: vec![],
                },
                DeductionSlotState {
                    id: "key-statement".to_string(),
                    prompt: "Which statement conflicts with the physical clues?".to_string(),
                    candidate_answer_ids: vec![],
                },
            ],
            last_feedback: None,
        };

        let mut hotspot_reveals = HashMap::new();
        hotspot_reveals.insert(
            "desk".to_string(),
            vec![
                Reveal::Evidence("ink-smear"),
                Reveal::Topic {
                    character_id: "iris",
                    topic_id: "ink",
                },
            ],
        );
        hotspot_reveals.insert("clock".to_string(), vec![Reveal::Evidence("stopped-clock")]);
        hotspot_reveals.insert(
            "balcony".to_string(),
            vec![
                Reveal::Evidence("inside-latch"),
                Reveal::Topic {
                    character_id: "marlow",
                    topic_id: "door",
                },
            ],
        );

        let mut topic_reveals = HashMap::new();
        topic_reveals.insert(
            ("iris".to_string(), "timeline".to_string()),
            vec![Reveal::Statement("iris-tea")],
        );
        topic_reveals.insert(
            ("marlow".to_string(), "door".to_string()),
            vec![Reveal::Statement("marlow-latch")],
        );

        let mut accepted_answers = HashMap::new();
        accepted_answers.insert("time-marker".to_string(), HashSet::from(["stopped-clock".to_string()]));
        accepted_answers.insert("locked-room".to_string(), HashSet::from(["inside-latch".to_string()]));
        accepted_answers.insert("key-statement".to_string(), HashSet::from(["iris-tea".to_string()]));

        let mut engine = Self {
            state,
            hotspot_reveals,
            topic_reveals,
            accepted_answers,
        };
        engine.refresh_candidates();
        engine
    }

    pub fn state(&self) -> CaseState {
        self.state.clone()
    }

    fn refresh_candidates(&mut self) {
        let mut ids = Vec::new();
        ids.extend(
            self.state
                .evidence
                .iter()
                .filter(|item| item.collected)
                .map(|item| item.id.clone()),
        );
        ids.extend(
            self.state
                .statements
                .iter()
                .filter(|statement| statement.discovered)
                .map(|statement| statement.id.clone()),
        );

        for slot in &mut self.state.deduction_slots {
            slot.candidate_answer_ids = ids.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_demo_case_in_investigation_status() {
        let engine = InvestigationEngine::new_demo_case();

        let state = engine.state();

        assert_eq!(state.id, "demo-office");
        assert_eq!(state.status, CaseStatus::Investigating);
        assert_eq!(state.scene.hotspots.len(), 3);
        assert_eq!(state.characters.len(), 2);
        assert!(state.evidence.iter().all(|item| !item.collected));
        assert!(state.statements.iter().all(|statement| !statement.discovered));
    }
}
```

**Step 2: Wire the module into the library**

Modify `src-tauri/src/lib.rs`:

```rust
mod investigation;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
```

**Step 3: Run the initial Rust test**

Run:

```bash
cd src-tauri && cargo test investigation::tests::starts_demo_case_in_investigation_status
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/investigation.rs
git commit -m "feat: add investigation engine state"
```

---

### Task 2: Implement Hotspot Inspection And Unlock Rules

**Files:**
- Modify: `src-tauri/src/investigation.rs`

**Step 1: Add failing tests for scene inspection**

Add these tests in the existing `#[cfg(test)]` module:

```rust
#[test]
fn inspecting_hotspot_collects_evidence_and_unlocks_topic() {
    let mut engine = InvestigationEngine::new_demo_case();

    let state = engine.inspect_hotspot("desk").expect("desk should inspect");

    assert!(state.scene.hotspots.iter().find(|hotspot| hotspot.id == "desk").unwrap().inspected);
    assert!(state.evidence.iter().find(|item| item.id == "ink-smear").unwrap().collected);
    assert!(!state
        .characters
        .iter()
        .find(|character| character.id == "iris")
        .unwrap()
        .topics
        .iter()
        .find(|topic| topic.id == "ink")
        .unwrap()
        .locked);
    assert!(state
        .deduction_slots
        .iter()
        .all(|slot| slot.candidate_answer_ids.contains(&"ink-smear".to_string())));
}

#[test]
fn inspecting_unknown_hotspot_returns_typed_error() {
    let mut engine = InvestigationEngine::new_demo_case();

    let error = engine.inspect_hotspot("missing").unwrap_err();

    assert_eq!(error.code, "unknownHotspot");
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cd src-tauri && cargo test investigation::tests::inspecting_
```

Expected: FAIL because `inspect_hotspot` does not exist.

**Step 3: Implement hotspot inspection**

Add these methods inside `impl InvestigationEngine`:

```rust
pub fn inspect_hotspot(&mut self, hotspot_id: &str) -> InvestigationResult<CaseState> {
    let hotspot = self
        .state
        .scene
        .hotspots
        .iter_mut()
        .find(|hotspot| hotspot.id == hotspot_id)
        .ok_or_else(|| InvestigationError::new("unknownHotspot", "That scene detail does not exist."))?;

    if hotspot.locked {
        return Err(InvestigationError::new(
            "lockedHotspot",
            hotspot
                .locked_reason
                .as_deref()
                .unwrap_or("That scene detail is locked."),
        ));
    }

    hotspot.inspected = true;

    if let Some(reveals) = self.hotspot_reveals.get(hotspot_id).cloned() {
        self.apply_reveals(reveals);
    }
    self.refresh_candidates();

    Ok(self.state())
}

fn apply_reveals(&mut self, reveals: Vec<Reveal>) {
    for reveal in reveals {
        match reveal {
            Reveal::Evidence(evidence_id) => {
                if let Some(evidence) = self.state.evidence.iter_mut().find(|item| item.id == evidence_id) {
                    evidence.collected = true;
                }
            }
            Reveal::Statement(statement_id) => {
                if let Some(statement) = self
                    .state
                    .statements
                    .iter_mut()
                    .find(|statement| statement.id == statement_id)
                {
                    statement.discovered = true;
                }
            }
            Reveal::Topic {
                character_id,
                topic_id,
            } => {
                if let Some(topic) = self
                    .state
                    .characters
                    .iter_mut()
                    .find(|character| character.id == character_id)
                    .and_then(|character| character.topics.iter_mut().find(|topic| topic.id == topic_id))
                {
                    topic.locked = false;
                    topic.locked_reason = None;
                }
            }
        }
    }
}
```

Add this `InvestigationError` constructor outside the engine impl:

```rust
impl InvestigationError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
```

**Step 4: Run tests to verify they pass**

Run:

```bash
cd src-tauri && cargo test investigation::tests::inspecting_
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/investigation.rs
git commit -m "feat: inspect investigation hotspots"
```

---

### Task 3: Implement Interviews And Statement Reveals

**Files:**
- Modify: `src-tauri/src/investigation.rs`

**Step 1: Add failing tests for interviews**

Add:

```rust
#[test]
fn interviewing_available_topic_reveals_statement() {
    let mut engine = InvestigationEngine::new_demo_case();

    let state = engine
        .interview_character("iris", "timeline")
        .expect("timeline should be available");

    assert!(state
        .characters
        .iter()
        .find(|character| character.id == "iris")
        .unwrap()
        .topics
        .iter()
        .find(|topic| topic.id == "timeline")
        .unwrap()
        .discussed);
    assert!(state
        .statements
        .iter()
        .find(|statement| statement.id == "iris-tea")
        .unwrap()
        .discovered);
}

#[test]
fn interviewing_locked_topic_returns_typed_error() {
    let mut engine = InvestigationEngine::new_demo_case();

    let error = engine.interview_character("marlow", "door").unwrap_err();

    assert_eq!(error.code, "lockedTopic");
}

#[test]
fn unlocked_interview_topic_can_be_discussed() {
    let mut engine = InvestigationEngine::new_demo_case();
    engine.inspect_hotspot("balcony").unwrap();

    let state = engine.interview_character("marlow", "door").unwrap();

    assert!(state
        .statements
        .iter()
        .find(|statement| statement.id == "marlow-latch")
        .unwrap()
        .discovered);
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cd src-tauri && cargo test investigation::tests::interview
```

Expected: FAIL because `interview_character` does not exist.

**Step 3: Implement interviews**

Add inside `impl InvestigationEngine`:

```rust
pub fn interview_character(
    &mut self,
    character_id: &str,
    topic_id: &str,
) -> InvestigationResult<CaseState> {
    let character = self
        .state
        .characters
        .iter_mut()
        .find(|character| character.id == character_id)
        .ok_or_else(|| InvestigationError::new("unknownCharacter", "That person does not exist."))?;

    let topic = character
        .topics
        .iter_mut()
        .find(|topic| topic.id == topic_id)
        .ok_or_else(|| InvestigationError::new("unknownTopic", "That interview topic does not exist."))?;

    if topic.locked {
        return Err(InvestigationError::new(
            "lockedTopic",
            topic
                .locked_reason
                .as_deref()
                .unwrap_or("That interview topic is locked."),
        ));
    }

    topic.discussed = true;

    if let Some(reveals) = self
        .topic_reveals
        .get(&(character_id.to_string(), topic_id.to_string()))
        .cloned()
    {
        self.apply_reveals(reveals);
    }
    self.refresh_candidates();

    Ok(self.state())
}
```

**Step 4: Run tests to verify they pass**

Run:

```bash
cd src-tauri && cargo test investigation::tests
```

Expected: PASS for all investigation tests currently in the module.

**Step 5: Commit**

```bash
git add src-tauri/src/investigation.rs
git commit -m "feat: add investigation interviews"
```

---

### Task 4: Implement Deduction Submission

**Files:**
- Modify: `src-tauri/src/investigation.rs`

**Step 1: Add failing deduction tests**

Add:

```rust
fn prepare_complete_case() -> InvestigationEngine {
    let mut engine = InvestigationEngine::new_demo_case();
    engine.inspect_hotspot("desk").unwrap();
    engine.inspect_hotspot("clock").unwrap();
    engine.inspect_hotspot("balcony").unwrap();
    engine.interview_character("iris", "timeline").unwrap();
    engine.interview_character("marlow", "door").unwrap();
    engine
}

#[test]
fn incomplete_deduction_submission_returns_typed_error() {
    let mut engine = prepare_complete_case();

    let error = engine
        .submit_deduction(vec![DeductionAnswer {
            slot_id: "time-marker".to_string(),
            answer_id: "stopped-clock".to_string(),
        }])
        .unwrap_err();

    assert_eq!(error.code, "incompleteDeduction");
}

#[test]
fn blank_deduction_answers_count_as_incomplete() {
    let mut engine = prepare_complete_case();

    let error = engine
        .submit_deduction(vec![
            DeductionAnswer {
                slot_id: "time-marker".to_string(),
                answer_id: "stopped-clock".to_string(),
            },
            DeductionAnswer {
                slot_id: "locked-room".to_string(),
                answer_id: "".to_string(),
            },
            DeductionAnswer {
                slot_id: "key-statement".to_string(),
                answer_id: "iris-tea".to_string(),
            },
        ])
        .unwrap_err();

    assert_eq!(error.code, "incompleteDeduction");
}

#[test]
fn wrong_complete_deduction_returns_feedback_without_solving_case() {
    let mut engine = prepare_complete_case();

    let feedback = engine
        .submit_deduction(vec![
            DeductionAnswer {
                slot_id: "time-marker".to_string(),
                answer_id: "inside-latch".to_string(),
            },
            DeductionAnswer {
                slot_id: "locked-room".to_string(),
                answer_id: "stopped-clock".to_string(),
            },
            DeductionAnswer {
                slot_id: "key-statement".to_string(),
                answer_id: "marlow-latch".to_string(),
            },
        ])
        .unwrap();

    assert!(feedback.complete);
    assert!(!feedback.solved);
    assert!(feedback.slot_results.iter().any(|result| !result.correct));
    assert_eq!(engine.state().status, CaseStatus::Investigating);
}

#[test]
fn correct_complete_deduction_solves_case() {
    let mut engine = prepare_complete_case();

    let feedback = engine
        .submit_deduction(vec![
            DeductionAnswer {
                slot_id: "time-marker".to_string(),
                answer_id: "stopped-clock".to_string(),
            },
            DeductionAnswer {
                slot_id: "locked-room".to_string(),
                answer_id: "inside-latch".to_string(),
            },
            DeductionAnswer {
                slot_id: "key-statement".to_string(),
                answer_id: "iris-tea".to_string(),
            },
        ])
        .unwrap();

    assert!(feedback.complete);
    assert!(feedback.solved);
    assert!(feedback.slot_results.iter().all(|result| result.correct));
    assert_eq!(engine.state().status, CaseStatus::Solved);
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cd src-tauri && cargo test investigation::tests
```

Expected: FAIL because `submit_deduction` does not exist.

**Step 3: Implement deduction validation**

Add inside `impl InvestigationEngine`:

```rust
pub fn submit_deduction(
    &mut self,
    answers: Vec<DeductionAnswer>,
) -> InvestigationResult<DeductionFeedback> {
    let slot_ids: HashSet<String> = self
        .state
        .deduction_slots
        .iter()
        .map(|slot| slot.id.clone())
        .collect();

    let mut answer_by_slot = HashMap::new();
    for answer in answers {
        if !slot_ids.contains(&answer.slot_id) {
            return Err(InvestigationError::new(
                "unknownSlot",
                "That deduction slot does not exist.",
            ));
        }

        if answer.answer_id.trim().is_empty() {
            continue;
        }

        if answer_by_slot
            .insert(answer.slot_id.clone(), answer.answer_id.clone())
            .is_some()
        {
            return Err(InvestigationError::new(
                "duplicateSlotAnswer",
                "Each deduction slot can only be answered once.",
            ));
        }
    }

    if answer_by_slot.len() != slot_ids.len() {
        return Err(InvestigationError::new(
            "incompleteDeduction",
            "Fill every deduction slot before submitting the theory.",
        ));
    }

    let available_answer_ids: HashSet<String> = self
        .state
        .evidence
        .iter()
        .filter(|item| item.collected)
        .map(|item| item.id.clone())
        .chain(
            self.state
                .statements
                .iter()
                .filter(|statement| statement.discovered)
                .map(|statement| statement.id.clone()),
        )
        .collect();

    let mut slot_results = Vec::new();
    for slot in &self.state.deduction_slots {
        let answer_id = answer_by_slot
            .get(&slot.id)
            .expect("completeness already checked");

        if !available_answer_ids.contains(answer_id) {
            return Err(InvestigationError::new(
                "unknownAnswer",
                "That clue is not available for deduction.",
            ));
        }

        let correct = self
            .accepted_answers
            .get(&slot.id)
            .is_some_and(|accepted| accepted.contains(answer_id));

        slot_results.push(DeductionSlotResult {
            slot_id: slot.id.clone(),
            correct,
            guidance: if correct {
                "This part of the theory fits the record.".to_string()
            } else {
                "Recheck the collected evidence and statements for this prompt.".to_string()
            },
        });
    }

    let solved = slot_results.iter().all(|result| result.correct);
    if solved {
        self.state.status = CaseStatus::Solved;
    }

    let feedback = DeductionFeedback {
        complete: true,
        solved,
        message: if solved {
            "Theory accepted. The study mystery is reconstructed.".to_string()
        } else {
            "The theory has gaps. Revise the marked slots and submit again.".to_string()
        },
        slot_results,
    };

    self.state.last_feedback = Some(feedback.clone());
    Ok(feedback)
}
```

If `is_some_and` is unavailable in the local Rust toolchain, replace that expression with:

```rust
.map(|accepted| accepted.contains(answer_id))
.unwrap_or(false)
```

**Step 4: Run deduction tests**

Run:

```bash
cd src-tauri && cargo test investigation::tests
```

Expected: PASS for all investigation tests currently in the module.

**Step 5: Run all Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src-tauri/src/investigation.rs
git commit -m "feat: validate deduction theories"
```

---

### Task 5: Expose The Engine Through Tauri Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/investigation.rs`

**Step 1: Make command-facing types public**

Confirm these types are `pub` in `src-tauri/src/investigation.rs`:

```rust
pub struct InvestigationEngine;
pub struct CaseState;
pub struct DeductionAnswer;
pub struct DeductionFeedback;
pub struct InvestigationError;
pub type InvestigationResult<T> = Result<T, InvestigationError>;
```

**Step 2: Replace the starter command setup**

Modify `src-tauri/src/lib.rs` to manage the engine and expose commands:

```rust
mod investigation;

use investigation::{
    CaseState, DeductionAnswer, DeductionFeedback, InvestigationEngine, InvestigationError,
};
use std::sync::Mutex;

struct AppState {
    engine: Mutex<InvestigationEngine>,
}

#[tauri::command]
fn start_case(state: tauri::State<'_, AppState>) -> Result<CaseState, InvestigationError> {
    let mut engine = state.engine.lock().map_err(|_| InvestigationError {
        code: "stateUnavailable".to_string(),
        message: "The case engine is unavailable.".to_string(),
    })?;
    *engine = InvestigationEngine::new_demo_case();
    Ok(engine.state())
}

#[tauri::command]
fn get_case_state(state: tauri::State<'_, AppState>) -> Result<CaseState, InvestigationError> {
    let engine = state.engine.lock().map_err(|_| InvestigationError {
        code: "stateUnavailable".to_string(),
        message: "The case engine is unavailable.".to_string(),
    })?;
    Ok(engine.state())
}

#[tauri::command]
fn inspect_hotspot(
    state: tauri::State<'_, AppState>,
    hotspot_id: String,
) -> Result<CaseState, InvestigationError> {
    let mut engine = state.engine.lock().map_err(|_| InvestigationError {
        code: "stateUnavailable".to_string(),
        message: "The case engine is unavailable.".to_string(),
    })?;
    engine.inspect_hotspot(&hotspot_id)
}

#[tauri::command]
fn interview_character(
    state: tauri::State<'_, AppState>,
    character_id: String,
    topic_id: String,
) -> Result<CaseState, InvestigationError> {
    let mut engine = state.engine.lock().map_err(|_| InvestigationError {
        code: "stateUnavailable".to_string(),
        message: "The case engine is unavailable.".to_string(),
    })?;
    engine.interview_character(&character_id, &topic_id)
}

#[tauri::command]
fn submit_deduction(
    state: tauri::State<'_, AppState>,
    answers: Vec<DeductionAnswer>,
) -> Result<DeductionFeedback, InvestigationError> {
    let mut engine = state.engine.lock().map_err(|_| InvestigationError {
        code: "stateUnavailable".to_string(),
        message: "The case engine is unavailable.".to_string(),
    })?;
    engine.submit_deduction(answers)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            engine: Mutex::new(InvestigationEngine::new_demo_case()),
        })
        .invoke_handler(tauri::generate_handler![
            start_case,
            get_case_state,
            inspect_hotspot,
            interview_character,
            submit_deduction,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Remove the starter `greet` command.

**Step 3: Run Rust verification**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

Run:

```bash
cd src-tauri && cargo check
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/investigation.rs
git commit -m "feat: expose investigation tauri commands"
```

---

### Task 6: Replace The Starter Screen With Frontend State And Command Wiring

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Replace the script with typed command state**

Replace the starter script in `src/routes/+page.svelte` with:

```svelte
<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  type CaseStatus = "Investigating" | "Solved";

  type CaseState = {
    id: string;
    title: string;
    summary: string;
    status: CaseStatus;
    scene: SceneState;
    characters: CharacterState[];
    evidence: EvidenceState[];
    statements: StatementState[];
    deductionSlots: DeductionSlotState[];
    lastFeedback: DeductionFeedback | null;
  };

  type SceneState = {
    title: string;
    description: string;
    hotspots: HotspotState[];
  };

  type HotspotState = {
    id: string;
    label: string;
    description: string;
    inspected: boolean;
    locked: boolean;
    lockedReason: string | null;
  };

  type CharacterState = {
    id: string;
    name: string;
    role: string;
    profile: string;
    topics: TopicState[];
  };

  type TopicState = {
    id: string;
    label: string;
    response: string;
    discussed: boolean;
    locked: boolean;
    lockedReason: string | null;
  };

  type EvidenceState = {
    id: string;
    label: string;
    description: string;
    detail: string;
    collected: boolean;
  };

  type StatementState = {
    id: string;
    speaker: string;
    text: string;
    discovered: boolean;
  };

  type DeductionSlotState = {
    id: string;
    prompt: string;
    candidateAnswerIds: string[];
  };

  type DeductionAnswer = {
    slotId: string;
    answerId: string;
  };

  type DeductionFeedback = {
    complete: boolean;
    solved: boolean;
    message: string;
    slotResults: DeductionSlotResult[];
  };

  type DeductionSlotResult = {
    slotId: string;
    correct: boolean;
    guidance: string;
  };

  type InvestigationError = {
    code: string;
    message: string;
  };

  type Tab = "scene" | "people" | "evidence" | "deduction";

  let caseState = $state<CaseState | null>(null);
  let activeTab = $state<Tab>("scene");
  let selectedEvidenceId = $state<string | null>(null);
  let selectedCharacterId = $state<string | null>(null);
  let draftAnswers = $state<Record<string, string>>({});
  let errorMessage = $state<string | null>(null);
  let loading = $state(true);

  const tabs: { id: Tab; label: string }[] = [
    { id: "scene", label: "Scene" },
    { id: "people", label: "People" },
    { id: "evidence", label: "Evidence" },
    { id: "deduction", label: "Deduction Board" },
  ];

  const collectedEvidence = $derived(caseState?.evidence.filter((item) => item.collected) ?? []);
  const discoveredStatements = $derived(
    caseState?.statements.filter((statement) => statement.discovered) ?? [],
  );
  const answerOptions = $derived([
    ...collectedEvidence.map((item) => ({
      id: item.id,
      label: item.label,
      detail: item.description,
      kind: "Evidence",
    })),
    ...discoveredStatements.map((statement) => ({
      id: statement.id,
      label: `${statement.speaker}: ${statement.text}`,
      detail: statement.text,
      kind: "Statement",
    })),
  ]);

  onMount(() => {
    void startCase();
  });

  async function runCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
    errorMessage = null;
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      errorMessage = normalizeError(error);
      return null;
    }
  }

  function normalizeError(error: unknown): string {
    if (typeof error === "object" && error !== null && "message" in error) {
      return String((error as InvestigationError).message);
    }
    return String(error);
  }

  async function startCase() {
    loading = true;
    const state = await runCommand<CaseState>("start_case");
    if (state) {
      caseState = state;
      draftAnswers = {};
      selectedEvidenceId = null;
      selectedCharacterId = state.characters[0]?.id ?? null;
    }
    loading = false;
  }
</script>
```

**Step 2: Add a temporary markup shell**

Replace the starter markup with:

```svelte
{#if loading}
  <main class="app-shell">
    <p class="status-line">Loading case...</p>
  </main>
{:else if caseState}
  <main class="app-shell">
    <header class="case-header">
      <div>
        <p class="eyebrow">Investigation</p>
        <h1>{caseState.title}</h1>
        <p>{caseState.summary}</p>
      </div>
      <button type="button" class="secondary-action" onclick={startCase}>Reset Case</button>
    </header>

    {#if errorMessage}
      <p class="error-banner">{errorMessage}</p>
    {/if}

    <nav class="tabs" aria-label="Case sections">
      {#each tabs as tab}
        <button
          type="button"
          class:active={activeTab === tab.id}
          onclick={() => (activeTab = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </nav>

    <section class="workbench">
      <p class="status-line">Workbench wiring complete. Tab content comes next.</p>
    </section>
  </main>
{/if}
```

**Step 3: Add minimal base styles**

Replace the starter styles with:

```svelte
<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    color: #1d2430;
    background: #eef1f4;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  button,
  select {
    font: inherit;
  }

  button {
    cursor: pointer;
  }

  .app-shell {
    min-height: 100vh;
    padding: 24px;
  }

  .case-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin: 0 auto 18px;
    max-width: 1180px;
  }

  .case-header h1 {
    margin: 0;
    font-size: 2rem;
    line-height: 1.15;
  }

  .case-header p {
    margin: 8px 0 0;
    max-width: 720px;
    color: #536170;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: #7c2d12;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .secondary-action,
  .tabs button {
    border: 1px solid #b8c0ca;
    border-radius: 7px;
    background: #ffffff;
    color: #1d2430;
    padding: 0.7rem 0.9rem;
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin: 0 auto 14px;
    max-width: 1180px;
    overflow-x: auto;
  }

  .tabs button.active {
    border-color: #7c2d12;
    background: #7c2d12;
    color: #ffffff;
  }

  .workbench {
    margin: 0 auto;
    max-width: 1180px;
    min-height: 420px;
    border: 1px solid #c7d0da;
    border-radius: 8px;
    background: #ffffff;
    padding: 18px;
  }

  .status-line {
    color: #536170;
  }

  .error-banner {
    margin: 0 auto 14px;
    max-width: 1180px;
    border: 1px solid #dc2626;
    border-radius: 7px;
    background: #fef2f2;
    color: #991b1b;
    padding: 0.75rem 0.9rem;
  }

  @media (max-width: 760px) {
    .app-shell {
      padding: 16px;
    }

    .case-header {
      display: block;
    }

    .secondary-action {
      margin-top: 14px;
    }
  }
</style>
```

**Step 4: Run frontend check**

Run:

```bash
bun run check
```

Expected: PASS. If Svelte reports unused types or variables, remove them only if the next task does not immediately use them.

**Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: wire investigation frontend state"
```

---

### Task 7: Build Scene, People, And Evidence Tabs

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Add command handlers below `startCase`**

```ts
async function inspectHotspot(hotspotId: string) {
  const state = await runCommand<CaseState>("inspect_hotspot", { hotspotId });
  if (state) {
    caseState = state;
  }
}

async function interviewCharacter(characterId: string, topicId: string) {
  const state = await runCommand<CaseState>("interview_character", { characterId, topicId });
  if (state) {
    caseState = state;
  }
}
```

**Step 2: Add selected item derived values**

Add near the existing `$derived` declarations:

```ts
const selectedCharacter = $derived(
  caseState?.characters.find((character) => character.id === selectedCharacterId) ??
    caseState?.characters[0] ??
    null,
);
const selectedEvidence = $derived(
  collectedEvidence.find((item) => item.id === selectedEvidenceId) ?? collectedEvidence[0] ?? null,
);
```

**Step 3: Replace temporary workbench content with tab sections**

Replace the `<section class="workbench">...</section>` content:

```svelte
<section class="workbench">
  {#if activeTab === "scene"}
    <div class="panel-grid">
      <section class="main-panel" aria-labelledby="scene-title">
        <h2 id="scene-title">{caseState.scene.title}</h2>
        <p>{caseState.scene.description}</p>
        <div class="hotspot-grid">
          {#each caseState.scene.hotspots as hotspot}
            <button
              type="button"
              class="hotspot"
              class:complete={hotspot.inspected}
              disabled={hotspot.locked}
              onclick={() => inspectHotspot(hotspot.id)}
            >
              <span>{hotspot.label}</span>
              <small>{hotspot.inspected ? "Inspected" : (hotspot.lockedReason ?? "Inspect")}</small>
            </button>
          {/each}
        </div>
      </section>

      <aside class="side-panel">
        <h3>Collected</h3>
        <p>{collectedEvidence.length} evidence items</p>
        <p>{discoveredStatements.length} statements</p>
      </aside>
    </div>
  {:else if activeTab === "people"}
    <div class="panel-grid">
      <section class="list-panel" aria-label="People">
        {#each caseState.characters as character}
          <button
            type="button"
            class="list-row"
            class:active={selectedCharacter?.id === character.id}
            onclick={() => (selectedCharacterId = character.id)}
          >
            <strong>{character.name}</strong>
            <span>{character.role}</span>
          </button>
        {/each}
      </section>

      {#if selectedCharacter}
        <section class="main-panel">
          <h2>{selectedCharacter.name}</h2>
          <p class="muted">{selectedCharacter.role}</p>
          <p>{selectedCharacter.profile}</p>
          <div class="topic-list">
            {#each selectedCharacter.topics as topic}
              <button
                type="button"
                class="topic"
                class:complete={topic.discussed}
                disabled={topic.locked}
                onclick={() => interviewCharacter(selectedCharacter.id, topic.id)}
              >
                <span>{topic.label}</span>
                <small>{topic.locked ? topic.lockedReason : topic.discussed ? "Discussed" : "Ask"}</small>
              </button>
              {#if topic.discussed}
                <p class="response">{topic.response}</p>
              {/if}
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {:else if activeTab === "evidence"}
    <div class="panel-grid">
      <section class="list-panel" aria-label="Evidence">
        {#each collectedEvidence as item}
          <button
            type="button"
            class="list-row"
            class:active={selectedEvidence?.id === item.id}
            onclick={() => (selectedEvidenceId = item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        {:else}
          <p class="muted">No evidence collected yet.</p>
        {/each}
      </section>

      <section class="main-panel">
        {#if selectedEvidence}
          <h2>{selectedEvidence.label}</h2>
          <p>{selectedEvidence.description}</p>
          <p class="response">{selectedEvidence.detail}</p>
        {:else}
          <h2>Evidence</h2>
          <p class="muted">Inspect the scene to collect evidence.</p>
        {/if}

        <h3>Known Statements</h3>
        <div class="statement-list">
          {#each discoveredStatements as statement}
            <p><strong>{statement.speaker}:</strong> {statement.text}</p>
          {:else}
            <p class="muted">No statements discovered yet.</p>
          {/each}
        </div>
      </section>
    </div>
  {/if}
</section>
```

**Step 4: Add supporting styles**

Add before the media query:

```css
.panel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
}

.main-panel,
.side-panel,
.list-panel {
  min-width: 0;
}

.main-panel h2,
.side-panel h3 {
  margin: 0 0 8px;
}

.main-panel p,
.side-panel p {
  color: #536170;
}

.hotspot-grid,
.topic-list,
.statement-list {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.hotspot,
.topic,
.list-row {
  width: 100%;
  border: 1px solid #c7d0da;
  border-radius: 7px;
  background: #f8fafc;
  color: #1d2430;
  padding: 0.85rem;
  text-align: left;
}

.hotspot,
.topic {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.hotspot.complete,
.topic.complete {
  border-color: #15803d;
  background: #f0fdf4;
}

.hotspot:disabled,
.topic:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.list-panel {
  display: grid;
  align-content: start;
  gap: 8px;
}

.list-row {
  display: grid;
  gap: 4px;
}

.list-row.active {
  border-color: #7c2d12;
  background: #fff7ed;
}

.list-row span,
.hotspot small,
.topic small,
.muted {
  color: #64748b;
}

.response {
  border-left: 3px solid #7c2d12;
  background: #fff7ed;
  padding: 0.75rem 0.9rem;
}
```

Add inside the existing `@media (max-width: 760px)` block:

```css
.panel-grid {
  grid-template-columns: 1fr;
}
```

**Step 5: Run frontend check**

Run:

```bash
bun run check
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: build investigation workbench tabs"
```

---

### Task 8: Build The Deduction Board UI

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Add deduction helpers**

Add below the command handlers:

```ts
async function submitDeduction() {
  if (!caseState) return;

  const answers: DeductionAnswer[] = caseState.deductionSlots.map((slot) => ({
    slotId: slot.id,
    answerId: draftAnswers[slot.id] ?? "",
  }));

  const feedback = await runCommand<DeductionFeedback>("submit_deduction", { answers });
  if (feedback) {
    caseState = {
      ...caseState,
      status: feedback.solved ? "Solved" : caseState.status,
      lastFeedback: feedback,
    };
  }
}

function feedbackForSlot(slotId: string): DeductionSlotResult | null {
  return caseState?.lastFeedback?.slotResults.find((result) => result.slotId === slotId) ?? null;
}

function optionLabel(answerId: string): string {
  return answerOptions.find((option) => option.id === answerId)?.label ?? "Unknown clue";
}
```

**Step 2: Add the deduction tab branch**

Add this branch after the `Evidence` tab branch:

```svelte
{:else if activeTab === "deduction"}
  <div class="panel-grid">
    <section class="main-panel">
      <h2>Deduction Board</h2>
      <p>Fill every prompt with collected evidence or known statements, then submit the full theory.</p>

      <div class="deduction-list">
        {#each caseState.deductionSlots as slot}
          {@const result = feedbackForSlot(slot.id)}
          <label class="deduction-slot" class:correct={result?.correct} class:incorrect={result && !result.correct}>
            <span>{slot.prompt}</span>
            <select bind:value={draftAnswers[slot.id]}>
              <option value="">Choose a clue</option>
              {#each answerOptions.filter((option) => slot.candidateAnswerIds.includes(option.id)) as option}
                <option value={option.id}>{option.kind}: {option.label}</option>
              {/each}
            </select>
            {#if result}
              <small>{result.guidance}</small>
            {/if}
          </label>
        {/each}
      </div>

      <button type="button" class="primary-action" onclick={submitDeduction}>
        Submit Theory
      </button>
    </section>

    <aside class="side-panel">
      <h3>Available Clues</h3>
      {#each answerOptions as option}
        <p><strong>{option.kind}:</strong> {option.label}</p>
      {:else}
        <p class="muted">Collect evidence and statements before building a theory.</p>
      {/each}

      {#if caseState.lastFeedback}
        <h3>Last Theory</h3>
        <p>{caseState.lastFeedback.message}</p>
        {#each Object.entries(draftAnswers) as [slotId, answerId]}
          {#if answerId}
            <p class="muted">{slotId}: {optionLabel(answerId)}</p>
          {/if}
        {/each}
      {/if}
    </aside>
  </div>
```

**Step 3: Add deduction styles**

Add before the media query:

```css
.deduction-list {
  display: grid;
  gap: 12px;
  margin: 18px 0;
}

.deduction-slot {
  display: grid;
  gap: 8px;
  border: 1px solid #c7d0da;
  border-radius: 7px;
  background: #f8fafc;
  padding: 0.9rem;
}

.deduction-slot.correct {
  border-color: #15803d;
  background: #f0fdf4;
}

.deduction-slot.incorrect {
  border-color: #dc2626;
  background: #fef2f2;
}

.deduction-slot span {
  font-weight: 700;
}

.deduction-slot select {
  width: 100%;
  border: 1px solid #b8c0ca;
  border-radius: 7px;
  background: #ffffff;
  color: #1d2430;
  padding: 0.75rem;
}

.deduction-slot small {
  color: #536170;
}

.primary-action {
  border: 1px solid #7c2d12;
  border-radius: 7px;
  background: #7c2d12;
  color: #ffffff;
  padding: 0.8rem 1rem;
}
```

**Step 4: Run frontend check**

Run:

```bash
bun run check
```

Expected: PASS. If Svelte rejects `bind:value={draftAnswers[slot.id]}`, replace the select handler with:

```svelte
<select
  value={draftAnswers[slot.id] ?? ""}
  onchange={(event) => {
    draftAnswers = {
      ...draftAnswers,
      [slot.id]: event.currentTarget.value,
    };
  }}
>
```

**Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: add deduction board"
```

---

### Task 9: Polish Layout, Empty States, And Solved Status

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Show solved/investigating state in the header**

Add this inside `.case-header`, near the reset button:

```svelte
<div class="header-actions">
  <span class:solved={caseState.status === "Solved"}>{caseState.status}</span>
  <button type="button" class="secondary-action" onclick={startCase}>Reset Case</button>
</div>
```

Remove the previous standalone reset button.

**Step 2: Add header action styles**

```css
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-actions span {
  border: 1px solid #c7d0da;
  border-radius: 999px;
  background: #ffffff;
  color: #536170;
  padding: 0.45rem 0.7rem;
  font-size: 0.85rem;
  font-weight: 700;
}

.header-actions span.solved {
  border-color: #15803d;
  color: #15803d;
}
```

Update the mobile media block:

```css
.header-actions {
  align-items: flex-start;
  flex-direction: column;
  margin-top: 14px;
}
```

**Step 3: Confirm empty states**

Manually verify the UI text covers:

- Loading before `start_case` returns.
- No evidence collected.
- No statements discovered.
- No deduction options available.
- Locked topics with visible disabled reason.
- Wrong deduction feedback.
- Solved deduction feedback.

If any of these are missing, add concise visible text in the relevant branch.

**Step 4: Run frontend check**

Run:

```bash
bun run check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "style: polish investigation workbench"
```

---

### Task 10: Full Verification And Manual Playthrough

**Files:**
- No planned file changes unless verification exposes bugs.

**Step 1: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

**Step 2: Run Rust check**

Run:

```bash
cd src-tauri && cargo check
```

Expected: PASS.

**Step 3: Run frontend check**

Run:

```bash
bun run check
```

Expected: PASS.

**Step 4: Start the Tauri app**

Run:

```bash
bun run tauri dev
```

Expected: Vite starts on port 1420 and the Tauri desktop window opens.

**Step 5: Manual playthrough**

In the desktop app:

1. Confirm the app opens directly to the investigation workbench.
2. Inspect `Desk`, `Wall Clock`, and `Balcony Door`.
3. Confirm `Red Ink Smear`, `Stopped Clock`, and `Inside Latch` appear in evidence.
4. Interview Iris about `Her Timeline`.
5. Confirm Iris's `Ink Smear` topic unlocks after desk inspection.
6. Interview Detective Marlow about `Locked Door` after balcony inspection.
7. Open `Deduction Board`.
8. Submit an incomplete theory and confirm the inline incomplete error.
9. Submit a wrong complete theory and confirm per-slot feedback appears only after submission.
10. Submit the correct theory:
    - `Which clue anchors the incident time?` -> `Stopped Clock`
    - `Which clue explains why the room looked sealed?` -> `Inside Latch`
    - `Which statement conflicts with the physical clues?` -> `Iris Vale: I delivered tea at 9:00...`
11. Confirm the case status changes to `Solved`.

**Step 6: Stop the dev server**

Stop `bun run tauri dev` with `Ctrl-C`. Do not leave the session running.

**Step 7: Commit fixes only if verification required changes**

If bug fixes were needed:

```bash
git add src-tauri/src/investigation.rs src-tauri/src/lib.rs src/routes/+page.svelte
git commit -m "fix: stabilize investigation playthrough"
```

Expected: commit includes only verification fixes.

---

## Final Acceptance Criteria

- The scaffold welcome screen is gone.
- The app opens to a playable investigation workbench.
- Rust owns case state, unlock rules, and deduction validation.
- Svelte renders state and never stores answer keys.
- Scene inspection can collect evidence and unlock topics.
- Interviews can reveal statements.
- Deduction feedback appears only after full-theory submission.
- Wrong submissions are recoverable.
- Correct submission marks the case solved.
- `cd src-tauri && cargo test` passes.
- `cd src-tauri && cargo check` passes.
- `bun run check` passes.
- Manual `bun run tauri dev` playthrough confirms the loop.
