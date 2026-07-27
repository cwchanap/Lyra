// Game engine lives under `game::*`. lib.rs only registers Tauri commands.
//
// `pub mod game` (not `mod game`) — integration tests under src-tauri/tests/
// access the module via the public crate API (`lyra_lib::game::*`).
pub mod game;

use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::path::BaseDirectory;
use tauri::Manager;

use game::save::capture::{capture_checkpoint_v1, CapturedCheckpointV1};
use game::save::coordinator::{
    AppSession, AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
    AutosaveRegisteredIntent, AutosaveWriteJob, CoordinatorFuture, FlushOperation,
    PersistenceBypassOperation, PersistenceFailureTokenView, PersistenceHealthView,
    PreparedThumbnailPurpose, SaveCoordinator, ThumbnailActivityView, ThumbnailCapturePurpose,
    ThumbnailCaptureRequestView,
};
use game::save::restore::load_current_definitions;
use game::save::schema::{
    suggested_display_name, validate_manual_display_name, SaveBrowserView, SaveDiagnosticView,
    SaveDiscoveryStatusView, SaveEnvelopeV1, SaveSlotRef, SaveSlotStatusView, SaveSlotView,
    SaveType, ThumbnailDescriptorV1, SAVE_SCHEMA_VERSION,
};
use game::save::storage::{
    clean_orphaned_save_files, commit_prepared_slot_write, discover_saves, ensure_save_layout,
    prepare_slot_write, resolve_save_root, select_continue_candidate, ManualSlotExpectation,
    OccupiedSlotExpectation, ProductionSaveFilesystem, SaveDiscoveryContext, SaveFilesystem,
    SlotWriteRequest, ThumbnailWrite, PRODUCTION_APP_IDENTIFIER,
};
use game::{GameEngine, GameError, GameStateView, QueueToken, SceneNavigationIndex};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameplayCommandResultView {
    pub(crate) state: GameStateView,
    pub(crate) thumbnail_capture: Option<ThumbnailCaptureRequestView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualSaveResultView {
    pub(crate) saved_slot: SaveSlotView,
    pub(crate) browser: SaveBrowserView,
    pub(crate) thumbnail_activity: ThumbnailActivityView,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Part B fills the save-browser commands.
pub(crate) struct SaveBrowserOpenResultView {
    pub(crate) browser: SaveBrowserView,
    pub(crate) continue_candidate: Option<SaveSlotRef>,
    pub(crate) preflight: SaveBrowserPreflightView,
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[allow(dead_code)] // Part B fills the save-browser commands.
pub(crate) enum SaveBrowserPreflightView {
    Ready,
    FlushFailed {
        diagnostic: SaveDiagnosticView,
        failure_token: PersistenceFailureTokenView,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum MutationPersistencePolicy {
    AutosaveIfAdvanced,
    CoordinatorManaged,
    AdvanceWithoutSaving,
}

pub(crate) struct AppState {
    // Task 9 exposed one session mutex. Task 10 wraps that exact mutex in Arc
    // so the disk backend can share it without introducing duplicate state.
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) replacement_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) coordinator: SaveCoordinator,
    pub(crate) resources_dir: PathBuf,
    #[allow(dead_code)] // Part B2 load/delete commands consume the configured root directly.
    pub(crate) save_root: PathBuf,
    pub(crate) persistence: Option<Arc<ApplicationPersistence>>,
}

pub(crate) struct ApplicationPersistence {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) replacement_gate: Arc<tokio::sync::Mutex<()>>,
    fs: Arc<dyn SaveFilesystem>,
    root: PathBuf,
    discovery: SaveDiscoveryContext,
    last_saved_at: Mutex<Option<DateTime<Utc>>>,
}

impl ApplicationPersistence {
    fn discover(&self) -> SaveBrowserView {
        discover_saves(self.fs.as_ref(), &self.root, &self.discovery)
    }

    fn next_saved_at(&self) -> Result<String, GameError> {
        let mut last = self
            .last_saved_at
            .lock()
            .map_err(|_| GameError::save_write_failed())?;
        let now = Utc::now();
        let next = last
            .as_ref()
            .map(|previous| now.max(*previous + ChronoDuration::nanoseconds(1)))
            .unwrap_or(now);
        *last = Some(next);
        Ok(next.to_rfc3339_opts(SecondsFormat::Nanos, true))
    }

    fn envelope(
        &self,
        checkpoint: CapturedCheckpointV1,
        content_revision: String,
        reference: SaveSlotRef,
        save_id: String,
        display_name: String,
    ) -> Result<SaveEnvelopeV1, GameError> {
        let (save_type, slot) = match reference {
            SaveSlotRef::Auto { slot } => (SaveType::Auto, slot),
            SaveSlotRef::Manual { slot } => (SaveType::Manual, slot),
        };
        Ok(SaveEnvelopeV1 {
            schema_version: SAVE_SCHEMA_VERSION,
            content_revision,
            save_id,
            save_type,
            slot,
            saved_at: self.next_saved_at()?,
            display_name,
            thumbnail: ThumbnailDescriptorV1::Unavailable,
            summary: checkpoint.summary,
            snapshot: checkpoint.snapshot,
        })
    }
}

impl AutosaveBackend for ApplicationPersistence {
    fn capture(
        &self,
        job: AutosaveWriteJob,
    ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>> {
        Box::pin(async move {
            let (checkpoint, content_revision) = {
                let session = self.session.lock().map_err(|_| GameError::unavailable())?;
                session.ensure_persistence_available()?;
                let engine = session
                    .engine
                    .as_ref()
                    .ok_or_else(GameError::game_not_started)?;
                if session.persistence.generation != job.session_generation
                    || engine.durable_revision() != job.durable_revision
                {
                    return Err(GameError::save_write_failed());
                }
                (
                    capture_checkpoint_v1(engine)?,
                    self.discovery.definitions.content_revision().to_owned(),
                )
            };
            let slots = self.discover().slots;
            Ok(AutosaveCapture::captured(
                job,
                slots,
                checkpoint,
                content_revision,
            ))
        })
    }

    fn register(
        &self,
        capture: AutosaveCapture,
        target: SaveSlotRef,
        save_id: String,
    ) -> CoordinatorFuture<'_, Result<AutosaveRegisteredIntent, GameError>> {
        Box::pin(async move {
            let (checkpoint, content_revision) = capture.captured_checkpoint()?;
            let display_name = suggested_display_name(
                &checkpoint.summary.chapter_title,
                &checkpoint.summary.scene_title,
            );
            let envelope = self.envelope(
                checkpoint,
                content_revision,
                target,
                save_id.clone(),
                display_name,
            )?;
            capture.register(target, save_id, envelope)
        })
    }

    fn prepare(
        &self,
        registered: AutosaveRegisteredIntent,
    ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>> {
        Box::pin(async move { registered.prepare(self.fs.as_ref(), &self.root) })
    }

    fn commit_if_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
        Box::pin(async move {
            let _gate = self.replacement_gate.lock().await;
            self.commit_current(prepared)
        })
    }

    fn commit_with_gate_held(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
        Box::pin(async move { self.commit_current(prepared) })
    }

    fn cleanup_orphans(&self) -> CoordinatorFuture<'_, Result<(), GameError>> {
        Box::pin(async move { clean_orphaned_save_files(self.fs.as_ref(), &self.root) })
    }
}

impl ApplicationPersistence {
    fn commit_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> Result<AutosaveCommitOutcome, GameError> {
        let current = {
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
            session.persistence.generation == prepared.session_generation()
                && session.durable_revision() == Some(prepared.durable_revision())
        };
        if !current {
            return Ok(AutosaveCommitOutcome::Stale(prepared));
        }
        prepared
            .commit(self.fs.as_ref(), &self.root)
            .map(AutosaveCommitOutcome::Committed)
    }
}

fn build_app_state_with_storage(
    resources_dir: PathBuf,
    save_root: PathBuf,
    fs: Arc<dyn SaveFilesystem>,
) -> Result<AppState, GameError> {
    let definitions = Arc::new(load_current_definitions(&resources_dir)?);
    let session = Arc::new(Mutex::new(AppSession::empty()));
    let replacement_gate = Arc::new(tokio::sync::Mutex::new(()));
    let coordinator = SaveCoordinator::new();
    if let Err(error) = ensure_save_layout(fs.as_ref(), &save_root) {
        coordinator
            .publish_persistence_health(PersistenceHealthView::Degraded { diagnostic: error });
        return Ok(AppState {
            session,
            replacement_gate,
            coordinator,
            resources_dir,
            save_root,
            persistence: None,
        });
    }
    let persistence = Arc::new(ApplicationPersistence {
        session: Arc::clone(&session),
        replacement_gate: Arc::clone(&replacement_gate),
        fs,
        root: save_root.clone(),
        discovery: SaveDiscoveryContext {
            resources_dir: resources_dir.clone(),
            definitions,
        },
        last_saved_at: Mutex::new(None),
    });
    let coordinator = SaveCoordinator::with_backend(persistence.clone());
    Ok(AppState {
        session,
        replacement_gate,
        coordinator,
        resources_dir,
        save_root,
        persistence: Some(persistence),
    })
}

fn unavailable_error() -> GameError {
    GameError::unavailable()
}

fn read_game_state(state: &AppState) -> Result<GameStateView, GameError> {
    let session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    session
        .engine
        .as_ref()
        .ok_or_else(GameError::game_not_started)?
        .view()
}

fn run_gameplay_mutation(
    state: &AppState,
    policy: MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    let (committed, session_generation, before_revision, after_revision) = {
        let mut session = state.session.lock().map_err(|_| unavailable_error())?;
        session.ensure_persistence_available()?;
        let session_generation = session.persistence.generation;
        let engine = session
            .engine
            .as_mut()
            .ok_or_else(GameError::game_not_started)?;
        let before_revision = engine.durable_revision();
        let committed = mutation(engine)?;
        let after_revision = engine.durable_revision();
        (
            committed,
            session_generation,
            before_revision,
            after_revision,
        )
    };

    if matches!(policy, MutationPersistencePolicy::AutosaveIfAdvanced)
        && after_revision > before_revision
    {
        let notification =
            state
                .coordinator
                .notify_committed(committed, session_generation, after_revision);
        return Ok(GameplayCommandResultView {
            state: notification.committed,
            thumbnail_capture: notification.thumbnail_capture,
        });
    }

    Ok(GameplayCommandResultView {
        state: committed,
        thumbnail_capture: None,
    })
}

fn finish_coordinator_mutation(
    state: GameStateView,
    policy: MutationPersistencePolicy,
) -> GameplayCommandResultView {
    match policy {
        MutationPersistencePolicy::CoordinatorManaged
        | MutationPersistencePolicy::AdvanceWithoutSaving => GameplayCommandResultView {
            state,
            thumbnail_capture: None,
        },
        MutationPersistencePolicy::AutosaveIfAdvanced => {
            unreachable!("ordinary autosave mutations must use run_gameplay_mutation")
        }
    }
}

/// Resolve the `resources/scenes` directory.
///
/// `BaseDirectory::Resource` works for bundled/production builds, but Tauri's
/// resource resolver only recognizes a Cargo output directory named exactly
/// `target` (it checks `parts[len-2] == "target"`). The e2e debug build uses a
/// dedicated `CARGO_TARGET_DIR=target-e2e` to avoid clobbering the ordinary
/// debug binary, so that check fails and `resource_dir()` returns
/// `Error::UnknownPath`. The build still copies resources into
/// `<exe_dir>/resources/`, so fall back to the executable's directory when the
/// canonical resolution fails.
///
/// On Linux, `BaseDirectory::Resource` can resolve to a system-install path
/// derived from the app identifier (e.g. `/usr/lib/lyra-e2e/resources/scenes`)
/// even when that path does not exist on disk — `--no-bundle` skips the install
/// step, so the path is a phantom. We therefore require the resolved path to
/// actually exist before accepting it, and only then fall back to the
/// executable's directory.
fn resolve_scenes_dir(app: &tauri::AppHandle) -> Result<PathBuf, GameError> {
    if let Ok(dir) = app
        .path()
        .resolve("resources/scenes", BaseDirectory::Resource)
    {
        if dir.exists() {
            return Ok(dir);
        }
    }
    let exe = std::env::current_exe()
        .map_err(|e| GameError::scene_load_failed(format!("cannot resolve resources dir: {e}")))?;
    let dir = exe
        .parent()
        .ok_or_else(|| {
            GameError::scene_load_failed("cannot resolve resources dir: no parent".into())
        })?
        .join("resources")
        .join("scenes");
    if !dir.exists() {
        return Err(GameError::scene_load_failed(format!(
            "cannot resolve resources dir: {} does not exist",
            dir.display()
        )));
    }
    Ok(dir)
}

async fn install_session_candidate(
    state: &AppState,
    candidate: Result<(GameEngine, Option<SaveSlotRef>), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    let (engine, autosave_target) = candidate?;
    let state = state
        .coordinator
        .install_session(state, engine, autosave_target)
        .await?;
    Ok(GameplayCommandResultView {
        state,
        thumbnail_capture: None,
    })
}

async fn start_game_core(
    state: &AppState,
    engine: GameEngine,
) -> Result<GameplayCommandResultView, GameError> {
    install_session_candidate(state, Ok((engine, None))).await
}

#[tauri::command]
async fn start_game(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    let engine = GameEngine::new_started(state.resources_dir.clone())?;
    start_game_core(&state, engine).await
}

#[tauri::command]
async fn reset_game(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    start_game(state).await
}

#[tauri::command]
fn get_state(state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    read_game_state(&state)
}

#[tauri::command]
fn get_persistence_status(state: tauri::State<'_, AppState>) -> PersistenceHealthView {
    state.coordinator.persistence_health()
}

#[tauri::command]
fn get_thumbnail_activity(state: tauri::State<'_, AppState>) -> ThumbnailActivityView {
    state.coordinator.thumbnail_activity()
}

async fn list_saves_core(
    state: &AppState,
    discover: impl FnOnce() -> SaveBrowserView,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let has_active_session = state
        .session
        .lock()
        .map_err(|_| unavailable_error())?
        .engine
        .is_some();
    let flush_error = if has_active_session {
        state
            .coordinator
            .flush_session(state, FlushOperation::InGameLoad)
            .await
            .err()
    } else {
        None
    };
    let browser = discover();
    let discovery_generation = state.coordinator.complete_discovery_attempt()?;
    let continue_candidate = select_continue_candidate(&browser.slots);
    let preflight = match flush_error {
        Some(error) => {
            let (diagnostic, failure_token) = state.coordinator.challenge_current_session_failure(
                state,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                Some(discovery_generation),
                error,
            )?;
            SaveBrowserPreflightView::FlushFailed {
                diagnostic,
                failure_token,
            }
        }
        None => SaveBrowserPreflightView::Ready,
    };
    Ok(SaveBrowserOpenResultView {
        browser,
        continue_candidate,
        preflight,
    })
}

#[tauri::command]
async fn list_saves(
    state: tauri::State<'_, AppState>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let persistence = state.persistence.clone();
    list_saves_core(&state, move || {
        persistence
            .as_ref()
            .map(|persistence| persistence.discover())
            .unwrap_or_else(unavailable_save_browser)
    })
    .await
}

#[tauri::command]
fn start_game_without_saving(
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    let _ = failure_token;
    Err(unavailable_error())
}

#[tauri::command]
fn prepare_save_thumbnail(
    state: tauri::State<'_, AppState>,
    purpose: PreparedThumbnailPurpose,
) -> Result<ThumbnailCaptureRequestView, GameError> {
    state
        .coordinator
        .prepare_application_thumbnail(&state, purpose)
}

#[tauri::command]
fn submit_save_thumbnail() -> Result<ThumbnailActivityView, GameError> {
    Err(unavailable_error())
}

#[tauri::command]
fn report_save_thumbnail_failure(
    state: tauri::State<'_, AppState>,
    ticket: String,
) -> Result<ThumbnailActivityView, GameError> {
    state.coordinator.report_thumbnail_failure(&ticket)
}

#[tauri::command]
fn read_save_thumbnail(
    reference: SaveSlotRef,
    observed_save_id: String,
) -> Result<Vec<u8>, GameError> {
    let _ = (reference, observed_save_id);
    Err(unavailable_error())
}

#[tauri::command]
async fn save_manual_core(
    state: &AppState,
    reference: SaveSlotRef,
    display_name: String,
    expectation: ManualSlotExpectation,
    prepared_thumbnail_ticket: String,
) -> Result<ManualSaveResultView, GameError> {
    state
        .coordinator
        .flush_session(state, FlushOperation::ManualSave)
        .await?;
    let SaveSlotRef::Manual { .. } = reference else {
        return Err(GameError::save_slot_mismatch());
    };
    let display_name = validate_manual_display_name(&display_name)?;
    let persistence = state
        .persistence
        .as_ref()
        .cloned()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    let (session_generation, durable_revision, checkpoint) = {
        let session = state.session.lock().map_err(|_| unavailable_error())?;
        session.ensure_persistence_available()?;
        let engine = session
            .engine
            .as_ref()
            .ok_or_else(GameError::game_not_started)?;
        (
            session.persistence.generation,
            engine.durable_revision(),
            capture_checkpoint_v1(engine)?,
        )
    };
    let purpose = ThumbnailCapturePurpose::ManualSave {
        session_generation,
        durable_revision,
    };
    let thumbnail = state
        .coordinator
        .claim_thumbnail(&prepared_thumbnail_ticket, &purpose)?;
    let save_id = uuid::Uuid::new_v4().hyphenated().to_string();
    let envelope = persistence.envelope(
        checkpoint,
        persistence
            .discovery
            .definitions
            .content_revision()
            .to_owned(),
        reference,
        save_id.clone(),
        display_name,
    )?;
    let thumbnail = match thumbnail {
        game::save::coordinator::CaptureTerminalResult::Available(candidate) => {
            ThumbnailWrite::Available(candidate.bind(&save_id)?)
        }
        game::save::coordinator::CaptureTerminalResult::Unavailable => ThumbnailWrite::Unavailable,
    };
    let request = SlotWriteRequest {
        reference,
        envelope,
        thumbnail,
        expected_manual: Some(expectation),
    };
    let fs = Arc::clone(&persistence.fs);
    let root = persistence.root.clone();
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    state
        .coordinator
        .publish_persistence_health(PersistenceHealthView::Pending);
    if let Err(error) = state
        .coordinator
        .reserve_manual_writer(Box::pin(async move {
            let result = prepare_slot_write(fs.as_ref(), &root, request)
                .and_then(|prepared| commit_prepared_slot_write(fs.as_ref(), &root, prepared));
            let _ = result_tx.send(result);
        }))
    {
        state
            .coordinator
            .publish_persistence_health(PersistenceHealthView::Degraded {
                diagnostic: error.clone(),
            });
        return Err(error);
    }
    let outcome = match result_rx.await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(error)) => {
            state
                .coordinator
                .publish_persistence_health(PersistenceHealthView::Degraded {
                    diagnostic: error.clone(),
                });
            return Err(error);
        }
        Err(_) => {
            let error = GameError::save_write_failed();
            state
                .coordinator
                .publish_persistence_health(PersistenceHealthView::Degraded {
                    diagnostic: error.clone(),
                });
            return Err(error);
        }
    };
    state.coordinator.publish_persistence_health(
        outcome
            .cleanup_diagnostic
            .clone()
            .map(|diagnostic| PersistenceHealthView::Degraded { diagnostic })
            .unwrap_or(PersistenceHealthView::Healthy),
    );
    let browser = persistence.discover();
    state.coordinator.complete_discovery_attempt()?;
    let saved_slot = browser
        .slots
        .iter()
        .find(|slot| slot.reference == reference)
        .cloned()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    if !matches!(saved_slot.status, SaveSlotStatusView::Valid { .. })
        || outcome.committed_envelope.save_id != save_id
    {
        return Err(GameError::save_write_failed());
    }
    Ok(ManualSaveResultView {
        saved_slot,
        browser,
        thumbnail_activity: state.coordinator.thumbnail_activity(),
    })
}

