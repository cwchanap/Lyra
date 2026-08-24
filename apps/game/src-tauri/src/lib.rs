// Game engine lives under `game::*`. lib.rs only registers Tauri commands.
//
// `pub mod game` (not `mod game`) — integration tests under src-tauri/tests/
// access the module via the public crate API (`lyra_lib::game::*`).
pub mod game;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};

use game::analysis::{AnalysisActionToken, AnalysisDraft};
#[cfg(feature = "e2e")]
use game::e2e_checkpoints::{build_checkpoint, CheckpointId, CheckpointProjection};
use game::save::application::{AppSession, ApplicationPersistence};
use game::save::capture::capture_checkpoint;
use game::save::coordinator::{
    ApplicationExit, ExitRequestSource, ExitStatusView, FlushOperation, PersistenceBypassOperation,
    PersistenceFailureTokenView, PersistenceHealthView, PreparedThumbnailPurpose, SaveCoordinator,
    ThumbnailActivityView, ThumbnailCapturePurpose, ThumbnailCaptureRequestView,
};
#[cfg(feature = "e2e")]
use game::save::e2e_faults::{E2ePersistenceFaultBoundary, E2ePersistenceFaultState};
use game::save::restore::{
    build_restore_candidate, load_current_definitions, RestoredGameCandidate,
};
use game::save::schema::{
    validate_manual_display_name, SaveBrowserView, SaveDiagnosticView, SaveDiscoveryStatusView,
    SaveSlotRef, SaveSlotStatusView, SaveSlotView, MAX_THUMBNAIL_BYTES,
};
#[cfg(feature = "e2e")]
use game::save::storage::with_e2e_persistence_faults;
use game::save::storage::{
    commit_prepared_slot_write, delete_slot, ensure_save_layout, prepare_slot_write,
    read_save_envelope, read_save_thumbnail as read_save_thumbnail_from_storage, resolve_save_root,
    select_continue_candidate, ManualSlotExpectation, OccupiedSlotExpectation,
    ProductionSaveFilesystem, SaveDiscoveryContext, SaveFilesystem, SlotWriteRequest,
    ThumbnailWrite, PRODUCTION_APP_IDENTIFIER,
};
use game::view::SceneView;
use game::{GameEngine, GameError, GameStateView, QueueToken, SceneNavigationIndex};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameplayCommandResultView {
    pub(crate) state: GameStateView,
    pub(crate) thumbnail_capture: Option<ThumbnailCaptureRequestView>,
}

#[cfg(feature = "e2e")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct E2eLoadCheckpointResult {
    pub(crate) generation: u64,
    pub(crate) state: GameStateView,
    pub(crate) projection: CheckpointProjection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualSaveResultView {
    pub(crate) saved_slot: SaveSlotView,
    pub(crate) browser: SaveBrowserView,
    pub(crate) thumbnail_activity: ThumbnailActivityView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Part B fills the save-browser commands.
pub(crate) struct SaveBrowserOpenResultView {
    pub(crate) browser: SaveBrowserView,
    pub(crate) continue_candidate: Option<SaveSlotRef>,
    pub(crate) preflight: SaveBrowserPreflightView,
}

const PERSISTENCE_STATUS_CHANGED_EVENT: &str = "persistence-status-changed";
const THUMBNAIL_ACTIVITY_CHANGED_EVENT: &str = "thumbnail-activity-changed";
const EXIT_STATUS_CHANGED_EVENT: &str = "exit-status-changed";
const MAIN_WINDOW_LABEL: &str = "main";

#[cfg(all(test, feature = "e2e"))]
mod e2e_persistence_fault_command_tests {
    use super::e2e_set_persistence_fault_core;
    use crate::game::save::coordinator::SaveCoordinator;
    use crate::game::save::e2e_faults::E2ePersistenceFaultBoundary;

    #[test]
    fn command_core_accepts_only_one_pending_closed_fault() {
        let coordinator = SaveCoordinator::new();

        e2e_set_persistence_fault_core(
            &coordinator,
            E2ePersistenceFaultBoundary::EnvelopeReplace,
            1,
        )
        .unwrap();

        assert!(e2e_set_persistence_fault_core(
            &coordinator,
            E2ePersistenceFaultBoundary::ThumbnailInstall,
            1,
        )
        .is_err());
    }
}

#[cfg(all(test, feature = "e2e"))]
mod e2e_checkpoint_command_tests {
    use super::{build_app_state_with_storage, e2e_load_checkpoint_core, ProductionSaveFilesystem};
    use crate::game::e2e_checkpoints::CheckpointId;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[tokio::test]
    async fn command_builds_replaces_and_returns_one_consistent_checkpoint_transaction() {
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/scenes");
        let save_root = tempfile::tempdir().unwrap();
        let state = build_app_state_with_storage(
            resources,
            save_root.path().to_path_buf(),
            Arc::new(ProductionSaveFilesystem),
        )
        .unwrap();

        let result = e2e_load_checkpoint_core(&state, CheckpointId::SceneNavigationEligible)
            .await
            .unwrap();

        assert_eq!(result.generation, 1);
        assert!(result.projection.scene_navigation_eligible);
        assert_eq!(result.projection.scene_id, "investigation_scene_1");
        assert_eq!(result.state.chapter.id, result.projection.chapter_id);
        let session = state.session.lock().unwrap();
        assert_eq!(session.persistence.generation, result.generation);
        assert_eq!(
            session.persistence.flush_baseline_revision,
            result.projection.durable_revision
        );
        assert_eq!(
            session.durable_revision(),
            Some(result.projection.durable_revision)
        );
        assert_eq!(
            serde_json::to_value(session.engine.as_ref().unwrap().view().unwrap()).unwrap(),
            serde_json::to_value(result.state).unwrap()
        );
    }
}

#[derive(Debug, Serialize)]
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
    AutosaveIfAdvancedWithoutThumbnail,
    CoordinatorManaged,
}

#[doc(hidden)]
pub struct AppState {
    // Task 9 exposed one session mutex. Task 10 wraps that exact mutex in Arc
    // so the disk backend can share it without introducing duplicate state.
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) operation_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) coordinator: SaveCoordinator,
    pub(crate) resources_dir: PathBuf,
    #[allow(dead_code)] // Part B2 load/delete commands consume the configured root directly.
    pub(crate) save_root: PathBuf,
    pub(crate) persistence: Option<Arc<ApplicationPersistence>>,
}

fn build_app_state_with_storage(
    resources_dir: PathBuf,
    save_root: PathBuf,
    fs: Arc<dyn SaveFilesystem>,
) -> Result<AppState, GameError> {
    #[cfg(feature = "e2e")]
    let (fs, e2e_persistence_faults): (Arc<dyn SaveFilesystem>, Arc<E2ePersistenceFaultState>) = {
        let faults = Arc::new(E2ePersistenceFaultState::new());
        (with_e2e_persistence_faults(fs, Arc::clone(&faults)), faults)
    };
    let definitions = Arc::new(load_current_definitions(&resources_dir)?);
    let session = Arc::new(Mutex::new(AppSession::empty()));
    let operation_gate = Arc::new(tokio::sync::Mutex::new(()));
    let initial_error = ensure_save_layout(fs.as_ref(), &save_root).err();
    let persistence = Arc::new(ApplicationPersistence {
        session: Arc::clone(&session),
        operation_gate: Arc::clone(&operation_gate),
        fs,
        root: save_root.clone(),
        discovery: SaveDiscoveryContext {
            resources_dir: resources_dir.clone(),
            definitions,
        },
        last_saved_at: Mutex::new(None),
        availability_error: Mutex::new(initial_error.clone()),
    });
    let coordinator = SaveCoordinator::with_application(
        persistence.clone(),
        Arc::clone(&session),
        Arc::clone(&operation_gate),
    );
    #[cfg(feature = "e2e")]
    let coordinator = coordinator.with_e2e_persistence_faults(e2e_persistence_faults);
    let _ = persistence
        .clone()
        .enqueue_orphan_cleanup(coordinator.clone());
    if let Some(diagnostic) = initial_error {
        coordinator.publish_persistence_health(PersistenceHealthView::Degraded { diagnostic });
    }
    Ok(AppState {
        session,
        operation_gate,
        coordinator,
        resources_dir,
        save_root,
        persistence: Some(persistence),
    })
}

fn unavailable_error() -> GameError {
    GameError::unavailable()
}

fn session_persistence(state: &AppState) -> Result<&ApplicationPersistence, GameError> {
    state
        .persistence
        .as_deref()
        .ok_or_else(GameError::unavailable)
}

// Publishes the terminal health for a completed storage write and retries
// any current orphan-cleanup diagnostic after the successful operation.
fn publish_write_outcome_health(
    state: &AppState,
    session_generation: u64,
    cleanup_diagnostic: &Option<GameError>,
) -> Result<(), GameError> {
    state
        .coordinator
        .publish_storage_write_health(session_generation, cleanup_diagnostic.clone())
}

fn read_game_state(state: &AppState) -> Result<GameStateView, GameError> {
    let session = state.session.lock().map_err(|_| unavailable_error())?;
    session
        .engine
        .as_ref()
        .ok_or_else(GameError::game_not_started)?
        .view()
}

fn handle_close_requested(
    label: &str,
    prevent_close: impl FnOnce(),
    schedule: impl FnOnce(ExitRequestSource) -> Result<(), GameError>,
) -> Result<(), GameError> {
    if label == MAIN_WINDOW_LABEL {
        prevent_close();
        schedule(ExitRequestSource::WindowClose)?;
    }
    Ok(())
}

fn handle_exit_requested(
    code: Option<i32>,
    coordinator: &SaveCoordinator,
    prevent_exit: impl FnOnce(),
    schedule: impl FnOnce(ExitRequestSource) -> Result<(), GameError>,
) -> Result<(), GameError> {
    if code.is_some() && coordinator.consume_programmatic_exit_bypass() {
        return Ok(());
    }
    prevent_exit();
    schedule(ExitRequestSource::ApplicationQuit)
}

