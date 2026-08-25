use super::helpers::{app, application_fixture_at, RecordingExit};
use crate::game::save::application::commands::{
    cancel_exit_core, cancel_persistence_failure_core, challengeable_flush_failure,
    exit_without_saving_core, finish_persistence_mutation, get_exit_status_core, retry_exit_core,
    return_to_title_without_saving_core,
};
use crate::game::save::application::{
    ApplicationExit, ApplicationPersistence, ExitRequestSource, ExitStatusView,
    FailureChallengeIdentity, PersistenceBypassOperation, PersistenceFailureTokenView,
};
use crate::game::save::schema::SaveSlotRef;
use crate::game::story::StoryStateView;
use crate::game::view::{ChapterView, InventoryView, SceneView};
use crate::game::GameError;
use crate::game::ModeView;
use crate::{
    GameStateView, ManualSlotExpectation, MutationPersistencePolicy, SaveBrowserPreflightView,
};
use std::sync::Arc;

fn identity(
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<&str>,
) -> FailureChallengeIdentity<'_> {
    FailureChallengeIdentity {
        session_generation,
        discovery_generation,
        durable_revision,
        selected_save_id,
    }
}

fn issue(
    persistence: &ApplicationPersistence,
    operation: PersistenceBypassOperation,
    current: FailureChallengeIdentity<'_>,
) -> PersistenceFailureTokenView {
    let error = persistence
        .challenge_persistence_failure(operation, current, GameError::save_write_failed())
        .unwrap();
    PersistenceFailureTokenView::from_error(&error).unwrap()
}

fn minimal_game_state_view() -> GameStateView {
    GameStateView {
        mode: ModeView::GameComplete,
        chapter: ChapterView {
            id: "chapter_1".into(),
            title: "Chapter One".into(),
            summary: "".into(),
            index: 0,
            total: 1,
        },
        scene: SceneView::Linear {
            id: "test".into(),
            title: "Test".into(),
            summary: "".into(),
            index: 0,
            total: 1,
        },
        inventory: InventoryView {
            evidence: vec![],
            statements: vec![],
        },
        story: StoryStateView {
            facts: vec![],
            questions: vec![],
            objectives: vec![],
            authorizations: vec![],
        },
        dialogue_history: vec![],
        pending_acquisition: None,
    }
}

// ---------------------------------------------------------------------------
// challengeable_flush_failure
// ---------------------------------------------------------------------------

#[test]
fn challengeable_flush_failure_returns_original_for_persistence_in_progress() {
    let error = GameError::persistence_operation_in_progress();
    let result = challengeable_flush_failure(error.clone());
    assert_eq!(result.unwrap_err().code, error.code);
}

#[test]
fn challengeable_flush_failure_returns_ok_for_other_errors() {
    let error = GameError::save_write_failed();
    let result = challengeable_flush_failure(error.clone());
    assert_eq!(result.unwrap().code, error.code);
}

// ---------------------------------------------------------------------------
// finish_persistence_mutation
// ---------------------------------------------------------------------------

#[test]
fn finish_persistence_mutation_returns_result_for_persistence_managed() {
    let result = finish_persistence_mutation(
        minimal_game_state_view(),
        MutationPersistencePolicy::PersistenceManaged,
    )
    .unwrap();
    assert!(result.thumbnail_capture.is_none());
}

#[test]
fn finish_persistence_mutation_rejects_autosave_if_advanced() {
    assert_eq!(
        finish_persistence_mutation(
            minimal_game_state_view(),
            MutationPersistencePolicy::AutosaveIfAdvanced
        )
        .unwrap_err()
        .code,
        "stateUnavailable"
    );
}

#[test]
fn finish_persistence_mutation_rejects_autosave_if_advanced_without_thumbnail() {
    assert_eq!(
        finish_persistence_mutation(
            minimal_game_state_view(),
            MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
        )
        .unwrap_err()
        .code,
        "stateUnavailable"
    );
}

// ---------------------------------------------------------------------------
// get_exit_status_core
// ---------------------------------------------------------------------------

