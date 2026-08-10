use crate::game::analysis::{AnalysisDraft, AnalysisFeedbackState};
use crate::game::dialogue_queue::ActiveDialogueQueue;
use crate::game::schema::{AnalysisBoardJson, AnalysisSceneJson};
use crate::game::unlock::{self, StoryUnlockContext};
use crate::game::GameError;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const RESTORED_CONSUMED_INTRO_QUEUE_GEN: u64 = 0;

/// Mutable, scene-local workbench state for a compiled Analysis scene.
///
/// Board definitions and answer material remain immutable in `def`.  A
/// player's input is represented by one neutral, correctly typed draft per
/// authored board; availability is derived from those definitions and the
/// persistent story state rather than stored as a second progression model.
#[derive(Debug, Clone)]
pub struct AnalysisSceneState {
    pub def: AnalysisSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub available_board_ids: BTreeSet<String>,
    pub active_board_id: Option<String>,
    pub drafts: BTreeMap<String, AnalysisDraft>,
    pub feedback_by_board_id: BTreeMap<String, AnalysisFeedbackState>,
    pub(crate) pending_queue: Option<ActiveDialogueQueue>,
    pub intro_queue_gen: u64,
}

impl AnalysisSceneState {
    pub fn from_json(def: AnalysisSceneJson, intro_queue_gen: u64) -> Self {
        let drafts = def
            .boards
            .iter()
            .map(|board| (board.common().id.clone(), empty_draft_for_board(board)))
            .collect();
        Self {
            def,
            intro_played: false,
            outro_played: false,
            available_board_ids: BTreeSet::new(),
            active_board_id: None,
            drafts,
            feedback_by_board_id: BTreeMap::new(),
            pending_queue: None,
            intro_queue_gen,
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

    /// Compute current board availability from packaged unlock expressions and
    /// the persistent story state.  This is deliberately a pure projection:
    /// it neither reads prior availability nor applies local/inventory
    /// overrides.
    pub fn compute_available_board_ids(&self, story: &impl StoryUnlockContext) -> BTreeSet<String> {
        self.def
            .boards
            .iter()
            .filter(|board| {
                board
                    .common()
                    .unlock
                    .as_ref()
                    .is_none_or(|unlock| unlock::evaluate_story(unlock, story))
            })
            .map(|board| board.common().id.clone())
            .collect()
    }

    /// Refresh the runtime availability cache by assignment, never by union.
    pub fn recompute_available_board_ids(&mut self, story: &impl StoryUnlockContext) {
        self.available_board_ids = self.compute_available_board_ids(story);
    }

    /// Select the first currently available and incomplete board in authored
    /// order.  The selection is a runtime focus only; qualified completion
    /// remains owned by `StoryState`.
    pub fn auto_focus_next_available_incomplete_board(
        &mut self,
        chapter_id: &str,
        story: &impl StoryUnlockContext,
    ) -> Option<String> {
        let active_board_id = self.next_available_incomplete_board_id(chapter_id, story);
        self.active_board_id = active_board_id.clone();
        active_board_id
    }

    /// Transitional definition-only unlock check retained for the inherited
    /// engine seam.  Completion is intentionally not read from scene state;
    /// callers that need completion must consult `StoryState` with qualified
    /// chapter/scene/board refs.
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

    pub fn is_board_completed_qualified(
        &self,
        chapter_id: &str,
        board_id: &str,
        story: &impl StoryUnlockContext,
    ) -> bool {
        story.analysis_board_completed(chapter_id, self.id(), board_id)
    }

    pub fn next_available_incomplete_board_id(
        &self,
        chapter_id: &str,
        story: &impl StoryUnlockContext,
    ) -> Option<String> {
        self.def.boards.iter().find_map(|board| {
            let board_id = board.common().id.as_str();
            (self.is_board_unlocked(board, story)
                && !self.is_board_completed_qualified(chapter_id, board_id, story))
            .then(|| board_id.to_owned())
        })
    }

    pub fn all_boards_completed_qualified(
        &self,
        chapter_id: &str,
        story: &impl StoryUnlockContext,
    ) -> bool {
        self.def.boards.iter().all(|board| {
            self.is_board_completed_qualified(chapter_id, board.common().id.as_str(), story)
        })
    }

    pub fn card_is_available(
        &self,
        source: &crate::game::schema::AnalysisCardSource,
        inventory: &crate::game::state::Inventory,
    ) -> bool {
        match source {
            crate::game::schema::AnalysisCardSource::Evidence { id } => inventory.has_evidence(id),
            crate::game::schema::AnalysisCardSource::Statement { id } => {
                inventory.has_statement(id)
            }
            // Practice cards no longer live in mutable scene state; they are
            // scoped authored workbench cards and therefore do not require an
            // inventory/local unlock context.
            crate::game::schema::AnalysisCardSource::Practice { .. } => true,
        }
    }

    /// Return the empty input shape that corresponds to an immutable board
    /// definition.  Keeping this constructor beside state initialization
    /// prevents board-kind-specific maps from reappearing at call sites.
    pub fn empty_draft_for_board(board: &AnalysisBoardJson) -> AnalysisDraft {
        empty_draft_for_board(board)
    }

    /// Validate only player-controlled IDs and board kind.  Partial drafts are
    /// valid; completeness and correctness are separate pure predicates.
    pub fn validate_draft(&self, board_id: &str, draft: &AnalysisDraft) -> Result<(), GameError> {
        let board = self
            .board(board_id)
            .ok_or_else(|| GameError::unknown_analysis_board(board_id))?;

        match (board, draft) {
            (
                AnalysisBoardJson::Classify { common, groups, .. },
                AnalysisDraft::Classify { group_by_card },
            ) => {
                for (card_id, group_id) in group_by_card {
                    ensure_card_exists(board_id, common, card_id)?;
                    if !groups.iter().any(|group| group.id == *group_id) {
                        return Err(GameError::analysis_selection_invalid(board_id));
                    }
                }
                Ok(())
            }
            (
                AnalysisBoardJson::Order {
                    common,
                    fixed_anchors,
                    ..
                },
                AnalysisDraft::Order { card_ids },
            ) => {
                let unique_ids = card_ids.iter().collect::<BTreeSet<_>>();
                if unique_ids.len() != card_ids.len() {
                    return Err(GameError::analysis_selection_invalid(board_id));
                }
                for card_id in card_ids {
                    ensure_card_exists(board_id, common, card_id)?;
                }
                let mut anchor_card_ids = BTreeSet::new();
                let mut anchor_positions = BTreeSet::new();
                for anchor in fixed_anchors {
                    if anchor.position == 0
                        || anchor.position > common.cards.len()
                        || !anchor_card_ids.insert(anchor.card_id.as_str())
                        || !anchor_positions.insert(anchor.position)
                    {
                        return Err(GameError::analysis_selection_invalid(board_id));
                    }
                    ensure_card_exists(board_id, common, &anchor.card_id)?;
                    if let Some(index) = card_ids.iter().position(|id| id == &anchor.card_id) {
                        if index + 1 != anchor.position {
                            return Err(GameError::analysis_selection_invalid(board_id));
                        }
                    }
                }
                Ok(())
            }
            (
                AnalysisBoardJson::Threshold { common, .. },
                AnalysisDraft::Threshold { selected_card_ids },
            ) => {
                // BTreeSet is the normalized/unique threshold wire.  Any
                // duplicate source IDs cannot survive construction of this
                // draft type, while unknown IDs are still rejected here.
                for card_id in selected_card_ids {
                    ensure_card_exists(board_id, common, card_id)?;
                }
                Ok(())
            }
            (AnalysisBoardJson::Classify { .. }, _)
            | (AnalysisBoardJson::Order { .. }, _)
            | (AnalysisBoardJson::Threshold { .. }, _) => {
                let expected = match board {
                    AnalysisBoardJson::Classify { .. } => "classify",
                    AnalysisBoardJson::Order { .. } => "order",
                    AnalysisBoardJson::Threshold { .. } => "threshold",
                };
                Err(GameError::analysis_board_kind_mismatch(board_id, expected))
            }
        }
    }

    /// Validate that every card referenced by the draft is authored on the
    /// board AND currently available to the player.  Structural shape is
    /// checked by [`Self::validate_draft`]; this method is the runtime
    /// submission gate that prevents a stale client from submitting an
    /// authored-but-unacquired Evidence or Statement card.  Practice cards
    /// are always considered available (see [`Self::card_is_available`]).
    pub fn validate_draft_availability(
        &self,
        board_id: &str,
        draft: &AnalysisDraft,
        inventory: &crate::game::state::Inventory,
    ) -> Result<(), GameError> {
        let board = self
            .board(board_id)
            .ok_or_else(|| GameError::unknown_analysis_board(board_id))?;
        let common = board.common();
        for card_id in draft.card_ids() {
            let card = common
                .cards
                .iter()
                .find(|card| card.id == card_id)
                .ok_or_else(|| GameError::unknown_analysis_card(board_id, card_id))?;
            if !self.card_is_available(&card.source, inventory) {
                return Err(GameError::unavailable_analysis_card(board_id, card_id));
            }
        }
        Ok(())
    }

    pub fn draft_is_complete(
        &self,
        board_id: &str,
        draft: &AnalysisDraft,
    ) -> Result<bool, GameError> {
        self.validate_draft(board_id, draft)?;
        let board = self
            .board(board_id)
            .ok_or_else(|| GameError::unknown_analysis_board(board_id))?;
        Ok(match (board, draft) {
            (
                AnalysisBoardJson::Classify { common, .. },
                AnalysisDraft::Classify { group_by_card },
            ) => group_by_card.len() == common.cards.len(),
            (AnalysisBoardJson::Order { common, .. }, AnalysisDraft::Order { card_ids }) => {
                card_ids.len() == common.cards.len()
            }
            (
                AnalysisBoardJson::Threshold {
                    minimum_selected, ..
                },
                AnalysisDraft::Threshold { selected_card_ids },
            ) => selected_card_ids.len() >= *minimum_selected,
            _ => false,
        })
    }

    pub fn draft_is_correct(
        &self,
        board_id: &str,
        draft: &AnalysisDraft,
    ) -> Result<bool, GameError> {
        self.validate_draft(board_id, draft)?;
        let board = self
            .board(board_id)
            .ok_or_else(|| GameError::unknown_analysis_board(board_id))?;
        Ok(match (board, draft) {
            (
                AnalysisBoardJson::Classify {
                    accepted_group_by_card,
                    ..
                },
                AnalysisDraft::Classify { group_by_card },
            ) => group_by_card == accepted_group_by_card,
            (
                AnalysisBoardJson::Order { accepted_order, .. },
                AnalysisDraft::Order { card_ids },
            ) => card_ids == accepted_order,
            (
                AnalysisBoardJson::Threshold {
                    accepted_selections,
                    ..
                },
                AnalysisDraft::Threshold { selected_card_ids },
            ) => accepted_selections.iter().any(|accepted| {
                accepted.iter().cloned().collect::<BTreeSet<_>>() == *selected_card_ids
            }),
            _ => false,
        })
    }
}

fn empty_draft_for_board(board: &AnalysisBoardJson) -> AnalysisDraft {
    match board {
        AnalysisBoardJson::Classify { .. } => AnalysisDraft::Classify {
            group_by_card: BTreeMap::new(),
        },
        AnalysisBoardJson::Order { .. } => AnalysisDraft::Order {
            card_ids: Vec::new(),
        },
        AnalysisBoardJson::Threshold { .. } => AnalysisDraft::Threshold {
            selected_card_ids: BTreeSet::new(),
        },
    }
}

fn ensure_card_exists(
    board_id: &str,
    common: &crate::game::schema::AnalysisBoardJsonCommon,
    card_id: &str,
) -> Result<(), GameError> {
    if common.cards.iter().any(|card| card.id == card_id) {
        Ok(())
    } else {
        Err(GameError::unknown_analysis_card(board_id, card_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::story::StoryState;
    use serde_json::{json, Value};
    use std::collections::{BTreeMap, BTreeSet};

    fn scene() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_scene",
            "title": "Analysis",
            "summary": "Task 2",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [{
                "kind": "threshold",
                "common": {
                    "id": "threshold_board",
                    "label": "Threshold",
                    "prompt": "Choose",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {"incomplete": "Incomplete", "incorrect": "Incorrect", "hint": null},
                    "cards": [{"id": "card", "label": "Card", "source": {"kind": "practice", "id": "practice"}, "summary": "Card"}],
                    "resultDialogue": []
                },
                "minimumSelected": 1,
                "acceptedSelections": [["card"]]
            }]
        }))
        .expect("analysis test definition must deserialize")
    }

    #[test]
    fn threshold_feedback_state_wire_is_failure_only() {
        assert_eq!(
            serde_json::to_value(AnalysisFeedbackState::Incomplete).unwrap(),
            json!("incomplete")
        );
        assert_eq!(
            serde_json::to_value(AnalysisFeedbackState::Incorrect).unwrap(),
            json!("incorrect")
        );
    }

    #[test]
    fn empty_draft_is_typed_from_the_board_kind() {
        let state = AnalysisSceneState::from_json(scene(), 1);
        assert_eq!(
            state.drafts.get("threshold_board"),
            Some(&AnalysisDraft::Threshold {
                selected_card_ids: BTreeSet::new()
            })
        );
    }

    #[test]
    fn threshold_draft_correctness_normalizes_accepted_selection() {
        let state = AnalysisSceneState::from_json(scene(), 1);
        let draft = AnalysisDraft::Threshold {
            selected_card_ids: ["card".to_owned()].into_iter().collect(),
        };
        assert!(state.draft_is_complete("threshold_board", &draft).unwrap());
        assert!(state.draft_is_correct("threshold_board", &draft).unwrap());
    }

    fn evidence_threshold_scene() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_evidence",
            "title": "Evidence",
            "summary": "Availability gate",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [{
                "kind": "threshold",
                "common": {
                    "id": "threshold_board",
                    "label": "Threshold",
                    "prompt": "Choose",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {"incomplete": "Incomplete", "incorrect": "Incorrect", "hint": null},
                    "cards": [
                        {"id": "ev_card", "label": "Evidence", "source": {"kind": "evidence", "id": "ev_1"}, "summary": "Evidence card"},
                        {"id": "st_card", "label": "Statement", "source": {"kind": "statement", "id": "st_1"}, "summary": "Statement card"},
                        {"id": "pr_card", "label": "Practice", "source": {"kind": "practice", "id": "pr_1"}, "summary": "Practice card"}
                    ],
                    "resultDialogue": []
                },
                "minimumSelected": 1,
                "acceptedSelections": [["ev_card"]]
            }]
        }))
        .expect("evidence threshold test definition must deserialize")
    }

    #[test]
    fn validate_draft_availability_rejects_unacquired_evidence_card() {
        let state = AnalysisSceneState::from_json(evidence_threshold_scene(), 1);
        let draft = AnalysisDraft::Threshold {
            selected_card_ids: ["ev_card".to_owned()].into_iter().collect(),
        };
        let empty_inventory = crate::game::state::Inventory::default();
        let err = state
            .validate_draft_availability("threshold_board", &draft, &empty_inventory)
            .expect_err("unacquired evidence card must be rejected");
        assert_eq!(err.code, "unavailableAnalysisCard");
    }

    #[test]
    fn validate_draft_availability_rejects_unacquired_statement_card() {
        let state = AnalysisSceneState::from_json(evidence_threshold_scene(), 1);
        let draft = AnalysisDraft::Threshold {
            selected_card_ids: ["st_card".to_owned()].into_iter().collect(),
        };
        let empty_inventory = crate::game::state::Inventory::default();
        let err = state
            .validate_draft_availability("threshold_board", &draft, &empty_inventory)
            .expect_err("unacquired statement card must be rejected");
        assert_eq!(err.code, "unavailableAnalysisCard");
    }

    #[test]
    fn validate_draft_availability_accepts_acquired_evidence_card() {
        use crate::game::provenance::CaseRecordProvenance;
        use crate::game::state::{EvidenceRecord, Inventory};

        let state = AnalysisSceneState::from_json(evidence_threshold_scene(), 1);
        let draft = AnalysisDraft::Threshold {
            selected_card_ids: ["ev_card".to_owned()].into_iter().collect(),
        };
        let inventory = Inventory {
            evidence: vec![EvidenceRecord {
                id: "ev_1".into(),
                name: "Evidence 1".into(),
                description: "desc".into(),
                details: "details".into(),
                provenance: CaseRecordProvenance::default(),
                image_asset_id: None,
                on_reexamine: None,
                collected_in_chapter_id: "chapter_1".into(),
                collected_in_scene_id: "scene_1".into(),
            }],
            statements: vec![],
        };
        state
            .validate_draft_availability("threshold_board", &draft, &inventory)
            .expect("acquired evidence card must pass availability check");
    }

    #[test]
    fn validate_draft_availability_accepts_practice_cards_without_inventory() {
        let state = AnalysisSceneState::from_json(evidence_threshold_scene(), 1);
        let draft = AnalysisDraft::Threshold {
            selected_card_ids: ["pr_card".to_owned()].into_iter().collect(),
        };
        let empty_inventory = crate::game::state::Inventory::default();
        state
            .validate_draft_availability("threshold_board", &draft, &empty_inventory)
            .expect("practice cards are always available");
    }

    #[test]
    fn availability_recompute_is_assignment_from_story_unlocks() {
        let state = AnalysisSceneState::from_json(scene(), 1);
        let story = StoryState::default();
        assert_eq!(
            state.compute_available_board_ids(&story),
            ["threshold_board".to_owned()].into_iter().collect()
        );
    }

    fn table_scene() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_table",
            "title": "Table",
            "summary": "Task 2 table",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [
                {
                    "kind": "classify",
                    "common": {
                        "id": "classify_board",
                        "label": "Classify",
                        "prompt": "Classify",
                        "unlock": null,
                        "reveals": [],
                        "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                        "cards": [
                            {"id": "c1", "label": "C1", "source": {"kind": "practice", "id": "p1"}, "summary": "C1"},
                            {"id": "c2", "label": "C2", "source": {"kind": "practice", "id": "p2"}, "summary": "C2"}
                        ],
                        "resultDialogue": []
                    },
                    "groups": [
                        {"id": "g1", "label": "G1", "description": "G1"},
                        {"id": "g2", "label": "G2", "description": "G2"}
                    ],
                    "acceptedGroupByCard": {"c1": "g1", "c2": "g2"}
                },
                {
                    "kind": "order",
                    "common": {
                        "id": "order_board",
                        "label": "Order",
                        "prompt": "Order",
                        "unlock": {"predicate": "fact_asserted", "id": "gate"},
                        "reveals": [],
                        "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                        "cards": [
                            {"id": "o1", "label": "O1", "source": {"kind": "practice", "id": "p1"}, "summary": "O1"},
                            {"id": "o2", "label": "O2", "source": {"kind": "practice", "id": "p2"}, "summary": "O2"},
                            {"id": "o3", "label": "O3", "source": {"kind": "practice", "id": "p3"}, "summary": "O3"}
                        ],
                        "resultDialogue": []
                    },
                    "acceptedOrder": ["o1", "o2", "o3"],
                    "fixedAnchors": [{"cardId": "o1", "position": 1}]
                },
                {
                    "kind": "threshold",
                    "common": {
                        "id": "threshold_board",
                        "label": "Threshold",
                        "prompt": "Choose",
                        "unlock": null,
                        "reveals": [],
                        "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                        "cards": [
                            {"id": "t1", "label": "T1", "source": {"kind": "practice", "id": "p1"}, "summary": "T1"},
                            {"id": "t2", "label": "T2", "source": {"kind": "practice", "id": "p2"}, "summary": "T2"},
                            {"id": "t3", "label": "T3", "source": {"kind": "practice", "id": "p3"}, "summary": "T3"}
                        ],
                        "resultDialogue": []
                    },
                    "minimumSelected": 2,
                    "acceptedSelections": [["t1", "t2"]]
                }
            ]
        }))
        .expect("table analysis definition must deserialize")
    }

    fn groups(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
        entries
            .iter()
            .map(|(card, group)| ((*card).into(), (*group).into()))
            .collect()
    }

    fn ids(values: &[&str]) -> BTreeSet<String> {
        values.iter().map(|value| (*value).into()).collect()
    }

    #[test]
    fn classify_draft_table_validates_partial_ids_and_exact_normalized_map() {
        let state = AnalysisSceneState::from_json(table_scene(), 1);
        let cases = [
            (groups(&[]), true, false, false),
            (groups(&[("c1", "g1")]), true, false, false),
            (groups(&[("c1", "g1"), ("c2", "g2")]), true, true, true),
            (groups(&[("unknown", "g1")]), false, false, false),
            (groups(&[("c1", "unknown")]), false, false, false),
        ];
        for (group_by_card, valid, complete, correct) in cases {
            let draft = AnalysisDraft::Classify { group_by_card };
            assert_eq!(
                state.validate_draft("classify_board", &draft).is_ok(),
                valid
            );
            if valid {
                assert_eq!(
                    state.draft_is_complete("classify_board", &draft).unwrap(),
                    complete
                );
                assert_eq!(
                    state.draft_is_correct("classify_board", &draft).unwrap(),
                    correct
                );
            }
        }
    }

    #[test]
    fn order_draft_table_validates_partial_unique_ids_and_fixed_anchor_position() {
        let state = AnalysisSceneState::from_json(table_scene(), 1);
        let cases = [
            (vec![], true, false, false),
            (vec!["o2".into()], true, false, false),
            (
                vec!["o1".into(), "o2".into(), "o3".into()],
                true,
                true,
                true,
            ),
            (vec!["o2".into(), "o1".into()], false, false, false),
            (vec!["o1".into(), "o1".into()], false, false, false),
            (vec!["unknown".into()], false, false, false),
        ];
        for (card_ids, valid, complete, correct) in cases {
            let draft = AnalysisDraft::Order { card_ids };
            assert_eq!(state.validate_draft("order_board", &draft).is_ok(), valid);
            if valid {
                assert_eq!(
                    state.draft_is_complete("order_board", &draft).unwrap(),
                    complete
                );
                assert_eq!(
                    state.draft_is_correct("order_board", &draft).unwrap(),
                    correct
                );
            }
        }
    }

    #[test]
    fn threshold_draft_table_validates_displayed_ids_and_minimum_count() {
        let state = AnalysisSceneState::from_json(table_scene(), 1);
        let cases = [
            (&[][..], true, false, false),
            (&["t1"][..], true, false, false),
            (&["t1", "t2"][..], true, true, true),
            (&["t1", "t3"][..], true, true, false),
            (&["unknown"][..], false, false, false),
        ];
        for (selected, valid, complete, correct) in cases {
            let draft = AnalysisDraft::Threshold {
                selected_card_ids: ids(selected),
            };
            assert_eq!(
                state.validate_draft("threshold_board", &draft).is_ok(),
                valid
            );
            if valid {
                assert_eq!(
                    state.draft_is_complete("threshold_board", &draft).unwrap(),
                    complete
                );
                assert_eq!(
                    state.draft_is_correct("threshold_board", &draft).unwrap(),
                    correct
                );
            }
        }
    }

    #[test]
    fn neutral_serde_rejects_answer_keys_and_serializes_only_allowed_feedback() {
        let draft = AnalysisDraft::Threshold {
            selected_card_ids: ids(&["t1"]),
        };
        let value = serde_json::to_value(draft).expect("draft must serialize");
        assert!(!value
            .as_object()
            .expect("draft wire is tagged object")
            .keys()
            .any(|key| key.starts_with("accepted")));
        let mut with_answer = value;
        with_answer["acceptedSelections"] = json!([["t1"]]);
        assert!(serde_json::from_value::<AnalysisDraft>(with_answer).is_err());
        for feedback in [
            AnalysisFeedbackState::Incomplete,
            AnalysisFeedbackState::Incorrect,
        ] {
            assert!(matches!(
                serde_json::to_value(feedback).unwrap(),
                Value::String(_)
            ));
        }
        let token = crate::game::analysis::AnalysisActionToken {
            scene_id: "analysis_table".into(),
            active_board_id: Some("threshold_board".into()),
            durable_revision: 3,
        };
        assert_eq!(
            serde_json::to_value(token).unwrap(),
            json!({"sceneId": "analysis_table", "activeBoardId": "threshold_board", "durableRevision": 3})
        );
        let mut token_with_unknown =
            serde_json::to_value(crate::game::analysis::AnalysisActionToken {
                scene_id: "analysis_table".into(),
                active_board_id: None,
                durable_revision: 3,
            })
            .unwrap();
        token_with_unknown["unexpected"] = json!(true);
        assert!(
            serde_json::from_value::<crate::game::analysis::AnalysisActionToken>(
                token_with_unknown
            )
            .is_err()
        );
    }

    #[derive(Default)]
    struct StoryUnlockFixture {
        completed_boards: BTreeSet<(String, String, String)>,
    }

    impl StoryUnlockContext for StoryUnlockFixture {
        fn fact_asserted(&self, _id: &str) -> bool {
            false
        }

        fn question_resolved(&self, _id: &str) -> bool {
            false
        }

        fn objective_completed(&self, _id: &str) -> bool {
            false
        }

        fn analysis_scene_completed(&self, _chapter_id: &str, _scene_id: &str) -> bool {
            false
        }

        fn analysis_board_completed(
            &self,
            chapter_id: &str,
            scene_id: &str,
            board_id: &str,
        ) -> bool {
            self.completed_boards.contains(&(
                chapter_id.to_owned(),
                scene_id.to_owned(),
                board_id.to_owned(),
            ))
        }

        fn authorization_granted(&self, _id: &str) -> bool {
            false
        }
    }

    fn non_sequential_scene() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_scene_non_sequential",
            "title": "Non-sequential",
            "summary": "Task 3 lifecycle",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [
                {
                    "kind": "threshold",
                    "common": {
                        "id": "board_first",
                        "label": "First",
                        "prompt": "First",
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
                        "id": "board_later",
                        "label": "Later",
                        "prompt": "Later",
                        "unlock": {
                            "predicate": "analysis_board_completed",
                            "chapterId": "chapter_9",
                            "sceneId": "analysis_scene_non_sequential",
                            "boardId": "board_first"
                        },
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
        .expect("non-sequential analysis fixture must deserialize")
    }

    #[test]
    fn auto_focus_uses_story_unlocks_and_authored_order_without_chapter_hardcoding() {
        let mut state = AnalysisSceneState::from_json(non_sequential_scene(), 1);
        let mut story = StoryUnlockFixture::default();

        state.recompute_available_board_ids(&story);
        assert_eq!(state.available_board_ids, ids(&["board_first"]));
        assert_eq!(
            state.auto_focus_next_available_incomplete_board("chapter_9", &story),
            Some("board_first".into())
        );

        story.completed_boards.insert((
            "chapter_9".into(),
            "analysis_scene_non_sequential".into(),
            "board_first".into(),
        ));
        state.recompute_available_board_ids(&story);
        assert_eq!(
            state.available_board_ids,
            ids(&["board_first", "board_later"])
        );
        assert_eq!(
            state.auto_focus_next_available_incomplete_board("chapter_9", &story),
            Some("board_later".into())
        );
        assert_eq!(state.active_board_id.as_deref(), Some("board_later"));
    }

    #[test]
    fn availability_recompute_does_not_union_prior_cache_or_use_local_context() {
        let mut state = AnalysisSceneState::from_json(table_scene(), 1);
        state.available_board_ids = ids(&["stale_board", "order_board"]);
        state.recompute_available_board_ids(&StoryState::default());
        assert_eq!(
            state.available_board_ids,
            ids(&["classify_board", "threshold_board"])
        );
    }

    #[test]
    fn order_board_rejects_draft_when_fixed_anchor_position_is_zero() {
        let mut def = table_scene();
        if let crate::game::schema::AnalysisBoardJson::Order { fixed_anchors, .. } =
            &mut def.boards[1]
        {
            fixed_anchors[0].position = 0;
        }
        let state = AnalysisSceneState::from_json(def, 1);
        let draft = AnalysisDraft::Order {
            card_ids: vec!["o1".into(), "o2".into(), "o3".into()],
        };
        let error = state
            .validate_draft("order_board", &draft)
            .expect_err("anchor with position 0 must be rejected");
        assert_eq!(error.code, "analysisSelectionInvalid");
    }

    #[test]
    fn order_board_rejects_draft_when_anchor_position_exceeds_card_count() {
        let mut def = table_scene();
        if let crate::game::schema::AnalysisBoardJson::Order { fixed_anchors, .. } =
            &mut def.boards[1]
        {
            fixed_anchors[0].position = 99;
        }
        let state = AnalysisSceneState::from_json(def, 1);
        let draft = AnalysisDraft::Order {
            card_ids: vec!["o1".into(), "o2".into(), "o3".into()],
        };
        let error = state
            .validate_draft("order_board", &draft)
            .expect_err("anchor position exceeding card count must be rejected");
        assert_eq!(error.code, "analysisSelectionInvalid");
    }

    #[test]
    fn order_board_rejects_draft_when_anchor_card_position_mismatches() {
        let state = AnalysisSceneState::from_json(table_scene(), 1);
        // The fixed anchor says o1 must be at position 1, but we put it at
        // position 2 (index 1).
        let draft = AnalysisDraft::Order {
            card_ids: vec!["o2".into(), "o1".into(), "o3".into()],
        };
        let error = state
            .validate_draft("order_board", &draft)
            .expect_err("anchor card position mismatch must be rejected");
        assert_eq!(error.code, "analysisSelectionInvalid");
    }

    #[test]
    fn order_board_rejects_non_order_draft_with_kind_mismatch() {
        let state = AnalysisSceneState::from_json(table_scene(), 1);
        let draft = AnalysisDraft::Threshold {
            selected_card_ids: ids(&["o1"]),
        };
        let error = state
            .validate_draft("order_board", &draft)
            .expect_err("threshold draft on order board must be rejected");
        assert_eq!(error.code, "analysisBoardKindMismatch");
        assert!(error.message.contains("order"));
    }

    #[test]
    fn story_unlock_fixture_evaluates_all_story_predicate_kinds() {
        let scene = serde_json::from_value(json!({
            "id": "unlock_predicate_coverage",
            "title": "Unlock predicates",
            "summary": "Exercises every StoryUnlockContext method",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [
                {
                    "kind": "threshold",
                    "common": {
                        "id": "fact_board",
                        "label": "F", "prompt": "F",
                        "unlock": {"predicate": "fact_asserted", "id": "fact_1"},
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
                        "id": "question_board",
                        "label": "Q", "prompt": "Q",
                        "unlock": {"predicate": "question_resolved", "id": "question_1"},
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
                        "id": "objective_board",
                        "label": "O", "prompt": "O",
                        "unlock": {"predicate": "objective_completed", "id": "objective_1"},
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
                        "id": "scene_board",
                        "label": "S", "prompt": "S",
                        "unlock": {
                            "predicate": "analysis_scene_completed",
                            "chapterId": "chapter_1",
                            "sceneId": "prior_scene"
                        },
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
                        "id": "auth_board",
                        "label": "A", "prompt": "A",
                        "unlock": {"predicate": "authorization_granted", "id": "auth_1"},
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
        .expect("unlock predicate scene must deserialize");
        let state = AnalysisSceneState::from_json(scene, 1);
        let story = StoryUnlockFixture::default();
        // Every board has a story unlock predicate that StoryUnlockFixture
        // answers with false, so none should be available.
        let available = state.compute_available_board_ids(&story);
        assert!(
            available.is_empty(),
            "all boards should be locked when no story predicates are satisfied"
        );
    }
}
