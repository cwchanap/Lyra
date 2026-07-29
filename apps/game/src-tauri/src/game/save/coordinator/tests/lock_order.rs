use super::super::{
    AppSession, ExclusivePersistenceIntent, FlushOperation, SaveCoordinator, AUTOSAVE_DEBOUNCE,
};
use super::acknowledgement::{app_with_event, terminal_acknowledgement_ticket};
use super::debounce::PhasedBackend;
use super::storage_integration::StorageBackend;
use crate::game::save::schema::SaveSlotRef;
use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
use crate::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn engine(revision: u64) -> crate::game::GameEngine {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    engine.durable_revision = revision;
    engine
}

fn app(
    coordinator: SaveCoordinator,
    generation: u64,
    revision: u64,
    autosave_target: Option<SaveSlotRef>,
) -> AppState {
    AppState {
        session: Arc::new(Mutex::new(AppSession::installed(
            engine(revision),
            generation,
            autosave_target,
        ))),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator,
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    }
}

#[tokio::test]
async fn queued_exclusive_intent_rejects_session_transitions_without_waiting() {
    let coordinator = SaveCoordinator::new();
    let app = app(coordinator.clone(), 4, 9, None);
    app.session.lock().unwrap().persistence.exclusive_intent =
        Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement);

    let install = tokio::time::timeout(
        Duration::from_millis(50),
        coordinator.install_session(&app, engine(21), SaveSlotRef::Auto { slot: 3 }.into()),
    )
    .await
    .expect("install must fail fast")
    .unwrap_err();
    assert_eq!(install.code, "persistenceOperationInProgress");

    let clear = tokio::time::timeout(Duration::from_millis(50), coordinator.clear_session(&app))
        .await
        .expect("clear must fail fast")
        .unwrap_err();
    assert_eq!(clear.code, "persistenceOperationInProgress");
}

#[tokio::test]
async fn replacements_install_monotonic_generations_and_only_adopt_auto_targets() {
    let coordinator = SaveCoordinator::new();
    let app = app(coordinator.clone(), 0, 0, None);

    coordinator
        .install_session(&app, engine(0), None)
        .await
        .unwrap();
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.persistence.generation, 1);
        assert_eq!(session.persistence.flush_baseline_revision, 0);
        assert_eq!(session.persistence.autosave_target, None);
    }

    coordinator
        .install_session(&app, engine(44), Some(SaveSlotRef::Auto { slot: 4 }))
        .await
        .unwrap();
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.persistence.generation, 2);
        assert_eq!(session.persistence.flush_baseline_revision, 44);
        assert_eq!(
            session.persistence.autosave_target,
            Some(SaveSlotRef::Auto { slot: 4 })
        );
    }

    coordinator
        .install_session(&app, engine(18), Some(SaveSlotRef::Manual { slot: 2 }))
        .await
        .unwrap();
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.persistence.generation, 3);
        assert_eq!(session.persistence.flush_baseline_revision, 18);
        assert_eq!(session.persistence.autosave_target, None);
    }

    assert_eq!(coordinator.clear_session(&app).await.unwrap(), 4);
    let session = app.session.lock().unwrap();
    assert!(session.engine.is_none());
    assert_eq!(session.persistence.generation, 4);
    assert_eq!(session.persistence.autosave_target, None);
}

#[tokio::test]
async fn writer_holding_gate_never_blocks_session_access_for_install_or_clear() {
    for clear in [false, true] {
        let coordinator = SaveCoordinator::new();
        let app = Arc::new(app(coordinator.clone(), 7, 12, None));
        let gate = app.replacement_gate.clone().lock_owned().await;
        let transition = {
            let app = Arc::clone(&app);
            let coordinator = coordinator.clone();
            tokio::spawn(async move {
                if clear {
                    coordinator.clear_session(&app).await.map(|_| ())
                } else {
                    coordinator
                        .install_session(&app, engine(33), None)
                        .await
                        .map(|_| ())
                }
            })
        };

        tokio::task::yield_now().await;
        assert!(
            app.session.try_lock().is_ok(),
            "a transition waiting for G must not own S"
        );
        drop(gate);
        tokio::time::timeout(Duration::from_millis(250), transition)
            .await
            .expect("transition wedged behind a writer holding G")
            .unwrap()
            .unwrap();
    }
}

