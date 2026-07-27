// Game engine lives under `game::*`. lib.rs only registers Tauri commands.
//
// `pub mod game` (not `mod game`) — integration tests under src-tauri/tests/
// access the module via the public crate API (`lyra_lib::game::*`).
pub mod game;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::path::BaseDirectory;
use tauri::Manager;

use game::save::coordinator::{AppSession, SaveCoordinator};
use game::{GameEngine, GameError, GameStateView, QueueToken, SceneNavigationIndex};

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

async fn start_game_core(state: &AppState, engine: GameEngine) -> Result<GameStateView, GameError> {
    state.coordinator.install_session(state, engine, None).await
}

#[tauri::command]
async fn start_game(state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    let engine = GameEngine::new_started(state.resources_dir.clone())?;
    start_game_core(&state, engine).await
}

#[tauri::command]
async fn reset_game(state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    start_game(state).await
}

#[tauri::command]
fn get_state(state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    let session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    session
        .engine
        .as_ref()
        .ok_or_else(GameError::game_not_started)?
        .view()
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
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.jump_to_scene(&chapter_id, &scene_id)
}

#[tauri::command]
fn advance_dialogue(
    state: tauri::State<'_, AppState>,
    expected: QueueToken,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.advance_dialogue(expected)
}

#[tauri::command]
fn inspect_hotspot(
    state: tauri::State<'_, AppState>,
    hotspot_id: String,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.inspect_hotspot(&hotspot_id)
}

#[tauri::command]
fn interview_topic(
    state: tauri::State<'_, AppState>,
    character_id: String,
    topic_id: String,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.interview_topic(&character_id, &topic_id)
}

#[tauri::command]
fn enter_sublocation(
    state: tauri::State<'_, AppState>,
    sublocation_id: String,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.enter_sublocation(&sublocation_id)
}

#[tauri::command]
fn reexamine_evidence(
    state: tauri::State<'_, AppState>,
    evidence_id: String,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.reexamine_evidence(&evidence_id)
}

#[tauri::command]
fn reexamine_statement(
    state: tauri::State<'_, AppState>,
    statement_id: String,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.reexamine_statement(&statement_id)
}

#[tauri::command]
fn ask_interrogation_question(
    state: tauri::State<'_, AppState>,
    question_id: String,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.ask_interrogation_question(&question_id)
}

#[tauri::command]
fn challenge_interrogation_line(
    state: tauri::State<'_, AppState>,
    line_id: String,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.challenge_interrogation_line(&line_id)
}

#[tauri::command]
fn present_interrogation_evidence(
    state: tauri::State<'_, AppState>,
    line_id: String,
    item_kind: String,
    item_id: String,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.present_interrogation_evidence(&line_id, &item_kind, &item_id)
}

#[tauri::command]
fn withdraw_interrogation(state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.withdraw_interrogation()
}

#[tauri::command]
fn resume_interrogation_testimony(
    state: tauri::State<'_, AppState>,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.resume_interrogation_testimony()
}

#[tauri::command]
fn complete_interrogation_phase(
    state: tauri::State<'_, AppState>,
) -> Result<GameStateView, GameError> {
    let mut session = state.session.lock().map_err(|_| unavailable_error())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_mut()
        .ok_or_else(GameError::game_not_started)?;
    engine.complete_interrogation_phase()
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
            start_game,
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