fn run_gameplay_mutation_selecting_policy(
    state: &AppState,
    select_policy: impl FnOnce(&GameStateView) -> MutationPersistencePolicy,
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

    if after_revision > before_revision {
        let notification = match select_policy(&committed) {
            MutationPersistencePolicy::AutosaveIfAdvanced => {
                state
                    .coordinator
                    .notify_committed(committed, session_generation, after_revision)
            }
            MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail => state
                .coordinator
                .notify_committed_without_thumbnail(committed, session_generation, after_revision),
            MutationPersistencePolicy::CoordinatorManaged => {
                return Ok(GameplayCommandResultView {
                    state: committed,
                    thumbnail_capture: None,
                });
            }
        };
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

fn run_gameplay_mutation(
    state: &AppState,
    policy: MutationPersistencePolicy,
    mutation: impl FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation_selecting_policy(state, |_| policy, mutation)
}

fn finish_coordinator_mutation(
    state: GameStateView,
    policy: MutationPersistencePolicy,
) -> Result<GameplayCommandResultView, GameError> {
    match policy {
        MutationPersistencePolicy::CoordinatorManaged => Ok(GameplayCommandResultView {
            state,
            thumbnail_capture: None,
        }),
        MutationPersistencePolicy::AutosaveIfAdvanced
        | MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail => {
            Err(GameError::unavailable())
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

#[cfg(test)]
async fn install_session_candidate(
    state: &AppState,
    candidate: Result<(GameEngine, Option<SaveSlotRef>), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    let (engine, autosave_target) = candidate?;
    let state = session_persistence(state)?
        .install_session(&state.coordinator, engine, autosave_target)
        .await?;
    Ok(GameplayCommandResultView {
        state,
        thumbnail_capture: None,
    })
}

#[cfg(test)]
async fn start_game_core(
    state: &AppState,
    engine: GameEngine,
) -> Result<GameplayCommandResultView, GameError> {
    install_session_candidate(state, Ok((engine, None))).await
}

async fn start_game_with_persistence_core(
    state: &AppState,
) -> Result<GameplayCommandResultView, GameError> {
    let persistence = state
        .persistence
        .as_ref()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    let _ = persistence.discover();
    if let Some(error) = persistence.availability_error() {
        return Err(state.coordinator.challenge_current_discovery_failure(
            state,
            PersistenceBypassOperation::StartWithoutSaving,
            error,
        )?);
    }
    let expected = state.coordinator.transition_identity(state)?;
    if expected.durable_revision.is_some() {
        if let Err(error) = state
            .coordinator
            .flush_session(state, FlushOperation::InGameLoad)
            .await
        {
            let error = challengeable_flush_failure(error)?;
            return Err(state.coordinator.challenge_current_session_error(
                state,
                PersistenceBypassOperation::StartWithoutSaving,
                error,
            )?);
        }
    }
    let engine = GameEngine::new_started(state.resources_dir.clone())?;
    let state_view = session_persistence(state)?
        .install_session_if_current(&state.coordinator, engine, None, expected)
        .await?;
    Ok(GameplayCommandResultView {
        state: state_view,
        thumbnail_capture: None,
    })
}

async fn start_game_without_saving_core(
    state: &AppState,
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    let engine = GameEngine::new_started(state.resources_dir.clone())?;
    let expected = state
        .coordinator
        .consume_current_start_without_saving_failure(state, &failure_token)?;
    let state_view = session_persistence(state)?
        .install_session_if_current(&state.coordinator, engine, None, expected)
        .await?;
    finish_coordinator_mutation(state_view, MutationPersistencePolicy::CoordinatorManaged)
}

#[tauri::command]
async fn start_game(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    start_game_with_persistence_core(&state).await
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

fn persistence_status_snapshot(coordinator: &SaveCoordinator) -> PersistenceHealthView {
    coordinator.persistence_health()
}

fn thumbnail_activity_snapshot(coordinator: &SaveCoordinator) -> ThumbnailActivityView {
    coordinator.thumbnail_activity()
}

fn exit_status_snapshot(coordinator: &SaveCoordinator) -> ExitStatusView {
    coordinator.exit_status()
}

#[cfg(feature = "e2e")]
fn e2e_set_persistence_fault_core(
    coordinator: &SaveCoordinator,
    boundary: E2ePersistenceFaultBoundary,
    occurrence_count: u8,
) -> Result<(), GameError> {
    coordinator.arm_e2e_persistence_fault(boundary, occurrence_count)
}

#[cfg(feature = "e2e")]
async fn e2e_load_checkpoint_core(
    state: &AppState,
    id: CheckpointId,
) -> Result<E2eLoadCheckpointResult, GameError> {
    let checkpoint = build_checkpoint(state.resources_dir.clone(), id)?;
    let projection = checkpoint.projection;
    let replacement = session_persistence(state)?
        .replace_session_for_e2e(&state.coordinator, checkpoint.engine)
        .await?;
    Ok(E2eLoadCheckpointResult {
        generation: replacement.generation,
        state: replacement.state,
        projection,
    })
}

#[cfg(feature = "e2e")]
#[tauri::command]
async fn e2e_load_checkpoint(
    state: tauri::State<'_, AppState>,
    id: CheckpointId,
) -> Result<E2eLoadCheckpointResult, GameError> {
    e2e_load_checkpoint_core(&state, id).await
}

#[cfg(feature = "e2e")]
#[tauri::command]
fn e2e_set_persistence_fault(
    state: tauri::State<'_, AppState>,
    boundary: E2ePersistenceFaultBoundary,
    occurrence_count: u8,
) -> Result<(), GameError> {
    e2e_set_persistence_fault_core(&state.coordinator, boundary, occurrence_count)
}

#[cfg(feature = "e2e")]
#[tauri::command]
async fn e2e_request_application_quit(
    _state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), GameError> {
    // WebDriver key events terminate at the webview and cannot exercise the
    // macOS application-level Command-Q route. AppHandle::exit emits the same
    // RunEvent::ExitRequested event that the native quit action produces; the
    // lifecycle handler below prevents that first request, flushes, then uses
    // its one-shot programmatic bypass to complete the exit.
    app.exit(0);
    Ok(())
}

fn bind_persistence_status_events(
    coordinator: &SaveCoordinator,
    emit: impl Fn(&'static str, serde_json::Value) + Send + Sync + 'static,
) {
    let emit = Arc::new(emit);
    let health_emitter = Arc::clone(&emit);
    let activity_emitter = Arc::clone(&emit);
    let exit_emitter = emit;
    coordinator.subscribe(
        move |view| {
            if let Ok(payload) = serde_json::to_value(view) {
                health_emitter(PERSISTENCE_STATUS_CHANGED_EVENT, payload);
            }
        },
        move |view| {
            if let Ok(payload) = serde_json::to_value(view) {
                activity_emitter(THUMBNAIL_ACTIVITY_CHANGED_EVENT, payload);
            }
        },
    );
    coordinator.subscribe_exit_status(move |view| {
        if let Ok(payload) = serde_json::to_value(view) {
            exit_emitter(EXIT_STATUS_CHANGED_EVENT, payload);
        }
    });
}

#[tauri::command]
fn get_persistence_status(state: tauri::State<'_, AppState>) -> PersistenceHealthView {
    persistence_status_snapshot(&state.coordinator)
}

#[tauri::command]
fn get_thumbnail_activity(state: tauri::State<'_, AppState>) -> ThumbnailActivityView {
    thumbnail_activity_snapshot(&state.coordinator)
}

fn get_exit_status_core(state: &AppState) -> ExitStatusView {
    exit_status_snapshot(&state.coordinator)
}

#[tauri::command]
fn get_exit_status(state: tauri::State<'_, AppState>) -> ExitStatusView {
    get_exit_status_core(&state)
}

fn application_exit(app: tauri::AppHandle) -> Arc<dyn ApplicationExit> {
    Arc::new(TauriApplicationExit { app })
}

async fn cancel_persistence_failure_core(
    state: &AppState,
    failure_token: PersistenceFailureTokenView,
) -> Result<(), GameError> {
    state
        .coordinator
        .cancel_persistence_failure(state, failure_token)
        .await
}

#[tauri::command]
async fn cancel_persistence_failure(
    state: tauri::State<'_, AppState>,
    failure_token: PersistenceFailureTokenView,
) -> Result<(), GameError> {
    cancel_persistence_failure_core(&state, failure_token).await
}

fn retry_exit_core(
    state: &AppState,
    exit: Arc<dyn ApplicationExit>,
    failure_token: PersistenceFailureTokenView,
) -> Result<ExitStatusView, GameError> {
    state.coordinator.retry_exit(exit, failure_token)?;
    Ok(exit_status_snapshot(&state.coordinator))
}

#[tauri::command]
fn retry_exit(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    failure_token: PersistenceFailureTokenView,
) -> Result<ExitStatusView, GameError> {
    retry_exit_core(&state, application_exit(app), failure_token)
}

fn cancel_exit_core(
    state: &AppState,
    failure_token: PersistenceFailureTokenView,
) -> Result<ExitStatusView, GameError> {
    state.coordinator.cancel_exit(failure_token)
}

#[tauri::command]
fn cancel_exit(
    state: tauri::State<'_, AppState>,
    failure_token: PersistenceFailureTokenView,
) -> Result<ExitStatusView, GameError> {
    cancel_exit_core(&state, failure_token)
}

fn exit_without_saving_core(
    state: &AppState,
    exit: Arc<dyn ApplicationExit>,
    failure_token: PersistenceFailureTokenView,
) -> Result<(), GameError> {
    state.coordinator.exit_without_saving(exit, failure_token)
}

#[tauri::command]
fn exit_without_saving(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    failure_token: PersistenceFailureTokenView,
) -> Result<(), GameError> {
    exit_without_saving_core(&state, application_exit(app), failure_token)
}

fn challengeable_flush_failure(error: GameError) -> Result<GameError, GameError> {
    if error.is_persistence_operation_in_progress() {
        Err(error)
    } else {
        Ok(error)
    }
}

async fn list_saves_core(
    state: &AppState,
    discover: impl FnOnce() -> SaveBrowserView,
) -> Result<SaveBrowserOpenResultView, GameError> {
    list_saves_core_impl(state, discover, |_| Ok(()), |_, _| Ok(())).await
}

async fn list_saves_core_impl(
    state: &AppState,
    discover: impl FnOnce() -> SaveBrowserView,
    before_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
    after_flush_error: impl FnOnce(&AppState, &GameError) -> Result<(), GameError>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let has_active_session = {
        let session = state.session.lock().map_err(|_| unavailable_error())?;
        session.ensure_persistence_available()?;
        session.engine.is_some()
    };
    let flush_error = if has_active_session {
        before_flush(state)?;
        match state
            .coordinator
            .flush_session(state, FlushOperation::InGameLoad)
            .await
        {
            Ok(_) => None,
            Err(error) => {
                let classified = challengeable_flush_failure(error);
                let original = match &classified {
                    Ok(error) | Err(error) => error,
                };
                after_flush_error(state, original)?;
                Some(classified?)
            }
        }
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

#[cfg(test)]
async fn list_saves_core_with_flush_hooks(
    state: &AppState,
    discover: impl FnOnce() -> SaveBrowserView,
    before_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
    after_flush_error: impl FnOnce(&AppState, &GameError) -> Result<(), GameError>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    list_saves_core_impl(state, discover, before_flush, after_flush_error).await
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
async fn start_game_without_saving(
    state: tauri::State<'_, AppState>,
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    start_game_without_saving_core(&state, failure_token).await
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

pub(crate) struct RawThumbnailHeader<'a> {
    name: &'a [u8],
    value: &'a [u8],
}

impl<'a> RawThumbnailHeader<'a> {
    pub(crate) fn new(name: &'a [u8], value: &'a [u8]) -> Self {
        Self { name, value }
    }
}

pub(crate) fn validate_thumbnail_submission<'a>(
    headers: &'a [RawThumbnailHeader<'a>],
    body: &[u8],
) -> Result<&'a str, GameError> {
    const TICKET_HEADER: &[u8] = b"x-lyra-thumbnail-ticket";
    let mut matches = headers
        .iter()
        .filter(|header| header.name.eq_ignore_ascii_case(TICKET_HEADER));
    let ticket_header = matches
        .next()
        .filter(|_| matches.next().is_none())
        .ok_or_else(GameError::stale_thumbnail_ticket)?;
    let ticket = std::str::from_utf8(ticket_header.value)
        .map_err(|_| GameError::stale_thumbnail_ticket())?;
    let parsed = uuid::Uuid::parse_str(ticket).map_err(|_| GameError::stale_thumbnail_ticket())?;
    if parsed.get_version_num() != 4 || parsed.hyphenated().to_string() != ticket {
        return Err(GameError::stale_thumbnail_ticket());
    }
    if body.len() > MAX_THUMBNAIL_BYTES {
        return Err(GameError::thumbnail_png_too_large());
    }
    Ok(ticket)
}

pub(crate) fn submit_save_thumbnail_core(
    coordinator: &SaveCoordinator,
    headers: &[RawThumbnailHeader<'_>],
    body: &[u8],
) -> Result<ThumbnailActivityView, GameError> {
    let ticket = validate_thumbnail_submission(headers, body)?;
    coordinator.submit_thumbnail(ticket, body)
}

#[tauri::command]
fn submit_save_thumbnail(
    state: tauri::State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<ThumbnailActivityView, GameError> {
    let ticket_headers = request
        .headers()
        .get_all("x-lyra-thumbnail-ticket")
        .iter()
        .map(|value| RawThumbnailHeader::new(b"x-lyra-thumbnail-ticket", value.as_bytes()))
        .collect::<Vec<_>>();
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(GameError::thumbnail_png_malformed());
    };
    submit_save_thumbnail_core(&state.coordinator, &ticket_headers, body)
}

#[tauri::command]
fn report_save_thumbnail_failure(
    state: tauri::State<'_, AppState>,
    ticket: String,
) -> Result<ThumbnailActivityView, GameError> {
    state.coordinator.report_thumbnail_failure(&ticket)
}

fn read_save_thumbnail_core(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: &str,
) -> Result<Vec<u8>, GameError> {
    let persistence = state
        .persistence
        .as_ref()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    read_save_thumbnail_from_storage(
        persistence.fs.as_ref(),
        &persistence.root,
        reference,
        observed_save_id,
    )
}

#[tauri::command]
fn read_save_thumbnail(
    state: tauri::State<'_, AppState>,
    reference: SaveSlotRef,
    observed_save_id: String,
) -> Result<tauri::ipc::Response, GameError> {
    read_save_thumbnail_core(&state, reference, &observed_save_id).map(tauri::ipc::Response::new)
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
            capture_checkpoint(engine)?,
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
    state.coordinator.publish_persistence_health_for_session(
        session_generation,
        PersistenceHealthView::Pending,
    )?;
    let outcome = match persistence
        .run_storage_write_if_session_current(session_generation, move |fs, root| {
            prepare_slot_write(fs, root, request)
                .and_then(|prepared| commit_prepared_slot_write(fs, root, prepared))
        })
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            let _ = state.coordinator.publish_persistence_health_for_session(
                session_generation,
                PersistenceHealthView::Degraded {
                    diagnostic: error.clone(),
                },
            );
            return Err(error);
        }
    };
    publish_write_outcome_health(state, session_generation, &outcome.cleanup_diagnostic)?;
    let browser = persistence.discover();
    state
        .coordinator
        .complete_discovery_attempt_for_session(session_generation)?;
    let saved_slot = browser
        .slots
        .iter()
        .find(|slot| slot.reference == reference)
        .cloned()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    let rediscovered_save_id = match &saved_slot.status {
        SaveSlotStatusView::Valid { metadata } => &metadata.save_id,
        _ => return Err(GameError::save_write_failed()),
    };
    if rediscovered_save_id != &save_id {
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

fn build_selected_candidate(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: &str,
) -> Result<RestoredGameCandidate, GameError> {
    let persistence = state
        .persistence
        .as_ref()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    let envelope = read_save_envelope(
        persistence.fs.as_ref(),
        &persistence.root,
        reference,
        observed_save_id,
    )?;
    let candidate = build_restore_candidate(
        persistence.discovery.resources_dir.clone(),
        &persistence.discovery.definitions,
        envelope,
    )?;
    if candidate.source != reference || candidate.save_id != observed_save_id {
        return Err(GameError::stale_save_selection());
    }
    Ok(candidate)
}

fn fresh_ready_browser(state: &AppState) -> Result<SaveBrowserOpenResultView, GameError> {
    let browser = state
        .persistence
        .as_ref()
        .map(|persistence| persistence.discover())
        .unwrap_or_else(unavailable_save_browser);
    state.coordinator.complete_discovery_attempt()?;
    Ok(SaveBrowserOpenResultView {
        continue_candidate: select_continue_candidate(&browser.slots),
        browser,
        preflight: SaveBrowserPreflightView::Ready,
    })
}

async fn load_save_core(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    load_save_core_impl(state, reference, observed_save_id, |_| Ok(())).await
}

async fn load_save_core_impl(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: String,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    let expected = state.coordinator.transition_identity(state)?;
    let has_active_session = expected.durable_revision.is_some();
    if has_active_session {
        if let Err(error) = state
            .coordinator
            .flush_session(state, FlushOperation::InGameLoad)
            .await
        {
            let error = challengeable_flush_failure(error)?;
            return Err(state.coordinator.challenge_current_selected_save_failure(
                state,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                reference,
                &observed_save_id,
                error,
            )?);
        }
    }
    after_flush(state)?;
    let candidate = build_selected_candidate(state, reference, &observed_save_id)?;
    let state_view = session_persistence(state)?
        .install_session_if_current(
            &state.coordinator,
            candidate.engine,
            Some(candidate.source),
            expected,
        )
        .await?;
    finish_coordinator_mutation(state_view, MutationPersistencePolicy::CoordinatorManaged)
}

#[cfg(test)]
async fn load_save_core_with_post_flush_hook(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: String,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    load_save_core_impl(state, reference, observed_save_id, after_flush).await
}

#[tauri::command]
async fn load_save(
    state: tauri::State<'_, AppState>,
    reference: SaveSlotRef,
    observed_save_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    load_save_core(&state, reference, observed_save_id).await
}

async fn load_save_discarding_current_core(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: String,
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    let expected = state.coordinator.consume_current_selected_save_failure(
        state,
        &failure_token,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        reference,
        &observed_save_id,
    )?;
    let candidate = build_selected_candidate(state, reference, &observed_save_id)?;
    let state_view = session_persistence(state)?
        .install_session_if_current(
            &state.coordinator,
            candidate.engine,
            Some(candidate.source),
            expected,
        )
        .await?;
    finish_coordinator_mutation(state_view, MutationPersistencePolicy::CoordinatorManaged)
}

#[tauri::command]
async fn load_save_discarding_current(
    state: tauri::State<'_, AppState>,
    reference: SaveSlotRef,
    observed_save_id: String,
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    load_save_discarding_current_core(&state, reference, observed_save_id, failure_token).await
}

async fn continue_game_core(state: &AppState) -> Result<GameplayCommandResultView, GameError> {
    continue_game_core_impl(state, |_| Ok(())).await
}

async fn continue_game_core_impl(
    state: &AppState,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    let expected = state.coordinator.transition_identity(state)?;
    let has_active_session = expected.durable_revision.is_some();
    if has_active_session {
        if let Err(error) = state
            .coordinator
            .flush_session(state, FlushOperation::InGameLoad)
            .await
        {
            let error = challengeable_flush_failure(error)?;
            return Err(state.coordinator.challenge_current_discovery_failure(
                state,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                error,
            )?);
        }
    }
    after_flush(state)?;
    let persistence = state
        .persistence
        .as_ref()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    let browser = persistence.discover();
    state.coordinator.complete_discovery_attempt()?;
    if let SaveDiscoveryStatusView::Unavailable { diagnostic } = browser.discovery {
        return Err(diagnostic);
    }
    let reference =
        select_continue_candidate(&browser.slots).ok_or_else(GameError::stale_save_selection)?;
    let selected = browser
        .slots
        .iter()
        .find(|slot| slot.reference == reference)
        .ok_or_else(GameError::stale_save_selection)?;
    let observed_save_id = match &selected.status {
        SaveSlotStatusView::Valid { metadata } => metadata.save_id.clone(),
        SaveSlotStatusView::Invalid { diagnostic, .. } => return Err(diagnostic.clone()),
        SaveSlotStatusView::Empty => return Err(GameError::stale_save_selection()),
    };
    let candidate = build_selected_candidate(state, reference, &observed_save_id)?;
    let state_view = session_persistence(state)?
        .install_session_if_current(
            &state.coordinator,
            candidate.engine,
            Some(candidate.source),
            expected,
        )
        .await?;
    finish_coordinator_mutation(state_view, MutationPersistencePolicy::CoordinatorManaged)
}

#[cfg(test)]
async fn continue_game_core_with_post_flush_hook(
    state: &AppState,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    continue_game_core_impl(state, after_flush).await
}

#[tauri::command]
async fn continue_game(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    continue_game_core(&state).await
}

async fn delete_save_core(
    state: &AppState,
    reference: SaveSlotRef,
    expectation: OccupiedSlotExpectation,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let session_generation = {
        let session = state.session.lock().map_err(|_| unavailable_error())?;
        session.ensure_persistence_available()?;
        session.persistence.generation
    };
    let persistence = state
        .persistence
        .as_ref()
        .cloned()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    state.coordinator.publish_persistence_health_for_session(
        session_generation,
        PersistenceHealthView::Pending,
    )?;
    let outcome = match persistence
        .run_storage_write_if_session_current(session_generation, move |fs, root| {
            delete_slot(fs, root, reference, expectation)
        })
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            let _ = state.coordinator.publish_persistence_health_for_session(
                session_generation,
                PersistenceHealthView::Degraded {
                    diagnostic: error.clone(),
                },
            );
            return Err(error);
        }
    };
    publish_write_outcome_health(state, session_generation, &outcome.cleanup_diagnostic)?;
    let browser = persistence.discover();
    state
        .coordinator
        .complete_discovery_attempt_for_session(session_generation)?;
    Ok(SaveBrowserOpenResultView {
        continue_candidate: select_continue_candidate(&browser.slots),
        browser,
        preflight: SaveBrowserPreflightView::Ready,
    })
}

#[tauri::command]
async fn delete_save(
    state: tauri::State<'_, AppState>,
    reference: SaveSlotRef,
    expectation: OccupiedSlotExpectation,
) -> Result<SaveBrowserOpenResultView, GameError> {
    delete_save_core(&state, reference, expectation).await
}

async fn return_to_title_core(state: &AppState) -> Result<SaveBrowserOpenResultView, GameError> {
    return_to_title_core_impl(state, |_| Ok(())).await
}

async fn return_to_title_core_impl(
    state: &AppState,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let expected = state.coordinator.transition_identity(state)?;
    if let Err(error) = state
        .coordinator
        .flush_session(state, FlushOperation::ReturnToTitle)
        .await
    {
        let error = challengeable_flush_failure(error)?;
        return Err(state.coordinator.challenge_current_session_error(
            state,
            PersistenceBypassOperation::ReturnWithoutSaving,
            error,
        )?);
    }
    after_flush(state)?;
    session_persistence(state)?
        .clear_session_if_current(&state.coordinator, expected)
        .await?;
    fresh_ready_browser(state)
}

#[cfg(test)]
async fn return_to_title_core_with_post_flush_hook(
    state: &AppState,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    return_to_title_core_impl(state, after_flush).await
}

#[tauri::command]
async fn return_to_title(
    state: tauri::State<'_, AppState>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    return_to_title_core(&state).await
}

async fn return_to_title_without_saving_core(
    state: &AppState,
    failure_token: PersistenceFailureTokenView,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let expected = state.coordinator.consume_current_session_failure(
        state,
        &failure_token,
        PersistenceBypassOperation::ReturnWithoutSaving,
    )?;
    session_persistence(state)?
        .clear_session_if_current(&state.coordinator, expected)
        .await?;
    fresh_ready_browser(state)
}

#[tauri::command]
async fn return_to_title_without_saving(
    state: tauri::State<'_, AppState>,
    failure_token: PersistenceFailureTokenView,
) -> Result<SaveBrowserOpenResultView, GameError> {
    return_to_title_without_saving_core(&state, failure_token).await
}

fn acknowledge_acquisition_event_core(
    state: &AppState,
    event_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.acknowledge_acquisition_event(&event_id),
    )
}

#[tauri::command]
fn acknowledge_acquisition_event(
    state: tauri::State<'_, AppState>,
    event_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    acknowledge_acquisition_event_core(&state, event_id)
}

#[tauri::command]
fn list_scenes(app: tauri::AppHandle) -> Result<SceneNavigationIndex, GameError> {
    let resources_dir = resolve_scenes_dir(&app)?;
    GameEngine::scene_navigation_index(resources_dir)
}

fn dialogue_persistence_policy(
    source_chapter_id: &str,
    source_scene_id: &str,
    committed: &GameStateView,
) -> MutationPersistencePolicy {
    match &committed.scene {
        SceneView::Interrogation { id, .. }
            if committed.chapter.id == source_chapter_id && id == source_scene_id =>
        {
            MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
        }
        _ => MutationPersistencePolicy::AutosaveIfAdvanced,
    }
}

fn advance_dialogue_core(
    state: &AppState,
    expected: QueueToken,
) -> Result<GameplayCommandResultView, GameError> {
    // Scene IDs are chapter-scoped (see `StoryLocationIndex`), so the
    // "same interrogation" check must compare the full (chapter_id, scene_id)
    // identity. `advance_dialogue` can exhaust a queue and call
    // `advance_scene`, which may move into the next chapter within this same
    // mutation; if the next scene reuses the source `scene_id`, comparing only
    // the scene ID would wrongly suppress the entry/exit thumbnail milestone.
    // The source identity is captured from the engine before the mutation runs
    // and threaded to the policy selector via a shared cell.
    use std::cell::Cell;
    let source_identity: Cell<Option<(String, String)>> = Cell::new(None);
    run_gameplay_mutation_selecting_policy(
        state,
        {
            let cell = &source_identity;
            move |committed| {
                let (chapter_id, scene_id) = cell.take().unwrap_or_default();
                dialogue_persistence_policy(&chapter_id, &scene_id, committed)
            }
        },
        {
            let cell = &source_identity;
            move |engine| {
                let identity = engine.current_scene_identity();
                cell.set(Some(identity));
                engine.advance_dialogue(expected)
            }
        },
    )
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
    advance_dialogue_core(&state, expected)
}

#[tauri::command]
fn select_analysis_board(
    state: tauri::State<'_, AppState>,
    expected: AnalysisActionToken,
    board_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.select_analysis_board(expected, board_id),
    )
}

#[tauri::command]
fn update_analysis_draft(
    state: tauri::State<'_, AppState>,
    expected: AnalysisActionToken,
    draft: AnalysisDraft,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.update_analysis_draft(expected, draft),
    )
}

#[tauri::command]
fn submit_analysis_board(
    state: tauri::State<'_, AppState>,
    expected: AnalysisActionToken,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.submit_analysis_board(expected),
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
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.ask_interrogation_question(&question_id),
    )
}

fn challenge_interrogation_line_core(
    state: &AppState,
    line_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.challenge_interrogation_line(&line_id),
    )
}

#[tauri::command]
fn challenge_interrogation_line(
    state: tauri::State<'_, AppState>,
    line_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    challenge_interrogation_line_core(&state, line_id)
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
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        |engine| engine.present_interrogation_evidence(&line_id, &item_kind, &item_id),
    )
}

