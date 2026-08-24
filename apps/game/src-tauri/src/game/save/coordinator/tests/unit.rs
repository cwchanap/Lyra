use super::super::super::capture::CapturedCheckpoint;
use super::super::{
    retry_eligibility, selected_save_challenge_key, AutosaveCapture, AutosaveCommittedWrite,
    AutosaveWriteJob, AutosaveWriteReceipt, BackgroundWriteFailure, CaptureTerminalResult,
    CoordinatorState, FailureChallengeIdentity, FailureTokenSource, FlushOperation,
    PersistenceBypassOperation, PersistenceFailureTokenView, PersistenceHealthView,
    RetryEligibility, SaveCoordinator, ThumbnailActivityView, ThumbnailCapturePurpose,
    THUMBNAIL_CAPTURE_TIMEOUT,
};
use crate::game::save::schema::{
    SaveEnvelope, SaveSlotRef, SaveSlotStatusView, SaveSlotView, SaveType,
};
use crate::game::save::storage::ProductionSaveFilesystem;
use crate::game::test_support::{
    empty_engine_with_scene, investigation_scene_with_intro, representative_save_envelope,
};
use crate::game::GameError;
use crate::AppState;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn coordinator() -> SaveCoordinator {
    SaveCoordinator::ticket_only()
}

fn engine(revision: u64) -> crate::game::GameEngine {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    engine.durable_revision = revision;
    engine
}

fn app(coordinator: SaveCoordinator, generation: u64, revision: u64) -> AppState {
    AppState {
        session: Arc::new(Mutex::new(
            crate::game::save::coordinator::AppSession::installed(
                engine(revision),
                generation,
                None,
            ),
        )),
        operation_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator,
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    }
}

fn empty_app(coordinator: SaveCoordinator, generation: u64) -> AppState {
    AppState {
        session: Arc::new(Mutex::new(
            crate::game::save::coordinator::AppSession::empty_at_generation(generation),
        )),
        operation_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator,
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    }
}

fn empty_autosave_slots() -> Vec<SaveSlotView> {
    (1..=5)
        .map(|slot| SaveSlotView {
            reference: SaveSlotRef::Auto { slot },
            modified_at: None,
            status: SaveSlotStatusView::Empty,
            observed_modified_at: None,
            observed_saved_at: None,
        })
        .collect()
}

fn autosave_envelope(save_id: &str, target: SaveSlotRef, durable_revision: u64) -> SaveEnvelope {
    let mut envelope = representative_save_envelope();
    envelope.save_id = save_id.into();
    envelope.snapshot.durable_revision = durable_revision;
    match target {
        SaveSlotRef::Auto { slot } => {
            envelope.save_type = SaveType::Auto;
            envelope.slot = slot;
        }
        SaveSlotRef::Manual { slot } => {
            envelope.save_type = SaveType::Manual;
            envelope.slot = slot;
        }
    }
    envelope
}

fn write_job(revision: u64) -> AutosaveWriteJob {
    AutosaveWriteJob {
        session_generation: 1,
        durable_revision: revision,
        thumbnail: CaptureTerminalResult::Unavailable,
    }
}

fn receipt(target: SaveSlotRef, save_id: &str, revision: u64) -> AutosaveWriteReceipt {
    AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: revision,
        slot: target,
        save_id: save_id.into(),
    }
}

fn identity<'a>(
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<&'a str>,
) -> FailureChallengeIdentity<'a> {
    FailureChallengeIdentity {
        session_generation,
        discovery_generation,
        durable_revision,
        selected_save_id,
    }
}

fn issue_challenge(
    coordinator: &SaveCoordinator,
    operation: PersistenceBypassOperation,
    id: FailureChallengeIdentity<'_>,
) -> (GameError, PersistenceFailureTokenView) {
    let error = coordinator
        .challenge_persistence_failure(operation, id, GameError::save_write_failed())
        .unwrap();
    let token = serde_json::from_value(serde_json::json!(error
        .failure_token
        .as_deref()
        .expect("challenge error must carry its token")))
    .unwrap();
    (error, token)
}

fn set_failure_tokens(coordinator: &SaveCoordinator, tokens: Vec<Uuid>) {
    coordinator.state.lock().unwrap().failure_token_source =
        FailureTokenSource::Deterministic(tokens.into());
}

