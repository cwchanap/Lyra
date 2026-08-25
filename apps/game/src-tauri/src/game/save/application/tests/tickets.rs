use crate::game::save::application::{
    ApplicationPersistence, BackgroundWriteFailure, CaptureTerminalResult, PersistenceHealthView,
    ThumbnailActivityView, ThumbnailCapturePurpose, THUMBNAIL_CAPTURE_TIMEOUT,
};
use crate::game::save::schema::{
    canonical_uuid_v4, ThumbnailUnavailableReason, MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_WIDTH,
};
use crate::game::test_support::png_fixture;
use crate::game::GameError;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn coordinator() -> ApplicationPersistence {
    ApplicationPersistence::ticket_only()
}

fn manual(generation: u64, revision: u64) -> ThumbnailCapturePurpose {
    ThumbnailCapturePurpose::ManualSave {
        session_generation: generation,
        durable_revision: revision,
    }
}

#[tokio::test(start_paused = true)]
async fn ticket_is_a_canonical_uuid_v4_with_one_exact_deadline() {
    let coordinator = coordinator();
    let request = coordinator.prepare_thumbnail(manual(7, 11)).unwrap();

    assert_eq!(
        canonical_uuid_v4(&request.ticket)
            .unwrap()
            .get_version_num(),
        4
    );
    assert_eq!(
        request.timeout_ms(),
        THUMBNAIL_CAPTURE_TIMEOUT.as_millis() as u32
    );
    assert_eq!(
        coordinator.ticket_deadline(&request.ticket).unwrap()
            - coordinator.ticket_issued_at(&request.ticket).unwrap(),
        THUMBNAIL_CAPTURE_TIMEOUT
    );
}

#[tokio::test(start_paused = true)]
async fn remaining_timeout_spends_the_original_budget_and_never_extends_it() {
    let coordinator = coordinator();
    let request = coordinator.prepare_thumbnail(manual(1, 2)).unwrap();

    tokio::time::advance(Duration::from_millis(375)).await;
    assert_eq!(
        request.timeout_ms(),
        (THUMBNAIL_CAPTURE_TIMEOUT.as_millis() - 375) as u32
    );
    tokio::time::advance(THUMBNAIL_CAPTURE_TIMEOUT - Duration::from_millis(375)).await;
    assert_eq!(request.timeout_ms(), 0);
    tokio::time::advance(Duration::from_secs(10)).await;
    assert_eq!(request.timeout_ms(), 0);
}

