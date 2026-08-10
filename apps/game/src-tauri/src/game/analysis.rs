use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The one mutable input shape shared by Analysis commands, runtime state,
/// saves, and public views.  Definitions keep answer material private; a
/// draft contains only the player's current workbench input.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum AnalysisDraftWire {
    Classify {
        group_by_card: BTreeMap<String, String>,
    },
    Order {
        card_ids: Vec<String>,
    },
    Threshold {
        selected_card_ids: Vec<String>,
    },
}

impl<'de> Deserialize<'de> for AnalysisDraft {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = AnalysisDraftWire::deserialize(deserializer)?;
        match wire {
            AnalysisDraftWire::Classify { group_by_card } => Ok(Self::Classify { group_by_card }),
            AnalysisDraftWire::Order { card_ids } => {
                if card_ids.iter().collect::<BTreeSet<_>>().len() != card_ids.len() {
                    return Err(serde::de::Error::custom(
                        "Analysis order draft contains duplicate card IDs.",
                    ));
                }
                Ok(Self::Order { card_ids })
            }
            AnalysisDraftWire::Threshold { selected_card_ids } => {
                if selected_card_ids.iter().collect::<BTreeSet<_>>().len()
                    != selected_card_ids.len()
                {
                    return Err(serde::de::Error::custom(
                        "Analysis threshold draft contains duplicate card IDs.",
                    ));
                }
                Ok(Self::Threshold {
                    selected_card_ids: selected_card_ids.into_iter().collect(),
                })
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnalysisFeedbackState {
    Incomplete,
    Incorrect,
}

/// Fence returned with Analysis views and echoed by workbench mutations.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisActionToken {
    pub scene_id: String,
    pub active_board_id: Option<String>,
    pub durable_revision: u64,
}
