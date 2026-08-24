use super::super::{AppSession, FlushOperation, SaveCoordinator, AUTOSAVE_DEBOUNCE};
use super::storage_integration::StorageBackend;
use crate::game::save::application::tests::autosave::PhasedBackend;
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
        operation_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator,
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    }
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
        let gate = app.operation_gate.clone().lock_owned().await;
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
async fn waiter_for_writer_owns_neither_session_nor_operation_gate() {
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
        app.operation_gate.try_lock().is_ok(),
        "W waiter must not own G"
    );

    backend.release_prepare();
    flush.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn real_temporary_write_keeps_gameplay_session_and_operation_gate_responsive() {
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
    assert!(app.operation_gate.try_lock().is_ok());
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
