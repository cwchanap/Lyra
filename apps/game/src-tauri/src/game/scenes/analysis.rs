use crate::game::dialogue_queue::ActiveDialogueQueue;
use crate::game::schema::{AnalysisBoardJson, AnalysisCardSource, AnalysisSceneJson};
use crate::game::state::Inventory;
use crate::game::unlock::{self, StoryUnlockContext};
use crate::game::GameError;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const RESTORED_CONSUMED_INTRO_QUEUE_GEN: u64 = 0;

/// Mutable, scene-local progress for a compiled analysis scene.
///
/// Practice cards deliberately live here rather than in `Inventory`: they are
/// copied from the immediately preceding investigation only for the active
/// tutorial handoff, and disappear when navigation leaves this scene.
#[derive(Debug, Clone)]
pub struct AnalysisSceneState {
    pub def: AnalysisSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub(crate) pending_queue: Option<ActiveDialogueQueue>,
    pub intro_queue_gen: u64,
    pub completed_board_ids: BTreeSet<String>,
    pub selected_card_ids_by_board: BTreeMap<String, BTreeSet<String>>,
    pub ordered_card_ids_by_board: BTreeMap<String, Vec<String>>,
    pub group_by_card_by_board: BTreeMap<String, BTreeMap<String, String>>,
    pub practice_card_ids: BTreeSet<String>,
    pub last_feedback: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnalysisSubmission {
    Threshold {
        selected_card_ids: BTreeSet<String>,
    },
    Classify {
        group_by_card: BTreeMap<String, String>,
    },
    Order {
        ordered_card_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnalysisSubmissionOutcome {
    Correct,
    Feedback(String),
}

impl AnalysisSceneState {
    pub fn from_json(def: AnalysisSceneJson, intro_queue_gen: u64) -> Self {
        Self {
            def,
            intro_played: false,
            outro_played: false,
            pending_queue: None,
            intro_queue_gen,
            completed_board_ids: BTreeSet::new(),
            selected_card_ids_by_board: BTreeMap::new(),
            ordered_card_ids_by_board: BTreeMap::new(),
            group_by_card_by_board: BTreeMap::new(),
            practice_card_ids: BTreeSet::new(),
            last_feedback: None,
        }
    }

    pub fn id(&self) -> &str {
        &self.def.id
    }

    pub fn title(&self) -> &str {
        &self.def.title
    }

    pub fn board(&self, board_id: &str) -> Option<&AnalysisBoardJson> {
        self.def
            .boards
            .iter()
            .find(|board| board.common().id == board_id)
    }

    pub fn is_board_completed(&self, board_id: &str) -> bool {
        self.completed_board_ids.contains(board_id)
    }

    pub fn is_board_unlocked(
        &self,
        board: &AnalysisBoardJson,
        story: &impl StoryUnlockContext,
    ) -> bool {
        board
            .common()
            .unlock
            .as_ref()
            .is_none_or(|unlock| unlock::evaluate_story(unlock, story))
    }

    pub fn next_unlocked_board_id(&self, story: &impl StoryUnlockContext) -> Option<String> {
        self.def
            .boards
            .iter()
            .find(|board| {
                !self.is_board_completed(&board.common().id) && self.is_board_unlocked(board, story)
            })
            .map(|board| board.common().id.clone())
    }

    pub fn all_boards_completed(&self) -> bool {
        self.def
            .boards
            .iter()
            .all(|board| self.is_board_completed(&board.common().id))
    }

    pub fn record_practice_card(&mut self, id: &str) {
        self.practice_card_ids.insert(id.to_owned());
    }

    pub fn card_is_available(&self, source: &AnalysisCardSource, inventory: &Inventory) -> bool {
        match source {
            AnalysisCardSource::Evidence { id } => inventory.has_evidence(id),
            AnalysisCardSource::Statement { id } => inventory.has_statement(id),
            AnalysisCardSource::Practice { id } => self.practice_card_ids.contains(id),
        }
    }

    pub fn set_threshold_selection(
        &mut self,
        board_id: &str,
        selected_card_ids: BTreeSet<String>,
    ) -> Result<(), GameError> {
        let board = self
            .board(board_id)
            .ok_or_else(|| GameError::unknown_analysis_board(board_id))?;
        if !matches!(board, AnalysisBoardJson::Threshold { .. }) {
            return Err(GameError::analysis_board_kind_mismatch(
                board_id,
                "threshold",
            ));
        }
        self.ensure_cards_belong_to_board(board_id, &selected_card_ids)?;
        self.selected_card_ids_by_board
            .insert(board_id.to_owned(), selected_card_ids);
        self.last_feedback = None;
        Ok(())
    }

    pub fn submit(
        &mut self,
        board_id: &str,
        submission: AnalysisSubmission,
    ) -> Result<AnalysisSubmissionOutcome, GameError> {
        if self.is_board_completed(board_id) {
            return Err(GameError::analysis_board_completed(board_id));
        }
        let board = self
            .board(board_id)
            .ok_or_else(|| GameError::unknown_analysis_board(board_id))?
            .clone();
        let outcome = match (board, submission) {
            (
                AnalysisBoardJson::Threshold {
                    common,
                    minimum_selected,
                    accepted_selections,
                },
                AnalysisSubmission::Threshold { selected_card_ids },
            ) => {
                self.ensure_cards_belong_to_board(board_id, &selected_card_ids)?;
                self.selected_card_ids_by_board
                    .insert(board_id.to_owned(), selected_card_ids.clone());
                let selection = selected_card_ids.iter().cloned().collect::<Vec<_>>();
                if let Some(explicit) = common.feedback.incorrect_selections.iter().find(|entry| {
                    let mut cards = entry.cards.clone();
                    cards.sort();
                    cards == selection
                }) {
                    AnalysisSubmissionOutcome::Feedback(explicit.feedback.clone())
                } else if selected_card_ids.len() < minimum_selected {
                    AnalysisSubmissionOutcome::Feedback(common.feedback.incomplete.clone())
                } else if accepted_selections
                    .iter()
                    .any(|accepted| accepted == &selection)
                {
                    AnalysisSubmissionOutcome::Correct
                } else {
                    AnalysisSubmissionOutcome::Feedback(common.feedback.incorrect.clone())
                }
            }
            (
                AnalysisBoardJson::Classify {
                    common,
                    accepted_group_by_card,
                    ..
                },
                AnalysisSubmission::Classify { group_by_card },
            ) => {
                self.ensure_cards_belong_to_board(
                    board_id,
                    &group_by_card.keys().cloned().collect(),
                )?;
                self.group_by_card_by_board
                    .insert(board_id.to_owned(), group_by_card.clone());
                if group_by_card.len() < accepted_group_by_card.len() {
                    AnalysisSubmissionOutcome::Feedback(common.feedback.incomplete.clone())
                } else if group_by_card == accepted_group_by_card {
                    AnalysisSubmissionOutcome::Correct
                } else {
                    AnalysisSubmissionOutcome::Feedback(common.feedback.incorrect.clone())
                }
            }
            (
                AnalysisBoardJson::Order {
                    common,
                    accepted_order,
                    ..
                },
                AnalysisSubmission::Order { ordered_card_ids },
            ) => {
                let submitted = ordered_card_ids.iter().cloned().collect::<BTreeSet<_>>();
                if submitted.len() != ordered_card_ids.len() {
                    return Err(GameError::analysis_selection_invalid(board_id));
                }
                self.ensure_cards_belong_to_board(board_id, &submitted)?;
                self.ordered_card_ids_by_board
                    .insert(board_id.to_owned(), ordered_card_ids.clone());
                if ordered_card_ids.len() < accepted_order.len() {
                    AnalysisSubmissionOutcome::Feedback(common.feedback.incomplete.clone())
                } else if ordered_card_ids == accepted_order {
                    AnalysisSubmissionOutcome::Correct
                } else {
                    AnalysisSubmissionOutcome::Feedback(common.feedback.incorrect.clone())
                }
            }
            (AnalysisBoardJson::Threshold { .. }, _)
            | (AnalysisBoardJson::Classify { .. }, _)
            | (AnalysisBoardJson::Order { .. }, _) => {
                return Err(GameError::analysis_board_kind_mismatch(
                    board_id,
                    "submitted",
                ));
            }
        };

        match &outcome {
            AnalysisSubmissionOutcome::Correct => {
                self.completed_board_ids.insert(board_id.to_owned());
                if self.all_boards_completed() {
                    self.practice_card_ids.clear();
                    self.selected_card_ids_by_board.remove(board_id);
                }
                self.last_feedback = None;
            }
            AnalysisSubmissionOutcome::Feedback(message) => {
                self.last_feedback = Some(message.clone());
            }
        }
        Ok(outcome)
    }

    fn ensure_cards_belong_to_board(
        &self,
        board_id: &str,
        card_ids: &BTreeSet<String>,
    ) -> Result<(), GameError> {
        let board = self
            .board(board_id)
            .ok_or_else(|| GameError::unknown_analysis_board(board_id))?;
        for card_id in card_ids {
            if !board.common().cards.iter().any(|card| card.id == *card_id) {
                return Err(GameError::unknown_analysis_card(board_id, card_id));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeSet;

    fn p1_reprint_scene() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_scene_p1_5",
            "title": "P1",
            "summary": "P1 practice",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [{
                "kind": "threshold",
                "common": {
                    "id": "p1_reprint_time_board",
                    "label": "重印時間整理",
                    "prompt": "選出正確的三項資料。",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {
                        "incomplete": "還少了一項資料。",
                        "incorrect": "這組資料沒有把兩個時間一起說清楚。",
                        "hint": null,
                        "incorrectSelections": [
                            {
                                "cards": ["cctv_change"],
                                "feedback": "監視器是真的，但不能單獨說明十七點四十二分。"
                            },
                            {
                                "cards": ["receipt_reprint"],
                                "feedback": "單看收據，學生反而更像在離店後才付款。"
                            }
                        ]
                    },
                    "cards": [
                        {"id": "receipt_reprint", "label": "REPRINT", "source": {"kind": "practice", "id": "p1_receipt_reprint"}, "summary": "重印收據。"},
                        {"id": "register_paper_jam", "label": "卡紙", "source": {"kind": "practice", "id": "p1_register_paper_jam"}, "summary": "卡紙痕跡。"},
                        {"id": "cctv_change", "label": "找零", "source": {"kind": "practice", "id": "p1_cctv_change"}, "summary": "十七點三十八分。"},
                        {"id": "handwritten_ledger", "label": "帳本", "source": {"kind": "practice", "id": "p1_handwritten_ledger"}, "summary": "十七點三十七分。"}
                    ],
                    "resultDialogue": []
                },
                "minimumSelected": 3,
                "acceptedSelections": [["handwritten_ledger", "receipt_reprint", "register_paper_jam"]]
            }]
        }))
        .expect("P1 analysis test definition is valid")
    }

    fn selected(card_ids: &[&str]) -> BTreeSet<String> {
        card_ids.iter().map(|id| (*id).to_owned()).collect()
    }

    #[test]
    fn p1_practice_cards_clear_after_the_final_board_completes() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        let inventory = Inventory::default();
        for id in [
            "p1_receipt_reprint",
            "p1_register_paper_jam",
            "p1_cctv_change",
            "p1_handwritten_ledger",
        ] {
            scene.record_practice_card(id);
        }

        assert!(inventory.evidence.is_empty());
        assert!(inventory.statements.is_empty());
        assert_eq!(
            scene.submit(
                "p1_reprint_time_board",
                AnalysisSubmission::Threshold {
                    selected_card_ids: selected(&["cctv_change"]),
                },
            ),
            Ok(AnalysisSubmissionOutcome::Feedback(
                "監視器是真的，但不能單獨說明十七點四十二分。".into()
            ))
        );
        assert_eq!(
            scene.submit(
                "p1_reprint_time_board",
                AnalysisSubmission::Threshold {
                    selected_card_ids: selected(&["receipt_reprint"]),
                },
            ),
            Ok(AnalysisSubmissionOutcome::Feedback(
                "單看收據，學生反而更像在離店後才付款。".into()
            ))
        );
        assert_eq!(
            scene.submit(
                "p1_reprint_time_board",
                AnalysisSubmission::Threshold {
                    selected_card_ids: selected(&[
                        "receipt_reprint",
                        "register_paper_jam",
                        "handwritten_ledger",
                    ]),
                },
            ),
            Ok(AnalysisSubmissionOutcome::Correct)
        );
        assert!(scene.is_board_completed("p1_reprint_time_board"));
        assert!(scene.practice_card_ids.is_empty());
    }

    fn classify_scene() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_classify",
            "title": "Classify",
            "summary": "Classify test",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [{
                "kind": "classify",
                "common": {
                    "id": "classify_board",
                    "label": "Classify Board",
                    "prompt": "Classify the cards.",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {"incomplete": "Not all classified.", "incorrect": "Wrong groups.", "hint": null},
                    "cards": [
                        {"id": "card_a", "label": "A", "source": {"kind": "evidence", "id": "ev_a"}, "summary": "A"},
                        {"id": "card_b", "label": "B", "source": {"kind": "evidence", "id": "ev_b"}, "summary": "B"}
                    ],
                    "resultDialogue": []
                },
                "groups": [
                    {"id": "group_1", "label": "Group 1", "description": "First"},
                    {"id": "group_2", "label": "Group 2", "description": "Second"}
                ],
                "acceptedGroupByCard": {"card_a": "group_1", "card_b": "group_2"}
            }]
        }))
        .expect("classify analysis test definition is valid")
    }

    fn order_scene() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_order",
            "title": "Order",
            "summary": "Order test",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [{
                "kind": "order",
                "common": {
                    "id": "order_board",
                    "label": "Order Board",
                    "prompt": "Order the cards.",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {"incomplete": "Not all ordered.", "incorrect": "Wrong order.", "hint": null},
                    "cards": [
                        {"id": "card_a", "label": "A", "source": {"kind": "evidence", "id": "ev_a"}, "summary": "A"},
                        {"id": "card_b", "label": "B", "source": {"kind": "evidence", "id": "ev_b"}, "summary": "B"}
                    ],
                    "resultDialogue": []
                },
                "acceptedOrder": ["card_a", "card_b"],
                "fixedAnchors": []
            }]
        }))
        .expect("order analysis test definition is valid")
    }

    fn inventory_with_evidence(ids: &[&str]) -> Inventory {
        let mut inv = Inventory::default();
        for id in ids {
            inv.evidence.push(crate::game::state::EvidenceRecord {
                id: (*id).into(),
                name: (*id).into(),
                description: "".into(),
                details: "".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                image_asset_id: None,
                on_reexamine: None,
                collected_in_chapter_id: "chapter_1".into(),
                collected_in_scene_id: "scene_1".into(),
            });
        }
        inv
    }

    fn inventory_with_statements(ids: &[&str]) -> Inventory {
        let mut inv = Inventory::default();
        for id in ids {
            inv.statements.push(crate::game::state::StatementRecord {
                id: (*id).into(),
                speaker: (*id).into(),
                content: "".into(),
                provenance: crate::game::provenance::CaseRecordProvenance::default(),
                on_reexamine: None,
                acquired_in_chapter_id: "chapter_1".into(),
                acquired_in_scene_id: "scene_1".into(),
            });
        }
        inv
    }

    #[test]
    fn classify_submit_correct_completes_the_board() {
        let mut scene = AnalysisSceneState::from_json(classify_scene(), 1);
        let mut group_by_card = BTreeMap::new();
        group_by_card.insert("card_a".into(), "group_1".into());
        group_by_card.insert("card_b".into(), "group_2".into());
        assert_eq!(
            scene.submit(
                "classify_board",
                AnalysisSubmission::Classify { group_by_card }
            ),
            Ok(AnalysisSubmissionOutcome::Correct)
        );
        assert!(scene.is_board_completed("classify_board"));
        assert!(scene.last_feedback.is_none());
    }

    #[test]
    fn classify_submit_incomplete_returns_feedback() {
        let mut scene = AnalysisSceneState::from_json(classify_scene(), 1);
        let mut group_by_card = BTreeMap::new();
        group_by_card.insert("card_a".into(), "group_1".into());
        assert_eq!(
            scene.submit(
                "classify_board",
                AnalysisSubmission::Classify { group_by_card }
            ),
            Ok(AnalysisSubmissionOutcome::Feedback(
                "Not all classified.".into()
            ))
        );
        assert!(!scene.is_board_completed("classify_board"));
        assert_eq!(scene.last_feedback.as_deref(), Some("Not all classified."));
    }

    #[test]
    fn classify_submit_incorrect_returns_feedback() {
        let mut scene = AnalysisSceneState::from_json(classify_scene(), 1);
        let mut group_by_card = BTreeMap::new();
        group_by_card.insert("card_a".into(), "group_2".into());
        group_by_card.insert("card_b".into(), "group_1".into());
        assert_eq!(
            scene.submit(
                "classify_board",
                AnalysisSubmission::Classify { group_by_card }
            ),
            Ok(AnalysisSubmissionOutcome::Feedback("Wrong groups.".into()))
        );
        assert!(!scene.is_board_completed("classify_board"));
        assert_eq!(scene.last_feedback.as_deref(), Some("Wrong groups."));
    }

    #[test]
    fn order_submit_correct_completes_the_board() {
        let mut scene = AnalysisSceneState::from_json(order_scene(), 1);
        assert_eq!(
            scene.submit(
                "order_board",
                AnalysisSubmission::Order {
                    ordered_card_ids: vec!["card_a".into(), "card_b".into()],
                },
            ),
            Ok(AnalysisSubmissionOutcome::Correct)
        );
        assert!(scene.is_board_completed("order_board"));
    }

    #[test]
    fn order_submit_incomplete_returns_feedback() {
        let mut scene = AnalysisSceneState::from_json(order_scene(), 1);
        assert_eq!(
            scene.submit(
                "order_board",
                AnalysisSubmission::Order {
                    ordered_card_ids: vec!["card_a".into()],
                },
            ),
            Ok(AnalysisSubmissionOutcome::Feedback(
                "Not all ordered.".into()
            ))
        );
        assert!(!scene.is_board_completed("order_board"));
    }

    #[test]
    fn order_submit_incorrect_returns_feedback() {
        let mut scene = AnalysisSceneState::from_json(order_scene(), 1);
        assert_eq!(
            scene.submit(
                "order_board",
                AnalysisSubmission::Order {
                    ordered_card_ids: vec!["card_b".into(), "card_a".into()],
                },
            ),
            Ok(AnalysisSubmissionOutcome::Feedback("Wrong order.".into()))
        );
        assert!(!scene.is_board_completed("order_board"));
    }

    #[test]
    fn order_submit_with_duplicate_cards_returns_selection_invalid() {
        let mut scene = AnalysisSceneState::from_json(order_scene(), 1);
        let error = scene
            .submit(
                "order_board",
                AnalysisSubmission::Order {
                    ordered_card_ids: vec!["card_a".into(), "card_a".into()],
                },
            )
            .expect_err("duplicate order cards must be rejected");
        assert_eq!(error.code, "analysisSelectionInvalid");
    }

    #[test]
    fn submit_to_unknown_board_returns_unknown_analysis_board() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        let error = scene
            .submit(
                "nonexistent",
                AnalysisSubmission::Threshold {
                    selected_card_ids: selected(&[]),
                },
            )
            .expect_err("unknown board must be rejected");
        assert_eq!(error.code, "unknownAnalysisBoard");
    }

    #[test]
    fn submit_to_completed_board_returns_analysis_board_completed() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        for id in [
            "p1_receipt_reprint",
            "p1_register_paper_jam",
            "p1_cctv_change",
            "p1_handwritten_ledger",
        ] {
            scene.record_practice_card(id);
        }
        scene
            .submit(
                "p1_reprint_time_board",
                AnalysisSubmission::Threshold {
                    selected_card_ids: selected(&[
                        "receipt_reprint",
                        "register_paper_jam",
                        "handwritten_ledger",
                    ]),
                },
            )
            .expect("correct submission should complete the board");
        let error = scene
            .submit(
                "p1_reprint_time_board",
                AnalysisSubmission::Threshold {
                    selected_card_ids: selected(&["receipt_reprint"]),
                },
            )
            .expect_err("completed board must reject further submissions");
        assert_eq!(error.code, "analysisBoardCompleted");
    }

    #[test]
    fn submit_with_wrong_kind_returns_kind_mismatch() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        let error = scene
            .submit(
                "p1_reprint_time_board",
                AnalysisSubmission::Order {
                    ordered_card_ids: vec!["receipt_reprint".into()],
                },
            )
            .expect_err("order submission to threshold board must be rejected");
        assert_eq!(error.code, "analysisBoardKindMismatch");
    }

    #[test]
    fn submit_with_unknown_card_returns_unknown_analysis_card() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        let error = scene
            .submit(
                "p1_reprint_time_board",
                AnalysisSubmission::Threshold {
                    selected_card_ids: selected(&["nonexistent_card"]),
                },
            )
            .expect_err("unknown card must be rejected");
        assert_eq!(error.code, "unknownAnalysisCard");
    }

    #[test]
    fn set_threshold_selection_stores_selection_and_clears_feedback() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        scene.last_feedback = Some("old feedback".into());
        scene
            .set_threshold_selection("p1_reprint_time_board", selected(&["cctv_change"]))
            .expect("valid selection should be stored");
        assert_eq!(
            scene
                .selected_card_ids_by_board
                .get("p1_reprint_time_board"),
            Some(&selected(&["cctv_change"]))
        );
        assert!(scene.last_feedback.is_none());
    }

    #[test]
    fn set_threshold_selection_on_unknown_board_returns_error() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        let error = scene
            .set_threshold_selection("nonexistent", selected(&["cctv_change"]))
            .expect_err("unknown board must be rejected");
        assert_eq!(error.code, "unknownAnalysisBoard");
    }

    #[test]
    fn set_threshold_selection_on_non_threshold_board_returns_kind_mismatch() {
        let mut scene = AnalysisSceneState::from_json(classify_scene(), 1);
        let error = scene
            .set_threshold_selection("classify_board", selected(&["card_a"]))
            .expect_err("non-threshold board must be rejected");
        assert_eq!(error.code, "analysisBoardKindMismatch");
    }

    #[test]
    fn set_threshold_selection_with_unknown_card_returns_error() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        let error = scene
            .set_threshold_selection("p1_reprint_time_board", selected(&["nonexistent"]))
            .expect_err("unknown card must be rejected");
        assert_eq!(error.code, "unknownAnalysisCard");
    }

    #[test]
    fn card_is_available_checks_evidence_statement_and_practice() {
        let scene = AnalysisSceneState::from_json(classify_scene(), 1);
        let inv_with_evidence = inventory_with_evidence(&["ev_a"]);
        assert!(scene.card_is_available(
            &AnalysisCardSource::Evidence { id: "ev_a".into() },
            &inv_with_evidence
        ));
        assert!(!scene.card_is_available(
            &AnalysisCardSource::Evidence {
                id: "ev_missing".into()
            },
            &inv_with_evidence
        ));
        let inv_with_statement = inventory_with_statements(&["stmt_a"]);
        assert!(scene.card_is_available(
            &AnalysisCardSource::Statement {
                id: "stmt_a".into()
            },
            &inv_with_statement
        ));
        assert!(!scene.card_is_available(
            &AnalysisCardSource::Statement {
                id: "stmt_missing".into()
            },
            &inv_with_statement
        ));
        let mut practice_scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        practice_scene.record_practice_card("p1_receipt_reprint");
        let empty_inv = Inventory::default();
        assert!(practice_scene.card_is_available(
            &AnalysisCardSource::Practice {
                id: "p1_receipt_reprint".into()
            },
            &empty_inv
        ));
        assert!(!practice_scene.card_is_available(
            &AnalysisCardSource::Practice {
                id: "p1_missing".into()
            },
            &empty_inv
        ));
    }

    #[test]
    fn all_boards_completed_returns_true_only_when_all_done() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        assert!(!scene.all_boards_completed());
        scene
            .completed_board_ids
            .insert("p1_reprint_time_board".into());
        assert!(scene.all_boards_completed());
    }

    #[test]
    fn next_unlocked_board_id_skips_completed_and_locked() {
        let def: AnalysisSceneJson = serde_json::from_value(json!({
            "id": "analysis_multi",
            "title": "Multi",
            "summary": "Multi board",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [
                {
                    "kind": "threshold",
                    "common": {
                        "id": "board_a",
                        "label": "A",
                        "prompt": "A",
                        "unlock": null,
                        "reveals": [],
                        "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                        "cards": [],
                        "resultDialogue": []
                    },
                    "minimumSelected": 0,
                    "acceptedSelections": [[]]
                },
                {
                    "kind": "threshold",
                    "common": {
                        "id": "board_b",
                        "label": "B",
                        "prompt": "B",
                        "unlock": {"predicate": "fact_asserted", "id": "gate_fact"},
                        "reveals": [],
                        "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                        "cards": [],
                        "resultDialogue": []
                    },
                    "minimumSelected": 0,
                    "acceptedSelections": [[]]
                }
            ]
        }))
        .expect("multi-board analysis definition is valid");
        let scene = AnalysisSceneState::from_json(def, 1);
        let locked_story = crate::game::story::StoryState::default();
        // board_a is unlocked (null unlock), board_b is locked (requires gate_fact)
        assert_eq!(
            scene.next_unlocked_board_id(&locked_story),
            Some("board_a".into())
        );
        // When board_a is completed, no unlocked incomplete board remains
        let mut completed = scene;
        completed.completed_board_ids.insert("board_a".into());
        assert_eq!(completed.next_unlocked_board_id(&locked_story), None);
    }

    #[test]
    fn is_board_unlocked_with_null_unlock_is_always_true() {
        let scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        let story = crate::game::story::StoryState::default();
        let board = scene.board("p1_reprint_time_board").unwrap();
        assert!(scene.is_board_unlocked(board, &story));
    }

    #[test]
    fn record_practice_card_adds_to_practice_set() {
        let mut scene = AnalysisSceneState::from_json(p1_reprint_scene(), 1);
        scene.record_practice_card("p1_new_card");
        assert!(scene.practice_card_ids.contains("p1_new_card"));
    }
}
