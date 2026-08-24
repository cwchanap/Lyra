use super::helpers::{application_fixture, registered_write};
use crate::game::save::coordinator::AUTOSAVE_DEBOUNCE;
use std::time::Duration;

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
