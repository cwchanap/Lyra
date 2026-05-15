// Game engine lives under `game::*`. lib.rs only registers Tauri commands.
//
// `pub mod game` (not `mod game`) — integration tests under src-tauri/tests/
// access the module via the public crate API (`lyra_lib::game::*`).
pub mod game;

use std::sync::Mutex;
use game::GameEngine;

struct AppState {
    engine: Mutex<Option<GameEngine>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            engine: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            // Commands will be added in Phase B4.
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