// ---------------------------------------------------------------------------
// ThumbnailCaptureRequestView serialization (lines 135-151)
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn thumbnail_capture_request_view_serializes_ticket_and_timeout_ms() {
    let coordinator = coordinator();
    let request = coordinator
        .prepare_thumbnail(ThumbnailCapturePurpose::ManualSave {
            session_generation: 1,
            durable_revision: 2,
        })
        .unwrap();

    let value = serde_json::to_value(&request).unwrap();
    assert!(value["ticket"].is_string());
    assert_eq!(value["ticket"], request.ticket);
    assert_eq!(
        value["timeoutMs"],
        THUMBNAIL_CAPTURE_TIMEOUT.as_millis() as u64
    );
    // Verify the exact wire shape: only `ticket` and `timeoutMs`.
    assert_eq!(value.as_object().unwrap().len(), 2);
}

// ---------------------------------------------------------------------------
// AutosaveCapture::captured / captured_checkpoint (lines 303-322)
// ---------------------------------------------------------------------------

#[test]
fn autosave_capture_captured_round_trips_checkpoint_and_content_revision() {
    let envelope = representative_save_envelope();
    let checkpoint = CapturedCheckpoint {
        summary: envelope.summary.clone(),
        snapshot: envelope.snapshot.clone(),
    };
    let capture = AutosaveCapture::captured(
        write_job(42),
        empty_autosave_slots(),
        checkpoint,
        "sha256:abc".into(),
    );

    let (recovered_checkpoint, recovered_revision) = capture.captured_checkpoint().unwrap();
    assert_eq!(recovered_revision, "sha256:abc");
    assert_eq!(recovered_checkpoint.summary, envelope.summary);
    assert_eq!(recovered_checkpoint.snapshot, envelope.snapshot);
}

#[test]
fn autosave_capture_captured_checkpoint_errors_without_checkpoint() {
    let capture = AutosaveCapture::new(write_job(1), empty_autosave_slots());
    assert_eq!(
        capture.captured_checkpoint().unwrap_err().code,
        "saveWriteFailed"
    );
}

// ---------------------------------------------------------------------------
// AutosaveCapture::register Manual branch (lines 334-335)
// ---------------------------------------------------------------------------

#[test]
fn autosave_capture_register_accepts_manual_slot() {
    let target = SaveSlotRef::Manual { slot: 2 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let capture = AutosaveCapture::new(write_job(10), empty_autosave_slots());
    let registered = capture
        .register(
            target,
            save_id.into(),
            autosave_envelope(save_id, target, 10),
        )
        .unwrap();
    assert_eq!(registered.identity.slot, target);
    assert_eq!(registered.identity.durable_revision, 10);
}

#[test]
fn autosave_capture_register_rejects_mismatched_manual_envelope() {
    let target = SaveSlotRef::Manual { slot: 2 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    // Envelope is Auto but target is Manual.
    let mut envelope = autosave_envelope(save_id, SaveSlotRef::Auto { slot: 2 }, 10);
    envelope.save_type = SaveType::Auto;
    let capture = AutosaveCapture::new(write_job(10), empty_autosave_slots());
    let result = capture.register(target, save_id.into(), envelope);
    assert_eq!(result.err().unwrap().code, "saveWriteFailed");
}

// ---------------------------------------------------------------------------
// AutosavePreparedWrite::commit Simulated (line 431)
// ---------------------------------------------------------------------------

#[test]
fn autosave_prepared_write_commit_rejects_simulated_storage() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let capture = AutosaveCapture::new(write_job(5), empty_autosave_slots());
    let registered = capture
        .register(
            target,
            save_id.into(),
            autosave_envelope(save_id, target, 5),
        )
        .unwrap();
    let prepared = registered.prepare_simulated();
    let fs = ProductionSaveFilesystem;
    let result = prepared.commit(&fs, Path::new(""));
    assert_eq!(result.err().unwrap().code, "saveWriteFailed");
}

// ---------------------------------------------------------------------------
// AutosavePreparedWrite::discard (line 444)
// ---------------------------------------------------------------------------

#[test]
fn autosave_prepared_write_discard_simulated_is_ok() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let capture = AutosaveCapture::new(write_job(5), empty_autosave_slots());
    let registered = capture
        .register(
            target,
            save_id.into(),
            autosave_envelope(save_id, target, 5),
        )
        .unwrap();
    let prepared = registered.prepare_simulated();
    assert!(prepared.discard().is_ok());
}

// ---------------------------------------------------------------------------
// AutosaveCommittedWrite::from_envelope (lines 468-486)
// ---------------------------------------------------------------------------

