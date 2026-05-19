// src-tauri/src/game/loader.rs
use crate::game::error::GameError;
use crate::game::schema::{
    ChaptersIndexJson, InvestigationSceneJson, OutroUnlock, RevealTarget, SceneJson, UnlockExpr,
};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

pub fn load_chapters_index(resources_dir: &Path) -> Result<ChaptersIndexJson, GameError> {
    let path = resources_dir.join("chapters.json");
    let raw = fs::read_to_string(&path).map_err(|e| {
        GameError::scene_load_failed(format!("failed to read {}: {}", path.display(), e))
    })?;
    serde_json::from_str(&raw)
        .map_err(|e| GameError::parse_failure(format!("invalid chapters.json: {e}")))
}

pub fn load_scene(resources_dir: &Path, file_rel: &str) -> Result<SceneJson, GameError> {
    let path = resources_dir.join(file_rel);
    let raw = fs::read_to_string(&path).map_err(|e| {
        GameError::scene_load_failed(format!("failed to read {}: {}", path.display(), e))
    })?;
    let scene: SceneJson = serde_json::from_str(&raw).map_err(|e| {
        GameError::parse_failure(format!("invalid scene JSON {}: {}", path.display(), e))
    })?;
    validate_scene_references(&scene, file_rel)?;
    Ok(scene)
}

fn validate_scene_references(scene: &SceneJson, file_rel: &str) -> Result<(), GameError> {
    match scene {
        SceneJson::Linear(_) => Ok(()),
        SceneJson::Investigation(scene) => validate_investigation_scene_references(scene, file_rel),
    }
}

fn validate_investigation_scene_references(
    scene: &InvestigationSceneJson,
    file_rel: &str,
) -> Result<(), GameError> {
    let evidence: HashSet<&str> = scene
        .evidence_manifest
        .iter()
        .map(|e| e.id.as_str())
        .collect();
    let statements: HashSet<&str> = scene
        .statement_manifest
        .iter()
        .map(|s| s.id.as_str())
        .collect();
    let mut sublocations: HashSet<&str> = HashSet::new();
    let mut hotspots: HashSet<&str> = HashSet::new();
    let mut topics: HashSet<(String, String)> = HashSet::new();

    for sub in &scene.sublocations {
        sublocations.insert(sub.id.as_str());
        for h in &sub.hotspots {
            hotspots.insert(h.id.as_str());
        }
        for c in &sub.characters {
            for t in &c.topics {
                topics.insert((c.id.clone(), t.id.clone()));
            }
        }
    }

    for sub in &scene.sublocations {
        validate_reveals(
            &sub.reveals,
            &evidence,
            &statements,
            &sublocations,
            &hotspots,
            &topics,
            file_rel,
        )?;
        validate_unlock(
            sub.unlock.as_ref(),
            &evidence,
            &statements,
            &hotspots,
            &topics,
            file_rel,
        )?;
        for h in &sub.hotspots {
            validate_reveals(
                &h.reveals,
                &evidence,
                &statements,
                &sublocations,
                &hotspots,
                &topics,
                file_rel,
            )?;
            validate_unlock(
                h.unlock.as_ref(),
                &evidence,
                &statements,
                &hotspots,
                &topics,
                file_rel,
            )?;
        }
        for c in &sub.characters {
            for t in &c.topics {
                validate_reveals(
                    &t.reveals,
                    &evidence,
                    &statements,
                    &sublocations,
                    &hotspots,
                    &topics,
                    file_rel,
                )?;
                validate_unlock(
                    t.unlock.as_ref(),
                    &evidence,
                    &statements,
                    &hotspots,
                    &topics,
                    file_rel,
                )?;
            }
        }
    }

    if let OutroUnlock::Expr(expr) = &scene.outro.unlock {
        validate_unlock(
            Some(expr),
            &evidence,
            &statements,
            &hotspots,
            &topics,
            file_rel,
        )?;
    }

    Ok(())
}

