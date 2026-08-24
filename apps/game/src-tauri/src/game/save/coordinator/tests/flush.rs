use super::super::{
    AppSession, AutosaveWriteReceipt, FlushOperation, FlushOutcome, SaveCoordinator,
};
use super::debounce::RecordingBackend;
use crate::game::save::application::session::SessionPersistence;
use crate::game::save::schema::SaveSlotRef;
use crate::game::test_support::{
    empty_engine_with_scene, investigation_scene_with_intro, png_fixture,
};
use crate::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[test]
fn fresh_revision_zero_baseline_is_a_physical_no_op() {
    let persistence = SessionPersistence::for_installed_engine(1, 0, None);

    assert_eq!(
        persistence.flush_revision(FlushOperation::ReturnToTitle, 0),
        None
    );
    assert_eq!(persistence.written_revision, None);
    assert_eq!(persistence.autosave_target, None);
}

#[tokio::test]
async fn fresh_revision_zero_flush_never_enters_the_writer() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let app = AppState {
        session: Arc::new(Mutex::new(AppSession::installed(engine, 1, None))),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator: coordinator.clone(),
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    };

    assert_eq!(
        coordinator
            .flush_session(&app, FlushOperation::ReturnToTitle)
            .await
            .unwrap(),
        FlushOutcome::Noop {
            session_generation: 1,
            durable_revision: 0,
        }
    );
    assert_eq!(backend.write_count(), 0);
    assert_eq!(coordinator.last_successful_write(), None);
    assert_eq!(
        app.session.lock().unwrap().persistence.autosave_target,
        None
    );
}

#[test]
fn loaded_revision_44_baseline_does_not_write_until_revision_45() {
    let source = SaveSlotRef::Auto { slot: 3 };
    let persistence = SessionPersistence::for_installed_engine(7, 44, Some(source));

    assert_eq!(
        persistence.flush_revision(FlushOperation::InGameLoad, 44),
        None
    );
    assert_eq!(
        persistence.flush_revision(FlushOperation::InGameLoad, 45),
        Some(45)
    );
    assert_eq!(persistence.autosave_target, Some(source));
}

#[tokio::test]
async fn loaded_revision_44_flushes_only_after_revision_45() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    engine.durable_revision = 44;
    let source = SaveSlotRef::Auto { slot: 3 };
    let app = AppState {
        session: Arc::new(Mutex::new(AppSession::installed(engine, 7, Some(source)))),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator: coordinator.clone(),
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    };

    assert!(matches!(
        coordinator
            .flush_session(&app, FlushOperation::InGameLoad)
            .await
            .unwrap(),
        FlushOutcome::Noop {
            session_generation: 7,
            durable_revision: 44
        }
    ));
    assert_eq!(backend.write_count(), 0);

    app.session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 45;
    assert!(matches!(
        coordinator
            .flush_session(&app, FlushOperation::InGameLoad)
            .await
            .unwrap(),
        FlushOutcome::Written {
            session_generation: 7,
            durable_revision: 45,
            ..
        }
    ));
    assert_eq!(backend.write_count(), 1);
    assert_eq!(app.session.lock().unwrap().durable_revision(), Some(45));
}

#[test]
fn same_generation_baseline_or_written_revision_covers_every_flush_boundary() {
    let mut persistence = SessionPersistence::for_installed_engine(9, 12, None);
    persistence.record_written(&AutosaveWriteReceipt {
        session_generation: 9,
        durable_revision: 18,
        slot: SaveSlotRef::Auto { slot: 2 },
        save_id: "550e8400-e29b-41d4-a716-446655440001".into(),
    });

    for operation in [
        FlushOperation::ManualSave,
        FlushOperation::InGameLoad,
        FlushOperation::ReturnToTitle,
        FlushOperation::Exit,
    ] {
        assert_eq!(persistence.flush_revision(operation, 12), None);
        assert_eq!(persistence.flush_revision(operation, 18), None);
        assert_eq!(persistence.flush_revision(operation, 19), Some(19));
    }
}

#[test]
fn prior_generation_revision_900_cannot_suppress_new_generation_revision_1() {
    let prior = AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 900,
        slot: SaveSlotRef::Auto { slot: 5 },
        save_id: "550e8400-e29b-41d4-a716-446655440002".into(),
    };
    let mut persistence = SessionPersistence::for_installed_engine(2, 0, None);

    persistence.record_written(&prior);

    assert_eq!(persistence.written_revision, None);
    assert_eq!(
        persistence.flush_revision(FlushOperation::ReturnToTitle, 1),
        Some(1)
    );
    assert_eq!(persistence.autosave_target, None);
}

#[test]
fn installed_sessions_receive_monotonic_generations() {
    let coordinator = super::super::SaveCoordinator::new();

    assert_eq!(coordinator.next_session_generation().unwrap(), 1);
    assert_eq!(coordinator.next_session_generation().unwrap(), 2);
    assert_eq!(coordinator.next_session_generation().unwrap(), 3);
}

