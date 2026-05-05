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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeductionFeedback {
    pub complete: bool,
    pub solved: bool,
    pub message: String,
    pub slot_results: Vec<DeductionSlotResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    use super::{CaseStatus, InvestigationEngine};

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
}