#[tauri::command]
async fn save_manual(
    state: tauri::State<'_, AppState>,
    reference: SaveSlotRef,
    display_name: String,
    expectation: ManualSlotExpectation,
    prepared_thumbnail_ticket: String,
) -> Result<ManualSaveResultView, GameError> {
    save_manual_core(
        &state,
        reference,
        display_name,
        expectation,
        prepared_thumbnail_ticket,
    )
    .await
}

fn unavailable_save_browser() -> SaveBrowserView {
    SaveBrowserView {
        discovery: SaveDiscoveryStatusView::Unavailable {
            diagnostic: GameError::save_discovery_unavailable(),
        },
        slots: Vec::new(),
    }
}

#[tauri::command]
fn load_save(
    reference: SaveSlotRef,
    observed_save_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    let _ = (reference, observed_save_id);
    Err(unavailable_error())
}

#[tauri::command]
fn load_save_discarding_current(
    reference: SaveSlotRef,
    observed_save_id: String,
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    let _ = (reference, observed_save_id, failure_token);
    Err(unavailable_error())
}

#[tauri::command]
fn continue_game() -> Result<GameplayCommandResultView, GameError> {
    Err(unavailable_error())
}

#[tauri::command]
fn delete_save(
    reference: SaveSlotRef,
    expectation: OccupiedSlotExpectation,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let _ = (reference, expectation);
    Err(unavailable_error())
}