#[test]
fn installed_session_baseline_and_target_come_from_the_installed_engine() {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    engine.durable_revision = 44;
    let source = SaveSlotRef::Auto { slot: 4 };

    let session = AppSession::installed(engine, 8, Some(source));

    assert_eq!(session.durable_revision(), Some(44));
    assert_eq!(session.persistence.generation, 8);
    assert_eq!(session.persistence.flush_baseline_revision, 44);
    assert_eq!(session.persistence.autosave_target, Some(source));
}

#[test]
fn flush_and_manual_save_decisions_do_not_advance_durable_revision() {
    let mut durable_revision = 27;
    let persistence = SessionPersistence::for_installed_engine(4, 0, None);

    assert_eq!(
        persistence.flush_revision(FlushOperation::ReturnToTitle, durable_revision),
        Some(27)
    );
    assert_eq!(durable_revision, 27);

    assert_eq!(
        persistence.flush_revision(FlushOperation::ManualSave, durable_revision),
        Some(27)
    );
    assert_eq!(durable_revision, 27);

    durable_revision += 1;
    assert_eq!(durable_revision, 28);
}

#[tokio::test]
async fn blocking_flush_writes_once_then_becomes_idempotent_without_advancing_revision() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let mut session = AppSession::installed(engine, 3, None);
    session.engine.as_mut().unwrap().durable_revision = 1;
    let app = AppState {
        session: Arc::new(Mutex::new(session)),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator: coordinator.clone(),
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    };

    let first = coordinator
        .flush_session(&app, FlushOperation::ReturnToTitle)
        .await
        .unwrap();
    assert!(matches!(
        first,
        FlushOutcome::Written {
            session_generation: 3,
            durable_revision: 1,
            ..
        }
    ));
    assert_eq!(backend.write_count(), 1);

    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.durable_revision(), Some(1));
        assert_eq!(session.persistence.written_revision, Some(1));
        assert_eq!(
            session.persistence.autosave_target,
            Some(SaveSlotRef::Auto { slot: 1 })
        );
    }

    assert_eq!(
        coordinator
            .flush_session(&app, FlushOperation::ManualSave)
            .await
            .unwrap(),
        FlushOutcome::Noop {
            session_generation: 3,
            durable_revision: 1,
        }
    );
    assert_eq!(backend.write_count(), 1);
    assert_eq!(app.session.lock().unwrap().durable_revision(), Some(1));
}

#[tokio::test(start_paused = true)]
async fn blocking_flush_cancels_same_revision_debounce_before_it_enters_writer() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let mut session = AppSession::installed(engine, 3, None);
    session.engine.as_mut().unwrap().durable_revision = 1;
    let app = AppState {
        session: Arc::new(Mutex::new(session)),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator: coordinator.clone(),
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    };

    assert!(coordinator.notify_durable_commit(3, 1).is_some());
    assert!(matches!(
        coordinator
            .flush_session(&app, FlushOperation::ReturnToTitle)
            .await
            .unwrap(),
        FlushOutcome::Written { .. }
    ));
    assert_eq!(backend.write_count(), 1);

    tokio::time::advance(super::super::THUMBNAIL_CAPTURE_TIMEOUT).await;
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }
    assert_eq!(backend.write_count(), 1);
}

#[tokio::test(start_paused = true)]
async fn blocking_flush_preserves_a_terminal_thumbnail_from_the_covered_autosave() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let mut session = AppSession::installed(engine, 3, None);
    session.engine.as_mut().unwrap().durable_revision = 1;
    let app = AppState {
        session: Arc::new(Mutex::new(session)),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator: coordinator.clone(),
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    };

    let request = coordinator.notify_durable_commit(3, 1).unwrap();
    coordinator
        .submit_thumbnail(&request.ticket, &png_fixture(320, 180))
        .unwrap();

    assert!(matches!(
        coordinator
            .flush_session(&app, FlushOperation::ReturnToTitle)
            .await
            .unwrap(),
        FlushOutcome::Written { .. }
    ));
    assert_eq!(backend.write_count(), 1);
    assert_eq!(backend.last_thumbnail_available(), Some(true));
}

#[tokio::test(start_paused = true)]
async fn blocking_flush_discards_an_older_autosave_thumbnail() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let mut session = AppSession::installed(engine, 3, None);
    session.engine.as_mut().unwrap().durable_revision = 2;
    let app = AppState {
        session: Arc::new(Mutex::new(session)),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator: coordinator.clone(),
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    };

    let request = coordinator.notify_durable_commit(3, 1).unwrap();
    coordinator
        .submit_thumbnail(&request.ticket, &png_fixture(320, 180))
        .unwrap();

    assert!(matches!(
        coordinator
            .flush_session(&app, FlushOperation::ReturnToTitle)
            .await
            .unwrap(),
        FlushOutcome::Written { .. }
    ));
    assert_eq!(backend.write_count(), 1);
    assert_eq!(backend.last_thumbnail_available(), Some(false));
}
