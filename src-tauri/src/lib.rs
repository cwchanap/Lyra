mod investigation;

use std::sync::Mutex;

use investigation::{
    CaseState, DeductionAnswer, DeductionFeedback, InvestigationEngine, InvestigationError,
};

struct AppState {
    engine: Mutex<InvestigationEngine>,
}

fn unavailable_error() -> InvestigationError {
    InvestigationError {
        code: "stateUnavailable".to_string(),
        message: "The case engine is unavailable.".to_string(),
    }
}

#[tauri::command]
fn start_case(state: tauri::State<'_, AppState>) -> Result<CaseState, InvestigationError> {
    let mut engine = state.engine.lock().map_err(|_| unavailable_error())?;
    *engine = InvestigationEngine::new_demo_case();

    Ok(engine.state())
}

#[tauri::command]
fn get_case_state(state: tauri::State<'_, AppState>) -> Result<CaseState, InvestigationError> {
    let engine = state.engine.lock().map_err(|_| unavailable_error())?;

    Ok(engine.state())
}

#[tauri::command]
fn inspect_hotspot(
    state: tauri::State<'_, AppState>,
    hotspot_id: String,
) -> Result<CaseState, InvestigationError> {
    let mut engine = state.engine.lock().map_err(|_| unavailable_error())?;

    engine.inspect_hotspot(&hotspot_id)
}

#[tauri::command]
fn interview_character(
    state: tauri::State<'_, AppState>,
    character_id: String,
    topic_id: String,
) -> Result<CaseState, InvestigationError> {
    let mut engine = state.engine.lock().map_err(|_| unavailable_error())?;

    engine.interview_character(&character_id, &topic_id)
}

#[tauri::command]
fn submit_deduction(
    state: tauri::State<'_, AppState>,
    answers: Vec<DeductionAnswer>,
) -> Result<DeductionFeedback, InvestigationError> {
    let mut engine = state.engine.lock().map_err(|_| unavailable_error())?;

    engine.submit_deduction(answers)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            engine: Mutex::new(InvestigationEngine::new_demo_case()),
        })
        .invoke_handler(tauri::generate_handler![
            start_case,
            get_case_state,
            inspect_hotspot,
            interview_character,
            submit_deduction
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
