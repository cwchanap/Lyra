use super::schema::{
    AudioCueSnapshotV1, CharacterTopicRefV1, CrossExamSnapshotV1, DialogueHistoryEntryV1,
    DialogueHistorySnapshotV1, EvidenceInventoryEntryV1, InterrogationOverrideRefV1,
    InventorySnapshotV1, InvestigationOverrideRefV1, LastVisualCueSnapshotV1, SaveSnapshot,
    SaveSummary, SceneProgressSnapshot, StatementInventoryEntryV1,
};
use crate::game::dialogue::DIALOGUE_HISTORY_LIMIT;
use crate::game::dialogue_queue::{
    ActiveDialogueQueue, ActiveDialogueStateV1, DialogueSegmentOriginV1,
};
use crate::game::navigation::{load_chapter_scene_jsons, scene_json_identity, scene_json_summary};
use crate::game::provenance::{validate_inventory_record_against_catalog, CaseRecordProvenance};
use crate::game::scenes::analysis::AnalysisSceneState;
use crate::game::scenes::interrogation::{CrossExam, InterrogationSceneState};
use crate::game::scenes::investigation::InvestigationSceneState;
use crate::game::scenes::SceneRuntime;
use crate::game::schema::{
    AnalysisSceneJson, InterrogationPhaseJson, InterrogationSceneJson, InventoryTarget,
    InvestigationSceneJson, SceneJson,
};
use crate::game::state::ChapterManifest;
use crate::game::story::StoryState;
use crate::game::view::{DialogueHistoryEntry, QueueToken};
use crate::game::{GameEngine, GameError};
use serde::Serialize;
use std::collections::hash_map::Entry;
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapturedCheckpoint {
    pub(crate) summary: SaveSummary,
    pub(crate) snapshot: SaveSnapshot,
}

type SceneCache = HashMap<String, Vec<SceneJson>>;

struct CapturedLocation {
    chapter_id: String,
    chapter_title: String,
    chapter_summary: String,
    scene_id: String,
    scene_title: String,
    scene_summary: String,
    game_complete: bool,
}

/// Return the cached scene slice for `chapter`, loading it from disk on first
/// access. Propagates load errors so callers never need to re-derive the
/// invariant that the entry exists after a successful call.
fn chapter_scenes<'a>(
    engine: &GameEngine,
    chapter: &ChapterManifest,
    cache: &'a mut SceneCache,
) -> Result<&'a Vec<SceneJson>, GameError> {
    match cache.entry(chapter.id.clone()) {
        Entry::Occupied(entry) => Ok(entry.into_mut()),
        Entry::Vacant(entry) => {
            let scenes =
                load_chapter_scene_jsons(&engine.resources_dir, &engine.story_catalog, chapter)?;
            Ok(entry.insert(scenes))
        }
    }
}

pub(crate) fn capture_checkpoint(engine: &GameEngine) -> Result<CapturedCheckpoint, GameError> {
    // No `..`: every new engine field must be classified here before capture
    // can compile again.
    let GameEngine {
        resources_dir: _immutable_package_root,
        content_manifest: _immutable_content_identity,
        chapters: _immutable_chapter_manifests,
        story_catalog: _immutable_story_catalog,
        story_locations: _immutable_story_locations,
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
        cached_pending_acquisition_scene: _not_persisted,
    } = engine;

    let active_dialogue = engine.capture_active_dialogue()?;
    validate_active_dialogue(active_dialogue.as_ref(), *next_queue_gen)?;
    let packaged_dialogue = validate_packaged_dialogue_candidate(engine, active_dialogue.as_ref())?;
    let mut scene_cache = SceneCache::new();
    let location = capture_location(engine, &mut scene_cache)?;
    if location.game_complete && active_dialogue.is_some() {
        return Err(capture_error(
            "A completed game cannot retain an active dialogue queue.",
        ));
    }
    let scene = capture_scene_progress_with_active(
        engine,
        active_dialogue.as_ref(),
        packaged_dialogue.as_ref(),
        &mut scene_cache,
    )?;
    let scene_summary = scene_summary_for_checkpoint(&scene, &location.scene_summary);
    let story_state = story_state.snapshot();
    StoryState::from_snapshot(&engine.story_catalog, story_state.clone())
        .map_err(|error| capture_error(error.message))?;
    let active_primary_objective_id = story_state.active_primary_objective_id.clone();
    let active_primary_objective_copy = active_primary_objective_id
        .as_deref()
        .map(|id| {
            engine
                .story_catalog
                .objective(id)
                .map(|definition| (definition.label.clone(), definition.summary.clone()))
                .ok_or_else(|| {
                    capture_error(format!(
                        "Active primary objective '{id}' has no packaged definition."
                    ))
                })
        })
        .transpose()?;
    let (active_primary_objective_label, active_primary_objective_summary) =
        match active_primary_objective_copy {
            Some((label, summary)) => (Some(label), Some(summary)),
            None => (None, None),
        };
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

    let snapshot = SaveSnapshot {
        chapter_id: location.chapter_id.clone(),
        scene_id: location.scene_id.clone(),
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
        dialogue_history: capture_history(engine, history, *next_queue_gen, &mut scene_cache)?,
        next_queue_gen: *next_queue_gen,
        durable_revision: *durable_revision,
    };
    Ok(CapturedCheckpoint {
        summary: SaveSummary {
            chapter_id: location.chapter_id,
            chapter_title: location.chapter_title,
            chapter_summary: Some(location.chapter_summary),
            scene_id: location.scene_id,
            scene_title: location.scene_title,
            scene_summary,
            active_primary_objective_id,
            active_primary_objective_label,
            active_primary_objective_summary,
        },
        snapshot,
    })
}

/// Whether a scene may retain a summary on a checkpoint.
///
/// Only `GameComplete` may retain the authored scene summary: at that point
/// the entire story has been played, so the prose is no longer a spoiler.
/// Every other scene kind (`Linear`, `Investigation`, `Interrogation`) must
/// expose no summary, otherwise a save recap could leak unrevealed plot
/// content and break checkpoint spoiler safety. The exhaustive match is
/// intentional: adding a new `SceneProgressSnapshot` variant forces a
/// conscious spoiler-safety decision here rather than silently defaulting.
pub(crate) fn scene_may_retain_summary(scene: &SceneProgressSnapshot) -> bool {
    match scene {
        SceneProgressSnapshot::GameComplete => true,
        SceneProgressSnapshot::Linear
        | SceneProgressSnapshot::Investigation { .. }
        | SceneProgressSnapshot::Interrogation { .. }
        | SceneProgressSnapshot::Analysis { .. } => false,
    }
}

