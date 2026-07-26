use super::schema::{
    AudioCueSnapshotV1, AuthorizationProgressSnapshotV1, CharacterTopicRefV1, CrossExamSnapshotV1,
    DialogueHistoryEntryV1, DialogueHistorySnapshotV1, EvidenceInventoryEntryV1,
    FactProgressSnapshotV1, InterrogationOverrideRefV1, InventorySnapshotV1, InventoryTargetV1,
    InvestigationOverrideRefV1, LastVisualCueSnapshotV1, ObjectiveProgressSnapshotV1,
    QuestionProgressSnapshotV1, SaveSnapshotV1, SaveSummary, SceneProgressSnapshotV1,
    StatementInventoryEntryV1, StoryStateSnapshotV1,
};
use crate::game::dialogue::DIALOGUE_HISTORY_LIMIT;
use crate::game::dialogue_queue::{ActiveDialogueStateV1, DialogueSegmentOriginV1};
use crate::game::navigation::{load_chapter_scene_jsons, scene_json_identity};
use crate::game::scenes::interrogation::{CrossExam, InterrogationSceneState};
use crate::game::scenes::investigation::InvestigationSceneState;
use crate::game::scenes::SceneRuntime;
use crate::game::schema::{
    DialogueItem, InterrogationPhaseJson, InterrogationSceneJson, InventoryTarget,
    InvestigationSceneJson, SceneJson,
};
use crate::game::story::{StoryState, StoryStateSnapshot};
use crate::game::view::{DialogueHistoryEntry, QueueToken};
use crate::game::{GameEngine, GameError};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapturedCheckpointV1 {
    pub(crate) summary: SaveSummary,
    pub(crate) snapshot: SaveSnapshotV1,
}

pub(crate) fn capture_checkpoint_v1(
    engine: &GameEngine,
) -> Result<CapturedCheckpointV1, GameError> {
    // No `..`: every new engine field must be classified here before capture
    // can compile again.
    let GameEngine {
        resources_dir: _immutable_package_root,
        content_manifest: _immutable_content_identity,
        chapters: _immutable_chapter_manifests,
        story_catalog: _immutable_story_catalog,
        story_state,
        current_chapter_idx: _persisted_chapter_as_stable_id,
        current_scene_idx: _persisted_scene_as_stable_id,
        scene: _persisted_scene_progress,
        last_visual_cue,
        inventory,
        next_queue_gen,
        history,
        durable_revision,
        pending_acquisition_events,
    } = engine;

    let active_dialogue = engine.capture_active_dialogue()?;
    validate_active_dialogue(active_dialogue.as_ref(), *next_queue_gen)?;
    if let Some(active) = active_dialogue.as_ref() {
        engine
            .restore_active_dialogue_queue(engine.content_revision(), active)
            .map_err(|error| capture_error(error.message))?;
    }
    let (chapter_id, chapter_title, scene_id, scene_title, game_complete) =
        capture_location(engine)?;
    if game_complete && active_dialogue.is_some() {
        return Err(capture_error(
            "A completed game cannot retain an active dialogue queue.",
        ));
    }
    let scene = capture_scene_progress_with_active(engine, active_dialogue.as_ref())?;
    let story_snapshot = story_state.snapshot();
    StoryState::from_snapshot(&engine.story_catalog, story_snapshot.clone())
        .map_err(|error| capture_error(error.message))?;
    let story_state = capture_story_state(story_snapshot);
    let active_primary_objective_id = story_state.active_primary_objective_id.clone();
    let active_primary_objective_label = active_primary_objective_id
        .as_deref()
        .map(|id| {
            engine
                .story_catalog
                .objective(id)
                .map(|definition| definition.label.clone())
                .ok_or_else(|| {
                    capture_error(format!(
                        "Active primary objective '{id}' has no packaged definition."
                    ))
                })
        })
        .transpose()?;
    validate_inventory(engine)?;
    for event in pending_acquisition_events {
        crate::game::acquisition::validate_event_id(event)
            .map_err(|error| capture_error(error.message))?;
        if event.created_by_command_id == 0 || event.created_by_command_id > *durable_revision {
            return Err(capture_error(format!(
                "Pending acquisition '{}' names impossible command revision {}.",
                event.id, event.created_by_command_id
            )));
        }
        let record_exists = match event.record_kind {
            super::schema::RecordKind::Evidence => inventory
                .evidence
                .iter()
                .any(|record| record.id == event.record_id),
            super::schema::RecordKind::Statement => inventory
                .statements
                .iter()
                .any(|record| record.id == event.record_id),
        };
        if !record_exists {
            return Err(capture_error(format!(
                "Pending acquisition '{}' disagrees with inventory kind or record ID.",
                event.id
            )));
        }
    }

    let snapshot = SaveSnapshotV1 {
        chapter_id: chapter_id.clone(),
        scene_id: scene_id.clone(),
        scene,
        active_dialogue,
        last_visual_cue: LastVisualCueSnapshotV1 {
            scene_tag: last_visual_cue.scene_tag.clone(),
            background_asset_id: last_visual_cue.background_asset_id.clone(),
            bgm: last_visual_cue.bgm.as_ref().map(|cue| AudioCueSnapshotV1 {
                channel: cue.channel,
                asset_id: cue.asset_id.clone(),
            }),
            bgs: last_visual_cue.bgs.as_ref().map(|cue| AudioCueSnapshotV1 {
                channel: cue.channel,
                asset_id: cue.asset_id.clone(),
            }),
        },
        inventory: InventorySnapshotV1 {
            evidence: inventory
                .evidence
                .iter()
                .map(|record| EvidenceInventoryEntryV1 {
                    record_id: record.id.clone(),
                    collected_in_chapter_id: record.collected_in_chapter_id.clone(),
                    collected_in_scene_id: record.collected_in_scene_id.clone(),
                })
                .collect(),
            statements: inventory
                .statements
                .iter()
                .map(|record| StatementInventoryEntryV1 {
                    record_id: record.id.clone(),
                    acquired_in_chapter_id: record.acquired_in_chapter_id.clone(),
                    acquired_in_scene_id: record.acquired_in_scene_id.clone(),
                })
                .collect(),
        },
        pending_acquisition_events: pending_acquisition_events.clone(),
        story_state,
        dialogue_history: capture_history(engine, history, *next_queue_gen)?,
        next_queue_gen: *next_queue_gen,
        durable_revision: *durable_revision,
    };
    Ok(CapturedCheckpointV1 {
        summary: SaveSummary {
            chapter_id,
            chapter_title,
            scene_id,
            scene_title,
            active_primary_objective_id,
            active_primary_objective_label,
        },
        snapshot,
    })
}

pub(crate) fn capture_scene_progress_v1(
    engine: &GameEngine,
) -> Result<SceneProgressSnapshotV1, GameError> {
    let (_, _, _, _, game_complete) = capture_location(engine)?;
    let active_dialogue = engine.capture_active_dialogue()?;
    validate_active_dialogue(active_dialogue.as_ref(), engine.next_queue_gen)?;
    if let Some(active) = active_dialogue.as_ref() {
        engine
            .restore_active_dialogue_queue(engine.content_revision(), active)
            .map_err(|error| capture_error(error.message))?;
    }
    if game_complete && active_dialogue.is_some() {
        return Err(capture_error(
            "A completed game cannot retain an active dialogue queue.",
        ));
    }
    capture_scene_progress_with_active(engine, active_dialogue.as_ref())
}