#[tokio::test(start_paused = true)]
async fn waiter_for_writer_owns_neither_session_nor_replacement_gate() {
    let backend = Arc::new(PhasedBackend::new(3));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let app = Arc::new(app(coordinator.clone(), 3, 2, None));

    let autosave = coordinator.notify_durable_commit(3, 2).unwrap();
    coordinator
        .report_thumbnail_failure(&autosave.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    let flush = {
        let app = Arc::clone(&app);
        let coordinator = coordinator.clone();
        tokio::spawn(async move {
            coordinator
                .flush_session(&app, FlushOperation::ReturnToTitle)
                .await
        })
    };
    tokio::task::yield_now().await;

    assert!(app.session.try_lock().is_ok(), "W waiter must not own S");
    assert!(
        app.replacement_gate.try_lock().is_ok(),
        "W waiter must not own G"
    );

    backend.release_prepare();
    flush.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn queued_acknowledgement_rejects_every_session_transition_without_owning_s_or_g() {
    let backend = Arc::new(PhasedBackend::new(8));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:3:0";
    let app = Arc::new(app_with_event(coordinator.clone(), 8, 3, event_id, None));

    let autosave = coordinator.notify_durable_commit(8, 3).unwrap();
    coordinator
        .report_thumbnail_failure(&autosave.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    let ticket = terminal_acknowledgement_ticket(&coordinator, 8, 3, event_id);
    let acknowledgement = {
        let app = Arc::clone(&app);
        let coordinator = coordinator.clone();
        tokio::spawn(async move {
            coordinator
                .acknowledge_acquisition(&app, event_id.into(), ticket)
                .await
        })
    };
    for _ in 0..100 {
        if app
            .session
            .lock()
            .unwrap()
            .persistence
            .exclusive_intent
            .is_some()
        {
            break;
        }
        tokio::task::yield_now().await;
    }

    {
        let session = app.session.try_lock().expect("queued ack must not own S");
        assert_eq!(
            session.ensure_persistence_available().unwrap_err().code,
            "persistenceOperationInProgress"
        );
    }
    assert!(
        app.replacement_gate.try_lock().is_ok(),
        "queued ack must not own G"
    );
    assert_eq!(
        crate::start_game_core(&app, engine(90))
            .await
            .unwrap_err()
            .code,
        "persistenceOperationInProgress"
    );
    assert_eq!(
        coordinator.clear_session(&app).await.unwrap_err().code,
        "persistenceOperationInProgress"
    );

    backend.release_prepare();
    acknowledgement.await.unwrap().unwrap();
}

#[tokio::test]
async fn active_acknowledgement_holds_g_not_s_and_other_transitions_fail_fast() {
    let backend = Arc::new(PhasedBackend::new(9));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:4:0";
    let app = Arc::new(app_with_event(coordinator.clone(), 9, 4, event_id, None));
    let ticket = terminal_acknowledgement_ticket(&coordinator, 9, 4, event_id);
    let acknowledgement = {
        let app = Arc::clone(&app);
        let coordinator = coordinator.clone();
        tokio::spawn(async move {
            coordinator
                .acknowledge_acquisition(&app, event_id.into(), ticket)
                .await
        })
    };
    backend.wait_for_prepare().await;

    assert!(
        app.replacement_gate.try_lock().is_err(),
        "active ack must own G"
    );
    {
        let session = app.session.try_lock().expect("active ack must not own S");
        assert_eq!(
            session.ensure_persistence_available().unwrap_err().code,
            "persistenceOperationInProgress"
        );
    }
    assert_eq!(
        crate::start_game_core(&app, engine(91))
            .await
            .unwrap_err()
            .code,
        "persistenceOperationInProgress"
    );
    assert_eq!(
        coordinator.clear_session(&app).await.unwrap_err().code,
        "persistenceOperationInProgress"
    );

    backend.release_prepare();
    acknowledgement.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn aborting_queued_acknowledgement_clears_intent_and_releases_its_writer_turn() {
    let backend = Arc::new(PhasedBackend::new(13));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:5:0";
    let app = Arc::new(app_with_event(coordinator.clone(), 13, 5, event_id, None));

    let autosave = coordinator.notify_durable_commit(13, 5).unwrap();
    coordinator
        .report_thumbnail_failure(&autosave.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    let ticket = terminal_acknowledgement_ticket(&coordinator, 13, 5, event_id);
    let acknowledgement = {
        let app = Arc::clone(&app);
        let coordinator = coordinator.clone();
        tokio::spawn(async move {
            coordinator
                .acknowledge_acquisition(&app, event_id.into(), ticket)
                .await
        })
    };
    for _ in 0..100 {
        if app
            .session
            .lock()
            .unwrap()
            .persistence
            .exclusive_intent
            .is_some()
        {
            break;
        }
        tokio::task::yield_now().await;
    }

    acknowledgement.abort();
    assert!(matches!(
        acknowledgement.await,
        Err(error) if error.is_cancelled()
    ));
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.durable_revision(), Some(5));
        assert_eq!(session.persistence.written_revision, None);
        assert_eq!(session.persistence.autosave_target, None);
        assert_eq!(
            session
                .engine
                .as_ref()
                .unwrap()
                .pending_acquisition_events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            [event_id]
        );
    }
    assert!(coordinator.last_successful_write().is_none());
    app.session
        .lock()
        .unwrap()
        .ensure_persistence_available()
        .unwrap();
    coordinator
        .install_session(&app, engine(6), None)
        .await
        .unwrap();
    coordinator.clear_session(&app).await.unwrap();

    let (turn_tx, turn_rx) = tokio::sync::oneshot::channel();
    coordinator
        .reserve_acknowledgement_writer(Box::pin(async move {
            let _ = turn_tx.send(());
        }))
        .unwrap();
    backend.release_prepare();
    tokio::time::timeout(Duration::from_millis(250), turn_rx)
        .await
        .expect("cancelled queued acknowledgement retained W")
        .unwrap();
}

#[tokio::test]
async fn aborting_active_acknowledgement_clears_intent_and_releases_g_and_w() {
    let backend = Arc::new(StorageBackend::new(14, 7));
    backend.install_old_autosave_with_sidecar();
    let slot_before = backend.slot_bytes(1);
    backend.pause_after_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:6:0";
    let mut app = app_with_event(
        coordinator.clone(),
        14,
        6,
        event_id,
        Some(SaveSlotRef::Auto { slot: 1 }),
    );
    app.replacement_gate = backend.replacement_gate();
    let app = Arc::new(app);
    let ticket = terminal_acknowledgement_ticket(&coordinator, 14, 6, event_id);
    let acknowledgement = {
        let app = Arc::clone(&app);
        let coordinator = coordinator.clone();
        tokio::spawn(async move {
            coordinator
                .acknowledge_acquisition(&app, event_id.into(), ticket)
                .await
        })
    };
    backend.wait_for_prepare().await;
    assert!(app.replacement_gate.try_lock().is_err());

    acknowledgement.abort();
    assert!(matches!(
        acknowledgement.await,
        Err(error) if error.is_cancelled()
    ));
    assert!(app.replacement_gate.try_lock().is_ok());
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.durable_revision(), Some(6));
        assert_eq!(session.persistence.written_revision, None);
        assert_eq!(
            session.persistence.autosave_target,
            Some(SaveSlotRef::Auto { slot: 1 })
        );
        assert_eq!(
            session
                .engine
                .as_ref()
                .unwrap()
                .pending_acquisition_events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            [event_id]
        );
    }
    assert_eq!(backend.slot_bytes(1), slot_before);
    assert_eq!(backend.normal_commit_calls(), 0);
    assert_eq!(backend.held_gate_commit_calls(), 0);
    assert!(coordinator.last_successful_write().is_none());
    app.session
        .lock()
        .unwrap()
        .ensure_persistence_available()
        .unwrap();
    coordinator
        .install_session(&app, engine(7), None)
        .await
        .unwrap();
    coordinator.clear_session(&app).await.unwrap();

    let (turn_tx, turn_rx) = tokio::sync::oneshot::channel();
    coordinator
        .reserve_acknowledgement_writer(Box::pin(async move {
            let _ = turn_tx.send(());
        }))
        .unwrap();
    tokio::time::timeout(Duration::from_millis(250), turn_rx)
        .await
        .expect("cancelled active acknowledgement retained W")
        .unwrap();
}

#[tokio::test(start_paused = true)]
async fn real_temporary_write_keeps_gameplay_session_and_replacement_gate_responsive() {
    let backend = Arc::new(StorageBackend::new(10, 15));
    backend.pause_after_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let app = app(coordinator.clone(), 10, 15, None);

    let request = coordinator.notify_durable_commit(10, 15).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    assert_eq!(app.session.try_lock().unwrap().durable_revision(), Some(15));
    assert!(app.replacement_gate.try_lock().is_ok());
    assert_eq!(backend.phases(), ["S:capture", "S:register", "W:prepare"]);
    assert_eq!(
        backend.observed_required_lock_phases(),
        (true, true, false, false)
    );

    backend.release_prepare();
    backend.wait_for_completions(1).await;
    assert_eq!(
        backend.observed_required_lock_phases(),
        (true, true, true, true)
    );
    assert_eq!(
        backend.phases(),
        [
            "S:capture",
            "S:register",
            "W:prepare",
            "G",
            "G:S:revalidate",
            "W+G:commit"
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn stale_generation_fails_final_revalidation_before_real_replacement() {
    let backend = Arc::new(StorageBackend::new(11, 22));
    backend.pause_after_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    let request = coordinator.notify_durable_commit(11, 22).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    backend.set_current_generation(12);
    backend.release_prepare();
    backend.wait_for_completions(1).await;
    backend.wait_for_discards(1).await;

    assert_eq!(backend.installed_count(), 0);
    assert_eq!(backend.discarded_count(), 1);
    assert_eq!(
        backend.phases(),
        [
            "S:capture",
            "S:register",
            "W:prepare",
            "G",
            "G:S:revalidate"
        ]
    );
    assert!(coordinator.last_successful_write().is_none());
}