#[tauri::command]
fn withdraw_interrogation(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
        GameEngine::withdraw_interrogation,
    )
}

#[tauri::command]
fn resume_interrogation_testimony(
    state: tauri::State<'_, AppState>,
) -> Result<GameplayCommandResultView, GameError> {
    run_gameplay_mutation(
        &state,
        MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
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

struct TauriApplicationExit {
    app: tauri::AppHandle,
}

impl ApplicationExit for TauriApplicationExit {
    fn exit(&self, code: i32) -> Result<(), GameError> {
        self.app.exit(code);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
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
            let app_handle = app.handle().clone();
            bind_persistence_status_events(&state.coordinator, move |event, payload| {
                if let Err(error) = app_handle.emit(event, payload) {
                    eprintln!("failed to emit {event}: {error}");
                }
            });
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(feature = "e2e")]
            e2e_load_checkpoint,
            #[cfg(feature = "e2e")]
            e2e_set_persistence_fault,
            #[cfg(feature = "e2e")]
            e2e_request_application_quit,
            list_saves,
            get_persistence_status,
            get_thumbnail_activity,
            get_exit_status,
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
            cancel_persistence_failure,
            retry_exit,
            cancel_exit,
            exit_without_saving,
            reset_game,
            get_state,
            list_scenes,
            jump_to_scene,
            advance_dialogue,
            select_analysis_board,
            update_analysis_draft,
            submit_analysis_board,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            let Some(state) = app_handle.try_state::<AppState>() else {
                return;
            };
            let exit: Arc<dyn ApplicationExit> = Arc::new(TauriApplicationExit {
                app: app_handle.clone(),
            });
            if let Err(error) = handle_close_requested(
                &label,
                || api.prevent_close(),
                |source| state.coordinator.request_exit_flush(exit, source),
            ) {
                eprintln!("failed to schedule exit flush: {}", error.message);
            }
        }
        tauri::RunEvent::ExitRequested { code, api, .. } => {
            let Some(state) = app_handle.try_state::<AppState>() else {
                return;
            };
            let exit: Arc<dyn ApplicationExit> = Arc::new(TauriApplicationExit {
                app: app_handle.clone(),
            });
            if let Err(error) = handle_exit_requested(
                code,
                &state.coordinator,
                || api.prevent_exit(),
                |source| state.coordinator.request_exit_flush(exit, source),
            ) {
                eprintln!("failed to schedule exit flush: {}", error.message);
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
    use std::time::Duration;

    fn test_application_persistence(
        session: Arc<Mutex<AppSession>>,
        operation_gate: Arc<tokio::sync::Mutex<()>>,
    ) -> Arc<ApplicationPersistence> {
        let (_resources, resources_dir) =
            crate::game::test_support::save_capture_fixture_resources();
        let definitions = Arc::new(load_current_definitions(&resources_dir).unwrap());
        Arc::new(ApplicationPersistence {
            session,
            operation_gate,
            fs: Arc::new(ProductionSaveFilesystem),
            root: PathBuf::new(),
            discovery: SaveDiscoveryContext {
                resources_dir,
                definitions,
            },
            last_saved_at: Mutex::new(None),
            availability_error: Mutex::new(None),
        })
    }

    mod raw_thumbnail_command_contract {
        use super::*;
        use crate::game::save::schema::MAX_THUMBNAIL_BYTES;

        fn manual_purpose() -> ThumbnailCapturePurpose {
            ThumbnailCapturePurpose::ManualSave {
                session_generation: 7,
                durable_revision: 11,
            }
        }

        #[test]
        fn missing_duplicate_non_utf8_and_malformed_tickets_stop_before_the_coordinator() {
            let malformed_headers = [
                vec![],
                vec![
                    RawThumbnailHeader::new(b"x-lyra-thumbnail-ticket", b"ticket"),
                    RawThumbnailHeader::new(b"X-Lyra-Thumbnail-Ticket", b"ticket"),
                ],
                vec![RawThumbnailHeader::new(b"x-lyra-thumbnail-ticket", b"\xff")],
                vec![RawThumbnailHeader::new(
                    b"x-lyra-thumbnail-ticket",
                    b"not-a-canonical-ticket",
                )],
            ];

            for headers in malformed_headers {
                let coordinator = SaveCoordinator::new();
                let request = coordinator.prepare_thumbnail(manual_purpose()).unwrap();

                let error =
                    submit_save_thumbnail_core(&coordinator, &headers, b"not-a-png").unwrap_err();

                assert_eq!(error, GameError::stale_thumbnail_ticket());
                assert_eq!(
                    coordinator.thumbnail_activity(),
                    ThumbnailActivityView::Capturing,
                    "the request parser must fail before coordinator submission"
                );
                coordinator
                    .report_thumbnail_failure(&request.ticket)
                    .unwrap();
            }
        }

        #[tokio::test]
        async fn oversized_raw_body_stops_before_clone_or_coordinator_submission() {
            let coordinator = SaveCoordinator::new();
            let request = coordinator.prepare_thumbnail(manual_purpose()).unwrap();
            let headers = [RawThumbnailHeader::new(
                b"x-lyra-thumbnail-ticket",
                request.ticket.as_bytes(),
            )];
            let oversized = vec![0; MAX_THUMBNAIL_BYTES + 1];

            let error = submit_save_thumbnail_core(&coordinator, &headers, &oversized).unwrap_err();

            assert_eq!(error.code, "thumbnailPngTooLarge");
            assert_eq!(
                coordinator.thumbnail_activity(),
                ThumbnailActivityView::Capturing,
                "the ingress cap must fail before coordinator submission"
            );
            coordinator
                .report_thumbnail_failure(&request.ticket)
                .unwrap();
        }

        #[tokio::test]
        async fn status_events_are_named_complete_snapshots_matching_the_getters() {
            let coordinator = SaveCoordinator::new();
            let events = Arc::new(Mutex::new(Vec::<(String, serde_json::Value)>::new()));
            let recorded = Arc::clone(&events);

            bind_persistence_status_events(&coordinator, move |name, payload| {
                recorded.lock().unwrap().push((name.into(), payload));
            });

            let initial = events.lock().unwrap().clone();
            assert_eq!(
                initial,
                [
                    (
                        PERSISTENCE_STATUS_CHANGED_EVENT.into(),
                        serde_json::to_value(coordinator.persistence_health()).unwrap(),
                    ),
                    (
                        THUMBNAIL_ACTIVITY_CHANGED_EVENT.into(),
                        serde_json::to_value(coordinator.thumbnail_activity()).unwrap(),
                    ),
                    (
                        EXIT_STATUS_CHANGED_EVENT.into(),
                        serde_json::to_value(exit_status_snapshot(&coordinator)).unwrap(),
                    ),
                ]
            );

            coordinator.publish_persistence_health(PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            });
            coordinator.prepare_thumbnail(manual_purpose()).unwrap();

            let published = events.lock().unwrap().clone();
            assert_eq!(
                published[published.len() - 2],
                (
                    PERSISTENCE_STATUS_CHANGED_EVENT.into(),
                    serde_json::to_value(coordinator.persistence_health()).unwrap(),
                )
            );
            assert_eq!(
                published[published.len() - 1],
                (
                    THUMBNAIL_ACTIVITY_CHANGED_EVENT.into(),
                    serde_json::to_value(coordinator.thumbnail_activity()).unwrap(),
                )
            );
        }
    }

    mod exit_lifecycle {
        use super::*;
        use crate::game::save::coordinator::{
            AppSession, ApplicationExit, ExitRequestSource, SaveCoordinator,
        };
        use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
        use std::cell::{Cell, RefCell};
        use tokio::sync::Notify;

        #[derive(Default)]
        struct RecordingExit {
            calls: Mutex<Vec<i32>>,
            called: Notify,
        }

        impl ApplicationExit for RecordingExit {
            fn exit(&self, code: i32) -> Result<(), GameError> {
                self.calls.lock().unwrap().push(code);
                self.called.notify_waiters();
                Ok(())
            }
        }

        impl RecordingExit {
            async fn wait_for_call(&self) {
                loop {
                    let notified = self.called.notified();
                    if !self.calls.lock().unwrap().is_empty() {
                        return;
                    }
                    notified.await;
                }
            }
        }

        #[test]
        fn exit_lifecycle_main_window_close_prevents_and_schedules_only_the_main_window() {
            let prevented = Cell::new(0);
            let scheduled = RefCell::new(Vec::new());

            handle_close_requested(
                "main",
                || prevented.set(prevented.get() + 1),
                |source| {
                    scheduled.borrow_mut().push(source);
                    Ok(())
                },
            )
            .unwrap();
            handle_close_requested(
                "secondary",
                || prevented.set(prevented.get() + 1),
                |source| {
                    scheduled.borrow_mut().push(source);
                    Ok(())
                },
            )
            .unwrap();

            assert_eq!(prevented.get(), 1);
            assert_eq!(*scheduled.borrow(), vec![ExitRequestSource::WindowClose]);
        }

        #[tokio::test]
        async fn exit_lifecycle_user_exit_is_prevented_but_programmatic_bypass_is_consumed_once() {
            let session = Arc::new(Mutex::new(AppSession::empty()));
            let coordinator =
                SaveCoordinator::for_application(session, Arc::new(tokio::sync::Mutex::new(())));
            let exit = Arc::new(RecordingExit::default());
            coordinator
                .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
                .unwrap();
            exit.wait_for_call().await;

            let prevented = Cell::new(0);
            let scheduled = RefCell::new(Vec::new());
            handle_exit_requested(
                Some(0),
                &coordinator,
                || prevented.set(prevented.get() + 1),
                |source| {
                    scheduled.borrow_mut().push(source);
                    Ok(())
                },
            )
            .unwrap();
            assert_eq!(prevented.get(), 0);
            assert!(scheduled.borrow().is_empty());

            handle_exit_requested(
                Some(0),
                &coordinator,
                || prevented.set(prevented.get() + 1),
                |source| {
                    scheduled.borrow_mut().push(source);
                    Ok(())
                },
            )
            .unwrap();
            handle_exit_requested(
                None,
                &coordinator,
                || prevented.set(prevented.get() + 1),
                |source| {
                    scheduled.borrow_mut().push(source);
                    Ok(())
                },
            )
            .unwrap();

            assert_eq!(prevented.get(), 2);
            assert_eq!(
                *scheduled.borrow(),
                vec![
                    ExitRequestSource::ApplicationQuit,
                    ExitRequestSource::ApplicationQuit
                ]
            );
        }

        #[tokio::test]
        async fn exit_lifecycle_saving_keeps_rendered_state_readable_but_mutations_inert() {
            let engine =
                empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
            let expected = engine.view().unwrap();
            let session = Arc::new(Mutex::new(AppSession::installed(engine, 8, None)));
            let operation_gate = Arc::new(tokio::sync::Mutex::new(()));
            let persistence =
                test_application_persistence(Arc::clone(&session), Arc::clone(&operation_gate));
            let coordinator =
                SaveCoordinator::for_application(Arc::clone(&session), Arc::clone(&operation_gate));
            let app = AppState {
                session,
                operation_gate,
                coordinator: coordinator.clone(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
                persistence: Some(persistence),
            };
            coordinator
                .request_exit_flush(
                    Arc::new(RecordingExit::default()),
                    ExitRequestSource::WindowClose,
                )
                .unwrap();

            assert_eq!(
                serde_json::to_value(read_game_state(&app).unwrap()).unwrap(),
                serde_json::to_value(&expected).unwrap()
            );
            assert_eq!(
                run_gameplay_mutation(
                    &app,
                    MutationPersistencePolicy::AutosaveIfAdvanced,
                    |engine| engine.view(),
                )
                .unwrap_err()
                .code,
                "persistenceOperationInProgress"
            );
            assert_eq!(
                start_game_core(
                    &app,
                    empty_engine_with_scene(
                        investigation_scene_with_intro("replacement", vec![]),
                        1,
                    ),
                )
                .await
                .unwrap_err()
                .code,
                "persistenceOperationInProgress"
            );
            assert_eq!(
                serde_json::to_value(
                    app.session
                        .lock()
                        .unwrap()
                        .engine
                        .as_ref()
                        .unwrap()
                        .view()
                        .unwrap()
                )
                .unwrap(),
                serde_json::to_value(expected).unwrap()
            );
        }

        #[tokio::test]
        async fn exit_lifecycle_getter_event_and_cancel_core_preserve_status_and_errors() {
            let session = Arc::new(Mutex::new(AppSession::empty()));
            let operation_gate = Arc::new(tokio::sync::Mutex::new(()));
            let coordinator =
                SaveCoordinator::for_application(Arc::clone(&session), Arc::clone(&operation_gate));
            let app = AppState {
                session,
                operation_gate,
                coordinator: coordinator.clone(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
                persistence: None,
            };
            let events = Arc::new(Mutex::new(Vec::<(String, serde_json::Value)>::new()));
            let recorded = Arc::clone(&events);
            bind_persistence_status_events(&coordinator, move |name, payload| {
                recorded.lock().unwrap().push((name.into(), payload));
            });
            let exit = Arc::new(RecordingExit::default());
            coordinator
                .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
                .unwrap();

            let getter = serde_json::to_value(get_exit_status_core(&app)).unwrap();
            let latest_exit_event = events
                .lock()
                .unwrap()
                .iter()
                .rev()
                .find(|(name, _)| name == EXIT_STATUS_CHANGED_EVENT)
                .unwrap()
                .1
                .clone();
            assert_eq!(latest_exit_event, getter);

            let wrong_token = PersistenceFailureTokenView::from_error(
                &GameError::save_write_failed()
                    .with_failure_token("00000000-0000-4000-8000-000000000000".into()),
            )
            .unwrap();
            assert_eq!(
                cancel_exit_core(&app, wrong_token).unwrap_err(),
                GameError::stale_persistence_failure_token()
            );
        }
    }

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
        use crate::game::schema::{
            DialogueItem, OutroUnlock, PredicateHotspotInvestigated, UnlockExpr,
        };
        use crate::game::test_support::save_capture_fixture_resources;
        use crate::game::test_support::{
            analysis_fixture_resources, empty_engine_with_interrogation_scene,
            empty_engine_with_scene, investigation_scene_with_intro, two_line_question_scene,
            write_empty_story_catalog_and_content_manifest,
        };
        use crate::game::view::ModeView;
        use std::cell::Cell;
        use std::io;
        use std::path::Path;
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        use std::sync::Condvar;
        use std::time::{Duration as StdDuration, SystemTime};

        struct PassiveBackend;

        struct NoopApplicationExit;

        impl ApplicationExit for NoopApplicationExit {
            fn exit(&self, _code: i32) -> Result<(), GameError> {
                Ok(())
            }
        }

        struct RemoveCountingFilesystem {
            inner: ProductionSaveFilesystem,
            removes: AtomicUsize,
        }

        #[cfg(feature = "e2e")]
        struct PausedDeleteFilesystem {
            inner: ProductionSaveFilesystem,
            armed: AtomicBool,
            entered: tokio::sync::Notify,
            released: AtomicBool,
            release: Condvar,
            release_lock: Mutex<()>,
        }

        #[cfg(feature = "e2e")]
        impl PausedDeleteFilesystem {
            fn new() -> Self {
                Self {
                    inner: ProductionSaveFilesystem,
                    armed: AtomicBool::new(false),
                    entered: tokio::sync::Notify::new(),
                    released: AtomicBool::new(false),
                    release: Condvar::new(),
                    release_lock: Mutex::new(()),
                }
            }

            fn arm(&self) {
                self.armed.store(true, Ordering::SeqCst);
            }

            fn release(&self) {
                let _guard = self.release_lock.lock().unwrap();
                self.released.store(true, Ordering::SeqCst);
                self.release.notify_all();
            }
        }

        #[cfg(feature = "e2e")]
        impl SaveFilesystem for PausedDeleteFilesystem {
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
                if self.armed.load(Ordering::SeqCst)
                    && path.extension().and_then(|extension| extension.to_str()) == Some("json")
                {
                    self.entered.notify_one();
                    let mut guard = self.release_lock.lock().unwrap();
                    while !self.released.load(Ordering::SeqCst) {
                        guard = self.release.wait(guard).unwrap();
                    }
                }
                self.inner.remove_file(path)
            }

            fn sync_dir(&self, path: &Path) -> io::Result<()> {
                if self.armed.load(Ordering::SeqCst) {
                    Err(io::Error::other("controlled post-delete sync failure"))
                } else {
                    self.inner.sync_dir(path)
                }
            }
        }

        impl RemoveCountingFilesystem {
            fn new() -> Self {
                Self {
                    inner: ProductionSaveFilesystem,
                    removes: AtomicUsize::new(0),
                }
            }
        }

        impl SaveFilesystem for RemoveCountingFilesystem {
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
                self.removes.fetch_add(1, Ordering::SeqCst);
                self.inner.remove_file(path)
            }

            fn sync_dir(&self, path: &Path) -> io::Result<()> {
                self.inner.sync_dir(path)
            }
        }

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
                operation_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::with_backend(Arc::new(PassiveBackend)),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
                persistence: None,
            }
        }

        fn mutation_app_with_engine(engine: GameEngine) -> AppState {
            AppState {
                session: Arc::new(Mutex::new(AppSession::installed(engine, 7, None))),
                operation_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::with_backend(Arc::new(PassiveBackend)),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
                persistence: None,
            }
        }

        fn live_queue_token(app: &AppState) -> QueueToken {
            let session = app.session.lock().unwrap();
            let view = session.engine.as_ref().unwrap().view().unwrap();
            let ModeView::Dialogue { queue_token, .. } = view.mode else {
                panic!("fixture must expose dialogue");
            };
            queue_token
        }

        fn advance_engine_to_line(engine: &mut GameEngine, expected_line_id: &str) {
            for _ in 0..8 {
                let view = engine.view().unwrap();
                if matches!(
                    &view.mode,
                    ModeView::Dialogue {
                        cross_exam_line_id: Some(line_id),
                        ..
                    } if line_id == expected_line_id
                ) {
                    return;
                }
                let ModeView::Dialogue { queue_token, .. } = view.mode else {
                    panic!("testimony left dialogue before reaching {expected_line_id}");
                };
                engine.advance_dialogue(queue_token).unwrap();
            }
            panic!("testimony never reached {expected_line_id}");
        }

        fn title_app() -> AppState {
            AppState {
                session: Arc::new(Mutex::new(AppSession::empty())),
                operation_gate: Arc::new(tokio::sync::Mutex::new(())),
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
        async fn busy_exit_flush_list_saves_returns_error_without_a_bypass_token() {
            let app = mutation_app();
            let before = session_observation(&app);
            app.session.lock().unwrap().persistence.exit_flush_requested = true;

            let error = list_saves_core(&app, discovered_browser).await.unwrap_err();

            assert_eq!(error.code, "persistenceOperationInProgress");
            assert!(error.failure_token.is_none());
            app.session.lock().unwrap().persistence.exit_flush_requested = false;
            let fabricated: PersistenceFailureTokenView = serde_json::from_value(
                serde_json::Value::String(uuid::Uuid::new_v4().hyphenated().to_string()),
            )
            .unwrap();
            let bypass = load_save_discarding_current_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                uuid::Uuid::new_v4().hyphenated().to_string(),
                fabricated,
            )
            .await
            .unwrap_err();
            assert_eq!(bypass.code, "stalePersistenceFailureToken");
            assert_eq!(session_observation(&app), before);
        }

        #[tokio::test]
        async fn busy_flush_cannot_mint_token_after_exit_flush_rolls_back() {
            let app = mutation_app();
            app.session
                .lock()
                .unwrap()
                .ensure_persistence_available()
                .unwrap();

            let error = list_saves_core_with_flush_hooks(
                &app,
                discovered_browser,
                |app| {
                    app.session.lock().unwrap().persistence.exit_flush_requested = true;
                    Ok(())
                },
                |app, error| {
                    assert_eq!(error, &GameError::persistence_operation_in_progress());
                    app.session.lock().unwrap().persistence.exit_flush_requested = false;
                    Ok(())
                },
            )
            .await
            .unwrap_err();

            assert_eq!(error, GameError::persistence_operation_in_progress());
            assert!(error.failure_token.is_none());
            app.session
                .lock()
                .unwrap()
                .ensure_persistence_available()
                .unwrap();
        }

        #[test]
        fn flush_failure_bypass_policy_only_propagates_busy_errors() {
            let busy = GameError::persistence_operation_in_progress();
            assert_eq!(
                challengeable_flush_failure(busy.clone()),
                Err(busy),
                "exclusive-operation failures are never bypassable"
            );

            for challengeable in [
                GameError::save_write_failed(),
                GameError::save_sync_failed(),
                GameError::save_replace_failed(),
            ] {
                assert_eq!(
                    challengeable_flush_failure(challengeable.clone()),
                    Ok(challengeable),
                    "genuine durability failures retain challenge authority"
                );
            }
        }

        #[test]
        fn production_setup_shares_the_exact_session_and_gate_and_retains_layout_failure() {
            let (_guard, resources) = save_capture_fixture_resources();
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
                &app.operation_gate,
                &persistence.operation_gate
            ));
            assert!(temporary.path().join("saves").is_dir());
            assert!(temporary.path().join("saves/thumbnails").is_dir());

            let (_fixture_guard, fixture_resources) = save_capture_fixture_resources();
            let failed = build_app_state_with_storage(
                fixture_resources,
                temporary.path().join("unavailable"),
                Arc::new(LayoutFailureFilesystem),
            )
            .unwrap();
            assert!(matches!(
                failed.coordinator.persistence_health(),
                PersistenceHealthView::Degraded { .. }
            ));
            let failed_persistence = failed.persistence.as_ref().unwrap();
            assert!(Arc::ptr_eq(&failed.session, &failed_persistence.session));
            assert!(failed_persistence.availability_error().is_some());
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
        async fn production_capture_releases_the_session_guard_before_storage_work() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let (_guard, resources) = save_capture_fixture_resources();
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

        #[tokio::test(start_paused = true)]
        async fn transition_contract_reset_flushes_pending_revision_before_replacing_session() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let (old_generation, old_revision) = schedule_pending_fixture_autosave(&app);

            start_game_with_persistence_core(&app).await.unwrap();

            assert!(
                app.session.lock().unwrap().persistence.generation > old_generation,
                "reset must install a fresh session generation"
            );
            let persistence = app.persistence.as_ref().unwrap();
            let browser = persistence.discover();
            let persisted = browser
                .slots
                .iter()
                .find(|slot| {
                    matches!(slot.reference, SaveSlotRef::Auto { .. })
                        && matches!(slot.status, SaveSlotStatusView::Valid { .. })
                })
                .expect("reset must durably flush the superseded session revision");
            let envelope = read_save_envelope(
                persistence.fs.as_ref(),
                &persistence.root,
                persisted.reference,
                &valid_save_id(persisted),
            )
            .unwrap();
            assert_eq!(envelope.snapshot.durable_revision, old_revision);
        }

        #[tokio::test(start_paused = true)]
        async fn transition_contract_active_reset_token_survives_newer_discovery() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let failing = Arc::new(AtomicBool::new(false));
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                Arc::new(FailingWriteFilesystem {
                    inner: ProductionSaveFilesystem,
                    failing: Arc::clone(&failing),
                }),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();
            schedule_pending_fixture_autosave(&app);
            let before = session_observation(&app);
            failing.store(true, Ordering::SeqCst);

            let error = start_game_with_persistence_core(&app).await.unwrap_err();

            assert_eq!(error.code, "saveWriteFailed");
            assert_eq!(session_observation(&app), before);
            let token = PersistenceFailureTokenView::from_error(&error).unwrap();
            app.coordinator.complete_discovery_attempt().unwrap();
            let replaced = start_game_without_saving_core(&app, token.clone())
                .await
                .unwrap();
            assert!(replaced.thumbnail_capture.is_none());
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(0));
            assert_eq!(
                start_game_without_saving_core(&app, token)
                    .await
                    .unwrap_err()
                    .code,
                "stalePersistenceFailureToken"
            );
            assert!(app
                .persistence
                .as_ref()
                .unwrap()
                .discover()
                .slots
                .iter()
                .filter(|slot| matches!(slot.reference, SaveSlotRef::Auto { .. }))
                .all(|slot| matches!(slot.status, SaveSlotStatusView::Empty)));
        }

        #[tokio::test(start_paused = true)]
        async fn transition_contract_active_reset_token_is_invalidated_by_revision_change() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let failing = Arc::new(AtomicBool::new(false));
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                Arc::new(FailingWriteFilesystem {
                    inner: ProductionSaveFilesystem,
                    failing: Arc::clone(&failing),
                }),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();
            schedule_pending_fixture_autosave(&app);
            failing.store(true, Ordering::SeqCst);
            let error = start_game_with_persistence_core(&app).await.unwrap_err();
            let token = PersistenceFailureTokenView::from_error(&error).unwrap();
            let (_, failed_revision, _) = session_observation(&app);

            advance_fixture_dialogue(&app);

            let (_, current_revision, _) = session_observation(&app);
            assert_ne!(current_revision, failed_revision);
            assert_eq!(
                start_game_without_saving_core(&app, token)
                    .await
                    .unwrap_err()
                    .code,
                "stalePersistenceFailureToken"
            );
        }

        #[tokio::test(start_paused = true)]
        async fn transition_contract_reset_flush_failure_can_retry_after_storage_recovers() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let failing = Arc::new(AtomicBool::new(false));
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                Arc::new(FailingWriteFilesystem {
                    inner: ProductionSaveFilesystem,
                    failing: Arc::clone(&failing),
                }),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();
            let (_, old_revision) = schedule_pending_fixture_autosave(&app);
            failing.store(true, Ordering::SeqCst);
            let failed = start_game_with_persistence_core(&app).await.unwrap_err();
            let stale_after_retry = PersistenceFailureTokenView::from_error(&failed).unwrap();

            failing.store(false, Ordering::SeqCst);
            start_game_with_persistence_core(&app).await.unwrap();

            let persistence = app.persistence.as_ref().unwrap();
            let browser = persistence.discover();
            let persisted = browser
                .slots
                .iter()
                .find(|slot| {
                    matches!(slot.reference, SaveSlotRef::Auto { .. })
                        && matches!(slot.status, SaveSlotStatusView::Valid { .. })
                })
                .expect("retry must flush the superseded session revision");
            let envelope = read_save_envelope(
                persistence.fs.as_ref(),
                &persistence.root,
                persisted.reference,
                &valid_save_id(persisted),
            )
            .unwrap();
            assert_eq!(envelope.snapshot.durable_revision, old_revision);
            assert_eq!(
                start_game_without_saving_core(&app, stale_after_retry)
                    .await
                    .unwrap_err()
                    .code,
                "stalePersistenceFailureToken"
            );
        }

        #[tokio::test(start_paused = true)]
        async fn transition_contract_title_start_does_not_create_an_autosave() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = build_app_state_with_storage(
                resources,
                temporary.path().join("saves"),
                Arc::new(ProductionSaveFilesystem),
            )
            .unwrap();

            start_game_with_persistence_core(&app).await.unwrap();
            tokio::time::advance(Duration::from_secs(60)).await;
            for _ in 0..5 {
                tokio::task::yield_now().await;
            }

            let session = app.session.lock().unwrap();
            assert_eq!(session.persistence.generation, 1);
            assert_eq!(session.durable_revision(), Some(0));
            drop(session);
            assert!(app
                .persistence
                .as_ref()
                .unwrap()
                .discover()
                .slots
                .iter()
                .filter(|slot| matches!(slot.reference, SaveSlotRef::Auto { .. }))
                .all(|slot| matches!(slot.status, SaveSlotStatusView::Empty)));
        }

        #[tokio::test]
        async fn transition_contract_title_start_token_is_invalidated_by_newer_discovery() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let failing = Arc::new(AtomicBool::new(true));
            let app = build_app_state_with_storage(
                resources,
                temporary.path().join("saves"),
                Arc::new(RecoveringFilesystem {
                    inner: ProductionSaveFilesystem,
                    failing,
                }),
            )
            .unwrap();
            let error = start_game_with_persistence_core(&app).await.unwrap_err();
            let token = PersistenceFailureTokenView::from_error(&error).unwrap();

            app.coordinator.complete_discovery_attempt().unwrap();

            assert_eq!(
                start_game_without_saving_core(&app, token)
                    .await
                    .unwrap_err()
                    .code,
                "stalePersistenceFailureToken"
            );
        }

        #[tokio::test]
        async fn transition_contract_load_flushes_before_rereading_an_adopted_source_slot() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            advance_fixture_dialogue(&app);
            let first = app
                .coordinator
                .flush_session(&app, FlushOperation::InGameLoad)
                .await
                .unwrap();
            let FlushOutcome::Written { slot, .. } = first else {
                panic!("first revision must establish the autosave source");
            };
            let observed_save_id = valid_save_id(
                app.persistence
                    .as_ref()
                    .unwrap()
                    .discover()
                    .slots
                    .iter()
                    .find(|candidate| candidate.reference == slot)
                    .unwrap(),
            );
            advance_fixture_dialogue(&app);
            let before = session_observation(&app);

            let error = load_save_core(&app, slot, observed_save_id.clone())
                .await
                .unwrap_err();

            assert_eq!(error.code, "staleSaveSelection");
            assert_eq!(session_observation(&app), before);
            assert_ne!(
                valid_save_id(
                    app.persistence
                        .as_ref()
                        .unwrap()
                        .discover()
                        .slots
                        .iter()
                        .find(|candidate| candidate.reference == slot)
                        .unwrap(),
                ),
                observed_save_id
            );
        }

        #[tokio::test]
        async fn transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged()
        {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let ticket = app
                .coordinator
                .prepare_application_thumbnail(&app, PreparedThumbnailPurpose::ManualSave)
                .unwrap();
            app.coordinator
                .report_thumbnail_failure(&ticket.ticket)
                .unwrap();
            let saved = save_manual_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                "Build failure".into(),
                ManualSlotExpectation::Empty,
                ticket.ticket,
            )
            .await
            .unwrap();
            let observed_save_id = valid_save_id(&saved.saved_slot);
            let path = temporary.path().join("saves/manual-1.json");
            let mut envelope: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            envelope["contentRevision"] = "incompatible-test-revision".into();
            std::fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
            let before = session_observation(&app);

            let error = load_save_core(&app, SaveSlotRef::Manual { slot: 1 }, observed_save_id)
                .await
                .unwrap_err();

            assert_eq!(error.code, "incompatibleContentRevision");
            assert_eq!(session_observation(&app), before);
        }

        #[tokio::test]
        async fn transition_contract_load_discard_consumes_exact_token_and_skips_flush() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let saved = seed_manual(&app, 1, "Discard source").await;
            let observed_save_id = valid_save_id(&saved.saved_slot);
            advance_fixture_dialogue(&app);
            let discovery_generation = app.coordinator.complete_discovery_attempt().unwrap();
            let (_, wrong_token) = app
                .coordinator
                .challenge_current_session_failure(
                    &app,
                    PersistenceBypassOperation::LoadDiscardingCurrent,
                    Some(discovery_generation),
                    GameError::save_write_failed(),
                )
                .unwrap();

            let wrong = load_save_discarding_current_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                uuid::Uuid::new_v4().hyphenated().to_string(),
                wrong_token.clone(),
            )
            .await
            .unwrap_err();
            assert_eq!(wrong.code, "staleSaveSelection");
            let replay = load_save_discarding_current_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                observed_save_id.clone(),
                wrong_token,
            )
            .await
            .unwrap_err();
            assert_eq!(replay.code, "stalePersistenceFailureToken");

            let (_, token) = app
                .coordinator
                .challenge_current_session_failure(
                    &app,
                    PersistenceBypassOperation::LoadDiscardingCurrent,
                    Some(discovery_generation),
                    GameError::save_write_failed(),
                )
                .unwrap();
            let loaded = load_save_discarding_current_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                observed_save_id,
                token,
            )
            .await
            .unwrap();
            assert!(loaded.thumbnail_capture.is_none());
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(0));
            assert!(app
                .persistence
                .as_ref()
                .unwrap()
                .discover()
                .slots
                .iter()
                .filter(|slot| matches!(slot.reference, SaveSlotRef::Auto { .. }))
                .all(|slot| matches!(slot.status, SaveSlotStatusView::Empty)));
        }

        #[tokio::test]
        async fn transition_contract_continue_uses_fresh_newest_and_never_falls_back_from_invalid()
        {
            let (_guard, resources) = save_capture_fixture_resources();
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
            seed_manual(&app, 1, "Older valid").await;
            app.persistence
                .as_ref()
                .unwrap()
                .clear_session(&app.coordinator)
                .await
                .unwrap();
            std::fs::write(
                temporary.path().join("saves/manual-2.json"),
                b"{ newest but malformed",
            )
            .unwrap();
            let before = app.coordinator.transition_identity(&app).unwrap();

            let error = continue_game_core(&app).await.unwrap_err();

            assert_eq!(error.code, "malformedSaveJson");
            assert_eq!(app.coordinator.transition_identity(&app).unwrap(), before);
        }

        #[tokio::test]
        async fn transition_contract_start_without_saving_can_persist_after_storage_recovers() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let failing = Arc::new(AtomicBool::new(true));
            let app = build_app_state_with_storage(
                resources,
                temporary.path().join("saves"),
                Arc::new(RecoveringFilesystem {
                    inner: ProductionSaveFilesystem,
                    failing: failing.clone(),
                }),
            )
            .unwrap();

            let error = start_game_with_persistence_core(&app).await.unwrap_err();
            let token = PersistenceFailureTokenView::from_error(&error).unwrap();
            let started = start_game_without_saving_core(&app, token).await.unwrap();
            assert!(started.thumbnail_capture.is_none());
            advance_fixture_dialogue(&app);
            failing.store(false, Ordering::SeqCst);
            app.coordinator
                .flush_session(&app, FlushOperation::ManualSave)
                .await
                .unwrap();

            assert!(app
                .persistence
                .as_ref()
                .unwrap()
                .discover()
                .slots
                .iter()
                .any(|slot| matches!(slot.status, SaveSlotStatusView::Valid { .. })));
        }

        #[tokio::test]
        async fn transition_contract_delete_uses_exact_observation_and_returns_fresh_browser() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let saved = seed_manual(&app, 1, "Delete me").await;
            let save_id = valid_save_id(&saved.saved_slot);

            let result = delete_save_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                OccupiedSlotExpectation {
                    save_id: Some(save_id),
                    modified_at: None,
                },
            )
            .await
            .unwrap();

            assert!(matches!(result.preflight, SaveBrowserPreflightView::Ready));
            assert!(result.continue_candidate.is_none());
            assert!(matches!(
                result
                    .browser
                    .slots
                    .iter()
                    .find(|slot| slot.reference == SaveSlotRef::Manual { slot: 1 })
                    .unwrap()
                    .status,
                SaveSlotStatusView::Empty
            ));
        }

        #[cfg(feature = "e2e")]
        #[tokio::test(flavor = "multi_thread", worker_threads = 3)]
        async fn checkpoint_replacement_fences_an_active_real_delete_before_storage_commit() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let fs = Arc::new(PausedDeleteFilesystem::new());
            let app = Arc::new(
                build_app_state_with_storage(
                    resources.clone(),
                    temporary.path().join("saves"),
                    fs.clone(),
                )
                .unwrap(),
            );
            start_game_core(&app, GameEngine::new_started(resources.clone()).unwrap())
                .await
                .unwrap();
            let saved = seed_manual(&app, 1, "Must survive checkpoint replacement").await;
            let save_id = valid_save_id(&saved.saved_slot);
            let slot_path = temporary.path().join("saves/manual-1.json");
            assert!(slot_path.exists());
            fs.arm();

            let gate = app.operation_gate.clone().lock_owned().await;
            let replacement_app = Arc::clone(&app);
            let mut replacement = tokio::spawn(async move {
                replacement_app
                    .persistence
                    .as_ref()
                    .unwrap()
                    .replace_session_for_e2e(
                        &replacement_app.coordinator,
                        GameEngine::new_started(resources).unwrap(),
                    )
                    .await
            });
            assert!(
                tokio::time::timeout(Duration::from_millis(20), &mut replacement)
                    .await
                    .is_err(),
                "replacement must be queued behind the held gate"
            );

            let delete_app = Arc::clone(&app);
            let delete = tokio::spawn(async move {
                delete_save_core(
                    &delete_app,
                    SaveSlotRef::Manual { slot: 1 },
                    OccupiedSlotExpectation {
                        save_id: Some(save_id),
                        modified_at: None,
                    },
                )
                .await
            });
            let active_delete_reached_storage =
                tokio::time::timeout(Duration::from_millis(50), fs.entered.notified())
                    .await
                    .is_ok();

            drop(gate);
            let replacement = tokio::time::timeout(Duration::from_secs(1), &mut replacement)
                .await
                .expect("replacement must complete while the stale delete is paused")
                .unwrap()
                .unwrap();
            assert_eq!(replacement.generation, 2);
            fs.release();
            let delete_error = delete.await.unwrap().unwrap_err();

            assert!(
                !active_delete_reached_storage,
                "a delete queued behind replacement must not reach its write boundary"
            );
            assert_eq!(delete_error.code, "staleSessionGeneration");
            assert!(slot_path.exists(), "stale delete must not remove the save");
            assert_eq!(
                app.coordinator.persistence_health(),
                PersistenceHealthView::Healthy,
                "stale completion must not repopulate replacement state"
            );
        }

        #[cfg(feature = "e2e")]
        #[tokio::test(flavor = "multi_thread", worker_threads = 3)]
        async fn replacement_before_waiting_delete_returns_stale_session_generation_and_preserves_slot(
        ) {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = Arc::new(
                build_app_state_with_storage(
                    resources.clone(),
                    temporary.path().join("saves"),
                    Arc::new(ProductionSaveFilesystem),
                )
                .unwrap(),
            );
            start_game_core(&app, GameEngine::new_started(resources.clone()).unwrap())
                .await
                .unwrap();
            let saved = seed_manual(&app, 1, "Must survive replacement before delete").await;
            let save_id = valid_save_id(&saved.saved_slot);
            let slot_path = temporary.path().join("saves/manual-1.json");
            assert!(slot_path.exists());

            let gate = app.operation_gate.clone().lock_owned().await;
            let replacement_app = Arc::clone(&app);
            let mut replacement = tokio::spawn(async move {
                replacement_app
                    .persistence
                    .as_ref()
                    .unwrap()
                    .replace_session_for_e2e(
                        &replacement_app.coordinator,
                        GameEngine::new_started(resources).unwrap(),
                    )
                    .await
            });
            assert!(
                tokio::time::timeout(Duration::from_millis(20), &mut replacement)
                    .await
                    .is_err(),
                "replacement must be waiting on the held operation gate"
            );

            let delete_app = Arc::clone(&app);
            let delete = tokio::spawn(async move {
                delete_save_core(
                    &delete_app,
                    SaveSlotRef::Manual { slot: 1 },
                    OccupiedSlotExpectation {
                        save_id: Some(save_id),
                        modified_at: None,
                    },
                )
                .await
            });
            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    if matches!(
                        app.coordinator.persistence_health(),
                        PersistenceHealthView::Pending
                    ) {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("delete must publish Pending before waiting for the operation gate");

            drop(gate);
            let replacement = tokio::time::timeout(Duration::from_secs(2), &mut replacement)
                .await
                .expect("replacement must complete before the waiting delete")
                .unwrap()
                .unwrap();
            assert_eq!(replacement.generation, 2);

            let delete_error = tokio::time::timeout(Duration::from_secs(2), delete)
                .await
                .expect("waiting delete must complete after replacement")
                .unwrap()
                .unwrap_err();
            assert_eq!(delete_error.code, "staleSessionGeneration");
            assert!(slot_path.exists(), "stale delete must not remove the save");
            assert_eq!(
                app.coordinator.persistence_health(),
                PersistenceHealthView::Healthy,
                "replacement health must remain Healthy after stale delete"
            );
        }

        #[tokio::test]
        async fn exit_lifecycle_saving_rejects_delete_before_health_writer_or_filesystem_side_effects(
        ) {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let fs = Arc::new(RemoveCountingFilesystem::new());
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                fs.clone(),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();
            let saved = seed_manual(&app, 1, "Keep me").await;
            let save_id = valid_save_id(&saved.saved_slot);
            let browser_before =
                serde_json::to_value(app.persistence.as_ref().unwrap().discover()).unwrap();
            let health_before = app.coordinator.persistence_health();
            let removes_before = fs.removes.load(Ordering::SeqCst);
            app.coordinator
                .request_exit_flush(
                    Arc::new(NoopApplicationExit),
                    ExitRequestSource::WindowClose,
                )
                .unwrap();
            assert_eq!(app.coordinator.exit_status(), ExitStatusView::Saving);

            let error = delete_save_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                OccupiedSlotExpectation {
                    save_id: Some(save_id),
                    modified_at: None,
                },
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "persistenceOperationInProgress");
            assert_eq!(app.coordinator.persistence_health(), health_before);
            assert_eq!(fs.removes.load(Ordering::SeqCst), removes_before);
            assert_eq!(
                serde_json::to_value(app.persistence.as_ref().unwrap().discover()).unwrap(),
                browser_before
            );
        }

        #[tokio::test]
        async fn transition_fault_matrix_rejects_install_after_live_revision_drift() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                Arc::new(ProductionSaveFilesystem),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources.clone()).unwrap())
                .await
                .unwrap();
            let expected = app.coordinator.transition_identity(&app).unwrap();
            advance_fixture_dialogue(&app);
            let after_drift = session_observation(&app);

            let error = app
                .persistence
                .as_ref()
                .unwrap()
                .install_session_if_current(
                    &app.coordinator,
                    GameEngine::new_started(resources).unwrap(),
                    None,
                    expected,
                )
                .await
                .unwrap_err();

            assert_eq!(error.code, "staleSaveSelection");
            assert_eq!(session_observation(&app), after_drift);

            let saved = seed_manual(&app, 1, "Live session remains writable").await;
            assert_eq!(
                app.coordinator.persistence_health(),
                PersistenceHealthView::Healthy
            );
            let save_id = valid_save_id(&saved.saved_slot);
            let deleted = delete_save_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                OccupiedSlotExpectation {
                    save_id: Some(save_id),
                    modified_at: None,
                },
            )
            .await
            .unwrap();
            assert!(matches!(deleted.preflight, SaveBrowserPreflightView::Ready));
            assert!(matches!(
                deleted
                    .browser
                    .slots
                    .iter()
                    .find(|slot| slot.reference == SaveSlotRef::Manual { slot: 1 })
                    .unwrap()
                    .status,
                SaveSlotStatusView::Empty
            ));
            assert_eq!(
                app.coordinator.persistence_health(),
                PersistenceHealthView::Healthy
            );
        }

        #[tokio::test]
        async fn transition_race_load_preserves_mutation_after_flush_before_install() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let saved = seed_manual(&app, 1, "Load source").await;
            let observed_save_id = valid_save_id(&saved.saved_slot);
            let after_hook = Arc::new(Mutex::new(None));
            let recorded = Arc::clone(&after_hook);

            let error = load_save_core_with_post_flush_hook(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                observed_save_id,
                move |app| {
                    advance_fixture_dialogue(app);
                    *recorded.lock().unwrap() = Some(session_observation(app));
                    Ok(())
                },
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "staleSaveSelection");
            assert_eq!(
                session_observation(&app),
                after_hook
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("hook records the unflushed mutation")
            );
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(1));
        }

        #[tokio::test]
        async fn transition_race_continue_preserves_mutation_after_flush_before_install() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            seed_manual(&app, 1, "Continue source").await;
            let after_hook = Arc::new(Mutex::new(None));
            let recorded = Arc::clone(&after_hook);

            let error = continue_game_core_with_post_flush_hook(&app, move |app| {
                advance_fixture_dialogue(app);
                *recorded.lock().unwrap() = Some(session_observation(app));
                Ok(())
            })
            .await
            .unwrap_err();

            assert_eq!(error.code, "staleSaveSelection");
            assert_eq!(
                session_observation(&app),
                after_hook
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("hook records the unflushed mutation")
            );
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(1));
        }

        #[tokio::test]
        async fn transition_race_return_preserves_mutation_after_flush_before_clear() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let after_hook = Arc::new(Mutex::new(None));
            let recorded = Arc::clone(&after_hook);

            let error = return_to_title_core_with_post_flush_hook(&app, move |app| {
                advance_fixture_dialogue(app);
                *recorded.lock().unwrap() = Some(session_observation(app));
                Ok(())
            })
            .await
            .unwrap_err();

            assert_eq!(error.code, "stalePersistenceFailureToken");
            assert_eq!(
                session_observation(&app),
                after_hook
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("hook records the unflushed mutation")
            );
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(1));
        }

        #[tokio::test]
        async fn transition_race_load_from_title_does_not_replace_newly_started_session() {
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                Arc::new(ProductionSaveFilesystem),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources.clone()).unwrap())
                .await
                .unwrap();
            let saved = seed_manual(&app, 1, "Load from title").await;
            let observed_save_id = valid_save_id(&saved.saved_slot);
            app.persistence
                .as_ref()
                .unwrap()
                .clear_session(&app.coordinator)
                .await
                .unwrap();
            let after_hook = Arc::new(Mutex::new(None));
            let recorded = Arc::clone(&after_hook);

            let error = load_save_core_with_post_flush_hook(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                observed_save_id,
                move |app| {
                    let mut session = app.session.lock().unwrap();
                    let generation = session.persistence.generation.checked_add(1).unwrap();
                    *session = AppSession::installed(
                        GameEngine::new_started(resources).unwrap(),
                        generation,
                        None,
                    );
                    drop(session);
                    *recorded.lock().unwrap() = Some(session_observation(app));
                    Ok(())
                },
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "staleSaveSelection");
            assert_eq!(
                session_observation(&app),
                after_hook
                    .lock()
                    .unwrap()
                    .clone()
                    .expect("hook records the newly started session")
            );
        }

        #[tokio::test]
        async fn direct_load_discard_token_rejects_a_different_slot() {
            let (app, _temporary, _fixture_guard, _first_id, second_id, token) =
                selected_load_failure_fixture().await;
            let before = session_observation(&app);

            let error = load_save_discarding_current_core(
                &app,
                SaveSlotRef::Manual { slot: 2 },
                second_id,
                token,
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "stalePersistenceFailureToken");
            assert_eq!(session_observation(&app), before);
        }

        #[tokio::test]
        async fn direct_load_discard_token_rejects_a_different_observed_save_id() {
            let (app, _temporary, _fixture_guard, _first_id, _second_id, token) =
                selected_load_failure_fixture().await;
            let before = session_observation(&app);

            let error = load_save_discarding_current_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                uuid::Uuid::new_v4().hyphenated().to_string(),
                token,
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "stalePersistenceFailureToken");
            assert_eq!(session_observation(&app), before);
        }

        #[tokio::test]
        async fn direct_load_discard_token_loads_its_exact_target_once() {
            let (app, _temporary, _fixture_guard, first_id, _second_id, token) =
                selected_load_failure_fixture().await;

            let loaded = load_save_discarding_current_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                first_id.clone(),
                token.clone(),
            )
            .await
            .unwrap();

            assert!(loaded.thumbnail_capture.is_none());
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(0));
            assert_eq!(
                load_save_discarding_current_core(
                    &app,
                    SaveSlotRef::Manual { slot: 1 },
                    first_id,
                    token,
                )
                .await
                .unwrap_err()
                .code,
                "stalePersistenceFailureToken"
            );
        }

        #[tokio::test]
        async fn transition_contract_continue_and_return_success_use_fresh_disk_state() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            seed_manual(&app, 1, "Older").await;
            advance_fixture_dialogue(&app);
            seed_manual(&app, 2, "Newest").await;
            let returned = return_to_title_core(&app).await.unwrap();
            assert_eq!(
                returned.continue_candidate,
                Some(SaveSlotRef::Manual { slot: 2 })
            );
            assert!(app.session.lock().unwrap().engine.is_none());

            let continued = continue_game_core(&app).await.unwrap();
            assert!(continued.thumbnail_capture.is_none());
            let session = app.session.lock().unwrap();
            assert_eq!(session.durable_revision(), Some(1));
            assert_eq!(session.persistence.autosave_target, None);
        }

        #[tokio::test]
        async fn transition_delete_invalid_file_preserves_foreign_sidecar_and_rejects_replacement()
        {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let first = seed_manual(&app, 1, "First identity").await;
            let first_id = valid_save_id(&first.saved_slot);
            let ticket = app
                .coordinator
                .prepare_application_thumbnail(&app, PreparedThumbnailPurpose::ManualSave)
                .unwrap();
            app.coordinator
                .report_thumbnail_failure(&ticket.ticket)
                .unwrap();
            save_manual_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                "Replacement".into(),
                ManualSlotExpectation::Occupied {
                    observation: OccupiedSlotExpectation {
                        save_id: Some(first_id.clone()),
                        modified_at: None,
                    },
                },
                ticket.ticket,
            )
            .await
            .unwrap();
            assert_eq!(
                delete_save_core(
                    &app,
                    SaveSlotRef::Manual { slot: 1 },
                    OccupiedSlotExpectation {
                        save_id: Some(first_id),
                        modified_at: None,
                    },
                )
                .await
                .unwrap_err()
                .code,
                "staleSaveSelection"
            );

            app.persistence
                .as_ref()
                .unwrap()
                .clear_session(&app.coordinator)
                .await
                .unwrap();
            let invalid_path = temporary.path().join("saves/manual-3.json");
            std::fs::write(&invalid_path, b"{ invalid without id").unwrap();
            let foreign = temporary.path().join("saves/thumbnails/foreign.png");
            std::fs::write(&foreign, b"foreign").unwrap();
            let discovered = app.persistence.as_ref().unwrap().discover();
            let invalid = discovered
                .slots
                .iter()
                .find(|slot| slot.reference == SaveSlotRef::Manual { slot: 3 })
                .unwrap();
            let result = delete_save_core(
                &app,
                SaveSlotRef::Manual { slot: 3 },
                OccupiedSlotExpectation {
                    save_id: None,
                    modified_at: invalid.modified_at.clone(),
                },
            )
            .await
            .unwrap();
            assert!(matches!(result.preflight, SaveBrowserPreflightView::Ready));
            assert!(!invalid_path.exists());
            assert!(foreign.exists());
        }

        async fn seed_manual(app: &AppState, slot: u8, name: &str) -> ManualSaveResultView {
            let ticket = app
                .coordinator
                .prepare_application_thumbnail(app, PreparedThumbnailPurpose::ManualSave)
                .unwrap();
            app.coordinator
                .report_thumbnail_failure(&ticket.ticket)
                .unwrap();
            save_manual_core(
                app,
                SaveSlotRef::Manual { slot },
                name.into(),
                ManualSlotExpectation::Empty,
                ticket.ticket,
            )
            .await
            .unwrap()
        }

        fn advance_fixture_dialogue(app: &AppState) {
            let mut session = app.session.lock().unwrap();
            let engine = session.engine.as_mut().unwrap();
            let ModeView::Dialogue { queue_token, .. } = engine.view().unwrap().mode else {
                panic!("fixture must expose an active dialogue queue");
            };
            engine.advance_dialogue(queue_token).unwrap();
        }

        fn schedule_pending_fixture_autosave(app: &AppState) -> (u64, u64) {
            let mutated = run_gameplay_mutation(
                app,
                MutationPersistencePolicy::AutosaveIfAdvanced,
                |engine| {
                    let ModeView::Dialogue { queue_token, .. } = engine.view()?.mode else {
                        return Err(GameError::game_not_started());
                    };
                    engine.advance_dialogue(queue_token)
                },
            )
            .unwrap();
            let pending = mutated
                .thumbnail_capture
                .expect("durable mutation must schedule its debounced autosave");
            app.coordinator
                .report_thumbnail_failure(&pending.ticket)
                .unwrap();
            let (generation, revision, _) = session_observation(app);
            (generation, revision)
        }

        fn valid_save_id(slot: &SaveSlotView) -> String {
            let SaveSlotStatusView::Valid { metadata } = &slot.status else {
                panic!("expected valid save slot");
            };
            metadata.save_id.clone()
        }

        fn png(width: u32, height: u32) -> Vec<u8> {
            let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
            bytes.extend_from_slice(&width.to_be_bytes());
            bytes.extend_from_slice(&height.to_be_bytes());
            bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
            bytes.extend_from_slice(&[0, 0, 0, 0]);
            bytes
        }

        fn session_observation(app: &AppState) -> (u64, u64, serde_json::Value) {
            let session = app.session.lock().unwrap();
            (
                session.persistence.generation,
                session.durable_revision().unwrap(),
                serde_json::to_value(session.engine.as_ref().unwrap().view().unwrap()).unwrap(),
            )
        }

        async fn selected_load_failure_fixture() -> (
            AppState,
            tempfile::TempDir,
            tempfile::TempDir,
            String,
            String,
            PersistenceFailureTokenView,
        ) {
            let (_fixture_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let failing = Arc::new(AtomicBool::new(false));
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                Arc::new(FailingWriteFilesystem {
                    inner: ProductionSaveFilesystem,
                    failing: Arc::clone(&failing),
                }),
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();
            let first = seed_manual(&app, 1, "First target").await;
            let second = seed_manual(&app, 2, "Second target").await;
            let first_id = valid_save_id(&first.saved_slot);
            let second_id = valid_save_id(&second.saved_slot);
            advance_fixture_dialogue(&app);
            failing.store(true, Ordering::SeqCst);

            let error = load_save_core(&app, SaveSlotRef::Manual { slot: 1 }, first_id.clone())
                .await
                .unwrap_err();
            assert_eq!(error.code, "saveWriteFailed");
            let token = PersistenceFailureTokenView::from_error(&error).unwrap();
            (app, temporary, _fixture_guard, first_id, second_id, token)
        }

        #[tokio::test]
        async fn thumbnail_read_returns_exact_bytes_and_rejects_stale_observed_identity() {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let request = app
                .coordinator
                .prepare_application_thumbnail(&app, PreparedThumbnailPurpose::ManualSave)
                .unwrap();
            let expected = png(320, 180);
            app.coordinator
                .submit_thumbnail(&request.ticket, &expected)
                .unwrap();
            let saved = save_manual_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                "Thumbnail".into(),
                ManualSlotExpectation::Empty,
                request.ticket,
            )
            .await
            .unwrap();
            let save_id = valid_save_id(&saved.saved_slot);

            assert_eq!(
                read_save_thumbnail_core(&app, SaveSlotRef::Manual { slot: 1 }, &save_id).unwrap(),
                expected
            );
            assert_eq!(
                read_save_thumbnail_core(
                    &app,
                    SaveSlotRef::Manual { slot: 1 },
                    &uuid::Uuid::new_v4().hyphenated().to_string(),
                )
                .unwrap_err()
                .code,
                "staleSaveSelection"
            );
        }

        #[tokio::test]
        async fn manual_saves_same_revision_to_two_slots_with_distinct_identity_and_no_adoption() {
            let (_guard, resources) = save_capture_fixture_resources();
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

        struct RecoveringFilesystem {
            inner: ProductionSaveFilesystem,
            failing: Arc<AtomicBool>,
        }

        struct FailingWriteFilesystem {
            inner: ProductionSaveFilesystem,
            failing: Arc<AtomicBool>,
        }

        impl SaveFilesystem for FailingWriteFilesystem {
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
                self.inner.list_dir(path)
            }
            fn stage_atomic(
                &self,
                path: &Path,
                bytes: &[u8],
            ) -> io::Result<Box<dyn StagedAtomicWrite>> {
                if self.failing.load(Ordering::SeqCst) {
                    Err(io::Error::other("temporarily unavailable"))
                } else {
                    self.inner.stage_atomic(path, bytes)
                }
            }
            fn remove_file(&self, path: &Path) -> io::Result<()> {
                self.inner.remove_file(path)
            }
            fn sync_dir(&self, path: &Path) -> io::Result<()> {
                self.inner.sync_dir(path)
            }
        }

        impl SaveFilesystem for RecoveringFilesystem {
            fn create_dir_all(&self, path: &Path) -> io::Result<()> {
                if self.failing.load(Ordering::SeqCst) {
                    Err(io::Error::other("temporarily unavailable"))
                } else {
                    self.inner.create_dir_all(path)
                }
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

        #[test]
        fn advancing_mutation_from_the_sync_tauri_boundary_surfaces_an_autosave_capture_ticket() {
            let app = mutation_app();

            let result = run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AutosaveIfAdvanced,
                |engine| engine.enter_sublocation("room"),
            )
            .unwrap();

            assert_eq!(result.state.chapter.id, "chapter_1");
            assert!(
                result.thumbnail_capture.is_some(),
                "the sync Tauri command boundary must return the autosave capture ticket"
            );
        }

        #[test]
        fn no_thumbnail_mutation_returns_null_capture_and_keeps_activity_idle() {
            let app = mutation_app();

            let result = run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail,
                |engine| engine.enter_sublocation("room"),
            )
            .unwrap();

            assert!(result.thumbnail_capture.is_none());
            assert_eq!(
                app.coordinator.thumbnail_activity(),
                ThumbnailActivityView::Idle
            );
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(1));
        }

        #[test]
        fn interrogation_dialogue_advance_autosaves_without_thumbnail() {
            let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
            engine.ask_interrogation_question("alibi").unwrap();
            let app = mutation_app_with_engine(engine);
            let expected = live_queue_token(&app);
            let before = app.session.lock().unwrap().durable_revision().unwrap();

            let result = advance_dialogue_core(&app, expected).unwrap();

            assert!(result.thumbnail_capture.is_none());
            assert!(app.session.lock().unwrap().durable_revision().unwrap() > before);
            assert_eq!(
                app.coordinator.thumbnail_activity(),
                ThumbnailActivityView::Idle
            );
        }

        #[test]
        fn challenge_interrogation_line_autosaves_without_thumbnail() {
            let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
            engine.ask_interrogation_question("alibi").unwrap();
            advance_engine_to_line(&mut engine, "l_deny");
            let app = mutation_app_with_engine(engine);
            let before = app.session.lock().unwrap().durable_revision().unwrap();

            let result = challenge_interrogation_line_core(&app, "l_deny".into()).unwrap();

            assert!(result.thumbnail_capture.is_none());
            assert!(app.session.lock().unwrap().durable_revision().unwrap() > before);
            assert_eq!(
                app.coordinator.thumbnail_activity(),
                ThumbnailActivityView::Idle
            );
        }

        #[test]
        fn ordinary_dialogue_advance_still_requests_thumbnail() {
            let mut scene = investigation_scene_with_intro("scene", vec![]);
            scene.sublocations[0].transition_dialogue = vec![DialogueItem::Line {
                speaker: "narrator".into(),
                text: "ordinary dialogue".into(),
                portrait: None,
            }];
            let mut engine = empty_engine_with_scene(scene, 1);
            engine.enter_sublocation("room").unwrap();
            let app = mutation_app_with_engine(engine);
            let expected = live_queue_token(&app);

            let result = advance_dialogue_core(&app, expected).unwrap();

            assert!(result.thumbnail_capture.is_some());
        }

        #[test]
        fn dialogue_policy_skips_only_same_interrogation_scene_progress() {
            let scene = two_line_question_scene();
            let interrogation_id = scene.id.clone();
            let interrogation = empty_engine_with_interrogation_scene(scene, 1)
                .view()
                .unwrap();

            // Same chapter + same scene: suppress the thumbnail (still inside
            // the same interrogation's dialogue progress).
            assert!(matches!(
                dialogue_persistence_policy("chapter_1", &interrogation_id, &interrogation),
                MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
            ));

            // Same chapter + different scene: ordinary thumbnail milestone.
            assert!(matches!(
                dialogue_persistence_policy("chapter_1", "previous_scene", &interrogation),
                MutationPersistencePolicy::AutosaveIfAdvanced
            ));

            // Different chapter + same scene ID: scene IDs are chapter-scoped
            // (see `StoryLocationIndex`), so a reused ID across chapters is a
            // different scene. The entry/exit thumbnail must still fire.
            assert!(matches!(
                dialogue_persistence_policy("chapter_2", &interrogation_id, &interrogation),
                MutationPersistencePolicy::AutosaveIfAdvanced
            ));

            let ordinary_app = mutation_app();
            let ordinary = ordinary_app
                .session
                .lock()
                .unwrap()
                .engine
                .as_ref()
                .unwrap()
                .view()
                .unwrap();

            assert!(matches!(
                dialogue_persistence_policy("chapter_1", &interrogation_id, &ordinary),
                MutationPersistencePolicy::AutosaveIfAdvanced
            ));
        }

        #[test]
        fn dialogue_advance_across_chapter_boundary_with_reused_scene_id_requests_thumbnail() {
            use std::fs;

            let guard = tempfile::tempdir().unwrap();
            let d = guard.path().to_path_buf();
            let chapter_1 = d.join("chapter_1");
            let chapter_2 = d.join("chapter_2");
            fs::create_dir_all(&chapter_1).unwrap();
            fs::create_dir_all(&chapter_2).unwrap();
            write_empty_story_catalog_and_content_manifest(&d);
            fs::write(
                d.join("chapters.json"),
                r#"{
  "chapters": [
    {
      "id": "chapter_1",
      "title": "Chapter One",
      "summary": "First",
      "scenes": [
        {"type":"linear","file":"chapter_1/scene_1.json"}
      ]
    },
    {
      "id": "chapter_2",
      "title": "Chapter Two",
      "summary": "Second",
      "scenes": [
        {"type":"interrogation","file":"chapter_2/scene_1.json"}
      ]
    }
  ]
}"#,
            )
            .unwrap();
            // chapter_1/scene_1: linear scene with one dialogue line. Advancing
            // past it exhausts the queue and advance_scene crosses into
            // chapter_2 within the same advance_dialogue mutation.
            fs::write(
                chapter_1.join("scene_1.json"),
                r#"{
  "type": "linear",
  "id": "scene_1",
  "title": "Opening",
  "summary": "Fixture scene summary.",
  "queue": [{"kind":"line","speaker":"A","text":"line"}]
}"#,
            )
            .unwrap();
            // chapter_2/scene_1: interrogation scene that intentionally reuses
            // the same scene_id. A non-empty intro keeps the engine in the
            // interrogation scene after advance_scene loads it, so the
            // committed view is an Interrogation with id "scene_1" in
            // chapter_2 — exactly the cross-chapter duplicate-ID boundary.
            fs::write(
                chapter_2.join("scene_1.json"),
                r#"{
  "type": "interrogation",
  "id": "scene_1",
  "title": "Interrogation",
  "summary": "Fixture scene summary.",
  "intro": [{"kind":"line","speaker":"narrator","text":"intro"}],
  "phases": [{
    "kind": "inquiry",
    "id": "phase_1",
    "label": "證言",
    "subject": {"id":"witness","name":"Witness","role":"Witness","bio":"Quiet."},
    "required": true,
    "status": "unlocked",
    "unlock": null,
    "reveals": [],
    "sceneTag": "room",
    "entryDialogue": [],
    "complete": "auto",
    "questions": []
  }],
  "evidenceManifest": [],
  "statementManifest": [],
  "outro": {"unlock":"auto","dialogue":[]}
}"#,
            )
            .unwrap();

            let engine = GameEngine::new_started(d.clone()).unwrap();
            let app = mutation_app_with_engine(engine);
            let expected = live_queue_token(&app);

            let result = advance_dialogue_core(&app, expected).unwrap();

            // The boundary transition moved from chapter_1/scene_1 (linear)
            // into chapter_2/scene_1 (interrogation). Although the scene IDs
            // match, the chapter changed, so this is a real scene boundary —
            // the entry/exit thumbnail milestone must fire
            // (AutosaveIfAdvanced, not the suppressed variant).
            assert_eq!(result.state.chapter.id, "chapter_2");
            assert!(matches!(
                result.state.scene,
                SceneView::Interrogation { .. }
            ));
            assert!(
                result.thumbnail_capture.is_some(),
                "cross-chapter boundary with a reused scene ID must request a thumbnail"
            );

            // `guard` (a `tempfile::TempDir`) cleans up the fixture root on
            // drop, including during panic unwinding.
        }

        /// Fixture: a started engine that has recorded acquisition events
        /// through the public gameplay path. The analysis source scene
        /// collects nine evidence records and one statement in a single
        /// `inspect_hotspot` command, so the pending vector holds `acq:2:0`
        /// through `acq:2:9` (fresh engine: `enter_sublocation` is command 1,
        /// the inspect is command 2, ordinals start at 0).
        fn acquisition_app() -> (tempfile::TempDir, AppState) {
            let (guard, resources) = analysis_fixture_resources();
            let mut engine = GameEngine::new_started(resources).unwrap();
            engine.enter_sublocation("room").unwrap();
            engine.inspect_hotspot("collect_sources").unwrap();
            let app = AppState {
                session: Arc::new(Mutex::new(AppSession::installed(engine, 7, None))),
                operation_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::with_backend(Arc::new(PassiveBackend)),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
                persistence: None,
            };
            (guard, app)
        }

        #[test]
        fn acknowledge_acquisition_event_clears_presented_event_without_thumbnail() {
            let (_guard, app) = acquisition_app();
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(2));

            let result = acknowledge_acquisition_event_core(&app, "acq:2:0".into()).unwrap();

            assert!(result.thumbnail_capture.is_none());
            assert_eq!(
                app.coordinator.thumbnail_activity(),
                ThumbnailActivityView::Idle
            );
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(3));
            // The cleared event's successor is now presented: acknowledging it
            // succeeds instead of failing as a still-pending ID.
            acknowledge_acquisition_event_core(&app, "acq:2:1".into()).unwrap();
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(4));
        }

        #[test]
        fn duplicate_acknowledgement_does_not_advance_revision() {
            let (_guard, app) = acquisition_app();
            acknowledge_acquisition_event_core(&app, "acq:2:0".into()).unwrap();
            let before = app.session.lock().unwrap().durable_revision();

            let result = acknowledge_acquisition_event_core(&app, "acq:2:0".into()).unwrap();

            assert!(result.thumbnail_capture.is_none());
            assert_eq!(app.session.lock().unwrap().durable_revision(), before);
        }

        #[test]
        fn later_still_pending_id_returns_unknown_acquisition_event_without_change() {
            let (_guard, app) = acquisition_app();
            let before = app.session.lock().unwrap().durable_revision();

            let error = acknowledge_acquisition_event_core(&app, "acq:2:1".into()).unwrap_err();

            assert_eq!(error.code, "unknownAcquisitionEvent");
            assert_eq!(app.session.lock().unwrap().durable_revision(), before);
            assert_eq!(
                app.coordinator.thumbnail_activity(),
                ThumbnailActivityView::Idle
            );
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

        #[test]
        fn read_only_state_remains_a_bare_view() {
            let app = mutation_app();

            let state: GameStateView = read_game_state(&app).unwrap();

            assert_eq!(state.chapter.id, "chapter_1");
        }

        #[test]
        fn centralized_guard_rejects_missing_game_and_busy_persistence() {
            let empty = AppState {
                session: Arc::new(Mutex::new(AppSession::empty())),
                operation_gate: Arc::new(tokio::sync::Mutex::new(())),
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
            app.session.lock().unwrap().persistence.exit_flush_requested = true;
            let exclusive = run_gameplay_mutation(
                &app,
                MutationPersistencePolicy::AutosaveIfAdvanced,
                |engine| engine.view(),
            )
            .unwrap_err();
            assert_eq!(exclusive.code, "persistenceOperationInProgress");
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
                "inspect_hotspot",
                "interview_topic",
                "enter_sublocation",
                "reexamine_evidence",
                "reexamine_statement",
                "complete_interrogation_phase",
            ] {
                let body = function_body(source, command);
                assert!(
                    body.contains("run_gameplay_mutation"),
                    "{command} bypasses the centralized command guard"
                );
                assert!(
                    body.contains("MutationPersistencePolicy::AutosaveIfAdvanced,"),
                    "{command} does not select AutosaveIfAdvanced"
                );
                assert!(
                    !body.contains("MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail"),
                    "{command} must not select the no-thumbnail autosave policy"
                );
                assert!(
                    !body.contains("session.lock()"),
                    "{command} directly locks the application session"
                );
            }

            let acknowledgement = function_body(source, "acknowledge_acquisition_event_core");
            assert!(acknowledgement
                .contains("MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail"));
            assert!(!acknowledgement.contains("session.lock()"));
        }

        #[test]
        fn direct_no_thumbnail_commands_pin_no_thumbnail_autosave_policy() {
            let source = include_str!("lib.rs");
            for command in [
                "acknowledge_acquisition_event_core",
                "select_analysis_board",
                "update_analysis_draft",
                "submit_analysis_board",
                "ask_interrogation_question",
                "present_interrogation_evidence",
                "withdraw_interrogation",
                "resume_interrogation_testimony",
                "challenge_interrogation_line_core",
            ] {
                let body = function_body(source, command);
                assert!(
                    body.contains("run_gameplay_mutation"),
                    "{command} bypasses the centralized command guard"
                );
                assert!(
                    body.contains("MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail"),
                    "{command} must persist without requesting a thumbnail"
                );
                assert!(
                    !body.contains("MutationPersistencePolicy::AutosaveIfAdvanced,"),
                    "{command} must not use the ordinary thumbnail autosave policy"
                );
                assert!(
                    !body.contains("session.lock()"),
                    "{command} directly locks the application session"
                );
            }

            let advance = function_body(source, "advance_dialogue");
            assert!(advance.contains("advance_dialogue_core"));
            let advance_core = function_body(source, "advance_dialogue_core");
            assert!(advance_core.contains("run_gameplay_mutation_selecting_policy"));
            assert!(advance_core.contains("dialogue_persistence_policy"));

            let challenge = function_body(source, "challenge_interrogation_line");
            assert!(challenge.contains("challenge_interrogation_line_core"));
        }

        #[test]
        fn task_11_commands_are_registered_once_with_the_existing_application_surface() {
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
                "get_exit_status",
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
                "cancel_persistence_failure",
                "retry_exit",
                "cancel_exit",
                "exit_without_saving",
                "reset_game",
                "list_scenes",
                "jump_to_scene",
                "advance_dialogue",
                "select_analysis_board",
                "update_analysis_draft",
                "submit_analysis_board",
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
            let marker = format!("fn {name}(");
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

        // Wraps ProductionSaveFilesystem and bumps the coordinator's session
        // generation after the first successful sync_dir, simulating checkpoint
        // replacement winning immediately after the storage operation settles
        // but before the final health publication.
        struct GenerationBumpingFilesystem {
            inner: ProductionSaveFilesystem,
            coordinator: Arc<Mutex<Option<SaveCoordinator>>>,
            armed: AtomicBool,
        }

        impl GenerationBumpingFilesystem {
            fn new(coordinator: Arc<Mutex<Option<SaveCoordinator>>>) -> Self {
                Self {
                    inner: ProductionSaveFilesystem,
                    coordinator,
                    armed: AtomicBool::new(false),
                }
            }

            fn arm(&self) {
                self.armed.store(true, Ordering::SeqCst);
            }
        }

        impl SaveFilesystem for GenerationBumpingFilesystem {
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
                let result = self.inner.sync_dir(path);
                if result.is_ok() && self.armed.swap(false, Ordering::SeqCst) {
                    if let Some(coordinator) = self.coordinator.lock().unwrap().as_ref() {
                        let _ = coordinator.next_session_generation();
                    }
                }
                result
            }
        }

        #[tokio::test]
        async fn manual_save_reports_stale_session_when_replacement_wins_before_initial_publication(
        ) {
            let (_guard, resources) = save_capture_fixture_resources();
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

            // Simulate replacement winning before the initial Pending
            // publication. No write was attempted, so the caller must see
            // staleSessionGeneration, not saveWriteFailed. The generation fence
            // lives inside `issue_thumbnail`, so the stale session is caught
            // atomically at thumbnail preparation -- before a stale ticket is
            // issued, before `latest_by_intent` is superseded, and before any
            // Pending publication -- rather than leaking into `save_manual`.
            app.coordinator.next_session_generation().unwrap();

            let error = app
                .coordinator
                .prepare_application_thumbnail(&app, PreparedThumbnailPurpose::ManualSave)
                .unwrap_err();

            assert_eq!(error.code, "staleSessionGeneration");
        }

        #[tokio::test]
        async fn manual_save_reports_stale_session_when_replacement_wins_after_storage_settles() {
            let shared_coordinator: Arc<Mutex<Option<SaveCoordinator>>> =
                Arc::new(Mutex::new(None));
            let bumping_fs = Arc::new(GenerationBumpingFilesystem::new(Arc::clone(
                &shared_coordinator,
            )));
            let bumping_fs_dyn: Arc<dyn SaveFilesystem> = bumping_fs.clone();
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                bumping_fs_dyn,
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();

            // Share the coordinator so the filesystem can bump the generation
            // during the storage write, simulating replacement winning after
            // the write settles but before the final health publication.
            *shared_coordinator.lock().unwrap() = Some(app.coordinator.clone());
            bumping_fs.arm();

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
                "Written then stale".into(),
                ManualSlotExpectation::Empty,
                ticket.ticket,
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "staleSessionGeneration");
        }

        #[tokio::test]
        async fn delete_save_reports_stale_session_when_replacement_wins_before_initial_publication(
        ) {
            let (_guard, resources) = save_capture_fixture_resources();
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
            let saved = seed_manual(&app, 1, "To delete").await;
            let save_id = valid_save_id(&saved.saved_slot);

            // Simulate replacement winning before the initial Pending
            // publication. No delete was attempted, so the caller must see
            // staleSessionGeneration, not saveWriteFailed.
            app.coordinator.next_session_generation().unwrap();

            let error = delete_save_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                OccupiedSlotExpectation {
                    save_id: Some(save_id),
                    modified_at: None,
                },
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "staleSessionGeneration");
        }

        #[tokio::test]
        async fn delete_save_reports_stale_session_when_replacement_wins_after_storage_settles() {
            let shared_coordinator: Arc<Mutex<Option<SaveCoordinator>>> =
                Arc::new(Mutex::new(None));
            let bumping_fs = Arc::new(GenerationBumpingFilesystem::new(Arc::clone(
                &shared_coordinator,
            )));
            let bumping_fs_dyn: Arc<dyn SaveFilesystem> = bumping_fs.clone();
            let (_guard, resources) = save_capture_fixture_resources();
            let temporary = tempfile::tempdir().unwrap();
            let app = build_app_state_with_storage(
                resources.clone(),
                temporary.path().join("saves"),
                bumping_fs_dyn,
            )
            .unwrap();
            start_game_core(&app, GameEngine::new_started(resources).unwrap())
                .await
                .unwrap();
            let saved = seed_manual(&app, 1, "To delete").await;
            let save_id = valid_save_id(&saved.saved_slot);

            // Share the coordinator so the filesystem can bump the generation
            // during the delete storage operation, simulating replacement
            // winning after the delete settles but before the final health
            // publication.
            *shared_coordinator.lock().unwrap() = Some(app.coordinator.clone());
            bumping_fs.arm();

            let error = delete_save_core(
                &app,
                SaveSlotRef::Manual { slot: 1 },
                OccupiedSlotExpectation {
                    save_id: Some(save_id),
                    modified_at: None,
                },
            )
            .await
            .unwrap_err();

            assert_eq!(error.code, "staleSessionGeneration");
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
        let session = Arc::new(Mutex::new(AppSession::installed(engine("old"), 40, None)));
        let operation_gate = Arc::new(tokio::sync::Mutex::new(()));
        let persistence =
            test_application_persistence(Arc::clone(&session), Arc::clone(&operation_gate));
        AppState {
            session,
            operation_gate,
            coordinator: SaveCoordinator::new(),
            resources_dir: PathBuf::new(),
            save_root: PathBuf::new(),
            persistence: Some(persistence),
        }
    }

    #[tokio::test]
    async fn start_core_rejects_exit_flush_before_allocating_or_installing() {
        let app = app();
        app.session.lock().unwrap().persistence.exit_flush_requested = true;

        let error = tokio::time::timeout(
            Duration::from_millis(50),
            start_game_core(&app, engine("new")),
        )
        .await
        .expect("busy session must fail fast")
        .unwrap_err();

        assert_eq!(error.code, "persistenceOperationInProgress");
        assert_eq!(installed_scene_id(&app), "old");

        app.session.lock().unwrap().persistence.exit_flush_requested = false;
        start_game_core(&app, engine("new")).await.unwrap();
        assert_eq!(app.session.lock().unwrap().persistence.generation, 1);
        assert_eq!(installed_scene_id(&app), "new");
    }

    #[tokio::test]
    async fn reset_core_rejects_exit_flush_without_waiting_for_its_gate() {
        let app = app();
        app.session.lock().unwrap().persistence.exit_flush_requested = true;
        let gate = app.operation_gate.clone().lock_owned().await;

        let error = tokio::time::timeout(
            Duration::from_millis(50),
            start_game_core(&app, engine("new")),
        )
        .await
        .expect("busy session must fail before waiting for G")
        .unwrap_err();

        assert_eq!(error.code, "persistenceOperationInProgress");
        assert_eq!(installed_scene_id(&app), "old");
        drop(gate);
    }
}
