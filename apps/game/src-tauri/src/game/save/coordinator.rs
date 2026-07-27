use super::schema::{SaveDiagnosticView, ThumbnailDiagnosticView, ThumbnailUnavailableReason};
use super::thumbnail::ValidatedThumbnailCandidate;
use crate::game::GameError;
use serde::{Deserialize, Serialize, Serializer};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;
use tokio::time::Instant;
use uuid::Uuid;

pub(crate) const AUTOSAVE_DEBOUNCE: Duration = Duration::from_millis(500);
pub(crate) const THUMBNAIL_CAPTURE_TIMEOUT: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum ThumbnailCapturePurpose {
    Autosave {
        session_generation: u64,
        durable_revision: u64,
    },
    ManualSave {
        session_generation: u64,
        durable_revision: u64,
    },
    AcquisitionAcknowledgement {
        session_generation: u64,
        source_revision: u64,
        next_revision: u64,
        event_id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum PreparedThumbnailPurpose {
    ManualSave,
    AcquisitionAcknowledgement { event_id: String },
}

#[derive(Debug, Clone)]
pub(crate) struct ThumbnailCaptureRequestView {
    pub(crate) ticket: String,
    deadline_at: Instant,
}

impl ThumbnailCaptureRequestView {
    pub(crate) fn timeout_ms(&self) -> u32 {
        remaining_timeout_ms(self.deadline_at, Instant::now())
    }
}

impl Serialize for ThumbnailCaptureRequestView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct WireView<'a> {
            ticket: &'a str,
            timeout_ms: u32,
        }

        WireView {
            ticket: &self.ticket,
            timeout_ms: self.timeout_ms(),
        }
        .serialize(serializer)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum PersistenceHealthView {
    Healthy,
    Pending,
    Degraded { diagnostic: SaveDiagnosticView },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ThumbnailActivityView {
    Idle,
    Capturing,
    Unavailable { diagnostic: ThumbnailDiagnosticView },
}

#[derive(Debug)]
pub(crate) enum CaptureTerminalResult {
    Available(ValidatedThumbnailCandidate),
    Unavailable,
}

type HealthSubscriber = Arc<dyn Fn(PersistenceHealthView) + Send + Sync>;
type ActivitySubscriber = Arc<dyn Fn(ThumbnailActivityView) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum CaptureIntent {
    Autosave,
    ManualSave,
    AcquisitionAcknowledgement,
}

impl ThumbnailCapturePurpose {
    fn intent(&self) -> CaptureIntent {
        match self {
            Self::Autosave { .. } => CaptureIntent::Autosave,
            Self::ManualSave { .. } => CaptureIntent::ManualSave,
            Self::AcquisitionAcknowledgement { .. } => CaptureIntent::AcquisitionAcknowledgement,
        }
    }
}

struct TicketRecord {
    purpose: ThumbnailCapturePurpose,
    issued_at: Instant,
    deadline_at: Instant,
    terminal: Option<CaptureTerminalResult>,
}

struct CoordinatorState {
    tickets: HashMap<String, TicketRecord>,
    latest_by_intent: HashMap<CaptureIntent, String>,
    persistence_health: PersistenceHealthView,
    thumbnail_activity: ThumbnailActivityView,
    health_subscribers: Vec<HealthSubscriber>,
    activity_subscribers: Vec<ActivitySubscriber>,
}

impl Default for CoordinatorState {
    fn default() -> Self {
        Self {
            tickets: HashMap::new(),
            latest_by_intent: HashMap::new(),
            persistence_health: PersistenceHealthView::Healthy,
            thumbnail_activity: ThumbnailActivityView::Idle,
            health_subscribers: Vec::new(),
            activity_subscribers: Vec::new(),
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct SaveCoordinator {
    state: Arc<Mutex<CoordinatorState>>,
}

impl SaveCoordinator {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn notify_durable_commit(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Option<ThumbnailCaptureRequestView> {
        match self.issue_thumbnail(ThumbnailCapturePurpose::Autosave {
            session_generation,
            durable_revision,
        }) {
            Ok(request) => Some(request),
            Err(error) => {
                self.publish_persistence_health(PersistenceHealthView::Degraded {
                    diagnostic: error,
                });
                None
            }
        }
    }

    pub(crate) fn prepare_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        self.issue_thumbnail(purpose)
    }

    pub(crate) fn submit_thumbnail(
        &self,
        ticket: &str,
        png: &[u8],
    ) -> Result<ThumbnailActivityView, GameError> {
        let now = Instant::now();
        let candidate = ValidatedThumbnailCandidate::from_png(png.to_vec());
        let mut state = self.lock_state()?;
        let record = live_record_mut(&mut state, ticket, now)?;
        let (result, activity) = match candidate {
            Ok(candidate) => (
                Ok(()),
                (
                    CaptureTerminalResult::Available(candidate),
                    ThumbnailActivityView::Idle,
                ),
            ),
            Err(error) => (
                Err(error),
                (
                    CaptureTerminalResult::Unavailable,
                    capture_unavailable_activity(),
                ),
            ),
        };
        record.terminal = Some(activity.0);
        let view = activity.1;
        let subscribers = set_thumbnail_activity(&mut state, view.clone());
        drop(state);
        publish_activity(&subscribers, &view);
        result.map(|()| view)
    }

    pub(crate) fn report_thumbnail_failure(
        &self,
        ticket: &str,
    ) -> Result<ThumbnailActivityView, GameError> {
        let now = Instant::now();
        let mut state = self.lock_state()?;
        let record = live_record_mut(&mut state, ticket, now)?;
        record.terminal = Some(CaptureTerminalResult::Unavailable);
        let view = capture_unavailable_activity();
        let subscribers = set_thumbnail_activity(&mut state, view.clone());
        drop(state);
        publish_activity(&subscribers, &view);
        Ok(view)
    }

    pub(crate) fn claim_thumbnail(
        &self,
        ticket: &str,
        expected: &ThumbnailCapturePurpose,
    ) -> Result<CaptureTerminalResult, GameError> {
        let now = Instant::now();
        let mut state = self.lock_state()?;
        let expired = {
            let record = state
                .tickets
                .get_mut(ticket)
                .ok_or_else(GameError::stale_thumbnail_ticket)?;
            if &record.purpose != expected {
                return Err(GameError::stale_thumbnail_ticket());
            }
            if record.terminal.is_none() && now >= record.deadline_at {
                record.terminal = Some(CaptureTerminalResult::Unavailable);
                true
            } else {
                false
            }
        };
        let (subscribers, expired_view) = if expired {
            let view = capture_unavailable_activity();
            (set_thumbnail_activity(&mut state, view.clone()), Some(view))
        } else {
            (Vec::new(), None)
        };
        let mut record = state
            .tickets
            .remove(ticket)
            .ok_or_else(GameError::stale_thumbnail_ticket)?;
        state.latest_by_intent.remove(&record.purpose.intent());
        let result = record
            .terminal
            .take()
            .ok_or_else(GameError::stale_thumbnail_ticket);
        drop(state);
        if let Some(view) = expired_view {
            publish_activity(&subscribers, &view);
        }
        result
    }

    pub(crate) fn persistence_health(&self) -> PersistenceHealthView {
        self.state
            .lock()
            .map(|state| state.persistence_health.clone())
            .unwrap_or_else(|_| PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            })
    }

    pub(crate) fn thumbnail_activity(&self) -> ThumbnailActivityView {
        self.state
            .lock()
            .map(|state| state.thumbnail_activity.clone())
            .unwrap_or_else(|_| capture_unavailable_activity())
    }

    pub(crate) fn subscribe(
        &self,
        health: impl Fn(PersistenceHealthView) + Send + Sync + 'static,
        activity: impl Fn(ThumbnailActivityView) + Send + Sync + 'static,
    ) {
        let health: HealthSubscriber = Arc::new(health);
        let activity: ActivitySubscriber = Arc::new(activity);
        let Ok(mut state) = self.state.lock() else {
            health(PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            });
            activity(capture_unavailable_activity());
            return;
        };
        let current_health = state.persistence_health.clone();
        let current_activity = state.thumbnail_activity.clone();
        state.health_subscribers.push(Arc::clone(&health));
        state.activity_subscribers.push(Arc::clone(&activity));
        drop(state);
        health(current_health);
        activity(current_activity);
    }

    pub(crate) fn publish_persistence_health(&self, view: PersistenceHealthView) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.persistence_health = view.clone();
        let subscribers = state.health_subscribers.clone();
        drop(state);
        for subscriber in subscribers {
            subscriber(view.clone());
        }
    }

    fn issue_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        let runtime =
            tokio::runtime::Handle::try_current().map_err(|_| GameError::save_write_failed())?;
        let issued_at = Instant::now();
        let deadline_at = issued_at + THUMBNAIL_CAPTURE_TIMEOUT;
        let ticket = Uuid::new_v4().hyphenated().to_string();
        let intent = purpose.intent();
        let mut state = self.lock_state()?;
        if let Some(superseded) = state.latest_by_intent.insert(intent, ticket.clone()) {
            state.tickets.remove(&superseded);
        }
        state.tickets.insert(
            ticket.clone(),
            TicketRecord {
                purpose,
                issued_at,
                deadline_at,
                terminal: None,
            },
        );
        let view = ThumbnailActivityView::Capturing;
        let subscribers = set_thumbnail_activity(&mut state, view.clone());
        drop(state);
        publish_activity(&subscribers, &view);
        spawn_ticket_expiry(
            &runtime,
            Arc::downgrade(&self.state),
            ticket.clone(),
            deadline_at,
        );
        Ok(ThumbnailCaptureRequestView {
            ticket,
            deadline_at,
        })
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, CoordinatorState>, GameError> {
        self.state
            .lock()
            .map_err(|_| GameError::save_write_failed())
    }

    #[cfg(test)]
    fn ticket_only() -> Self {
        Self::new()
    }

    #[cfg(test)]
    fn ticket_deadline(&self, ticket: &str) -> Result<Instant, GameError> {
        self.lock_state()?
            .tickets
            .get(ticket)
            .map(|record| record.deadline_at)
            .ok_or_else(GameError::stale_thumbnail_ticket)
    }

    #[cfg(test)]
    fn ticket_issued_at(&self, ticket: &str) -> Result<Instant, GameError> {
        self.lock_state()?
            .tickets
            .get(ticket)
            .map(|record| record.issued_at)
            .ok_or_else(GameError::stale_thumbnail_ticket)
    }
}

fn remaining_timeout_ms(deadline_at: Instant, now: Instant) -> u32 {
    deadline_at
        .checked_duration_since(now)
        .unwrap_or(Duration::ZERO)
        .as_millis()
        .min(u128::from(u32::MAX)) as u32
}

fn live_record_mut<'a>(
    state: &'a mut CoordinatorState,
    ticket: &str,
    now: Instant,
) -> Result<&'a mut TicketRecord, GameError> {
    let record = state
        .tickets
        .get_mut(ticket)
        .ok_or_else(GameError::stale_thumbnail_ticket)?;
    if record.terminal.is_some() || now >= record.deadline_at {
        return Err(GameError::stale_thumbnail_ticket());
    }
    Ok(record)
}

