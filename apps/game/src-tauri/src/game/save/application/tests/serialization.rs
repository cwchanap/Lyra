use super::helpers::{application_fixture, registered_write};
use crate::game::save::coordinator::{
    AutosaveWriteReceipt, PersistenceHealthView, AUTOSAVE_DEBOUNCE,
};
use crate::game::save::schema::SaveSlotRef;
use std::time::Duration;
use tokio::time::Instant;

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn storage_mutations_share_one_operation_gate() {
    let fixture = application_fixture();
    fixture.filesystem.pause_staging();
    assert!(fixture
        .coordinator
        .notify_durable_commit_without_thumbnail(1, 1)
        .is_none());
    std::thread::sleep(AUTOSAVE_DEBOUNCE + Duration::from_millis(50));
    fixture.filesystem.wait_for_stage().await;

    let persistence = fixture.persistence.clone();
    let second = tokio::spawn(async move {
        persistence
            .run_storage_write_if_session_current(1, move |fs, root| {
                registered_write(2, 1)
                    .prepare(fs, root)
                    .and_then(|prepared| prepared.discard())
            })
            .await
    });
    let mut overlapped = false;
    for _ in 0..10 {
        if fixture.filesystem.max_concurrent_mutations() >= 2 {
            overlapped = true;
            break;
        }
        tokio::task::yield_now().await;
    }

    fixture.filesystem.release_staging();
    second.await.unwrap().unwrap();
    tokio::task::yield_now().await;

    assert!(
        !overlapped,
        "staged storage mutations must share the operation gate"
    );
    assert_eq!(fixture.filesystem.max_concurrent_mutations(), 1);
    assert_eq!(fixture.filesystem.discarded_count(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn orphan_cleanup_runs_under_operation_gate_and_retries_after_successful_persistence() {
    let fixture = application_fixture();
    fixture.filesystem.fail_next_cleanup();
    let gate = fixture
        .persistence
        .operation_gate
        .clone()
        .lock_owned()
        .await;
    fixture
        .persistence
        .clone()
        .enqueue_orphan_cleanup(fixture.coordinator.clone())
        .unwrap();
    tokio::task::yield_now().await;
    assert_eq!(
        fixture.coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );

    drop(gate);
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if matches!(
                fixture.coordinator.persistence_health(),
                PersistenceHealthView::Degraded {
                    diagnostic: ref error
                } if error.code == "saveReadFailed"
            ) {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    let pending = fixture
        .coordinator
        .pending_autosave_for_test("cleanup-retry-ticket".into(), Instant::now())
        .unwrap();
    fixture.coordinator.record_background_success(
        &pending,
        AutosaveWriteReceipt {
            session_generation: pending.session_generation,
            durable_revision: pending.durable_revision,
            slot: SaveSlotRef::Auto { slot: 1 },
            save_id: "550e8400-e29b-41d4-a716-446655440101".into(),
        },
        None,
    );
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if fixture.coordinator.persistence_health() == PersistenceHealthView::Healthy {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        fixture.coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn blocked_staged_write_does_not_hold_gameplay_session_mutex() {
    let fixture = application_fixture();
    fixture.filesystem.pause_staging();
    assert!(fixture
        .coordinator
        .notify_durable_commit_without_thumbnail(1, 1)
        .is_none());
    std::thread::sleep(AUTOSAVE_DEBOUNCE + Duration::from_millis(50));

    fixture.filesystem.wait_for_stage().await;
    assert!(fixture.session.try_lock().is_ok());

    fixture.filesystem.release_staging();
    for _ in 0..10 {
        if fixture.coordinator.last_successful_write().is_some() {
            break;
        }
        tokio::task::yield_now().await;
    }
}
