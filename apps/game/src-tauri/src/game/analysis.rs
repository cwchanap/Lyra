use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The one mutable input shape shared by Analysis commands, runtime state,
/// saves, and public views.  Definitions keep answer material private; a
/// draft contains only the player's current workbench input.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AnalysisDraft {
    Classify {
        group_by_card: BTreeMap<String, String>,
    },
    Order {
        card_ids: Vec<String>,
    },
    Threshold {
        selected_card_ids: BTreeSet<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnalysisFeedbackState {
    Incomplete,
    Incorrect,
}

/// Fence returned with Analysis views and echoed by workbench mutations.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisActionToken {
    pub scene_id: String,
    pub active_board_id: Option<String>,
    pub durable_revision: u64,
}
