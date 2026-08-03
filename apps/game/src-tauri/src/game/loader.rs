// src-tauri/src/game/loader.rs
use crate::game::error::GameError;
use crate::game::provenance::validate_scene_records_against_catalog;
use crate::game::schema::{
    ChaptersIndexJson, CombinedInterrogationRevealTarget, InterrogationOutroUnlock,
    InterrogationPhaseJson, InterrogationRevealTarget, InterrogationSceneJson,
    InterrogationUnlockExpr, InvestigationRevealTarget, InvestigationSceneJson, OutroUnlock,
    RevealTarget, SceneJson, StoryRevealTarget, UnlockExpr,
};
use crate::game::story::{ObjectiveKind, StoryCatalog};
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
    validate_story_scene_references(&scene, catalog, file_rel)?;
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
    reveals: &[InvestigationRevealTarget],
    evidence: &HashSet<&str>,
    statements: &HashSet<&str>,
    sublocations: &HashSet<&str>,
    hotspots: &HashSet<&str>,
    topics: &HashSet<(String, String)>,
    file_rel: &str,
) -> Result<(), GameError> {
    for reveal in reveals {
        match reveal {
            InvestigationRevealTarget::Local(RevealTarget::Evidence { id })
                if !evidence.contains(id.as_str()) =>
            {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target evidence:{id}",
                )));
            }
            InvestigationRevealTarget::Local(RevealTarget::Statement { id })
                if !statements.contains(id.as_str()) =>
            {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target statement:{id}",
                )));
            }
            InvestigationRevealTarget::Local(RevealTarget::Sublocation { id })
                if !sublocations.contains(id.as_str()) =>
            {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target sublocation:{id}",
                )));
            }
            InvestigationRevealTarget::Local(RevealTarget::Hotspot { id })
                if !hotspots.contains(id.as_str()) =>
            {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved reveal target hotspot:{id}",
                )));
            }
            InvestigationRevealTarget::Local(RevealTarget::Topic {
                character_id,
                topic_id,
            }) if !topics.contains(&(character_id.clone(), topic_id.clone())) => {
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
    reveals: &[CombinedInterrogationRevealTarget],
    evidence: &HashSet<&str>,
    statements: &HashSet<&str>,
    questions: &HashSet<&str>,
    phases: &HashSet<&str>,
    file_rel: &str,
) -> Result<(), GameError> {
    for reveal in reveals {
        match reveal {
            CombinedInterrogationRevealTarget::Local(InterrogationRevealTarget::Evidence {
                id,
            }) if !evidence.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved interrogation reveal target evidence:{id}",
                )));
            }
            CombinedInterrogationRevealTarget::Local(InterrogationRevealTarget::Statement {
                id,
            }) if !statements.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved interrogation reveal target statement:{id}",
                )));
            }
            CombinedInterrogationRevealTarget::Local(InterrogationRevealTarget::Question {
                id,
            }) if !questions.contains(id.as_str()) => {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved interrogation reveal target question:{id}",
                )));
            }
            CombinedInterrogationRevealTarget::Local(InterrogationRevealTarget::Phase { id })
                if !phases.contains(id.as_str()) =>
            {
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
        UnlockExpr::AtLeast {
            count, conditions, ..
        } => {
            validate_at_least(*count, conditions, file_rel)?;
            for condition in conditions {
                validate_unlock(
                    Some(condition),
                    evidence,
                    statements,
                    hotspots,
                    topics,
                    file_rel,
                )?;
            }
            Ok(())
        }
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
        InterrogationUnlockExpr::AtLeast {
            count, conditions, ..
        } => {
            validate_at_least(*count, conditions, file_rel)?;
            for condition in conditions {
                validate_interrogation_unlock(Some(condition), questions, phases, file_rel)?;
            }
            Ok(())
        }
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

fn validate_at_least<T: PartialEq>(
    count: usize,
    conditions: &[T],
    file_rel: &str,
) -> Result<(), GameError> {
    if count == 0 || count > conditions.len() {
        return Err(GameError::scene_validation_failed(format!(
            "{file_rel}: invalid at_least threshold: count {count} must be between 1 and {}",
            conditions.len(),
        )));
    }

    for (index, condition) in conditions.iter().enumerate() {
        if conditions[..index].iter().any(|prior| prior == condition) {
            return Err(GameError::scene_validation_failed(format!(
                "{file_rel}: duplicate at_least condition",
            )));
        }
    }

    Ok(())
}

/// Catalog-aware validation intentionally runs only after `decode_scene_json`
/// has accepted the structural and legacy-local shape. Test-only structural
/// decode remains useful for isolated local validation and must not acquire a
/// hidden dependency on a story catalog.
fn validate_story_scene_references(
    scene: &SceneJson,
    catalog: &StoryCatalog,
    file_rel: &str,
) -> Result<(), GameError> {
    match scene {
        SceneJson::Linear(_) => Ok(()),
        SceneJson::Investigation(scene) => {
            validate_story_investigation_scene_references(scene, catalog, file_rel)
        }
        SceneJson::Interrogation(scene) => {
            validate_story_interrogation_scene_references(scene, catalog, file_rel)
        }
    }
}

fn validate_story_investigation_scene_references(
    scene: &InvestigationSceneJson,
    catalog: &StoryCatalog,
    file_rel: &str,
) -> Result<(), GameError> {
    for sublocation in &scene.sublocations {
        validate_story_investigation_reveals(&sublocation.reveals, catalog, file_rel)?;
        validate_story_unlock_expr(sublocation.unlock.as_ref(), catalog, file_rel)?;
        for hotspot in &sublocation.hotspots {
            validate_story_investigation_reveals(&hotspot.reveals, catalog, file_rel)?;
            validate_story_unlock_expr(hotspot.unlock.as_ref(), catalog, file_rel)?;
        }
        for character in &sublocation.characters {
            for topic in &character.topics {
                validate_story_investigation_reveals(&topic.reveals, catalog, file_rel)?;
                validate_story_unlock_expr(topic.unlock.as_ref(), catalog, file_rel)?;
            }
        }
    }

    if let OutroUnlock::Expr(expr) = &scene.outro.unlock {
        validate_story_unlock_expr(Some(expr), catalog, file_rel)?;
    }

    Ok(())
}

fn validate_story_interrogation_scene_references(
    scene: &InterrogationSceneJson,
    catalog: &StoryCatalog,
    file_rel: &str,
) -> Result<(), GameError> {
    for phase in &scene.phases {
        let InterrogationPhaseJson::Inquiry {
            unlock,
            reveals,
            complete,
            questions,
            ..
        } = phase;
        validate_story_interrogation_reveals(reveals, catalog, file_rel)?;
        validate_story_interrogation_unlock_expr(unlock.as_ref(), catalog, file_rel)?;
        if let InterrogationOutroUnlock::Expr(expr) = complete {
            validate_story_interrogation_unlock_expr(Some(expr), catalog, file_rel)?;
        }
        for question in questions {
            validate_story_interrogation_reveals(&question.reveals, catalog, file_rel)?;
            validate_story_interrogation_unlock_expr(question.unlock.as_ref(), catalog, file_rel)?;
            for line in &question.testimony.lines {
                validate_story_interrogation_reveals(&line.reveals, catalog, file_rel)?;
            }
        }
    }

    if let InterrogationOutroUnlock::Expr(expr) = &scene.outro.unlock {
        validate_story_interrogation_unlock_expr(Some(expr), catalog, file_rel)?;
    }

    Ok(())
}

fn validate_story_investigation_reveals(
    reveals: &[InvestigationRevealTarget],
    catalog: &StoryCatalog,
    file_rel: &str,
) -> Result<(), GameError> {
    for reveal in reveals {
        if let InvestigationRevealTarget::Story(target) = reveal {
            validate_story_reveal_target(target, catalog, file_rel)?;
        }
    }
    Ok(())
}

fn validate_story_interrogation_reveals(
    reveals: &[CombinedInterrogationRevealTarget],
    catalog: &StoryCatalog,
    file_rel: &str,
) -> Result<(), GameError> {
    for reveal in reveals {
        if let CombinedInterrogationRevealTarget::Story(target) = reveal {
            validate_story_reveal_target(target, catalog, file_rel)?;
        }
    }
    Ok(())
}

fn validate_story_unlock_expr(
    unlock: Option<&UnlockExpr>,
    catalog: &StoryCatalog,
    file_rel: &str,
) -> Result<(), GameError> {
    let Some(expr) = unlock else { return Ok(()) };
    match expr {
        UnlockExpr::AtLeast { conditions, .. } => {
            for condition in conditions {
                validate_story_unlock_expr(Some(condition), catalog, file_rel)?;
            }
            Ok(())
        }
        UnlockExpr::Combinator { left, right, .. } => {
            validate_story_unlock_expr(Some(left), catalog, file_rel)?;
            validate_story_unlock_expr(Some(right), catalog, file_rel)
        }
        UnlockExpr::FactAsserted { id, .. } => {
            validate_story_fact(catalog, id, file_rel, "predicate")
        }
        UnlockExpr::QuestionResolved { id, .. } => {
            validate_story_question(catalog, id, file_rel, "predicate")
        }
        UnlockExpr::ObjectiveCompleted { id, .. } => {
            validate_story_objective(catalog, id, file_rel, "predicate")
        }
        UnlockExpr::AuthorizationGranted { id, .. } => {
            validate_story_authorization(catalog, id, file_rel, "predicate")
        }
        UnlockExpr::AnalysisSceneCompleted {
            chapter_id,
            scene_id,
            ..
        } => validate_analysis_scene_predicate(chapter_id, scene_id, file_rel),
        UnlockExpr::AnalysisBoardCompleted {
            chapter_id,
            scene_id,
            board_id,
            ..
        } => validate_analysis_board_predicate(chapter_id, scene_id, board_id, file_rel),
        _ => Ok(()),
    }
}

fn validate_story_interrogation_unlock_expr(
    unlock: Option<&InterrogationUnlockExpr>,
    catalog: &StoryCatalog,
    file_rel: &str,
) -> Result<(), GameError> {
    let Some(expr) = unlock else { return Ok(()) };
    match expr {
        InterrogationUnlockExpr::AtLeast { conditions, .. } => {
            for condition in conditions {
                validate_story_interrogation_unlock_expr(Some(condition), catalog, file_rel)?;
            }
            Ok(())
        }
        InterrogationUnlockExpr::Combinator { left, right, .. } => {
            validate_story_interrogation_unlock_expr(Some(left), catalog, file_rel)?;
            validate_story_interrogation_unlock_expr(Some(right), catalog, file_rel)
        }
        InterrogationUnlockExpr::FactAsserted { id, .. } => {
            validate_story_fact(catalog, id, file_rel, "predicate")
        }
        InterrogationUnlockExpr::QuestionResolved { id, .. } => {
            validate_story_question(catalog, id, file_rel, "predicate")
        }
        InterrogationUnlockExpr::ObjectiveCompleted { id, .. } => {
            validate_story_objective(catalog, id, file_rel, "predicate")
        }
        InterrogationUnlockExpr::AuthorizationGranted { id, .. } => {
            validate_story_authorization(catalog, id, file_rel, "predicate")
        }
        InterrogationUnlockExpr::AnalysisSceneCompleted {
            chapter_id,
            scene_id,
            ..
        } => validate_analysis_scene_predicate(chapter_id, scene_id, file_rel),
        InterrogationUnlockExpr::AnalysisBoardCompleted {
            chapter_id,
            scene_id,
            board_id,
            ..
        } => validate_analysis_board_predicate(chapter_id, scene_id, board_id, file_rel),
        _ => Ok(()),
    }
}

fn validate_story_reveal_target(
    target: &StoryRevealTarget,
    catalog: &StoryCatalog,
    file_rel: &str,
) -> Result<(), GameError> {
    match target {
        StoryRevealTarget::AssertFact { fact_id } => {
            validate_story_fact(catalog, fact_id, file_rel, "target")
        }
        StoryRevealTarget::RevealQuestion { question_id } => {
            validate_story_question(catalog, question_id, file_rel, "target")
        }
        StoryRevealTarget::ResolveQuestion {
            question_id,
            fact_id,
        } => {
            let question = catalog.question(question_id).ok_or_else(|| {
                GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved story target question:{question_id}",
                ))
            })?;
            validate_story_fact(catalog, fact_id, file_rel, "target")?;
            if !question
                .resolved_by_fact_ids
                .iter()
                .any(|resolver| resolver == fact_id)
            {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: story target question:{question_id} cannot be resolved by fact:{fact_id}",
                )));
            }
            Ok(())
        }
        StoryRevealTarget::RevealObjective { objective_id } => {
            validate_story_objective(catalog, objective_id, file_rel, "target")
        }
        StoryRevealTarget::CompleteObjective { objective_id } => {
            let objective = catalog.objective(objective_id).ok_or_else(|| {
                GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved story target objective:{objective_id}",
                ))
            })?;
            if objective.kind != ObjectiveKind::Secondary {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: completeObjective only accepts secondary objectives",
                )));
            }
            Ok(())
        }
        StoryRevealTarget::SetPrimaryObjective {
            next_objective_id, ..
        } => {
            let Some(objective_id) = next_objective_id else {
                return Ok(());
            };
            let objective = catalog.objective(objective_id).ok_or_else(|| {
                GameError::scene_validation_failed(format!(
                    "{file_rel}: unresolved setPrimaryObjective target objective:{objective_id}",
                ))
            })?;
            if objective.kind != ObjectiveKind::Primary {
                return Err(GameError::scene_validation_failed(format!(
                    "{file_rel}: setPrimaryObjective target must be primary",
                )));
            }
            Ok(())
        }
        StoryRevealTarget::GrantAuthorization { authorization_id } => {
            validate_story_authorization(catalog, authorization_id, file_rel, "target")?;
            Err(GameError::scene_validation_failed(format!(
                "{file_rel}: grantAuthorization is unavailable before HPA-264 because this scene has no represented authority",
            )))
        }
    }
}