fn capture_scene_progress_with_active(
    engine: &GameEngine,
    active_dialogue: Option<&ActiveDialogueStateV1>,
) -> Result<SceneProgressSnapshotV1, GameError> {
    if engine.current_chapter_idx == engine.chapters.len() {
        return Ok(SceneProgressSnapshotV1::GameComplete);
    }
    if engine.current_chapter_idx > engine.chapters.len() {
        return Err(capture_error(
            "Current chapter index is beyond game completion.",
        ));
    }

    let packaged_scene = current_packaged_scene(engine)?;
    match (&engine.scene, &packaged_scene) {
        (SceneRuntime::Linear(scene), SceneJson::Linear(_)) => {
            if scene.queue.is_none() {
                return Err(capture_error(
                    "A linear scene exhausted without entering its successor.",
                ));
            }
            Ok(SceneProgressSnapshotV1::Linear)
        }
        (SceneRuntime::Investigation(scene), SceneJson::Investigation(packaged)) => {
            validate_investigation_progress(scene, packaged)?;
            validate_investigation_intro(scene, active_dialogue, engine.next_queue_gen)?;
            validate_outro_commit(
                scene.outro_played,
                active_dialogue,
                |origin| matches!(origin, DialogueSegmentOriginV1::InvestigationOutro { .. }),
                "investigation",
            )?;
            let mut inspected_hotspot_ids: Vec<_> =
                scene.inspected_hotspots.iter().cloned().collect();
            inspected_hotspot_ids.sort();
            let mut discussed_topic_ids: Vec<_> = scene
                .discussed_topics
                .iter()
                .map(|(character_id, topic_id)| CharacterTopicRefV1 {
                    character_id: character_id.clone(),
                    topic_id: topic_id.clone(),
                })
                .collect();
            discussed_topic_ids.sort_by(|left, right| {
                (&left.character_id, &left.topic_id).cmp(&(&right.character_id, &right.topic_id))
            });
            let mut entered_sublocation_ids: Vec<_> =
                scene.entered_sublocations.iter().cloned().collect();
            entered_sublocation_ids.sort();
            let mut unlocked_overrides: Vec<_> = scene
                .unlocked_overrides
                .iter()
                .map(|key| capture_investigation_override(key))
                .collect::<Result<_, _>>()?;
            unlocked_overrides.sort_by(|left, right| {
                investigation_override_key(left).cmp(&investigation_override_key(right))
            });
            Ok(SceneProgressSnapshotV1::Investigation {
                intro_played: scene.intro_played,
                outro_played: scene.outro_played,
                current_sublocation_id: scene.current_sublocation_id.clone(),
                inspected_hotspot_ids,
                discussed_topic_ids,
                entered_sublocation_ids,
                unlocked_overrides,
            })
        }
        (SceneRuntime::Interrogation(scene), SceneJson::Interrogation(packaged)) => {
            validate_interrogation_progress(scene, packaged)?;
            validate_interrogation_intro(scene, active_dialogue, engine.next_queue_gen)?;
            validate_interrogation_phase_entry_commit(scene, active_dialogue)?;
            validate_outro_commit(
                scene.outro_played,
                active_dialogue,
                |origin| matches!(origin, DialogueSegmentOriginV1::InterrogationOutro { .. }),
                "interrogation",
            )?;
            let cross_exam = match &scene.cross_exam {
                CrossExam::Idle => CrossExamSnapshotV1::Idle,
                CrossExam::Playing {
                    question_id,
                    line_index,
                } => {
                    let line_id = packaged
                        .phases
                        .iter()
                        .find_map(|phase| {
                            let InterrogationPhaseJson::Inquiry { questions, .. } = phase;
                            questions.iter().find(|question| question.id == *question_id)
                        })
                        .and_then(|question| question.testimony.lines.get(*line_index))
                        .map(|line| line.id.clone())
                        .ok_or_else(|| {
                            capture_error(format!(
                                "Playing cross-exam coordinate '{question_id}'[{line_index}] is invalid."
                            ))
                        })?;
                    CrossExamSnapshotV1::Playing {
                        question_id: question_id.clone(),
                        line_id,
                    }
                }
                CrossExam::Presenting {
                    question_id,
                    line_id,
                } => {
                    if packaged_line(packaged, question_id, line_id).is_none() {
                        return Err(capture_error(format!(
                            "Presenting cross-exam coordinate '{question_id}'/'{line_id}' is invalid."
                        )));
                    }
                    CrossExamSnapshotV1::Presenting {
                        question_id: question_id.clone(),
                        line_id: line_id.clone(),
                    }
                }
            };
            let mut broken_question_ids: Vec<_> = scene.broken_questions.iter().cloned().collect();
            broken_question_ids.sort();
            let mut completed_phase_ids: Vec<_> = scene.completed_phases.iter().cloned().collect();
            completed_phase_ids.sort();
            let mut unlocked_overrides: Vec<_> = scene
                .unlocked_overrides
                .iter()
                .map(|key| capture_interrogation_override(key))
                .collect::<Result<_, _>>()?;
            unlocked_overrides.sort_by(|left, right| {
                interrogation_override_key(left).cmp(&interrogation_override_key(right))
            });
            let mut entered_phase_ids: Vec<_> = scene.entered_phase_ids().iter().cloned().collect();
            entered_phase_ids.sort();
            let line_content_segment_index =
                capture_line_content_segment_index(scene, &cross_exam)?;
            Ok(SceneProgressSnapshotV1::Interrogation {
                intro_played: scene.intro_played,
                outro_played: scene.outro_played,
                current_phase_id: scene.current_phase_id.clone(),
                cross_exam,
                broken_question_ids,
                completed_phase_ids,
                unlocked_overrides,
                entered_phase_ids,
                line_content_segment_index,
            })
        }
        _ => Err(capture_error(
            "Current runtime scene kind does not match its packaged definition.",
        )),
    }
}

fn current_packaged_scene(engine: &GameEngine) -> Result<SceneJson, GameError> {
    if engine.current_chapter_idx >= engine.chapters.len() {
        return Err(capture_error(
            "A completed or invalid location has no current progress definition.",
        ));
    }
    let chapter = &engine.chapters[engine.current_chapter_idx];
    load_chapter_scene_jsons(&engine.resources_dir, chapter)?
        .into_iter()
        .nth(engine.current_scene_idx)
        .ok_or_else(|| capture_error("Current packaged scene is missing."))
}