#[tauri::command]
fn return_to_title() -> Result<SaveBrowserOpenResultView, GameError> {
    Err(unavailable_error())
}

#[tauri::command]
fn return_to_title_without_saving(
    failure_token: PersistenceFailureTokenView,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let _ = failure_token;
    Err(unavailable_error())
}

#[tauri::command]
async fn acknowledge_acquisition_event(
    state: tauri::State<'_, AppState>,
    event_id: String,
    prepared_thumbnail_ticket: String,
) -> Result<GameplayCommandResultView, GameError> {
    let outcome = state
        .coordinator
        .acknowledge_acquisition(&state, event_id, prepared_thumbnail_ticket)
        .await?;
    Ok(finish_coordinator_mutation(
        outcome.state,
        MutationPersistencePolicy::CoordinatorManaged,
    ))
}

#[tauri::command]
async fn confirm_acquisition_without_saving(
    state: tauri::State<'_, AppState>,
    event_id: String,
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    let state_view = state
        .coordinator
        .confirm_acquisition_without_saving(&state, event_id, failure_token)
        .await?;
    Ok(finish_coordinator_mutation(
        state_view,
        MutationPersistencePolicy::AdvanceWithoutSaving,
    ))
}

#[tauri::command]
fn list_scenes(app: tauri::AppHandle) -> Result<SceneNavigationIndex, GameError> {
    let resources_dir = resolve_scenes_dir(&app)?;
    GameEngine::scene_navigation_index(resources_dir)
}

