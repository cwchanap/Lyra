use super::capture::{capture_checkpoint, CapturedCheckpoint};
use super::schema::{
    AcquisitionEventStateV1, AnalysisBoardCardsSnapshotV1, AnalysisBoardGroupSnapshotV1,
    AudioCueSnapshotV1, CrossExamSnapshotV1, DialogueHistoryEntryV1, DialogueHistorySnapshotV1,
    InventorySnapshotV1, LastVisualCueSnapshotV1, RecordKind, SaveEnvelope, SaveSlotRef,
    SaveSnapshot, SaveSummary, SaveType, SceneProgressSnapshot,
};
use crate::game::content_manifest::ContentManifest;
use crate::game::dialogue::{DialogueHistory, DIALOGUE_HISTORY_LIMIT};
use crate::game::dialogue_queue::{
    resolve_dialogue_segments, ActiveDialogueQueue, ActiveDialogueStateV1, DialogueSegment,
    DialogueSegmentOriginV1,
};
use crate::game::navigation::{
    load_chapter_manifests, load_chapter_scene_jsons, scene_json_identity, scene_json_summary,
};
use crate::game::provenance::validate_catalog_record_origin_coverage;
use crate::game::scenes::analysis::AnalysisSceneState;
use crate::game::scenes::interrogation::{CrossExam, InterrogationSceneState};
use crate::game::scenes::investigation::InvestigationSceneState;
use crate::game::scenes::linear::LinearSceneState;
use crate::game::scenes::SceneRuntime;
use crate::game::schema::{
    AnalysisBoardJson, AnalysisSceneJson, AssetTypeJson, AudioChannelJson, AudioCueJson,
    InterrogationPhaseJson, InterrogationSceneJson, InvestigationSceneJson, SceneJson,
};
use crate::game::state::{ChapterManifest, Inventory};
use crate::game::story::{
    AssertionOrigin, StoryCatalog, StoryEventBlockKind, StoryState, StoryStateSnapshot,
};
use crate::game::story_location::StoryLocationIndex;
use crate::game::view::{DialogueHistoryEntry, QueueToken};
use crate::game::{GameEngine, GameError, LastVisualCue};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};

pub(crate) struct RestoredGameCandidate {
    pub(crate) engine: GameEngine,
    pub(crate) source: SaveSlotRef,
    pub(crate) save_id: String,
    pub(crate) durable_revision: u64,
}

impl std::fmt::Debug for RestoredGameCandidate {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RestoredGameCandidate")
            .field("source", &self.source)
            .field("save_id", &self.save_id)
            .field("durable_revision", &self.durable_revision)
            .finish_non_exhaustive()
    }
}

pub(crate) struct CurrentDefinitions {
    pub(crate) resources_dir: PathBuf,
    pub(crate) content_manifest: ContentManifest,
    pub(crate) chapters: Vec<ChapterManifest>,
    pub(crate) story_catalog: StoryCatalog,
    pub(crate) scenes_by_key: BTreeMap<(String, String), SceneJson>,
    pub(crate) scene_indices_by_key: BTreeMap<(String, String), usize>,
    pub(crate) semantic_asset_ids: BTreeSet<String>,
    pub(crate) semantic_audio_ids: BTreeSet<String>,
}

impl CurrentDefinitions {
    pub(crate) fn content_revision(&self) -> &str {
        self.content_manifest.content_revision()
    }
}

pub(crate) fn validate_save_summary(
    definitions: &CurrentDefinitions,
    snapshot: &SaveSnapshot,
    summary: &SaveSummary,
) -> Result<(), GameError> {
    let (_, chapter) = exactly_one_chapter(definitions, &snapshot.chapter_id)?;
    let scene = definitions
        .scenes_by_key
        .get(&(snapshot.chapter_id.clone(), snapshot.scene_id.clone()))
        .ok_or_else(GameError::missing_save_definition)?;
    let (_, scene_title) = scene_json_identity(scene);
    let scene_summary = scene_json_summary(scene);
    let active_primary_objective_id = snapshot.story_state.active_primary_objective_id.clone();
    let active_primary_objective_copy = active_primary_objective_id
        .as_deref()
        .map(|id| {
            definitions
                .story_catalog
                .objective(id)
                .map(|objective| (objective.label.clone(), objective.summary.clone()))
                .ok_or_else(GameError::missing_save_definition)
        })
        .transpose()?;
    let (active_primary_objective_label, active_primary_objective_summary) =
        match active_primary_objective_copy {
            Some((label, objective_summary)) => (Some(label), Some(objective_summary)),
            None => (None, None),
        };
    // Only `GameComplete` may retain the authored scene summary; every other
    // resumable scene must carry `scene_summary = None` so a save recap can
    // never leak unrevealed plot content. An older development save that
    // carries resumable scene prose is rejected here and may be deleted.
    let scene_summary_copy_matches = if super::capture::scene_may_retain_summary(&snapshot.scene) {
        summary
            .scene_summary
            .as_ref()
            .is_none_or(|value| value == scene_summary)
    } else {
        summary.scene_summary.is_none()
    };
    let recap_copy_matches = summary
        .chapter_summary
        .as_ref()
        .is_none_or(|value| value == &chapter.summary)
        && scene_summary_copy_matches
        && summary
            .active_primary_objective_summary
            .as_ref()
            .is_none_or(|value| Some(value) == active_primary_objective_summary.as_ref());
    if summary.chapter_id != snapshot.chapter_id
        || summary.chapter_title != chapter.title
        || summary.scene_id != snapshot.scene_id
        || summary.scene_title != scene_title
        || summary.active_primary_objective_id != active_primary_objective_id
        || summary.active_primary_objective_label != active_primary_objective_label
        || !recap_copy_matches
    {
        return Err(invalid_progress(
            "Save summary does not match the saved packaged state.",
        ));
    }
    Ok(())
}

pub(crate) fn load_current_definitions(
    resources_dir: &Path,
) -> Result<CurrentDefinitions, GameError> {
    let content_manifest = ContentManifest::load(resources_dir)?;
    let chapters = load_chapter_manifests(resources_dir)?;
    let story_catalog = StoryCatalog::load(resources_dir)?;
    let mut scenes_by_key = BTreeMap::new();
    let mut scene_indices_by_key = BTreeMap::new();
    let mut semantic_asset_ids = BTreeSet::new();
    let mut semantic_audio_ids = BTreeSet::new();

    for chapter in &chapters {
        let scenes = load_chapter_scene_jsons(resources_dir, &story_catalog, chapter)?;
        if scenes.len() != chapter.scenes.len() {
            return Err(GameError::missing_save_definition());
        }
        for (scene_index, scene) in scenes.into_iter().enumerate() {
            let (scene_id, _) = scene_json_identity(&scene);
            let key = (chapter.id.clone(), scene_id.to_owned());
            if scenes_by_key.contains_key(&key) {
                return Err(GameError::new(
                    "invalidSaveProgress",
                    format!(
                        "Packaged scene identity '{}/{}' is ambiguous.",
                        key.0, key.1
                    ),
                ));
            }
            scene_indices_by_key.insert(key.clone(), scene_index);
            for asset_ref in scene_asset_refs(&scene) {
                match asset_ref.asset_type {
                    AssetTypeJson::Audio => {
                        semantic_audio_ids.insert(asset_ref.asset_id.clone());
                    }
                    _ => {
                        semantic_asset_ids.insert(asset_ref.asset_id.clone());
                    }
                }
            }
            scenes_by_key.insert(key, scene);
        }
    }

    validate_catalog_record_origin_coverage(&story_catalog, scenes_by_key.keys().cloned())?;

    Ok(CurrentDefinitions {
        resources_dir: resources_dir.to_path_buf(),
        content_manifest,
        chapters,
        story_catalog,
        scenes_by_key,
        scene_indices_by_key,
        semantic_asset_ids,
        semantic_audio_ids,
    })
}

pub(crate) fn build_restore_candidate(
    resources_dir: PathBuf,
    definitions: &CurrentDefinitions,
    envelope: SaveEnvelope,
) -> Result<RestoredGameCandidate, GameError> {
    if resources_dir != definitions.resources_dir {
        return Err(GameError::save_discovery_unavailable());
    }
    // The caller normally obtained this value through version dispatch, but a
    // typed Rust value is not trusted either: validate the complete envelope
    // boundary again before using any field.
    let encoded = serde_json::to_vec(&envelope).map_err(|_| GameError::malformed_save_json())?;
    let envelope = super::schema::parse_current_envelope(&encoded)?;
    let packaged_revision = definitions.content_manifest.content_revision();
    if envelope.content_revision != packaged_revision {
        return Err(GameError::incompatible_content_revision(
            &envelope.content_revision,
            packaged_revision,
        ));
    }
    validate_save_summary(definitions, &envelope.snapshot, &envelope.summary)?;

    let source = match envelope.save_type {
        SaveType::Auto => SaveSlotRef::Auto {
            slot: envelope.slot,
        },
        SaveType::Manual => SaveSlotRef::Manual {
            slot: envelope.slot,
        },
    };
    let snapshot = &envelope.snapshot;
    let (chapter_index, chapter) = exactly_one_chapter(definitions, &snapshot.chapter_id)?;
    let packaged_scene = definitions
        .scenes_by_key
        .get(&(snapshot.chapter_id.clone(), snapshot.scene_id.clone()))
        .ok_or_else(GameError::missing_save_definition)?;
    let scene_index = *definitions
        .scene_indices_by_key
        .get(&(snapshot.chapter_id.clone(), snapshot.scene_id.clone()))
        .ok_or_else(GameError::missing_save_definition)?;

    validate_visual_cues(definitions, &snapshot.last_visual_cue)?;
    validate_story_origins(definitions, &snapshot.story_state)?;
    let story_state =
        StoryState::from_snapshot(&definitions.story_catalog, snapshot.story_state.clone())?;
    let inventory = restore_inventory(definitions, &snapshot.inventory)?;
    validate_pending_events(
        &inventory,
        &snapshot.pending_acquisition_events,
        snapshot.durable_revision,
    )?;
    let active_queue = snapshot
        .active_dialogue
        .as_ref()
        .map(|active| restore_active_queue(definitions, active, snapshot.next_queue_gen))
        .transpose()?;
    let active_token = active_queue
        .as_ref()
        .map(|queue| {
            Ok(QueueToken {
                scene_id: snapshot.scene_id.clone(),
                queue_gen: queue.queue_gen(),
                cursor: queue.flattened_cursor()?,
            })
        })
        .transpose()?;
    let history = restore_history(
        definitions,
        &snapshot.dialogue_history,
        snapshot.next_queue_gen,
        active_token.as_ref(),
    )?;
    let scene = restore_scene(
        &snapshot.chapter_id,
        packaged_scene,
        &snapshot.scene,
        &inventory,
        active_queue,
        snapshot.active_dialogue.as_ref(),
    )?;

    let completed = matches!(snapshot.scene, SceneProgressSnapshot::GameComplete);
    let current_chapter_idx = if completed {
        if chapter_index + 1 != definitions.chapters.len()
            || scene_index + 1 != chapter.scenes.len()
        {
            return Err(invalid_progress(
                "Game Complete does not retain the final packaged scene.",
            ));
        }
        definitions.chapters.len()
    } else {
        chapter_index
    };
    let current_scene_idx = if completed { 0 } else { scene_index };
    let story_locations =
        StoryLocationIndex::from_loaded_scenes(&definitions.chapters, &definitions.scenes_by_key)?;
    let engine = GameEngine {
        resources_dir,
        content_manifest: definitions.content_manifest.clone(),
        chapters: definitions.chapters.clone(),
        story_catalog: definitions.story_catalog.clone(),
        story_locations,
        story_state,
        current_chapter_idx,
        current_scene_idx,
        scene,
        last_visual_cue: restore_visual_cue(snapshot.last_visual_cue.clone()),
        inventory,
        next_queue_gen: snapshot.next_queue_gen,
        history,
        durable_revision: snapshot.durable_revision,
        pending_acquisition_events: snapshot.pending_acquisition_events.clone(),
        cached_pending_acquisition_scene: std::cell::RefCell::new(None),
    };

    // The capture boundary is intentionally independent from restore. Re-run
    // its exhaustive invariants on the detached candidate and demand exact
    // snapshot equality so duplicate IDs, reordered coordinates, or
    // normalization cannot be smuggled through reconstruction. Recap copy is
    // optional and non-authoritative: absent prose stays absent, while any
    // present prose was checked against packaged definitions above. Only
    // GameComplete may retain its final-scene prose, so exact recapture checks
    // the snapshot rather than rebuilding recap copy.
    let CapturedCheckpoint {
        summary: _,
        snapshot: recaptured_snapshot,
    } = capture_checkpoint(&engine).map_err(|error| {
        invalid_progress(format!("Restored candidate is invalid: {}", error.message))
    })?;
    if recaptured_snapshot != envelope.snapshot {
        return Err(invalid_progress(
            "Restored candidate does not recapture to the exact saved snapshot.",
        ));
    }
    // Build the public view as the final fallible validation boundary. This
    // resolves pending acquisition definitions without mutating history.
    engine.view().map_err(|error| {
        invalid_progress(format!(
            "Restored public view is invalid: {}",
            error.message
        ))
    })?;

    Ok(RestoredGameCandidate {
        engine,
        source,
        save_id: envelope.save_id,
        durable_revision: envelope.snapshot.durable_revision,
    })
}

fn exactly_one_chapter<'a>(
    definitions: &'a CurrentDefinitions,
    chapter_id: &str,
) -> Result<(usize, &'a ChapterManifest), GameError> {
    let mut matches = definitions
        .chapters
        .iter()
        .enumerate()
        .filter(|(_, chapter)| chapter.id == chapter_id);
    let found = matches
        .next()
        .ok_or_else(GameError::missing_save_definition)?;
    if matches.next().is_some() {
        return Err(invalid_progress(format!(
            "Packaged chapter identity '{chapter_id}' is ambiguous."
        )));
    }
    Ok(found)
}

