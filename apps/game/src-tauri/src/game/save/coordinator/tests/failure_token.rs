use super::super::{
    AppSession, FailureChallengeIdentity, PersistenceBypassOperation, PersistenceFailureTokenView,
    PersistenceHealthView, SaveCoordinator,
};
use crate::game::save::schema::SaveSlotRef;
use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
use crate::game::GameError;
use crate::AppState;
use serde_json::json;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

fn identity<'a>(
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<&'a str>,
    acquisition_event_id: Option<&'a str>,
) -> FailureChallengeIdentity<'a> {
    FailureChallengeIdentity {
        session_generation,
        discovery_generation,
        durable_revision,
        selected_save_id,
        acquisition_event_id,
    }
}

fn issue(
    coordinator: &SaveCoordinator,
    operation: PersistenceBypassOperation,
    identity: FailureChallengeIdentity<'_>,
) -> (GameError, PersistenceFailureTokenView) {
    let error = coordinator
        .challenge_persistence_failure(operation, identity, GameError::save_write_failed())
        .unwrap();
    let token = serde_json::from_value(json!(error
        .failure_token
        .as_deref()
        .expect("challenge error must carry its opaque token")))
    .unwrap();
    (error, token)
}

fn app(coordinator: SaveCoordinator, session_generation: u64, durable_revision: u64) -> AppState {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    engine.durable_revision = durable_revision;
    AppState {
        session: Arc::new(Mutex::new(AppSession::installed(
            engine,
            session_generation,
            None,
        ))),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator,
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    }
}

#[test]
fn challenge_error_exposes_only_a_canonical_uuid_v4_token_on_the_wire() {
    let coordinator = SaveCoordinator::new();
    let (error, token) = issue(
        &coordinator,
        PersistenceBypassOperation::ReturnWithoutSaving,
        identity(7, None, 11, None, None),
    );
    let value = serde_json::to_value(&error).unwrap();
    let token_wire = value["failureToken"].as_str().unwrap();
    let uuid = Uuid::parse_str(token_wire).unwrap();

    assert_eq!(uuid.get_version_num(), 4);
    assert_eq!(uuid.hyphenated().to_string(), token_wire);
    assert_eq!(serde_json::to_value(&token).unwrap(), json!(token_wire));
    assert_eq!(
        value,
        json!({
            "code": "saveWriteFailed",
            "message": "Save could not be written.",
            "failureToken": token_wire,
        })
    );

    assert_eq!(
        serde_json::to_value(GameError::save_write_failed()).unwrap(),
        json!({
            "code": "saveWriteFailed",
            "message": "Save could not be written.",
        })
    );
}

#[test]
fn matching_retry_claim_is_one_shot_and_a_failed_retry_gets_a_new_token() {
    let coordinator = SaveCoordinator::new();
    let current = identity(9, None, 14, Some("save-a"), None);
    let (_, token) = issue(
        &coordinator,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        current,
    );

    let consumed = coordinator
        .consume_failure_token(
            &token,
            PersistenceBypassOperation::LoadDiscardingCurrent,
            current,
        )
        .unwrap();
    assert_eq!(
        consumed.operation,
        PersistenceBypassOperation::LoadDiscardingCurrent
    );
    assert_eq!(
        coordinator
            .consume_failure_token(
                &token,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                current,
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );

    let (retry_error, replacement) = issue(
        &coordinator,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        current,
    );
    assert_ne!(
        retry_error.failure_token.as_deref(),
        serde_json::to_value(&token).unwrap().as_str()
    );
    coordinator
        .consume_failure_token(
            &replacement,
            PersistenceBypassOperation::LoadDiscardingCurrent,
            current,
        )
        .unwrap();
}

#[test]
fn exact_identity_rejects_stale_session_revision_discovery_save_and_event() {
    let coordinator = SaveCoordinator::new();
    assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 1);
    assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 2);
    assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 3);
    let operation = PersistenceBypassOperation::ContinueWithoutSaving;
    let exact = identity(5, Some(3), 8, Some("save-a"), Some("acq:8:0"));
    let stale_identities = [
        identity(6, Some(3), 8, Some("save-a"), Some("acq:8:0")),
        identity(5, Some(3), 9, Some("save-a"), Some("acq:8:0")),
        identity(5, Some(4), 8, Some("save-a"), Some("acq:8:0")),
        identity(5, Some(3), 8, Some("save-b"), Some("acq:8:0")),
        identity(5, Some(3), 8, Some("save-a"), Some("acq:8:1")),
    ];

    for stale in stale_identities {
        let (_, token) = issue(&coordinator, operation, exact);
        assert_eq!(
            coordinator
                .consume_failure_token(&token, operation, stale)
                .unwrap_err()
                .code,
            "stalePersistenceFailureToken"
        );
        coordinator
            .consume_failure_token(&token, operation, exact)
            .expect("a failed identity check must not consume the exact token");
    }
}