#[tauri::command]
fn jump_to_scene(
    state: tauri::State<'_, AppState>,
    chapter_id: String,
    scene_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.jump_to_scene(&chapter_id, &scene_id),
    )
}

#[tauri::command]
fn advance_dialogue(
    state: tauri::State<'_, AppState>,
    expected: QueueToken,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.advance_dialogue(expected),
    )
}

#[tauri::command]
fn inspect_hotspot(
    state: tauri::State<'_, AppState>,
    hotspot_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.inspect_hotspot(&hotspot_id),
    )
}

#[tauri::command]
fn interview_topic(
    state: tauri::State<'_, AppState>,
    character_id: String,
    topic_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.interview_topic(&character_id, &topic_id),
    )
}

#[tauri::command]
fn enter_sublocation(
    state: tauri::State<'_, AppState>,
    sublocation_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.enter_sublocation(&sublocation_id),
    )
}

#[tauri::command]
fn reexamine_evidence(
    state: tauri::State<'_, AppState>,
    evidence_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.reexamine_evidence(&evidence_id),
    )
}

#[tauri::command]
fn reexamine_statement(
    state: tauri::State<'_, AppState>,
    statement_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.reexamine_statement(&statement_id),
    )
}

#[tauri::command]
fn ask_interrogation_question(
    state: tauri::State<'_, AppState>,
    question_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.ask_interrogation_question(&question_id),
    )
}

#[tauri::command]
fn challenge_interrogation_line(
    state: tauri::State<'_, AppState>,
    line_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.challenge_interrogation_line(&line_id),
    )
}

#[tauri::command]
fn present_interrogation_evidence(
    state: tauri::State<'_, AppState>,
    line_id: String,
    item_kind: String,
    item_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        |engine| engine.present_interrogation_evidence(&line_id, &item_kind, &item_id),
    )
}

#[tauri::command]
fn withdraw_interrogation(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        GameEngine::withdraw_interrogation,
    )
}

#[tauri::command]
fn resume_interrogation_testimony(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        GameEngine::resume_interrogation_testimony,
    )
}

#[tauri::command]
fn complete_interrogation_phase(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvanced,
        GameEngine::complete_interrogation_phase,
    )
}