fn capture_unavailable_activity() -> ThumbnailActivityView {
    ThumbnailActivityView::Unavailable {
        diagnostic: ThumbnailDiagnosticView {
            reason: ThumbnailUnavailableReason::CaptureUnavailable,
            message: "Thumbnail capture is unavailable.".into(),
            retryable: false,
        },
    }
}

fn set_thumbnail_activity(
    state: &mut CoordinatorState,
    view: ThumbnailActivityView,
) -> Vec<ActivitySubscriber> {
    state.thumbnail_activity = view;
    state.activity_subscribers.clone()
}

fn publish_activity(subscribers: &[ActivitySubscriber], view: &ThumbnailActivityView) {
    for subscriber in subscribers {
        subscriber(view.clone());
    }
}

fn spawn_ticket_expiry(
    runtime: &tokio::runtime::Handle,
    state: Weak<Mutex<CoordinatorState>>,
    ticket: String,
    deadline_at: Instant,
) {
    runtime.spawn(async move {
        tokio::time::sleep_until(deadline_at).await;
        let Some(state) = state.upgrade() else {
            return;
        };
        let Ok(mut state) = state.lock() else {
            return;
        };
        let Some(record) = state.tickets.get_mut(&ticket) else {
            return;
        };
        if record.terminal.is_some() {
            return;
        }
        record.terminal = Some(CaptureTerminalResult::Unavailable);
        let view = capture_unavailable_activity();
        let subscribers = set_thumbnail_activity(&mut state, view.clone());
        drop(state);
        publish_activity(&subscribers, &view);
    });
}

