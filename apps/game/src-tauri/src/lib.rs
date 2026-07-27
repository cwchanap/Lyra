// Game engine lives under `game::*`. lib.rs only registers Tauri commands.
//
// `pub mod game` (not `mod game`) — integration tests under src-tauri/tests/
// access the module via the public crate API (`lyra_lib::game::*`).
pub mod game;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::path::BaseDirectory;
use tauri::Manager;

use game::save::coordinator::{
    AppSession, PersistenceFailureTokenView, PersistenceHealthView, PreparedThumbnailPurpose,
    SaveCoordinator, ThumbnailActivityView, ThumbnailCaptureRequestView,
};
use game::save::schema::{SaveBrowserView, SaveDiagnosticView, SaveSlotRef, SaveSlotView};
use game::save::storage::{ManualSlotExpectation, OccupiedSlotExpectation};
use game::{GameEngine, GameError, GameStateView, QueueToken, SceneNavigationIndex};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameplayCommandResultView {
    pub(crate) state: GameStateView,
    pub(crate) thumbnail_capture: Option<ThumbnailCaptureRequestView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Part B fills the manual-save command.
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
    pub(crate) session: Mutex<AppSession>,
    pub(crate) replacement_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) coordinator: SaveCoordinator,
    pub(crate) resources_dir: PathBuf,
    #[allow(dead_code)] // Task 9 Part B/C and Task 10 consume the configured storage root.
    pub(crate) save_root: PathBuf,
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

// Part A registers the closed command names so the application surface cannot
// drift while Parts B/C fill their disk and raw-byte transport behavior.
#[tauri::command]
fn list_saves() -> Result<SaveBrowserOpenResultView, GameError> {
    Err(GameError::save_discovery_unavailable())
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
    let _ = (state, purpose);
    Err(unavailable_error())
}

#[tauri::command]
fn submit_save_thumbnail() -> Result<ThumbnailActivityView, GameError> {
    Err(unavailable_error())
}

#[tauri::command]
fn report_save_thumbnail_failure(
    _state: tauri::State<'_, AppState>,
    ticket: String,
) -> Result<ThumbnailActivityView, GameError> {
    let _ = ticket;
    Err(unavailable_error())
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
fn save_manual(
    reference: SaveSlotRef,
    display_name: String,
    expectation: ManualSlotExpectation,
    prepared_thumbnail_ticket: String,
) -> Result<ManualSaveResultView, GameError> {
    let _ = (
        reference,
        display_name,
        expectation,
        prepared_thumbnail_ticket,
    );
    Err(unavailable_error())
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
            let save_root = app.path().app_data_dir()?.join("saves");
            app.manage(AppState {
                session: Mutex::new(AppSession::empty()),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::new(),
                resources_dir,
                save_root,
            });
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
            AutosaveRegisteredIntent, AutosaveWriteJob, CoordinatorFuture,
        };
        use crate::game::schema::{OutroUnlock, PredicateHotspotInvestigated, UnlockExpr};

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
                session: Mutex::new(AppSession::installed(engine, 7, None)),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::with_backend(Arc::new(PassiveBackend)),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
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
                session: Mutex::new(AppSession::empty()),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: SaveCoordinator::new(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
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
            session: Mutex::new(AppSession::installed(engine("old"), 40, None)),
            replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
            coordinator: SaveCoordinator::new(),
            resources_dir: PathBuf::new(),
            save_root: PathBuf::new(),
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