#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!("feature \"e2e\" is only for debug e2e builds");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .setup(|app| {
            let resources_dir = resolve_scenes_dir(app.handle())
                .map_err(|error| std::io::Error::other(error.message))?;
            let configured_app_data = app.path().app_data_dir()?;
            let production_app_data = app.path().data_dir()?.join(PRODUCTION_APP_IDENTIFIER);
            let save_root = resolve_save_root(
                &configured_app_data,
                &production_app_data,
                &app.config().identifier,
            )
            .map_err(|error| std::io::Error::other(error.message))?;
            let state = build_app_state_with_storage(
                resources_dir,
                save_root,
                Arc::new(ProductionSaveFilesystem),
            )
            .map_err(|error| std::io::Error::other(error.message))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_saves,
            get_persistence_status,
            get_thumbnail_activity,
            start_game,
            start_game_without_saving,
            prepare_save_thumbnail,
            submit_save_thumbnail,
            report_save_thumbnail_failure,
            read_save_thumbnail,
            save_manual,
            load_save,
            load_save_discarding_current,
            continue_game,
            delete_save,
            return_to_title,
            return_to_title_without_saving,
            acknowledge_acquisition_event,
            confirm_acquisition_without_saving,
            reset_game,
            get_state,
            list_scenes,
            jump_to_scene,
            advance_dialogue,
            inspect_hotspot,
            interview_topic,
            enter_sublocation,
            reexamine_evidence,
            reexamine_statement,
            ask_interrogation_question,
            challenge_interrogation_line,
            present_interrogation_evidence,
            withdraw_interrogation,
            resume_interrogation_testimony,
            complete_interrogation_phase,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::save::coordinator::ExclusivePersistenceIntent;
    use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
    use std::time::Duration;

    mod application_command_contract {
        use super::*;
        use crate::game::save::coordinator::{
            AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
            AutosaveRegisteredIntent, AutosaveWriteJob, CoordinatorFuture, FlushOutcome,
        };
        use crate::game::save::schema::{
            SaveBrowserView, SaveDiscoveryStatusView, SaveSlotStatusView, SaveSlotView,
        };
        use crate::game::save::storage::{
            ProductionSaveFilesystem, SaveFileMetadata, SaveFilesystem, StagedAtomicWrite,
        };
        use crate::game::schema::{OutroUnlock, PredicateHotspotInvestigated, UnlockExpr};
        use crate::game::test_support::save_capture_fixture_resources;
        use crate::game::view::ModeView;
        use std::cell::Cell;
        use std::io;
        use std::path::Path;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Condvar;
        use std::time::{Duration as StdDuration, SystemTime};

        struct PassiveBackend;

        impl AutosaveBackend for PassiveBackend {
            fn capture(
                &self,
                _job: AutosaveWriteJob,
            ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>> {
                Box::pin(async { Err(GameError::save_write_failed()) })
            }

            fn register(
                &self,
                _capture: AutosaveCapture,
                _target: crate::game::save::schema::SaveSlotRef,
                _save_id: String,
            ) -> CoordinatorFuture<'_, Result<AutosaveRegisteredIntent, GameError>> {
                Box::pin(async { Err(GameError::save_write_failed()) })
            }

            fn prepare(
                &self,
                _registered: AutosaveRegisteredIntent,
            ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>> {
                Box::pin(async { Err(GameError::save_write_failed()) })
            }

            fn commit_if_current(
                &self,
                _prepared: AutosavePreparedWrite,
            ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
                Box::pin(async { Err(GameError::save_write_failed()) })
            }

            fn commit_with_gate_held(
                &self,
                _prepared: AutosavePreparedWrite,
            ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
                Box::pin(async { Err(GameError::save_write_failed()) })
            }
        }

        fn mutation_app() -> AppState {
            let mut scene = investigation_scene_with_intro("scene", vec![]);
            scene.outro.unlock = OutroUnlock::Expr(UnlockExpr::HotspotInvestigated {
                _predicate: PredicateHotspotInvestigated::X,
                id: "absent".into(),
            });
            let engine = empty_engine_with_scene(scene, 1);
            AppState {
                session: Arc::new(Mutex::new(AppSession::installed(engine, 7, None))),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::with_backend(Arc::new(PassiveBackend)),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
                persistence: None,
            }
        }

        fn title_app() -> AppState {
            AppState {
                session: Arc::new(Mutex::new(AppSession::empty())),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::new(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
                persistence: None,
            }
        }

        fn discovered_browser() -> SaveBrowserView {
            SaveBrowserView {
                discovery: SaveDiscoveryStatusView::Available,
                slots: vec![
                    SaveSlotView {
                        reference: SaveSlotRef::Auto { slot: 1 },
                        modified_at: Some("2026-07-26T00:00:01Z".into()),
                        status: SaveSlotStatusView::Invalid {
                            metadata: None,
                            diagnostic: GameError::malformed_save_json(),
                        },
                        observed_modified_at: Some(
                            SystemTime::UNIX_EPOCH + StdDuration::from_secs(1),
                        ),
                        observed_saved_at: None,
                    },
                    SaveSlotView {
                        reference: SaveSlotRef::Manual { slot: 2 },
                        modified_at: Some("2026-07-26T00:00:02Z".into()),
                        status: SaveSlotStatusView::Invalid {
                            metadata: None,
                            diagnostic: GameError::malformed_save_json(),
                        },
                        observed_modified_at: Some(
                            SystemTime::UNIX_EPOCH + StdDuration::from_secs(2),
                        ),
                        observed_saved_at: None,
                    },
                ],
            }
        }

        #[tokio::test]
        async fn title_list_saves_discovers_without_attempting_session_flush() {
            let app = title_app();
            let discovery_calls = Cell::new(0);

            let result = list_saves_core(&app, || {
                discovery_calls.set(discovery_calls.get() + 1);
                discovered_browser()
            })
            .await
            .unwrap();

            assert_eq!(discovery_calls.get(), 1);
            assert!(matches!(result.preflight, SaveBrowserPreflightView::Ready));
            assert_eq!(
                result.continue_candidate,
                Some(SaveSlotRef::Manual { slot: 2 })
            );
        }

        #[tokio::test]
        async fn active_list_saves_flushes_then_discovers_and_selects_continue_in_rust() {
            let app = mutation_app();
            let discovery_calls = Cell::new(0);

            let result = list_saves_core(&app, || {
                discovery_calls.set(discovery_calls.get() + 1);
                discovered_browser()
            })
            .await
            .unwrap();

            assert_eq!(discovery_calls.get(), 1);
            assert!(matches!(result.preflight, SaveBrowserPreflightView::Ready));
            assert_eq!(
                result.continue_candidate,
                Some(SaveSlotRef::Manual { slot: 2 })
            );
        }

        #[tokio::test]
        async fn failed_active_list_flush_returns_separate_browser_and_opaque_preflight_challenge()
        {
            let app = mutation_app();
            run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AdvanceWithoutSaving,
                |engine| engine.enter_sublocation("room"),
            )
            .unwrap();

            let result = list_saves_core(&app, discovered_browser).await.unwrap();

            assert_eq!(
                result.continue_candidate,
                Some(SaveSlotRef::Manual { slot: 2 })
            );
            let serialized = serde_json::to_value(result).unwrap();
            assert_eq!(serialized["preflight"]["type"], "flushFailed");
            assert_eq!(
                serialized["preflight"]["diagnostic"]["code"],
                "saveWriteFailed"
            );
            assert!(serialized["preflight"]["failureToken"]
                .as_str()
                .is_some_and(|token| uuid::Uuid::parse_str(token).is_ok()));
        }

        #[test]
        fn production_setup_shares_the_exact_session_and_gate_and_retains_layout_failure() {
            let resources = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = build_app_state_with_storage(
                resources,
                temporary.path().join("saves"),
                Arc::new(ProductionSaveFilesystem),
            )
            .unwrap();
            let persistence = app.persistence.as_ref().unwrap();

            assert!(Arc::ptr_eq(&app.session, &persistence.session));
            assert!(Arc::ptr_eq(
                &app.replacement_gate,
                &persistence.replacement_gate
            ));
            assert!(temporary.path().join("saves").is_dir());
            assert!(temporary.path().join("saves/thumbnails").is_dir());

            let failed = build_app_state_with_storage(
                save_capture_fixture_resources(),
                temporary.path().join("unavailable"),
                Arc::new(LayoutFailureFilesystem),
            )
            .unwrap();
            assert!(matches!(
                failed.coordinator.persistence_health(),
                PersistenceHealthView::Degraded { .. }
            ));
            assert!(failed.persistence.is_none());
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
        async fn production_capture_releases_the_session_guard_before_storage_work() {
            let resources = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let probe = Arc::new(GuardProbe {
                entered: tokio::sync::Notify::new(),
                released: AtomicBool::new(false),
                release: Condvar::new(),
                release_lock: Mutex::new(()),
            });
            let storage = Arc::new(GuardProbeFilesystem {
                inner: ProductionSaveFilesystem,
                probe: probe.clone(),
            });
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                storage,
            )
            .unwrap();
            let engine = GameEngine::new_started(resources).unwrap();
            let generation = app.coordinator.next_session_generation().unwrap();
            *app.session.lock().unwrap() = AppSession::installed(engine, generation, None);

            let persistence = app.persistence.as_ref().unwrap().clone();
            let durable_revision = app.session.lock().unwrap().durable_revision().unwrap();
            let session = app.session.clone();
            let task = tokio::spawn(async move {
                persistence
                    .capture(AutosaveWriteJob {
                        session_generation: generation,
                        durable_revision,
                        thumbnail:
                            crate::game::save::coordinator::CaptureTerminalResult::Unavailable,
                    })
                    .await
            });

            probe.entered.notified().await;
            assert!(
                session.try_lock().is_ok(),
                "storage work must never retain the session guard"
            );
            probe.released.store(true, Ordering::SeqCst);
            probe.release.notify_all();
            task.await.unwrap().unwrap();
        }

        #[tokio::test]
        async fn production_backend_flushes_a_real_checkpoint_and_adopts_only_its_autosave() {
            let resources = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                Arc::new(ProductionSaveFilesystem),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();
            let revision = {
                let mut session = app.session.lock().unwrap();
                let engine = session.engine.as_mut().unwrap();
                let ModeView::Dialogue { queue_token, .. } = engine.view().unwrap().mode else {
                    panic!("fixture starts in dialogue");
                };
                engine.advance_dialogue(queue_token).unwrap();
                engine.durable_revision()
            };

            let outcome = app
                .coordinator
                .flush_session(&app, FlushOperation::ManualSave)
                .await
                .unwrap();
            let FlushOutcome::Written { slot, .. } = outcome else {
                panic!("dirty fixture must flush");
            };
            let browser = app.persistence.as_ref().unwrap().discover();
            assert!(browser.slots.iter().any(|candidate| {
                candidate.reference == slot
                    && matches!(candidate.status, SaveSlotStatusView::Valid { .. })
            }));
            let session = app.session.lock().unwrap();
            assert_eq!(session.durable_revision(), Some(revision));
            assert_eq!(session.persistence.autosave_target, Some(slot));
        }

        #[tokio::test]
        async fn manual_save_never_bypasses_a_required_flush_failure() {
            let app = mutation_app();
            run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AdvanceWithoutSaving,
                |engine| engine.enter_sublocation("room"),
            )
            .unwrap();
            let ticket = app
                .coordinator
                .prepare_application_thumbnail(&app, PreparedThumbnailPurpose::ManualSave)
                .unwrap();
            app.coordinator
                .report_thumbnail_failure(&ticket.ticket)
                .unwrap();

            let error = save_manual_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                "Must flush".into(),
                ManualSlotExpectation::Empty,
                ticket.ticket,
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "saveWriteFailed");
        }

        #[tokio::test]
        async fn manual_saves_same_revision_to_two_slots_with_distinct_identity_and_no_adoption() {
            let resources = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                Arc::new(ProductionSaveFilesystem),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();
            let before_revision = app.session.lock().unwrap().durable_revision().unwrap();

            let first_ticket = app
                .coordinator
                .prepare_application_thumbnail(&app, PreparedThumbnailPurpose::ManualSave)
                .unwrap();
            app.coordinator
                .report_thumbnail_failure(&first_ticket.ticket)
                .unwrap();
            let first = save_manual_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                "First".into(),
                ManualSlotExpectation::Empty,
                first_ticket.ticket,
            )
            .await
            .unwrap();

            let second_ticket = app
                .coordinator
                .prepare_application_thumbnail(&app, PreparedThumbnailPurpose::ManualSave)
                .unwrap();
            app.coordinator
                .report_thumbnail_failure(&second_ticket.ticket)
                .unwrap();
            let second = save_manual_core(
                &app,
                SaveSlotRef::Manual { slot: 2 },
                "Second".into(),
                ManualSlotExpectation::Empty,
                second_ticket.ticket,
            )
            .await
            .unwrap();

            let SaveSlotStatusView::Valid {
                metadata: first_metadata,
            } = first.saved_slot.status
            else {
                panic!("first manual slot must be valid");
            };
            let SaveSlotStatusView::Valid {
                metadata: second_metadata,
            } = second.saved_slot.status
            else {
                panic!("second manual slot must be valid");
            };
            assert_ne!(first_metadata.save_id, second_metadata.save_id);
            assert_ne!(first_metadata.saved_at, second_metadata.saved_at);
            let session = app.session.lock().unwrap();
            assert_eq!(session.durable_revision(), Some(before_revision));
            assert_eq!(session.persistence.autosave_target, None);
        }

        struct LayoutFailureFilesystem;

        impl SaveFilesystem for LayoutFailureFilesystem {
            fn create_dir_all(&self, _path: &Path) -> io::Result<()> {
                Err(io::Error::other("layout unavailable"))
            }
            fn read(&self, _path: &Path) -> io::Result<Vec<u8>> {
                unreachable!()
            }
            fn read_prefix(&self, _path: &Path, _limit: usize) -> io::Result<Vec<u8>> {
                unreachable!()
            }
            fn metadata(&self, _path: &Path) -> io::Result<SaveFileMetadata> {
                unreachable!()
            }
            fn list_dir(&self, _path: &Path) -> io::Result<Vec<PathBuf>> {
                unreachable!()
            }
            fn stage_atomic(
                &self,
                _path: &Path,
                _bytes: &[u8],
            ) -> io::Result<Box<dyn StagedAtomicWrite>> {
                unreachable!()
            }
            fn remove_file(&self, _path: &Path) -> io::Result<()> {
                unreachable!()
            }
            fn sync_dir(&self, _path: &Path) -> io::Result<()> {
                unreachable!()
            }
        }

        struct GuardProbeFilesystem {
            inner: ProductionSaveFilesystem,
            probe: Arc<GuardProbe>,
        }

        struct GuardProbe {
            entered: tokio::sync::Notify,
            released: AtomicBool,
            release: Condvar,
            release_lock: Mutex<()>,
        }

        impl SaveFilesystem for GuardProbeFilesystem {
            fn create_dir_all(&self, path: &Path) -> io::Result<()> {
                self.inner.create_dir_all(path)
            }
            fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
                self.inner.read(path)
            }
            fn read_prefix(&self, path: &Path, limit: usize) -> io::Result<Vec<u8>> {
                self.inner.read_prefix(path, limit)
            }
            fn metadata(&self, path: &Path) -> io::Result<SaveFileMetadata> {
                self.inner.metadata(path)
            }
            fn list_dir(&self, path: &Path) -> io::Result<Vec<PathBuf>> {
                self.probe.entered.notify_one();
                let mut guard = self.probe.release_lock.lock().unwrap();
                while !self.probe.released.load(Ordering::SeqCst) {
                    guard = self.probe.release.wait(guard).unwrap();
                }
                self.inner.list_dir(path)
            }
            fn stage_atomic(
                &self,
                path: &Path,
                bytes: &[u8],
            ) -> io::Result<Box<dyn StagedAtomicWrite>> {
                self.inner.stage_atomic(path, bytes)
            }
            fn remove_file(&self, path: &Path) -> io::Result<()> {
                self.inner.remove_file(path)
            }
            fn sync_dir(&self, path: &Path) -> io::Result<()> {
                self.inner.sync_dir(path)
            }
        }

        #[tokio::test]
        async fn advancing_mutation_returns_wrapped_state_and_schedules_capture() {
            let app = mutation_app();

            let result = run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AutosaveIfAdvanced,
                |engine| engine.enter_sublocation("room"),
            )
            .unwrap();

            assert_eq!(result.state.chapter.id, "chapter_1");
            assert!(result.thumbnail_capture.is_some());
        }

        #[tokio::test]
        async fn unchanged_mutation_returns_wrapped_state_without_capture() {
            let app = mutation_app();

            let result = run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AutosaveIfAdvanced,
                |engine| engine.view(),
            )
            .unwrap();

            assert_eq!(result.state.chapter.id, "chapter_1");
            assert!(result.thumbnail_capture.is_none());
        }

        #[tokio::test]
        async fn coordinator_managed_and_advance_without_saving_never_notify() {
            for policy in [
                MutationPersistencePolicy::CoordinatorManaged,
                MutationPersistencePolicy::AdvanceWithoutSaving,
            ] {
                let app = mutation_app();

                let result =
                    run_gameplay_mutation(&app, policy, |engine| engine.enter_sublocation("room"))
                        .unwrap();

                assert!(result.thumbnail_capture.is_none());
                assert!(matches!(
                    app.coordinator.thumbnail_activity(),
                    crate::game::save::coordinator::ThumbnailActivityView::Idle
                ));
            }
        }

        #[test]
        fn read_only_state_remains_a_bare_view() {
            let app = mutation_app();

            let state: GameStateView = read_game_state(&app).unwrap();

            assert_eq!(state.chapter.id, "chapter_1");
        }

        #[test]
        fn centralized_guard_rejects_missing_game_and_exclusive_persistence() {
            let empty = AppState {
                session: Arc::new(Mutex::new(AppSession::empty())),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::new(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
                persistence: None,
            };
            let missing = run_gameplay_mutation(
                &empty,
                MutationPersistencePolicy::AutosaveIfAdvanced,
                |engine| engine.view(),
            )
            .unwrap_err();
            assert_eq!(missing.code, "gameNotStarted");

            let app = mutation_app();
            app.session.lock().unwrap().persistence.exclusive_intent =
                Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement);
            let exclusive = run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AutosaveIfAdvanced,
                |engine| engine.view(),
            )
            .unwrap_err();
            assert_eq!(exclusive.code, "persistenceOperationInProgress");
        }

        #[tokio::test]
        async fn scheduler_failure_degrades_health_but_returns_committed_state() {
            let app = mutation_app();
            app.coordinator.fail_next_schedule_for_test();

            let result = run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AutosaveIfAdvanced,
                |engine| engine.enter_sublocation("room"),
            )
            .unwrap();

            assert_eq!(result.state.chapter.id, "chapter_1");
            assert!(result.thumbnail_capture.is_none());
            assert!(matches!(
                app.coordinator.persistence_health(),
                PersistenceHealthView::Degraded { .. }
            ));
        }

        #[tokio::test]
        async fn failed_session_candidate_preserves_public_view_and_generation() {
            let app = mutation_app();
            let before_view = serde_json::to_value(read_game_state(&app).unwrap()).unwrap();
            let before_generation = app.session.lock().unwrap().persistence.generation;

            let error = install_session_candidate(&app, Err(GameError::save_read_failed()))
                .await
                .unwrap_err();

            assert_eq!(error.code, "saveReadFailed");
            assert_eq!(
                serde_json::to_value(read_game_state(&app).unwrap()).unwrap(),
                before_view
            );
            assert_eq!(
                app.session.lock().unwrap().persistence.generation,
                before_generation
            );
        }

        #[test]
        fn command_views_use_the_pinned_camel_case_wire_shape() {
            let state = read_game_state(&mutation_app()).unwrap();
            let wrapper = serde_json::to_value(GameplayCommandResultView {
                state,
                thumbnail_capture: None,
            })
            .unwrap();
            assert!(wrapper.get("state").is_some());
            assert_eq!(wrapper["thumbnailCapture"], serde_json::Value::Null);

            let failure_token: PersistenceFailureTokenView =
                serde_json::from_value(serde_json::json!("00000000-0000-4000-8000-000000000000"))
                    .unwrap();
            let preflight = serde_json::to_value(SaveBrowserPreflightView::FlushFailed {
                diagnostic: GameError::save_read_failed(),
                failure_token,
            })
            .unwrap();
            assert_eq!(preflight["type"], "flushFailed");
            assert_eq!(preflight["diagnostic"]["code"], "saveReadFailed");
            assert_eq!(
                preflight["failureToken"],
                "00000000-0000-4000-8000-000000000000"
            );
        }

        #[test]
        fn every_ordinary_mutation_routes_through_the_central_autosave_policy() {
            let source = include_str!("lib.rs");
            for command in [
                "jump_to_scene",
                "advance_dialogue",
                "inspect_hotspot",
                "interview_topic",
                "enter_sublocation",
                "reexamine_evidence",
                "reexamine_statement",
                "ask_interrogation_question",
                "challenge_interrogation_line",
                "present_interrogation_evidence",
                "withdraw_interrogation",
                "resume_interrogation_testimony",
                "complete_interrogation_phase",
            ] {
                let body = function_body(source, command);
                assert!(
                    body.contains("run_gameplay_mutation"),
                    "{command} bypasses the centralized command guard"
                );
                assert!(
                    body.contains("MutationPersistencePolicy::AutosaveIfAdvanced"),
                    "{command} does not select AutosaveIfAdvanced"
                );
                assert!(
                    !body.contains("session.lock()"),
                    "{command} directly locks the application session"
                );
            }

            let acknowledgement = function_body(source, "acknowledge_acquisition_event");
            assert!(acknowledgement.contains("MutationPersistencePolicy::CoordinatorManaged"));
            assert!(!acknowledgement.contains("notify_"));
            let bypass = function_body(source, "confirm_acquisition_without_saving");
            assert!(bypass.contains("MutationPersistencePolicy::AdvanceWithoutSaving"));
            assert!(!bypass.contains("notify_"));
        }

        #[test]
        fn task_10_commands_are_registered_once_and_task_11_exit_commands_are_absent() {
            let source = include_str!("lib.rs");
            let handler_start = source
                .find("tauri::generate_handler![")
                .expect("Tauri handler registration exists");
            let handler_tail = &source[handler_start..];
            let handler_end = handler_tail
                .find("])")
                .expect("Tauri handler registration closes");
            let handler = &handler_tail[..handler_end];

            for command in [
                "list_saves",
                "get_state",
                "get_persistence_status",
                "get_thumbnail_activity",
                "start_game",
                "start_game_without_saving",
                "prepare_save_thumbnail",
                "submit_save_thumbnail",
                "report_save_thumbnail_failure",
                "read_save_thumbnail",
                "save_manual",
                "load_save",
                "load_save_discarding_current",
                "continue_game",
                "delete_save",
                "return_to_title",
                "return_to_title_without_saving",
                "acknowledge_acquisition_event",
                "confirm_acquisition_without_saving",
                "reset_game",
                "list_scenes",
                "jump_to_scene",
                "advance_dialogue",
                "inspect_hotspot",
                "interview_topic",
                "enter_sublocation",
                "reexamine_evidence",
                "reexamine_statement",
                "ask_interrogation_question",
                "challenge_interrogation_line",
                "present_interrogation_evidence",
                "withdraw_interrogation",
                "resume_interrogation_testimony",
                "complete_interrogation_phase",
            ] {
                assert_eq!(
                    registered_command_count(handler, command),
                    1,
                    "{command} must be registered exactly once"
                );
            }
            for command in [
                "get_exit_status",
                "retry_exit",
                "cancel_exit",
                "exit_without_saving",
            ] {
                assert_eq!(
                    registered_command_count(handler, command),
                    0,
                    "{command} belongs to Task 11"
                );
            }

            let production_source = source
                .split("#[cfg(test)]")
                .next()
                .expect("production source precedes tests");
            let old_engine_mutex = ["Mutex<Option<", "GameEngine>>"].concat();
            assert!(
                !production_source.contains(&old_engine_mutex),
                "production handlers must use AppSession, not the old engine mutex"
            );
        }

        fn registered_command_count(handler: &str, command: &str) -> usize {
            handler
                .split(|character: char| character == ',' || character.is_whitespace())
                .filter(|candidate| *candidate == command)
                .count()
        }

        fn function_body<'a>(source: &'a str, name: &str) -> &'a str {
            let marker = format!("fn {name}");
            let start = source
                .find(&marker)
                .unwrap_or_else(|| panic!("missing function {name}"));
            let body_start = source[start..]
                .find('{')
                .map(|offset| start + offset)
                .unwrap_or_else(|| panic!("missing body for {name}"));
            let mut depth = 0usize;
            for (offset, byte) in source[body_start..].bytes().enumerate() {
                match byte {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            return &source[body_start..=body_start + offset];
                        }
                    }
                    _ => {}
                }
            }
            panic!("unterminated body for {name}");
        }
    }

    fn engine(scene_id: &str) -> GameEngine {
        empty_engine_with_scene(investigation_scene_with_intro(scene_id, vec![]), 1)
    }

    fn installed_scene_id(app: &AppState) -> String {
        let session = app.session.lock().unwrap();
        let view = session.engine.as_ref().unwrap().view().unwrap();
        serde_json::to_value(view).unwrap()["scene"]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    fn app() -> AppState {
        AppState {
            session: Arc::new(Mutex::new(AppSession::installed(engine("old"), 40, None))),
            replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
            coordinator: SaveCoordinator::new(),
            resources_dir: PathBuf::new(),
            save_root: PathBuf::new(),
            persistence: None,
        }
    }

    #[tokio::test]
    async fn start_core_rejects_queued_ack_before_allocating_or_installing() {
        let app = app();
        app.session.lock().unwrap().persistence.exclusive_intent =
            Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement);

        let error = tokio::time::timeout(
            Duration::from_millis(50),
            start_game_core(&app, engine("new")),
        )
        .await
        .expect("queued acknowledgement must fail fast")
        .unwrap_err();

        assert_eq!(error.code, "persistenceOperationInProgress");
        assert_eq!(installed_scene_id(&app), "old");

        app.session.lock().unwrap().persistence.exclusive_intent = None;
        start_game_core(&app, engine("new")).await.unwrap();
        assert_eq!(app.session.lock().unwrap().persistence.generation, 1);
        assert_eq!(installed_scene_id(&app), "new");
    }

    #[tokio::test]
    async fn reset_core_rejects_active_ack_without_waiting_for_its_gate() {
        let app = app();
        app.session.lock().unwrap().persistence.exclusive_intent =
            Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement);
        let gate = app.replacement_gate.clone().lock_owned().await;

        let error = tokio::time::timeout(
            Duration::from_millis(50),
            start_game_core(&app, engine("new")),
        )
        .await
        .expect("active acknowledgement must fail before waiting for G")
        .unwrap_err();

        assert_eq!(error.code, "persistenceOperationInProgress");
        assert_eq!(installed_scene_id(&app), "old");
        drop(gate);
    }
}
