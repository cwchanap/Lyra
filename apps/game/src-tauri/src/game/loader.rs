// src-tauri/src/game/loader.rs
use crate::game::error::GameError;
use crate::game::provenance::validate_scene_records_against_catalog;
use crate::game::schema::{
    ChaptersIndexJson, InterrogationOutroUnlock, InterrogationPhaseJson, InterrogationRevealTarget,
    InterrogationSceneJson, InterrogationUnlockExpr, InvestigationSceneJson, OutroUnlock,
    RevealTarget, SceneJson, UnlockExpr,
};
use crate::game::story::StoryCatalog;
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

fn decode_scene_json(resources_dir: &Path, file_rel: &str) -> Result<SceneJson, GameError> {
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

#[cfg(test)]
pub(in crate::game) fn decode_scene_json_without_catalog_for_test(
    resources_dir: &Path,
    file_rel: &str,
) -> Result<SceneJson, GameError> {
    decode_scene_json(resources_dir, file_rel)
}

pub(in crate::game) fn load_scene_with_catalog(
    resources_dir: &Path,
    catalog: &StoryCatalog,
    chapter_id: &str,
    file_rel: &str,
) -> Result<SceneJson, GameError> {
    let scene = decode_scene_json(resources_dir, file_rel)?;
    validate_scene_records_against_catalog(catalog, chapter_id, &scene)?;
    Ok(scene)
}

fn validate_scene_references(scene: &SceneJson, file_rel: &str) -> Result<(), GameError> {
    match scene {
        SceneJson::Linear(_) => Ok(()),
        SceneJson::Investigation(scene) => validate_investigation_scene_references(scene, file_rel),
        SceneJson::Interrogation(scene) => validate_interrogation_scene_references(scene, file_rel),
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

fn validate_interrogation_scene_references(
    scene: &InterrogationSceneJson,
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
    let mut phases: HashSet<&str> = HashSet::new();
    let mut questions: HashSet<&str> = HashSet::new();

    for phase in &scene.phases {
        let InterrogationPhaseJson::Inquiry {
            id, questions: qs, ..
        } = phase;
        phases.insert(id.as_str());
        for question in qs {
            questions.insert(question.id.as_str());
        }
    }

    for phase in &scene.phases {
        let InterrogationPhaseJson::Inquiry {
            unlock,
            reveals,
            complete,
            questions: qs,
            ..
        } = phase;
        validate_interrogation_reveals(
            reveals,
            &evidence,
            &statements,
            &questions,
            &phases,
            file_rel,
        )?;
        validate_interrogation_unlock(unlock.as_ref(), &questions, &phases, file_rel)?;
        if let InterrogationOutroUnlock::Expr(expr) = complete {
            validate_interrogation_unlock(Some(expr), &questions, &phases, file_rel)?;
        }
        for question in qs {
            validate_interrogation_reveals(
                &question.reveals,
                &evidence,
                &statements,
                &questions,
                &phases,
                file_rel,
            )?;
            validate_interrogation_unlock(question.unlock.as_ref(), &questions, &phases, file_rel)?;
            // `On Correct` line reveals are carried on `testimony.lines`;
            // validate them at load time so a typo like `evidence:missing_id`
            // is rejected here rather than silently dropping the reveal at
            // runtime when no manifest entry matches.
            for line in &question.testimony.lines {
                validate_interrogation_reveals(
                    &line.reveals,
                    &evidence,
                    &statements,
                    &questions,
                    &phases,
                    file_rel,
                )?;
            }
        }
    }

    if let InterrogationOutroUnlock::Expr(expr) = &scene.outro.unlock {
        validate_interrogation_unlock(Some(expr), &questions, &phases, file_rel)?;
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

fn validate_interrogation_reveals(
    reveals: &[InterrogationRevealTarget],
    evidence: &HashSet<&str>,
    statements: &HashSet<&str>,
    questions: &HashSet<&str>,
    phases: &HashSet<&str>,
    file_rel: &str,
) -> Result<(), GameError> {
    for reveal in reveals {
        match reveal {
            InterrogationRevealTarget::Evidence { id } if !evidence.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved interrogation reveal target evidence:{id}",
                )));
            }
            InterrogationRevealTarget::Statement { id } if !statements.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved interrogation reveal target statement:{id}",
                )));
            }
            InterrogationRevealTarget::Question { id } if !questions.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved interrogation reveal target question:{id}",
                )));
            }
            InterrogationRevealTarget::Phase { id } if !phases.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved interrogation reveal target phase:{id}",
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

