use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaseStatus {
    Investigating,
    Solved,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneState {
    pub title: String,
    pub description: String,
    pub hotspots: Vec<HotspotState>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotState {
    pub id: String,
    pub label: String,
    pub description: String,
    pub inspected: bool,
    pub locked: bool,
    pub locked_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterState {
    pub id: String,
    pub name: String,
    pub role: String,
    pub profile: String,
    pub topics: Vec<TopicState>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicState {
    pub id: String,
    pub label: String,
    pub response: String,
    pub discussed: bool,
    pub locked: bool,
    pub locked_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceState {
    pub id: String,
    pub label: String,
    pub description: String,
    pub detail: String,
    pub collected: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementState {
    pub id: String,
    pub speaker: String,
    pub text: String,
    pub discovered: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeductionSlotState {
    pub id: String,
    pub prompt: String,
    pub candidate_answer_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeductionFeedback {
    pub complete: bool,
    pub solved: bool,
    pub message: String,
    pub slot_results: Vec<DeductionSlotResult>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeductionSlotResult {
    pub slot_id: String,
    pub correct: bool,
    pub guidance: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeductionAnswer {
    pub slot_id: String,
    pub answer_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestigationError {
    pub code: String,
    pub message: String,
}

impl InvestigationError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

pub type InvestigationResult<T> = Result<T, InvestigationError>;

#[derive(Clone, Debug)]
enum Reveal {
    Evidence(String),
    Statement(String),
    Topic {
        character_id: String,
        topic_id: String,
    },
}

#[derive(Clone, Debug)]
pub struct InvestigationEngine {
    state: CaseState,
    hotspot_reveals: HashMap<String, Vec<Reveal>>,
    topic_reveals: HashMap<(String, String), Vec<Reveal>>,
    accepted_answers: HashMap<String, HashSet<String>>,
}

impl InvestigationEngine {
    pub fn new_demo_case() -> Self {
        let mut engine = Self {
            state: CaseState {
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
                        profile: "The professor's assistant, calm but protective of the study."
                            .to_string(),
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
                        detail: "The smear is still wet and points toward the stopped clock."
                            .to_string(),
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
                        detail: "The door could not have been locked by someone standing outside."
                            .to_string(),
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
                        candidate_answer_ids: Vec::new(),
                    },
                    DeductionSlotState {
                        id: "locked-room".to_string(),
                        prompt: "Which clue explains why the room looked sealed?".to_string(),
                        candidate_answer_ids: Vec::new(),
                    },
                    DeductionSlotState {
                        id: "key-statement".to_string(),
                        prompt: "Which statement conflicts with the physical clues?".to_string(),
                        candidate_answer_ids: Vec::new(),
                    },
                ],
                last_feedback: None,
            },
            hotspot_reveals: HashMap::from([
                ("desk".to_string(), vec![
                    Reveal::Evidence("ink-smear".to_string()),
                    Reveal::Topic {
                        character_id: "iris".to_string(),
                        topic_id: "ink".to_string(),
                    },
                ]),
                ("clock".to_string(), vec![Reveal::Evidence("stopped-clock".to_string())]),
                ("balcony".to_string(), vec![
                    Reveal::Evidence("inside-latch".to_string()),
                    Reveal::Topic {
                        character_id: "marlow".to_string(),
                        topic_id: "door".to_string(),
                    },
                ]),
            ]),
            topic_reveals: HashMap::from([
                (
                    ("iris".to_string(), "timeline".to_string()),
                    vec![Reveal::Statement("iris-tea".to_string())],
                ),
                (
                    ("marlow".to_string(), "door".to_string()),
                    vec![Reveal::Statement("marlow-latch".to_string())],
                ),
            ]),
            accepted_answers: HashMap::from([
                (
                    "time-marker".to_string(),
                    HashSet::from(["stopped-clock".to_string()]),
                ),
                (
                    "locked-room".to_string(),
                    HashSet::from(["inside-latch".to_string()]),
                ),
                (
                    "key-statement".to_string(),
                    HashSet::from(["iris-tea".to_string()]),
                ),
            ]),
        };

        engine.refresh_candidates();
        engine
    }

    pub fn state(&self) -> CaseState {
        self.state.clone()
    }

    pub fn inspect_hotspot(&mut self, hotspot_id: &str) -> InvestigationResult<CaseState> {
        let hotspot = self
            .state
            .scene
            .hotspots
            .iter_mut()
            .find(|hotspot| hotspot.id == hotspot_id)
            .ok_or_else(|| {
                InvestigationError::new("unknownHotspot", "That scene detail does not exist.")
            })?;

        if hotspot.locked {
            return Err(InvestigationError::new(
                "lockedHotspot",
                hotspot
                    .locked_reason
                    .clone()
                    .unwrap_or_else(|| "That scene detail is locked.".to_string()),
            ));
        }

        hotspot.inspected = true;

        let reveals = self
            .hotspot_reveals
            .get(hotspot_id)
            .cloned()
            .unwrap_or_default();
        self.apply_reveals(reveals);
        self.refresh_candidates();

        Ok(self.state.clone())
    }

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
            .ok_or_else(|| {
                InvestigationError::new("unknownCharacter", "That person does not exist.")
            })?;

        let topic = character
            .topics
            .iter_mut()
            .find(|topic| topic.id == topic_id)
            .ok_or_else(|| {
                InvestigationError::new("unknownTopic", "That interview topic does not exist.")
            })?;

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

    pub fn submit_deduction(
        &mut self,
        answers: Vec<DeductionAnswer>,
    ) -> InvestigationResult<DeductionFeedback> {
        if self.state.status == CaseStatus::Solved {
            if let Some(feedback) = &self.state.last_feedback {
                return Ok(feedback.clone());
            }
        }

        let slot_ids: HashSet<String> = self
            .state
            .deduction_slots
            .iter()
            .map(|slot| slot.id.clone())
            .collect();
        let mut seen_slot_ids = HashSet::new();
        let mut answer_by_slot = HashMap::new();

        for answer in answers {
            if !slot_ids.contains(&answer.slot_id) {
                return Err(InvestigationError::new(
                    "unknownSlot",
                    "That deduction slot does not exist.",
                ));
            }

            if !seen_slot_ids.insert(answer.slot_id.clone()) {
                return Err(InvestigationError::new(
                    "duplicateSlotAnswer",
                    "Each deduction slot can only be answered once.",
                ));
            }

            if answer.answer_id.trim().is_empty() {
                continue;
            }

            answer_by_slot.insert(answer.slot_id, answer.answer_id);
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
            .filter(|evidence| evidence.collected)
            .map(|evidence| evidence.id.clone())
            .chain(
                self.state
                    .statements
                    .iter()
                    .filter(|statement| statement.discovered)
                    .map(|statement| statement.id.clone()),
            )
            .collect();

        if answer_by_slot
            .values()
            .any(|answer_id| !available_answer_ids.contains(answer_id))
        {
            return Err(InvestigationError::new(
                "unknownAnswer",
                "That clue is not available for deduction.",
            ));
        }

        let slot_results: Vec<DeductionSlotResult> = self
            .state
            .deduction_slots
            .iter()
            .map(|slot| {
                let answer_id = answer_by_slot
                    .get(&slot.id)
                    .expect("complete deduction should include every slot");
                let correct = self
                    .accepted_answers
                    .get(&slot.id)
                    .map(|accepted_answers| accepted_answers.contains(answer_id))
                    .unwrap_or(false);
                let guidance = if correct {
                    "This part of the theory fits the record."
                } else {
                    "Recheck the collected evidence and statements for this prompt."
                };

                DeductionSlotResult {
                    slot_id: slot.id.clone(),
                    correct,
                    guidance: guidance.to_string(),
                }
            })
            .collect();
        let solved = slot_results.iter().all(|result| result.correct);

        if solved {
            self.state.status = CaseStatus::Solved;
        }

        let feedback = DeductionFeedback {
            complete: true,
            solved,
            message: if solved {
                "Theory accepted. The study mystery is reconstructed."
            } else {
                "The theory has gaps. Revise the marked slots and submit again."
            }
            .to_string(),
            slot_results,
        };

        self.state.last_feedback = Some(feedback.clone());

        Ok(feedback)
    }

    fn apply_reveals(&mut self, reveals: Vec<Reveal>) {
        for reveal in reveals {
            match reveal {
                Reveal::Evidence(id) => {
                    if let Some(evidence) =
                        self.state.evidence.iter_mut().find(|item| item.id == id)
                    {
                        evidence.collected = true;
                    }
                }
                Reveal::Statement(id) => {
                    if let Some(statement) = self
                        .state
                        .statements
                        .iter_mut()
                        .find(|statement| statement.id == id)
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
                        .and_then(|character| {
                            character
                                .topics
                                .iter_mut()
                                .find(|topic| topic.id == topic_id)
                        })
                    {
                        topic.locked = false;
                        topic.locked_reason = None;
                    }
                }
            }
        }
    }

    fn refresh_candidates(&mut self) {
        let candidate_answer_ids: Vec<String> = self
            .state
            .evidence
            .iter()
            .filter(|evidence| evidence.collected)
            .map(|evidence| evidence.id.clone())
            .chain(
                self.state
                    .statements
                    .iter()
                    .filter(|statement| statement.discovered)
                    .map(|statement| statement.id.clone()),
            )
            .collect();

        for slot in &mut self.state.deduction_slots {
            slot.candidate_answer_ids.clone_from(&candidate_answer_ids);
        }
    }
}

impl Default for InvestigationEngine {
    fn default() -> Self {
        Self::new_demo_case()
    }
}

#[cfg(test)]
mod tests {
    use super::{CaseStatus, DeductionAnswer, InvestigationEngine};

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
    fn starts_demo_case_in_investigation_status() {
        let engine = InvestigationEngine::new_demo_case();
        let state = engine.state();

        assert_eq!(state.id, "demo-office");
        assert_eq!(state.status, CaseStatus::Investigating);
        assert_eq!(state.scene.hotspots.len(), 3);
        assert_eq!(state.characters.len(), 2);
        assert!(state.evidence.iter().all(|evidence| !evidence.collected));
        assert!(state
            .statements
            .iter()
            .all(|statement| !statement.discovered));
    }

    #[test]
    fn inspecting_hotspot_collects_evidence_and_unlocks_topic() {
        let mut engine = InvestigationEngine::new_demo_case();

        let state = engine.inspect_hotspot("desk").expect("desk should inspect");

        assert!(
            state
                .scene
                .hotspots
                .iter()
                .find(|hotspot| hotspot.id == "desk")
                .unwrap()
                .inspected
        );
        assert!(
            state
                .evidence
                .iter()
                .find(|item| item.id == "ink-smear")
                .unwrap()
                .collected
        );
        assert!(
            !state
                .characters
                .iter()
                .find(|character| character.id == "iris")
                .unwrap()
                .topics
                .iter()
                .find(|topic| topic.id == "ink")
                .unwrap()
                .locked
        );
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

    #[test]
    fn interviewing_available_topic_reveals_statement() {
        let mut engine = InvestigationEngine::new_demo_case();

        let state = engine
            .interview_character("iris", "timeline")
            .expect("timeline should be available");

        assert!(
            state
                .characters
                .iter()
                .find(|character| character.id == "iris")
                .unwrap()
                .topics
                .iter()
                .find(|topic| topic.id == "timeline")
                .unwrap()
                .discussed
        );
        assert!(
            state
                .statements
                .iter()
                .find(|statement| statement.id == "iris-tea")
                .unwrap()
                .discovered
        );
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

        assert!(
            state
                .statements
                .iter()
                .find(|statement| statement.id == "marlow-latch")
                .unwrap()
                .discovered
        );
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
    fn duplicate_blank_deduction_answer_returns_typed_error() {
        let mut engine = prepare_complete_case();

        let error = engine
            .submit_deduction(vec![
                DeductionAnswer {
                    slot_id: "time-marker".to_string(),
                    answer_id: "stopped-clock".to_string(),
                },
                DeductionAnswer {
                    slot_id: "time-marker".to_string(),
                    answer_id: "".to_string(),
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
            .unwrap_err();

        assert_eq!(error.code, "duplicateSlotAnswer");
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

    #[test]
    fn solved_case_returns_existing_feedback_for_later_wrong_submission() {
        let mut engine = prepare_complete_case();

        let solved_feedback = engine
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

        let later_feedback = engine
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

        assert!(later_feedback.solved);
        assert_eq!(later_feedback, solved_feedback);
        assert_eq!(engine.state().status, CaseStatus::Solved);
        assert_eq!(engine.state().last_feedback.unwrap(), solved_feedback);
    }
}