#[test]
fn autosave_committed_write_from_envelope_accepts_matching_manual_slot() {
    let target = SaveSlotRef::Manual { slot: 3 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let expected = receipt(target, save_id, 7);
    let envelope = autosave_envelope(save_id, target, 7);
    let committed = AutosaveCommittedWrite::from_envelope(expected, &envelope, None).unwrap();
    let (recovered_receipt, recovered_diagnostic) = committed.into_parts();
    assert_eq!(recovered_receipt, receipt(target, save_id, 7));
    assert!(recovered_diagnostic.is_none());
}

#[test]
fn autosave_committed_write_from_envelope_accepts_matching_auto_slot() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let expected = receipt(target, save_id, 3);
    let envelope = autosave_envelope(save_id, target, 3);
    assert!(AutosaveCommittedWrite::from_envelope(expected, &envelope, None).is_ok());
}

#[test]
fn autosave_committed_write_from_envelope_rejects_mismatched_save_id() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let expected = receipt(target, "save-a", 3);
    let envelope = autosave_envelope("save-b", target, 3);
    assert_eq!(
        AutosaveCommittedWrite::from_envelope(expected, &envelope, None)
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

#[test]
fn autosave_committed_write_from_envelope_rejects_mismatched_revision() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let expected = receipt(target, save_id, 3);
    let envelope = autosave_envelope(save_id, target, 99);
    assert_eq!(
        AutosaveCommittedWrite::from_envelope(expected, &envelope, None)
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

#[test]
fn autosave_committed_write_from_envelope_rejects_mismatched_slot_type() {
    let expected = receipt(SaveSlotRef::Manual { slot: 1 }, "save-a", 3);
    let envelope = autosave_envelope("save-a", SaveSlotRef::Auto { slot: 1 }, 3);
    assert_eq!(
        AutosaveCommittedWrite::from_envelope(expected, &envelope, None)
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

// ---------------------------------------------------------------------------
// selected_save_challenge_key (lines 635-641)
// ---------------------------------------------------------------------------

#[test]
fn selected_save_challenge_key_formats_auto_and_manual_refs() {
    assert_eq!(
        selected_save_challenge_key(SaveSlotRef::Auto { slot: 3 }, "save-abc"),
        "auto:3:save-abc"
    );
    assert_eq!(
        selected_save_challenge_key(SaveSlotRef::Manual { slot: 1 }, "save-xyz"),
        "manual:1:save-xyz"
    );
}

// ---------------------------------------------------------------------------
// AppSession::empty (lines 677-679)
// ---------------------------------------------------------------------------

#[test]
fn app_session_empty_has_no_engine_and_zero_generation() {
    let session = crate::game::save::coordinator::AppSession::empty();
    assert!(session.engine.is_none());
    assert_eq!(session.persistence.generation, 0);
    assert_eq!(session.persistence.flush_baseline_revision, 0);
    assert!(session.persistence.autosave_target.is_none());
}

// ---------------------------------------------------------------------------
// AppSession::ensure_exit_flush_available (lines 708-714)
// ---------------------------------------------------------------------------

#[test]
fn ensure_exit_flush_available_requires_exit_flush_requested() {
    let mut session = crate::game::save::coordinator::AppSession::installed(engine(1), 1, None);

    // No exit flush: rejected.
    assert_eq!(
        session.ensure_exit_flush_available().unwrap_err().code,
        "persistenceOperationInProgress"
    );

    // Exit flush requested: OK.
    session.persistence.exit_flush_requested = true;
    assert!(session.ensure_exit_flush_available().is_ok());
}

// ---------------------------------------------------------------------------
// retry_eligibility (lines 4855-4877)
// ---------------------------------------------------------------------------

#[test]
fn retry_eligibility_ignores_when_no_failure() {
    let mut state = CoordinatorState::default();
    assert!(matches!(
        retry_eligibility(&mut state, (1, 1)),
        RetryEligibility::Ignore
    ));
}

#[test]
fn retry_eligibility_ignores_mismatched_identity() {
    let mut state = CoordinatorState {
        failed_write: Some(BackgroundWriteFailure {
            identity: (1, 5),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        ..Default::default()
    };
    assert!(matches!(
        retry_eligibility(&mut state, (1, 3)),
        RetryEligibility::Ignore
    ));
}

#[test]
fn retry_eligibility_proceeds_when_failure_matches_and_not_superseded() {
    let mut state = CoordinatorState {
        failed_write: Some(BackgroundWriteFailure {
            identity: (2, 5),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        ..Default::default()
    };
    assert!(matches!(
        retry_eligibility(&mut state, (2, 5)),
        RetryEligibility::Proceed
    ));
}

#[test]
fn retry_eligibility_retires_when_superseded_by_success() {
    let mut state = CoordinatorState {
        failed_write: Some(BackgroundWriteFailure {
            identity: (2, 5),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        last_successful_write: Some(AutosaveWriteReceipt {
            session_generation: 2,
            durable_revision: 5,
            slot: SaveSlotRef::Auto { slot: 1 },
            save_id: "save-a".into(),
        }),
        ..Default::default()
    };
    let result = retry_eligibility(&mut state, (2, 5));
    assert!(matches!(result, RetryEligibility::Retire { .. }));
    assert!(state.failed_write.is_none());
}

#[test]
fn retry_eligibility_retires_when_superseded_by_pending() {
    let mut state = CoordinatorState {
        failed_write: Some(BackgroundWriteFailure {
            identity: (2, 5),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        pending_autosave: Some(super::super::PendingAutosave {
            serial: 1,
            session_generation: 2,
            durable_revision: 7,
            ticket: "ticket-1".into(),
            purpose: ThumbnailCapturePurpose::Autosave {
                session_generation: 2,
                durable_revision: 7,
            },
            thumbnail_capture_required: true,
            debounce_deadline: Instant::now(),
            capture_deadline: Instant::now() + Duration::from_secs(1),
        }),
        ..Default::default()
    };
    let result = retry_eligibility(&mut state, (2, 5));
    assert!(matches!(result, RetryEligibility::Retire { .. }));
    assert!(state.failed_write.is_none());
}

// ---------------------------------------------------------------------------
// complete_discovery_attempt (lines 2246-2270)
// ---------------------------------------------------------------------------

#[test]
fn complete_discovery_attempt_increments_generation_and_clears_session_challenges() {
    let coordinator = coordinator();
    // Issue a challenge with no discovery_generation (session-scoped).
    let id = identity(1, None, 10, None);
    let (_, _token) = issue_challenge(
        &coordinator,
        PersistenceBypassOperation::StartWithoutSaving,
        id,
    );

    // Issue a challenge with discovery_generation = 0 (discovery-scoped).
    let id2 = identity(1, Some(0), 10, None);
    let _ = issue_challenge(
        &coordinator,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        id2,
    );

    let new_gen = coordinator.complete_discovery_attempt().unwrap();
    assert_eq!(new_gen, 1);

    let state = coordinator.state.lock().unwrap();
    // Discovery-scoped challenge is removed; session-scoped challenge is retained.
    assert_eq!(state.failure_challenges.len(), 1);
    assert_eq!(state.discovery_generation, 1);
}

#[test]
fn complete_discovery_attempt_for_session_rejects_stale_generation() {
    let coordinator = coordinator();
    assert_eq!(
        coordinator
            .complete_discovery_attempt_for_session(99)
            .unwrap_err()
            .code,
        "staleSessionGeneration"
    );
}

#[test]
fn complete_discovery_attempt_for_session_succeeds_for_current_generation() {
    let coordinator = coordinator();
    let gen = coordinator.next_session_generation().unwrap();
    let result = coordinator
        .complete_discovery_attempt_for_session(gen)
        .unwrap();
    assert_eq!(result, 1);
}

// ---------------------------------------------------------------------------
// challenge_persistence_failure stale discovery (line 2288)
// ---------------------------------------------------------------------------

#[test]
fn challenge_persistence_failure_rejects_stale_discovery_generation() {
    let coordinator = coordinator();
    coordinator.state.lock().unwrap().discovery_generation = 5;
    let id = identity(1, Some(3), 10, None);
    assert_eq!(
        coordinator
            .challenge_persistence_failure(
                PersistenceBypassOperation::StartWithoutSaving,
                id,
                GameError::save_write_failed(),
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// challenge_current_session_failure (lines 2391-2422)
// ---------------------------------------------------------------------------

#[test]
fn challenge_current_session_failure_returns_token() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);

    let (error, token) = coordinator
        .challenge_current_session_failure(
            &app,
            PersistenceBypassOperation::StartWithoutSaving,
            None,
            GameError::save_write_failed(),
        )
        .unwrap();

    // The token is moved out of the error into the separate return value.
    assert!(error.failure_token.is_none());
    // The returned token is a canonical UUID v4.
    let uuid = Uuid::parse_str(&token.0).unwrap();
    assert_eq!(uuid.get_version_num(), 4);
    assert_eq!(uuid.hyphenated().to_string(), token.0);
}

#[test]
fn challenge_current_session_failure_rejects_exit_flush_request() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);
    app.session.lock().unwrap().persistence.exit_flush_requested = true;

    assert_eq!(
        coordinator
            .challenge_current_session_failure(
                &app,
                PersistenceBypassOperation::StartWithoutSaving,
                None,
                GameError::save_write_failed(),
            )
            .unwrap_err()
            .code,
        "persistenceOperationInProgress"
    );
}

// ---------------------------------------------------------------------------
// consume_failure_token_matching alternate identity (lines 2328-2329)
// ---------------------------------------------------------------------------

#[test]
fn consume_failure_token_matching_accepts_alternate_identity() {
    let coordinator = coordinator();
    let token = Uuid::new_v4();
    set_failure_tokens(&coordinator, vec![token]);

    // Issue a challenge with session-scoped identity (no discovery_generation).
    let primary = identity(5, None, 10, None);
    let (_, token_view) = issue_challenge(
        &coordinator,
        PersistenceBypassOperation::StartWithoutSaving,
        primary,
    );

    // Consume with a mismatched primary but matching alternate.
    let mismatched = identity(5, Some(99), 10, None);
    let alternate = identity(5, None, 10, None);
    let challenge = coordinator
        .consume_failure_token_matching(
            &token_view,
            PersistenceBypassOperation::StartWithoutSaving,
            mismatched,
            Some(alternate),
        )
        .unwrap();
    assert_eq!(challenge.token, token);
}

#[test]
fn consume_failure_token_matching_rejects_when_neither_identity_matches() {
    let coordinator = coordinator();
    let token = Uuid::new_v4();
    set_failure_tokens(&coordinator, vec![token]);

    let primary = identity(5, None, 10, None);
    let (_, token_view) = issue_challenge(
        &coordinator,
        PersistenceBypassOperation::StartWithoutSaving,
        primary,
    );

    let mismatched = identity(5, None, 99, None);
    let also_mismatched = identity(5, Some(1), 99, None);
    assert_eq!(
        coordinator
            .consume_failure_token_matching(
                &token_view,
                PersistenceBypassOperation::StartWithoutSaving,
                mismatched,
                Some(also_mismatched),
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// cancel_persistence_failure acquisition event path (lines 2376-2379)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cancel_persistence_failure_rejects_exit_operation() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 4, 41);

    let id = identity(4, None, 41, None);
    let (_, token) = issue_challenge(
        &coordinator,
        PersistenceBypassOperation::ExitWithoutSaving,
        id,
    );

    assert_eq!(
        coordinator
            .cancel_persistence_failure(&app, token)
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// publish_persistence_health_for_session stale (line 3735-3736)
// ---------------------------------------------------------------------------

#[test]
fn publish_persistence_health_for_session_rejects_stale_generation() {
    let coordinator = coordinator();
    // Advance next_session_generation to 5.
    for _ in 0..5 {
        coordinator.next_session_generation().unwrap();
    }
    assert_eq!(
        coordinator
            .publish_persistence_health_for_session(2, PersistenceHealthView::Healthy)
            .unwrap_err()
            .code,
        "staleSessionGeneration"
    );
}

#[test]
fn publish_persistence_health_for_session_accepts_current_generation() {
    let coordinator = coordinator();
    coordinator
        .publish_persistence_health_for_session(0, PersistenceHealthView::Healthy)
        .unwrap();
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
}

// ---------------------------------------------------------------------------
// consume_programmatic_exit_bypass (lines 1555-1560)
// ---------------------------------------------------------------------------

#[test]
fn consume_programmatic_exit_bypass_returns_false_by_default() {
    let coordinator = coordinator();
    assert!(!coordinator.consume_programmatic_exit_bypass());
}

#[test]
fn consume_programmatic_exit_bypass_returns_set_value_once() {
    let coordinator = coordinator();
    coordinator.state.lock().unwrap().programmatic_exit_bypass = true;
    assert!(coordinator.consume_programmatic_exit_bypass());
    // Second call returns false (consumed).
    assert!(!coordinator.consume_programmatic_exit_bypass());
}

// ---------------------------------------------------------------------------
// exit_status (lines 1534-1539)
// ---------------------------------------------------------------------------

#[test]
fn exit_status_returns_idle_by_default() {
    let coordinator = coordinator();
    assert_eq!(
        coordinator.exit_status(),
        super::super::ExitStatusView::Idle
    );
}

// ---------------------------------------------------------------------------
// current_exit_status (lines 1807-1812)
// ---------------------------------------------------------------------------

#[test]
fn current_exit_status_returns_idle_by_default() {
    let coordinator = coordinator();
    assert_eq!(
        coordinator.current_exit_status().unwrap(),
        super::super::ExitStatusView::Idle
    );
}

// ---------------------------------------------------------------------------
// validate_current_exit_token (lines 1792-1805)
// ---------------------------------------------------------------------------

#[test]
fn validate_current_exit_token_rejects_when_not_failed() {
    let coordinator = coordinator();
    let token = PersistenceFailureTokenView(Uuid::new_v4().hyphenated().to_string());
    assert_eq!(
        coordinator
            .validate_current_exit_token(&token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// last_successful_write / autosave_target (lines 3400-3414)
// ---------------------------------------------------------------------------

#[test]
fn last_successful_write_is_none_by_default() {
    let coordinator = coordinator();
    assert!(coordinator.last_successful_write().is_none());
}

#[test]
fn autosave_target_is_none_by_default() {
    let coordinator = coordinator();
    assert!(coordinator.autosave_target(1).is_none());
}

// ---------------------------------------------------------------------------
// persistence_health / thumbnail_activity (lines 3669-3683)
// ---------------------------------------------------------------------------

#[test]
fn persistence_health_is_healthy_by_default() {
    let coordinator = coordinator();
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
}

#[test]
fn thumbnail_activity_is_idle_by_default() {
    let coordinator = coordinator();
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}

// ---------------------------------------------------------------------------
// SessionPersistence::flush_revision (lines 873-883)
// ---------------------------------------------------------------------------

#[test]
fn flush_revision_returns_none_when_live_equals_baseline() {
    let persistence =
        crate::game::save::application::session::SessionPersistence::for_installed_engine(
            1, 10, None,
        );
    assert!(persistence
        .flush_revision(FlushOperation::ManualSave, 10)
        .is_none());
}

#[test]
fn flush_revision_returns_some_when_live_exceeds_baseline() {
    let persistence =
        crate::game::save::application::session::SessionPersistence::for_installed_engine(
            1, 10, None,
        );
    assert_eq!(
        persistence.flush_revision(FlushOperation::ManualSave, 15),
        Some(15)
    );
}

#[test]
fn flush_revision_uses_written_revision_as_covered_when_higher() {
    let mut persistence =
        crate::game::save::application::session::SessionPersistence::for_installed_engine(
            1, 10, None,
        );
    let r = AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 20,
        slot: SaveSlotRef::Auto { slot: 1 },
        save_id: "save-a".into(),
    };
    persistence.record_written(&r);
    // Live revision 20 == written 20: no flush needed.
    assert!(persistence
        .flush_revision(FlushOperation::ManualSave, 20)
        .is_none());
    // Live revision 21 > written 20: flush needed.
    assert_eq!(
        persistence.flush_revision(FlushOperation::ManualSave, 21),
        Some(21)
    );
}

// ---------------------------------------------------------------------------
// SessionPersistence::record_written ignores mismatched generation (line 887)
// ---------------------------------------------------------------------------

#[test]
fn record_written_ignores_mismatched_generation() {
    let mut persistence =
        crate::game::save::application::session::SessionPersistence::for_installed_engine(
            1, 10, None,
        );
    let r = AutosaveWriteReceipt {
        session_generation: 99,
        durable_revision: 20,
        slot: SaveSlotRef::Auto { slot: 1 },
        save_id: "save-a".into(),
    };
    persistence.record_written(&r);
    assert!(persistence.written_revision.is_none());
}

// ---------------------------------------------------------------------------
// notify_durable_commit / notify_committed (lines 2611-2645, 2686-2696)
// ---------------------------------------------------------------------------

#[test]
fn notify_durable_commit_without_backend_returns_none() {
    let coordinator = coordinator();
    assert!(coordinator.notify_durable_commit(1, 5).is_none());
}

#[test]
fn notify_durable_commit_without_thumbnail_without_backend_returns_none() {
    let coordinator = coordinator();
    assert!(coordinator
        .notify_durable_commit_without_thumbnail(1, 5)
        .is_none());
}

#[test]
fn notify_committed_wraps_thumbnail_capture() {
    let coordinator = coordinator();
    let notification = coordinator.notify_committed(42u32, 1, 5);
    assert_eq!(notification.committed, 42);
    assert!(notification.thumbnail_capture.is_none());
}

#[test]
fn notify_committed_without_thumbnail_wraps_none() {
    let coordinator = coordinator();
    let notification = coordinator.notify_committed_without_thumbnail(42u32, 1, 5);
    assert_eq!(notification.committed, 42);
    assert!(notification.thumbnail_capture.is_none());
}

// ---------------------------------------------------------------------------
// retry_failed_background without backend (lines 2711-2803)
// ---------------------------------------------------------------------------

#[test]
fn retry_failed_background_returns_none_without_failed_write() {
    let coordinator = coordinator();
    assert!(coordinator
        .retry_failed_background(crate::game::save::coordinator::BackgroundRetryTrigger::ManualSave)
        .is_none());
}

// ---------------------------------------------------------------------------
// transition_identity (lines 2178-2188)
// ---------------------------------------------------------------------------

#[test]
fn transition_identity_returns_generation_and_revision() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 5, 12);
    let identity = coordinator.transition_identity(&app).unwrap();
    assert_eq!(identity.generation, 5);
    assert_eq!(identity.durable_revision, Some(12));
}

#[test]
fn transition_identity_rejects_exit_flush_request() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 5, 12);
    app.session.lock().unwrap().persistence.exit_flush_requested = true;
    assert_eq!(
        coordinator.transition_identity(&app).unwrap_err().code,
        "persistenceOperationInProgress"
    );
}

// ---------------------------------------------------------------------------
// challenge_current_session_error (lines 2425-2443)
// ---------------------------------------------------------------------------

#[test]
fn challenge_current_session_error_returns_challenged_error() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);
    let error = coordinator
        .challenge_current_session_error(
            &app,
            PersistenceBypassOperation::StartWithoutSaving,
            GameError::save_write_failed(),
        )
        .unwrap();
    assert!(error.failure_token.is_some());
}

// ---------------------------------------------------------------------------
// challenge_current_discovery_failure (lines 2445-2468)
// ---------------------------------------------------------------------------

#[test]
fn challenge_current_discovery_failure_returns_challenged_error() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);
    let error = coordinator
        .challenge_current_discovery_failure(
            &app,
            PersistenceBypassOperation::LoadDiscardingCurrent,
            GameError::save_write_failed(),
        )
        .unwrap();
    assert!(error.failure_token.is_some());
}

// ---------------------------------------------------------------------------
// challenge_current_selected_save_failure (lines 2470-2496)
// ---------------------------------------------------------------------------

#[test]
fn challenge_current_selected_save_failure_returns_challenged_error() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);
    let error = coordinator
        .challenge_current_selected_save_failure(
            &app,
            PersistenceBypassOperation::LoadDiscardingCurrent,
            SaveSlotRef::Auto { slot: 1 },
            "save-abc",
            GameError::save_write_failed(),
        )
        .unwrap();
    assert!(error.failure_token.is_some());
}

// ---------------------------------------------------------------------------
// consume_current_discovery_failure (lines 2498-2522)
// ---------------------------------------------------------------------------

#[test]
fn consume_current_discovery_failure_succeeds_with_matching_token() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);
    let error = coordinator
        .challenge_current_discovery_failure(
            &app,
            PersistenceBypassOperation::LoadDiscardingCurrent,
            GameError::save_write_failed(),
        )
        .unwrap();
    let token = PersistenceFailureTokenView::from_error(&error).unwrap();
    let identity = coordinator
        .consume_current_discovery_failure(
            &app,
            &token,
            PersistenceBypassOperation::LoadDiscardingCurrent,
        )
        .unwrap();
    assert_eq!(identity.generation, 3);
    assert_eq!(identity.durable_revision, Some(7));
}

// ---------------------------------------------------------------------------
// consume_current_start_without_saving_failure (lines 2524-2553)
// ---------------------------------------------------------------------------

#[test]
fn consume_current_start_without_saving_failure_succeeds_with_matching_token() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);
    let (_error, token) = coordinator
        .challenge_current_session_failure(
            &app,
            PersistenceBypassOperation::StartWithoutSaving,
            None,
            GameError::save_write_failed(),
        )
        .unwrap();
    let identity = coordinator
        .consume_current_start_without_saving_failure(&app, &token)
        .unwrap();
    assert_eq!(identity.generation, 3);
    assert_eq!(identity.durable_revision, Some(7));
}

// ---------------------------------------------------------------------------
// consume_current_selected_save_failure (lines 2555-2588)
// ---------------------------------------------------------------------------

#[test]
fn consume_current_selected_save_failure_succeeds_with_matching_token() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);
    let error = coordinator
        .challenge_current_selected_save_failure(
            &app,
            PersistenceBypassOperation::LoadDiscardingCurrent,
            SaveSlotRef::Auto { slot: 1 },
            "save-abc",
            GameError::save_write_failed(),
        )
        .unwrap();
    let token = PersistenceFailureTokenView::from_error(&error).unwrap();
    let identity = coordinator
        .consume_current_selected_save_failure(
            &app,
            &token,
            PersistenceBypassOperation::LoadDiscardingCurrent,
            SaveSlotRef::Auto { slot: 1 },
            "save-abc",
        )
        .unwrap();
    assert_eq!(identity.generation, 3);
    assert_eq!(identity.durable_revision, Some(7));
}

// ---------------------------------------------------------------------------
// consume_current_session_failure (lines 2590-2609)
// ---------------------------------------------------------------------------

#[test]
fn consume_current_session_failure_succeeds_with_matching_token() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 3, 7);
    let error = coordinator
        .challenge_current_session_error(
            &app,
            PersistenceBypassOperation::ReturnWithoutSaving,
            GameError::save_write_failed(),
        )
        .unwrap();
    let token = PersistenceFailureTokenView::from_error(&error).unwrap();
    let identity = coordinator
        .consume_current_session_failure(
            &app,
            &token,
            PersistenceBypassOperation::ReturnWithoutSaving,
        )
        .unwrap();
    assert_eq!(identity.generation, 3);
    assert_eq!(identity.durable_revision, Some(7));
}

