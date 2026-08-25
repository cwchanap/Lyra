use super::helpers::application_fixture_at;
use crate::game::save::application::session::SessionPersistence;
use crate::game::save::application::{
    selected_save_challenge_key, AppSession, ApplicationPersistence, AutosaveCapture,
    AutosaveCommittedWrite, AutosaveWriteJob, AutosaveWriteReceipt, BackgroundWriteFailure,
    CaptureTerminalResult, FailureChallengeIdentity, FlushOperation, PendingAutosave,
    PersistenceBypassOperation, PersistenceFailureTokenView, PersistenceHealthView,
    ThumbnailActivityView, ThumbnailCapturePurpose, THUMBNAIL_CAPTURE_TIMEOUT,
};
use crate::game::save::schema::{SaveEnvelope, SaveSlotRef, SaveType};
use crate::game::test_support::{
    empty_engine_with_scene, investigation_scene_with_intro, representative_save_envelope,
};
use crate::game::GameError;
use crate::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::time::Instant;
use uuid::Uuid;

fn engine(revision: u64) -> crate::game::GameEngine {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    engine.durable_revision = revision;
    engine
}

fn app(fixture: &super::helpers::ApplicationFixture) -> AppState {
    AppState {
        session: fixture.session.clone(),
        persistence: fixture.persistence.clone(),
        resources_dir: PathBuf::new(),
    }
}

fn write_job(revision: u64) -> AutosaveWriteJob {
    AutosaveWriteJob {
        session_generation: 1,
        durable_revision: revision,
        thumbnail: CaptureTerminalResult::Unavailable,
    }
}

