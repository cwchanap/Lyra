// src-tauri/src/game/state.rs
use crate::game::schema::{DialogueItem, EvidenceJson, StatementJson};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub details: String,
    pub image_asset_id: Option<String>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
    pub collected_in_chapter_id: String,
    pub collected_in_scene_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementRecord {
    pub id: String,
    pub speaker: String,
    pub content: String,
    pub on_reexamine: Option<Vec<DialogueItem>>,
    pub acquired_in_chapter_id: String,
    pub acquired_in_scene_id: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub evidence: Vec<EvidenceRecord>,
    pub statements: Vec<StatementRecord>,
}

impl Inventory {
    pub fn has_evidence(&self, id: &str) -> bool {
        self.evidence.iter().any(|e| e.id == id)
    }
    pub fn has_statement(&self, id: &str) -> bool {
        self.statements.iter().any(|s| s.id == id)
    }
    pub fn add_evidence_from_def(
        &mut self,
        def: &EvidenceJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> bool {
        if self.has_evidence(&def.id) {
            return false;
        }
        self.evidence.push(EvidenceRecord {
            id: def.id.clone(),
            name: def.name.clone(),
            description: def.description.clone(),
            details: def.details.clone(),
            image_asset_id: def.image_asset_id.clone(),
            on_reexamine: def.on_reexamine.clone(),
            collected_in_chapter_id: chapter_id.into(),
            collected_in_scene_id: scene_id.into(),
        });
        true
    }
    pub fn add_statement_from_def(
        &mut self,
        def: &StatementJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> bool {
        if self.has_statement(&def.id) {
            return false;
        }
        self.statements.push(StatementRecord {
            id: def.id.clone(),
            speaker: def.speaker.clone(),
            content: def.content.clone(),
            on_reexamine: def.on_reexamine.clone(),
            acquired_in_chapter_id: chapter_id.into(),
            acquired_in_scene_id: scene_id.into(),
        });
        true
    }
}

#[derive(Debug, Clone)]
pub struct ChapterManifest {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub scenes: Vec<SceneRef>,
}

#[derive(Debug, Clone)]
pub struct SceneRef {
    pub scene_type: crate::game::schema::SceneType,
    pub file: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn def(id: &str) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: id.into(),
            description: id.into(),
            details: id.into(),
            image_asset_id: None,
            on_collect: vec![],
            on_reexamine: None,
        }
    }

    #[test]
    fn inventory_dedupes_evidence_on_double_add() {
        let mut inv = Inventory::default();
        assert!(inv.add_evidence_from_def(&def("foo"), "chapter_1", "scene_1"));
        assert!(!inv.add_evidence_from_def(&def("foo"), "chapter_1", "scene_1"));
        assert_eq!(inv.evidence.len(), 1);
        assert!(inv.has_evidence("foo"));
    }
}