#[test]
fn wrong_uuid_is_rejected_without_exposing_challenge_fields() {
    let coordinator = SaveCoordinator::new();
    let current = identity(2, None, 4, None, None);
    let (_, issued) = issue(
        &coordinator,
        PersistenceBypassOperation::ExitWithoutSaving,
        current,
    );
    let wrong: PersistenceFailureTokenView =
        serde_json::from_value(json!(Uuid::new_v4().hyphenated().to_string())).unwrap();

    assert_ne!(
        serde_json::to_value(&issued).unwrap(),
        serde_json::to_value(&wrong).unwrap()
    );
    assert_eq!(
        coordinator
            .consume_failure_token(
                &wrong,
                PersistenceBypassOperation::ExitWithoutSaving,
                current,
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[test]
fn completed_discovery_is_monotonic_and_invalidates_older_global_challenges() {
    let coordinator = SaveCoordinator::new();
    let first = coordinator.complete_discovery_attempt().unwrap();
    let (_, token) = issue(
        &coordinator,
        PersistenceBypassOperation::StartWithoutSaving,
        identity(0, Some(first), 0, None, None),
    );
    let second = coordinator.complete_discovery_attempt().unwrap();

    assert_eq!((first, second), (1, 2));
    assert_eq!(
        coordinator
            .consume_failure_token(
                &token,
                PersistenceBypassOperation::StartWithoutSaving,
                identity(0, Some(second), 0, None, None),
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[test]
fn typed_without_saving_operations_cannot_consume_each_others_challenges() {
    let coordinator = SaveCoordinator::new();
    assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 1);
    assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 2);
    let current = identity(3, Some(2), 7, Some("save-a"), Some("acq:7:0"));
    let operations = [
        PersistenceBypassOperation::StartWithoutSaving,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        PersistenceBypassOperation::ReturnWithoutSaving,
        PersistenceBypassOperation::ContinueWithoutSaving,
        PersistenceBypassOperation::ExitWithoutSaving,
    ];

    for (index, operation) in operations.into_iter().enumerate() {
        let wrong = operations[(index + 1) % operations.len()];
        let (_, token) = issue(&coordinator, operation, current);
        assert_eq!(
            coordinator
                .consume_failure_token(&token, wrong, current)
                .unwrap_err()
                .code,
            "stalePersistenceFailureToken"
        );
    }
}

#[test]
fn cancel_consumes_the_exact_challenge_and_retains_degraded_health() {
    let coordinator = SaveCoordinator::new();
    let operation = PersistenceBypassOperation::ReturnWithoutSaving;
    let current = identity(12, None, 22, None, None);
    let (_, token) = issue(&coordinator, operation, current);

    coordinator
        .cancel_failure_token(&token, operation, current)
        .unwrap();

    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
    assert_eq!(
        coordinator
            .consume_failure_token(&token, operation, current)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn token_only_cancel_derives_the_exact_operation_and_selection_then_rejects_replay() {
    let coordinator = SaveCoordinator::new();
    let app = app(coordinator.clone(), 12, 22);
    coordinator.complete_discovery_attempt().unwrap();
    let error = coordinator
        .challenge_current_selected_save_failure(
            &app,
            PersistenceBypassOperation::LoadDiscardingCurrent,
            SaveSlotRef::Manual { slot: 2 },
            "selected-save-id",
            GameError::save_write_failed(),
        )
        .unwrap();
    let token = PersistenceFailureTokenView::from_error(&error).unwrap();

    coordinator
        .cancel_persistence_failure(&app, token.clone())
        .await
        .unwrap();

    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.persistence.generation, 12);
        assert_eq!(session.durable_revision(), Some(22));
    }
    assert_eq!(
        coordinator
            .cancel_persistence_failure(&app, token)
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn token_only_cancel_rejects_stale_session_and_a_different_token() {
    let coordinator = SaveCoordinator::new();
    let app = app(coordinator.clone(), 3, 7);
    let error = coordinator
        .challenge_current_session_error(
            &app,
            PersistenceBypassOperation::ReturnWithoutSaving,
            GameError::save_write_failed(),
        )
        .unwrap();
    let token = PersistenceFailureTokenView::from_error(&error).unwrap();
    let different: PersistenceFailureTokenView =
        serde_json::from_value(json!(Uuid::new_v4().hyphenated().to_string())).unwrap();

    assert_eq!(
        coordinator
            .cancel_persistence_failure(&app, different)
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );

    app.session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision += 1;
    assert_eq!(
        coordinator
            .cancel_persistence_failure(&app, token)
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn token_only_cancel_validates_the_stored_acquisition_binding() {
    let coordinator = SaveCoordinator::new();
    let app = super::acknowledgement::app_with_event(
        coordinator.clone(),
        8,
        13,
        "acquisition-event",
        None,
    );
    let error = coordinator
        .challenge_persistence_failure(
            PersistenceBypassOperation::ContinueWithoutSaving,
            identity(8, None, 13, None, Some("acquisition-event")),
            GameError::save_write_failed(),
        )
        .unwrap();
    let token = PersistenceFailureTokenView::from_error(&error).unwrap();

    app.session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .pending_acquisition_events
        .clear();

    assert_eq!(
        coordinator
            .cancel_persistence_failure(&app, token)
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[test]
fn public_commands_and_coordinator_api_expose_no_boolean_data_loss_bypass() {
    let public_commands = include_str!("../../../../lib.rs");
    let coordinator_api = include_str!("../mod.rs")
        .split("\n#[cfg(test)]\nmod tests")
        .next()
        .unwrap();

    for forbidden in [
        "force: bool",
        "skip: bool",
        "allow_data_loss: bool",
        "allowDataLoss: bool",
    ] {
        assert!(
            !public_commands.contains(forbidden),
            "public Tauri command exposed forbidden bypass `{forbidden}`"
        );
        assert!(
            !coordinator_api.contains(forbidden),
            "coordinator API exposed forbidden bypass `{forbidden}`"
        );
    }
}

#[test]
fn authoritative_challenge_identity_stays_private_and_nonserializable() {
    let source = include_str!("../mod.rs")
        .split("\n#[cfg(test)]\nmod tests")
        .next()
        .unwrap();
    let (before, after) = source
        .split_once("pub(crate) struct PersistenceFailureChallenge {")
        .unwrap();
    let derive = before.rsplit_once("#[derive(").unwrap().1;
    let derive = derive.split_once(")]").unwrap().0;
    assert!(!derive.contains("Serialize"));
    assert!(!derive.contains("Deserialize"));

    let fields = after.split_once("\n}").unwrap().0;
    for field in fields.lines().filter(|line| line.contains(':')) {
        assert!(
            !field.trim_start().starts_with("pub"),
            "challenge field escaped the coordinator: {field}"
        );
    }
}
