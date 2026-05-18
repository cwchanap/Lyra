// src-tauri/src/game/view.rs
use serde::{Deserialize, Serialize};
use crate::game::schema::DialogueItem;
use crate::game::state::Inventory;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStateView {
    pub mode: ModeView,
    pub chapter: ChapterView,
    pub scene: SceneView,
    pub inventory: Inventory,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ModeView {
    Dialogue {
        current: DialogueItem,
        queue_remaining: usize,
        scene_tag: Option<String>,
        queue_token: QueueToken,
    },
    Explore { sublocation_id: String },
    GameComplete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueToken {
    pub scene_id: String,
    pub queue_gen: u64,
    pub cursor: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterView {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub index: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SceneView {
    Linear { id: String, title: String, index: usize, total: usize },
    Investigation {
        id: String,
        title: String,
        index: usize,
        total: usize,
        current_sublocation_id: Option<String>,
        visible_sublocations: Vec<SublocationView>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SublocationView {
    pub id: String,
    pub label: String,
    pub scene_tag: String,
    pub hotspots: Vec<HotspotView>,
    pub characters: Vec<CharacterView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotView {
    pub id: String,
    pub label: String,
    pub description: String,
    pub inspected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterView {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
    pub topics: Vec<TopicView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicView {
    pub id: String,
    pub label: String,
    pub discussed: bool,
}