fn validate_story_fact(
    catalog: &StoryCatalog,
    id: &str,
    file_rel: &str,
    role: &str,
) -> Result<(), GameError> {
    if catalog.fact(id).is_none() {
        return Err(GameError::scene_validation_failed(format!(
            "{file_rel}: unresolved story {role} fact:{id}",
        )));
    }
    Ok(())
}

fn validate_story_question(
    catalog: &StoryCatalog,
    id: &str,
    file_rel: &str,
    role: &str,
) -> Result<(), GameError> {
    if catalog.question(id).is_none() {
        return Err(GameError::scene_validation_failed(format!(
            "{file_rel}: unresolved story {role} question:{id}",
        )));
    }
    Ok(())
}

fn validate_story_objective(
    catalog: &StoryCatalog,
    id: &str,
    file_rel: &str,
    role: &str,
) -> Result<(), GameError> {
    if catalog.objective(id).is_none() {
        return Err(GameError::scene_validation_failed(format!(
            "{file_rel}: unresolved story {role} objective:{id}",
        )));
    }
    Ok(())
}

fn validate_story_authorization(
    catalog: &StoryCatalog,
    id: &str,
    file_rel: &str,
    role: &str,
) -> Result<(), GameError> {
    if catalog.authorization(id).is_none() {
        return Err(GameError::scene_validation_failed(format!(
            "{file_rel}: unresolved story {role} authorization:{id}",
        )));
    }
    Ok(())
}