#[cfg(test)]
mod tests {
    mod ticket {
        use super::super::{
            CaptureTerminalResult, PersistenceHealthView, SaveCoordinator, ThumbnailActivityView,
            ThumbnailCapturePurpose, THUMBNAIL_CAPTURE_TIMEOUT,
        };
        use crate::game::save::schema::{
            canonical_uuid_v4, ThumbnailUnavailableReason, MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_WIDTH,
        };
        use std::sync::{Arc, Mutex};
        use std::time::Duration;

        fn coordinator() -> SaveCoordinator {
            SaveCoordinator::ticket_only()
        }

        fn manual(generation: u64, revision: u64) -> ThumbnailCapturePurpose {
            ThumbnailCapturePurpose::ManualSave {
                session_generation: generation,
                durable_revision: revision,
            }
        }

        fn acknowledgement(
            generation: u64,
            source_revision: u64,
            next_revision: u64,
            event_id: &str,
        ) -> ThumbnailCapturePurpose {
            ThumbnailCapturePurpose::AcquisitionAcknowledgement {
                session_generation: generation,
                source_revision,
                next_revision,
                event_id: event_id.into(),
            }
        }

        fn png(width: u32, height: u32) -> Vec<u8> {
            let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
            bytes.extend_from_slice(&width.to_be_bytes());
            bytes.extend_from_slice(&height.to_be_bytes());
            bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
            bytes.extend_from_slice(&[0, 0, 0, 0]);
            bytes
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
            assert_eq!(request.timeout_ms(), 1_000);
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
            assert_eq!(request.timeout_ms(), 625);
            tokio::time::advance(Duration::from_millis(625)).await;
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
                coordinator.submit_thumbnail(&request.ticket, &png(320, 180)),
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
                    .submit_thumbnail(&request.ticket, &png(320, 180))
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
        async fn expiry_is_terminal_unavailable_at_exactly_one_second() {
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
                    .submit_thumbnail(&request.ticket, &png(1, 1))
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
                    .submit_thumbnail(&older.ticket, &png(1, 1))
                    .unwrap_err()
                    .code,
                "staleThumbnailTicket"
            );
        }

        #[tokio::test(start_paused = true)]
        async fn claim_rejects_changed_generation_revision_purpose_and_event() {
            let coordinator = coordinator();
            let original = acknowledgement(8, 40, 41, "acq:40:0");
            let request = coordinator.prepare_thumbnail(original.clone()).unwrap();
            coordinator
                .submit_thumbnail(&request.ticket, &png(1, 1))
                .unwrap();

            for changed in [
                acknowledgement(9, 40, 41, "acq:40:0"),
                acknowledgement(8, 39, 41, "acq:40:0"),
                acknowledgement(8, 40, 42, "acq:40:0"),
                acknowledgement(8, 40, 41, "acq:40:1"),
                manual(8, 40),
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
            let bytes = png(MAX_THUMBNAIL_WIDTH, 1);

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
                    png(MAX_THUMBNAIL_WIDTH + 1, 1),
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
                .submit_thumbnail(&first.ticket, &png(1, 1))
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
    }
}
