use std::collections::HashSet;

use crate::game::schema::InterrogationSceneJson;

#[derive(Debug, Clone)]
pub struct InterrogationSceneState {
    pub def: InterrogationSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub intro_queue_gen: u64,
    pub answered_questions: HashSet<String>,
    pub completed_phases: HashSet<String>,
    pub unlocked_overrides: HashSet<String>,
}

impl InterrogationSceneState {
    pub fn from_json(def: InterrogationSceneJson, intro_queue_gen: u64) -> Self {
        Self {
            def,
            intro_played: false,
            outro_played: false,
            intro_queue_gen,
            answered_questions: HashSet::new(),
            completed_phases: HashSet::new(),
            unlocked_overrides: HashSet::new(),
        }
    }

    pub fn id(&self) -> &str {
        &self.def.id
    }
    pub fn title(&self) -> &str {
        &self.def.title
    }

    pub fn unlock_override(&mut self, key: &str) {
        self.unlocked_overrides.insert(key.into());
    }
}