/// Build the scene summary stored on a checkpoint.
fn scene_summary_for_checkpoint(
    scene: &SceneProgressSnapshot,
    authored_summary: &str,
) -> Option<String> {
    if scene_may_retain_summary(scene) {
        Some(authored_summary.to_owned())
    } else {
        None
    }
}

pub(crate) fn capture_scene_progress(
    engine: &GameEngine,
) -> Result<SceneProgressSnapshot, GameError> {
    let mut scene_cache = SceneCache::new();
    let location = capture_location(engine, &mut scene_cache)?;
    let active_dialogue = engine.capture_active_dialogue()?;
    validate_active_dialogue(active_dialogue.as_ref(), engine.next_queue_gen)?;
    let packaged_dialogue = validate_packaged_dialogue_candidate(engine, active_dialogue.as_ref())?;
    if location.game_complete && active_dialogue.is_some() {
        return Err(capture_error(
            "A completed game cannot retain an active dialogue queue.",
        ));
    }
    capture_scene_progress_with_active(
        engine,
        active_dialogue.as_ref(),
        packaged_dialogue.as_ref(),
        &mut scene_cache,
    )
}

fn capture_scene_progress_with_active(
    engine: &GameEngine,
    active_dialogue: Option<&ActiveDialogueStateV1>,
    packaged_dialogue: Option<&ActiveDialogueQueue>,
    scene_cache: &mut SceneCache,
) -> Result<SceneProgressSnapshot, GameError> {
    if engine.current_chapter_idx == engine.chapters.len() {
        return Ok(SceneProgressSnapshot::GameComplete);
    }
    if engine.current_chapter_idx > engine.chapters.len() {
        return Err(capture_error(
            "Current chapter index is beyond game completion.",
        ));
    }

    let packaged_scene = current_packaged_scene(engine, scene_cache)?;
    match (&engine.scene, &packaged_scene) {
        (SceneRuntime::Linear(scene), SceneJson::Linear(_)) => {
            if scene.queue.is_none() {
                return Err(capture_error(
                    "A linear scene exhausted without entering its successor.",
                ));
            }
            Ok(SceneProgressSnapshot::Linear)
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
            Ok(SceneProgressSnapshot::Investigation {
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
                capture_line_content_segment_index(scene, &cross_exam, packaged_dialogue)?;
            Ok(SceneProgressSnapshot::Interrogation {
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
        (SceneRuntime::Analysis(scene), SceneJson::Analysis(packaged)) => {
            validate_analysis_progress(scene, packaged)?;
            validate_analysis_intro(scene, active_dialogue, engine.next_queue_gen)?;
            validate_outro_commit(
                scene.outro_played,
                active_dialogue,
                |origin| matches!(origin, DialogueSegmentOriginV1::AnalysisOutro { .. }),
                "analysis",
            )?;
            Ok(SceneProgressSnapshot::Analysis {
                intro_played: scene.intro_played,
                outro_played: scene.outro_played,
                active_board_id: scene.active_board_id.clone(),
                drafts: scene.drafts.clone(),
                feedback_by_board_id: scene.feedback_by_board_id.clone(),
            })
        }
        _ => Err(capture_error(
            "Current runtime scene kind does not match its packaged definition.",
        )),
    }
}

fn current_packaged_scene(
    engine: &GameEngine,
    scene_cache: &mut SceneCache,
) -> Result<SceneJson, GameError> {
    if engine.current_chapter_idx >= engine.chapters.len() {
        return Err(capture_error(
            "A completed or invalid location has no current progress definition.",
        ));
    }
    let chapter = &engine.chapters[engine.current_chapter_idx];
    let scenes = chapter_scenes(engine, chapter, scene_cache)?;
    scenes
        .get(engine.current_scene_idx)
        .cloned()
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

fn validate_analysis_progress(
    scene: &AnalysisSceneState,
    packaged: &AnalysisSceneJson,
) -> Result<(), GameError> {
    if scene.def.id != packaged.id {
        return Err(capture_error(
            "Analysis scene definition does not match runtime state.",
        ));
    }
    let authored_board_ids: BTreeSet<_> = packaged
        .boards
        .iter()
        .map(|board| board.common().id.as_str())
        .collect();
    if authored_board_ids.len() != packaged.boards.len() {
        return Err(capture_error(
            "Packaged analysis definition contains duplicate board ids.",
        ));
    }
    let draft_board_ids: BTreeSet<_> = scene.drafts.keys().map(String::as_str).collect();
    if draft_board_ids != authored_board_ids {
        return Err(capture_error(
            "Analysis drafts must contain exactly one entry for every packaged board.",
        ));
    }
    let validator = AnalysisSceneState::from_json(
        packaged.clone(),
        crate::game::scenes::analysis::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
    );
    for (board_id, draft) in &scene.drafts {
        validator
            .validate_draft(board_id, draft)
            .map_err(|error| capture_error(error.message))?;
    }
    if scene
        .active_board_id
        .as_deref()
        .is_some_and(|board_id| !authored_board_ids.contains(board_id))
    {
        return Err(capture_error(
            "Analysis active board references an unknown board.",
        ));
    }
    for board_id in scene.feedback_by_board_id.keys() {
        if !authored_board_ids.contains(board_id.as_str()) {
            return Err(capture_error(format!(
                "Analysis feedback references unknown board '{board_id}'."
            )));
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
    packaged_queue: Option<&ActiveDialogueQueue>,
) -> Result<Option<usize>, GameError> {
    let Some(queue) = scene.pending_queue.as_ref() else {
        return Ok(None);
    };
    let segment_index = queue.segment_index_at_flattened_boundary(scene.line_content_start)?;
    let packaged_queue = packaged_queue
        .ok_or_else(|| capture_error("Interrogation dialogue has no packaged queue candidate."))?;
    let packaged_segment_index = packaged_queue
        .segment_index_at_flattened_boundary(scene.line_content_start)
        .map_err(|error| capture_error(error.message))?;
    if packaged_segment_index != segment_index {
        return Err(capture_error(
            "Live testimony boundary does not match the packaged segment boundary.",
        ));
    }
    let origins = packaged_queue.segment_origins();
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
            &InventoryTarget::Evidence {
                id: record.id.clone(),
            },
            &record.collected_in_chapter_id,
            &record.collected_in_scene_id,
            &record.provenance,
        )?;
    }
    for record in &engine.inventory.statements {
        validate_inventory_record(
            engine,
            &InventoryTarget::Statement {
                id: record.id.clone(),
            },
            &record.acquired_in_chapter_id,
            &record.acquired_in_scene_id,
            &record.provenance,
        )?;
    }
    Ok(())
}

fn validate_inventory_record(
    engine: &GameEngine,
    target: &InventoryTarget,
    chapter_id: &str,
    scene_id: &str,
    provenance: &CaseRecordProvenance,
) -> Result<(), GameError> {
    validate_inventory_record_against_catalog(
        &engine.story_catalog,
        chapter_id,
        scene_id,
        target,
        provenance,
    )?;
    let scene = engine.packaged_acquisition_scene(chapter_id, scene_id)?;
    let found = match scene {
        SceneJson::Investigation(scene) => match target {
            InventoryTarget::Evidence { id } => scene
                .evidence_manifest
                .iter()
                .any(|item| item.id == id.as_str()),
            InventoryTarget::Statement { id } => scene
                .statement_manifest
                .iter()
                .any(|item| item.id == id.as_str()),
        },
        SceneJson::Interrogation(scene) => match target {
            InventoryTarget::Evidence { id } => scene
                .evidence_manifest
                .iter()
                .any(|item| item.id == id.as_str()),
            InventoryTarget::Statement { id } => scene
                .statement_manifest
                .iter()
                .any(|item| item.id == id.as_str()),
        },
        SceneJson::Linear(_) | SceneJson::Analysis(_) => false,
    };
    if !found {
        return Err(GameError::inventory_record_definition_mismatch());
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

fn validate_packaged_dialogue_candidate(
    engine: &GameEngine,
    active: Option<&ActiveDialogueStateV1>,
) -> Result<Option<ActiveDialogueQueue>, GameError> {
    let Some(active) = active else {
        return Ok(None);
    };
    let candidate = engine
        .restore_active_dialogue_queue(engine.content_revision(), active)
        .map_err(|error| capture_error(error.message))?;
    let live = engine
        .active_dialogue_queue()
        .ok_or_else(|| capture_error("Captured active dialogue has no matching live queue."))?;
    let live_cursor = live
        .flattened_cursor()
        .map_err(|error| capture_error(error.message))?;
    let packaged_cursor = candidate
        .flattened_cursor()
        .map_err(|error| capture_error(error.message))?;
    if live_cursor != packaged_cursor || live.queue_gen() != candidate.queue_gen() {
        return Err(capture_error(format!(
            "Live dialogue token cursor {live_cursor} does not match packaged cursor {packaged_cursor}."
        )));
    }
    if !live.same_persisted_shape(&candidate) {
        return Err(capture_error(
            "Live dialogue item count or order does not match its packaged origins.",
        ));
    }
    Ok(Some(candidate))
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

fn validate_analysis_intro(
    scene: &AnalysisSceneState,
    active: Option<&ActiveDialogueStateV1>,
    next_queue_gen: u64,
) -> Result<(), GameError> {
    validate_intro_generation(
        scene.intro_queue_gen,
        next_queue_gen,
        crate::game::scenes::analysis::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
    )?;
    let active_intro = active.is_some_and(|queue| {
        queue.segment_origins.iter().any(|origin| {
            matches!(
                origin,
                DialogueSegmentOriginV1::AnalysisIntro { scene_id, .. } if scene_id == scene.id()
            )
        })
    });
    if active_intro && (!scene.intro_played || active.unwrap().queue_gen != scene.intro_queue_gen) {
        return Err(capture_error(
            "Active analysis intro has inconsistent played/generation state.",
        ));
    }
    if !scene.intro_played {
        return Err(capture_error(
            "Analysis capture occurred before initial queue priming.",
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
    InvestigationOverrideRefV1::parse_runtime_key(runtime_key).map_err(capture_error)
}

fn capture_interrogation_override(
    runtime_key: &str,
) -> Result<InterrogationOverrideRefV1, GameError> {
    InterrogationOverrideRefV1::parse_runtime_key(runtime_key).map_err(capture_error)
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

fn capture_history(
    engine: &GameEngine,
    history: &crate::game::dialogue::DialogueHistory,
    next_queue_gen: u64,
    scene_cache: &mut SceneCache,
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
        validate_history_token(engine, token, next_queue_gen, scene_cache)?;
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
    scene_cache: &mut SceneCache,
) -> Result<(), GameError> {
    if token.queue_gen == 0 || token.queue_gen >= next_queue_gen {
        return Err(capture_error(format!(
            "Dialogue history queue generation {} is outside 1..{next_queue_gen}.",
            token.queue_gen
        )));
    }
    let maxima = packaged_scene_cursor_exclusive(engine, &token.scene_id, scene_cache)?;
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
    scene_cache: &mut SceneCache,
) -> Result<Vec<usize>, GameError> {
    let mut found = Vec::new();
    for chapter in &engine.chapters {
        let scenes = chapter_scenes(engine, chapter, scene_cache)?;
        for scene in scenes.iter() {
            if scene_json_identity(scene).0 == target_scene_id {
                found.push(maximum_scene_dialogue_items(scene)?);
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
    let groups = crate::game::schema::scene_dialogue_groups(scene);
    groups.into_iter().try_fold(0usize, |total, items| {
        total
            .checked_add(items.len())
            .ok_or_else(|| capture_error("Packaged dialogue item count overflowed usize."))
    })
}

fn capture_location(
    engine: &GameEngine,
    scene_cache: &mut SceneCache,
) -> Result<CapturedLocation, GameError> {
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
        let scenes = chapter_scenes(engine, chapter, scene_cache)?;
        let packaged_scene = scenes
            .last()
            .ok_or_else(|| capture_error("Game complete has no final scene."))?;
        if engine.scene.id() != scene_json_identity(packaged_scene).0 {
            return Err(capture_error(
                "Retained game-complete runtime is not the packaged final scene.",
            ));
        }
        return Ok(location_from_scene(chapter, packaged_scene, true));
    }

    let chapter = &engine.chapters[engine.current_chapter_idx];
    let scenes = chapter_scenes(engine, chapter, scene_cache)?;
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
    Ok(location_from_scene(chapter, packaged_scene, false))
}

fn location_from_scene(
    chapter: &ChapterManifest,
    packaged_scene: &SceneJson,
    game_complete: bool,
) -> CapturedLocation {
    let (scene_id, scene_title) = scene_json_identity(packaged_scene);
    CapturedLocation {
        chapter_id: chapter.id.clone(),
        chapter_title: chapter.title.clone(),
        chapter_summary: chapter.summary.clone(),
        scene_id: scene_id.into(),
        scene_title: scene_title.into(),
        scene_summary: scene_json_summary(packaged_scene).into(),
        game_complete,
    }
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
        InvestigationOverrideRefV1, RecordKind, SceneProgressSnapshot,
    };
    use crate::game::scenes::interrogation::CrossExam;
    use crate::game::scenes::SceneRuntime;
    use crate::game::schema::{AudioChannelJson, AudioCueJson, DialogueItem};
    use crate::game::state::{EvidenceRecord, StatementRecord};
    use crate::game::test_support::{
        drive_hpa_257_positive_progression, hpa_257_fixture_resources,
        provenance_save_fixture_resources, save_capture_fixture_resources,
    };
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

    fn analysis_intro_origin() -> DialogueSegmentOriginV1 {
        DialogueSegmentOriginV1::AnalysisIntro {
            chapter_id: "chapter_1".into(),
            scene_id: "analysis_scene_8_5".into(),
        }
    }

    // Analysis queues are now paired with an Analysis scene progress snapshot
    // and must be accepted by the shared active-dialogue validation boundary.
    #[test]
    fn capture_accepts_analysis_dialogue_origins_with_analysis_progress_support() {
        let active = ActiveDialogueStateV1 {
            segment_origins: vec![analysis_intro_origin()],
            active_segment_index: 0,
            item_cursor: 0,
            queue_gen: 1,
        };

        validate_active_dialogue(Some(&active), 2)
            .expect("analysis origins are persisted with Analysis scene progress");
    }

    fn fixture_engine() -> (tempfile::TempDir, GameEngine) {
        let (_guard, resources) = save_capture_fixture_resources();
        let engine = GameEngine::new_started(resources).unwrap();
        (_guard, engine)
    }

    // Note: validate_inventory_record's `SceneJson::Linear(_) |
    // SceneJson::Analysis(_) => false` arm is a defensive exhaustiveness
    // fallback. It is unreachable in practice because
    // validate_scene_records_against_catalog (called during scene loading)
    // rejects any catalog evidence entry pointing to a Linear or Analysis scene
    // before packaged_acquisition_scene can return one. The arm exists to keep
    // the match exhaustive, not to be exercised at runtime.

    #[test]
    fn captures_active_linear_checkpoint_as_exact_wire_value() {
        let (_guard, mut engine) = fixture_engine();
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

        let captured = capture_checkpoint(&engine).unwrap();

        assert_eq!(
            serde_json::to_value(captured).unwrap(),
            json!({
                "summary": {
                    "chapterId": "chapter_1",
                    "chapterTitle": "Chapter One",
                    "chapterSummary": "First",
                    "sceneId": "scene_0",
                    "sceneTitle": "Opening",
                    "sceneSummary": null,
                    "activePrimaryObjectiveId": "objective_truth",
                    "activePrimaryObjectiveLabel": "Find the truth",
                    "activePrimaryObjectiveSummary": "Resolve the contradiction."
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
                        "activePrimaryObjectiveId": "objective_truth",
                        "completedAnalysisScenes": [],
                        "completedAnalysisBoards": []
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
    fn capture_without_an_active_objective_emits_all_objective_copy_as_null() {
        let (_guard, engine) = fixture_engine();

        let captured = serde_json::to_value(capture_checkpoint(&engine).unwrap()).unwrap();

        assert_eq!(
            captured.pointer("/summary/activePrimaryObjectiveId"),
            Some(&serde_json::Value::Null)
        );
        assert_eq!(
            captured.pointer("/summary/activePrimaryObjectiveLabel"),
            Some(&serde_json::Value::Null)
        );
        assert_eq!(
            captured.pointer("/summary/activePrimaryObjectiveSummary"),
            Some(&serde_json::Value::Null)
        );
    }

    // Break caught: the HPA-257 progression is captured through an ad-hoc
    // field, omits durable trigger/story state, or loses the nested-threshold
    // unlock that the existing snapshot already represents.
    #[test]
    fn hpa_257_capture_uses_existing_snapshot_fields_for_positive_progress() {
        let (_guard, resources) = hpa_257_fixture_resources();
        let mut engine = GameEngine::new_started(resources).unwrap();
        drive_hpa_257_positive_progression(&mut engine);

        let captured = capture_checkpoint(&engine).unwrap();

        assert_eq!(captured.snapshot.chapter_id, "chapter_hpa_257");
        assert_eq!(captured.snapshot.scene_id, "investigation_hpa_257");
        assert_eq!(
            captured
                .snapshot
                .inventory
                .evidence
                .iter()
                .map(|entry| entry.record_id.as_str())
                .collect::<Vec<_>>(),
            vec!["evidence_a"]
        );

        let story = &captured.snapshot.story_state;
        assert!(story.facts.contains_key("fact_a"));
        assert_eq!(
            story.questions["question_a"].resolved_by_fact_id.as_deref(),
            Some("fact_a")
        );
        assert!(story.objectives["secondary_a"].completed);
        assert!(story.objectives["primary_a"].completed);
        assert!(!story.objectives["primary_b"].completed);
        assert_eq!(
            story.active_primary_objective_id.as_deref(),
            Some("primary_b")
        );
        assert!(story.authorizations.contains_key("authorization_court"));

        let SceneProgressSnapshot::Investigation {
            current_sublocation_id,
            inspected_hotspot_ids,
            entered_sublocation_ids,
            ..
        } = &captured.snapshot.scene
        else {
            panic!("expected HPA-257 investigation progress")
        };
        assert_eq!(current_sublocation_id.as_deref(), Some("progress"));
        assert_eq!(
            inspected_hotspot_ids,
            &vec![
                "evidence".to_string(),
                "primary_advance".to_string(),
                "primary_start".to_string(),
                "resolve".to_string(),
            ]
        );
        assert_eq!(entered_sublocation_ids, &vec!["progress".to_string()]);

        let view = serde_json::to_value(engine.view().unwrap()).unwrap();
        let hotspot_ids = view["scene"]["visibleSublocations"][0]["hotspots"]
            .as_array()
            .unwrap()
            .iter()
            .map(|hotspot| hotspot["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            hotspot_ids,
            vec![
                "evidence",
                "resolve",
                "primary_start",
                "primary_advance",
                "threshold",
            ]
        );
    }

    #[test]
    fn rejects_a_linear_runtime_left_without_its_entered_successor() {
        let (_guard, mut engine) = fixture_engine();
        let SceneRuntime::Linear(scene) = &mut engine.scene else {
            panic!("expected linear fixture");
        };
        scene.queue = None;

        let error = capture_checkpoint(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn captures_game_complete_with_the_retained_final_scene_identity() {
        let (_guard, mut engine) = fixture_engine();
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

        let captured = capture_checkpoint(&engine).unwrap();

        assert_eq!(captured.snapshot.chapter_id, "chapter_1");
        assert_eq!(captured.snapshot.scene_id, "interrogation_scene_2");
        assert_eq!(captured.snapshot.scene, SceneProgressSnapshot::GameComplete);
        assert_eq!(captured.summary.chapter_title, "Chapter One");
        assert_eq!(captured.summary.scene_title, "Interrogation");
        assert_eq!(
            captured.summary.scene_summary.as_deref(),
            Some("Fixture scene summary.")
        );
        assert!(captured.snapshot.active_dialogue.is_none());
    }

    #[test]
    fn scene_progress_capture_rejects_game_complete_with_a_nonfinal_runtime() {
        let (_guard, mut engine) = fixture_engine();
        engine.current_chapter_idx = engine.chapters.len();
        engine.current_scene_idx = 0;

        let error = capture_scene_progress(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn captures_investigation_progress_inventory_and_composite_queue_deterministically() {
        let (_guard, mut engine) = fixture_engine();
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
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "investigation_scene_1".into(),
        });
        engine.inventory.statements.push(StatementRecord {
            id: "alibi_statement".into(),
            speaker: "mutable".into(),
            content: "mutable".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
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
        let captured = capture_checkpoint(&engine).unwrap();

        assert_eq!(captured.summary.scene_summary, None);
        assert_eq!(
            captured.snapshot.scene,
            SceneProgressSnapshot::Investigation {
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
        let (_guard, mut engine) = fixture_engine();
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
            DialogueSegment::new(
                interrogation_origin("question:q1:line:l1:content"),
                vec![DialogueItem::Line {
                    speaker: "witness".into(),
                    text: "line".into(),
                    portrait: None,
                }],
            )
            .unwrap(),
        ];
        scene.pending_queue = Some(ActiveDialogueQueue::from_position(segments, 1, 0, 12).unwrap());
        scene.line_content_start = 3;
        engine.next_queue_gen = 13;

        let live_token = engine.current_queue_token().unwrap();
        let playing = capture_checkpoint(&engine).unwrap();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.cross_exam = CrossExam::Presenting {
            question_id: "q1".into(),
            line_id: "l1".into(),
        };
        let presenting = capture_checkpoint(&engine).unwrap();

        assert_eq!(playing.summary.scene_summary, None);
        assert_eq!(presenting.summary.scene_summary, None);
        let SceneProgressSnapshot::Interrogation {
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
        let SceneProgressSnapshot::Interrogation { cross_exam, .. } = presenting.snapshot.scene
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
        let (_guard, mut engine) = fixture_engine();
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

        let captured = capture_checkpoint(&engine).unwrap();

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
        let (_guard, mut engine) = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("expected investigation");
        };
        scene.unlocked_overrides.insert("topic:witness".into());
        assert_eq!(
            capture_checkpoint(&engine).unwrap_err().code,
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
            capture_checkpoint(&engine).unwrap_err().code,
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
        let (_guard, mut engine) = fixture_engine();
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
            capture_checkpoint(&engine)
                .unwrap()
                .snapshot
                .dialogue_history
                .entries
                .len(),
            50
        );

        install_raw_history(&mut engine, history_entries(51), prior_token);
        assert_eq!(
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn rejects_zero_unknown_and_out_of_range_history_tokens() {
        let (_guard, mut engine) = fixture_engine();
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
                capture_checkpoint(&engine).unwrap_err().code,
                "invalidSaveCapture"
            );
        }
    }

    #[test]
    fn compares_history_cursor_only_when_it_names_the_active_queue() {
        let (_guard, mut engine) = fixture_engine();
        install_raw_history(
            &mut engine,
            history_entries(1),
            Some(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 0,
            }),
        );

        let error = capture_checkpoint(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("same active queue"));
    }

    #[test]
    fn rejects_a_history_token_without_any_retained_entry() {
        let (_guard, mut engine) = fixture_engine();
        install_raw_history(
            &mut engine,
            vec![],
            Some(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 1,
            }),
        );

        let error = capture_checkpoint(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn rejects_noncontiguous_history_entry_ids() {
        let (_guard, mut engine) = fixture_engine();
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

        let error = capture_checkpoint(&engine).unwrap_err();

        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn rejects_unprimed_intro_and_accepts_restored_consumed_generation_zero() {
        let (_guard, mut engine) = fixture_engine();
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
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.intro_played = true;
        scene.intro_queue_gen =
            crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN;
        scene.current_sublocation_id = Some("room".into());
        assert!(capture_checkpoint(&engine).is_ok());
    }

    #[test]
    fn rejects_testimony_content_offsets_that_are_not_segment_boundaries() {
        let (_guard, mut engine) = fixture_engine();
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
                    interrogation_origin("question:q1:onLoop"),
                    vec![action("onLoop one"), action("onLoop two")],
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

        let error = capture_checkpoint(&engine).unwrap_err();

        assert_eq!(error.code, "invalidDialogueQueue");
    }

    #[test]
    fn rejects_an_interrogation_phase_entry_queue_before_phase_commit() {
        let (_guard, mut engine) = fixture_engine();
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

        let error = capture_checkpoint(&engine).unwrap_err();

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
        capture_checkpoint(&engine).unwrap();
    }

    #[test]
    fn captures_an_investigation_outro_only_after_its_commit() {
        let (_guard, mut engine) = fixture_engine();
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
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.outro_played = true;
        let captured = capture_checkpoint(&engine).unwrap();
        assert_eq!(captured.summary.scene_summary, None);
    }

    #[test]
    fn omits_non_testimony_line_content_boundaries_and_validates_testimony_origin() {
        let (_guard, mut engine) = fixture_engine();
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

        let captured = capture_checkpoint(&engine).unwrap();
        let SceneProgressSnapshot::Interrogation {
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
                        vec![action("onLoop one"), action("onLoop two")],
                    )
                    .unwrap(),
                    DialogueSegment::new(
                        DialogueSegmentOriginV1::InterrogationPhase {
                            chapter_id: "chapter_1".into(),
                            scene_id: "interrogation_scene_2".into(),
                            phase_id: "phase_1".into(),
                            segment_id: "question:q1:line:l1:content".into(),
                        },
                        vec![DialogueItem::Line {
                            speaker: "witness".into(),
                            text: "line".into(),
                            portrait: None,
                        }],
                    )
                    .unwrap(),
                ],
                1,
                0,
                6,
            )
            .unwrap(),
        );
        scene.line_content_start = 2;

        let captured = capture_checkpoint(&engine).unwrap();
        let SceneProgressSnapshot::Interrogation {
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
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn rejects_live_stable_ids_missing_from_packaged_definitions() {
        let (_guard, mut engine) = fixture_engine();
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
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let (_guard, mut engine) = fixture_engine();
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "copy".into(),
            description: "copy".into(),
            details: "copy".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "interrogation_scene_2".into(),
        });
        assert_eq!(
            capture_checkpoint(&engine).unwrap_err().code,
            "inventoryRecordDefinitionMismatch"
        );

        let (_guard, mut engine) = fixture_engine();
        engine
            .story_state
            .insert_unknown_objective_for_test("missing");
        assert_eq!(
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );

        let (_guard, mut engine) = fixture_engine();
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
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn rejects_pending_acquisition_that_disagrees_with_inventory_kind() {
        let (_guard, mut engine) = fixture_engine();
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "copy".into(),
            description: "copy".into(),
            details: "copy".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
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
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn empty_history_requires_initial_next_id() {
        let (_guard, mut engine) = fixture_engine();
        engine.history = DialogueHistory::from_persistence_parts_for_test(Vec::new(), 2, None);

        assert_eq!(
            capture_checkpoint(&engine).unwrap_err().code,
            "invalidSaveCapture"
        );
    }

    #[test]
    fn history_scene_ids_are_resolved_within_each_chapter_package() {
        let (_guard, mut engine) = fixture_engine();
        let mut repeated_id_chapter = engine.chapters[0].clone();
        repeated_id_chapter.id = "chapter_2".into();
        repeated_id_chapter.title = "Chapter Two".into();
        repeated_id_chapter
            .scenes
            .retain(|scene| scene.file.ends_with("/scene_0.json"));
        engine.chapters.push(repeated_id_chapter);

        let captured = capture_checkpoint(&engine).unwrap();

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
        let (_guard, mut investigation) = fixture_engine();
        investigation
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        let captured = capture_checkpoint(&investigation).unwrap();
        assert_eq!(
            captured.snapshot.active_dialogue.unwrap().segment_origins,
            vec![DialogueSegmentOriginV1::InvestigationIntro {
                chapter_id: "chapter_1".into(),
                scene_id: "investigation_scene_1".into(),
            }]
        );

        let (_guard, mut interrogation) = fixture_engine();
        interrogation
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        let intro = capture_checkpoint(&interrogation).unwrap();
        assert_eq!(
            intro.snapshot.active_dialogue.unwrap().segment_origins,
            vec![DialogueSegmentOriginV1::InterrogationIntro {
                chapter_id: "chapter_1".into(),
                scene_id: "interrogation_scene_2".into(),
            }]
        );
        let SceneProgressSnapshot::Interrogation {
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
        let outro = capture_checkpoint(&interrogation).unwrap();
        assert_eq!(outro.summary.scene_summary, None);
        assert_eq!(
            outro.snapshot.active_dialogue.unwrap().segment_origins,
            vec![DialogueSegmentOriginV1::InterrogationOutro {
                chapter_id: "chapter_1".into(),
                scene_id: "interrogation_scene_2".into(),
            }]
        );
        let SceneProgressSnapshot::Interrogation {
            line_content_segment_index,
            ..
        } = outro.snapshot.scene
        else {
            panic!("expected interrogation");
        };
        assert_eq!(line_content_segment_index, None);
    }

    #[test]
    fn rejects_live_queue_item_count_and_order_drift_from_packaged_origins() {
        let (_guard, mut engine) = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!("expected investigation");
        };
        scene.intro_played = true;
        scene.current_sublocation_id = Some("room".into());
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![
                    DialogueSegment::new(
                        DialogueSegmentOriginV1::InvestigationInteraction {
                            chapter_id: "chapter_1".into(),
                            scene_id: "investigation_scene_1".into(),
                            segment_id: "evidence:test_evidence:onCollect".into(),
                        },
                        vec![action("onCollect one")],
                    )
                    .unwrap(),
                    segment(
                        DialogueSegmentOriginV1::InvestigationInteraction {
                            chapter_id: "chapter_1".into(),
                            scene_id: "investigation_scene_1".into(),
                            segment_id: "hotspot:desk:inspect".into(),
                        },
                        "result",
                    ),
                ],
                1,
                0,
                6,
            )
            .unwrap(),
        );
        engine.next_queue_gen = 7;

        let count_error = capture_checkpoint(&engine).unwrap_err();

        assert_eq!(count_error.code, "invalidSaveCapture");
        assert!(count_error.message.contains("packaged"));

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            unreachable!();
        };
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![
                    DialogueSegment::new(
                        DialogueSegmentOriginV1::InvestigationInteraction {
                            chapter_id: "chapter_1".into(),
                            scene_id: "investigation_scene_1".into(),
                            segment_id: "evidence:test_evidence:onCollect".into(),
                        },
                        vec![action("onCollect two"), action("onCollect one")],
                    )
                    .unwrap(),
                    segment(
                        DialogueSegmentOriginV1::InvestigationInteraction {
                            chapter_id: "chapter_1".into(),
                            scene_id: "investigation_scene_1".into(),
                            segment_id: "hotspot:desk:inspect".into(),
                        },
                        "result",
                    ),
                ],
                1,
                0,
                6,
            )
            .unwrap(),
        );
        let order_error = capture_checkpoint(&engine).unwrap_err();

        assert_eq!(order_error.code, "invalidSaveCapture");
        assert!(order_error.message.contains("order"));
    }

    #[test]
    fn capture_rejects_playing_cross_exam_with_out_of_range_line_index() {
        let (_guard, mut engine) = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.intro_played = true;
        scene.current_phase_id = Some("phase_1".into());
        scene.cross_exam = CrossExam::Playing {
            question_id: "q1".into(),
            line_index: 99,
        };
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Playing cross-exam coordinate"));
    }

    #[test]
    fn capture_rejects_presenting_cross_exam_with_unknown_line_id() {
        let (_guard, mut engine) = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.intro_played = true;
        scene.current_phase_id = Some("phase_1".into());
        scene.cross_exam = CrossExam::Presenting {
            question_id: "q1".into(),
            line_id: "missing_line".into(),
        };
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Presenting cross-exam coordinate"));
    }

    #[test]
    fn capture_rejects_investigation_with_unknown_sublocation_hotspot_and_topic() {
        let (_guard, mut engine) = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.intro_played = true;
        scene.current_sublocation_id = Some("missing_sub".into());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Current investigation sublocation"));

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.current_sublocation_id = Some("room".into());
        scene
            .inspected_hotspots
            .insert("missing_hotspot".to_string());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Inspected investigation hotspot"));

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.inspected_hotspots.clear();
        scene
            .discussed_topics
            .insert(("missing_char".into(), "missing_topic".into()));
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Discussed investigation topic"));
    }

    #[test]
    fn capture_rejects_investigation_with_unknown_override_targets() {
        let (_guard, mut engine) = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.intro_played = true;
        scene.current_sublocation_id = Some("room".into());

        scene
            .unlocked_overrides
            .insert("hotspot:missing_hotspot".to_string());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Investigation override hotspot"));

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.unlocked_overrides.clear();
        scene
            .unlocked_overrides
            .insert("sublocation:missing_sub".to_string());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Investigation override sublocation"));

        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.unlocked_overrides.clear();
        scene
            .unlocked_overrides
            .insert("topic:missing_char@missing_topic".to_string());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Investigation override topic"));
    }

    #[test]
    fn capture_rejects_interrogation_with_unknown_phase_question_and_overrides() {
        let (_guard, mut engine) = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.intro_played = true;
        scene.current_phase_id = Some("missing_phase".into());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Current interrogation phase"));

        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.current_phase_id = Some("phase_1".into());
        scene.completed_phases.insert("missing_phase".to_string());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Interrogation phase progress"));

        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.completed_phases.clear();
        scene
            .broken_questions
            .insert("missing_question".to_string());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Broken interrogation question"));

        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.broken_questions.clear();
        scene
            .unlocked_overrides
            .insert("question:missing_question".to_string());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Interrogation override question"));

        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.unlocked_overrides.clear();
        scene
            .unlocked_overrides
            .insert("phase:missing_phase".to_string());
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("Interrogation override phase"));
    }

    #[test]
    fn capture_rejects_inventory_with_invalid_acquisition_origins() {
        let (_guard, mut engine) = fixture_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "test".into(),
            description: "test".into(),
            details: "test".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "scene_0".into(),
        });
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "inventoryRecordDefinitionMismatch");

        engine.inventory.evidence.clear();
        engine.inventory.statements.push(StatementRecord {
            id: "alibi_statement".into(),
            speaker: "test".into(),
            content: "test".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            on_reexamine: None,
            acquired_in_chapter_id: "chapter_1".into(),
            acquired_in_scene_id: "scene_0".into(),
        });
        let error = capture_checkpoint(&engine).unwrap_err();
        assert_eq!(error.code, "inventoryRecordDefinitionMismatch");
    }

    #[test]
    fn capture_rejects_acquired_provenance_that_differs_from_the_catalog() {
        let (_guard, resources) = provenance_save_fixture_resources();
        let mut engine = GameEngine::new_started(resources).unwrap();
        let SceneJson::Investigation(scene) = engine
            .packaged_acquisition_scene("chapter_1", "investigation_scene_1")
            .unwrap()
        else {
            panic!("expected investigation fixture")
        };
        let definition = scene
            .evidence_manifest
            .iter()
            .find(|definition| definition.id == "chain_exhibit")
            .unwrap();
        assert!(engine.inventory.add_evidence_from_def(
            definition,
            "chapter_1",
            "investigation_scene_1",
        ));
        engine.inventory.evidence[0].provenance.confidence =
            crate::game::provenance::Confidence::Disputed;

        let error = capture_checkpoint(&engine).unwrap_err();

        assert_eq!(error.code, "inventoryRecordDefinitionMismatch");
    }

    // --- validate_analysis_progress tests ---

    use crate::game::scenes::analysis::AnalysisSceneState;
    use crate::game::schema::AnalysisSceneJson;
    use std::collections::{BTreeMap, BTreeSet};

    fn analysis_def_with_threshold_board() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_scene_1",
            "title": "Analysis",
            "summary": "Test",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [{
                "kind": "threshold",
                "common": {
                    "id": "board_1",
                    "label": "Board",
                    "prompt": "Select.",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                    "cards": [
                        {"id": "card_a", "label": "A", "source": {"kind": "evidence", "id": "ev_a"}, "summary": "A"},
                        {"id": "card_b", "label": "B", "source": {"kind": "practice", "id": "prac_b"}, "summary": "B"}
                    ],
                    "resultDialogue": []
                },
                "minimumSelected": 1,
                "acceptedSelections": [["card_a"]]
            }]
        }))
        .expect("analysis def must deserialize")
    }

    fn analysis_def_with_all_board_kinds() -> AnalysisSceneJson {
        serde_json::from_value(json!({
            "id": "analysis_scene_multi",
            "title": "Multi",
            "summary": "Test",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [
                {
                    "kind": "threshold",
                    "common": {
                        "id": "threshold_board",
                        "label": "T", "prompt": "T", "unlock": null, "reveals": [],
                        "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                        "cards": [{"id": "t_card", "label": "TC", "source": {"kind": "evidence", "id": "ev_t"}, "summary": "T"}],
                        "resultDialogue": []
                    },
                    "minimumSelected": 1,
                    "acceptedSelections": [["t_card"]]
                },
                {
                    "kind": "order",
                    "common": {
                        "id": "order_board",
                        "label": "O", "prompt": "O", "unlock": null, "reveals": [],
                        "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                        "cards": [{"id": "o_card", "label": "OC", "source": {"kind": "evidence", "id": "ev_o"}, "summary": "O"}],
                        "resultDialogue": []
                    },
                    "acceptedOrder": ["o_card"],
                    "fixedAnchors": []
                },
                {
                    "kind": "classify",
                    "common": {
                        "id": "classify_board",
                        "label": "C", "prompt": "C", "unlock": null, "reveals": [],
                        "feedback": {"incomplete": "inc", "incorrect": "wrong", "hint": null},
                        "cards": [{"id": "c_card", "label": "CC", "source": {"kind": "evidence", "id": "ev_c"}, "summary": "C"}],
                        "resultDialogue": []
                    },
                    "groups": [{"id": "grp_1", "label": "G1", "description": "D1"}],
                    "acceptedGroupByCard": {"c_card": "grp_1"}
                }
            ]
        }))
        .expect("multi-board analysis def must deserialize")
    }

    #[test]
    fn validate_analysis_progress_rejects_unknown_draft_board() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.drafts.insert(
            "nonexistent".into(),
            crate::game::analysis::AnalysisDraft::Threshold {
                selected_card_ids: BTreeSet::new(),
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_threshold_board())
            .expect_err("unknown draft board must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_rejects_threshold_selection_on_unknown_board() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        let mut selection = BTreeSet::new();
        selection.insert("card_a".into());
        scene.drafts.insert(
            "nonexistent".into(),
            crate::game::analysis::AnalysisDraft::Threshold {
                selected_card_ids: selection,
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_threshold_board())
            .expect_err("unknown threshold board must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_rejects_threshold_selection_with_unknown_card() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        let mut selection = BTreeSet::new();
        selection.insert("nonexistent_card".into());
        scene.drafts.insert(
            "board_1".into(),
            crate::game::analysis::AnalysisDraft::Threshold {
                selected_card_ids: selection,
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_threshold_board())
            .expect_err("unknown card in threshold selection must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_rejects_order_selection_on_unknown_board() {
        let def = analysis_def_with_all_board_kinds();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.drafts.insert(
            "nonexistent".into(),
            crate::game::analysis::AnalysisDraft::Order {
                card_ids: vec!["o_card".into()],
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_all_board_kinds())
            .expect_err("unknown order board must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_rejects_order_selection_on_non_order_board() {
        let def = analysis_def_with_all_board_kinds();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.drafts.insert(
            "threshold_board".into(),
            crate::game::analysis::AnalysisDraft::Order {
                card_ids: vec!["t_card".into()],
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_all_board_kinds())
            .expect_err("non-order board in order selection must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_rejects_order_selection_with_duplicate_cards() {
        let def = analysis_def_with_all_board_kinds();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.drafts.insert(
            "order_board".into(),
            crate::game::analysis::AnalysisDraft::Order {
                card_ids: vec!["o_card".into(), "o_card".into()],
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_all_board_kinds())
            .expect_err("duplicate cards in order selection must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_rejects_order_selection_with_unknown_card() {
        let def = analysis_def_with_all_board_kinds();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.drafts.insert(
            "order_board".into(),
            crate::game::analysis::AnalysisDraft::Order {
                card_ids: vec!["nonexistent".into()],
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_all_board_kinds())
            .expect_err("unknown card in order selection must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_rejects_classify_on_unknown_board() {
        let def = analysis_def_with_all_board_kinds();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        let mut groups = BTreeMap::new();
        groups.insert("c_card".into(), "grp_1".into());
        scene.drafts.insert(
            "nonexistent".into(),
            crate::game::analysis::AnalysisDraft::Classify {
                group_by_card: groups,
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_all_board_kinds())
            .expect_err("unknown classify board must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_rejects_classify_with_unknown_card_or_group() {
        let def = analysis_def_with_all_board_kinds();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        let mut groups = BTreeMap::new();
        groups.insert("nonexistent_card".into(), "grp_1".into());
        scene.drafts.insert(
            "classify_board".into(),
            crate::game::analysis::AnalysisDraft::Classify {
                group_by_card: groups,
            },
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_all_board_kinds())
            .expect_err("unknown card in classify must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");

        // Unknown group
        let mut scene2 = AnalysisSceneState::from_json(analysis_def_with_all_board_kinds(), 1);
        scene2.intro_played = true;
        let mut groups2 = BTreeMap::new();
        groups2.insert("c_card".into(), "nonexistent_group".into());
        scene2.drafts.insert(
            "classify_board".into(),
            crate::game::analysis::AnalysisDraft::Classify {
                group_by_card: groups2,
            },
        );
        let error2 = validate_analysis_progress(&scene2, &analysis_def_with_all_board_kinds())
            .expect_err("unknown group in classify must be rejected");
        assert_eq!(error2.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_progress_accepts_scene_without_practice_card_state() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        validate_analysis_progress(&scene, &analysis_def_with_threshold_board())
            .expect("practice cards are no longer scene runtime state");
    }

    #[test]
    fn validate_analysis_progress_accepts_valid_state() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def.clone(), 1);
        scene.intro_played = true;
        let mut selection = BTreeSet::new();
        selection.insert("card_a".into());
        scene.drafts.insert(
            "board_1".into(),
            crate::game::analysis::AnalysisDraft::Threshold {
                selected_card_ids: selection,
            },
        );
        validate_analysis_progress(&scene, &def)
            .expect("valid analysis state should pass validation");
    }

    #[test]
    fn validate_analysis_progress_rejects_scene_id_mismatch() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.def.id = "different_scene_id".into();
        let error = validate_analysis_progress(&scene, &analysis_def_with_threshold_board())
            .expect_err("scene ID mismatch must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("does not match"));
    }

    #[test]
    fn validate_analysis_progress_rejects_duplicate_board_ids_in_packaged_def() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        // Build a packaged def with duplicate board IDs by cloning the board.
        let mut packaged = analysis_def_with_threshold_board();
        packaged.boards.push(packaged.boards[0].clone());
        let error = validate_analysis_progress(&scene, &packaged)
            .expect_err("duplicate board IDs in packaged def must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("duplicate board ids"));
    }

    #[test]
    fn validate_analysis_progress_rejects_active_board_referencing_unknown_board() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.active_board_id = Some("nonexistent_board".into());
        let error = validate_analysis_progress(&scene, &analysis_def_with_threshold_board())
            .expect_err("unknown active board must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("unknown board"));
    }

    #[test]
    fn validate_analysis_progress_rejects_feedback_referencing_unknown_board() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.feedback_by_board_id.insert(
            "nonexistent_board".into(),
            crate::game::analysis::AnalysisFeedbackState::Incorrect,
        );
        let error = validate_analysis_progress(&scene, &analysis_def_with_threshold_board())
            .expect_err("unknown feedback board must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("unknown board"));
    }

    // --- validate_analysis_intro tests ---

    #[test]
    fn validate_analysis_intro_rejects_unplayed_intro() {
        let def = analysis_def_with_threshold_board();
        let scene = AnalysisSceneState::from_json(def, 1);
        let error =
            validate_analysis_intro(&scene, None, 2).expect_err("unplayed intro must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("priming"));
    }

    #[test]
    fn validate_analysis_intro_rejects_inconsistent_active_intro() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.intro_queue_gen = 5;
        let active = ActiveDialogueStateV1 {
            segment_origins: vec![DialogueSegmentOriginV1::AnalysisIntro {
                chapter_id: "chapter_1".into(),
                scene_id: "analysis_scene_1".into(),
            }],
            active_segment_index: 0,
            item_cursor: 0,
            queue_gen: 99, // Mismatches scene.intro_queue_gen
        };
        let error = validate_analysis_intro(&scene, Some(&active), 10)
            .expect_err("inconsistent active intro must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
        assert!(error.message.contains("inconsistent"));
    }

    #[test]
    fn validate_analysis_intro_rejects_active_intro_when_not_played() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = false;
        scene.intro_queue_gen = 5;
        let active = ActiveDialogueStateV1 {
            segment_origins: vec![DialogueSegmentOriginV1::AnalysisIntro {
                chapter_id: "chapter_1".into(),
                scene_id: "analysis_scene_1".into(),
            }],
            active_segment_index: 0,
            item_cursor: 0,
            queue_gen: 5,
        };
        let error = validate_analysis_intro(&scene, Some(&active), 10)
            .expect_err("active intro while not played must be rejected");
        assert_eq!(error.code, "invalidSaveCapture");
    }

    #[test]
    fn validate_analysis_intro_accepts_played_intro_without_active_queue() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 1);
        scene.intro_played = true;
        scene.intro_queue_gen = 1;
        validate_analysis_intro(&scene, None, 2)
            .expect("played intro with no active queue should pass");
    }

    #[test]
    fn validate_analysis_intro_accepts_restored_consumed_intro_gen() {
        let def = analysis_def_with_threshold_board();
        let mut scene = AnalysisSceneState::from_json(def, 0); // RESTORED_CONSUMED_INTRO_QUEUE_GEN
        scene.intro_played = true;
        // intro_queue_gen == 0 (restored consumed) is always valid regardless of next_queue_gen
        validate_analysis_intro(&scene, None, 1).expect("restored consumed intro gen should pass");
    }
}