// ---------------------------------------------------------------------------
// cancel_persistence_failure non-acquisition path (line 2378-2379)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cancel_persistence_failure_uses_transition_identity() {
    let coordinator = coordinator();
    let app = app(coordinator.clone(), 4, 41);

    let id = identity(4, None, 41, None);
    let (_, token) = issue_challenge(
        &coordinator,
        PersistenceBypassOperation::StartWithoutSaving,
        id,
    );

    // cancel_persistence_failure should use transition_identity path.
    coordinator
        .cancel_persistence_failure(&app, token)
        .await
        .unwrap();
}

// ---------------------------------------------------------------------------
// cancel_failure_token (lines 2339-2347)
// ---------------------------------------------------------------------------

#[test]
fn cancel_failure_token_consumes_and_returns_ok() {
    let coordinator = coordinator();
    let id = identity(1, None, 10, None);
    let (_, token) = issue_challenge(
        &coordinator,
        PersistenceBypassOperation::StartWithoutSaving,
        id,
    );
    coordinator
        .cancel_failure_token(&token, PersistenceBypassOperation::StartWithoutSaving, id)
        .unwrap();
}

// ---------------------------------------------------------------------------
// flush_session without backend (lines 2805-2812)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn flush_session_without_engine_fails() {
    let coordinator = coordinator();
    let app = empty_app(coordinator.clone(), 1);
    assert_eq!(
        coordinator
            .flush_session(&app, FlushOperation::ManualSave)
            .await
            .unwrap_err()
            .code,
        "gameNotStarted"
    );
}

