use crate::game::analysis::{AnalysisDraft, AnalysisFeedbackState};
use crate::game::dialogue_queue::ActiveDialogueQueue;
use crate::game::schema::{AnalysisBoardJson, AnalysisSceneJson};
use crate::game::unlock::{self, StoryUnlockContext};
use crate::game::GameError;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const RESTORED_CONSUMED_INTRO_QUEUE_GEN: u64 = 0;

/// Compatibility alias for the inherited command seam.  New callers should
/// pass `AnalysisDraft` directly; keeping this alias avoids introducing a
/// second board-kind-specific input wire while the public command migration
/// remains owned by later HPA-260 tasks.
pub type AnalysisSubmission = AnalysisDraft;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnalysisSubmissionOutcome {
    Correct,
    /// Transitional command output.  Runtime state stores only the neutral
    /// `AnalysisFeedbackState`; the authored copy is reconstructed at the
    /// public boundary until the command/view migration lands.
    Feedback(String),
}

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

    /// Transitional authored-order projection.  It deliberately does not
    /// infer completion from drafts; HPA-260 Task 3/4 callers use StoryState
    /// completion refs when selecting the next board.
    pub fn next_unlocked_board_id(&self, story: &impl StoryUnlockContext) -> Option<String> {
        self.def
            .boards
            .iter()
            .find(|board| self.is_board_unlocked(board, story))
            .map(|board| board.common().id.clone())
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

    /// Transitional compatibility method.  Scene-local completion was removed
    /// from the authority in Task 2; this method remains only so the inherited
    /// navigation code can be migrated without adding a second mutable set.
    pub fn is_board_completed(&self, _board_id: &str) -> bool {
        false
    }

    pub fn all_boards_completed(&self) -> bool {
        false
    }

    /// Practice material is no longer runtime progression state.  The old
    /// handoff hook is a no-op until the neutral public workbench owns card
    /// availability in the later command migration.
    pub fn record_practice_card(&mut self, _id: &str) {}

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
                for anchor in fixed_anchors {
                    if anchor.position == 0 {
                        return Err(GameError::analysis_selection_invalid(board_id));
                    }
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

    /// Transitional threshold-only command adapter.  It stores the neutral
    /// Threshold draft and returns authored feedback for the inherited command
    /// caller; no board-kind-specific map is retained.
    pub fn set_threshold_selection(
        &mut self,
        board_id: &str,
        selected_card_ids: BTreeSet<String>,
    ) -> Result<(), GameError> {
        let draft = AnalysisDraft::Threshold { selected_card_ids };
        self.validate_draft(board_id, &draft)?;
        if !matches!(
            self.board(board_id),
            Some(AnalysisBoardJson::Threshold { .. })
        ) {
            return Err(GameError::analysis_board_kind_mismatch(
                board_id,
                "threshold",
            ));
        }
        self.drafts.insert(board_id.to_owned(), draft);
        self.feedback_by_board_id.remove(board_id);
        Ok(())
    }

    /// Transitional whole-draft submit adapter used by the inherited engine
    /// command.  Story completion remains owned by `StoryState`; this method
    /// only evaluates the neutral input and stores typed failure feedback.
    pub fn submit(
        &mut self,
        board_id: &str,
        submission: AnalysisSubmission,
    ) -> Result<AnalysisSubmissionOutcome, GameError> {
        self.validate_draft(board_id, &submission)?;
        self.drafts.insert(board_id.to_owned(), submission.clone());
        let complete = self.draft_is_complete(board_id, &submission)?;
        let correct = complete && self.draft_is_correct(board_id, &submission)?;
        let board = self
            .board(board_id)
            .ok_or_else(|| GameError::unknown_analysis_board(board_id))?;
        if !complete {
            let feedback = board.common().feedback.incomplete.clone();
            self.feedback_by_board_id
                .insert(board_id.to_owned(), AnalysisFeedbackState::Incomplete);
            return Ok(AnalysisSubmissionOutcome::Feedback(feedback));
        }
        if !correct {
            let feedback = board.common().feedback.incorrect.clone();
            self.feedback_by_board_id
                .insert(board_id.to_owned(), AnalysisFeedbackState::Incorrect);
            return Ok(AnalysisSubmissionOutcome::Feedback(feedback));
        }
        self.feedback_by_board_id.remove(board_id);
        Ok(AnalysisSubmissionOutcome::Correct)
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
}
