// src-tauri/src/game/reveals.rs
use crate::game::scenes::interrogation::InterrogationSceneState;
use crate::game::scenes::investigation::InvestigationSceneState;
use crate::game::schema::{DialogueItem, InterrogationRevealTarget, RevealTarget};
use crate::game::state::Inventory;

pub fn apply_reveals_and_build_queue(
    scene: &mut InvestigationSceneState,
    inventory: &mut Inventory,
    trigger_body: Vec<DialogueItem>,
    reveals: &[RevealTarget],
    chapter_id: &str,
) -> Vec<DialogueItem> {
    let mut queue = trigger_body;
    for r in reveals {
        match r {
            RevealTarget::Evidence { id } => {
                if let Some(def) = scene.def.evidence_manifest.iter().find(|e| e.id == *id) {
                    let newly_added =
                        inventory.add_evidence_from_def(def, chapter_id, &scene.def.id);
                    if newly_added {
                        queue.extend(def.on_collect.iter().cloned());
                    }
                }
            }
            RevealTarget::Statement { id } => {
                if let Some(def) = scene.def.statement_manifest.iter().find(|s| s.id == *id) {
                    let newly_added =
                        inventory.add_statement_from_def(def, chapter_id, &scene.def.id);
                    if newly_added {
                        queue.extend(def.on_acquire.iter().cloned());
                    }
                }
            }
            RevealTarget::Topic {
                character_id,
                topic_id,
            } => {
                scene.unlock_override(&format!("topic:{character_id}@{topic_id}"));
            }
            RevealTarget::Hotspot { id } => {
                scene.unlock_override(&format!("hotspot:{id}"));
            }
            RevealTarget::Sublocation { id } => {
                scene.unlock_override(&format!("sublocation:{id}"));
            }
        }
    }
    queue
}

