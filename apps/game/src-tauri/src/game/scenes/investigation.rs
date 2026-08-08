// src-tauri/src/game/scenes/investigation.rs
use crate::game::dialogue_queue::ActiveDialogueQueue;
use crate::game::schema::{InvestigationSceneJson, LockStatus, OutroUnlock, UnlockExpr};
use crate::game::unlock::{self, StoryUnlockContext, UnlockContext};
use std::collections::{BTreeSet, HashSet};

pub(crate) const RESTORED_CONSUMED_INTRO_QUEUE_GEN: u64 = 0;

#[derive(Debug, Clone)]
pub struct InvestigationSceneState {
    pub def: InvestigationSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub current_sublocation_id: Option<String>,
    pub(crate) pending_queue: Option<ActiveDialogueQueue>,
    pub intro_queue_gen: u64,
    pub inspected_hotspots: HashSet<String>,
    pub discussed_topics: HashSet<(String, String)>,
    pub entered_sublocations: HashSet<String>,
    pub unlocked_overrides: HashSet<String>,
    /// Tutorial-only cards collected in this investigation. They are copied to
    /// the immediately following analysis scene and are never Case File
    /// records.
    pub practice_card_ids: BTreeSet<String>,
}

impl InvestigationSceneState {
    pub fn from_json(def: InvestigationSceneJson, intro_queue_gen: u64) -> Self {
        Self {
            def,
            intro_played: false,
            outro_played: false,
            current_sublocation_id: None,
            pending_queue: None,
            intro_queue_gen,
            inspected_hotspots: HashSet::new(),
            discussed_topics: HashSet::new(),
            entered_sublocations: HashSet::new(),
            unlocked_overrides: HashSet::new(),
            practice_card_ids: BTreeSet::new(),
        }
    }

    pub fn id(&self) -> &str {
        &self.def.id
    }
    pub fn title(&self) -> &str {
        &self.def.title
    }

    pub fn outro_satisfied(
        &self,
        local: &impl UnlockContext,
        story: &impl StoryUnlockContext,
    ) -> bool {
        match &self.def.outro.unlock {
            OutroUnlock::Auto(_) => {
                self.all_unlocked_hotspots_inspected(local, story)
                    && self.all_unlocked_topics_discussed(local, story)
            }
            OutroUnlock::Expr(expr) => unlock::evaluate(expr, local, story),
        }
    }

    fn all_unlocked_hotspots_inspected(
        &self,
        local: &impl UnlockContext,
        story: &impl StoryUnlockContext,
    ) -> bool {
        for sub in &self.def.sublocations {
            if !self.is_sublocation_unlocked(&sub.id, local, story) {
                continue;
            }
            for h in &sub.hotspots {
                if self.is_block_unlocked(
                    &format!("hotspot:{}", h.id),
                    h.status,
                    h.unlock.as_ref(),
                    local,
                    story,
                ) && !self.inspected_hotspots.contains(&h.id)
                {
                    return false;
                }
            }
        }
        true
    }

    fn all_unlocked_topics_discussed(
        &self,
        local: &impl UnlockContext,
        story: &impl StoryUnlockContext,
    ) -> bool {
        for sub in &self.def.sublocations {
            if !self.is_sublocation_unlocked(&sub.id, local, story) {
                continue;
            }
            for c in &sub.characters {
                for t in &c.topics {
                    if self.is_block_unlocked(
                        &format!("topic:{}@{}", c.id, t.id),
                        t.status,
                        t.unlock.as_ref(),
                        local,
                        story,
                    ) && !self
                        .discussed_topics
                        .contains(&(c.id.clone(), t.id.clone()))
                    {
                        return false;
                    }
                }
            }
        }
        true
    }

    pub fn is_sublocation_unlocked(
        &self,
        id: &str,
        local: &impl UnlockContext,
        story: &impl StoryUnlockContext,
    ) -> bool {
        let key = format!("sublocation:{id}");
        let def = self.def.sublocations.iter().find(|s| s.id == id);
        match def {
            None => false,
            Some(s) => self.is_block_unlocked(&key, s.status, s.unlock.as_ref(), local, story),
        }
    }

    pub fn is_block_unlocked(
        &self,
        key: &str,
        status: LockStatus,
        unlock: Option<&UnlockExpr>,
        local: &impl UnlockContext,
        story: &impl StoryUnlockContext,
    ) -> bool {
        match status {
            LockStatus::Unlocked => true,
            LockStatus::Locked => {
                if self.unlocked_overrides.contains(key) {
                    return true;
                }
                match unlock {
                    Some(expr) => unlock::evaluate(expr, local, story),
                    None => false,
                }
            }
        }
    }

    pub fn record_inspect(&mut self, hotspot_id: &str) {
        self.inspected_hotspots.insert(hotspot_id.into());
    }
    pub fn record_topic_discussed(&mut self, character_id: &str, topic_id: &str) {
        self.discussed_topics
            .insert((character_id.into(), topic_id.into()));
    }
    pub fn record_sublocation_entered(&mut self, id: &str) {
        self.entered_sublocations.insert(id.into());
    }
    pub fn unlock_override(&mut self, key: &str) {
        self.unlocked_overrides.insert(key.into());
    }
    pub fn record_practice_card(&mut self, id: &str) {
        self.practice_card_ids.insert(id.into());
    }
}

impl UnlockContext for InvestigationSceneState {
    fn evidence_collected(&self, _id: &str) -> bool {
        false
    }
    fn statement_acquired(&self, _id: &str) -> bool {
        false
    }
    fn topic_discussed(&self, c: &str, t: &str) -> bool {
        self.discussed_topics
            .contains(&(c.to_string(), t.to_string()))
    }
    fn hotspot_investigated(&self, id: &str) -> bool {
        self.inspected_hotspots.contains(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_inspect_marks_hotspot() {
        let mut s = InvestigationSceneState {
            def: InvestigationSceneJson {
                id: "i".into(),
                title: "i".into(),
                summary: "Summary".into(),
                asset_refs: vec![],
                intro: vec![],
                sublocations: vec![],
                evidence_manifest: vec![],
                statement_manifest: vec![],
                outro: crate::game::schema::OutroJson {
                    unlock: OutroUnlock::Auto(crate::game::schema::AutoMarker::Auto),
                    dialogue: vec![],
                },
            },
            intro_played: false,
            outro_played: false,
            current_sublocation_id: None,
            pending_queue: None,
            intro_queue_gen: 1,
            inspected_hotspots: HashSet::new(),
            discussed_topics: HashSet::new(),
            entered_sublocations: HashSet::new(),
            unlocked_overrides: HashSet::new(),
            practice_card_ids: BTreeSet::new(),
        };
        s.record_inspect("foo");
        assert!(s.inspected_hotspots.contains("foo"));
    }
}
