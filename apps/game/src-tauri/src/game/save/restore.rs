use super::capture::{capture_checkpoint_v1, CapturedCheckpointV1};
use super::schema::{
    AcquisitionEventStateV1, AudioCueSnapshotV1, AuthorizationProgressSnapshotV1,
    CrossExamSnapshotV1, DialogueHistoryEntryV1, DialogueHistorySnapshotV1, FactProgressSnapshotV1,
    InventorySnapshotV1, InventoryTargetV1, LastVisualCueSnapshotV1, ObjectiveProgressSnapshotV1,
    QuestionProgressSnapshotV1, RecordKind, SaveEnvelopeV1, SaveSlotRef, SaveType,
    SceneProgressSnapshotV1, StoryStateSnapshotV1,
};
use crate::game::content_manifest::ContentManifest;
use crate::game::dialogue::DialogueHistory;
use crate::game::dialogue_queue::{
    resolve_dialogue_segments, ActiveDialogueQueue, ActiveDialogueStateV1, DialogueSegment,
    DialogueSegmentOriginV1,
};
use crate::game::navigation::{
    load_chapter_manifests, load_chapter_scene_jsons, scene_json_identity,
};
use crate::game::scenes::interrogation::{CrossExam, InterrogationSceneState};
use crate::game::scenes::investigation::InvestigationSceneState;
use crate::game::scenes::linear::LinearSceneState;
use crate::game::scenes::SceneRuntime;
use crate::game::schema::{
    AssetTypeJson, AudioChannelJson, AudioCueJson, InterrogationPhaseJson, InterrogationSceneJson,
    InventoryTarget, InvestigationSceneJson, SceneJson,
};
use crate::game::state::{ChapterManifest, Inventory};
use crate::game::story::{
    AssertionOrigin, AuthorizationProgressSnapshot, FactProgressSnapshot,
    ObjectiveProgressSnapshot, QuestionProgressSnapshot, StoryCatalog, StoryEventBlockKind,
    StoryState, StoryStateSnapshot,
};
use crate::game::view::DialogueHistoryEntry;
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
    pub(crate) content_manifest: ContentManifest,
    pub(crate) chapters: Vec<ChapterManifest>,
    pub(crate) story_catalog: StoryCatalog,
    pub(crate) scenes_by_key: BTreeMap<(String, String), SceneJson>,
    pub(crate) semantic_asset_ids: BTreeSet<String>,
    pub(crate) semantic_audio_ids: BTreeSet<String>,
}

pub(crate) trait ResumableStateAdapter: Sized {
    type Snapshot;

    fn capture(&self) -> Self::Snapshot;
    fn restore(
        definitions: &CurrentDefinitions,
        snapshot: Self::Snapshot,
    ) -> Result<Self, GameError>;
}

impl ResumableStateAdapter for StoryState {
    type Snapshot = StoryStateSnapshotV1;

    fn capture(&self) -> Self::Snapshot {
        story_snapshot_to_v1(self.snapshot())
    }

    fn restore(
        definitions: &CurrentDefinitions,
        snapshot: Self::Snapshot,
    ) -> Result<Self, GameError> {
        validate_story_origins(definitions, &snapshot)?;
        StoryState::from_snapshot(&definitions.story_catalog, story_snapshot_from_v1(snapshot))
    }
}