fn restore_active_queue(
    definitions: &CurrentDefinitions,
    saved: &ActiveDialogueStateV1,
    next_queue_gen: u64,
) -> Result<ActiveDialogueQueue, GameError> {
    if saved.queue_gen == 0 || saved.queue_gen >= next_queue_gen {
        return Err(GameError::invalid_save_cursor());
    }
    let mut segments: Vec<DialogueSegment> = Vec::with_capacity(saved.segment_origins.len());
    for origin in &saved.segment_origins {
        let scene = definitions
            .scenes_by_key
            .get(&(origin.chapter_id().into(), origin.scene_id().into()))
            .ok_or_else(GameError::missing_save_definition)?;
        segments.extend(
            resolve_dialogue_segments(origin.chapter_id(), scene, std::slice::from_ref(origin))
                .map_err(|error| invalid_progress(error.message))?,
        );
    }
    ActiveDialogueQueue::from_position(
        segments,
        saved.active_segment_index,
        saved.item_cursor,
        saved.queue_gen,
    )
    .map_err(|_| GameError::invalid_save_cursor())
}

fn restore_scene(
    chapter_id: &str,
    packaged: &SceneJson,
    progress: &SceneProgressSnapshot,
    inventory: &Inventory,
    active_queue: Option<ActiveDialogueQueue>,
    active_snapshot: Option<&ActiveDialogueStateV1>,
) -> Result<SceneRuntime, GameError> {
    match (packaged, progress) {
        (
            SceneJson::Analysis(definition),
            SceneProgressSnapshot::Analysis {
                intro_played,
                outro_played,
                completed_board_ids,
                selected_card_ids_by_board,
                ordered_card_ids_by_board,
                group_by_card_by_board,
                practice_card_ids,
                last_feedback,
            },
        ) => {
            validate_analysis_refs(
                definition,
                completed_board_ids,
                selected_card_ids_by_board,
                ordered_card_ids_by_board,
                group_by_card_by_board,
                practice_card_ids,
                inventory,
            )?;
            let intro_queue_gen = active_intro_gen(
                active_snapshot,
                |origin| matches!(origin, DialogueSegmentOriginV1::AnalysisIntro { scene_id, .. } if scene_id == &definition.id),
                crate::game::scenes::analysis::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
            );
            let mut scene = AnalysisSceneState::from_json(definition.clone(), intro_queue_gen);
            scene.intro_played = *intro_played;
            scene.outro_played = *outro_played;
            scene.completed_board_ids = completed_board_ids.iter().cloned().collect();
            scene.selected_card_ids_by_board =
                restore_analysis_card_sets(selected_card_ids_by_board, "threshold")?;
            scene.ordered_card_ids_by_board =
                restore_analysis_card_vectors(ordered_card_ids_by_board, "order")?;
            scene.group_by_card_by_board = restore_analysis_group_sets(group_by_card_by_board)?;
            scene.practice_card_ids = practice_card_ids.iter().cloned().collect();
            scene.last_feedback = last_feedback.clone();
            scene.pending_queue = active_queue;
            Ok(SceneRuntime::Analysis(Box::new(scene)))
        }
        (SceneJson::Linear(definition), SceneProgressSnapshot::Linear) => {
            let queue = active_queue.ok_or_else(GameError::invalid_save_cursor)?;
            let mut scene = LinearSceneState::from_json(
                definition.clone(),
                chapter_id,
                active_snapshot.map_or(1, |active| active.queue_gen),
            );
            scene.queue = Some(queue);
            Ok(SceneRuntime::Linear(scene))
        }
        (
            SceneJson::Investigation(definition),
            SceneProgressSnapshot::Investigation {
                intro_played,
                outro_played,
                current_sublocation_id,
                inspected_hotspot_ids,
                discussed_topic_ids,
                entered_sublocation_ids,
                unlocked_overrides,
                practice_card_ids,
            },
        ) => {
            validate_investigation_refs(
                definition,
                current_sublocation_id.as_deref(),
                inspected_hotspot_ids,
                discussed_topic_ids,
                entered_sublocation_ids,
                unlocked_overrides,
            )?;
            let intro_queue_gen = active_intro_gen(
                active_snapshot,
                |origin| matches!(origin, DialogueSegmentOriginV1::InvestigationIntro { scene_id, .. } if scene_id == &definition.id),
                crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
            );
            let mut scene = InvestigationSceneState::from_json(definition.clone(), intro_queue_gen);
            scene.intro_played = *intro_played;
            scene.outro_played = *outro_played;
            scene.current_sublocation_id = current_sublocation_id.clone();
            scene.pending_queue = active_queue;
            scene.inspected_hotspots = inspected_hotspot_ids.iter().cloned().collect();
            scene.discussed_topics = discussed_topic_ids
                .iter()
                .map(|topic| (topic.character_id.clone(), topic.topic_id.clone()))
                .collect();
            scene.entered_sublocations = entered_sublocation_ids.iter().cloned().collect();
            scene.unlocked_overrides = unlocked_overrides
                .iter()
                .map(super::schema::InvestigationOverrideRefV1::runtime_key)
                .collect();
            scene.practice_card_ids = practice_card_ids.iter().cloned().collect();
            Ok(SceneRuntime::Investigation(Box::new(scene)))
        }
        (
            SceneJson::Interrogation(definition),
            SceneProgressSnapshot::Interrogation {
                intro_played,
                outro_played,
                current_phase_id,
                cross_exam,
                broken_question_ids,
                completed_phase_ids,
                unlocked_overrides,
                entered_phase_ids,
                line_content_segment_index,
            },
        ) => {
            validate_interrogation_refs(
                definition,
                current_phase_id.as_deref(),
                cross_exam,
                broken_question_ids,
                completed_phase_ids,
                unlocked_overrides,
                entered_phase_ids,
            )?;
            let intro_queue_gen = active_intro_gen(
                active_snapshot,
                |origin| matches!(origin, DialogueSegmentOriginV1::InterrogationIntro { scene_id, .. } if scene_id == &definition.id),
                crate::game::scenes::interrogation::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
            );
            let mut scene = InterrogationSceneState::from_json(definition.clone(), intro_queue_gen);
            scene.intro_played = *intro_played;
            scene.outro_played = *outro_played;
            scene.current_phase_id = current_phase_id.clone();
            scene.cross_exam =
                restore_cross_exam(definition, current_phase_id.as_deref(), cross_exam)?;
            scene.broken_questions = broken_question_ids.iter().cloned().collect();
            scene.completed_phases = completed_phase_ids.iter().cloned().collect();
            scene.unlocked_overrides = unlocked_overrides
                .iter()
                .map(super::schema::InterrogationOverrideRefV1::runtime_key)
                .collect();
            for phase_id in entered_phase_ids {
                scene.mark_phase_entered(phase_id);
            }
            scene.line_content_start = match (&active_queue, line_content_segment_index) {
                (Some(queue), Some(index)) => {
                    validate_testimony_boundary_origin(definition, cross_exam, queue, *index)?;
                    queue
                        .flattened_segment_boundary(*index)
                        .map_err(|_| GameError::invalid_save_cursor())?
                }
                (Some(queue), None) => queue
                    .flattened_len()
                    .map_err(|_| GameError::invalid_save_cursor())?,
                (None, Some(_)) => return Err(GameError::invalid_save_cursor()),
                (None, None) => 0,
            };
            scene.pending_queue = active_queue;
            Ok(SceneRuntime::Interrogation(Box::new(scene)))
        }
        (SceneJson::Interrogation(definition), SceneProgressSnapshot::GameComplete) => {
            let mut scene = InterrogationSceneState::from_json(
                definition.clone(),
                crate::game::scenes::interrogation::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
            );
            scene.intro_played = true;
            scene.outro_played = true;
            scene.pending_queue = None;
            Ok(SceneRuntime::Interrogation(Box::new(scene)))
        }
        (SceneJson::Investigation(definition), SceneProgressSnapshot::GameComplete) => {
            let mut scene = InvestigationSceneState::from_json(
                definition.clone(),
                crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
            );
            scene.intro_played = true;
            scene.outro_played = true;
            scene.pending_queue = None;
            Ok(SceneRuntime::Investigation(Box::new(scene)))
        }
        (SceneJson::Linear(definition), SceneProgressSnapshot::GameComplete) => {
            let mut scene = LinearSceneState::from_json(definition.clone(), chapter_id, 1);
            scene.queue = None;
            Ok(SceneRuntime::Linear(scene))
        }
        _ => Err(invalid_progress(
            "Saved scene progress kind does not match the packaged scene kind.",
        )),
    }
}

fn active_intro_gen(
    active: Option<&ActiveDialogueStateV1>,
    is_intro: impl Fn(&DialogueSegmentOriginV1) -> bool,
    consumed: u64,
) -> u64 {
    active
        .filter(|queue| queue.segment_origins.iter().any(is_intro))
        .map_or(consumed, |queue| queue.queue_gen)
}

fn validate_analysis_refs(
    definition: &AnalysisSceneJson,
    completed_board_ids: &[String],
    selected_card_ids_by_board: &[AnalysisBoardCardsSnapshotV1],
    ordered_card_ids_by_board: &[AnalysisBoardCardsSnapshotV1],
    group_by_card_by_board: &[AnalysisBoardGroupSnapshotV1],
    practice_card_ids: &[String],
    inventory: &Inventory,
) -> Result<(), GameError> {
    let board = |board_id: &str| {
        definition
            .boards
            .iter()
            .find(|board| board.common().id == board_id)
    };
    if completed_board_ids.iter().collect::<BTreeSet<_>>().len() != completed_board_ids.len() {
        return Err(invalid_progress(
            "Analysis completion contains duplicate board ids.",
        ));
    }
    for board_id in completed_board_ids {
        if board(board_id).is_none() {
            return Err(invalid_progress(format!(
                "Analysis completion references missing board '{board_id}'."
            )));
        }
    }

    let practice_ids: BTreeSet<_> = definition
        .boards
        .iter()
        .flat_map(|board| &board.common().cards)
        .filter_map(|card| match &card.source {
            crate::game::schema::AnalysisCardSource::Practice { id } => Some(id.as_str()),
            _ => None,
        })
        .collect();
    if practice_card_ids.iter().collect::<BTreeSet<_>>().len() != practice_card_ids.len()
        || practice_card_ids
            .iter()
            .any(|id| !practice_ids.contains(id.as_str()))
    {
        return Err(invalid_progress(
            "Analysis practice cards do not match the packaged board scope.",
        ));
    }
    let saved_practice: BTreeSet<_> = practice_card_ids.iter().map(String::as_str).collect();

    let mut seen_selection_boards = BTreeSet::new();
    for selection in selected_card_ids_by_board {
        if !seen_selection_boards.insert(selection.board_id.as_str()) {
            return Err(invalid_progress(
                "Duplicate analysis threshold selection board.",
            ));
        }
        let Some(AnalysisBoardJson::Threshold { common, .. }) = board(&selection.board_id) else {
            return Err(invalid_progress(format!(
                "Threshold selection references unknown or non-threshold board '{}'.",
                selection.board_id
            )));
        };
        validate_analysis_saved_cards(
            &selection.board_id,
            &selection.card_ids,
            &common.cards,
            &saved_practice,
            inventory,
        )?;
    }

    let mut seen_order_boards = BTreeSet::new();
    for selection in ordered_card_ids_by_board {
        if !seen_order_boards.insert(selection.board_id.as_str()) {
            return Err(invalid_progress(
                "Duplicate analysis order selection board.",
            ));
        }
        let Some(AnalysisBoardJson::Order { common, .. }) = board(&selection.board_id) else {
            return Err(invalid_progress(format!(
                "Order selection references unknown or non-order board '{}'.",
                selection.board_id
            )));
        };
        validate_analysis_saved_cards(
            &selection.board_id,
            &selection.card_ids,
            &common.cards,
            &saved_practice,
            inventory,
        )?;
    }

    let mut seen_group_boards = BTreeSet::new();
    for selection in group_by_card_by_board {
        if !seen_group_boards.insert(selection.board_id.as_str()) {
            return Err(invalid_progress("Duplicate analysis classification board."));
        }
        let Some(AnalysisBoardJson::Classify { common, groups, .. }) = board(&selection.board_id)
        else {
            return Err(invalid_progress(format!(
                "Classification references unknown or non-classify board '{}'.",
                selection.board_id
            )));
        };
        let card_ids = selection.group_by_card.keys().cloned().collect::<Vec<_>>();
        validate_analysis_saved_cards(
            &selection.board_id,
            &card_ids,
            &common.cards,
            &saved_practice,
            inventory,
        )?;
        if selection
            .group_by_card
            .values()
            .any(|group_id| !groups.iter().any(|group| group.id == *group_id))
        {
            return Err(invalid_progress(
                "Classification selection references an unknown group.",
            ));
        }
    }
    Ok(())
}

fn validate_analysis_saved_cards(
    board_id: &str,
    card_ids: &[String],
    cards: &[crate::game::schema::AnalysisCardJson],
    saved_practice: &BTreeSet<&str>,
    inventory: &Inventory,
) -> Result<(), GameError> {
    if card_ids.iter().collect::<BTreeSet<_>>().len() != card_ids.len() {
        return Err(invalid_progress(format!(
            "Analysis selection for '{board_id}' contains duplicate cards."
        )));
    }
    for card_id in card_ids {
        let card = cards
            .iter()
            .find(|card| card.id == *card_id)
            .ok_or_else(|| {
                invalid_progress(format!(
                    "Analysis selection references unknown card '{card_id}' on '{board_id}'."
                ))
            })?;
        let available = match &card.source {
            crate::game::schema::AnalysisCardSource::Evidence { id } => inventory.has_evidence(id),
            crate::game::schema::AnalysisCardSource::Statement { id } => {
                inventory.has_statement(id)
            }
            crate::game::schema::AnalysisCardSource::Practice { id } => {
                saved_practice.contains(id.as_str())
            }
        };
        if !available {
            return Err(invalid_progress(format!(
                "Analysis selection references unavailable card '{card_id}' on '{board_id}'."
            )));
        }
    }
    Ok(())
}

