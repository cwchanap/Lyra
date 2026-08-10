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

impl AnalysisDraft {
    /// Return every card ID referenced by this draft, regardless of board
    /// kind.  Used by availability validation to check each referenced card
    /// against the persistent inventory.
    pub fn card_ids(&self) -> Vec<&str> {
        match self {
            AnalysisDraft::Classify { group_by_card } => {
                group_by_card.keys().map(String::as_str).collect()
            }
            AnalysisDraft::Order { card_ids } => card_ids.iter().map(String::as_str).collect(),
            AnalysisDraft::Threshold { selected_card_ids } => {
                selected_card_ids.iter().map(String::as_str).collect()
            }
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_draft_with_duplicate_card_ids_is_rejected() {
        let json = serde_json::json!({
            "kind": "order",
            "cardIds": ["card_a", "card_a"],
        });
        let error = serde_json::from_value::<AnalysisDraft>(json)
            .expect_err("duplicate order card IDs must be rejected");
        let message = error.to_string();
        assert!(
            message.contains("duplicate card IDs"),
            "error must mention duplicate card IDs: {message}"
        );
    }

    #[test]
    fn threshold_draft_with_duplicate_card_ids_is_rejected() {
        let json = serde_json::json!({
            "kind": "threshold",
            "selectedCardIds": ["card_a", "card_a"],
        });
        let error = serde_json::from_value::<AnalysisDraft>(json)
            .expect_err("duplicate threshold card IDs must be rejected");
        let message = error.to_string();
        assert!(
            message.contains("duplicate card IDs"),
            "error must mention duplicate card IDs: {message}"
        );
    }

    #[test]
    fn classify_draft_round_trips_through_serde() {
        let draft = AnalysisDraft::Classify {
            group_by_card: BTreeMap::from([("card_a".into(), "group_1".into())]),
        };
        let json = serde_json::to_value(&draft).unwrap();
        let restored: AnalysisDraft = serde_json::from_value(json).unwrap();
        assert_eq!(draft, restored);
    }

    #[test]
    fn order_draft_without_duplicates_round_trips_through_serde() {
        let draft = AnalysisDraft::Order {
            card_ids: vec!["card_a".into(), "card_b".into()],
        };
        let json = serde_json::to_value(&draft).unwrap();
        let restored: AnalysisDraft = serde_json::from_value(json).unwrap();
        assert_eq!(draft, restored);
    }

    #[test]
    fn threshold_draft_without_duplicates_round_trips_through_serde() {
        let draft = AnalysisDraft::Threshold {
            selected_card_ids: BTreeSet::from(["card_a".into(), "card_b".into()]),
        };
        let json = serde_json::to_value(&draft).unwrap();
        let restored: AnalysisDraft = serde_json::from_value(json).unwrap();
        assert_eq!(draft, restored);
    }
}