pub(crate) fn load_current_definitions(
    resources_dir: &Path,
) -> Result<CurrentDefinitions, GameError> {
    let content_manifest = ContentManifest::load(resources_dir)?;
    let chapters = load_chapter_manifests(resources_dir)?;
    let story_catalog = StoryCatalog::load(resources_dir)?;
    let mut scenes_by_key = BTreeMap::new();
    let mut semantic_asset_ids = BTreeSet::new();
    let mut semantic_audio_ids = BTreeSet::new();

    for chapter in &chapters {
        let scenes = load_chapter_scene_jsons(resources_dir, chapter)?;
        if scenes.len() != chapter.scenes.len() {
            return Err(GameError::missing_save_definition());
        }
        for scene in scenes {
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

    Ok(CurrentDefinitions {
        content_manifest,
        chapters,
        story_catalog,
        scenes_by_key,
        semantic_asset_ids,
        semantic_audio_ids,
    })
}

pub(crate) fn build_restore_candidate(
    resources_dir: PathBuf,
    definitions: &CurrentDefinitions,
    envelope: SaveEnvelopeV1,
) -> Result<RestoredGameCandidate, GameError> {
    // The caller normally obtained this value through version dispatch, but a
    // typed Rust value is not trusted either: validate the complete envelope
    // boundary again before using any field.
    let encoded = serde_json::to_vec(&envelope).map_err(|_| GameError::malformed_save_json())?;
    let envelope = super::schema::parse_current_envelope(&encoded)?;
    let packaged_revision = definitions.content_manifest.content_revision();
    let resources_revision = ContentManifest::load(&resources_dir)?;
    if resources_revision.content_revision() != packaged_revision {
        return Err(GameError::incompatible_content_revision(
            resources_revision.content_revision(),
            packaged_revision,
        ));
    }
    if envelope.content_revision != packaged_revision {
        return Err(GameError::incompatible_content_revision(
            &envelope.content_revision,
            packaged_revision,
        ));
    }

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
    let scene_index = packaged_scene_index(&resources_dir, chapter, &snapshot.scene_id)?;

    validate_visual_cues(definitions, &snapshot.last_visual_cue)?;
    let story_state = StoryState::restore(definitions, snapshot.story_state.clone())?;
    let inventory = restore_inventory(definitions, &snapshot.inventory)?;
    validate_pending_events(
        &inventory,
        &snapshot.pending_acquisition_events,
        snapshot.durable_revision,
    )?;
    let history = restore_history(&snapshot.dialogue_history);
    let active_queue = snapshot
        .active_dialogue
        .as_ref()
        .map(|active| restore_active_queue(definitions, active, snapshot.next_queue_gen))
        .transpose()?;
    let scene = restore_scene(
        &snapshot.chapter_id,
        packaged_scene,
        &snapshot.scene,
        active_queue,
        snapshot.active_dialogue.as_ref(),
    )?;

    let completed = matches!(snapshot.scene, SceneProgressSnapshotV1::GameComplete);
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
    let engine = GameEngine {
        resources_dir,
        content_manifest: definitions.content_manifest.clone(),
        chapters: definitions.chapters.clone(),
        story_catalog: definitions.story_catalog.clone(),
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
    };

    // The capture boundary is intentionally independent from restore. Re-run
    // its exhaustive invariants on the detached candidate and demand exact
    // equality so duplicate IDs, reordered coordinates, or normalization
    // cannot be smuggled through reconstruction.
    let CapturedCheckpointV1 {
        summary: recaptured_summary,
        snapshot: recaptured_snapshot,
    } = capture_checkpoint_v1(&engine).map_err(|error| {
        invalid_progress(format!("Restored candidate is invalid: {}", error.message))
    })?;
    if recaptured_snapshot != envelope.snapshot {
        return Err(invalid_progress(
            "Restored candidate does not recapture to the exact saved snapshot.",
        ));
    }
    if recaptured_summary != envelope.summary {
        return Err(invalid_progress(
            "Save summary does not match the restored packaged state.",
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

fn packaged_scene_index(
    resources_dir: &Path,
    chapter: &ChapterManifest,
    scene_id: &str,
) -> Result<usize, GameError> {
    let mut found = None;
    for (index, scene) in load_chapter_scene_jsons(resources_dir, chapter)?
        .iter()
        .enumerate()
    {
        if scene_json_identity(scene).0 == scene_id {
            if found.is_some() {
                return Err(invalid_progress(format!(
                    "Packaged scene identity '{}/{}' is ambiguous.",
                    chapter.id, scene_id
                )));
            }
            found = Some(index);
        }
    }
    found.ok_or_else(GameError::missing_save_definition)
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
    progress: &SceneProgressSnapshotV1,
    active_queue: Option<ActiveDialogueQueue>,
    active_snapshot: Option<&ActiveDialogueStateV1>,
) -> Result<SceneRuntime, GameError> {
    match (packaged, progress) {
        (SceneJson::Linear(definition), SceneProgressSnapshotV1::Linear) => {
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
            SceneProgressSnapshotV1::Investigation {
                intro_played,
                outro_played,
                current_sublocation_id,
                inspected_hotspot_ids,
                discussed_topic_ids,
                entered_sublocation_ids,
                unlocked_overrides,
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
            Ok(SceneRuntime::Investigation(Box::new(scene)))
        }
        (
            SceneJson::Interrogation(definition),
            SceneProgressSnapshotV1::Interrogation {
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
                (Some(queue), Some(index)) => queue
                    .flattened_segment_boundary(*index)
                    .map_err(|_| GameError::invalid_save_cursor())?,
                (Some(queue), None) => queue
                    .flattened_len()
                    .map_err(|_| GameError::invalid_save_cursor())?,
                (None, Some(_)) => return Err(GameError::invalid_save_cursor()),
                (None, None) => 0,
            };
            scene.pending_queue = active_queue;
            Ok(SceneRuntime::Interrogation(Box::new(scene)))
        }
        (SceneJson::Interrogation(definition), SceneProgressSnapshotV1::GameComplete) => {
            let mut scene = InterrogationSceneState::from_json(
                definition.clone(),
                crate::game::scenes::interrogation::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
            );
            scene.intro_played = true;
            scene.outro_played = true;
            scene.pending_queue = None;
            Ok(SceneRuntime::Interrogation(Box::new(scene)))
        }
        (SceneJson::Investigation(definition), SceneProgressSnapshotV1::GameComplete) => {
            let mut scene = InvestigationSceneState::from_json(
                definition.clone(),
                crate::game::scenes::investigation::RESTORED_CONSUMED_INTRO_QUEUE_GEN,
            );
            scene.intro_played = true;
            scene.outro_played = true;
            scene.pending_queue = None;
            Ok(SceneRuntime::Investigation(Box::new(scene)))
        }
        (SceneJson::Linear(definition), SceneProgressSnapshotV1::GameComplete) => {
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
        SceneJson::Linear(_) => &[],
    }
}

fn statement_manifest(scene: &SceneJson) -> &[crate::game::schema::StatementJson] {
    match scene {
        SceneJson::Investigation(scene) => &scene.statement_manifest,
        SceneJson::Interrogation(scene) => &scene.statement_manifest,
        SceneJson::Linear(_) => &[],
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

fn restore_history(snapshot: &DialogueHistorySnapshotV1) -> DialogueHistory {
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
    DialogueHistory::from_persistence_parts(entries, snapshot.next_id, snapshot.last_token.clone())
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
    }
}

fn validate_story_origins(
    definitions: &CurrentDefinitions,
    snapshot: &StoryStateSnapshotV1,
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
            AssertionOrigin::Migration { .. } => {}
            AssertionOrigin::AnalysisBoard {
                chapter_id,
                scene_id,
                ..
            } => {
                require_story_scene(definitions, chapter_id, scene_id)?;
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
        (SceneJson::Investigation(scene), StoryEventBlockKind::Topic) => scene
            .sublocations
            .iter()
            .flat_map(|item| &item.characters)
            .flat_map(|item| &item.topics)
            .any(|item| item.id == block_id),
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
        (_, StoryEventBlockKind::StoryEvent) => true,
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

fn story_snapshot_from_v1(snapshot: StoryStateSnapshotV1) -> StoryStateSnapshot {
    StoryStateSnapshot {
        facts: snapshot
            .facts
            .into_iter()
            .map(|(id, progress)| {
                (
                    id,
                    FactProgressSnapshot {
                        asserted_in_chapter_id: progress.asserted_in_chapter_id,
                        asserted_in_scene_id: progress.asserted_in_scene_id,
                        first_origin: progress.first_origin,
                        supporting_records: progress
                            .supporting_records
                            .into_iter()
                            .map(inventory_target_from_v1)
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
                    QuestionProgressSnapshot {
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
                    ObjectiveProgressSnapshot {
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
                    AuthorizationProgressSnapshot {
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

fn story_snapshot_to_v1(snapshot: StoryStateSnapshot) -> StoryStateSnapshotV1 {
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
                            .map(inventory_target_to_v1)
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

fn inventory_target_from_v1(target: InventoryTargetV1) -> InventoryTarget {
    match target {
        InventoryTargetV1::Evidence { id } => InventoryTarget::Evidence { id },
        InventoryTargetV1::Statement { id } => InventoryTarget::Statement { id },
    }
}

fn inventory_target_to_v1(target: InventoryTarget) -> InventoryTargetV1 {
    match target {
        InventoryTarget::Evidence { id } => InventoryTargetV1::Evidence { id },
        InventoryTarget::Statement { id } => InventoryTargetV1::Statement { id },
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
    use crate::game::save::capture::{capture_checkpoint_v1, CapturedCheckpointV1};
    use crate::game::save::schema::{
        AcquisitionEventStateV1, AudioCueSnapshotV1, CharacterTopicRefV1, CrossExamSnapshotV1,
        DialogueHistoryEntryV1, EvidenceInventoryEntryV1, InterrogationOverrideRefV1,
        InvestigationOverrideRefV1, ObjectiveProgressSnapshotV1, RecordKind, SaveEnvelopeV1,
        SaveSlotRef, SaveType, SceneProgressSnapshotV1, ThumbnailDescriptorV1,
    };
    use crate::game::scenes::interrogation::CrossExam;
    use crate::game::scenes::SceneRuntime;
    use crate::game::schema::{AudioChannelJson, AudioCueJson, DialogueItem};
    use crate::game::state::{EvidenceRecord, StatementRecord};
    use crate::game::test_support::save_capture_fixture_resources;
    use crate::game::view::ModeView;
    use crate::game::GameEngine;
    use serde::{Deserialize, Serialize};
    use std::path::{Path, PathBuf};

    const SAVE_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
    type SaveMutation = Box<dyn FnOnce(&mut SaveEnvelopeV1)>;

    fn envelope_from_checkpoint(
        engine: &GameEngine,
        checkpoint: CapturedCheckpointV1,
    ) -> SaveEnvelopeV1 {
        SaveEnvelopeV1 {
            schema_version: 1,
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

    fn envelope(engine: &GameEngine) -> SaveEnvelopeV1 {
        envelope_from_checkpoint(engine, capture_checkpoint_v1(engine).unwrap())
    }

    fn resources_and_engine() -> (PathBuf, GameEngine) {
        let resources = save_capture_fixture_resources();
        let engine = GameEngine::new_started(resources.clone()).unwrap();
        (resources, engine)
    }

    fn round_trip(
        resources: PathBuf,
        engine: &GameEngine,
    ) -> (SaveEnvelopeV1, RestoredGameCandidate) {
        let original = envelope(engine);
        let encoded = serde_json::to_vec(&original).unwrap();
        let parsed = crate::game::save::schema::parse_current_envelope(&encoded).unwrap();
        let definitions = load_current_definitions(&resources).unwrap();
        let restored = build_restore_candidate(resources, &definitions, parsed).unwrap();
        (original, restored)
    }

    fn assert_round_trip(resources: PathBuf, engine: &GameEngine) {
        let (original, restored) = round_trip(resources, engine);
        let recaptured = capture_checkpoint_v1(&restored.engine).unwrap();
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
        mutate: impl FnOnce(&mut SaveEnvelopeV1),
    ) -> String {
        let before = serde_json::to_vec(&capture_checkpoint_v1(engine).unwrap()).unwrap();
        let mut save = envelope(engine);
        mutate(&mut save);
        let definitions = load_current_definitions(resources).unwrap();
        let error =
            build_restore_candidate(resources.to_path_buf(), &definitions, save).unwrap_err();
        let after = serde_json::to_vec(&capture_checkpoint_v1(engine).unwrap()).unwrap();
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

    fn investigation_engine() -> (PathBuf, GameEngine) {
        let (resources, mut engine) = resources_and_engine();
        engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();
        (resources, engine)
    }

    fn interrogation_engine() -> (PathBuf, GameEngine) {
        let (resources, mut engine) = resources_and_engine();
        engine
            .jump_to_scene("chapter_1", "interrogation_scene_2")
            .unwrap();
        (resources, engine)
    }

    #[test]
    fn exact_revision_and_location_are_resolved_from_the_current_package() {
        let (resources, engine) = resources_and_engine();
        for mutate in [
            |save: &mut SaveEnvelopeV1| {
                save.content_revision =
                    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".into()
            },
            |save: &mut SaveEnvelopeV1| save.snapshot.chapter_id = "missing_chapter".into(),
            |save: &mut SaveEnvelopeV1| save.snapshot.scene_id = "missing_scene".into(),
            |save: &mut SaveEnvelopeV1| {
                save.snapshot.scene = SceneProgressSnapshotV1::Investigation {
                    intro_played: false,
                    outro_played: false,
                    current_sublocation_id: None,
                    inspected_hotspot_ids: vec![],
                    discussed_topic_ids: vec![],
                    entered_sublocation_ids: vec![],
                    unlocked_overrides: vec![],
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
        let (resources, engine) = investigation_engine();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| {
                let SceneProgressSnapshotV1::Investigation {
                    current_sublocation_id,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                *current_sublocation_id = Some("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshotV1::Investigation {
                    inspected_hotspot_ids,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                inspected_hotspot_ids.push("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshotV1::Investigation {
                    entered_sublocation_ids,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                entered_sublocation_ids.push("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshotV1::Investigation {
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
                let SceneProgressSnapshotV1::Investigation {
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
        let (resources, engine) = interrogation_engine();
        let mutations: Vec<SaveMutation> = vec![
            Box::new(|save| {
                let SceneProgressSnapshotV1::Interrogation {
                    current_phase_id, ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                *current_phase_id = Some("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshotV1::Interrogation {
                    broken_question_ids,
                    ..
                } = &mut save.snapshot.scene
                else {
                    panic!()
                };
                broken_question_ids.push("missing".into());
            }),
            Box::new(|save| {
                let SceneProgressSnapshotV1::Interrogation { cross_exam, .. } =
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
                let SceneProgressSnapshotV1::Interrogation {
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
        let (resources, engine) = resources_and_engine();
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
                    ObjectiveProgressSnapshotV1 { completed: false },
                );
            }),
            Box::new(|save| save.summary.chapter_id = "wrong".into()),
            Box::new(|save| save.summary.scene_title = "wrong".into()),
            Box::new(|save| save.summary.active_primary_objective_id = Some("missing".into())),
        ];
        for mutate in mutations {
            assert_ne!(
                assert_rejected_without_live_mutation(&resources, &engine, mutate),
                ""
            );
        }
    }

    #[test]
    fn pending_acquisitions_require_canonical_monotonic_event_identity() {
        let (resources, mut engine) = investigation_engine();
        engine.inventory.evidence.push(EvidenceRecord {
            id: "test_evidence".into(),
            name: "mutable".into(),
            description: "mutable".into(),
            details: "mutable".into(),
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
        let (resources, engine) = resources_and_engine();
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
    fn first_view_does_not_duplicate_history_and_saved_token_advances_once() {
        let (resources, engine) = resources_and_engine();
        let (_, mut restored) = round_trip(resources, &engine);
        let before = capture_checkpoint_v1(&restored.engine).unwrap();
        let saved_token = restored.engine.current_queue_token().unwrap();

        restored.engine.view().unwrap();
        restored.engine.view().unwrap();
        assert_eq!(
            capture_checkpoint_v1(&restored.engine).unwrap(),
            before,
            "read-only first views must not append the current frame"
        );

        restored
            .engine
            .advance_dialogue(saved_token.clone())
            .unwrap();
        let after_advance = capture_checkpoint_v1(&restored.engine).unwrap();
        let current_token = restored.engine.current_queue_token().unwrap();
        assert_ne!(current_token, saved_token);
        restored.engine.advance_dialogue(saved_token).unwrap();
        assert_eq!(
            capture_checkpoint_v1(&restored.engine).unwrap(),
            after_advance,
            "the consumed save token must be stale and non-mutating"
        );
    }

    #[test]
    fn consumed_intro_hands_the_exact_saved_generation_to_the_next_real_queue() {
        let (resources, mut engine) = investigation_engine();
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
        let (resources, engine) = resources_and_engine();
        assert_round_trip(resources, &engine);

        let (resources, mut engine) = investigation_engine();
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

        let (resources, mut engine) = interrogation_engine();
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
        let (resources, mut engine) = investigation_engine();
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
            let (resources, mut engine) = interrogation_engine();
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
        let (resources, mut engine) = interrogation_engine();
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
        let (resources, mut engine) = resources_and_engine();
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
        let (resources, engine) = resources_and_engine();
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

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    struct GenericSnapshot {
        definition_id: String,
        incomplete: bool,
        cursor: usize,
        required_definition_id: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct GenericResumable {
        definition_id: String,
        incomplete: bool,
        cursor: usize,
        public_value: String,
    }

    impl ResumableStateAdapter for GenericResumable {
        type Snapshot = GenericSnapshot;

        fn capture(&self) -> Self::Snapshot {
            GenericSnapshot {
                definition_id: self.definition_id.clone(),
                incomplete: self.incomplete,
                cursor: self.cursor,
                required_definition_id: "scene_0".into(),
            }
        }

        fn restore(
            definitions: &CurrentDefinitions,
            snapshot: Self::Snapshot,
        ) -> Result<Self, crate::game::GameError> {
            if !definitions
                .scenes_by_key
                .contains_key(&("chapter_1".into(), snapshot.definition_id.clone()))
                || !definitions
                    .scenes_by_key
                    .contains_key(&("chapter_1".into(), snapshot.required_definition_id))
            {
                return Err(crate::game::GameError::missing_save_definition());
            }
            Ok(Self {
                public_value: format!(
                    "{}:{}:{}",
                    snapshot.definition_id, snapshot.incomplete, snapshot.cursor
                ),
                definition_id: snapshot.definition_id,
                incomplete: snapshot.incomplete,
                cursor: snapshot.cursor,
            })
        }
    }

    #[test]
    fn generic_resumable_incomplete_state_survives_json_and_harness_swap() {
        let (resources, engine) = resources_and_engine();
        let definitions = load_current_definitions(&resources).unwrap();
        let save_bytes = serde_json::to_vec(&envelope(&engine)).unwrap();
        let parsed = crate::game::save::schema::parse_current_envelope(&save_bytes).unwrap();
        let package_candidate = build_restore_candidate(resources, &definitions, parsed).unwrap();
        assert_eq!(
            package_candidate.engine.content_revision(),
            engine.content_revision()
        );
        let live = GenericResumable {
            definition_id: "scene_0".into(),
            incomplete: true,
            cursor: 7,
            public_value: "old".into(),
        };
        let encoded = serde_json::to_vec(&live.capture()).unwrap();
        let snapshot: GenericSnapshot = serde_json::from_slice(&encoded).unwrap();
        let candidate = GenericResumable::restore(&definitions, snapshot).unwrap();
        let mut harness = live;
        assert_eq!(harness.public_value, "old");
        harness = candidate;
        assert_eq!(harness.public_value, "scene_0:true:7");
    }
}