fn restore_analysis_card_sets(
    values: &[AnalysisBoardCardsSnapshotV1],
    _kind: &str,
) -> Result<BTreeMap<String, BTreeSet<String>>, GameError> {
    let mut restored = BTreeMap::new();
    for value in values {
        if restored
            .insert(
                value.board_id.clone(),
                value.card_ids.iter().cloned().collect(),
            )
            .is_some()
        {
            return Err(invalid_progress(
                "Duplicate saved analysis board selection.",
            ));
        }
    }
    Ok(restored)
}

fn restore_analysis_card_vectors(
    values: &[AnalysisBoardCardsSnapshotV1],
    _kind: &str,
) -> Result<BTreeMap<String, Vec<String>>, GameError> {
    let mut restored = BTreeMap::new();
    for value in values {
        if restored
            .insert(value.board_id.clone(), value.card_ids.clone())
            .is_some()
        {
            return Err(invalid_progress("Duplicate saved analysis board ordering."));
        }
    }
    Ok(restored)
}

fn restore_analysis_group_sets(
    values: &[AnalysisBoardGroupSnapshotV1],
) -> Result<BTreeMap<String, BTreeMap<String, String>>, GameError> {
    let mut restored = BTreeMap::new();
    for value in values {
        if restored
            .insert(value.board_id.clone(), value.group_by_card.clone())
            .is_some()
        {
            return Err(invalid_progress("Duplicate saved analysis classification."));
        }
    }
    Ok(restored)
}

fn validate_investigation_refs(
    definition: &InvestigationSceneJson,
    current_sublocation_id: Option<&str>,
    inspected_hotspot_ids: &[String],
    discussed_topic_ids: &[super::schema::CharacterTopicRefV1],
    entered_sublocation_ids: &[String],
    unlocked_overrides: &[super::schema::InvestigationOverrideRefV1],
) -> Result<(), GameError> {
    let sublocation = |id: &str| definition.sublocations.iter().any(|item| item.id == id);
    let hotspot = |id: &str| {
        definition
            .sublocations
            .iter()
            .flat_map(|item| &item.hotspots)
            .any(|item| item.id == id)
    };
    let topic = |character_id: &str, topic_id: &str| {
        definition
            .sublocations
            .iter()
            .flat_map(|item| &item.characters)
            .any(|character| {
                character.id == character_id
                    && character.topics.iter().any(|item| item.id == topic_id)
            })
    };
    if current_sublocation_id.is_some_and(|id| !sublocation(id))
        || entered_sublocation_ids.iter().any(|id| !sublocation(id))
        || inspected_hotspot_ids.iter().any(|id| !hotspot(id))
        || discussed_topic_ids
            .iter()
            .any(|item| !topic(&item.character_id, &item.topic_id))
    {
        return Err(invalid_progress(
            "Investigation progress references a missing packaged definition.",
        ));
    }
    for target in unlocked_overrides {
        let valid = match target {
            super::schema::InvestigationOverrideRefV1::Hotspot { id } => hotspot(id),
            super::schema::InvestigationOverrideRefV1::Sublocation { id } => sublocation(id),
            super::schema::InvestigationOverrideRefV1::Topic {
                character_id,
                topic_id,
            } => topic(character_id, topic_id),
        };
        if !valid {
            return Err(invalid_progress(
                "Investigation override references a missing packaged definition.",
            ));
        }
    }
    require_unique(inspected_hotspot_ids, "inspected hotspot")?;
    require_unique(entered_sublocation_ids, "entered sublocation")?;
    require_unique(discussed_topic_ids, "discussed topic")?;
    require_unique(unlocked_overrides, "investigation override")?;
    Ok(())
}

fn validate_interrogation_refs(
    definition: &InterrogationSceneJson,
    current_phase_id: Option<&str>,
    cross_exam: &CrossExamSnapshotV1,
    broken_question_ids: &[String],
    completed_phase_ids: &[String],
    unlocked_overrides: &[super::schema::InterrogationOverrideRefV1],
    entered_phase_ids: &[String],
) -> Result<(), GameError> {
    let phase = |id: &str| {
        definition.phases.iter().any(|item| {
            let InterrogationPhaseJson::Inquiry { id: candidate, .. } = item;
            candidate == id
        })
    };
    let question = |id: &str| {
        definition.phases.iter().any(|item| {
            let InterrogationPhaseJson::Inquiry { questions, .. } = item;
            questions.iter().any(|item| item.id == id)
        })
    };
    if current_phase_id.is_some_and(|id| !phase(id))
        || broken_question_ids.iter().any(|id| !question(id))
        || completed_phase_ids.iter().any(|id| !phase(id))
        || entered_phase_ids.iter().any(|id| !phase(id))
    {
        return Err(invalid_progress(
            "Interrogation progress references a missing packaged definition.",
        ));
    }
    for target in unlocked_overrides {
        let valid = match target {
            super::schema::InterrogationOverrideRefV1::Question { id } => question(id),
            super::schema::InterrogationOverrideRefV1::Phase { id } => phase(id),
        };
        if !valid {
            return Err(invalid_progress(
                "Interrogation override references a missing packaged definition.",
            ));
        }
    }
    if let CrossExamSnapshotV1::Playing {
        question_id,
        line_id,
    }
    | CrossExamSnapshotV1::Presenting {
        question_id,
        line_id,
    } = cross_exam
    {
        exactly_one_testimony_line(definition, current_phase_id, question_id, line_id)?;
    }
    require_unique(broken_question_ids, "broken question")?;
    require_unique(completed_phase_ids, "completed phase")?;
    require_unique(entered_phase_ids, "entered phase")?;
    require_unique(unlocked_overrides, "interrogation override")?;
    Ok(())
}

fn restore_cross_exam(
    definition: &InterrogationSceneJson,
    current_phase_id: Option<&str>,
    snapshot: &CrossExamSnapshotV1,
) -> Result<CrossExam, GameError> {
    match snapshot {
        CrossExamSnapshotV1::Idle => Ok(CrossExam::Idle),
        CrossExamSnapshotV1::Playing {
            question_id,
            line_id,
        } => {
            let line_index =
                exactly_one_testimony_line(definition, current_phase_id, question_id, line_id)?;
            Ok(CrossExam::Playing {
                question_id: question_id.clone(),
                line_index,
            })
        }
        CrossExamSnapshotV1::Presenting {
            question_id,
            line_id,
        } => {
            exactly_one_testimony_line(definition, current_phase_id, question_id, line_id)?;
            Ok(CrossExam::Presenting {
                question_id: question_id.clone(),
                line_id: line_id.clone(),
            })
        }
    }
}

fn exactly_one_testimony_line(
    definition: &InterrogationSceneJson,
    current_phase_id: Option<&str>,
    question_id: &str,
    line_id: &str,
) -> Result<usize, GameError> {
    let phase_id = current_phase_id.ok_or_else(|| {
        invalid_progress("A cross-examination requires a current interrogation phase.")
    })?;
    let phase = definition
        .phases
        .iter()
        .find(|phase| {
            let InterrogationPhaseJson::Inquiry { id, .. } = phase;
            id == phase_id
        })
        .ok_or_else(GameError::missing_save_definition)?;
    let InterrogationPhaseJson::Inquiry { questions, .. } = phase;
    let mut questions = questions
        .iter()
        .filter(|question| question.id == question_id);
    let question = questions
        .next()
        .ok_or_else(|| invalid_progress("Cross-examination question definition is missing."))?;
    if questions.next().is_some() {
        return Err(invalid_progress(
            "Cross-examination question identity is ambiguous.",
        ));
    }
    let mut lines = question
        .testimony
        .lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.id == line_id);
    let (index, _) = lines
        .next()
        .ok_or_else(|| invalid_progress("Cross-examination line definition is missing."))?;
    if lines.next().is_some() {
        return Err(invalid_progress(
            "Cross-examination line identity is ambiguous.",
        ));
    }
    Ok(index)
}

fn validate_testimony_boundary_origin(
    definition: &InterrogationSceneJson,
    cross_exam: &CrossExamSnapshotV1,
    queue: &ActiveDialogueQueue,
    line_content_segment_index: usize,
) -> Result<(), GameError> {
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
            return Err(invalid_progress(
                "A testimony content boundary requires a current cross-exam line.",
            ));
        }
    };
    let origins = queue.segment_origins();
    let origin = origins
        .get(line_content_segment_index)
        .ok_or_else(GameError::invalid_save_cursor)?;
    let DialogueSegmentOriginV1::InterrogationPhase {
        scene_id,
        phase_id,
        segment_id,
        ..
    } = origin
    else {
        return Err(invalid_progress(
            "A testimony content boundary has a non-interrogation origin.",
        ));
    };
    exactly_one_testimony_line(definition, Some(phase_id), question_id, line_id)?;
    let expected_segment_id = format!("question:{question_id}:line:{line_id}:content");
    if scene_id != &definition.id || segment_id != &expected_segment_id {
        return Err(invalid_progress(format!(
            "Saved testimony content origin '{segment_id}' does not match current line '{question_id}/{line_id}'."
        )));
    }
    Ok(())
}

fn restore_inventory(
    definitions: &CurrentDefinitions,
    snapshot: &InventorySnapshotV1,
) -> Result<Inventory, GameError> {
    require_unique_by(
        &snapshot.evidence,
        |entry| entry.record_id.as_str(),
        "evidence inventory record",
    )?;
    require_unique_by(
        &snapshot.statements,
        |entry| entry.record_id.as_str(),
        "statement inventory record",
    )?;
    let mut inventory = Inventory::default();
    for entry in &snapshot.evidence {
        let scene = definitions
            .scenes_by_key
            .get(&(
                entry.collected_in_chapter_id.clone(),
                entry.collected_in_scene_id.clone(),
            ))
            .ok_or_else(GameError::missing_save_definition)?;
        let definition = evidence_manifest(scene)
            .iter()
            .find(|definition| definition.id == entry.record_id)
            .ok_or_else(GameError::missing_save_definition)?;
        if !inventory.add_evidence_from_def(
            definition,
            &entry.collected_in_chapter_id,
            &entry.collected_in_scene_id,
        ) {
            return Err(invalid_progress("Duplicate evidence inventory record."));
        }
    }
    for entry in &snapshot.statements {
        let scene = definitions
            .scenes_by_key
            .get(&(
                entry.acquired_in_chapter_id.clone(),
                entry.acquired_in_scene_id.clone(),
            ))
            .ok_or_else(GameError::missing_save_definition)?;
        let definition = statement_manifest(scene)
            .iter()
            .find(|definition| definition.id == entry.record_id)
            .ok_or_else(GameError::missing_save_definition)?;
        if !inventory.add_statement_from_def(
            definition,
            &entry.acquired_in_chapter_id,
            &entry.acquired_in_scene_id,
        ) {
            return Err(invalid_progress("Duplicate statement inventory record."));
        }
    }
    Ok(inventory)
}

fn evidence_manifest(scene: &SceneJson) -> &[crate::game::schema::EvidenceJson] {
    match scene {
        SceneJson::Investigation(scene) => &scene.evidence_manifest,
        SceneJson::Interrogation(scene) => &scene.evidence_manifest,
        SceneJson::Linear(_) | SceneJson::Analysis(_) => &[],
    }
}

fn statement_manifest(scene: &SceneJson) -> &[crate::game::schema::StatementJson] {
    match scene {
        SceneJson::Investigation(scene) => &scene.statement_manifest,
        SceneJson::Interrogation(scene) => &scene.statement_manifest,
        SceneJson::Linear(_) | SceneJson::Analysis(_) => &[],
    }
}

fn validate_pending_events(
    inventory: &Inventory,
    events: &[AcquisitionEventStateV1],
    durable_revision: u64,
) -> Result<(), GameError> {
    let mut previous = None;
    let mut ids = HashSet::new();
    for event in events {
        crate::game::acquisition::validate_event_id(event)
            .map_err(|_| invalid_progress("Pending acquisition ID is not canonical."))?;
        if event.created_by_command_id == 0 || event.created_by_command_id > durable_revision {
            return Err(invalid_progress(
                "Pending acquisition command revision is impossible.",
            ));
        }
        let ordering = (event.created_by_command_id, event.ordinal);
        if previous.is_some_and(|prior| prior >= ordering) || !ids.insert(event.id.as_str()) {
            return Err(invalid_progress(
                "Pending acquisition ordering keys are duplicate or non-monotonic.",
            ));
        }
        let exists = match event.record_kind {
            RecordKind::Evidence => inventory.has_evidence(&event.record_id),
            RecordKind::Statement => inventory.has_statement(&event.record_id),
        };
        if !exists {
            return Err(invalid_progress(
                "Pending acquisition disagrees with inventory record kind or ID.",
            ));
        }
        previous = Some(ordering);
    }
    Ok(())
}

fn restore_history(
    definitions: &CurrentDefinitions,
    snapshot: &DialogueHistorySnapshotV1,
    next_queue_gen: u64,
    active_token: Option<&QueueToken>,
) -> Result<DialogueHistory, GameError> {
    validate_history_snapshot(definitions, snapshot, next_queue_gen, active_token)?;
    let entries = snapshot
        .entries
        .iter()
        .map(|entry| match entry {
            DialogueHistoryEntryV1::Line {
                id,
                speaker,
                text,
                chapter_title,
                scene_title,
            } => DialogueHistoryEntry::Line {
                id: *id,
                speaker: speaker.clone(),
                text: text.clone(),
                chapter_title: chapter_title.clone(),
                scene_title: scene_title.clone(),
            },
            DialogueHistoryEntryV1::Action {
                id,
                text,
                chapter_title,
                scene_title,
            } => DialogueHistoryEntry::Action {
                id: *id,
                text: text.clone(),
                chapter_title: chapter_title.clone(),
                scene_title: scene_title.clone(),
            },
        })
        .collect();
    Ok(DialogueHistory::from_persistence_parts(
        entries,
        snapshot.next_id,
        snapshot.last_token.clone(),
    ))
}