fn validate_interrogation_unlock(
    unlock: Option<&InterrogationUnlockExpr>,
    questions: &HashSet<&str>,
    phases: &HashSet<&str>,
    file_rel: &str,
) -> Result<(), GameError> {
    let Some(expr) = unlock else { return Ok(()) };
    match expr {
        InterrogationUnlockExpr::Combinator { left, right, .. } => {
            validate_interrogation_unlock(Some(left), questions, phases, file_rel)?;
            validate_interrogation_unlock(Some(right), questions, phases, file_rel)
        }
        InterrogationUnlockExpr::QuestionAnswered { id, .. }
            if !questions.contains(id.as_str()) =>
        {
            Err(GameError::scene_validation_failed(format!(
                "{file_rel}: unresolved interrogation unlock predicate question:{id}",
            )))
        }
        InterrogationUnlockExpr::PhaseCompleted { id, .. } if !phases.contains(id.as_str()) => {
            Err(GameError::scene_validation_failed(format!(
                "{file_rel}: unresolved interrogation unlock predicate phase:{id}",
            )))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::provenance::{
        CaseRecordProvenance, Completeness, Confidence, ProceduralStatus, ProofCapability,
        RepresentationLayer, SourceKind,
    };
    use crate::game::test_support::catalog_with_case_records;
    use std::collections::BTreeSet;
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

    fn write_record_scene(
        resources_dir: &Path,
        scene_id: &str,
        evidence: &[(&str, &CaseRecordProvenance)],
        statements: &[(&str, &CaseRecordProvenance)],
    ) {
        let chapter_dir = resources_dir.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        let evidence = evidence
            .iter()
            .map(|(id, provenance)| {
                serde_json::json!({
                    "id": id,
                    "name": id,
                    "description": id,
                    "details": id,
                    "provenance": provenance,
                    "imageAssetId": null,
                    "onCollect": [],
                    "onReexamine": null,
                })
            })
            .collect::<Vec<_>>();
        let statements = statements
            .iter()
            .map(|(id, provenance)| {
                serde_json::json!({
                    "id": id,
                    "speaker": id,
                    "content": id,
                    "provenance": provenance,
                    "onAcquire": [],
                    "onReexamine": null,
                })
            })
            .collect::<Vec<_>>();
        fs::write(
            chapter_dir.join(format!("{scene_id}.json")),
            serde_json::to_vec_pretty(&serde_json::json!({
                "type": "investigation",
                "id": scene_id,
                "title": scene_id,
                "intro": [],
                "sublocations": [],
                "evidenceManifest": evidence,
                "statementManifest": statements,
                "outro": { "unlock": "auto", "dialogue": [] },
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn full_provenance() -> CaseRecordProvenance {
        CaseRecordProvenance {
            source_kind: SourceKind::Digital,
            representation_layer: RepresentationLayer::Summary,
            procedural_status: ProceduralStatus::Exhibit,
            completeness: Completeness::Cropped,
            confidence: Confidence::Corroborated,
            source_group_id: None,
            source_label: Some("Full record provenance".into()),
            proof_capabilities: BTreeSet::from([
                ProofCapability::Time,
                ProofCapability::Identity,
                ProofCapability::Procedure,
            ]),
            supersedes_record_id: None,
        }
    }

    // Break caught: a loaded scene can silently override the catalog's typed
    // record origin or immutable provenance for the same evidence ID.
    #[test]
    fn rejects_scene_record_chapter_scene_and_provenance_mismatches() {
        let matching = CaseRecordProvenance::default();
        let mismatched = full_provenance();
        let cases = [
            ("chapter_2", "investigation_scene_1", matching.clone()),
            ("chapter_1", "investigation_scene_2", matching.clone()),
            ("chapter_1", "investigation_scene_1", mismatched),
        ];

        for (catalog_chapter, catalog_scene, catalog_provenance) in cases {
            let resources = unique_temp_dir();
            write_record_scene(
                &resources,
                "investigation_scene_1",
                &[("receipt", &matching)],
                &[],
            );
            let catalog = catalog_with_case_records(
                vec![(
                    "receipt",
                    catalog_chapter,
                    catalog_scene,
                    catalog_provenance,
                )],
                vec![],
            );

            let error = load_scene_with_catalog(
                &resources,
                &catalog,
                "chapter_1",
                "chapter_1/investigation_scene_1.json",
            )
            .unwrap_err();

            assert_eq!(error.code, "caseRecordDefinitionMismatch");
            let _ = fs::remove_dir_all(resources);
        }
    }

    // Break caught: exact neutral evidence or non-neutral statement
    // provenance is rejected even though scene and catalog agree.
    #[test]
    fn accepts_matching_neutral_and_full_scene_record_definitions() {
        let resources = unique_temp_dir();
        let neutral = CaseRecordProvenance::default();
        let full = full_provenance();
        write_record_scene(
            &resources,
            "investigation_scene_1",
            &[("receipt", &neutral)],
            &[("witness_account", &full)],
        );
        let catalog = catalog_with_case_records(
            vec![("receipt", "chapter_1", "investigation_scene_1", neutral)],
            vec![(
                "witness_account",
                "chapter_1",
                "investigation_scene_1",
                full,
            )],
        );

        let scene = load_scene_with_catalog(
            &resources,
            &catalog,
            "chapter_1",
            "chapter_1/investigation_scene_1.json",
        )
        .unwrap();

        assert!(matches!(scene, SceneJson::Investigation(_)));
        let _ = fs::remove_dir_all(resources);
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

        let err =
            decode_scene_json_without_catalog_for_test(&d, "chapter_1/investigation_scene_1.json")
                .unwrap_err();
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

        let err =
            decode_scene_json_without_catalog_for_test(&d, "chapter_1/investigation_scene_1.json")
                .unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");
        assert!(err.message.contains("unlock predicate evidence:missing"));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn rejects_interrogation_scene_with_unresolved_reveal_target() {
        let d = unique_temp_dir();
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "interrogation",
                "id": "interrogation_scene_1",
                "title": "Broken Reveal",
                "intro": [],
                "phases": [{
                    "kind": "inquiry",
                    "id": "inquiry",
                    "label": "Inquiry",
                    "subject": { "id": "suspect", "name": "Suspect", "role": "Suspect", "bio": "Bio" },
                    "required": true,
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [{ "kind": "evidence", "id": "missing" }],
                    "sceneTag": "Room",
                    "entryDialogue": [],
                    "complete": "auto",
                    "questions": []
                }],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();

        let err =
            decode_scene_json_without_catalog_for_test(&d, "chapter_1/interrogation_scene_1.json")
                .unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");
        assert!(err
            .message
            .contains("interrogation reveal target evidence:missing"));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn rejects_interrogation_scene_with_unresolved_question_unlock_predicate() {
        let d = unique_temp_dir();
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "interrogation",
                "id": "interrogation_scene_1",
                "title": "Broken Unlock",
                "intro": [],
                "phases": [{
                    "kind": "inquiry",
                    "id": "inquiry",
                    "label": "Inquiry",
                    "subject": { "id": "suspect", "name": "Suspect", "role": "Suspect", "bio": "Bio" },
                    "required": true,
                    "status": "locked",
                    "unlock": { "predicate": "question_answered", "id": "missing_question" },
                    "reveals": [],
                    "sceneTag": "Room",
                    "entryDialogue": [],
                    "complete": "auto",
                    "questions": []
                }],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();

        let err =
            decode_scene_json_without_catalog_for_test(&d, "chapter_1/interrogation_scene_1.json")
                .unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");
        assert!(err
            .message
            .contains("interrogation unlock predicate question:missing_question"));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn rejects_interrogation_scene_with_unresolved_testimony_line_reveal_target() {
        // `On Correct` line reveals are carried on `testimony.lines[*].reveals`.
        // A typo like `evidence:missing_id` on a line reveal must be rejected
        // at load time; otherwise the scene loads and the runtime later
        // silently drops the reveal when no manifest entry matches, leaving a
        // successful contradiction unable to grant required inventory/unlocks.
        let d = unique_temp_dir();
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "interrogation",
                "id": "interrogation_scene_1",
                "title": "Broken Line Reveal",
                "intro": [],
                "phases": [{
                    "kind": "inquiry",
                    "id": "inquiry",
                    "label": "Inquiry",
                    "subject": { "id": "suspect", "name": "Suspect", "role": "Suspect", "bio": "Bio" },
                    "required": true,
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "sceneTag": "Room",
                    "entryDialogue": [],
                    "complete": "auto",
                    "questions": [{
                        "id": "question_1",
                        "label": "Question",
                        "status": "unlocked",
                        "required": true,
                        "unlock": null,
                        "reveals": [],
                        "testimony": {
                            "onLoop": [],
                            "lines": [{
                                "id": "line_1",
                                "label": "Line",
                                "content": [],
                                "contradiction": null,
                                "reveals": [{ "kind": "evidence", "id": "missing" }]
                            }]
                        }
                    }]
                }],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();

        let err =
            decode_scene_json_without_catalog_for_test(&d, "chapter_1/interrogation_scene_1.json")
                .unwrap_err();
        assert_eq!(err.code, "sceneValidationFailed");
        assert!(err
            .message
            .contains("interrogation reveal target evidence:missing"));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn accepts_interrogation_scene_with_external_inventory_contradiction() {
        // A testimony line's `contradiction` target references evidence that
        // is not declared in this scene's local evidenceManifest. Under the
        // cross-examination model, `contradiction` targets are checked at
        // runtime against the player's global inventory (not this scene's
        // manifest), so the loader must accept this rather than reject it as
        // an unresolved reference.
        let d = unique_temp_dir();
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "interrogation",
                "id": "interrogation_scene_1",
                "title": "External Inventory",
                "intro": [],
                "phases": [{
                    "kind": "inquiry",
                    "id": "inquiry",
                    "label": "Inquiry",
                    "subject": { "id": "suspect", "name": "Suspect", "role": "Suspect", "bio": "Bio" },
                    "required": true,
                    "status": "unlocked",
                    "unlock": null,
                    "reveals": [],
                    "sceneTag": "Room",
                    "entryDialogue": [],
                    "complete": "auto",
                    "questions": [{
                        "id": "question_1",
                        "label": "Question",
                        "status": "unlocked",
                        "required": true,
                        "unlock": null,
                        "reveals": [],
                        "testimony": {
                            "onLoop": [],
                            "lines": [{
                                "id": "line_1",
                                "label": "Line",
                                "content": [],
                                "contradiction": { "kind": "evidence", "id": "external_receipt" },
                                "reveals": []
                            }]
                        }
                    }]
                }],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": "auto", "dialogue": [] }
            }"#,
        )
        .unwrap();

        let parsed =
            decode_scene_json_without_catalog_for_test(&d, "chapter_1/interrogation_scene_1.json")
                .unwrap();
        assert!(matches!(parsed, SceneJson::Interrogation(_)));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn accepts_interrogation_scene_with_external_inventory_unlock_predicate() {
        let d = unique_temp_dir();
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("interrogation_scene_1.json"),
            r#"{
                "type": "interrogation",
                "id": "interrogation_scene_1",
                "title": "External Unlock",
                "intro": [],
                "phases": [{
                    "kind": "inquiry",
                    "id": "inquiry",
                    "label": "Inquiry",
                    "subject": { "id": "suspect", "name": "Suspect", "role": "Suspect", "bio": "Bio" },
                    "required": true,
                    "status": "locked",
                    "unlock": { "predicate": "evidence_collected", "id": "external_key" },
                    "reveals": [],
                    "sceneTag": "Room",
                    "entryDialogue": [],
                    "complete": { "predicate": "statement_acquired", "id": "external_statement" },
                    "questions": [{
                        "id": "known_question",
                        "label": "Known Question",
                        "status": "locked",
                        "required": true,
                        "unlock": { "predicate": "statement_acquired", "id": "external_statement" },
                        "reveals": [],
                        "testimony": { "onLoop": [], "lines": [] }
                    }]
                }],
                "evidenceManifest": [],
                "statementManifest": [],
                "outro": { "unlock": { "predicate": "evidence_collected", "id": "external_key" }, "dialogue": [] }
            }"#,
        )
        .unwrap();

        let parsed =
            decode_scene_json_without_catalog_for_test(&d, "chapter_1/interrogation_scene_1.json")
                .unwrap();
        assert!(matches!(parsed, SceneJson::Interrogation(_)));
        let _ = fs::remove_dir_all(d);
    }
}