// ---------------------------------------------------------------------------
// AutosaveCapture::register rejects mismatched save_id (line 338-339)
// ---------------------------------------------------------------------------

#[test]
fn autosave_capture_register_rejects_mismatched_save_id() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let capture = AutosaveCapture::new(write_job(10), empty_autosave_slots());
    let envelope = autosave_envelope("wrong-save-id", target, 10);
    assert_eq!(
        capture
            .register(target, "correct-save-id".into(), envelope)
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

// ---------------------------------------------------------------------------
// AutosaveCapture::register rejects mismatched revision (line 339)
// ---------------------------------------------------------------------------

#[test]
fn autosave_capture_register_rejects_mismatched_revision() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let capture = AutosaveCapture::new(write_job(10), empty_autosave_slots());
    let envelope = autosave_envelope(save_id, target, 99);
    assert_eq!(
        capture
            .register(target, save_id.into(), envelope)
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

// ---------------------------------------------------------------------------
// publish_persistence_health (lines 3708-3718)
// ---------------------------------------------------------------------------

#[test]
fn publish_persistence_health_notifies_subscribers() {
    let coordinator = coordinator();
    let received = Arc::new(Mutex::new(None));
    let received_clone = received.clone();
    coordinator.subscribe(
        move |health| {
            *received_clone.lock().unwrap() = Some(health);
        },
        |_| {},
    );
    coordinator.publish_persistence_health(PersistenceHealthView::Degraded {
        diagnostic: GameError::save_write_failed(),
    });
    let health = received.lock().unwrap().clone().unwrap();
    assert!(matches!(health, PersistenceHealthView::Degraded { .. }));
}

// ---------------------------------------------------------------------------
// subscribe_exit_status (lines 1541-1553)
// ---------------------------------------------------------------------------

#[test]
fn subscribe_exit_status_receives_current_status() {
    let coordinator = coordinator();
    let received = Arc::new(Mutex::new(None));
    let received_clone = received.clone();
    coordinator.subscribe_exit_status(move |status| {
        *received_clone.lock().unwrap() = Some(status);
    });
    let status = received.lock().unwrap().clone().unwrap();
    assert_eq!(status, super::super::ExitStatusView::Idle);
}
