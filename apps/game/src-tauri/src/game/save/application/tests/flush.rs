use super::helpers::application_fixture_at;
use crate::game::save::application::{FlushOperation, FlushOutcome, PersistenceHealthView};
use crate::AppState;
use std::path::PathBuf;

fn app(fixture: &super::helpers::ApplicationFixture) -> AppState {
    AppState {
        session: fixture.session.clone(),
        persistence: fixture.persistence.clone(),
        resources_dir: PathBuf::new(),
    }
}

#[tokio::test]
async fn fresh_revision_zero_flush_is_a_physical_no_op() {
    let fixture = application_fixture_at(1, 0);
    let state = app(&fixture);
    assert_eq!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::ManualSave)
            .await
            .unwrap(),
        FlushOutcome::Noop {
            session_generation: 1,
            durable_revision: 0,
        }
    );
}

#[tokio::test]
async fn blocking_flush_writes_once_then_is_idempotent() {
    let fixture = application_fixture_at(1, 0);
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 1;
    let state = app(&fixture);
    let first = fixture
        .persistence
        .flush_session(&state, FlushOperation::ManualSave)
        .await
        .unwrap();
    assert!(matches!(first, FlushOutcome::Written { .. }));
    let second = fixture
        .persistence
        .flush_session(&state, FlushOperation::ManualSave)
        .await
        .unwrap();
    assert!(matches!(second, FlushOutcome::Noop { .. }));
    assert_eq!(fixture.filesystem.max_concurrent_mutations(), 1);
    assert_eq!(
        fixture.persistence.persistence_health(),
        PersistenceHealthView::Healthy
    );
}

#[tokio::test]
async fn loaded_baseline_flushes_only_after_a_newer_revision() {
    let fixture = application_fixture_at(7, 44);
    let state = app(&fixture);
    assert!(matches!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::InGameLoad)
            .await
            .unwrap(),
        FlushOutcome::Noop {
            session_generation: 7,
            durable_revision: 44,
        }
    ));
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 45;
    assert!(matches!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::InGameLoad)
            .await
            .unwrap(),
        FlushOutcome::Written {
            session_generation: 7,
            durable_revision: 45,
            ..
        }
    ));
}