#[tokio::test(start_paused = true)]
async fn accepted_png_is_terminal_and_can_be_consumed_once() {
    let coordinator = coordinator();
    let purpose = manual(3, 5);
    let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();

    assert_eq!(
        coordinator.submit_thumbnail(&request.ticket, &png_fixture(320, 180)),
        Ok(ThumbnailActivityView::Idle)
    );
    let CaptureTerminalResult::Available(thumbnail) = coordinator
        .claim_thumbnail(&request.ticket, &purpose)
        .unwrap()
    else {
        panic!("accepted PNG must be retained");
    };
    assert_eq!(thumbnail.bytes.len(), 33);
    assert_eq!(thumbnail.width, 320);
    assert_eq!(thumbnail.height, 180);
    assert_eq!(thumbnail.byte_length, 33);
    assert_eq!(
        coordinator
            .claim_thumbnail(&request.ticket, &purpose)
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
    assert_eq!(
        coordinator
            .submit_thumbnail(&request.ticket, &png_fixture(320, 180))
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
}

#[tokio::test(start_paused = true)]
async fn reported_failure_is_terminal_unavailable_and_single_consume() {
    let coordinator = coordinator();
    let purpose = manual(3, 8);
    let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();

    let activity = coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    let ThumbnailActivityView::Unavailable { diagnostic } = activity else {
        panic!("failure must publish a complete unavailable payload");
    };
    assert_eq!(
        diagnostic.reason,
        ThumbnailUnavailableReason::CaptureUnavailable
    );
    assert!(!diagnostic.retryable);
    assert!(matches!(
        coordinator
            .claim_thumbnail(&request.ticket, &purpose)
            .unwrap(),
        CaptureTerminalResult::Unavailable
    ));
    assert_eq!(
        coordinator
            .claim_thumbnail(&request.ticket, &purpose)
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
}

#[tokio::test(start_paused = true)]
async fn expiry_is_terminal_unavailable_at_the_capture_timeout() {
    let coordinator = coordinator();
    let purpose = manual(1, 9);
    let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();

    tokio::time::advance(THUMBNAIL_CAPTURE_TIMEOUT).await;
    tokio::task::yield_now().await;

    assert!(matches!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Unavailable { .. }
    ));
    assert!(matches!(
        coordinator
            .claim_thumbnail(&request.ticket, &purpose)
            .unwrap(),
        CaptureTerminalResult::Unavailable
    ));
    assert_eq!(
        coordinator
            .submit_thumbnail(&request.ticket, &png_fixture(1, 1))
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
}

#[tokio::test(start_paused = true)]
async fn a_newer_intent_supersedes_the_older_ticket_terminally() {
    let coordinator = coordinator();
    let older_purpose = manual(4, 20);
    let older = coordinator
        .prepare_thumbnail(older_purpose.clone())
        .unwrap();
    let newer = coordinator.prepare_thumbnail(manual(4, 21)).unwrap();

    assert_ne!(older.ticket, newer.ticket);
    assert_eq!(
        coordinator
            .claim_thumbnail(&older.ticket, &older_purpose)
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
    assert_eq!(
        coordinator
            .submit_thumbnail(&older.ticket, &png_fixture(1, 1))
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
}

#[tokio::test(start_paused = true)]
async fn claim_rejects_changed_generation_revision_and_purpose() {
    let coordinator = coordinator();
    let original = manual(8, 40);
    let request = coordinator.prepare_thumbnail(original.clone()).unwrap();
    coordinator
        .submit_thumbnail(&request.ticket, &png_fixture(1, 1))
        .unwrap();

    for changed in [
        manual(9, 40),
        manual(8, 39),
        manual(8, 41),
        ThumbnailCapturePurpose::Autosave {
            session_generation: 8,
            durable_revision: 40,
        },
    ] {
        assert_eq!(
            coordinator
                .claim_thumbnail(&request.ticket, &changed)
                .unwrap_err()
                .code,
            "staleThumbnailTicket"
        );
    }
    assert!(matches!(
        coordinator
            .claim_thumbnail(&request.ticket, &original)
            .unwrap(),
        CaptureTerminalResult::Available(_)
    ));
}

#[tokio::test(start_paused = true)]
async fn valid_png_is_bounded_and_digested_before_retention() {
    let coordinator = coordinator();
    let purpose = manual(1, 1);
    let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();
    let bytes = png_fixture(MAX_THUMBNAIL_WIDTH, 1);

    coordinator
        .submit_thumbnail(&request.ticket, &bytes)
        .unwrap();
    let CaptureTerminalResult::Available(thumbnail) = coordinator
        .claim_thumbnail(&request.ticket, &purpose)
        .unwrap()
    else {
        panic!("valid PNG must be retained");
    };
    assert_eq!(thumbnail.byte_length as usize, bytes.len());
    assert_eq!(
        thumbnail.sha256,
        "sha256:4493c13e589d22f0626679ba358933119c84ce86119395589007a90417d7d69e"
    );
}

#[tokio::test(start_paused = true)]
async fn rejected_png_is_terminal_unavailable_and_never_retained() {
    for (bytes, code) in [
        (vec![0; 33], "thumbnailPngMalformed"),
        (vec![0; MAX_THUMBNAIL_BYTES + 1], "thumbnailPngTooLarge"),
        (
            png_fixture(MAX_THUMBNAIL_WIDTH + 1, 1),
            "thumbnailDimensionsOutOfBounds",
        ),
    ] {
        let coordinator = coordinator();
        let purpose = manual(2, 3);
        let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();

        assert_eq!(
            coordinator
                .submit_thumbnail(&request.ticket, &bytes)
                .unwrap_err()
                .code,
            code
        );
        assert!(matches!(
            coordinator
                .claim_thumbnail(&request.ticket, &purpose)
                .unwrap(),
            CaptureTerminalResult::Unavailable
        ));
    }
}

#[tokio::test(start_paused = true)]
async fn only_the_latest_terminal_result_for_an_intent_is_retained() {
    let coordinator = coordinator();
    let purpose = manual(6, 12);
    let first = coordinator.prepare_thumbnail(purpose.clone()).unwrap();
    coordinator
        .submit_thumbnail(&first.ticket, &png_fixture(1, 1))
        .unwrap();
    let second = coordinator.prepare_thumbnail(purpose.clone()).unwrap();
    coordinator
        .report_thumbnail_failure(&second.ticket)
        .unwrap();

    assert_eq!(
        coordinator
            .claim_thumbnail(&first.ticket, &purpose)
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
    assert!(matches!(
        coordinator
            .claim_thumbnail(&second.ticket, &purpose)
            .unwrap(),
        CaptureTerminalResult::Unavailable
    ));
}

#[tokio::test(start_paused = true)]
async fn subscribers_receive_complete_health_and_activity_payloads() {
    let coordinator = coordinator();
    let health = Arc::new(Mutex::new(Vec::new()));
    let activity = Arc::new(Mutex::new(Vec::new()));
    let health_sink = Arc::clone(&health);
    let activity_sink = Arc::clone(&activity);
    coordinator.subscribe(
        move |value| health_sink.lock().unwrap().push(value),
        move |value| activity_sink.lock().unwrap().push(value),
    );

    let purpose = manual(1, 2);
    let request = coordinator.prepare_thumbnail(purpose).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();

    assert_eq!(
        health.lock().unwrap().as_slice(),
        &[PersistenceHealthView::Healthy]
    );
    assert!(matches!(
        activity.lock().unwrap().as_slice(),
        [
            ThumbnailActivityView::Idle,
            ThumbnailActivityView::Capturing,
            ThumbnailActivityView::Unavailable { .. }
        ]
    ));
}

// ---------------------------------------------------------------------------
// take_terminal_thumbnail purpose mismatch
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn take_terminal_thumbnail_rejects_mismatched_purpose() {
    let coordinator = coordinator();
    let purpose = manual(1, 1);
    let request = coordinator.prepare_thumbnail(purpose).unwrap();
    // Submit a thumbnail so terminal is set, then try to take with wrong purpose.
    coordinator
        .submit_thumbnail(&request.ticket, &png_fixture(1, 1))
        .unwrap();
    let wrong_purpose = ThumbnailCapturePurpose::Autosave {
        session_generation: 1,
        durable_revision: 1,
    };
    assert_eq!(
        coordinator
            .take_terminal_thumbnail(&request.ticket, &wrong_purpose)
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
}

// ---------------------------------------------------------------------------
// issue_thumbnail_for_retry
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn issue_thumbnail_for_retry_returns_none_when_no_failure() {
    let coordinator = coordinator();
    let result = coordinator.issue_thumbnail_for_retry(manual(1, 1), (1, 1));
    assert!(result.unwrap().is_none());
}

#[tokio::test(start_paused = true)]
async fn issue_thumbnail_for_retry_returns_none_when_failure_mismatched() {
    let coordinator = coordinator();
    {
        let mut state = coordinator.state.lock().unwrap();
        state.failed_write = Some(BackgroundWriteFailure {
            identity: (1, 5),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        });
    }
    let result = coordinator.issue_thumbnail_for_retry(manual(1, 1), (1, 3));
    assert!(result.unwrap().is_none());
}

#[tokio::test(start_paused = true)]
async fn issue_thumbnail_for_retry_retires_when_superseded_by_success() {
    let coordinator = coordinator();
    {
        let mut state = coordinator.state.lock().unwrap();
        state.failed_write = Some(BackgroundWriteFailure {
            identity: (1, 1),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        });
        state.last_successful_write = Some(crate::game::save::application::AutosaveWriteReceipt {
            session_generation: 1,
            durable_revision: 1,
            slot: crate::game::save::schema::SaveSlotRef::Auto { slot: 1 },
            save_id: "save-a".into(),
        });
    }
    let result = coordinator.issue_thumbnail_for_retry(manual(1, 1), (1, 1));
    assert!(result.unwrap().is_none());
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
}

#[tokio::test(start_paused = true)]
async fn issue_thumbnail_for_retry_proceeds_and_issues_ticket_when_failure_matches() {
    let coordinator = coordinator();
    {
        let mut state = coordinator.state.lock().unwrap();
        state.failed_write = Some(BackgroundWriteFailure {
            identity: (1, 1),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        });
    }
    let request = coordinator
        .issue_thumbnail_for_retry(manual(1, 1), (1, 1))
        .unwrap()
        .unwrap();
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Capturing
    );
    // The ticket should be tracked.
    assert!(coordinator.ticket_deadline(&request.ticket).is_ok());
}

#[tokio::test(start_paused = true)]
async fn issue_thumbnail_for_retry_rejects_stale_session_generation() {
    let coordinator = coordinator();
    coordinator.next_session_generation().unwrap();
    assert_eq!(
        coordinator
            .issue_thumbnail_for_retry(manual(0, 1), (0, 1))
            .unwrap_err()
            .code,
        "staleSessionGeneration"
    );
}

// ---------------------------------------------------------------------------
// issue_terminal_unavailable_thumbnail_for_retry
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn issue_terminal_unavailable_for_retry_returns_none_when_no_failure() {
    let coordinator = coordinator();
    let result = coordinator.issue_terminal_unavailable_thumbnail_for_retry(manual(1, 1), (1, 1));
    assert!(result.unwrap().is_none());
}

#[tokio::test(start_paused = true)]
async fn issue_terminal_unavailable_for_retry_retires_when_superseded_by_success() {
    let coordinator = coordinator();
    {
        let mut state = coordinator.state.lock().unwrap();
        state.failed_write = Some(BackgroundWriteFailure {
            identity: (1, 1),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: false,
        });
        state.last_successful_write = Some(crate::game::save::application::AutosaveWriteReceipt {
            session_generation: 1,
            durable_revision: 1,
            slot: crate::game::save::schema::SaveSlotRef::Auto { slot: 1 },
            save_id: "save-a".into(),
        });
    }
    let result = coordinator.issue_terminal_unavailable_thumbnail_for_retry(manual(1, 1), (1, 1));
    assert!(result.unwrap().is_none());
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
}

#[tokio::test(start_paused = true)]
async fn issue_terminal_unavailable_for_retry_proceeds_and_issues_terminal_ticket() {
    let coordinator = coordinator();
    {
        let mut state = coordinator.state.lock().unwrap();
        state.failed_write = Some(BackgroundWriteFailure {
            identity: (1, 1),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: false,
        });
    }
    let (ticket, _) = coordinator
        .issue_terminal_unavailable_thumbnail_for_retry(manual(1, 1), (1, 1))
        .unwrap()
        .unwrap();
    // The terminal ticket should already be unavailable.
    let result = coordinator.claim_thumbnail(&ticket, &manual(1, 1)).unwrap();
    assert!(matches!(result, CaptureTerminalResult::Unavailable));
}

#[tokio::test(start_paused = true)]
async fn issue_terminal_unavailable_for_retry_rejects_stale_session_generation() {
    let coordinator = coordinator();
    coordinator.next_session_generation().unwrap();
    assert_eq!(
        coordinator
            .issue_terminal_unavailable_thumbnail_for_retry(manual(0, 1), (0, 1))
            .unwrap_err()
            .code,
        "staleSessionGeneration"
    );
}

#[tokio::test(start_paused = true)]
async fn issue_terminal_unavailable_supersedes_nonterminal_autosave_and_clears_activity() {
    let coordinator = coordinator();
    // Issue a live (nonterminal) autosave ticket first.
    let autosave_purpose = ThumbnailCapturePurpose::Autosave {
        session_generation: 1,
        durable_revision: 1,
    };
    let autosave_request = coordinator
        .issue_thumbnail(autosave_purpose.clone())
        .unwrap();
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Capturing
    );
    // Now issue a terminal unavailable ticket for the same autosave intent.
    // This should supersede the nonterminal autosave and clear activity.
    {
        let mut state = coordinator.state.lock().unwrap();
        state.failed_write = Some(BackgroundWriteFailure {
            identity: (1, 1),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: false,
        });
    }
    let (terminal_ticket, _) = coordinator
        .issue_terminal_unavailable_thumbnail_for_retry(autosave_purpose.clone(), (1, 1))
        .unwrap()
        .unwrap();
    // The old autosave ticket should be gone.
    assert_eq!(
        coordinator
            .claim_thumbnail(&autosave_request.ticket, &autosave_purpose)
            .unwrap_err()
            .code,
        "staleThumbnailTicket"
    );
    // The new terminal ticket should be unavailable.
    assert!(matches!(
        coordinator
            .claim_thumbnail(&terminal_ticket, &autosave_purpose)
            .unwrap(),
        CaptureTerminalResult::Unavailable
    ));
    // Activity should be Idle since the nonterminal autosave was superseded
    // by a terminal ticket and no other live captures remain.
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}