pub fn apply_interrogation_reveals_and_build_queue(
    scene: &mut InterrogationSceneState,
    inventory: &mut Inventory,
    trigger_body: Vec<DialogueItem>,
    reveals: &[InterrogationRevealTarget],
    chapter_id: &str,
) -> Vec<DialogueItem> {
    let mut queue = trigger_body;
    for r in reveals {
        match r {
            InterrogationRevealTarget::Evidence { id } => {
                if let Some(def) = scene.def.evidence_manifest.iter().find(|e| e.id == *id) {
                    let newly_added =
                        inventory.add_evidence_from_def(def, chapter_id, &scene.def.id);
                    if newly_added {
                        queue.extend(def.on_collect.iter().cloned());
                    }
                }
            }
            InterrogationRevealTarget::Statement { id } => {
                if let Some(def) = scene.def.statement_manifest.iter().find(|s| s.id == *id) {
                    let newly_added =
                        inventory.add_statement_from_def(def, chapter_id, &scene.def.id);
                    if newly_added {
                        queue.extend(def.on_acquire.iter().cloned());
                    }
                }
            }
            InterrogationRevealTarget::Question { id } => {
                scene.unlock_override(&format!("question:{id}"));
            }
            InterrogationRevealTarget::Phase { id } => {
                scene.unlock_override(&format!("phase:{id}"));
            }
        }
    }
    queue
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        AutoMarker, EvidenceJson, InterrogationOutroJson, InterrogationOutroUnlock,
        InterrogationSceneJson, InvestigationSceneJson, OutroJson, OutroUnlock,
    };

    fn evidence_def(id: &str) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: id.into(),
            description: id.into(),
            details: id.into(),
            image_asset_id: None,
            on_collect: vec![DialogueItem::Line {
                speaker: "A".into(),
                text: format!("collected {id}"),
                portrait: None,
            }],
            on_reexamine: None,
        }
    }

    fn empty_scene_with_evidence(defs: Vec<EvidenceJson>) -> InvestigationSceneState {
        InvestigationSceneState::from_json(
            InvestigationSceneJson {
                id: "i".into(),
                title: "i".into(),
                asset_refs: vec![],
                intro: vec![],
                sublocations: vec![],
                evidence_manifest: defs,
                statement_manifest: vec![],
                outro: OutroJson {
                    unlock: OutroUnlock::Auto(AutoMarker::Auto),
                    dialogue: vec![],
                },
            },
            1,
        )
    }

    fn empty_interrogation_scene_with_evidence(defs: Vec<EvidenceJson>) -> InterrogationSceneState {
        InterrogationSceneState::from_json(
            InterrogationSceneJson {
                id: "interrogation".into(),
                title: "interrogation".into(),
                asset_refs: vec![],
                intro: vec![],
                phases: vec![],
                evidence_manifest: defs,
                statement_manifest: vec![],
                outro: InterrogationOutroJson {
                    unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                    dialogue: vec![],
                },
            },
            1,
        )
    }

    #[test]
    fn reveals_evidence_appends_on_collect_to_queue() {
        let mut scene = empty_scene_with_evidence(vec![evidence_def("coffee")]);
        let mut inv = Inventory::default();
        let queue = apply_reveals_and_build_queue(
            &mut scene,
            &mut inv,
            vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "trigger".into(),
                portrait: None,
            }],
            &[RevealTarget::Evidence {
                id: "coffee".into(),
            }],
            "chapter_1",
        );
        assert_eq!(queue.len(), 2);
        assert!(inv.has_evidence("coffee"));
    }

    #[test]
    fn double_reveal_of_same_evidence_does_not_double_append() {
        let mut scene = empty_scene_with_evidence(vec![evidence_def("coffee")]);
        let mut inv = Inventory::default();
        let _ = apply_reveals_and_build_queue(
            &mut scene,
            &mut inv,
            vec![],
            &[RevealTarget::Evidence {
                id: "coffee".into(),
            }],
            "chapter_1",
        );
        let queue2 = apply_reveals_and_build_queue(
            &mut scene,
            &mut inv,
            vec![],
            &[RevealTarget::Evidence {
                id: "coffee".into(),
            }],
            "chapter_1",
        );
        assert!(queue2.is_empty());
    }

    #[test]
    fn reveals_sublocation_silently_unlocks_it() {
        let mut scene = empty_scene_with_evidence(vec![]);
        let mut inv = Inventory::default();
        let queue = apply_reveals_and_build_queue(
            &mut scene,
            &mut inv,
            vec![],
            &[RevealTarget::Sublocation {
                id: "back_room".into(),
            }],
            "chapter_1",
        );
        assert!(queue.is_empty());
        assert!(scene.unlocked_overrides.contains("sublocation:back_room"));
    }

    #[test]
    fn interrogation_reveals_evidence_appends_on_collect_to_queue() {
        let mut scene = empty_interrogation_scene_with_evidence(vec![evidence_def("receipt")]);
        let mut inv = Inventory::default();
        let queue = apply_interrogation_reveals_and_build_queue(
            &mut scene,
            &mut inv,
            vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "trigger".into(),
                portrait: None,
            }],
            &[InterrogationRevealTarget::Evidence {
                id: "receipt".into(),
            }],
            "chapter_1",
        );
        assert_eq!(queue.len(), 2);
        assert!(inv.has_evidence("receipt"));
    }

    #[test]
    fn interrogation_reveals_question_and_phase_unlock_overrides() {
        let mut scene = empty_interrogation_scene_with_evidence(vec![]);
        let mut inv = Inventory::default();
        let queue = apply_interrogation_reveals_and_build_queue(
            &mut scene,
            &mut inv,
            vec![],
            &[
                InterrogationRevealTarget::Question {
                    id: "hidden".into(),
                },
                InterrogationRevealTarget::Phase {
                    id: "testimony".into(),
                },
            ],
            "chapter_1",
        );
        assert!(queue.is_empty());
        assert!(scene.unlocked_overrides.contains("question:hidden"));
        assert!(scene.unlocked_overrides.contains("phase:testimony"));
    }
}