fn validate_analysis_scene_predicate(
    chapter_id: &str,
    scene_id: &str,
    file_rel: &str,
) -> Result<(), GameError> {
    validate_analysis_slug("chapterId", chapter_id, file_rel)?;
    validate_analysis_slug("sceneId", scene_id, file_rel)?;
    Err(GameError::scene_validation_failed(format!(
        "{file_rel}: analysis_scene_completed is unavailable before HPA-259 because no production analysis registry is packaged",
    )))
}

fn validate_analysis_board_predicate(
    chapter_id: &str,
    scene_id: &str,
    board_id: &str,
    file_rel: &str,
) -> Result<(), GameError> {
    validate_analysis_slug("chapterId", chapter_id, file_rel)?;
    validate_analysis_slug("sceneId", scene_id, file_rel)?;
    validate_analysis_slug("boardId", board_id, file_rel)?;
    Err(GameError::scene_validation_failed(format!(
        "{file_rel}: analysis_board_completed is unavailable before HPA-259 because no production analysis registry is packaged",
    )))
}

fn validate_analysis_slug(field: &str, value: &str, file_rel: &str) -> Result<(), GameError> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(GameError::scene_validation_failed(format!(
            "{file_rel}: analysis {field} must be a snake_case slug: {value}",
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::provenance::{
        CaseRecordProvenance, Completeness, Confidence, ProceduralStatus, ProofCapability,
        RepresentationLayer, SourceKind,
    };
    use crate::game::test_support::{catalog_with_case_records, catalog_with_story_definitions};
    use serde_json::{json, Value};
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
                "summary": scene_id,
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

    fn story_catalog_for_loader() -> StoryCatalog {
        catalog_with_story_definitions(
            vec![
                json!({
                    "id": "fact_a",
                    "label": "Fact A",
                    "summary": "Fact A summary",
                    "details": "Fact A details",
                    "category": "timeline",
                }),
                json!({
                    "id": "fact_b",
                    "label": "Fact B",
                    "summary": "Fact B summary",
                    "details": "Fact B details",
                    "category": "motive",
                }),
            ],
            vec![json!({
                "id": "question_a",
                "label": "Question A",
                "summary": "Question A summary",
                "resolvedByFactIds": ["fact_a"],
            })],
            vec![
                json!({
                    "id": "objective_primary",
                    "label": "Primary",
                    "summary": "Primary summary",
                    "kind": "primary",
                    "sortOrder": 0,
                }),
                json!({
                    "id": "objective_secondary",
                    "label": "Secondary",
                    "summary": "Secondary summary",
                    "kind": "secondary",
                    "sortOrder": 1,
                }),
            ],
            vec![json!({
                "id": "authorization_a",
                "label": "Authorization A",
                "summary": "Authorization A summary",
                "grantingAuthority": "analysis_authority",
            })],
        )
    }

    fn write_scene_json(resources_dir: &Path, file_name: &str, scene: Value) {
        let chapter_dir = resources_dir.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join(file_name),
            serde_json::to_vec_pretty(&scene).unwrap(),
        )
        .unwrap();
    }

    fn story_investigation_scene(unlock: Value, reveals: Value) -> Value {
        json!({
            "type": "investigation",
            "id": "investigation_scene_1",
            "title": "Story investigation",
            "summary": "Fixture scene summary.",
            "intro": [],
            "sublocations": [{
                "id": "room",
                "label": "Room",
                "status": "locked",
                "unlock": unlock,
                "reveals": reveals,
                "sceneTag": "Room",
                "transitionDialogue": [],
                "hotspots": [],
                "characters": []
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": "auto", "dialogue": [] }
        })
    }

    fn story_interrogation_scene(unlock: Value, reveals: Value) -> Value {
        json!({
            "type": "interrogation",
            "id": "interrogation_scene_1",
            "title": "Story interrogation",
            "summary": "Fixture scene summary.",
            "intro": [],
            "phases": [{
                "kind": "inquiry",
                "id": "phase_1",
                "label": "Phase",
                "subject": { "id": "suspect", "name": "Suspect", "role": "Suspect", "bio": "Bio" },
                "required": true,
                "status": "locked",
                "unlock": unlock,
                "reveals": reveals,
                "sceneTag": "Room",
                "entryDialogue": [],
                "complete": "auto",
                "questions": []
            }],
            "evidenceManifest": [],
            "statementManifest": [],
            "outro": { "unlock": "auto", "dialogue": [] }
        })
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
            &[("shared_record", &neutral)],
            &[("shared_record", &full)],
        );
        let catalog = catalog_with_case_records(
            vec![(
                "shared_record",
                "chapter_1",
                "investigation_scene_1",
                neutral,
            )],
            vec![("shared_record", "chapter_1", "investigation_scene_1", full)],
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
    fn rejects_duplicate_identical_typed_scene_record_definitions() {
        let provenance = CaseRecordProvenance::default();
        for (evidence, statements) in [
            (
                vec![("duplicate", &provenance), ("duplicate", &provenance)],
                vec![],
            ),
            (
                vec![],
                vec![("duplicate", &provenance), ("duplicate", &provenance)],
            ),
        ] {
            let resources = unique_temp_dir();
            write_record_scene(&resources, "investigation_scene_1", &evidence, &statements);
            let catalog = catalog_with_case_records(
                evidence
                    .first()
                    .map(|_| {
                        vec![(
                            "duplicate",
                            "chapter_1",
                            "investigation_scene_1",
                            provenance.clone(),
                        )]
                    })
                    .unwrap_or_default(),
                statements
                    .first()
                    .map(|_| {
                        vec![(
                            "duplicate",
                            "chapter_1",
                            "investigation_scene_1",
                            provenance.clone(),
                        )]
                    })
                    .unwrap_or_default(),
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

    #[test]
    fn rejects_catalog_record_missing_from_its_owning_scene() {
        let resources = unique_temp_dir();
        write_record_scene(&resources, "investigation_scene_1", &[], &[]);
        let catalog = catalog_with_case_records(
            vec![(
                "catalog_only",
                "chapter_1",
                "investigation_scene_1",
                CaseRecordProvenance::default(),
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

    #[test]
    fn rejects_catalog_record_assigned_to_loaded_linear_scene() {
        let resources = unique_temp_dir();
        let chapter_dir = resources.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            chapter_dir.join("scene_0.json"),
            r#"{
                "type": "linear",
                "id": "scene_0",
                "title": "Linear",
                "summary": "Fixture scene summary.",
                "queue": []
            }"#,
        )
        .unwrap();
        let catalog = catalog_with_case_records(
            vec![(
                "catalog_only",
                "chapter_1",
                "scene_0",
                CaseRecordProvenance::default(),
            )],
            vec![],
        );

        let error =
            load_scene_with_catalog(&resources, &catalog, "chapter_1", "chapter_1/scene_0.json")
                .unwrap_err();

        assert_eq!(error.code, "caseRecordDefinitionMismatch");
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
                "summary": "Fixture scene summary.",
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
                "summary": "Fixture scene summary.",
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
                "summary": "Fixture scene summary.",
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
                "summary": "Fixture scene summary.",
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
                "summary": "Fixture scene summary.",
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
                "summary": "Fixture scene summary.",
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
                "summary": "Fixture scene summary.",
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

    // Break caught: a structural-only decode incorrectly needs a story catalog,
    // or rejects a valid HPA-257 wire expression before startup can perform the
    // catalog-aware validation pass.
    #[test]
    fn structural_decode_accepts_story_wire_without_catalog_resolution() {
        let resources = unique_temp_dir();
        write_scene_json(
            &resources,
            "investigation_scene_1.json",
            story_investigation_scene(
                json!({ "predicate": "fact_asserted", "id": "missing_fact" }),
                json!([]),
            ),
        );

        let scene = decode_scene_json_without_catalog_for_test(
            &resources,
            "chapter_1/investigation_scene_1.json",
        )
        .unwrap();

        assert!(matches!(scene, SceneJson::Investigation(_)));
        let _ = fs::remove_dir_all(resources);
    }

    // Break caught: malformed thresholds can bypass parser validation through a
    // hand-edited JSON resource and reach the runtime as an impossible positive
    // expression.
    #[test]
    fn rejects_invalid_or_duplicate_threshold_children_before_catalog_validation() {
        let cases = [
            (
                json!({
                    "op": "at_least",
                    "count": 0,
                    "conditions": [{ "predicate": "evidence_collected", "id": "note" }]
                }),
                "invalid at_least threshold",
            ),
            (
                json!({
                    "op": "at_least",
                    "count": 2,
                    "conditions": [{ "predicate": "evidence_collected", "id": "note" }]
                }),
                "invalid at_least threshold",
            ),
            (
                json!({
                    "op": "at_least",
                    "count": 1,
                    "conditions": [
                        { "predicate": "evidence_collected", "id": "note" },
                        { "predicate": "evidence_collected", "id": "note" }
                    ]
                }),
                "duplicate at_least condition",
            ),
        ];

        for (unlock, expected) in cases {
            let resources = unique_temp_dir();
            write_scene_json(
                &resources,
                "investigation_scene_1.json",
                story_investigation_scene(unlock, json!([])),
            );

            let error = decode_scene_json_without_catalog_for_test(
                &resources,
                "chapter_1/investigation_scene_1.json",
            )
            .unwrap_err();

            assert_eq!(error.code, "sceneValidationFailed");
            assert!(error.message.contains(expected), "{error:?}");
            let _ = fs::remove_dir_all(resources);
        }
    }

    // Break caught: hand-edited story predicates can reference unknown catalog
    // definitions, or package analysis predicates before HPA-259 supplies the
    // required production registry.
    #[test]
    fn validates_story_predicate_references_against_the_loaded_catalog() {
        let cases = [
            (
                json!({ "predicate": "fact_asserted", "id": "missing_fact" }),
                "unresolved story predicate fact:missing_fact",
            ),
            (
                json!({ "predicate": "question_resolved", "id": "missing_question" }),
                "unresolved story predicate question:missing_question",
            ),
            (
                json!({ "predicate": "objective_completed", "id": "missing_objective" }),
                "unresolved story predicate objective:missing_objective",
            ),
            (
                json!({ "predicate": "authorization_granted", "id": "missing_authorization" }),
                "unresolved story predicate authorization:missing_authorization",
            ),
            (
                json!({
                    "predicate": "analysis_scene_completed",
                    "chapterId": "chapter_1",
                    "sceneId": "analysis_scene_1"
                }),
                "analysis_scene_completed is unavailable before HPA-259",
            ),
        ];

        for (unlock, expected) in cases {
            let resources = unique_temp_dir();
            write_scene_json(
                &resources,
                "investigation_scene_1.json",
                story_investigation_scene(unlock, json!([])),
            );
            let catalog = story_catalog_for_loader();

            let error = load_scene_with_catalog(
                &resources,
                &catalog,
                "chapter_1",
                "chapter_1/investigation_scene_1.json",
            )
            .unwrap_err();

            assert_eq!(error.code, "sceneValidationFailed");
            assert!(error.message.contains(expected), "{error:?}");
            let _ = fs::remove_dir_all(resources);
        }
    }

    // Break caught: qualified analysis references can contain arbitrary path or
    // separator characters before the intentionally-absent registry rejection.
    #[test]
    fn rejects_malformed_analysis_reference_slug_segments_before_registry_lookup() {
        let cases = [
            story_investigation_scene(
                json!({
                    "predicate": "analysis_scene_completed",
                    "chapterId": "chapter-1",
                    "sceneId": "analysis_scene_1"
                }),
                json!([]),
            ),
            story_interrogation_scene(
                json!({
                    "predicate": "analysis_board_completed",
                    "chapterId": "chapter_1",
                    "sceneId": "analysis_scene_1",
                    "boardId": "board-1"
                }),
                json!([]),
            ),
        ];

        for (index, scene) in cases.into_iter().enumerate() {
            let resources = unique_temp_dir();
            let file_name = if index == 0 {
                "investigation_scene_1.json"
            } else {
                "interrogation_scene_1.json"
            };
            write_scene_json(&resources, file_name, scene);
            let catalog = story_catalog_for_loader();

            let error = load_scene_with_catalog(
                &resources,
                &catalog,
                "chapter_1",
                &format!("chapter_1/{file_name}"),
            )
            .unwrap_err();

            assert_eq!(error.code, "sceneValidationFailed");
            assert!(error.message.contains("snake_case slug"), "{error:?}");
            let _ = fs::remove_dir_all(resources);
        }
    }

    // Break caught: target validation must cover all catalog registries and
    // reject authored target forms that contradict HPA-255's primary-objective
    // ownership rules.
    #[test]
    fn validates_story_targets_and_primary_objective_restrictions() {
        let cases = [
            (
                json!({ "kind": "assertFact", "factId": "missing_fact" }),
                "unresolved story target fact:missing_fact",
            ),
            (
                json!({ "kind": "revealQuestion", "questionId": "missing_question" }),
                "unresolved story target question:missing_question",
            ),
            (
                json!({
                    "kind": "resolveQuestion",
                    "questionId": "question_a",
                    "factId": "fact_b"
                }),
                "cannot be resolved by fact:fact_b",
            ),
            (
                json!({ "kind": "revealObjective", "objectiveId": "missing_objective" }),
                "unresolved story target objective:missing_objective",
            ),
            (
                json!({ "kind": "completeObjective", "objectiveId": "objective_primary" }),
                "completeObjective only accepts secondary objectives",
            ),
            (
                json!({
                    "kind": "setPrimaryObjective",
                    "completeCurrent": false,
                    "nextObjectiveId": "missing_objective"
                }),
                "unresolved setPrimaryObjective target objective:missing_objective",
            ),
            (
                json!({
                    "kind": "setPrimaryObjective",
                    "completeCurrent": false,
                    "nextObjectiveId": "objective_secondary"
                }),
                "setPrimaryObjective target must be primary",
            ),
            (
                json!({ "kind": "grantAuthorization", "authorizationId": "missing_authorization" }),
                "unresolved story target authorization:missing_authorization",
            ),
        ];

        for (target, expected) in cases {
            let resources = unique_temp_dir();
            write_scene_json(
                &resources,
                "investigation_scene_1.json",
                story_investigation_scene(json!(null), json!([target])),
            );
            let catalog = story_catalog_for_loader();

            let error = load_scene_with_catalog(
                &resources,
                &catalog,
                "chapter_1",
                "chapter_1/investigation_scene_1.json",
            )
            .unwrap_err();

            assert_eq!(error.code, "sceneValidationFailed");
            assert!(error.message.contains(expected), "{error:?}");
            let _ = fs::remove_dir_all(resources);
        }
    }

    #[test]
    fn accepts_catalog_resolved_non_authorization_story_targets_including_null_primary() {
        let resources = unique_temp_dir();
        write_scene_json(
            &resources,
            "investigation_scene_1.json",
            story_investigation_scene(
                json!(null),
                json!([
                    { "kind": "assertFact", "factId": "fact_a" },
                    { "kind": "revealQuestion", "questionId": "question_a" },
                    { "kind": "resolveQuestion", "questionId": "question_a", "factId": "fact_a" },
                    { "kind": "revealObjective", "objectiveId": "objective_secondary" },
                    { "kind": "completeObjective", "objectiveId": "objective_secondary" },
                    {
                        "kind": "setPrimaryObjective",
                        "completeCurrent": true,
                        "nextObjectiveId": "objective_primary"
                    },
                    {
                        "kind": "setPrimaryObjective",
                        "completeCurrent": false,
                        "nextObjectiveId": null
                    }
                ]),
            ),
        );
        let catalog = story_catalog_for_loader();

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

    // Break caught: neither investigation nor interrogation carries an
    // authority event in HPA-257, so a valid authorization target must not be
    // accepted merely because its ID exists in the catalog.
    #[test]
    fn rejects_authorization_grants_in_both_scene_families_before_hpa_264() {
        let cases = [
            (
                "investigation_scene_1.json",
                story_investigation_scene(
                    json!(null),
                    json!([{ "kind": "grantAuthorization", "authorizationId": "authorization_a" }]),
                ),
            ),
            (
                "interrogation_scene_1.json",
                story_interrogation_scene(
                    json!(null),
                    json!([{ "kind": "grantAuthorization", "authorizationId": "authorization_a" }]),
                ),
            ),
        ];

        for (file_name, scene) in cases {
            let resources = unique_temp_dir();
            write_scene_json(&resources, file_name, scene);
            let catalog = story_catalog_for_loader();

            let error = load_scene_with_catalog(
                &resources,
                &catalog,
                "chapter_1",
                &format!("chapter_1/{file_name}"),
            )
            .unwrap_err();

            assert_eq!(error.code, "sceneValidationFailed");
            assert!(
                error
                    .message
                    .contains("grantAuthorization is unavailable before HPA-264"),
                "{error:?}"
            );
            let _ = fs::remove_dir_all(resources);
        }
    }

    // Break caught: interrogation question and testimony-line arrays are both
    // combined local-or-story carriers; validating only phase-level reveals
    // lets malformed nested story references reach runtime.
    #[test]
    fn validates_story_targets_in_interrogation_question_and_line_carriers() {
        let resources = unique_temp_dir();
        let mut scene = story_interrogation_scene(json!(null), json!([]));
        scene["phases"][0]["questions"] = json!([{
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
                    "reveals": [{ "kind": "revealQuestion", "questionId": "missing_question" }]
                }]
            }
        }]);
        write_scene_json(&resources, "interrogation_scene_1.json", scene);
        let catalog = story_catalog_for_loader();

        let error = load_scene_with_catalog(
            &resources,
            &catalog,
            "chapter_1",
            "chapter_1/interrogation_scene_1.json",
        )
        .unwrap_err();

        assert_eq!(error.code, "sceneValidationFailed");
        assert!(
            error
                .message
                .contains("unresolved story target question:missing_question"),
            "{error:?}"
        );
        let _ = fs::remove_dir_all(resources);
    }

    #[test]
    fn rejects_null_objective_ids_in_the_loaded_story_catalog() {
        let resources = unique_temp_dir();
        fs::write(
            resources.join("story_catalog.json"),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 2,
                "facts": [],
                "questions": [],
                "objectives": [{
                    "id": null,
                    "label": "Broken objective",
                    "summary": "Broken objective summary",
                    "kind": "primary",
                    "sortOrder": 0
                }],
                "authorizations": [],
                "sourceGroups": [],
                "evidenceIndex": [],
                "statementsIndex": []
            }))
            .unwrap(),
        )
        .unwrap();

        let error = StoryCatalog::load(&resources).unwrap_err();

        assert_eq!(error.code, "storyCatalogLoadFailed");
        let _ = fs::remove_dir_all(resources);
    }
}