#[test]
fn get_exit_status_core_returns_idle_by_default() {
    let fixture = application_fixture_at(1, 0);
    let state = app(&fixture);
    assert_eq!(get_exit_status_core(&state), ExitStatusView::Idle);
}

// ---------------------------------------------------------------------------
// cancel_persistence_failure_core
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cancel_persistence_failure_core_cancels_token() {
    let fixture = application_fixture_at(3, 7);
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::StartWithoutSaving,
        identity(3, None, 7, None),
    );
    let state = app(&fixture);
    cancel_persistence_failure_core(&state, token)
        .await
        .unwrap();
}

// ---------------------------------------------------------------------------
// return_to_title_without_saving_core
// ---------------------------------------------------------------------------

#[tokio::test]
async fn return_to_title_without_saving_core_clears_session_and_returns_browser() {
    let fixture = application_fixture_at(3, 7);
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::ReturnWithoutSaving,
        identity(3, None, 7, None),
    );
    let state = app(&fixture);
    let result = return_to_title_without_saving_core(&state, token)
        .await
        .unwrap();
    assert!(matches!(result.preflight, SaveBrowserPreflightView::Ready));
}

// ---------------------------------------------------------------------------
// cancel_exit_core
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cancel_exit_core_rejects_when_idle() {
    let fixture = application_fixture_at(3, 7);
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::ExitWithoutSaving,
        identity(3, None, 7, None),
    );
    let state = app(&fixture);
    assert_eq!(
        cancel_exit_core(&state, token).unwrap_err().code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// save_manual_core error paths
// ---------------------------------------------------------------------------

#[tokio::test]
async fn save_manual_core_rejects_non_manual_slot_reference() {
    let fixture = application_fixture_at(1, 1);
    let state = app(&fixture);
    let result = crate::game::save::application::commands::save_manual_core(
        &state,
        SaveSlotRef::Auto { slot: 1 },
        "Test Save".into(),
        ManualSlotExpectation::Empty,
        "dummy-ticket".into(),
    )
    .await;
    assert_eq!(result.unwrap_err().code, "saveSlotMismatch");
}

#[tokio::test]
async fn save_manual_core_rejects_empty_display_name() {
    let fixture = application_fixture_at(1, 1);
    let state = app(&fixture);
    let result = crate::game::save::application::commands::save_manual_core(
        &state,
        SaveSlotRef::Manual { slot: 1 },
        "".into(),
        ManualSlotExpectation::Empty,
        "dummy-ticket".into(),
    )
    .await;
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// build_selected_candidate stale save selection
// ---------------------------------------------------------------------------

#[tokio::test]
async fn build_selected_candidate_rejects_missing_save() {
    let fixture = application_fixture_at(1, 0);
    let state = app(&fixture);
    let result = crate::game::save::application::commands::build_selected_candidate(
        &state,
        SaveSlotRef::Manual { slot: 1 },
        "nonexistent-save-id",
    );
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// retry_exit_core / exit_without_saving_core
// ---------------------------------------------------------------------------

struct FailingExit;

impl ApplicationExit for FailingExit {
    fn exit(&self, _code: i32) -> Result<(), GameError> {
        Err(GameError::save_write_failed())
    }
}

#[tokio::test]
async fn retry_exit_core_retries_and_returns_saving_status() {
    let fixture = application_fixture_at(3, 7);
    let state = app(&fixture);
    // Force a failed exit first to get a valid token.
    state
        .persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    let token = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { failure_token, .. } = state.persistence.exit_status() {
                break failure_token;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let exit = Arc::new(RecordingExit::default());
    let result = retry_exit_core(&state, exit.clone(), token).unwrap();
    assert_eq!(result, ExitStatusView::Saving);
}

#[tokio::test]
async fn exit_without_saving_core_exits_and_consumes_token() {
    let fixture = application_fixture_at(3, 7);
    let state = app(&fixture);
    // Force a failed exit first to get a valid token.
    state
        .persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    let token = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { failure_token, .. } = state.persistence.exit_status() {
                break failure_token;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let exit = Arc::new(RecordingExit::default());
    exit_without_saving_core(&state, exit.clone(), token).unwrap();
    exit.wait_for_call().await;
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}