fn validate_history_snapshot(
    definitions: &CurrentDefinitions,
    snapshot: &DialogueHistorySnapshotV1,
    next_queue_gen: u64,
    active_token: Option<&QueueToken>,
) -> Result<(), GameError> {
    if snapshot.entries.len() > DIALOGUE_HISTORY_LIMIT {
        return Err(invalid_progress(format!(
            "Dialogue history has {} entries; limit is {DIALOGUE_HISTORY_LIMIT}.",
            snapshot.entries.len()
        )));
    }

    let mut prior_id = None;
    for entry in &snapshot.entries {
        let id = match entry {
            DialogueHistoryEntryV1::Line { id, .. } | DialogueHistoryEntryV1::Action { id, .. } => {
                *id
            }
        };
        if id == 0 || id >= snapshot.next_id || prior_id.is_some_and(|prior| id != prior + 1) {
            return Err(invalid_progress(
                "Dialogue history IDs are not structurally valid.",
            ));
        }
        prior_id = Some(id);
    }
    if snapshot.next_id == 0 {
        return Err(invalid_progress("Dialogue history next ID cannot be zero."));
    }
    if snapshot.entries.is_empty() && snapshot.next_id != 1 {
        return Err(invalid_progress(
            "Empty dialogue history must retain the initial next ID.",
        ));
    }
    if let Some(last_id) = prior_id {
        let starts_at_initial_id = matches!(
            snapshot.entries.first(),
            Some(DialogueHistoryEntryV1::Line { id: 1, .. })
                | Some(DialogueHistoryEntryV1::Action { id: 1, .. })
        );
        if last_id.checked_add(1) != Some(snapshot.next_id)
            || (snapshot.entries.len() < DIALOGUE_HISTORY_LIMIT && !starts_at_initial_id)
        {
            return Err(invalid_progress(
                "Dialogue history counter does not follow its retained entries.",
            ));
        }
    }
    if snapshot.last_token.is_some() == snapshot.entries.is_empty() {
        return Err(invalid_progress(
            "Dialogue history token presence does not match retained entries.",
        ));
    }
    if let Some(token) = &snapshot.last_token {
        if token.queue_gen == 0 || token.queue_gen >= next_queue_gen {
            return Err(invalid_progress(format!(
                "Dialogue history queue generation {} is outside 1..{next_queue_gen}.",
                token.queue_gen
            )));
        }
        let maxima = packaged_history_cursor_maxima(definitions, &token.scene_id)?;
        if !maxima.iter().any(|maximum| token.cursor < *maximum) {
            return Err(invalid_progress(format!(
                "Dialogue history cursor {} is outside every packaged scene '{}' bound.",
                token.cursor, token.scene_id
            )));
        }
        if active_token.is_some_and(|active| {
            active.scene_id == token.scene_id
                && active.queue_gen == token.queue_gen
                && active != token
        }) {
            return Err(invalid_progress(
                "Dialogue history token disagrees with the same active queue.",
            ));
        }
    }
    Ok(())
}

fn packaged_history_cursor_maxima(
    definitions: &CurrentDefinitions,
    target_scene_id: &str,
) -> Result<Vec<usize>, GameError> {
    let mut maxima = definitions
        .scenes_by_key
        .iter()
        .filter(|((_, scene_id), _)| scene_id == target_scene_id)
        .map(|(_, scene)| maximum_scene_dialogue_items(scene))
        .collect::<Result<Vec<_>, _>>()?;
    maxima.retain(|maximum| *maximum > 0);
    if maxima.is_empty() {
        return Err(GameError::missing_save_definition());
    }
    Ok(maxima)
}

fn maximum_scene_dialogue_items(scene: &SceneJson) -> Result<usize, GameError> {
    let groups = crate::game::schema::scene_dialogue_groups(scene);
    groups.into_iter().try_fold(0usize, |total, items| {
        total
            .checked_add(items.len())
            .ok_or_else(|| invalid_progress("Packaged dialogue item count overflowed usize."))
    })
}

fn validate_visual_cues(
    definitions: &CurrentDefinitions,
    snapshot: &LastVisualCueSnapshotV1,
) -> Result<(), GameError> {
    if snapshot
        .background_asset_id
        .as_ref()
        .is_some_and(|id| !definitions.semantic_asset_ids.contains(id))
    {
        return Err(GameError::missing_save_definition());
    }
    validate_audio_cue(
        &definitions.semantic_audio_ids,
        snapshot.bgm.as_ref(),
        AudioChannelJson::Bgm,
    )?;
    validate_audio_cue(
        &definitions.semantic_audio_ids,
        snapshot.bgs.as_ref(),
        AudioChannelJson::Bgs,
    )
}

fn validate_audio_cue(
    semantic_audio_ids: &BTreeSet<String>,
    cue: Option<&AudioCueSnapshotV1>,
    expected_channel: AudioChannelJson,
) -> Result<(), GameError> {
    if let Some(cue) = cue {
        if cue.channel != expected_channel {
            return Err(invalid_progress(
                "Saved audio cue is installed in the wrong channel.",
            ));
        }
        if cue
            .asset_id
            .as_ref()
            .is_some_and(|id| !semantic_audio_ids.contains(id))
        {
            return Err(GameError::missing_save_definition());
        }
    }
    Ok(())
}

fn restore_visual_cue(snapshot: LastVisualCueSnapshotV1) -> LastVisualCue {
    LastVisualCue {
        scene_tag: snapshot.scene_tag,
        background_asset_id: snapshot.background_asset_id,
        bgm: snapshot.bgm.map(|cue| AudioCueJson {
            channel: cue.channel,
            asset_id: cue.asset_id,
        }),
        bgs: snapshot.bgs.map(|cue| AudioCueJson {
            channel: cue.channel,
            asset_id: cue.asset_id,
        }),
    }
}

fn scene_asset_refs(scene: &SceneJson) -> &[crate::game::schema::AssetRefJson] {
    match scene {
        SceneJson::Linear(scene) => &scene.asset_refs,
        SceneJson::Investigation(scene) => &scene.asset_refs,
        SceneJson::Interrogation(scene) => &scene.asset_refs,
        SceneJson::Analysis(_) => &[],
    }
}

fn validate_story_origins(
    definitions: &CurrentDefinitions,
    snapshot: &StoryStateSnapshot,
) -> Result<(), GameError> {
    let origins = snapshot
        .facts
        .values()
        .map(|progress| &progress.first_origin)
        .chain(
            snapshot
                .authorizations
                .values()
                .map(|progress| &progress.first_origin),
        );
    for origin in origins {
        match origin {
            AssertionOrigin::AnalysisBoard {
                chapter_id,
                scene_id,
                board_id,
            } => {
                let scene = require_story_scene(definitions, chapter_id, scene_id)?;
                let SceneJson::Analysis(analysis) = scene else {
                    return Err(GameError::invalid_story_state_snapshot(format!(
                        "analysis board origin '{board_id}' points to non-analysis scene '{chapter_id}/{scene_id}'"
                    )));
                };
                if !analysis
                    .boards
                    .iter()
                    .any(|board| board.common().id == *board_id)
                {
                    return Err(GameError::invalid_story_state_snapshot(format!(
                        "analysis board origin references missing board '{board_id}' in '{chapter_id}/{scene_id}'"
                    )));
                }
            }
            AssertionOrigin::SceneEvent {
                chapter_id,
                scene_id,
                block_kind,
                block_id,
            } => {
                let scene = require_story_scene(definitions, chapter_id, scene_id)?;
                if !story_block_exists(scene, *block_kind, block_id) {
                    return Err(GameError::invalid_story_state_snapshot(format!(
                        "origin references missing {} block '{block_id}' in '{chapter_id}/{scene_id}'",
                        story_block_label(*block_kind)
                    )));
                }
            }
        }
    }
    Ok(())
}

fn require_story_scene<'a>(
    definitions: &'a CurrentDefinitions,
    chapter_id: &str,
    scene_id: &str,
) -> Result<&'a SceneJson, GameError> {
    definitions
        .scenes_by_key
        .get(&(chapter_id.into(), scene_id.into()))
        .ok_or_else(|| {
            GameError::invalid_story_state_snapshot(format!(
                "origin references missing scene '{chapter_id}/{scene_id}'"
            ))
        })
}

fn story_block_exists(scene: &SceneJson, kind: StoryEventBlockKind, block_id: &str) -> bool {
    match (scene, kind) {
        (SceneJson::Investigation(scene), StoryEventBlockKind::Sublocation) => {
            scene.sublocations.iter().any(|item| item.id == block_id)
        }
        (SceneJson::Investigation(scene), StoryEventBlockKind::Hotspot) => scene
            .sublocations
            .iter()
            .flat_map(|item| &item.hotspots)
            .any(|item| item.id == block_id),
        (SceneJson::Investigation(scene), StoryEventBlockKind::Topic) => {
            // Topic block ids are qualified as `character_id@topic_id` (see
            // mod.rs interview_topic), because two characters may share a
            // topic id. A bare topic id (from a pre-qualification save) does
            // not match either segment and is treated as a missing block.
            let Some((character_id, topic_id)) = block_id.split_once('@') else {
                return false;
            };
            scene
                .sublocations
                .iter()
                .flat_map(|item| &item.characters)
                .find(|character| character.id == character_id)
                .is_some_and(|character| character.topics.iter().any(|topic| topic.id == topic_id))
        }
        (SceneJson::Interrogation(scene), StoryEventBlockKind::InterrogationPhase) => {
            scene.phases.iter().any(|phase| {
                let InterrogationPhaseJson::Inquiry { id, .. } = phase;
                id == block_id
            })
        }
        (SceneJson::Interrogation(scene), StoryEventBlockKind::InquiryQuestion) => {
            scene.phases.iter().any(|phase| {
                let InterrogationPhaseJson::Inquiry { questions, .. } = phase;
                questions.iter().any(|question| question.id == block_id)
            })
        }
        (SceneJson::Interrogation(scene), StoryEventBlockKind::TestimonyLine) => {
            scene.phases.iter().any(|phase| {
                let InterrogationPhaseJson::Inquiry { questions, .. } = phase;
                questions
                    .iter()
                    .flat_map(|question| &question.testimony.lines)
                    .any(|line| line.id == block_id)
            })
        }
        // StoryEvent is retained in the wire enum for producers outside the
        // current authored-scene pipeline. No concrete StoryEvent block
        // registry is packaged today, so persisted IDs cannot be resolved.
        (_, StoryEventBlockKind::StoryEvent) => false,
        _ => false,
    }
}

fn story_block_label(kind: StoryEventBlockKind) -> &'static str {
    match kind {
        StoryEventBlockKind::Sublocation => "sublocation",
        StoryEventBlockKind::Hotspot => "hotspot",
        StoryEventBlockKind::Topic => "topic",
        StoryEventBlockKind::InterrogationPhase => "interrogation phase",
        StoryEventBlockKind::InquiryQuestion => "inquiry question",
        StoryEventBlockKind::TestimonyLine => "testimony line",
        StoryEventBlockKind::StoryEvent => "story event",
    }
}

fn require_unique<T>(values: &[T], label: &str) -> Result<(), GameError>
where
    T: std::fmt::Debug + Eq + std::hash::Hash,
{
    let mut seen = HashSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(invalid_progress(format!("Duplicate {label} reference.")));
        }
    }
    Ok(())
}

fn require_unique_by<'a, T>(
    values: &'a [T],
    key: impl Fn(&'a T) -> &'a str,
    label: &str,
) -> Result<(), GameError> {
    let mut seen = HashSet::new();
    for value in values {
        if !seen.insert(key(value)) {
            return Err(invalid_progress(format!("Duplicate {label} reference.")));
        }
    }
    Ok(())
}