fn validate_investigation_progress(
    scene: &InvestigationSceneState,
    packaged: &InvestigationSceneJson,
) -> Result<(), GameError> {
    let sublocation_exists =
        |target: &str| packaged.sublocations.iter().any(|item| item.id == target);
    let hotspot_exists = |target: &str| {
        packaged
            .sublocations
            .iter()
            .flat_map(|item| &item.hotspots)
            .any(|item| item.id == target)
    };
    let topic_exists = |character_id: &str, topic_id: &str| {
        packaged
            .sublocations
            .iter()
            .flat_map(|item| &item.characters)
            .any(|character| {
                character.id == character_id
                    && character.topics.iter().any(|topic| topic.id == topic_id)
            })
    };
    if scene
        .current_sublocation_id
        .as_deref()
        .is_some_and(|id| !sublocation_exists(id))
    {
        return Err(capture_error(
            "Current investigation sublocation is unknown.",
        ));
    }
    for id in &scene.entered_sublocations {
        if !sublocation_exists(id) {
            return Err(capture_error(format!(
                "Entered investigation sublocation '{id}' is unknown."
            )));
        }
    }
    for id in &scene.inspected_hotspots {
        if !hotspot_exists(id) {
            return Err(capture_error(format!(
                "Inspected investigation hotspot '{id}' is unknown."
            )));
        }
    }
    for (character_id, topic_id) in &scene.discussed_topics {
        if !topic_exists(character_id, topic_id) {
            return Err(capture_error(format!(
                "Discussed investigation topic '{character_id}/{topic_id}' is unknown."
            )));
        }
    }
    for key in &scene.unlocked_overrides {
        match capture_investigation_override(key)? {
            InvestigationOverrideRefV1::Hotspot { id } if !hotspot_exists(&id) => {
                return Err(capture_error(format!(
                    "Investigation override hotspot '{id}' is unknown."
                )));
            }
            InvestigationOverrideRefV1::Sublocation { id } if !sublocation_exists(&id) => {
                return Err(capture_error(format!(
                    "Investigation override sublocation '{id}' is unknown."
                )));
            }
            InvestigationOverrideRefV1::Topic {
                character_id,
                topic_id,
            } if !topic_exists(&character_id, &topic_id) => {
                return Err(capture_error(format!(
                    "Investigation override topic '{character_id}/{topic_id}' is unknown."
                )));
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_interrogation_progress(
    scene: &InterrogationSceneState,
    packaged: &InterrogationSceneJson,
) -> Result<(), GameError> {
    let phase_exists = |target: &str| {
        packaged.phases.iter().any(|phase| {
            let InterrogationPhaseJson::Inquiry { id, .. } = phase;
            id == target
        })
    };
    let question_exists = |target: &str| {
        packaged.phases.iter().any(|phase| {
            let InterrogationPhaseJson::Inquiry { questions, .. } = phase;
            questions.iter().any(|question| question.id == target)
        })
    };
    if scene
        .current_phase_id
        .as_deref()
        .is_some_and(|id| !phase_exists(id))
    {
        return Err(capture_error("Current interrogation phase is unknown."));
    }
    for id in scene
        .completed_phases
        .iter()
        .chain(scene.entered_phase_ids().iter())
    {
        if !phase_exists(id) {
            return Err(capture_error(format!(
                "Interrogation phase progress '{id}' is unknown."
            )));
        }
    }
    for id in &scene.broken_questions {
        if !question_exists(id) {
            return Err(capture_error(format!(
                "Broken interrogation question '{id}' is unknown."
            )));
        }
    }
    for key in &scene.unlocked_overrides {
        match capture_interrogation_override(key)? {
            InterrogationOverrideRefV1::Question { id } if !question_exists(&id) => {
                return Err(capture_error(format!(
                    "Interrogation override question '{id}' is unknown."
                )));
            }
            InterrogationOverrideRefV1::Phase { id } if !phase_exists(&id) => {
                return Err(capture_error(format!(
                    "Interrogation override phase '{id}' is unknown."
                )));
            }
            _ => {}
        }
    }
    Ok(())
}

fn packaged_line<'a>(
    packaged: &'a InterrogationSceneJson,
    question_id: &str,
    line_id: &str,
) -> Option<&'a crate::game::schema::TestimonyLineJson> {
    packaged.phases.iter().find_map(|phase| {
        let InterrogationPhaseJson::Inquiry { questions, .. } = phase;
        questions
            .iter()
            .find(|question| question.id == question_id)?
            .testimony
            .lines
            .iter()
            .find(|line| line.id == line_id)
    })
}

fn capture_line_content_segment_index(
    scene: &InterrogationSceneState,
    cross_exam: &CrossExamSnapshotV1,
) -> Result<Option<usize>, GameError> {
    let Some(queue) = scene.pending_queue.as_ref() else {
        return Ok(None);
    };
    let segment_index = queue.segment_index_at_flattened_boundary(scene.line_content_start)?;
    let origins = queue.segment_origins();
    let Some(origin) = origins.get(segment_index) else {
        return Ok(None);
    };
    let (question_id, line_id) = match cross_exam {
        CrossExamSnapshotV1::Playing {
            question_id,
            line_id,
        }
        | CrossExamSnapshotV1::Presenting {
            question_id,
            line_id,
        } => (question_id, line_id),
        CrossExamSnapshotV1::Idle => {
            return Err(capture_error(
                "A testimony content boundary requires a current cross-exam line.",
            ));
        }
    };
    let DialogueSegmentOriginV1::InterrogationPhase {
        scene_id,
        segment_id,
        ..
    } = origin
    else {
        return Err(capture_error(
            "A testimony content boundary has a non-interrogation origin.",
        ));
    };
    let expected = format!("question:{question_id}:line:{line_id}:content");
    if scene_id != scene.id() || segment_id != &expected {
        return Err(capture_error(format!(
            "Testimony content origin '{segment_id}' does not match current line '{question_id}/{line_id}'."
        )));
    }
    Ok(Some(segment_index))
}

fn validate_inventory(engine: &GameEngine) -> Result<(), GameError> {
    for record in &engine.inventory.evidence {
        validate_inventory_record(
            engine,
            &record.id,
            &record.collected_in_chapter_id,
            &record.collected_in_scene_id,
            true,
        )?;
    }
    for record in &engine.inventory.statements {
        validate_inventory_record(
            engine,
            &record.id,
            &record.acquired_in_chapter_id,
            &record.acquired_in_scene_id,
            false,
        )?;
    }
    Ok(())
}

fn validate_inventory_record(
    engine: &GameEngine,
    record_id: &str,
    chapter_id: &str,
    scene_id: &str,
    evidence: bool,
) -> Result<(), GameError> {
    let scene = engine
        .packaged_acquisition_scene(chapter_id, scene_id)
        .map_err(|error| capture_error(error.message))?;
    let found = match scene {
        SceneJson::Investigation(scene) => {
            if evidence {
                scene
                    .evidence_manifest
                    .iter()
                    .any(|item| item.id == record_id)
            } else {
                scene
                    .statement_manifest
                    .iter()
                    .any(|item| item.id == record_id)
            }
        }
        SceneJson::Interrogation(scene) => {
            if evidence {
                scene
                    .evidence_manifest
                    .iter()
                    .any(|item| item.id == record_id)
            } else {
                scene
                    .statement_manifest
                    .iter()
                    .any(|item| item.id == record_id)
            }
        }
        SceneJson::Linear(_) => false,
    };
    if !found {
        return Err(capture_error(format!(
            "Inventory {} '{record_id}' has invalid packaged provenance '{chapter_id}/{scene_id}'.",
            if evidence { "evidence" } else { "statement" }
        )));
    }
    Ok(())
}

fn validate_interrogation_phase_entry_commit(
    scene: &InterrogationSceneState,
    active: Option<&ActiveDialogueStateV1>,
) -> Result<(), GameError> {
    let Some(active) = active else {
        return Ok(());
    };
    for origin in &active.segment_origins {
        let DialogueSegmentOriginV1::InterrogationPhase {
            phase_id,
            segment_id,
            ..
        } = origin
        else {
            continue;
        };
        if segment_id == &format!("phase:{phase_id}:entry")
            && (scene.current_phase_id.as_deref() != Some(phase_id)
                || !scene.phase_entered(phase_id))
        {
            return Err(capture_error(format!(
                "Interrogation phase-entry queue for '{phase_id}' was installed before its phase commit."
            )));
        }
    }
    Ok(())
}

fn validate_active_dialogue(
    active: Option<&ActiveDialogueStateV1>,
    next_queue_gen: u64,
) -> Result<(), GameError> {
    if next_queue_gen == 0 {
        return Err(capture_error("Next queue generation cannot be zero."));
    }
    if let Some(active) = active {
        if active.segment_origins.is_empty() {
            return Err(capture_error("An active dialogue queue has no segments."));
        }
        if active.queue_gen == 0 || active.queue_gen >= next_queue_gen {
            return Err(capture_error(format!(
                "Active dialogue queue generation {} is outside 1..{next_queue_gen}.",
                active.queue_gen
            )));
        }
    }
    Ok(())
}

fn validate_investigation_intro(
    scene: &InvestigationSceneState,
    active: Option<&ActiveDialogueStateV1>,
    next_queue_gen: u64,
) -> Result<(), GameError> {
    validate_intro_generation(
        scene.intro_queue_gen,
        next_queue_gen,
        crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
    )?;
    let active_intro = active.is_some_and(|queue| {
        queue.segment_origins.iter().any(|origin| {
            matches!(
                origin,
                DialogueSegmentOriginV1::InvestigationIntro { scene_id, .. }
                    if scene_id == scene.id()
            )
        })
    });
    if active_intro && (!scene.intro_played || active.unwrap().queue_gen != scene.intro_queue_gen) {
        return Err(capture_error(
            "Active investigation intro has inconsistent played/generation state.",
        ));
    }
    if !scene.intro_played
        && (!scene.def.intro.is_empty()
            || (scene.current_sublocation_id.is_none()
                && scene.intro_queue_gen
                    != crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN))
    {
        return Err(capture_error(
            "Investigation capture occurred before initial queue priming.",
        ));
    }
    Ok(())
}

fn validate_interrogation_intro(
    scene: &InterrogationSceneState,
    active: Option<&ActiveDialogueStateV1>,
    next_queue_gen: u64,
) -> Result<(), GameError> {
    validate_intro_generation(
        scene.intro_queue_gen,
        next_queue_gen,
        crate::game::scenes::interrogation::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
    )?;
    let active_intro = active.is_some_and(|queue| {
        queue.segment_origins.iter().any(|origin| {
            matches!(
                origin,
                DialogueSegmentOriginV1::InterrogationIntro { scene_id, .. }
                    if scene_id == scene.id()
            )
        })
    });
    if active_intro && (!scene.intro_played || active.unwrap().queue_gen != scene.intro_queue_gen) {
        return Err(capture_error(
            "Active interrogation intro has inconsistent played/generation state.",
        ));
    }
    if !scene.intro_played {
        return Err(capture_error(
            "Interrogation capture occurred before initial queue priming.",
        ));
    }
    Ok(())
}

fn validate_intro_generation(
    intro_queue_gen: u64,
    next_queue_gen: u64,
    restored_consumed_intro_queue_gen: u64,
) -> Result<(), GameError> {
    if intro_queue_gen != restored_consumed_intro_queue_gen && intro_queue_gen >= next_queue_gen {
        return Err(capture_error(format!(
            "Intro queue generation {intro_queue_gen} is not before next generation {next_queue_gen}."
        )));
    }
    Ok(())
}

fn validate_outro_commit(
    outro_played: bool,
    active: Option<&ActiveDialogueStateV1>,
    is_outro: impl Fn(&DialogueSegmentOriginV1) -> bool,
    scene_kind: &str,
) -> Result<(), GameError> {
    if active.is_some_and(|queue| queue.segment_origins.iter().any(is_outro)) && !outro_played {
        return Err(capture_error(format!(
            "Active {scene_kind} outro was not committed before queue installation."
        )));
    }
    Ok(())
}

fn capture_investigation_override(
    runtime_key: &str,
) -> Result<InvestigationOverrideRefV1, GameError> {
    if let Some(id) = runtime_key.strip_prefix("hotspot:") {
        validate_override_component(id, runtime_key)?;
        return Ok(InvestigationOverrideRefV1::Hotspot { id: id.into() });
    }
    if let Some(id) = runtime_key.strip_prefix("sublocation:") {
        validate_override_component(id, runtime_key)?;
        return Ok(InvestigationOverrideRefV1::Sublocation { id: id.into() });
    }
    if let Some(pair) = runtime_key.strip_prefix("topic:") {
        let (character_id, topic_id) = pair
            .split_once('@')
            .ok_or_else(|| capture_error(format!("Malformed override key '{runtime_key}'.")))?;
        validate_override_component(character_id, runtime_key)?;
        validate_override_component(topic_id, runtime_key)?;
        return Ok(InvestigationOverrideRefV1::Topic {
            character_id: character_id.into(),
            topic_id: topic_id.into(),
        });
    }
    Err(capture_error(format!(
        "Unknown investigation override key '{runtime_key}'."
    )))
}

fn capture_interrogation_override(
    runtime_key: &str,
) -> Result<InterrogationOverrideRefV1, GameError> {
    if let Some(id) = runtime_key.strip_prefix("question:") {
        validate_override_component(id, runtime_key)?;
        return Ok(InterrogationOverrideRefV1::Question { id: id.into() });
    }
    if let Some(id) = runtime_key.strip_prefix("phase:") {
        validate_override_component(id, runtime_key)?;
        return Ok(InterrogationOverrideRefV1::Phase { id: id.into() });
    }
    Err(capture_error(format!(
        "Unknown interrogation override key '{runtime_key}'."
    )))
}

fn validate_override_component(component: &str, runtime_key: &str) -> Result<(), GameError> {
    if component.is_empty() || component.contains(':') || component.contains('@') {
        return Err(capture_error(format!(
            "Malformed override key '{runtime_key}'."
        )));
    }
    Ok(())
}

fn investigation_override_key(value: &InvestigationOverrideRefV1) -> (u8, &str, &str) {
    match value {
        InvestigationOverrideRefV1::Hotspot { id } => (0, id, ""),
        InvestigationOverrideRefV1::Sublocation { id } => (1, id, ""),
        InvestigationOverrideRefV1::Topic {
            character_id,
            topic_id,
        } => (2, character_id, topic_id),
    }
}

fn interrogation_override_key(value: &InterrogationOverrideRefV1) -> (u8, &str) {
    match value {
        InterrogationOverrideRefV1::Question { id } => (0, id),
        InterrogationOverrideRefV1::Phase { id } => (1, id),
    }
}

fn capture_story_state(snapshot: StoryStateSnapshot) -> StoryStateSnapshotV1 {
    StoryStateSnapshotV1 {
        facts: snapshot
            .facts
            .into_iter()
            .map(|(id, progress)| {
                (
                    id,
                    FactProgressSnapshotV1 {
                        asserted_in_chapter_id: progress.asserted_in_chapter_id,
                        asserted_in_scene_id: progress.asserted_in_scene_id,
                        first_origin: progress.first_origin,
                        supporting_records: progress
                            .supporting_records
                            .into_iter()
                            .map(|target| match target {
                                InventoryTarget::Evidence { id } => {
                                    InventoryTargetV1::Evidence { id }
                                }
                                InventoryTarget::Statement { id } => {
                                    InventoryTargetV1::Statement { id }
                                }
                            })
                            .collect(),
                        supporting_fact_ids: progress.supporting_fact_ids,
                    },
                )
            })
            .collect(),
        questions: snapshot
            .questions
            .into_iter()
            .map(|(id, progress)| {
                (
                    id,
                    QuestionProgressSnapshotV1 {
                        resolved_by_fact_id: progress.resolved_by_fact_id,
                    },
                )
            })
            .collect(),
        objectives: snapshot
            .objectives
            .into_iter()
            .map(|(id, progress)| {
                (
                    id,
                    ObjectiveProgressSnapshotV1 {
                        completed: progress.completed,
                    },
                )
            })
            .collect(),
        authorizations: snapshot
            .authorizations
            .into_iter()
            .map(|(id, progress)| {
                (
                    id,
                    AuthorizationProgressSnapshotV1 {
                        granted_in_chapter_id: progress.granted_in_chapter_id,
                        granted_in_scene_id: progress.granted_in_scene_id,
                        first_origin: progress.first_origin,
                    },
                )
            })
            .collect(),
        active_primary_objective_id: snapshot.active_primary_objective_id,
    }
}

fn capture_history(
    engine: &GameEngine,
    history: &crate::game::dialogue::DialogueHistory,
    next_queue_gen: u64,
) -> Result<DialogueHistorySnapshotV1, GameError> {
    let (entries, next_id, last_token) = history.persistence_parts();
    if entries.len() > DIALOGUE_HISTORY_LIMIT {
        return Err(capture_error(format!(
            "Dialogue history has {} entries; limit is {DIALOGUE_HISTORY_LIMIT}.",
            entries.len()
        )));
    }
    let mut prior_id = None;
    for entry in entries {
        let id = match entry {
            DialogueHistoryEntry::Line { id, .. } | DialogueHistoryEntry::Action { id, .. } => *id,
        };
        if id == 0 || id >= next_id || prior_id.is_some_and(|prior| id != prior + 1) {
            return Err(capture_error(
                "Dialogue history IDs are not structurally valid.",
            ));
        }
        prior_id = Some(id);
    }
    if next_id == 0 {
        return Err(capture_error("Dialogue history next ID cannot be zero."));
    }
    if entries.is_empty() && next_id != 1 {
        return Err(capture_error(
            "Empty dialogue history must retain the initial next ID.",
        ));
    }
    if let Some(last_id) = prior_id {
        if last_id.checked_add(1) != Some(next_id)
            || (entries.len() < DIALOGUE_HISTORY_LIMIT
                && !matches!(
                    entries.first(),
                    Some(DialogueHistoryEntry::Line { id: 1, .. })
                        | Some(DialogueHistoryEntry::Action { id: 1, .. })
                ))
        {
            return Err(capture_error(
                "Dialogue history counter does not follow its retained entries.",
            ));
        }
    }
    if last_token.is_some() == entries.is_empty() {
        return Err(capture_error(
            "Dialogue history token presence does not match retained entries.",
        ));
    }
    if let Some(token) = last_token {
        validate_history_token(engine, token, next_queue_gen)?;
    }
    Ok(DialogueHistorySnapshotV1 {
        entries: entries
            .iter()
            .map(|entry| match entry {
                DialogueHistoryEntry::Line {
                    id,
                    speaker,
                    text,
                    chapter_title,
                    scene_title,
                } => DialogueHistoryEntryV1::Line {
                    id: *id,
                    speaker: speaker.clone(),
                    text: text.clone(),
                    chapter_title: chapter_title.clone(),
                    scene_title: scene_title.clone(),
                },
                DialogueHistoryEntry::Action {
                    id,
                    text,
                    chapter_title,
                    scene_title,
                } => DialogueHistoryEntryV1::Action {
                    id: *id,
                    text: text.clone(),
                    chapter_title: chapter_title.clone(),
                    scene_title: scene_title.clone(),
                },
            })
            .collect(),
        next_id,
        last_token: last_token.cloned(),
    })
}

fn validate_history_token(
    engine: &GameEngine,
    token: &QueueToken,
    next_queue_gen: u64,
) -> Result<(), GameError> {
    if token.queue_gen == 0 || token.queue_gen >= next_queue_gen {
        return Err(capture_error(format!(
            "Dialogue history queue generation {} is outside 1..{next_queue_gen}.",
            token.queue_gen
        )));
    }
    let maxima = packaged_scene_cursor_exclusive(engine, &token.scene_id)?;
    if !maxima.iter().any(|maximum| token.cursor < *maximum) {
        return Err(capture_error(format!(
            "Dialogue history cursor {} is outside every packaged scene '{}' bound.",
            token.cursor, token.scene_id
        )));
    }
    if let Some(active) = engine.current_queue_token() {
        if active.scene_id == token.scene_id
            && active.queue_gen == token.queue_gen
            && active != *token
        {
            return Err(capture_error(
                "Dialogue history token disagrees with the same active queue.",
            ));
        }
    }
    Ok(())
}

fn packaged_scene_cursor_exclusive(
    engine: &GameEngine,
    target_scene_id: &str,
) -> Result<Vec<usize>, GameError> {
    let mut found = Vec::new();
    for chapter in &engine.chapters {
        for scene in load_chapter_scene_jsons(&engine.resources_dir, chapter)? {
            if scene_json_identity(&scene).0 == target_scene_id {
                found.push(maximum_scene_dialogue_items(&scene)?);
            }
        }
    }
    found.retain(|maximum| *maximum > 0);
    if found.is_empty() {
        return Err(capture_error(format!(
            "Unknown dialogue history scene '{target_scene_id}'."
        )));
    }
    Ok(found)
}

fn maximum_scene_dialogue_items(scene: &SceneJson) -> Result<usize, GameError> {
    let groups: Vec<&[DialogueItem]> = match scene {
        SceneJson::Linear(scene) => vec![&scene.queue],
        SceneJson::Investigation(scene) => investigation_dialogue_groups(scene),
        SceneJson::Interrogation(scene) => interrogation_dialogue_groups(scene),
    };
    groups.into_iter().try_fold(0usize, |total, items| {
        total
            .checked_add(items.len())
            .ok_or_else(|| capture_error("Packaged dialogue item count overflowed usize."))
    })
}

fn investigation_dialogue_groups(scene: &InvestigationSceneJson) -> Vec<&[DialogueItem]> {
    let mut groups = vec![scene.intro.as_slice(), scene.outro.dialogue.as_slice()];
    for sublocation in &scene.sublocations {
        groups.push(&sublocation.transition_dialogue);
        for hotspot in &sublocation.hotspots {
            groups.push(&hotspot.inspect_dialogue);
            if let Some(items) = hotspot.on_reexamine.as_deref() {
                groups.push(items);
            }
        }
        for character in &sublocation.characters {
            for topic in &character.topics {
                groups.push(&topic.topic_dialogue);
                if let Some(items) = topic.on_reexamine.as_deref() {
                    groups.push(items);
                }
            }
        }
    }
    for evidence in &scene.evidence_manifest {
        groups.push(&evidence.on_collect);
        if let Some(items) = evidence.on_reexamine.as_deref() {
            groups.push(items);
        }
    }
    for statement in &scene.statement_manifest {
        groups.push(&statement.on_acquire);
        if let Some(items) = statement.on_reexamine.as_deref() {
            groups.push(items);
        }
    }
    groups
}

fn interrogation_dialogue_groups(scene: &InterrogationSceneJson) -> Vec<&[DialogueItem]> {
    let mut groups = vec![scene.intro.as_slice(), scene.outro.dialogue.as_slice()];
    for phase in &scene.phases {
        let InterrogationPhaseJson::Inquiry {
            entry_dialogue,
            questions,
            ..
        } = phase;
        groups.push(entry_dialogue);
        for question in questions {
            groups.push(&question.testimony.on_loop);
            groups.push(&question.testimony.loop_prompt);
            groups.push(&question.testimony.default_challenge);
            groups.push(&question.testimony.default_wrong);
            groups.push(&question.testimony.wrong_reply);
            for line in &question.testimony.lines {
                groups.push(&line.content);
                groups.push(&line.challenge);
                groups.push(&line.on_correct);
                groups.push(&line.on_wrong_evidence);
            }
        }
    }
    for evidence in &scene.evidence_manifest {
        groups.push(&evidence.on_collect);
        if let Some(items) = evidence.on_reexamine.as_deref() {
            groups.push(items);
        }
    }
    for statement in &scene.statement_manifest {
        groups.push(&statement.on_acquire);
        if let Some(items) = statement.on_reexamine.as_deref() {
            groups.push(items);
        }
    }
    groups
}

fn capture_location(
    engine: &GameEngine,
) -> Result<(String, String, String, String, bool), GameError> {
    if engine.current_chapter_idx > engine.chapters.len() {
        return Err(capture_error(
            "Current chapter index is beyond game completion.",
        ));
    }
    if engine.current_chapter_idx == engine.chapters.len() {
        let chapter = engine
            .chapters
            .last()
            .ok_or_else(|| capture_error("Game complete has no final chapter."))?;
        let scenes = load_chapter_scene_jsons(&engine.resources_dir, chapter)?;
        let packaged_scene = scenes
            .last()
            .ok_or_else(|| capture_error("Game complete has no final scene."))?;
        if engine.scene.id() != scene_json_identity(packaged_scene).0 {
            return Err(capture_error(
                "Retained game-complete runtime is not the packaged final scene.",
            ));
        }
        return Ok((
            chapter.id.clone(),
            chapter.title.clone(),
            scene_json_identity(packaged_scene).0.into(),
            scene_json_identity(packaged_scene).1.into(),
            true,
        ));
    }

    let chapter = &engine.chapters[engine.current_chapter_idx];
    let scenes = load_chapter_scene_jsons(&engine.resources_dir, chapter)?;
    let packaged_scene = scenes.get(engine.current_scene_idx).ok_or_else(|| {
        capture_error(format!(
            "Current scene index {} is outside chapter '{}'.",
            engine.current_scene_idx, chapter.id
        ))
    })?;
    if engine.scene.id() != scene_json_identity(packaged_scene).0 {
        return Err(capture_error(
            "Current runtime scene does not match its packaged scene index.",
        ));
    }
    Ok((
        chapter.id.clone(),
        chapter.title.clone(),
        scene_json_identity(packaged_scene).0.into(),
        scene_json_identity(packaged_scene).1.into(),
        false,
    ))
}

fn capture_error(message: impl Into<String>) -> GameError {
    GameError::new("invalidSaveCapture", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::dialogue::DialogueHistory;
    use crate::game::dialogue_queue::{
        ActiveDialogueQueue, DialogueSegment, DialogueSegmentOriginV1,
    };
    use crate::game::save::schema::{
        AcquisitionEventStateV1, CharacterTopicRefV1, CrossExamSnapshotV1, DialogueHistoryEntryV1,
        InvestigationOverrideRefV1, RecordKind, SceneProgressSnapshotV1,
    };
    use crate::game::scenes::interrogation::CrossExam;
    use crate::game::scenes::SceneRuntime;
    use crate::game::schema::{AudioChannelJson, AudioCueJson, DialogueItem};
    use crate::game::state::{EvidenceRecord, StatementRecord};
    use crate::game::test_support::save_capture_fixture_resources;
    use crate::game::view::QueueToken;
    use crate::game::GameEngine;
    use serde_json::json;

    fn action(text: &str) -> DialogueItem {
        DialogueItem::Action { text: text.into() }
    }

    fn segment(origin: DialogueSegmentOriginV1, text: &str) -> DialogueSegment {
        DialogueSegment::new(origin, vec![action(text)]).unwrap()
    }

    fn investigation_origin(segment_id: &str) -> DialogueSegmentOriginV1 {
        DialogueSegmentOriginV1::InvestigationInteraction {
            chapter_id: "chapter_1".into(),
            scene_id: "investigation_scene_1".into(),
            segment_id: segment_id.into(),
        }
    }

    fn interrogation_origin(segment_id: &str) -> DialogueSegmentOriginV1 {
        DialogueSegmentOriginV1::InterrogationPhase {
            chapter_id: "chapter_1".into(),
            scene_id: "interrogation_scene_2".into(),
            phase_id: "phase_1".into(),
            segment_id: segment_id.into(),
        }
    }

    fn fixture_engine() -> GameEngine {
        GameEngine::new_started(save_capture_fixture_resources()).unwrap()
    }

    #[test]
    fn captures_active_linear_checkpoint_as_exact_wire_value() {
        let mut engine = fixture_engine();
        engine
            .story_state
            .reveal_objective(&engine.story_catalog, "objective_truth")
            .unwrap();
        engine
            .story_state
            .set_primary_objective(&engine.story_catalog, false, Some("objective_truth"))
            .unwrap();
        engine.last_visual_cue.bgm = Some(AudioCueJson {
            channel: AudioChannelJson::Bgm,
            asset_id: Some("bgm.rain".into()),
        });
        engine.durable_revision = 7;

        let captured = capture_checkpoint_v1(&engine).unwrap();

        assert_eq!(
            serde_json::to_value(captured).unwrap(),
            json!({
                "summary": {
                    "chapterId": "chapter_1",
                    "chapterTitle": "Chapter One",
                    "sceneId": "scene_0",
                    "sceneTitle": "Opening",
                    "activePrimaryObjectiveId": "objective_truth",
                    "activePrimaryObjectiveLabel": "Find the truth"
                },
                "snapshot": {
                    "chapterId": "chapter_1",
                    "sceneId": "scene_0",
                    "scene": {"type": "linear"},
                    "activeDialogue": {
                        "segmentOrigins": [{
                            "type": "linearScene",
                            "chapterId": "chapter_1",
                            "sceneId": "scene_0"
                        }],
                        "activeSegmentIndex": 0,
                        "itemCursor": 1,
                        "queueGen": 1
                    },
                    "lastVisualCue": {
                        "sceneTag": "opening",
                        "backgroundAssetId": "background.opening",
                        "bgm": {"channel": "bgm", "assetId": "bgm.rain"},
                        "bgs": null
                    },
                    "inventory": {"evidence": [], "statements": []},
                    "pendingAcquisitionEvents": [],
                    "storyState": {
                        "facts": {},
                        "questions": {},
                        "objectives": {"objective_truth": {"completed": false}},
                        "authorizations": {},
                        "activePrimaryObjectiveId": "objective_truth"
                    },
                    "dialogueHistory": {
                        "entries": [{
                            "type": "line",
                            "id": 1,
                            "speaker": "A",
                            "text": "linear start",
                            "chapterTitle": "Chapter One",
                            "sceneTitle": "Opening"
                        }],
                        "nextId": 2,
                        "lastToken": {"sceneId":"scene_0","queueGen":1,"cursor":1}
                    },
                    "nextQueueGen": 2,
                    "durableRevision": 7
                }
            })
        );
    }

    #[test]
    fn rejects_a_linear_runtime_left_without_its_entered_successor() {
        let mut engine = fixture_engine();
        let SceneRuntime::Linear(scene) = &mut engine.scene else {
            panic!("expected linear fixture");
        };
        scene.queue = None;

        let error = capture_checkpoint_v1(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn captures_game_complete_with_the_retained_final_scene_identity() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!("expected final interrogation");
        };
        scene.pending_queue = None;
        scene.intro_played = true;
        scene.outro_played = true;
        engine.current_chapter_idx = engine.chapters.len();
        engine.current_scene_idx = 0;
        engine.history = DialogueHistory::default();

        let captured = capture_checkpoint_v1(&engine).unwrap();

        assert_eq!(captured.snapshot.chapter_id, "chapter_1");
        assert_eq!(captured.snapshot.scene_id, "interrogation_scene_2");
        assert_eq!(
            captured.snapshot.scene,
            SceneProgressSnapshotV1::GameComplete
        );
        assert_eq!(captured.summary.chapter_title, "Chapter One");
        assert_eq!(captured.summary.scene_title, "Interrogation");
        assert!(captured.snapshot.active_dialogue.is_none());
    }

    #[test]
    fn scene_progress_capture_rejects_game_complete_with_a_nonfinal_runtime() {
        let mut engine = fixture_engine();
        engine.current_chapter_idx = engine.chapters.len();
        engine.current_scene_idx = 0;

        let error = capture_scene_progress_v1(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn captures_investigation_progress_inventory_and_composite_queue_deterministically() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("expected investigation");
        };
        scene.intro_played = true;
        scene.outro_played = false;
        scene.current_sublocation_id = Some("room".into());
        scene
            .inspected_hotspots
            .extend(["desk".into(), "lamp".into()]);
        scene.discussed_topics.extend([
            ("witness".into(), "alibi".into()),
            ("clerk".into(), "rain".into()),
        ]);
        scene
            .entered_sublocations
            .extend(["room".into(), "archive".into()]);
        scene.unlocked_overrides.extend([
            "topic:witness@alibi".into(),
            "hotspot:desk".into(),
            "sublocation:archive".into(),
        ]);
        let segments = vec![
            DialogueSegment::new(
                investigation_origin("evidence:test_evidence:onCollect"),
                vec![action("onCollect one"), action("onCollect two")],
            )
            .unwrap(),
            segment(
                investigation_origin("statement:alibi_statement:onAcquire"),
                "onAcquire",
            ),
            segment(investigation_origin("hotspot:desk:inspect"), "result"),
            segment(
                investigation_origin("topic:witness:alibi:dialogue"),
                "reveal",
            ),
        ];
        scene.pending_queue = Some(ActiveDialogueQueue::from_position(segments, 2, 0, 8).unwrap());
        engine.next_queue_gen = 9;
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "mutable copy must not persist".into(),
            description: "mutable".into(),
            details: "mutable".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "investigation_scene_1".into(),
        });
        engine.inventory.statements.push(StatementRecord {
            id: "alibi_statement".into(),
            speaker: "mutable".into(),
            content: "mutable".into(),
            on_reexamine: None,
            acquired_in_chapter_id: "chapter_1".into(),
            acquired_in_scene_id: "investigation_scene_1".into(),
        });
        engine.pending_acquisition_events = vec![AcquisitionEventStateV1 {
            id: "acq:8:0".into(),
            record_kind: RecordKind::Evidence,
            record_id: "test_evidence".into(),
            created_by_command_id: 8,
            ordinal: 0,
        }];
        engine.durable_revision = 8;

        let live_token = engine.current_queue_token().unwrap();
        let captured = capture_checkpoint_v1(&engine).unwrap();

        assert_eq!(
            captured.snapshot.scene,
            SceneProgressSnapshotV1::Investigation {
                intro_played: true,
                outro_played: false,
                current_sublocation_id: Some("room".into()),
                inspected_hotspot_ids: vec!["desk".into(), "lamp".into()],
                discussed_topic_ids: vec![
                    CharacterTopicRefV1 {
                        character_id: "clerk".into(),
                        topic_id: "rain".into(),
                    },
                    CharacterTopicRefV1 {
                        character_id: "witness".into(),
                        topic_id: "alibi".into(),
                    },
                ],
                entered_sublocation_ids: vec!["archive".into(), "room".into()],
                unlocked_overrides: vec![
                    InvestigationOverrideRefV1::Hotspot { id: "desk".into() },
                    InvestigationOverrideRefV1::Sublocation {
                        id: "archive".into(),
                    },
                    InvestigationOverrideRefV1::Topic {
                        character_id: "witness".into(),
                        topic_id: "alibi".into(),
                    },
                ],
            }
        );
        assert_eq!(
            serde_json::to_value(&captured.snapshot.inventory).unwrap(),
            json!({
                "evidence": [{
                    "recordId": "test_evidence",
                    "collectedInChapterId": "chapter_1",
                    "collectedInSceneId": "investigation_scene_1"
                }],
                "statements": [{
                    "recordId": "alibi_statement",
                    "acquiredInChapterId": "chapter_1",
                    "acquiredInSceneId": "investigation_scene_1"
                }]
            })
        );
        let active = captured.snapshot.active_dialogue.as_ref().unwrap();
        assert_eq!(
            active.segment_origins,
            vec![
                DialogueSegmentOriginV1::InvestigationInteraction {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    segment_id: "evidence:test_evidence:onCollect".into(),
                },
                DialogueSegmentOriginV1::InvestigationInteraction {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    segment_id: "statement:alibi_statement:onAcquire".into(),
                },
                DialogueSegmentOriginV1::InvestigationInteraction {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    segment_id: "hotspot:desk:inspect".into(),
                },
                DialogueSegmentOriginV1::InvestigationInteraction {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    segment_id: "topic:witness:alibi:dialogue".into(),
                },
            ]
        );
        let captured_segment_lengths = [2usize, 1, 1, 1];
        let reconstructed_cursor = captured_segment_lengths[..active.active_segment_index]
            .iter()
            .sum::<usize>()
            + active.item_cursor;
        assert_eq!(
            live_token,
            QueueToken {
                scene_id: "investigation_scene_1".into(),
                queue_gen: active.queue_gen,
                cursor: reconstructed_cursor,
            }
        );
    }

    #[test]
    fn captures_interrogation_playing_and_presenting_with_stable_line_ids() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!("expected interrogation");
        };
        scene.intro_played = true;
        scene.outro_played = false;
        scene.current_phase_id = Some("phase_1".into());
        scene.cross_exam = CrossExam::Playing {
            question_id: "q1".into(),
            line_index: 0,
        };
        scene.broken_questions.extend(["resolved_question".into()]);
        scene.completed_phases.extend(["phase_zero".into()]);
        scene
            .unlocked_overrides
            .extend(["phase:phase_two".into(), "question:q1".into()]);
        scene.mark_phase_entered("phase_1");
        let segments = vec![
            DialogueSegment::new(
                interrogation_origin("question:q1:onLoop"),
                vec![action("onLoop one"), action("onLoop two")],
            )
            .unwrap(),
            segment(interrogation_origin("question:q1:loopPrompt"), "prompt"),
            segment(interrogation_origin("question:q1:line:l1:content"), "line"),
        ];
        scene.pending_queue = Some(ActiveDialogueQueue::from_position(segments, 1, 0, 12).unwrap());
        scene.line_content_start = 3;
        engine.next_queue_gen = 13;

        let live_token = engine.current_queue_token().unwrap();
        let playing = capture_checkpoint_v1(&engine).unwrap();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.cross_exam = CrossExam::Presenting {
            question_id: "q1".into(),
            line_id: "l1".into(),
        };
        let presenting = capture_checkpoint_v1(&engine).unwrap();

        let SceneProgressSnapshotV1::Interrogation {
            cross_exam,
            line_content_segment_index,
            broken_question_ids,
            completed_phase_ids,
            unlocked_overrides,
            entered_phase_ids,
            ..
        } = playing.snapshot.scene
        else {
            panic!("expected interrogation snapshot");
        };
        assert_eq!(
            cross_exam,
            CrossExamSnapshotV1::Playing {
                question_id: "q1".into(),
                line_id: "l1".into(),
            }
        );
        assert_eq!(line_content_segment_index, Some(2));
        assert_eq!(broken_question_ids, vec!["resolved_question"]);
        assert_eq!(completed_phase_ids, vec!["phase_zero"]);
        assert_eq!(entered_phase_ids, vec!["phase_1"]);
        assert_eq!(
            serde_json::to_value(unlocked_overrides).unwrap(),
            json!([
                {"type":"question","id":"q1"},
                {"type":"phase","id":"phase_two"}
            ])
        );
        let SceneProgressSnapshotV1::Interrogation { cross_exam, .. } = presenting.snapshot.scene
        else {
            panic!("expected interrogation snapshot");
        };
        assert_eq!(
            cross_exam,
            CrossExamSnapshotV1::Presenting {
                question_id: "q1".into(),
                line_id: "l1".into(),
            }
        );
        let active = presenting.snapshot.active_dialogue.as_ref().unwrap();
        assert_eq!(
            active.segment_origins,
            vec![
                DialogueSegmentOriginV1::InterrogationPhase {
                    chapter_id: "chapter_1".into(),
                    scene_id: "interrogation_scene_2".into(),
                    phase_id: "phase_1".into(),
                    segment_id: "question:q1:onLoop".into(),
                },
                DialogueSegmentOriginV1::InterrogationPhase {
                    chapter_id: "chapter_1".into(),
                    scene_id: "interrogation_scene_2".into(),
                    phase_id: "phase_1".into(),
                    segment_id: "question:q1:loopPrompt".into(),
                },
                DialogueSegmentOriginV1::InterrogationPhase {
                    chapter_id: "chapter_1".into(),
                    scene_id: "interrogation_scene_2".into(),
                    phase_id: "phase_1".into(),
                    segment_id: "question:q1:line:l1:content".into(),
                },
            ]
        );
        let captured_segment_lengths = [2usize, 1, 1];
        let reconstructed_cursor = captured_segment_lengths[..active.active_segment_index]
            .iter()
            .sum::<usize>()
            + active.item_cursor;
        assert_eq!(
            live_token,
            QueueToken {
                scene_id: "interrogation_scene_2".into(),
                queue_gen: active.queue_gen,
                cursor: reconstructed_cursor,
            }
        );
    }

    #[test]
    fn preserves_rendered_history_and_accepts_a_prior_scene_last_token() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        engine.history = DialogueHistory::default();
        engine.history.record(
            QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 1,
            },
            action("Rendered historical copy."),
            "Historical chapter title".into(),
            "Historical scene title".into(),
        );

        let captured = capture_checkpoint_v1(&engine).unwrap();

        assert_eq!(
            captured.snapshot.dialogue_history.entries,
            vec![DialogueHistoryEntryV1::Action {
                id: 1,
                text: "Rendered historical copy.".into(),
                chapter_title: "Historical chapter title".into(),
                scene_title: "Historical scene title".into(),
            }]
        );
        assert_eq!(
            captured.snapshot.dialogue_history.last_token,
            Some(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 1,
            })
        );
    }

    #[test]
    fn rejects_malformed_override_keys_and_future_history_generations() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("expected investigation");
        };
        scene.unlocked_overrides.insert("topic:witness".into());
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.unlocked_overrides.clear();
        engine.history = DialogueHistory::default();
        engine.history.record(
            QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: engine.next_queue_gen,
                cursor: 0,
            },
            action("Impossible future."),
            "Chapter One".into(),
            "Opening".into(),
        );
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    fn history_entries(count: u64) -> Vec<crate::game::view::DialogueHistoryEntry> {
        (1..=count)
            .map(|id| crate::game::view::DialogueHistoryEntry::Action {
                id,
                text: format!("entry {id}"),
                chapter_title: "Rendered chapter".into(),
                scene_title: "Rendered scene".into(),
            })
            .collect()
    }

    fn install_raw_history(
        engine: &mut GameEngine,
        entries: Vec<crate::game::view::DialogueHistoryEntry>,
        last_token: Option<QueueToken>,
    ) {
        let next_id = entries
            .last()
            .map(|entry| match entry {
                crate::game::view::DialogueHistoryEntry::Line { id, .. }
                | crate::game::view::DialogueHistoryEntry::Action { id, .. } => id + 1,
            })
            .unwrap_or(1);
        engine.history =
            DialogueHistory::from_persistence_parts_for_test(entries, next_id, last_token);
    }

    #[test]
    fn accepts_exactly_fifty_history_entries_and_rejects_fifty_one() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        let prior_token = Some(QueueToken {
            scene_id: "scene_0".into(),
            queue_gen: 1,
            cursor: 1,
        });
        install_raw_history(&mut engine, history_entries(50), prior_token.clone());
        assert_eq!(
            capture_checkpoint_v1(&engine)
                .unwrap()
                .snapshot
                .dialogue_history
                .entries
                .len(),
            50
        );

        install_raw_history(&mut engine, history_entries(51), prior_token);
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn rejects_zero_unknown_and_out_of_range_history_tokens() {
        let mut engine = fixture_engine();
        for token in [
            QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 0,
                cursor: 0,
            },
            QueueToken {
                scene_id: "unknown_scene".into(),
                queue_gen: 1,
                cursor: 0,
            },
            QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 2,
            },
        ] {
            install_raw_history(&mut engine, history_entries(1), Some(token));
            assert_eq!(
                capture_checkpoint_v1(&engine).unwrap_err().code,
                "invalidSaveCapture"
            );
        }
    }

    #[test]
    fn compares_history_cursor_only_when_it_names_the_active_queue() {
        let mut engine = fixture_engine();
        install_raw_history(
            &mut engine,
            history_entries(1),
            Some(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 0,
            }),
        );

        let error = capture_checkpoint_v1(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("same active queue"));
    }

    #[test]
    fn rejects_a_history_token_without_any_retained_entry() {
        let mut engine = fixture_engine();
        install_raw_history(
            &mut engine,
            vec![],
            Some(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 1,
            }),
        );

        let error = capture_checkpoint_v1(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn rejects_noncontiguous_history_entry_ids() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        let entries = vec![
            crate::game::view::DialogueHistoryEntry::Action {
                id: 1,
                text: "first".into(),
                chapter_title: "Chapter".into(),
                scene_title: "Scene".into(),
            },
            crate::game::view::DialogueHistoryEntry::Action {
                id: 3,
                text: "gap".into(),
                chapter_title: "Chapter".into(),
                scene_title: "Scene".into(),
            },
        ];
        install_raw_history(
            &mut engine,
            entries,
            Some(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 1,
            }),
        );

        let error = capture_checkpoint_v1(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn rejects_unprimed_intro_and_accepts_restored_consumed_generation_zero() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("expected investigation");
        };
        scene.intro_played = false;
        scene.pending_queue = None;
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.intro_played = true;
        scene.intro_queue_gen =
            crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN;
        scene.current_sublocation_id = Some("room".into());
        assert!(capture_checkpoint_v1(&engine).is_ok());
    }

    #[test]
    fn rejects_testimony_content_offsets_that_are_not_segment_boundaries() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!("expected interrogation");
        };
        scene.intro_played = true;
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![DialogueSegment::new(
                    interrogation_origin("question:q1:line:l1:content"),
                    vec![action("first"), action("second")],
                )
                .unwrap()],
                0,
                0,
                6,
            )
            .unwrap(),
        );
        scene.line_content_start = 1;
        engine.next_queue_gen = 7;

        let error = capture_checkpoint_v1(&engine).unwrap_err();

        assert_eq!(error.code, "invalidDialogueQueue");
    }

    #[test]
    fn rejects_an_interrogation_phase_entry_queue_before_phase_commit() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!("expected interrogation");
        };
        scene.intro_played = true;
        scene.current_phase_id = Some("phase_1".into());
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![segment(
                    DialogueSegmentOriginV1::InterrogationPhase {
                        chapter_id: "chapter_1".into(),
                        scene_id: "interrogation_scene_2".into(),
                        phase_id: "phase_two".into(),
                        segment_id: "phase:phase_two:entry".into(),
                    },
                    "phase entry",
                )],
                0,
                0,
                6,
            )
            .unwrap(),
        );
        scene.line_content_start = 1;
        engine.next_queue_gen = 7;

        let error = capture_checkpoint_v1(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");

        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.mark_phase_entered("phase_1");
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![segment(
                    interrogation_origin("phase:phase_1:entry"),
                    "phase entry",
                )],
                0,
                0,
                6,
            )
            .unwrap(),
        );
        capture_checkpoint_v1(&engine).unwrap();
    }

    #[test]
    fn captures_an_investigation_outro_only_after_its_commit() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("expected investigation");
        };
        scene.intro_played = true;
        scene.outro_played = false;
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![segment(
                    DialogueSegmentOriginV1::InvestigationOutro {
                        chapter_id: "chapter_1".into(),
                        scene_id: "investigation_scene_1".into(),
                    },
                    "outro",
                )],
                0,
                0,
                6,
            )
            .unwrap(),
        );
        engine.next_queue_gen = 7;
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.outro_played = true;
        assert!(capture_checkpoint_v1(&engine).is_ok());
    }

    #[test]
    fn omits_non_testimony_line_content_boundaries_and_validates_testimony_origin() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!("expected interrogation");
        };
        scene.intro_played = true;
        scene.mark_phase_entered("phase_1");
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![segment(
                    DialogueSegmentOriginV1::InterrogationPhase {
                        chapter_id: "chapter_1".into(),
                        scene_id: "interrogation_scene_2".into(),
                        phase_id: "phase_1".into(),
                        segment_id: "phase:phase_1:entry".into(),
                    },
                    "phase entry",
                )],
                0,
                0,
                6,
            )
            .unwrap(),
        );
        scene.line_content_start = 1;
        engine.next_queue_gen = 7;

        let captured = capture_checkpoint_v1(&engine).unwrap();
        let SceneProgressSnapshotV1::Interrogation {
            line_content_segment_index,
            ..
        } = captured.snapshot.scene
        else {
            panic!("expected interrogation snapshot");
        };
        assert_eq!(line_content_segment_index, None);

        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.cross_exam = CrossExam::Playing {
            question_id: "q1".into(),
            line_index: 0,
        };
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![
                    DialogueSegment::new(
                        DialogueSegmentOriginV1::InterrogationPhase {
                            chapter_id: "chapter_1".into(),
                            scene_id: "interrogation_scene_2".into(),
                            phase_id: "phase_1".into(),
                            segment_id: "question:q1:onLoop".into(),
                        },
                        vec![action("bridge one"), action("bridge two")],
                    )
                    .unwrap(),
                    segment(
                        DialogueSegmentOriginV1::InterrogationPhase {
                            chapter_id: "chapter_1".into(),
                            scene_id: "interrogation_scene_2".into(),
                            phase_id: "phase_1".into(),
                            segment_id: "question:q1:line:l1:content".into(),
                        },
                        "content",
                    ),
                ],
                1,
                0,
                6,
            )
            .unwrap(),
        );
        scene.line_content_start = 2;

        let captured = capture_checkpoint_v1(&engine).unwrap();
        let SceneProgressSnapshotV1::Interrogation {
            line_content_segment_index,
            ..
        } = captured.snapshot.scene
        else {
            panic!("expected interrogation snapshot");
        };
        assert_eq!(line_content_segment_index, Some(1));
        assert_eq!(
            captured
                .snapshot
                .active_dialogue
                .unwrap()
                .active_segment_index,
            1
        );

        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![segment(
                    DialogueSegmentOriginV1::InterrogationPhase {
                        chapter_id: "chapter_1".into(),
                        scene_id: "interrogation_scene_2".into(),
                        phase_id: "phase_1".into(),
                        segment_id: "question:q1:line:wrong:content".into(),
                    },
                    "wrong content",
                )],
                0,
                0,
                6,
            )
            .unwrap(),
        );
        scene.line_content_start = 0;
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn rejects_live_stable_ids_missing_from_packaged_definitions() {
        let mut engine = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("expected investigation");
        };
        scene.intro_played = true;
        scene.current_sublocation_id = Some("missing_room".into());
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let mut engine = fixture_engine();
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "copy".into(),
            description: "copy".into(),
            details: "copy".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "interrogation_scene_2".into(),
        });
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let mut engine = fixture_engine();
        engine
            .story_state
            .insert_unknown_objective_for_test("missing");
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let mut engine = fixture_engine();
        let SceneRuntime::Linear(scene) = &mut engine.scene else {
            panic!("expected linear");
        };
        scene.queue = Some(
            ActiveDialogueQueue::from_position(
                vec![segment(
                    DialogueSegmentOriginV1::LinearScene {
                        chapter_id: "chapter_1".into(),
                        scene_id: "missing".into(),
                    },
                    "bad",
                )],
                0,
                0,
                1,
            )
            .unwrap(),
        );
        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn rejects_pending_acquisition_that_disagrees_with_inventory_kind() {
        let mut engine = fixture_engine();
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "copy".into(),
            description: "copy".into(),
            details: "copy".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "investigation_scene_1".into(),
        });
        engine.pending_acquisition_events = vec![AcquisitionEventStateV1 {
            id: "acq:1:0".into(),
            record_kind: RecordKind::Statement,
            record_id: "test_evidence".into(),
            created_by_command_id: 1,
            ordinal: 0,
        }];
        engine.durable_revision = 1;

        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn empty_history_requires_initial_next_id() {
        let mut engine = fixture_engine();
        engine.history = DialogueHistory::from_persistence_parts_for_test(Vec::new(), 2, None);

        assert_eq!(
            capture_checkpoint_v1(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn history_scene_ids_are_resolved_within_each_chapter_package() {
        let mut engine = fixture_engine();
        let mut repeated_id_chapter = engine.chapters[0].clone();
        repeated_id_chapter.id = "chapter_2".into();
        repeated_id_chapter.title = "Chapter Two".into();
        engine.chapters.push(repeated_id_chapter);

        let captured = capture_checkpoint_v1(&engine).unwrap();

        assert_eq!(
            captured.snapshot.dialogue_history.last_token,
            Some(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 1,
            })
        );
    }

    #[test]
    fn captures_active_investigation_and_interrogation_intro_and_outro_origins() {
        let mut investigation = fixture_engine();
        investigation
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        let captured = capture_checkpoint_v1(&investigation).unwrap();
        assert_eq!(
            captured.snapshot.active_dialogue.unwrap().segment_origins,
            vec![DialogueSegmentOriginV1::InvestigationIntro {
                chapter_id: "chapter_1".into(),
                scene_id: "investigation_scene_1".into(),
            }]
        );

        let mut interrogation = fixture_engine();
        interrogation
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        let intro = capture_checkpoint_v1(&interrogation).unwrap();
        assert_eq!(
            intro.snapshot.active_dialogue.unwrap().segment_origins,
            vec![DialogueSegmentOriginV1::InterrogationIntro {
                chapter_id: "chapter_1".into(),
                scene_id: "interrogation_scene_2".into(),
            }]
        );
        let SceneProgressSnapshotV1::Interrogation {
            line_content_segment_index,
            ..
        } = intro.snapshot.scene
        else {
            panic!("expected interrogation");
        };
        assert_eq!(line_content_segment_index, None);

        interrogation.history = DialogueHistory::default();
        let SceneRuntime::Interrogation(scene) = &mut interrogation.scene else {
            panic!("expected interrogation");
        };
        scene.intro_played = true;
        scene.outro_played = true;
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![segment(
                    DialogueSegmentOriginV1::InterrogationOutro {
                        chapter_id: "chapter_1".into(),
                        scene_id: "interrogation_scene_2".into(),
                    },
                    "outro",
                )],
                0,
                0,
                6,
            )
            .unwrap(),
        );
        scene.line_content_start = 1;
        interrogation.next_queue_gen = 7;
        let outro = capture_checkpoint_v1(&interrogation).unwrap();
        assert_eq!(
            outro.snapshot.active_dialogue.unwrap().segment_origins,
            vec![DialogueSegmentOriginV1::InterrogationOutro {
                chapter_id: "chapter_1".into(),
                scene_id: "interrogation_scene_2".into(),
            }]
        );
        let SceneProgressSnapshotV1::Interrogation {
            line_content_segment_index,
            ..
        } = outro.snapshot.scene
        else {
            panic!("expected interrogation");
        };
        assert_eq!(line_content_segment_index, None);
    }
}