fn validate_reveals(
    reveals: &[RevealTarget],
    evidence: &HashSet<&str>,
    statements: &HashSet<&str>,
    sublocations: &HashSet<&str>,
    hotspots: &HashSet<&str>,
    topics: &HashSet<(String, String)>,
    file_rel: &str,
) -> Result<(), GameError> {
    for reveal in reveals {
        match reveal {
            RevealTarget::Evidence { id } if !evidence.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target evidence:{id}",
                )));
            }
            RevealTarget::Statement { id } if !statements.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target statement:{id}",
                )));
            }
            RevealTarget::Sublocation { id } if !sublocations.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target sublocation:{id}",
                )));
            }
            RevealTarget::Hotspot { id } if !hotspots.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target hotspot:{id}",
                )));
            }
            RevealTarget::Topic {
                character_id,
                topic_id,
            } if !topics.contains(&(character_id.clone(), topic_id.clone())) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target topic:{character_id}@{topic_id}",
                )));
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_unlock(
    unlock: Option<&UnlockExpr>,
    evidence: &HashSet<&str>,
    statements: &HashSet<&str>,
    hotspots: &HashSet<&str>,
    topics: &HashSet<(String, String)>,
    file_rel: &str,
) -> Result<(), GameError> {
    let Some(expr) = unlock else { return Ok(()) };
    match expr {
        UnlockExpr::Combinator { left, right, .. } => {
            validate_unlock(Some(left), evidence, statements, hotspots, topics, file_rel)?;
            validate_unlock(
                Some(right),
                evidence,
                statements,
                hotspots,
                topics,
                file_rel,
            )
        }
        UnlockExpr::EvidenceCollected { id, .. } if !evidence.contains(id.as_str()) => {
            Err(GameError::scene_validation_failed(format!(
                "{file_rel}: unresolved unlock predicate evidence:{id}",
            )))
        }
        UnlockExpr::StatementAcquired { id, .. } if !statements.contains(id.as_str()) => {
            Err(GameError::scene_validation_failed(format!(
                "{file_rel}: unresolved unlock predicate statement:{id}",
            )))
        }
        UnlockExpr::HotspotInvestigated { id, .. } if !hotspots.contains(id.as_str()) => {
            Err(GameError::scene_validation_failed(format!(
                "{file_rel}: unresolved unlock predicate hotspot:{id}",
            )))
        }
        UnlockExpr::TopicDiscussed {
            character_id,
            topic_id,
            ..
        } if !topics.contains(&(character_id.clone(), topic_id.clone())) => {
            Err(GameError::scene_validation_failed(format!(
                "{file_rel}: unresolved unlock predicate topic:{character_id}@{topic_id}",
            )))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn unique_temp_dir() -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("lyra-loader-test-{}-{}", std::process::id(), n));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn loads_a_valid_chapters_index() {
        let d = unique_temp_dir();
        let p = d.join("chapters.json");
        let mut f = fs::File::create(&p).unwrap();
        writeln!(f, r#"{{"chapters":[]}}"#).unwrap();
        let idx = load_chapters_index(&d).unwrap();
        assert!(idx.chapters.is_empty());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn surfaces_a_typed_error_for_missing_file() {
        let d = unique_temp_dir();
        let err = load_chapters_index(&d).unwrap_err();
        assert_eq!(err.code, "sceneLoadFailed");
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn rejects_investigation_scene_with_unresolved_reveal_target() {
        let d = unique_temp_dir();
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("investigation_scene_1.json"),
            r#"{
                "type": "investigation",
                "id": "investigation_scene_1",
                "title": "Broken Reveal",
                "intro": [],
                "sublocations": [{
                    "id": "room",
                    "label": "Room",
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [{"kind": "evidence", "id": "missing"}],
                    "sceneTag": "Room",
                    "transitionDialogue": [],
                    "hotspots": [],
                    "characters": []
                }],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();

        let err = load_scene(&d, "chapter_1/investigation_scene_1.json").unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");
        assert!(err.message.contains("reveal target evidence:missing"));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn rejects_investigation_scene_with_unresolved_unlock_predicate() {
        let d = unique_temp_dir();
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("investigation_scene_1.json"),
            r#"{
                "type": "investigation",
                "id": "investigation_scene_1",
                "title": "Broken Unlock",
                "intro": [],
                "sublocations": [{
                    "id": "room",
                    "label": "Room",
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "sceneTag": "Room",
                    "transitionDialogue": [],
                    "hotspots": [{
                        "id": "desk",
                        "label": "Desk",
                        "description": "Desk",
                        "status": "locked",
                        "unlock": { "predicate": "evidence_collected", "id": "missing" },
                        "reveals": [],
                        "inspectDialogue": [],
                        "onReexamine": null
                    }],
                    "characters": []
                }],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();

        let err = load_scene(&d, "chapter_1/investigation_scene_1.json").unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");
        assert!(err.message.contains("unlock predicate evidence:missing"));
        let _ = fs::remove_dir_all(d);
    }
}
