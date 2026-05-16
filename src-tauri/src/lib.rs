// Game engine lives under `game::*`. lib.rs only registers Tauri commands.
//
// `pub mod game` (not `mod game`) — integration tests under src-tauri/tests/
// access the module via the public crate API (`lyra_lib::game::*`).
pub mod game;

use std::sync::Mutex;
use tauri::Manager;
use tauri::path::BaseDirectory;

use game::{GameEngine, GameError, GameStateView, QueueToken};

struct AppState {
    engine: Mutex<Option<GameEngine>>,
}

fn unavailable_error() -> GameError {
    GameError::unavailable()
}

#[tauri::command]
fn start_game(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    let resources_dir = app
        .path()
        .resolve("scenes", BaseDirectory::Resource)
        .map_err(|e| GameError::scene_load_failed(format!("cannot resolve resources dir: {e}")))?;
    let engine = GameEngine::new_started(resources_dir)?;
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let view = engine.view();
    *guard = Some(engine);
    Ok(view)
}

#[tauri::command]
fn reset_game(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    start_game(app, state)
}

#[tauri::command]
fn get_state(state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    let guard = state.engine.lock().map_err(|_| unavailable_error())?;
    guard.as_ref().map(|e| e.view()).ok_or_else(GameError::game_not_started)
}

#[tauri::command]
fn advance_dialogue(state: tauri::State<'_, AppState>, expected: QueueToken) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.advance_dialogue(expected)
}

#[tauri::command]
fn inspect_hotspot(state: tauri::State<'_, AppState>, hotspot_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.inspect_hotspot(&hotspot_id)
}

#[tauri::command]
fn interview_topic(state: tauri::State<'_, AppState>, character_id: String, topic_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.interview_topic(&character_id, &topic_id)
}

#[tauri::command]
fn enter_sublocation(state: tauri::State<'_, AppState>, sublocation_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.enter_sublocation(&sublocation_id)
}

#[tauri::command]
fn reexamine_evidence(state: tauri::State<'_, AppState>, evidence_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.reexamine_evidence(&evidence_id)
}

#[tauri::command]
fn reexamine_statement(state: tauri::State<'_, AppState>, statement_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.reexamine_statement(&statement_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { engine: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            start_game,
            reset_game,
            get_state,
            advance_dialogue,
            inspect_hotspot,
            interview_topic,
            enter_sublocation,
            reexamine_evidence,
            reexamine_statement,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
