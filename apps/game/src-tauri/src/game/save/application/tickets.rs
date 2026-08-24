//! Thumbnail ticket and activity lifecycle for the application persistence owner.

use super::*;

impl ApplicationPersistence {
    pub(crate) fn ticket_updates(&self) -> Arc<Notify> {
        Arc::clone(&self.ticket_updates)
    }

    pub(crate) fn prepare_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        self.issue_thumbnail(purpose)
    }

    pub(crate) fn prepare_application_thumbnail(
        &self,
        app: &crate::AppState,
        purpose: PreparedThumbnailPurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        let purpose = {
            let session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
            let engine = session
                .engine
                .as_ref()
                .ok_or_else(GameError::game_not_started)?;
            let session_generation = session.persistence.generation;
            let durable_revision = engine.durable_revision();
            match purpose {
                PreparedThumbnailPurpose::ManualSave => ThumbnailCapturePurpose::ManualSave {
                    session_generation,
                    durable_revision,
                },
            }
        };
        self.prepare_thumbnail(purpose)
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
        self.ticket_updates.notify_waiters();
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
        self.ticket_updates.notify_waiters();
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

    pub(crate) fn publish_persistence_health_for_session(
        &self,
        session_generation: u64,
        view: PersistenceHealthView,
    ) -> Result<(), GameError> {
        let mut state = self.lock_state()?;
        // `next_session_generation` is the replacement high-water mark: a
        // session whose generation is strictly older was replaced. Equality
        // is the normal case (production installs advance the mark to match
        // the session); a newer generation never occurs in production, so `<`
        // identifies exactly the stale case. This mirrors the `<` guard in
        // `record_schedule_failure` and lets the autosave scheduling path
        // route its Pending publication here without rejecting sessions whose
        // generation the test fixtures install ahead of the mark.
        if session_generation < state.next_session_generation {
            return Err(GameError::stale_session_generation());
        }
        let subscribers = set_persistence_health(&mut state, view.clone());
        drop(state);
        publish_health(&subscribers, &view);
        Ok(())
    }

    pub(crate) fn take_terminal_thumbnail(
        &self,
        ticket: &str,
        expected: &ThumbnailCapturePurpose,
    ) -> Result<Option<CaptureTerminalResult>, GameError> {
        let mut state = self.lock_state()?;
        let record = state
            .tickets
            .get(ticket)
            .ok_or_else(GameError::stale_thumbnail_ticket)?;
        if &record.purpose != expected {
            return Err(GameError::stale_thumbnail_ticket());
        }
        if record.terminal.is_none() {
            return Ok(None);
        }
        let mut record = state
            .tickets
            .remove(ticket)
            .ok_or_else(GameError::stale_thumbnail_ticket)?;
        state.latest_by_intent.remove(&record.purpose.intent());
        Ok(record.terminal.take())
    }

    pub(super) fn issue_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        self.issue_thumbnail_inner(purpose, None)?
            .ok_or_else(GameError::save_write_failed)
    }

    pub(super) fn issue_thumbnail_for_retry(
        &self,
        purpose: ThumbnailCapturePurpose,
        failure_identity: (u64, u64),
    ) -> Result<Option<ThumbnailCaptureRequestView>, GameError> {
        self.issue_thumbnail_inner(purpose, Some(failure_identity))
    }

    fn issue_thumbnail_inner(
        &self,
        purpose: ThumbnailCapturePurpose,
        retry_identity: Option<(u64, u64)>,
    ) -> Result<Option<ThumbnailCaptureRequestView>, GameError> {
        let issued_at = Instant::now();
        let deadline_at = issued_at + THUMBNAIL_CAPTURE_TIMEOUT;
        let ticket = Uuid::new_v4().hyphenated().to_string();
        let intent = purpose.intent();
        let mut state = self.lock_state()?;
        // Reject a stale-generation capture atomically, before any persistence owner
        // state is mutated. `next_session_generation` is the replacement
        // high-water mark; a capture for a prior generation must not insert a
        // ticket, supersede `latest_by_intent`, or publish `Capturing`, because
        // the late autosave scheduling / `record_schedule_failure` fences would
        // otherwise leave that stale ticket installed (and, for the autosave
        // intent, evict a live replacement-session ticket). `<` (not `!=`)
        // matches the high-water-mark semantic used by autosave scheduling and
        // `record_schedule_failure`, so a current-or-ahead generation still
        // issues normally.
        if purpose.session_generation() < state.next_session_generation {
            return Err(GameError::stale_session_generation());
        }
        if let Some(identity) = retry_identity {
            match retry_eligibility(&mut state, identity) {
                RetryEligibility::Proceed => {}
                RetryEligibility::Ignore => return Ok(None),
                RetryEligibility::Retire {
                    health,
                    subscribers,
                } => {
                    drop(state);
                    publish_health(&subscribers, &health);
                    return Ok(None);
                }
            }
        }
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
        let expiry_state = Arc::downgrade(&self.state);
        let expiry_updates = Arc::downgrade(&self.ticket_updates);
        let expiry_ticket = ticket.clone();
        #[cfg(test)]
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(thumbnail_ticket_expiry_task(
                expiry_state,
                expiry_ticket,
                deadline_at,
                expiry_updates,
            ));
        }
        #[cfg(not(test))]
        tauri::async_runtime::spawn(async move {
            thumbnail_ticket_expiry_task(expiry_state, expiry_ticket, deadline_at, expiry_updates)
                .await;
        });
        Ok(Some(ThumbnailCaptureRequestView {
            ticket,
            deadline_at,
        }))
    }

    pub(super) fn issue_terminal_unavailable_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<(String, Instant), GameError> {
        self.issue_terminal_unavailable_thumbnail_inner(purpose, None)?
            .ok_or_else(GameError::save_write_failed)
    }

    pub(super) fn issue_terminal_unavailable_thumbnail_for_retry(
        &self,
        purpose: ThumbnailCapturePurpose,
        failure_identity: (u64, u64),
    ) -> Result<Option<(String, Instant)>, GameError> {
        self.issue_terminal_unavailable_thumbnail_inner(purpose, Some(failure_identity))
    }

    fn issue_terminal_unavailable_thumbnail_inner(
        &self,
        purpose: ThumbnailCapturePurpose,
        retry_identity: Option<(u64, u64)>,
    ) -> Result<Option<(String, Instant)>, GameError> {
        let issued_at = Instant::now();
        let ticket = Uuid::new_v4().hyphenated().to_string();
        let intent = purpose.intent();
        let (activity_subscribers, activity) = {
            let mut state = self.lock_state()?;
            if purpose.session_generation() < state.next_session_generation {
                return Err(GameError::stale_session_generation());
            }
            if let Some(identity) = retry_identity {
                match retry_eligibility(&mut state, identity) {
                    RetryEligibility::Proceed => {}
                    RetryEligibility::Ignore => return Ok(None),
                    RetryEligibility::Retire {
                        health,
                        subscribers,
                    } => {
                        drop(state);
                        publish_health(&subscribers, &health);
                        return Ok(None);
                    }
                }
            }
            let removed_nonterminal_autosave = state
                .latest_by_intent
                .insert(intent, ticket.clone())
                .and_then(|superseded| state.tickets.remove(&superseded))
                .is_some_and(|record| {
                    record.purpose.intent() == CaptureIntent::Autosave && record.terminal.is_none()
                });
            state.tickets.insert(
                ticket.clone(),
                TicketRecord {
                    purpose,
                    issued_at,
                    deadline_at: issued_at,
                    terminal: Some(CaptureTerminalResult::Unavailable),
                },
            );
            if removed_nonterminal_autosave {
                clear_thumbnail_activity_if_no_live_capture(&mut state)
            } else {
                (Vec::new(), None)
            }
        };
        if let Some(activity) = activity {
            publish_activity(&activity_subscribers, &activity);
        }
        self.ticket_updates.notify_waiters();
        Ok(Some((ticket, issued_at)))
    }
}
