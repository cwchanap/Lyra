// src-tauri/src/game/view.rs
use crate::game::schema::{
    AudioChannelJson, CharacterLayoutJson, DialogueItem, HotspotLayoutJson, SceneType,
};
use crate::game::state::Inventory;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStateView {
    pub mode: ModeView,
    pub chapter: ChapterView,
    pub scene: SceneView,
    pub inventory: Inventory,
    pub dialogue_history: Vec<DialogueHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DialogueHistoryEntry {
    Line {
        id: u64,
        speaker: String,
        text: String,
        chapter_title: String,
        scene_title: String,
    },
    Action {
        id: u64,
        text: String,
        chapter_title: String,
        scene_title: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModeView {
    Dialogue {
        current: DialogueItem,
        queue_remaining: usize,
        scene_tag: Option<String>,
        background_asset_id: Option<String>,
        bgm: Option<AudioCueView>,
        bgs: Option<AudioCueView>,
        queue_token: QueueToken,
        /// While an interrogation testimony plays in the dialogue box, the id
        /// of the (not-yet-broken) line the inline `反駁` challenge targets.
        /// `None` for every other dialogue (linear/investigation scenes, the
        /// challenge lead-in, on-correct reveals, honest-question testimony).
        cross_exam_line_id: Option<String>,
    },
    Explore {
        sublocation_id: String,
        background_asset_id: Option<String>,
        bgm: Option<AudioCueView>,
        bgs: Option<AudioCueView>,
    },
    Interrogation {
        phase_id: String,
        background_asset_id: Option<String>,
        bgm: Option<AudioCueView>,
        bgs: Option<AudioCueView>,
    },
    GameComplete,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCueView {
    pub channel: AudioChannelJson,
    pub asset_id: Option<String>,
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
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SceneView {
    Linear {
        id: String,
        title: String,
        index: usize,
        total: usize,
    },
    Investigation {
        id: String,
        title: String,
        index: usize,
        total: usize,
        current_sublocation_id: Option<String>,
        visible_sublocations: Vec<SublocationView>,
    },
    Interrogation {
        id: String,
        title: String,
        index: usize,
        total: usize,
        current_phase_id: Option<String>,
        visible_phases: Vec<InterrogationPhaseView>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationIndex {
    pub chapters: Vec<SceneNavigationChapter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationChapter {
    pub id: String,
    pub title: String,
    pub index: usize,
    pub scenes: Vec<SceneNavigationScene>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneNavigationScene {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub scene_type: SceneType,
    pub index: usize,
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
    pub layout: Option<HotspotLayoutJson>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterView {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
    pub layout: Option<CharacterLayoutJson>,
    pub topics: Vec<TopicView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicView {
    pub id: String,
    pub label: String,
    pub discussed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterrogationPhaseView {
    pub id: String,
    pub label: String,
    pub subject: SubjectView,
    pub questions: Vec<InquiryQuestionView>,
    /// Some when a testimony is actively being cross-examined (playing a
    /// line or presenting evidence); None while the player is at the
    /// question menu.
    pub cross_exam: Option<CrossExamView>,
    /// True when the player may manually complete this (current) phase: it is
    /// the current `Auto` phase, no cross-examination is active, and every
    /// required question is broken. Drives the "完成訊問" button.
    pub can_complete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectView {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InquiryQuestionView {
    pub id: String,
    pub label: String,
    pub broken: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossExamView {
    pub question_id: String,
    pub line_id: String,
    pub line_label: String,
    /// Echoed current line, rendered in DialogueBox styling.
    pub line_content: Vec<DialogueItem>,
    pub line_index: usize,
    pub line_total: usize,
    /// True when the evidence tray should be shown.
    pub presenting: bool,
}