fn envelope(save_id: &str, target: SaveSlotRef, revision: u64) -> SaveEnvelope {
    let mut envelope = representative_save_envelope();
    envelope.save_id = save_id.into();
    envelope.snapshot.durable_revision = revision;
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

#[tokio::test(start_paused = true)]
async fn thumbnail_capture_request_view_serializes_ticket_and_timeout_ms() {
    let persistence = ApplicationPersistence::ticket_only();
    let request = persistence
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
    assert_eq!(value.as_object().unwrap().len(), 2);
}

#[test]
fn autosave_capture_captured_round_trips_checkpoint_and_content_revision() {
    let source = representative_save_envelope();
    let checkpoint = crate::game::save::capture::CapturedCheckpoint {
        summary: source.summary.clone(),
        snapshot: source.snapshot.clone(),
    };
    let capture =
        AutosaveCapture::captured(write_job(42), Vec::new(), checkpoint, "sha256:abc".into());
    let (recovered, revision) = capture.captured_checkpoint().unwrap();
    assert_eq!(revision, "sha256:abc");
    assert_eq!(recovered.summary, source.summary);
    assert_eq!(recovered.snapshot, source.snapshot);
}

#[test]
fn autosave_capture_captured_checkpoint_errors_without_checkpoint() {
    assert_eq!(
        AutosaveCapture::new(write_job(1), Vec::new())
            .captured_checkpoint()
            .unwrap_err()
            .code,
        "saveWriteFailed"
    );
}

#[test]
fn autosave_capture_register_accepts_manual_slot() {
    let target = SaveSlotRef::Manual { slot: 2 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let registered = AutosaveCapture::new(write_job(10), Vec::new())
        .register(target, save_id.into(), envelope(save_id, target, 10))
        .unwrap();
    assert_eq!(registered.identity.slot, target);
    assert_eq!(registered.identity.durable_revision, 10);
}

#[test]
fn autosave_capture_register_rejects_mismatched_manual_envelope() {
    let target = SaveSlotRef::Manual { slot: 2 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    assert_eq!(
        AutosaveCapture::new(write_job(10), Vec::new())
            .register(
                target,
                save_id.into(),
                envelope(save_id, SaveSlotRef::Auto { slot: 2 }, 10)
            )
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

#[test]
fn autosave_capture_register_rejects_mismatched_save_id() {
    let target = SaveSlotRef::Auto { slot: 1 };
    assert_eq!(
        AutosaveCapture::new(write_job(10), Vec::new())
            .register(
                target,
                "correct-save-id".into(),
                envelope("wrong-save-id", target, 10)
            )
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

#[test]
fn autosave_capture_register_rejects_mismatched_revision() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    assert_eq!(
        AutosaveCapture::new(write_job(10), Vec::new())
            .register(target, save_id.into(), envelope(save_id, target, 99))
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

#[test]
fn autosave_committed_write_from_envelope_accepts_matching_manual_slot() {
    let target = SaveSlotRef::Manual { slot: 3 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let receipt = AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 7,
        slot: target,
        save_id: save_id.into(),
    };
    let committed =
        AutosaveCommittedWrite::from_envelope(receipt.clone(), &envelope(save_id, target, 7), None)
            .unwrap();
    let (recovered, diagnostic) = committed.into_parts();
    assert_eq!(recovered, receipt);
    assert!(diagnostic.is_none());
}

#[test]
fn autosave_committed_write_from_envelope_accepts_matching_auto_slot() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let save_id = "550e8400-e29b-41d4-a716-446655440000";
    let receipt = AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 3,
        slot: target,
        save_id: save_id.into(),
    };
    assert!(
        AutosaveCommittedWrite::from_envelope(receipt, &envelope(save_id, target, 3), None).is_ok()
    );
}

#[test]
fn autosave_committed_write_from_envelope_rejects_mismatched_save_id() {
    let target = SaveSlotRef::Auto { slot: 1 };
    let receipt = AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 3,
        slot: target,
        save_id: "save-a".into(),
    };
    assert_eq!(
        AutosaveCommittedWrite::from_envelope(receipt, &envelope("save-b", target, 3), None)
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
    let receipt = AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 3,
        slot: target,
        save_id: save_id.into(),
    };
    assert_eq!(
        AutosaveCommittedWrite::from_envelope(receipt, &envelope(save_id, target, 99), None)
            .err()
            .unwrap()
            .code,
        "saveWriteFailed"
    );
}

#[test]
fn autosave_committed_write_from_envelope_rejects_mismatched_slot_type() {
    let expected = SaveSlotRef::Manual { slot: 1 };
    let receipt = AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 3,
        slot: expected,
        save_id: "save-a".into(),
    };
    assert_eq!(
        AutosaveCommittedWrite::from_envelope(
            receipt,
            &envelope("save-a", SaveSlotRef::Auto { slot: 1 }, 3),
            None,
        )
        .err()
        .unwrap()
        .code,
        "saveWriteFailed"
    );
}

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

#[test]
fn app_session_empty_has_no_engine_and_zero_generation() {
    let session = AppSession::empty();
    assert!(session.engine.is_none());
    assert_eq!(session.persistence.generation, 0);
    assert_eq!(session.persistence.flush_baseline_revision, 0);
    assert!(session.persistence.autosave_target.is_none());
}

#[test]
fn ensure_exit_flush_available_requires_exit_flush_requested() {
    let mut session = AppSession::installed(engine(1), 1, None);
    assert_eq!(
        session.ensure_exit_flush_available().unwrap_err().code,
        "persistenceOperationInProgress"
    );
    session.persistence.exit_flush_requested = true;
    assert!(session.ensure_exit_flush_available().is_ok());
}

#[test]
fn retry_eligibility_ignores_when_no_failure() {
    let mut state = super::super::PersistenceState::default();
    assert!(matches!(
        super::super::retry_eligibility(&mut state, (1, 1)),
        super::super::RetryEligibility::Ignore
    ));
}

#[test]
fn retry_eligibility_ignores_mismatched_identity() {
    let mut state = super::super::PersistenceState {
        failed_write: Some(BackgroundWriteFailure {
            identity: (1, 5),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        ..Default::default()
    };
    assert!(matches!(
        super::super::retry_eligibility(&mut state, (1, 3)),
        super::super::RetryEligibility::Ignore
    ));
}

#[test]
fn retry_eligibility_proceeds_when_failure_matches_and_not_superseded() {
    let mut state = super::super::PersistenceState {
        failed_write: Some(BackgroundWriteFailure {
            identity: (2, 5),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        ..Default::default()
    };
    assert!(matches!(
        super::super::retry_eligibility(&mut state, (2, 5)),
        super::super::RetryEligibility::Proceed
    ));
}

#[test]
fn retry_eligibility_retires_when_superseded_by_success() {
    let mut state = super::super::PersistenceState {
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
    assert!(matches!(
        super::super::retry_eligibility(&mut state, (2, 5)),
        super::super::RetryEligibility::Retire { .. }
    ));
    assert!(state.failed_write.is_none());
}

#[test]
fn retry_eligibility_retires_when_superseded_by_pending() {
    let mut state = super::super::PersistenceState {
        failed_write: Some(BackgroundWriteFailure {
            identity: (2, 5),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        pending_autosave: Some(PendingAutosave {
            session_generation: 2,
            durable_revision: 7,
            ticket: "ticket-1".into(),
            purpose: ThumbnailCapturePurpose::Autosave {
                session_generation: 2,
                durable_revision: 7,
            },
            thumbnail_capture_required: true,
            debounce_deadline: Instant::now(),
            capture_deadline: Instant::now() + std::time::Duration::from_secs(1),
        }),
        ..Default::default()
    };
    assert!(matches!(
        super::super::retry_eligibility(&mut state, (2, 5)),
        super::super::RetryEligibility::Retire { .. }
    ));
    assert!(state.failed_write.is_none());
}

#[test]
fn complete_discovery_attempt_increments_generation_and_clears_session_challenges() {
    let persistence = ApplicationPersistence::ticket_only();
    let session_token = issue(
        &persistence,
        PersistenceBypassOperation::StartWithoutSaving,
        identity(1, None, 10, None),
    );
    let discovery_token = issue(
        &persistence,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        identity(1, Some(0), 10, None),
    );
    assert_eq!(persistence.complete_discovery_attempt().unwrap(), 1);
    let state = persistence.state.lock().unwrap();
    assert_eq!(state.discovery_generation, 1);
    assert!(state
        .failure_challenges
        .contains_key(&Uuid::parse_str(&session_token.0).unwrap()));
    assert!(!state
        .failure_challenges
        .contains_key(&Uuid::parse_str(&discovery_token.0).unwrap()));
}

#[test]
fn complete_discovery_attempt_for_session_rejects_stale_generation() {
    assert_eq!(
        ApplicationPersistence::ticket_only()
            .complete_discovery_attempt_for_session(99)
            .unwrap_err()
            .code,
        "staleSessionGeneration"
    );
}

#[test]
fn complete_discovery_attempt_for_session_succeeds_for_current_generation() {
    let persistence = ApplicationPersistence::ticket_only();
    let generation = persistence.next_session_generation().unwrap();
    assert_eq!(
        persistence
            .complete_discovery_attempt_for_session(generation)
            .unwrap(),
        1
    );
}

#[test]
fn challenge_persistence_failure_rejects_stale_discovery_generation() {
    let persistence = ApplicationPersistence::ticket_only();
    persistence.state.lock().unwrap().discovery_generation = 5;
    assert_eq!(
        persistence
            .challenge_persistence_failure(
                PersistenceBypassOperation::StartWithoutSaving,
                identity(1, Some(3), 10, None),
                GameError::save_write_failed(),
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[test]
fn publish_persistence_health_for_session_rejects_stale_generation() {
    let persistence = ApplicationPersistence::ticket_only();
    for _ in 0..5 {
        persistence.next_session_generation().unwrap();
    }
    assert_eq!(
        persistence
            .publish_persistence_health_for_session(2, PersistenceHealthView::Healthy)
            .unwrap_err()
            .code,
        "staleSessionGeneration"
    );
}

#[test]
fn publish_persistence_health_for_session_accepts_current_generation() {
    let persistence = ApplicationPersistence::ticket_only();
    persistence
        .publish_persistence_health_for_session(0, PersistenceHealthView::Healthy)
        .unwrap();
    assert_eq!(
        persistence.persistence_health(),
        PersistenceHealthView::Healthy
    );
}

#[test]
fn transition_identity_returns_generation_and_revision() {
    let fixture = application_fixture_at(5, 12);
    let identity = fixture
        .persistence
        .transition_identity(&app(&fixture))
        .unwrap();
    assert_eq!(identity.generation, 5);
    assert_eq!(identity.durable_revision, Some(12));
}

#[test]
fn transition_identity_rejects_exit_flush_request() {
    let fixture = application_fixture_at(5, 12);
    fixture
        .session
        .lock()
        .unwrap()
        .persistence
        .exit_flush_requested = true;
    assert_eq!(
        fixture
            .persistence
            .transition_identity(&app(&fixture))
            .unwrap_err()
            .code,
        "persistenceOperationInProgress"
    );
}

#[test]
fn challenge_current_session_failure_returns_token() {
    let fixture = application_fixture_at(3, 7);
    let (error, token) = fixture
        .persistence
        .challenge_current_session_failure(
            &app(&fixture),
            PersistenceBypassOperation::StartWithoutSaving,
            None,
            GameError::save_write_failed(),
        )
        .unwrap();
    assert!(error.failure_token.is_none());
    assert_eq!(Uuid::parse_str(&token.0).unwrap().get_version_num(), 4);
}

#[test]
fn challenge_current_session_failure_rejects_exit_flush_request() {
    let fixture = application_fixture_at(3, 7);
    fixture
        .session
        .lock()
        .unwrap()
        .persistence
        .exit_flush_requested = true;
    assert_eq!(
        fixture
            .persistence
            .challenge_current_session_failure(
                &app(&fixture),
                PersistenceBypassOperation::StartWithoutSaving,
                None,
                GameError::save_write_failed(),
            )
            .unwrap_err()
            .code,
        "persistenceOperationInProgress"
    );
}

#[test]
fn challenge_current_session_error_returns_challenged_error() {
    let fixture = application_fixture_at(3, 7);
    assert!(fixture
        .persistence
        .challenge_current_session_error(
            &app(&fixture),
            PersistenceBypassOperation::StartWithoutSaving,
            GameError::save_write_failed(),
        )
        .unwrap()
        .failure_token
        .is_some());
}

#[test]
fn challenge_current_discovery_failure_returns_challenged_error() {
    let fixture = application_fixture_at(3, 7);
    assert!(fixture
        .persistence
        .challenge_current_discovery_failure(
            &app(&fixture),
            PersistenceBypassOperation::LoadDiscardingCurrent,
            GameError::save_write_failed(),
        )
        .unwrap()
        .failure_token
        .is_some());
}

#[test]
fn challenge_current_selected_save_failure_returns_challenged_error() {
    let fixture = application_fixture_at(3, 7);
    assert!(fixture
        .persistence
        .challenge_current_selected_save_failure(
            &app(&fixture),
            PersistenceBypassOperation::LoadDiscardingCurrent,
            SaveSlotRef::Auto { slot: 1 },
            "save-abc",
            GameError::save_write_failed(),
        )
        .unwrap()
        .failure_token
        .is_some());
}

#[test]
fn consume_current_failure_paths_accept_matching_tokens() {
    let fixture = application_fixture_at(3, 7);
    let discovery_error = fixture
        .persistence
        .challenge_current_discovery_failure(
            &app(&fixture),
            PersistenceBypassOperation::LoadDiscardingCurrent,
            GameError::save_write_failed(),
        )
        .unwrap();
    let discovery_token = PersistenceFailureTokenView::from_error(&discovery_error).unwrap();
    assert_eq!(
        fixture
            .persistence
            .consume_current_discovery_failure(
                &app(&fixture),
                &discovery_token,
                PersistenceBypassOperation::LoadDiscardingCurrent,
            )
            .unwrap()
            .generation,
        3
    );

    let (_, start_token) = fixture
        .persistence
        .challenge_current_session_failure(
            &app(&fixture),
            PersistenceBypassOperation::StartWithoutSaving,
            None,
            GameError::save_write_failed(),
        )
        .unwrap();
    assert_eq!(
        fixture
            .persistence
            .consume_current_start_without_saving_failure(&app(&fixture), &start_token)
            .unwrap()
            .generation,
        3
    );

    let selected_error = fixture
        .persistence
        .challenge_current_selected_save_failure(
            &app(&fixture),
            PersistenceBypassOperation::LoadDiscardingCurrent,
            SaveSlotRef::Auto { slot: 1 },
            "save-abc",
            GameError::save_write_failed(),
        )
        .unwrap();
    let selected_token = PersistenceFailureTokenView::from_error(&selected_error).unwrap();
    assert_eq!(
        fixture
            .persistence
            .consume_current_selected_save_failure(
                &app(&fixture),
                &selected_token,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                SaveSlotRef::Auto { slot: 1 },
                "save-abc",
            )
            .unwrap()
            .generation,
        3
    );

    let session_error = fixture
        .persistence
        .challenge_current_session_error(
            &app(&fixture),
            PersistenceBypassOperation::ReturnWithoutSaving,
            GameError::save_write_failed(),
        )
        .unwrap();
    let session_token = PersistenceFailureTokenView::from_error(&session_error).unwrap();
    assert_eq!(
        fixture
            .persistence
            .consume_current_session_failure(
                &app(&fixture),
                &session_token,
                PersistenceBypassOperation::ReturnWithoutSaving,
            )
            .unwrap()
            .generation,
        3
    );
}

#[test]
fn consume_failure_token_matching_accepts_alternate_identity() {
    let persistence = ApplicationPersistence::ticket_only();
    let primary = identity(5, None, 10, None);
    let token = issue(
        &persistence,
        PersistenceBypassOperation::StartWithoutSaving,
        primary,
    );
    let challenge = persistence
        .consume_failure_token_matching(
            &token,
            PersistenceBypassOperation::StartWithoutSaving,
            identity(5, Some(99), 10, None),
            Some(primary),
        )
        .unwrap();
    assert_eq!(challenge.session_generation, 5);
}

#[test]
fn consume_failure_token_matching_rejects_when_neither_identity_matches() {
    let persistence = ApplicationPersistence::ticket_only();
    let token = issue(
        &persistence,
        PersistenceBypassOperation::StartWithoutSaving,
        identity(5, None, 10, None),
    );
    assert_eq!(
        persistence
            .consume_failure_token_matching(
                &token,
                PersistenceBypassOperation::StartWithoutSaving,
                identity(5, None, 99, None),
                Some(identity(5, Some(1), 99, None)),
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn cancel_persistence_failure_rejects_exit_operation() {
    let fixture = application_fixture_at(4, 41);
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::ExitWithoutSaving,
        identity(4, None, 41, None),
    );
    assert_eq!(
        fixture
            .persistence
            .cancel_persistence_failure(&app(&fixture), token)
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[test]
fn consume_programmatic_exit_bypass_returns_false_by_default() {
    assert!(!ApplicationPersistence::ticket_only().consume_programmatic_exit_bypass());
}

#[test]
fn consume_programmatic_exit_bypass_returns_set_value_once() {
    let persistence = ApplicationPersistence::ticket_only();
    persistence.state.lock().unwrap().programmatic_exit_bypass = true;
    assert!(persistence.consume_programmatic_exit_bypass());
    assert!(!persistence.consume_programmatic_exit_bypass());
}

#[tokio::test]
async fn flush_session_without_engine_fails() {
    let fixture = application_fixture_at(1, 0);
    fixture.persistence.clear_session().await.unwrap();
    assert_eq!(
        fixture
            .persistence
            .flush_session(FlushOperation::ManualSave)
            .await
            .unwrap_err()
            .code,
        "gameNotStarted"
    );
}

#[test]
fn last_successful_write_is_none_by_default() {
    assert!(ApplicationPersistence::ticket_only()
        .last_successful_write()
        .is_none());
}

#[test]
fn autosave_target_is_none_by_default() {
    assert!(ApplicationPersistence::ticket_only()
        .autosave_target(1)
        .is_none());
}

#[test]
fn persistence_health_is_healthy_by_default() {
    assert_eq!(
        ApplicationPersistence::ticket_only().persistence_health(),
        PersistenceHealthView::Healthy
    );
}

#[test]
fn thumbnail_activity_is_idle_by_default() {
    assert_eq!(
        ApplicationPersistence::ticket_only().thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}

#[test]
fn flush_revision_returns_none_when_live_equals_baseline() {
    let persistence = SessionPersistence::for_installed_engine(1, 10, None);
    assert!(persistence
        .flush_revision(FlushOperation::ManualSave, 10)
        .is_none());
}

#[test]
fn flush_revision_returns_some_when_live_exceeds_baseline() {
    let persistence = SessionPersistence::for_installed_engine(1, 10, None);
    assert_eq!(
        persistence.flush_revision(FlushOperation::ManualSave, 15),
        Some(15)
    );
}

#[test]
fn flush_revision_uses_written_revision_as_covered_when_higher() {
    let mut persistence = SessionPersistence::for_installed_engine(1, 10, None);
    persistence.record_written(&AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 20,
        slot: SaveSlotRef::Auto { slot: 1 },
        save_id: "save-a".into(),
    });
    assert!(persistence
        .flush_revision(FlushOperation::ManualSave, 20)
        .is_none());
    assert_eq!(
        persistence.flush_revision(FlushOperation::ManualSave, 21),
        Some(21)
    );
}

#[test]
fn record_written_ignores_mismatched_generation() {
    let mut persistence = SessionPersistence::for_installed_engine(1, 10, None);
    persistence.record_written(&AutosaveWriteReceipt {
        session_generation: 99,
        durable_revision: 20,
        slot: SaveSlotRef::Auto { slot: 1 },
        save_id: "save-a".into(),
    });
    assert!(persistence.written_revision.is_none());
}

#[test]
fn retry_failed_background_returns_none_without_failed_write() {
    assert!(ApplicationPersistence::ticket_only()
        .retry_failed_background(crate::game::save::application::BackgroundRetryTrigger::ManualSave)
        .is_none());
}

#[test]
fn cancel_failure_token_consumes_and_returns_ok() {
    let persistence = ApplicationPersistence::ticket_only();
    let current = identity(1, None, 10, None);
    let token = issue(
        &persistence,
        PersistenceBypassOperation::StartWithoutSaving,
        current,
    );
    persistence
        .cancel_failure_token(
            &token,
            PersistenceBypassOperation::StartWithoutSaving,
            current,
        )
        .unwrap();
}

#[tokio::test]
async fn cancel_persistence_failure_uses_transition_identity() {
    let fixture = application_fixture_at(4, 41);
    let current = identity(4, None, 41, None);
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::StartWithoutSaving,
        current,
    );
    fixture
        .persistence
        .cancel_persistence_failure(&app(&fixture), token)
        .await
        .unwrap();
}

#[test]
fn publish_persistence_health_notifies_subscribers() {
    let persistence = ApplicationPersistence::ticket_only();
    let values = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&values);
    persistence.subscribe(move |health| sink.lock().unwrap().push(health), |_| {});
    persistence.publish_persistence_health(PersistenceHealthView::Pending);
    assert_eq!(
        values.lock().unwrap().last(),
        Some(&PersistenceHealthView::Pending)
    );
}

#[test]
fn subscribe_exit_status_receives_current_status() {
    let persistence = ApplicationPersistence::ticket_only();
    let values = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&values);
    persistence.subscribe_exit_status(move |status| sink.lock().unwrap().push(status));
    assert_eq!(
        values.lock().unwrap().as_slice(),
        &[crate::game::save::application::ExitStatusView::Idle]
    );
}

#[test]
fn notify_committed_wraps_thumbnail_capture() {
    let persistence = ApplicationPersistence::ticket_only();
    let notification = persistence.notify_committed(42u32, 1, 5);
    assert_eq!(notification.committed, 42);
    assert!(notification.thumbnail_capture.is_some());
}

#[test]
fn notify_committed_without_thumbnail_wraps_none() {
    let persistence = ApplicationPersistence::ticket_only();
    let notification = persistence.notify_committed_without_thumbnail(42u32, 1, 5);
    assert_eq!(notification.committed, 42);
    assert!(notification.thumbnail_capture.is_none());
}

// ---------------------------------------------------------------------------
// run_storage_write_if_session_current stale generation
// ---------------------------------------------------------------------------

#[tokio::test]
async fn run_storage_write_if_session_current_rejects_stale_generation() {
    let fixture = application_fixture_at(3, 7);
    // Advance the session generation so generation 3 is stale.
    fixture.persistence.next_session_generation().unwrap();
    // Replace the session with a new generation.
    {
        let mut session = fixture.session.lock().unwrap();
        session.persistence.generation = 4;
    }
    let result: Result<(), GameError> = fixture
        .persistence
        .run_storage_write_if_session_current(3, |_, _| Ok(()))
        .await;
    assert_eq!(result.unwrap_err().code, "staleSessionGeneration");
}

#[tokio::test]
async fn run_storage_write_if_session_current_runs_write_for_current_generation() {
    let fixture = application_fixture_at(3, 7);
    let result: Result<bool, GameError> = fixture
        .persistence
        .run_storage_write_if_session_current(3, |_, _| Ok(true))
        .await;
    assert!(result.unwrap());
}

// ---------------------------------------------------------------------------
// health_after_completion with failed_write but no pending/cleanup
// ---------------------------------------------------------------------------

#[test]
fn health_after_completion_returns_degraded_for_failed_write() {
    let state = super::super::PersistenceState {
        failed_write: Some(BackgroundWriteFailure {
            identity: (1, 1),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        ..Default::default()
    };
    assert!(matches!(
        super::super::health_after_completion(&state),
        PersistenceHealthView::Degraded { .. }
    ));
}

#[test]
fn health_after_completion_returns_degraded_for_cleanup_failure() {
    let state = super::super::PersistenceState {
        cleanup_failure: Some(super::super::CleanupFailure {
            diagnostic: GameError::save_write_failed(),
        }),
        ..Default::default()
    };
    assert!(matches!(
        super::super::health_after_completion(&state),
        PersistenceHealthView::Degraded { .. }
    ));
}

#[test]
fn health_after_completion_returns_pending_when_autosave_pending() {
    let state = super::super::PersistenceState {
        pending_autosave: Some(PendingAutosave {
            session_generation: 1,
            durable_revision: 1,
            ticket: "t".into(),
            purpose: ThumbnailCapturePurpose::Autosave {
                session_generation: 1,
                durable_revision: 1,
            },
            thumbnail_capture_required: true,
            debounce_deadline: Instant::now(),
            capture_deadline: Instant::now() + std::time::Duration::from_secs(1),
        }),
        failed_write: Some(BackgroundWriteFailure {
            identity: (1, 1),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        }),
        ..Default::default()
    };
    assert_eq!(
        super::super::health_after_completion(&state),
        PersistenceHealthView::Pending
    );
}

// ---------------------------------------------------------------------------
// consume_current_discovery_failure / consume_current_session_failure error paths
// ---------------------------------------------------------------------------

#[tokio::test]
async fn consume_current_discovery_failure_rejects_stale_token() {
    let fixture = application_fixture_at(3, 7);
    // Issue a token for a different identity.
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        identity(99, None, 99, None),
    );
    assert_eq!(
        fixture
            .persistence
            .consume_current_discovery_failure(
                &app(&fixture),
                &token,
                PersistenceBypassOperation::LoadDiscardingCurrent,
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn consume_current_session_failure_rejects_stale_token() {
    let fixture = application_fixture_at(3, 7);
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::ReturnWithoutSaving,
        identity(99, None, 99, None),
    );
    assert_eq!(
        fixture
            .persistence
            .consume_current_session_failure(
                &app(&fixture),
                &token,
                PersistenceBypassOperation::ReturnWithoutSaving,
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn consume_current_start_without_saving_failure_rejects_stale_token() {
    let fixture = application_fixture_at(3, 7);
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::StartWithoutSaving,
        identity(99, None, 99, None),
    );
    assert_eq!(
        fixture
            .persistence
            .consume_current_start_without_saving_failure(&app(&fixture), &token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// consume_current_selected_save_failure error paths
// ---------------------------------------------------------------------------

#[tokio::test]
async fn consume_current_selected_save_failure_rejects_stale_token() {
    let fixture = application_fixture_at(3, 7);
    let token = issue(
        &fixture.persistence,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        identity(99, None, 99, None),
    );
    assert_eq!(
        fixture
            .persistence
            .consume_current_selected_save_failure(
                &app(&fixture),
                &token,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                SaveSlotRef::Auto { slot: 1 },
                "save-abc",
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}