fn invalid_progress(detail: impl Into<String>) -> GameError {
    GameError::new("invalidSaveProgress", detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::dialogue::DialogueHistory;
    use crate::game::dialogue_queue::{
        ActiveDialogueQueue, DialogueSegment, DialogueSegmentOriginV1,
    };
    use crate::game::save::capture::{capture_checkpoint, CapturedCheckpoint};
    use crate::game::save::schema::{
        AcquisitionEventStateV1, AudioCueSnapshotV1, CharacterTopicRefV1, CrossExamSnapshotV1,
        DialogueHistoryEntryV1, EvidenceInventoryEntryV1, InterrogationOverrideRefV1,
        InvestigationOverrideRefV1, RecordKind, SaveEnvelope, SaveSlotRef, SaveType,
        SceneProgressSnapshot, StatementInventoryEntryV1, ThumbnailDescriptorV1,
        SAVE_SCHEMA_VERSION,
    };
    use crate::game::scenes::interrogation::CrossExam;
    use crate::game::scenes::SceneRuntime;
    use crate::game::schema::{AudioChannelJson, AudioCueJson, DialogueItem, InventoryTarget};
    use crate::game::state::{EvidenceRecord, StatementRecord};
    use crate::game::story::{FactProgressSnapshot, ObjectiveProgressSnapshot};
    use crate::game::support_lineage::SupportLineage;
    use crate::game::test_support::{
        drive_hpa_257_positive_progression, hpa_257_fixture_resources,
        provenance_save_fixture_resources, save_capture_fixture_resources,
    };
    use crate::game::view::ModeView;
    use crate::game::GameEngine;
    use std::path::{Path, PathBuf};

    const SAVE_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
    const P1_CCTV_FEEDBACK: &str = "監視器是真的，但不能單獨說明十七點四十二分。";
    type SaveMutation = Box<dyn FnOnce(&mut SaveEnvelope)>;

    fn envelope_from_checkpoint(
        engine: &GameEngine,
        checkpoint: CapturedCheckpoint,
    ) -> SaveEnvelope {
        SaveEnvelope {
            schema_version: SAVE_SCHEMA_VERSION,
            content_revision: engine.content_revision().into(),
            save_id: SAVE_ID.into(),
            save_type: SaveType::Manual,
            slot: 1,
            saved_at: "2026-07-26T12:34:56Z".into(),
            display_name: "Restore fixture".into(),
            thumbnail: ThumbnailDescriptorV1::Unavailable,
            summary: checkpoint.summary,
            snapshot: checkpoint.snapshot,
        }
    }

    fn envelope(engine: &GameEngine) -> SaveEnvelope {
        envelope_from_checkpoint(engine, capture_checkpoint(engine).unwrap())
    }

    fn resources_and_engine() -> (tempfile::TempDir, PathBuf, GameEngine) {
        let (_guard, resources) = save_capture_fixture_resources();
        let engine = GameEngine::new_started(resources.clone()).unwrap();
        (_guard, resources, engine)
    }

    fn p1_feedback_resources() -> (tempfile::TempDir, PathBuf) {
        let (guard, resources) = save_capture_fixture_resources();
        let chapters_path = resources.join("chapters.json");
        let mut chapters: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&chapters_path).expect("save fixture chapters must be readable"),
        )
        .expect("save fixture chapters must be valid JSON");
        chapters["chapters"][0]["scenes"]
            .as_array_mut()
            .expect("save fixture chapter must contain scenes")
            .push(serde_json::json!({
                "type": "analysis",
                "file": "chapter_1/analysis_scene_p1_5.json"
            }));
        std::fs::write(
            &chapters_path,
            serde_json::to_vec(&chapters).expect("updated chapters fixture must serialize"),
        )
        .expect("updated chapters fixture must write");
        std::fs::write(
            resources.join("chapter_1/analysis_scene_p1_5.json"),
            r#"{
                "type": "analysis",
                "id": "analysis_scene_p1_5",
                "title": "P1",
                "summary": "P1 practice",
                "assetRefs": [],
                "intro": [],
                "outro": [],
                "boards": [{
                    "kind": "threshold",
                    "common": {
                        "id": "p1_reprint_time_board",
                        "label": "重印時間整理",
                        "prompt": "選出正確的三項資料。",
                        "unlock": null,
                        "reveals": [],
                        "feedback": {
                            "incomplete": "還少了一項資料。",
                            "incorrect": "這組資料沒有把兩個時間一起說清楚。",
                            "hint": null,
                            "incorrectSelections": [{
                                "cards": ["cctv_change"],
                                "feedback": "監視器是真的，但不能單獨說明十七點四十二分。"
                            }]
                        },
                        "cards": [
                            {"id": "receipt_reprint", "label": "REPRINT", "source": {"kind": "practice", "id": "p1_receipt_reprint"}, "summary": "重印收據。"},
                            {"id": "register_paper_jam", "label": "卡紙", "source": {"kind": "practice", "id": "p1_register_paper_jam"}, "summary": "卡紙痕跡。"},
                            {"id": "cctv_change", "label": "找零", "source": {"kind": "practice", "id": "p1_cctv_change"}, "summary": "十七點三十八分。"},
                            {"id": "handwritten_ledger", "label": "帳本", "source": {"kind": "practice", "id": "p1_handwritten_ledger"}, "summary": "十七點三十七分。"}
                        ],
                        "resultDialogue": []
                    },
                    "minimumSelected": 3,
                    "acceptedSelections": [["handwritten_ledger", "receipt_reprint", "register_paper_jam"]]
                }]
            }"#,
        )
        .expect("P1 analysis fixture must write");
        (guard, resources)
    }

    fn round_trip(
        resources: PathBuf,
        engine: &GameEngine,
    ) -> (SaveEnvelope, RestoredGameCandidate) {
        let original = envelope(engine);
        let encoded = serde_json::to_vec(&original).unwrap();
        let parsed = crate::game::save::schema::parse_current_envelope(&encoded).unwrap();
        let definitions = load_current_definitions(&resources).unwrap();
        let restored = build_restore_candidate(resources, &definitions, parsed).unwrap();
        (original, restored)
    }

    fn assert_round_trip(resources: PathBuf, engine: &GameEngine) {
        let (original, restored) = round_trip(resources, engine);
        let recaptured = capture_checkpoint(&restored.engine).unwrap();
        assert_eq!(recaptured.snapshot, original.snapshot);
        assert_eq!(recaptured.summary, original.summary);
        assert_eq!(
            serde_json::to_value(&restored.engine.view().unwrap().mode).unwrap(),
            serde_json::to_value(&engine.view().unwrap().mode).unwrap()
        );
        assert_eq!(
            restored.engine.current_queue_token(),
            engine.current_queue_token()
        );
        assert_eq!(
            restored.durable_revision,
            original.snapshot.durable_revision
        );
        assert_eq!(restored.save_id, SAVE_ID);
        assert_eq!(restored.source, SaveSlotRef::Manual { slot: 1 });
    }

    fn assert_rejected_without_live_mutation(
        resources: &Path,
        engine: &GameEngine,
        mutate: impl FnOnce(&mut SaveEnvelope),
    ) -> String {
        let before = serde_json::to_vec(&capture_checkpoint(engine).unwrap()).unwrap();
        let mut save = envelope(engine);
        mutate(&mut save);
        let definitions = load_current_definitions(resources).unwrap();
        let error =
            build_restore_candidate(resources.to_path_buf(), &definitions, save).unwrap_err();
        let after = serde_json::to_vec(&capture_checkpoint(engine).unwrap()).unwrap();
        assert_eq!(after, before, "failed restore mutated the live engine");
        error.code
    }

    fn action(text: &str) -> DialogueItem {
        DialogueItem::Action { text: text.into() }
    }

    fn interrogation_origin(segment_id: &str) -> DialogueSegmentOriginV1 {
        DialogueSegmentOriginV1::InterrogationPhase {
            chapter_id: "chapter_1".into(),
            scene_id: "interrogation_scene_2".into(),
            phase_id: "phase_1".into(),
            segment_id: segment_id.into(),
        }
    }

    // Break caught: analysis progress and its dialogue carrier must restore
    // through the same package-backed scene state as other playable scenes.
    #[test]
    fn restore_accepts_analysis_scene_progress() {
        let analysis = serde_json::from_str::<SceneJson>(include_str!(
            "../test_fixtures/analysis_scene_8_5.json"
        ))
        .expect("analysis compiler fixture must deserialize");
        let restored = restore_scene(
            "chapter_1",
            &analysis,
            &SceneProgressSnapshot::Analysis {
                intro_played: true,
                outro_played: false,
                completed_board_ids: vec![],
                selected_card_ids_by_board: vec![],
                ordered_card_ids_by_board: vec![],
                group_by_card_by_board: vec![],
                practice_card_ids: vec![],
                last_feedback: None,
            },
            &Inventory::default(),
            None,
            None,
        )
        .expect("analysis scene progress should restore");
        assert!(matches!(restored, SceneRuntime::Analysis(_)));
    }

    #[test]
    fn restore_keeps_p1_practice_cards_in_the_analysis_notebook() {
        let analysis = serde_json::from_value::<SceneJson>(serde_json::json!({
            "type": "analysis",
            "id": "analysis_scene_p1_5",
            "title": "P1",
            "summary": "P1 practice",
            "assetRefs": [],
            "intro": [],
            "outro": [],
            "boards": [{
                "kind": "threshold",
                "common": {
                    "id": "p1_reprint_time_board",
                    "label": "P1",
                    "prompt": "P1",
                    "unlock": null,
                    "reveals": [],
                    "feedback": {"incomplete": "more", "incorrect": "wrong", "hint": null},
                    "cards": [{
                        "id": "receipt_reprint",
                        "label": "REPRINT",
                        "source": {"kind": "practice", "id": "p1_receipt_reprint"},
                        "summary": "P1"
                    }],
                    "resultDialogue": []
                },
                "minimumSelected": 1,
                "acceptedSelections": [["receipt_reprint"]]
            }]
        }))
        .expect("P1 analysis definition must deserialize");
        let inventory = Inventory::default();
        let restored = restore_scene(
            "chapter_1",
            &analysis,
            &SceneProgressSnapshot::Analysis {
                intro_played: true,
                outro_played: false,
                completed_board_ids: vec![],
                selected_card_ids_by_board: vec![],
                ordered_card_ids_by_board: vec![],
                group_by_card_by_board: vec![],
                practice_card_ids: vec!["p1_receipt_reprint".into()],
                last_feedback: None,
            },
            &inventory,
            None,
            None,
        )
        .expect("P1 practice state should restore");

        assert!(inventory.evidence.is_empty());
        assert!(inventory.statements.is_empty());
        let SceneRuntime::Analysis(scene) = restored else {
            panic!("expected restored Analysis runtime");
        };
        assert!(scene.practice_card_ids.contains("p1_receipt_reprint"));
    }

    // Break caught: an authored wrong-choice response was visible before a
    // save, but reconstructing the active P1 analysis scene dropped it.
    #[test]
    fn save_restore_preserves_authored_p1_feedback_after_incorrect_threshold_submission() {
        let (_guard, resources) = p1_feedback_resources();
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        engine
            .jump_to_scene("chapter_1", "analysis_scene_p1_5")
            .expect("P1 analysis scene should be reachable in the fixture");
        let SceneRuntime::Analysis(scene) = &mut engine.scene else {
            panic!("expected P1 analysis runtime");
        };
        for practice_card_id in [
            "p1_receipt_reprint",
            "p1_register_paper_jam",
            "p1_cctv_change",
            "p1_handwritten_ledger",
        ] {
            scene.record_practice_card(practice_card_id);
        }

        engine
            .set_analysis_selection("p1_reprint_time_board", vec!["cctv_change".into()])
            .expect("P1 CCTV card should be selectable");
        let submitted = engine
            .submit_analysis_selection("p1_reprint_time_board")
            .expect("P1 CCTV-only submission should return authored feedback");
        let ModeView::Analysis { last_feedback, .. } = submitted.mode else {
            panic!("P1 submission should remain in analysis mode");
        };
        assert_eq!(last_feedback.as_deref(), Some(P1_CCTV_FEEDBACK));

        let (original, restored) = round_trip(resources, &engine);
        let SceneRuntime::Analysis(scene) = &restored.engine.scene else {
            panic!("restored P1 scene should remain analysis");
        };
        assert_eq!(scene.last_feedback.as_deref(), Some(P1_CCTV_FEEDBACK));
        let ModeView::Analysis { last_feedback, .. } = restored
            .engine
            .view()
            .expect("restored P1 state should be viewable")
            .mode
        else {
            panic!("restored P1 state should expose analysis mode");
        };
        assert_eq!(last_feedback.as_deref(), Some(P1_CCTV_FEEDBACK));
        assert_eq!(
            capture_checkpoint(&restored.engine).unwrap().snapshot,
            original.snapshot
        );
    }

    // Break caught: restore helpers could panic on an analysis scene instead
    // of returning empty manifests/asset refs for the unsupported scene kind.
    #[test]
    fn restore_helpers_return_empty_for_analysis_scene() {
        let analysis = serde_json::from_str::<SceneJson>(include_str!(
            "../test_fixtures/analysis_scene_8_5.json"
        ))
        .expect("analysis compiler fixture must deserialize");

        assert!(evidence_manifest(&analysis).is_empty());
        assert!(statement_manifest(&analysis).is_empty());
        assert!(scene_asset_refs(&analysis).is_empty());
    }

    fn investigation_engine() -> (tempfile::TempDir, PathBuf, GameEngine) {
        let (_guard, resources, mut engine) = resources_and_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        (_guard, resources, engine)
    }

    fn interrogation_engine() -> (tempfile::TempDir, PathBuf, GameEngine) {
        let (_guard, resources, mut engine) = resources_and_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        (_guard, resources, engine)
    }

    #[test]
    fn exact_revision_and_location_are_resolved_from_the_current_package() {
        let (_guard, resources, engine) = resources_and_engine();
        for mutate in [
            |save: &mut SaveEnvelope| {
                save.content_revision =
                    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".into()
            },
            |save: &mut SaveEnvelope| save.snapshot.chapter_id = "missing_chapter".into(),
            |save: &mut SaveEnvelope| save.snapshot.scene_id = "missing_scene".into(),
            |save: &mut SaveEnvelope| {
                save.snapshot.scene = SceneProgressSnapshot::Investigation {
                    intro_played: false,
                    outro_played: false,
                    current_sublocation_id: None,
                    inspected_hotspot_ids: vec![],
                    discussed_topic_ids: vec![],
                    entered_sublocation_ids: vec![],
                    unlocked_overrides: vec![],
                    practice_card_ids: vec![],
                }
            },
        ] {
            assert_ne!(
                assert_rejected_without_live_mutation(&resources, &engine, mutate),
                ""
            );
        }
    }

    #[test]
    fn investigation_references_and_override_targets_are_closed() {
        let (_guard, resources, engine) = investigation_engine();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| {
                let SceneProgressSnapshot::Investigation {
                    current_sublocation_id,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                *current_sublocation_id = Some("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshot::Investigation {
                    inspected_hotspot_ids,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                inspected_hotspot_ids.push("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshot::Investigation {
                    entered_sublocation_ids,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                entered_sublocation_ids.push("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshot::Investigation {
                    discussed_topic_ids,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                discussed_topic_ids.push(CharacterTopicRefV1 {
                    character_id: "witness".into(),
                    topic_id: "missing".into(),
                });
            }),
            Box::new(|save| {
                let SceneProgressSnapshot::Investigation {
                    unlocked_overrides, ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                unlocked_overrides.push(InvestigationOverrideRefV1::Hotspot {
                    id: "missing".into(),
                });
            }),
        ];
        for mutate in mutations {
            assert_eq!(
                assert_rejected_without_live_mutation(&resources, &engine, mutate),
                "invalidSaveProgress"
            );
        }
    }

    #[test]
    fn interrogation_phase_question_line_and_override_references_are_closed() {
        let (_guard, resources, engine) = interrogation_engine();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| {
                let SceneProgressSnapshot::Interrogation {
                    current_phase_id, ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                *current_phase_id = Some("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshot::Interrogation {
                    broken_question_ids,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                broken_question_ids.push("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshot::Interrogation { cross_exam, .. } =
                    &mut save.snapshot.scene
                else {
                    panic!()
                };
                *cross_exam = CrossExamSnapshotV1::Playing {
                    question_id: "q1".into(),
                    line_id: "missing".into(),
                };
            }),
            Box::new(|save| {
                let SceneProgressSnapshot::Interrogation {
                    unlocked_overrides, ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                unlocked_overrides.push(InterrogationOverrideRefV1::Question {
                    id: "missing".into(),
                });
            }),
        ];
        for mutate in mutations {
            assert_eq!(
                assert_rejected_without_live_mutation(&resources, &engine, mutate),
                "invalidSaveProgress"
            );
        }
    }

    #[test]
    fn inventory_story_and_summary_references_are_revalidated() {
        let (_guard, resources, engine) = resources_and_engine();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| {
                save.snapshot
                    .inventory
                    .evidence
                    .push(EvidenceInventoryEntryV1 {
                        record_id: "missing".into(),
                        collected_in_chapter_id: "chapter_1".into(),
                        collected_in_scene_id: "investigation_scene_1".into(),
                    });
            }),
            Box::new(|save| {
                save.snapshot
                    .inventory
                    .evidence
                    .push(EvidenceInventoryEntryV1 {
                        record_id: "alibi_statement".into(),
                        collected_in_chapter_id: "chapter_1".into(),
                        collected_in_scene_id: "investigation_scene_1".into(),
                    });
            }),
            Box::new(|save| {
                save.snapshot.story_state.objectives.insert(
                    "missing".into(),
                    ObjectiveProgressSnapshot { completed: false },
                );
            }),
            Box::new(|save| save.summary.chapter_id = "wrong".into()),
            Box::new(|save| save.summary.scene_title = "wrong".into()),
            Box::new(|save| save.summary.active_primary_objective_id = Some("missing".into())),
            Box::new(|save| save.summary.chapter_summary = Some("wrong".into())),
            Box::new(|save| save.summary.scene_summary = Some("wrong".into())),
            Box::new(|save| save.summary.active_primary_objective_summary = Some("wrong".into())),
        ];
        for mutate in mutations {
            assert_ne!(
                assert_rejected_without_live_mutation(&resources, &engine, mutate),
                ""
            );
        }
    }

    #[test]
    fn story_origins_require_package_backed_ids() {
        let (_guard, resources, engine) = resources_and_engine();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| {
                save.snapshot.story_state.facts.insert(
                    "fact_origin".into(),
                    FactProgressSnapshot {
                        first_origin: AssertionOrigin::AnalysisBoard {
                            chapter_id: "chapter_1".into(),
                            scene_id: "scene_0".into(),
                            board_id: "missing_board".into(),
                        },
                        supporting_records: BTreeSet::new(),
                        supporting_fact_ids: BTreeSet::new(),
                    },
                );
            }),
            Box::new(|save| {
                save.snapshot.story_state.facts.insert(
                    "fact_origin".into(),
                    FactProgressSnapshot {
                        first_origin: AssertionOrigin::SceneEvent {
                            chapter_id: "chapter_1".into(),
                            scene_id: "scene_0".into(),
                            block_kind: StoryEventBlockKind::StoryEvent,
                            block_id: "missing_story_event".into(),
                        },
                        supporting_records: BTreeSet::new(),
                        supporting_fact_ids: BTreeSet::new(),
                    },
                );
            }),
        ];
        for mutate in mutations {
            assert_eq!(
                assert_rejected_without_live_mutation(&resources, &engine, mutate),
                "invalidStoryStateSnapshot"
            );
        }
    }

    #[test]
    fn every_accepted_assertion_origin_round_trips_through_capture_parse_and_restore() {
        use crate::game::story::{AssertionOrigin, StoryEventBlockKind};

        // Every accepted AssertionOrigin and StoryEventBlockKind must survive a
        // full capture → parse → restore → recapture cycle. This is the
        // symmetry guarantee: if mutation and capture accept an origin,
        // restore must resolve it against current packaged definitions.
        let cases: [(AssertionOrigin, &str); 6] = [
            (
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Sublocation,
                    block_id: "room".into(),
                },
                "sublocation",
            ),
            (
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Hotspot,
                    block_id: "desk".into(),
                },
                "hotspot",
            ),
            (
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Topic,
                    block_id: "witness@alibi".into(),
                },
                "topic",
            ),
            (
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "interrogation_scene_2".into(),
                    block_kind: StoryEventBlockKind::InterrogationPhase,
                    block_id: "phase_1".into(),
                },
                "interrogation phase",
            ),
            (
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "interrogation_scene_2".into(),
                    block_kind: StoryEventBlockKind::InquiryQuestion,
                    block_id: "q1".into(),
                },
                "inquiry question",
            ),
            (
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "interrogation_scene_2".into(),
                    block_kind: StoryEventBlockKind::TestimonyLine,
                    block_id: "l1".into(),
                },
                "testimony line",
            ),
        ];

        for (origin, label) in cases {
            let (_guard, resources) = save_capture_fixture_resources();
            let mut engine = GameEngine::new_started(resources.clone()).unwrap();
            engine
                .story_state
                .assert_fact(
                    &engine.story_catalog,
                    "fact_origin",
                    origin.clone(),
                    &[],
                    &[],
                )
                .unwrap_or_else(|error| {
                    panic!("assert_fact must accept {label} origin: {error:?}")
                });
            assert_round_trip(resources, &engine);
        }
    }

    #[test]
    fn pending_acquisitions_require_canonical_monotonic_event_identity() {
        let (_guard, resources, mut engine) = investigation_engine();
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "mutable".into(),
            description: "mutable".into(),
            details: "mutable".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "investigation_scene_1".into(),
        });
        engine.durable_revision = 3;
        let baseline = envelope(&engine);
        let event = |command, ordinal| AcquisitionEventStateV1 {
            id: format!("acq:{command}:{ordinal}"),
            record_kind: RecordKind::Evidence,
            record_id: "test_evidence".into(),
            created_by_command_id: command,
            ordinal,
        };
        let invalid = [
            vec![AcquisitionEventStateV1 {
                id: "wrong".into(),
                ..event(1, 0)
            }],
            vec![event(0, 0)],
            vec![event(4, 0)],
            vec![event(1, 0), event(1, 0)],
            vec![event(2, 0), event(1, 0)],
            vec![AcquisitionEventStateV1 {
                record_kind: RecordKind::Statement,
                ..event(1, 0)
            }],
        ];
        for events in invalid {
            let mut save = baseline.clone();
            save.snapshot.pending_acquisition_events = events;
            let definitions = load_current_definitions(&resources).unwrap();
            assert!(
                build_restore_candidate(resources.clone(), &definitions, save).is_err(),
                "invalid event list was accepted"
            );
        }
    }

    #[test]
    fn history_coordinates_and_generation_counters_are_revalidated() {
        let (_guard, resources, engine) = resources_and_engine();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| save.snapshot.next_queue_gen = 1),
            Box::new(|save| save.snapshot.dialogue_history.next_id = 0),
            Box::new(|save| {
                let Some(token) = save.snapshot.dialogue_history.last_token.as_mut() else {
                    panic!()
                };
                token.cursor = 0;
            }),
            Box::new(|save| {
                save.snapshot.dialogue_history.entries = vec![DialogueHistoryEntryV1::Action {
                    id: 2,
                    text: "gap".into(),
                    chapter_title: "Chapter".into(),
                    scene_title: "Scene".into(),
                }];
                save.snapshot.dialogue_history.next_id = 3;
            }),
        ];
        for mutate in mutations {
            assert_ne!(
                assert_rejected_without_live_mutation(&resources, &engine, mutate),
                ""
            );
        }
    }

    #[test]
    fn restore_validates_untrusted_history_before_reconstruction() {
        let (_guard, resources, engine) = resources_and_engine();
        let definitions = load_current_definitions(&resources).unwrap();
        let baseline = envelope(&engine);
        let active_token = engine.current_queue_token();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| {
                save.snapshot.dialogue_history.entries = (1
                    ..=(crate::game::dialogue::DIALOGUE_HISTORY_LIMIT as u64 + 1))
                    .map(|id| DialogueHistoryEntryV1::Action {
                        id,
                        text: "overflow".into(),
                        chapter_title: "Chapter".into(),
                        scene_title: "Scene".into(),
                    })
                    .collect();
                save.snapshot.dialogue_history.next_id =
                    crate::game::dialogue::DIALOGUE_HISTORY_LIMIT as u64 + 2;
            }),
            Box::new(
                |save| match save.snapshot.dialogue_history.entries.first_mut().unwrap() {
                    DialogueHistoryEntryV1::Line { id, .. }
                    | DialogueHistoryEntryV1::Action { id, .. } => *id = 0,
                },
            ),
            Box::new(|save| save.snapshot.dialogue_history.next_id += 1),
            Box::new(|save| save.snapshot.dialogue_history.last_token = None),
            Box::new(|save| {
                save.snapshot
                    .dialogue_history
                    .last_token
                    .as_mut()
                    .unwrap()
                    .queue_gen = 0;
            }),
            Box::new(|save| {
                save.snapshot
                    .dialogue_history
                    .last_token
                    .as_mut()
                    .unwrap()
                    .cursor = usize::MAX;
            }),
        ];

        for mutate in mutations {
            let mut save = baseline.clone();
            mutate(&mut save);
            assert!(
                validate_history_snapshot(
                    &definitions,
                    &save.snapshot.dialogue_history,
                    save.snapshot.next_queue_gen,
                    active_token.as_ref(),
                )
                .is_err(),
                "corrupt history passed restore-side validation"
            );
        }
    }

    #[test]
    fn restore_validates_testimony_boundary_origin_before_installing_it() {
        let (_guard, resources, _) = interrogation_engine();
        let definitions = load_current_definitions(&resources).unwrap();
        let SceneJson::Interrogation(definition) = definitions
            .scenes_by_key
            .get(&("chapter_1".into(), "interrogation_scene_2".into()))
            .unwrap()
        else {
            panic!()
        };
        let queue = ActiveDialogueQueue::from_position(
            vec![
                DialogueSegment::new(
                    interrogation_origin("question:q1:onLoop"),
                    vec![action("loop")],
                )
                .unwrap(),
                DialogueSegment::new(
                    interrogation_origin("question:q1:line:l1:content"),
                    vec![action("line")],
                )
                .unwrap(),
            ],
            1,
            0,
            6,
        )
        .unwrap();

        assert!(validate_testimony_boundary_origin(
            definition,
            &CrossExamSnapshotV1::Playing {
                question_id: "q1".into(),
                line_id: "l1".into(),
            },
            &queue,
            0,
        )
        .is_err());
    }

    #[test]
    fn first_view_does_not_duplicate_history_and_saved_token_advances_once() {
        let (_guard, resources, engine) = resources_and_engine();
        let (_, mut restored) = round_trip(resources, &engine);
        let before = capture_checkpoint(&restored.engine).unwrap();
        let saved_token = restored.engine.current_queue_token().unwrap();

        restored.engine.view().unwrap();
        restored.engine.view().unwrap();
        assert_eq!(
            capture_checkpoint(&restored.engine).unwrap(),
            before,
            "read-only first views must not append the current frame"
        );

        restored
            .engine
            .advance_dialogue(saved_token.clone())
            .unwrap();
        let after_advance = capture_checkpoint(&restored.engine).unwrap();
        let current_token = restored.engine.current_queue_token().unwrap();
        assert_ne!(current_token, saved_token);
        restored.engine.advance_dialogue(saved_token).unwrap();
        assert_eq!(
            capture_checkpoint(&restored.engine).unwrap(),
            after_advance,
            "the consumed save token must be stale and non-mutating"
        );
    }

    #[test]
    fn consumed_intro_hands_the_exact_saved_generation_to_the_next_real_queue() {
        let (_guard, resources, mut engine) = investigation_engine();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.pending_queue = None;
        scene.intro_played = true;
        scene.intro_queue_gen =
            crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN;
        scene.current_sublocation_id = Some("room".into());
        let expected_queue_gen = engine.next_queue_gen;

        let (_, mut restored) = round_trip(resources, &engine);
        restored.engine.inspect_hotspot("desk").unwrap();

        assert_eq!(
            restored.engine.current_queue_token().unwrap().queue_gen,
            expected_queue_gen
        );
    }

    #[test]
    fn linear_investigation_and_idle_interrogation_round_trip() {
        let (_guard, resources, engine) = resources_and_engine();
        assert_round_trip(resources, &engine);

        let (_guard, resources, mut engine) = investigation_engine();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.pending_queue = None;
        scene.intro_played = true;
        scene.intro_queue_gen =
            crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN;
        scene.current_sublocation_id = Some("room".into());
        assert_round_trip(resources, &engine);

        let (_guard, resources, mut engine) = interrogation_engine();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.pending_queue = None;
        scene.intro_played = true;
        scene.intro_queue_gen =
            crate::game::scenes::interrogation::RESTORED_CONSUMED_INTRO_QUEUE_GEN;
        assert_round_trip(resources, &engine);
    }

    #[test]
    fn composite_investigation_queue_inventory_story_and_events_round_trip() {
        let (_guard, resources, mut engine) = investigation_engine();
        engine.history = DialogueHistory::default();
        let SceneRuntime::Investigation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.intro_played = true;
        scene.intro_queue_gen =
            crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN;
        scene.current_sublocation_id = Some("room".into());
        scene.inspected_hotspots.insert("desk".into());
        scene
            .discussed_topics
            .insert(("witness".into(), "alibi".into()));
        scene.entered_sublocations.insert("room".into());
        scene.unlocked_overrides.insert("hotspot:desk".into());
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![
                    DialogueSegment::new(
                        DialogueSegmentOriginV1::InvestigationInteraction {
                            chapter_id: "chapter_1".into(),
                            scene_id: "investigation_scene_1".into(),
                            segment_id: "evidence:test_evidence:onCollect".into(),
                        },
                        vec![action("onCollect one"), action("onCollect two")],
                    )
                    .unwrap(),
                    DialogueSegment::new(
                        DialogueSegmentOriginV1::InvestigationInteraction {
                            chapter_id: "chapter_1".into(),
                            scene_id: "investigation_scene_1".into(),
                            segment_id: "statement:alibi_statement:onAcquire".into(),
                        },
                        vec![action("onAcquire")],
                    )
                    .unwrap(),
                ],
                0,
                1,
                8,
            )
            .unwrap(),
        );
        engine.next_queue_gen = 9;
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "mutable".into(),
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
        engine.durable_revision = 8;
        engine.pending_acquisition_events = vec![
            AcquisitionEventStateV1 {
                id: "acq:7:0".into(),
                record_kind: RecordKind::Evidence,
                record_id: "test_evidence".into(),
                created_by_command_id: 7,
                ordinal: 0,
            },
            AcquisitionEventStateV1 {
                id: "acq:8:0".into(),
                record_kind: RecordKind::Statement,
                record_id: "alibi_statement".into(),
                created_by_command_id: 8,
                ordinal: 0,
            },
        ];
        engine
            .story_state
            .reveal_objective(&engine.story_catalog, "objective_truth")
            .unwrap();
        engine
            .story_state
            .set_primary_objective(&engine.story_catalog, false, Some("objective_truth"))
            .unwrap();

        assert_round_trip(resources, &engine);
    }

    #[test]
    fn playing_and_presenting_cross_exam_round_trip_exactly() {
        for presenting in [false, true] {
            let (_guard, resources, mut engine) = interrogation_engine();
            engine.history = DialogueHistory::default();
            let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
                panic!()
            };
            scene.intro_played = true;
            scene.intro_queue_gen =
                crate::game::scenes::interrogation::RESTORED_CONSUMED_INTRO_QUEUE_GEN;
            scene.mark_phase_entered("phase_1");
            scene.cross_exam = if presenting {
                CrossExam::Presenting {
                    question_id: "q1".into(),
                    line_id: "l1".into(),
                }
            } else {
                CrossExam::Playing {
                    question_id: "q1".into(),
                    line_index: 0,
                }
            };
            if presenting {
                // The challenge lead-in has drained and the evidence tray is
                // the active public mode; there is no dialogue queue to replay.
                scene.pending_queue = None;
                scene.line_content_start = 0;
            } else {
                scene.pending_queue = Some(
                    ActiveDialogueQueue::from_position(
                        vec![DialogueSegment::new(
                            interrogation_origin("question:q1:line:l1:content"),
                            vec![DialogueItem::Line {
                                speaker: "witness".into(),
                                text: "line".into(),
                                portrait: None,
                            }],
                        )
                        .unwrap()],
                        0,
                        0,
                        6,
                    )
                    .unwrap(),
                );
                scene.line_content_start = 0;
            }
            engine.next_queue_gen = 7;
            let expected_cross_exam = scene.cross_exam.clone();

            let (_, restored) = round_trip(resources, &engine);
            let view = restored.engine.view().unwrap();
            let SceneRuntime::Interrogation(restored_scene) = &restored.engine.scene else {
                panic!()
            };
            assert_eq!(restored_scene.cross_exam, expected_cross_exam);
            if presenting {
                let crate::game::view::SceneView::Interrogation { visible_phases, .. } = view.scene
                else {
                    panic!("expected interrogation view");
                };
                assert!(visible_phases
                    .into_iter()
                    .find(|phase| phase.id == "phase_1")
                    .and_then(|phase| phase.cross_exam)
                    .is_some_and(|cross_exam| {
                        cross_exam.presenting
                            && cross_exam.question_id == "q1"
                            && cross_exam.line_id == "l1"
                    }));
            } else {
                assert!(matches!(view.mode, ModeView::Dialogue { .. }));
            }
        }
    }

    #[test]
    fn game_complete_retains_the_final_scene_sentinel() {
        let (_guard, resources, mut engine) = interrogation_engine();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.pending_queue = None;
        scene.intro_played = true;
        scene.outro_played = true;
        engine.current_chapter_idx = engine.chapters.len();
        engine.current_scene_idx = 0;
        engine.history = DialogueHistory::default();
        assert_round_trip(resources, &engine);
    }

    #[test]
    fn authoritative_audio_cues_and_explicit_silence_round_trip() {
        let (_guard, resources, mut engine) = resources_and_engine();
        engine.last_visual_cue.bgm = Some(AudioCueJson {
            channel: AudioChannelJson::Bgm,
            asset_id: Some("bgm.rain".into()),
        });
        engine.last_visual_cue.bgs = Some(AudioCueJson {
            channel: AudioChannelJson::Bgs,
            asset_id: Some("bgs.room".into()),
        });
        assert_round_trip(resources.clone(), &engine);

        engine.last_visual_cue.bgm = Some(AudioCueJson {
            channel: AudioChannelJson::Bgm,
            asset_id: None,
        });
        engine.last_visual_cue.bgs = Some(AudioCueJson {
            channel: AudioChannelJson::Bgs,
            asset_id: None,
        });
        assert_round_trip(resources, &engine);
    }

    #[test]
    fn visual_and_audio_cues_must_resolve_and_match_their_channels() {
        let (_guard, resources, engine) = resources_and_engine();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| {
                save.snapshot.last_visual_cue.background_asset_id = Some("missing".into())
            }),
            Box::new(|save| {
                save.snapshot.last_visual_cue.bgm = Some(AudioCueSnapshotV1 {
                    channel: AudioChannelJson::Bgm,
                    asset_id: Some("missing".into()),
                })
            }),
            Box::new(|save| {
                save.snapshot.last_visual_cue.bgm = Some(AudioCueSnapshotV1 {
                    channel: AudioChannelJson::Bgs,
                    asset_id: None,
                })
            }),
        ];
        for mutate in mutations {
            assert_ne!(
                assert_rejected_without_live_mutation(&resources, &engine, mutate),
                ""
            );
        }
    }

    #[test]
    fn populated_story_state_round_trips_through_capture_and_restore() {
        let (_guard, resources, mut engine) = resources_and_engine();
        // Assert a supporting fact first so it can be referenced by fact_origin.
        engine
            .story_state
            .assert_fact(
                &engine.story_catalog,
                "fact_supporting",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Hotspot,
                    block_id: "desk".into(),
                },
                &[],
                &[],
            )
            .unwrap();
        // Assert the primary fact with supporting records (both Evidence and
        // Statement) and a supporting fact id, exercising every conversion arm.
        engine
            .story_state
            .assert_fact(
                &engine.story_catalog,
                "fact_origin",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Topic,
                    block_id: "witness@alibi".into(),
                },
                &[
                    InventoryTarget::Evidence {
                        id: "test_evidence".into(),
                    },
                    InventoryTarget::Statement {
                        id: "alibi_statement".into(),
                    },
                ],
                &["fact_supporting".into()],
            )
            .unwrap();
        engine
            .story_state
            .reveal_question(&engine.story_catalog, "question_open")
            .unwrap();
        engine
            .story_state
            .resolve_question(&engine.story_catalog, "question_open", "fact_origin")
            .unwrap();
        engine
            .story_state
            .reveal_objective(&engine.story_catalog, "objective_truth")
            .unwrap();
        engine
            .story_state
            .set_primary_objective(&engine.story_catalog, false, Some("objective_truth"))
            .unwrap();
        engine
            .story_state
            .grant_authorization(
                &engine.story_catalog,
                "authorization_scene",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Sublocation,
                    block_id: "room".into(),
                },
            )
            .unwrap();

        assert_round_trip(resources, &engine);
    }

    // Break caught: the save parser accepts a redundant persisted location
    // even though firstOrigin already owns the authoritative scene location.
    #[test]
    fn save_parser_rejects_redundant_story_origin_locations() {
        let (_guard, _resources, mut engine) = resources_and_engine();
        engine
            .story_state
            .assert_fact(
                &engine.story_catalog,
                "fact_origin",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Hotspot,
                    block_id: "desk".into(),
                },
                &[],
                &[],
            )
            .unwrap();

        let mut encoded = serde_json::to_value(envelope(&engine)).unwrap();
        let fact = encoded["snapshot"]["storyState"]["facts"]["fact_origin"]
            .as_object_mut()
            .unwrap();
        fact.insert("assertedInChapterId".into(), serde_json::json!("chapter_1"));
        fact.insert(
            "assertedInSceneId".into(),
            serde_json::json!("investigation_scene_1"),
        );

        let error = crate::game::save::schema::parse_current_envelope(
            &serde_json::to_vec(&encoded).unwrap(),
        )
        .unwrap_err();
        assert_eq!(error.code, "malformedSaveJson");
    }

    // Break caught: successful HPA-257 progress restores the static package
    // but loses a positive story fact, consumed trigger, active primary, or a
    // later nested-threshold unlock.
    #[test]
    fn hpa_257_save_reconstruct_restore_preserves_public_and_internal_progress() {
        let (_guard, resources) = hpa_257_fixture_resources();
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        drive_hpa_257_positive_progression(&mut engine);

        let original_view = serde_json::to_value(engine.view().unwrap()).unwrap();
        let original_checkpoint = capture_checkpoint(&engine).unwrap();
        let original_story = engine.story_state.snapshot();
        let original_trigger_snapshot = original_checkpoint.snapshot.scene.clone();

        let (saved, mut restored) = round_trip(resources, &engine);

        assert_eq!(saved.schema_version, 2);
        assert_eq!(
            serde_json::to_value(restored.engine.view().unwrap()).unwrap(),
            original_view,
            "restore must reproduce the exact public state"
        );
        assert_eq!(
            restored.engine.story_state.snapshot(),
            original_story,
            "story progress must be restored through the existing snapshot"
        );
        let recaptured = capture_checkpoint(&restored.engine).unwrap();
        assert_eq!(recaptured.snapshot, original_checkpoint.snapshot);
        assert_eq!(recaptured.snapshot.scene, original_trigger_snapshot);

        let story_before_reinspect = restored.engine.story_state.snapshot();
        let trigger_before_reinspect = recaptured.snapshot.scene;
        restored.engine.inspect_hotspot("evidence").unwrap();
        assert_eq!(
            restored.engine.story_state.snapshot(),
            story_before_reinspect,
            "the consumed evidence trigger must not redispatch story progress"
        );
        assert_eq!(
            capture_checkpoint(&restored.engine).unwrap().snapshot.scene,
            trigger_before_reinspect,
            "reinspection must not consume a second trigger"
        );
    }

    // Break caught: the runtime incorrectly accepts the concrete A-before-B
    // order that the compiler's same-current/next synthetic fixture marks
    // invalid.
    #[test]
    fn hpa_257_runtime_free_order_a_before_b_is_invalid() {
        let (_guard, resources) = hpa_257_fixture_resources();
        let mut engine = GameEngine::new_started(resources).unwrap();
        engine.enter_sublocation("free_order").unwrap();
        engine.inspect_hotspot("order_a").unwrap();
        let before_b = capture_checkpoint(&engine).unwrap();

        let error = engine.inspect_hotspot("order_b").unwrap_err();

        assert_eq!(error.code, "invalidPrimaryObjectiveTransition");
        assert_eq!(capture_checkpoint(&engine).unwrap(), before_b);
    }

    // Break caught: the runtime rejects the concrete B-before-A order even
    // though there is no current primary to complete when B first runs.
    #[test]
    fn hpa_257_runtime_free_order_b_before_a_is_valid() {
        let (_guard, resources) = hpa_257_fixture_resources();
        let mut engine = GameEngine::new_started(resources).unwrap();
        engine.enter_sublocation("free_order").unwrap();

        engine.inspect_hotspot("order_b").unwrap();
        engine.inspect_hotspot("order_a").unwrap();

        let snapshot = engine.story_state.snapshot();
        assert_eq!(
            snapshot.active_primary_objective_id.as_deref(),
            Some("primary_a")
        );
        assert!(!snapshot.objectives["primary_a"].completed);
        let SceneRuntime::Investigation(scene) = &engine.scene else {
            panic!("expected HPA-257 investigation scene")
        };
        assert!(scene.inspected_hotspots.contains("order_a"));
        assert!(scene.inspected_hotspots.contains("order_b"));
    }

    #[test]
    fn provenance_chain_groups_and_support_lineage_rejoin_from_packaged_definitions() {
        let (_guard, resources) = provenance_save_fixture_resources();
        let mut engine = GameEngine::new_started(resources.clone()).unwrap();
        let SceneJson::Investigation(scene) = engine
            .packaged_acquisition_scene("chapter_1", "investigation_scene_1")
            .unwrap()
        else {
            panic!("expected investigation fixture")
        };
        let definition = |id: &str| {
            scene
                .evidence_manifest
                .iter()
                .find(|definition| definition.id == id)
                .unwrap()
                .clone()
        };
        let lead = definition("chain_lead");
        let reacquired = definition("chain_reacquired");
        let exhibit = definition("chain_exhibit");
        assert!(engine.inventory.add_evidence_from_def(
            &lead,
            "chapter_1",
            "investigation_scene_1",
        ));
        assert!(engine.inventory.add_evidence_from_def(
            &exhibit,
            "chapter_1",
            "investigation_scene_1",
        ));
        engine
            .story_state
            .assert_fact(
                &engine.story_catalog,
                "fact_supporting",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Hotspot,
                    block_id: "desk".into(),
                },
                &[InventoryTarget::Statement {
                    id: "witness_support".into(),
                }],
                &[],
            )
            .unwrap();
        engine
            .story_state
            .assert_fact(
                &engine.story_catalog,
                "fact_origin",
                AssertionOrigin::SceneEvent {
                    chapter_id: "chapter_1".into(),
                    scene_id: "investigation_scene_1".into(),
                    block_kind: StoryEventBlockKind::Topic,
                    block_id: "witness@alibi".into(),
                },
                &[InventoryTarget::Evidence {
                    id: "chain_exhibit".into(),
                }],
                &["fact_supporting".into()],
            )
            .unwrap();
        let original = capture_checkpoint(&engine).unwrap();
        let original_inventory = engine.inventory.clone();
        let definitions = load_current_definitions(&resources).unwrap();
        let encoded =
            serde_json::to_vec(&envelope_from_checkpoint(&engine, original.clone())).unwrap();
        let parsed = crate::game::save::schema::parse_current_envelope(&encoded).unwrap();

        let mut restored = build_restore_candidate(resources, &definitions, parsed).unwrap();

        assert_eq!(restored.engine.inventory, original_inventory);
        assert_eq!(
            restored
                .engine
                .story_catalog
                .chain(&InventoryTarget::Evidence {
                    id: "chain_exhibit".into(),
                })
                .unwrap(),
            vec![
                InventoryTarget::Evidence {
                    id: "chain_lead".into(),
                },
                InventoryTarget::Evidence {
                    id: "chain_reacquired".into(),
                },
                InventoryTarget::Evidence {
                    id: "chain_exhibit".into(),
                },
            ]
        );
        assert_eq!(
            restored
                .engine
                .story_catalog
                .source_group("video_versions")
                .unwrap()
                .members,
            BTreeSet::from([
                InventoryTarget::Evidence {
                    id: "chain_lead".into(),
                },
                InventoryTarget::Evidence {
                    id: "chain_reacquired".into(),
                },
                InventoryTarget::Evidence {
                    id: "chain_exhibit".into(),
                },
            ])
        );
        let lineage =
            SupportLineage::new(&restored.engine.story_catalog, &restored.engine.story_state);
        assert_eq!(
            lineage.direct_records("fact_origin").unwrap(),
            BTreeSet::from([InventoryTarget::Evidence {
                id: "chain_exhibit".into(),
            }])
        );
        assert_eq!(
            lineage.transitive_records("fact_origin").unwrap(),
            BTreeSet::from([
                InventoryTarget::Evidence {
                    id: "chain_exhibit".into(),
                },
                InventoryTarget::Statement {
                    id: "witness_support".into(),
                },
            ])
        );
        assert_eq!(
            lineage
                .transitive_source_group_closure("fact_origin")
                .unwrap()
                .groups,
            BTreeSet::from(["video_versions".into(), "witness_accounts".into()])
        );
        assert_eq!(
            capture_checkpoint(&restored.engine).unwrap(),
            original,
            "definition rejoin must preserve exact recapture"
        );

        let redacted = restored.engine.view().unwrap();
        assert_eq!(
            redacted
                .inventory
                .evidence
                .iter()
                .find(|record| record.id == "chain_exhibit")
                .unwrap()
                .provenance
                .supersedes_record_id,
            None
        );
        assert!(
            redacted
                .story
                .facts
                .iter()
                .find(|fact| fact.id == "fact_supporting")
                .unwrap()
                .supporting_records
                .is_empty(),
            "unacquired statement support must stay internal"
        );
        assert!(restored.engine.inventory.add_evidence_from_def(
            &reacquired,
            "chapter_1",
            "investigation_scene_1",
        ));
        assert_eq!(
            restored
                .engine
                .view()
                .unwrap()
                .inventory
                .evidence
                .iter()
                .find(|record| record.id == "chain_exhibit")
                .unwrap()
                .provenance
                .supersedes_record_id
                .as_deref(),
            Some("evidence:chain_reacquired")
        );
    }

    #[test]
    fn current_definition_loading_rejects_scene_catalog_provenance_drift() {
        let (_guard, resources) = provenance_save_fixture_resources();
        let engine = GameEngine::new_started(resources.clone()).unwrap();
        let checkpoint = capture_checkpoint(&engine).unwrap();
        let save = envelope_from_checkpoint(&engine, checkpoint);
        let scene_path = resources.join("chapter_1/investigation_scene_1.json");
        let mut scene: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&scene_path).unwrap()).unwrap();
        scene["evidenceManifest"][0]["provenance"]["confidence"] = serde_json::json!("disputed");
        std::fs::write(&scene_path, serde_json::to_vec_pretty(&scene).unwrap()).unwrap();

        let error = match load_current_definitions(&resources) {
            Ok(_) => panic!("corrupt scene definitions must not be installed"),
            Err(error) => error,
        };

        assert_eq!(save.content_revision, engine.content_revision());
        assert_eq!(error.code, "caseRecordDefinitionMismatch");
    }

    #[test]
    fn current_definition_loading_rejects_catalog_record_omitted_from_owning_scene() {
        let (_guard, resources) = provenance_save_fixture_resources();
        let engine = GameEngine::new_started(resources.clone()).unwrap();
        let checkpoint = capture_checkpoint(&engine).unwrap();
        let save = envelope_from_checkpoint(&engine, checkpoint);
        let scene_path = resources.join("chapter_1/investigation_scene_1.json");
        let mut scene: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&scene_path).unwrap()).unwrap();
        scene["statementManifest"]
            .as_array_mut()
            .unwrap()
            .retain(|definition| definition["id"] != "witness_support");
        std::fs::write(&scene_path, serde_json::to_vec_pretty(&scene).unwrap()).unwrap();

        let error = match load_current_definitions(&resources) {
            Ok(definitions) => {
                let candidate =
                    build_restore_candidate(resources.clone(), &definitions, save.clone()).unwrap();
                panic!(
                    "catalog-only record reached candidate installation: {:?}",
                    candidate
                )
            }
            Err(error) => error,
        };

        assert_eq!(save.content_revision, engine.content_revision());
        assert_eq!(error.code, "caseRecordDefinitionMismatch");
    }

    #[test]
    fn current_definition_loading_rejects_catalog_record_with_unmanifested_origin() {
        let (_guard, resources) = provenance_save_fixture_resources();
        let catalog_path = resources.join("story_catalog.json");
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&catalog_path).unwrap()).unwrap();
        catalog["evidenceIndex"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "orphaned_record",
                "chapterId": "chapter_1",
                "sceneId": "missing_scene",
                "provenance": {
                    "sourceKind": "unspecified",
                    "representationLayer": "none",
                    "proceduralStatus": "unspecified",
                    "completeness": "unspecified",
                    "confidence": "unspecified",
                    "sourceGroupId": null,
                    "sourceLabel": null,
                    "proofCapabilities": [],
                    "supersedesRecordId": null
                }
            }));
        std::fs::write(&catalog_path, serde_json::to_vec_pretty(&catalog).unwrap()).unwrap();

        let error = match load_current_definitions(&resources) {
            Ok(_) => panic!("orphaned catalog origin reached candidate construction"),
            Err(error) => error,
        };

        assert_eq!(error.code, "caseRecordDefinitionMismatch");
    }

    #[test]
    fn debug_impl_does_not_leak_internal_engine_fields() {
        let (_guard, resources, engine) = resources_and_engine();
        let (_, restored) = round_trip(resources, &engine);
        let debug = format!("{:?}", restored);
        assert!(debug.contains("RestoredGameCandidate"));
        assert!(debug.contains("source"));
        assert!(debug.contains("save_id"));
        assert!(debug.contains("durable_revision"));
        assert!(!debug.contains("engine"));
        assert!(!debug.contains("story_state"));
    }

    #[test]
    fn build_restore_candidate_rejects_a_resources_dir_mismatch() {
        let (_guard, resources, engine) = resources_and_engine();
        let original = envelope(&engine);
        let definitions = load_current_definitions(&resources).unwrap();
        let wrong_dir = resources.join("does_not_exist");
        let error = build_restore_candidate(wrong_dir, &definitions, original).unwrap_err();
        assert_eq!(error.code, "saveDiscoveryUnavailable");
    }

    #[test]
    fn restore_rejects_game_complete_that_does_not_retain_the_final_scene() {
        let (_guard, resources, engine) = resources_and_engine();
        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            save.snapshot.scene = SceneProgressSnapshot::GameComplete;
        });
        assert_eq!(code, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_line_content_segment_index_without_an_active_queue() {
        let (_guard, resources, engine) = interrogation_engine();
        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            save.snapshot.active_dialogue = None;
            let SceneProgressSnapshot::Interrogation {
                line_content_segment_index,
                ..
            } = &mut save.snapshot.scene
            else {
                panic!()
            };
            *line_content_segment_index = Some(0);
        });
        assert_eq!(code, "invalidSaveCursor");
    }

    #[test]
    fn restore_rejects_testimony_boundary_with_idle_cross_exam() {
        // Start from a valid playing cross-exam engine so capture succeeds,
        // then mutate the save to flip cross_exam to Idle while keeping the
        // line_content_segment_index.
        let (_guard, resources, mut engine) = interrogation_engine();
        let SceneRuntime::Interrogation(scene) = &mut engine.scene else {
            panic!()
        };
        scene.intro_played = true;
        scene.intro_queue_gen =
            crate::game::scenes::interrogation::RESTORED_CONSUMED_INTRO_QUEUE_GEN;
        scene.mark_phase_entered("phase_1");
        scene.cross_exam = CrossExam::Playing {
            question_id: "q1".into(),
            line_index: 0,
        };
        scene.pending_queue = Some(
            ActiveDialogueQueue::from_position(
                vec![DialogueSegment::new(
                    interrogation_origin("question:q1:line:l1:content"),
                    vec![DialogueItem::Line {
                        speaker: "witness".into(),
                        text: "line".into(),
                        portrait: None,
                    }],
                )
                .unwrap()],
                0,
                0,
                6,
            )
            .unwrap(),
        );
        scene.line_content_start = 0;
        engine.next_queue_gen = 7;
        engine.durable_revision = 3;

        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            let SceneProgressSnapshot::Interrogation { cross_exam, .. } = &mut save.snapshot.scene
            else {
                panic!()
            };
            *cross_exam = CrossExamSnapshotV1::Idle;
        });
        assert_eq!(code, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_duplicate_evidence_and_statement_inventory() {
        let (_guard, resources, mut engine) = investigation_engine();
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "first".into(),
            description: "first".into(),
            details: "first".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "investigation_scene_1".into(),
        });
        engine.inventory.statements.push(StatementRecord {
            id: "alibi_statement".into(),
            speaker: "first".into(),
            content: "first".into(),
            provenance: crate::game::provenance::CaseRecordProvenance::default(),
            on_reexamine: None,
            acquired_in_chapter_id: "chapter_1".into(),
            acquired_in_scene_id: "investigation_scene_1".into(),
        });

        let dup_evidence = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            save.snapshot
                .inventory
                .evidence
                .push(EvidenceInventoryEntryV1 {
                    record_id: "test_evidence".into(),
                    collected_in_chapter_id: "chapter_1".into(),
                    collected_in_scene_id: "investigation_scene_1".into(),
                });
        });
        assert_eq!(dup_evidence, "invalidSaveProgress");

        let dup_statement = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            save.snapshot
                .inventory
                .statements
                .push(StatementInventoryEntryV1 {
                    record_id: "alibi_statement".into(),
                    acquired_in_chapter_id: "chapter_1".into(),
                    acquired_in_scene_id: "investigation_scene_1".into(),
                });
        });
        assert_eq!(dup_statement, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_history_next_id_zero() {
        let (_guard, resources, engine) = resources_and_engine();
        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            save.snapshot.dialogue_history.next_id = 0;
            save.snapshot.dialogue_history.entries.clear();
            save.snapshot.dialogue_history.last_token = None;
        });
        assert_eq!(code, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_empty_history_with_non_initial_next_id() {
        let (_guard, resources, engine) = resources_and_engine();
        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            save.snapshot.dialogue_history.next_id = 5;
            save.snapshot.dialogue_history.entries.clear();
            save.snapshot.dialogue_history.last_token = None;
        });
        assert_eq!(code, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_cross_exam_playing_without_current_phase() {
        let (_guard, resources, engine) = interrogation_engine();
        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            let SceneProgressSnapshot::Interrogation {
                current_phase_id,
                cross_exam,
                ..
            } = &mut save.snapshot.scene
            else {
                panic!()
            };
            *current_phase_id = None;
            *cross_exam = CrossExamSnapshotV1::Playing {
                question_id: "q1".into(),
                line_id: "l1".into(),
            };
        });
        assert_eq!(code, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_interrogation_override_with_missing_phase() {
        let (_guard, resources, engine) = interrogation_engine();
        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            let SceneProgressSnapshot::Interrogation {
                unlocked_overrides, ..
            } = &mut save.snapshot.scene
            else {
                panic!()
            };
            unlocked_overrides.push(InterrogationOverrideRefV1::Phase {
                id: "missing_phase".into(),
            });
        });
        assert_eq!(code, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_investigation_override_with_missing_sublocation_and_topic() {
        let (_guard, resources, engine) = investigation_engine();
        let sublocation_code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            let SceneProgressSnapshot::Investigation {
                unlocked_overrides, ..
            } = &mut save.snapshot.scene
            else {
                panic!()
            };
            unlocked_overrides.push(InvestigationOverrideRefV1::Sublocation {
                id: "missing_sub".into(),
            });
        });
        assert_eq!(sublocation_code, "invalidSaveProgress");

        let topic_code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            let SceneProgressSnapshot::Investigation {
                unlocked_overrides, ..
            } = &mut save.snapshot.scene
            else {
                panic!()
            };
            unlocked_overrides.push(InvestigationOverrideRefV1::Topic {
                character_id: "missing_char".into(),
                topic_id: "missing_topic".into(),
            });
        });
        assert_eq!(topic_code, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_noncontiguous_history_entry_ids() {
        let (_guard, resources, engine) = resources_and_engine();
        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            save.snapshot.dialogue_history.entries = vec![
                DialogueHistoryEntryV1::Action {
                    id: 1,
                    text: "first".into(),
                    chapter_title: "Chapter One".into(),
                    scene_title: "Opening".into(),
                },
                DialogueHistoryEntryV1::Action {
                    id: 3,
                    text: "third".into(),
                    chapter_title: "Chapter One".into(),
                    scene_title: "Opening".into(),
                },
            ];
            save.snapshot.dialogue_history.next_id = 4;
            save.snapshot.dialogue_history.last_token = None;
        });
        assert_eq!(code, "invalidSaveProgress");
    }

    #[test]
    fn restore_rejects_history_token_presence_without_entries() {
        let (_guard, resources, engine) = resources_and_engine();
        let code = assert_rejected_without_live_mutation(&resources, &engine, |save| {
            save.snapshot.dialogue_history.entries.clear();
            save.snapshot.dialogue_history.last_token = Some(QueueToken {
                scene_id: "scene_0".into(),
                queue_gen: 1,
                cursor: 1,
            });
            save.snapshot.dialogue_history.next_id = 1;
        });
        assert_eq!(code, "invalidSaveProgress");
    }
}
