//! Persistence command cores. Tauri request decoding and command adapters remain in `lib.rs`.

use crate::game::save::application::*;
use crate::game::save::capture::capture_checkpoint;
use crate::game::save::restore::{build_restore_candidate, RestoredGameCandidate};
use crate::game::save::schema::{
    validate_manual_display_name, SaveBrowserView, SaveDiscoveryStatusView, SaveSlotRef,
    SaveSlotStatusView,
};
use crate::game::save::storage::{
    commit_prepared_slot_write, delete_slot, prepare_slot_write, read_save_envelope,
    read_save_thumbnail as read_save_thumbnail_from_storage, select_continue_candidate,
    ManualSlotExpectation, OccupiedSlotExpectation, SlotWriteRequest, ThumbnailWrite,
};
use crate::game::GameError;
use crate::*;
use std::sync::Arc;

pub(crate) async fn start_game_with_persistence_core(
    state: &AppState,
) -> Result<GameplayCommandResultView, GameError> {
    let persistence = state.persistence.as_ref();
    let _ = persistence.discover();
    if let Some(error) = persistence.availability_error() {
        return Err(state.persistence.challenge_current_discovery_failure(
            state,
            PersistenceBypassOperation::StartWithoutSaving,
            error,
        )?);
    }
    let expected = state.persistence.transition_identity(state)?;
    if expected.durable_revision.is_some() {
        if let Err(error) = state
            .persistence
            .flush_session(state, FlushOperation::InGameLoad)
            .await
        {
            let error = challengeable_flush_failure(error)?;
            return Err(state.persistence.challenge_current_session_error(
                state,
                PersistenceBypassOperation::StartWithoutSaving,
                error,
            )?);
        }
    }
    let engine = GameEngine::new_started(state.resources_dir.clone())?;
    let state_view = session_persistence(state)?
        .install_session_if_current(engine, None, expected)
        .await?;
    Ok(GameplayCommandResultView {
        state: state_view,
        thumbnail_capture: None,
    })
}

pub(crate) async fn start_game_without_saving_core(
    state: &AppState,
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    let engine = GameEngine::new_started(state.resources_dir.clone())?;
    let expected = state
        .persistence
        .consume_current_start_without_saving_failure(state, &failure_token)?;
    let state_view = session_persistence(state)?
        .install_session_if_current(engine, None, expected)
        .await?;
    finish_persistence_mutation(state_view, MutationPersistencePolicy::PersistenceManaged)
}

#[cfg(feature = "e2e")]
pub(crate) fn e2e_set_persistence_fault_core(
    persistence: &ApplicationPersistence,
    boundary: E2ePersistenceFaultBoundary,
    occurrence_count: u8,
) -> Result<(), GameError> {
    persistence.arm_e2e_persistence_fault(boundary, occurrence_count)
}

#[cfg(feature = "e2e")]
pub(crate) async fn e2e_load_checkpoint_core(
    state: &AppState,
    id: CheckpointId,
) -> Result<E2eLoadCheckpointResult, GameError> {
    let checkpoint = build_checkpoint(state.resources_dir.clone(), id)?;
    let projection = checkpoint.projection;
    let replacement = session_persistence(state)?
        .replace_session_for_e2e(checkpoint.engine)
        .await?;
    Ok(E2eLoadCheckpointResult {
        generation: replacement.generation,
        state: replacement.state,
        projection,
    })
}

pub(crate) fn get_exit_status_core(state: &AppState) -> ExitStatusView {
    exit_status_snapshot(&state.persistence)
}

pub(crate) async fn cancel_persistence_failure_core(
    state: &AppState,
    failure_token: PersistenceFailureTokenView,
) -> Result<(), GameError> {
    state
        .persistence
        .cancel_persistence_failure(state, failure_token)
        .await
}

pub(crate) fn retry_exit_core(
    state: &AppState,
    exit: Arc<dyn ApplicationExit>,
    failure_token: PersistenceFailureTokenView,
) -> Result<ExitStatusView, GameError> {
    state.persistence.retry_exit(exit, failure_token)?;
    Ok(exit_status_snapshot(&state.persistence))
}

pub(crate) fn cancel_exit_core(
    state: &AppState,
    failure_token: PersistenceFailureTokenView,
) -> Result<ExitStatusView, GameError> {
    state.persistence.cancel_exit(failure_token)
}

pub(crate) fn exit_without_saving_core(
    state: &AppState,
    exit: Arc<dyn ApplicationExit>,
    failure_token: PersistenceFailureTokenView,
) -> Result<(), GameError> {
    state.persistence.exit_without_saving(exit, failure_token)
}

pub(crate) async fn list_saves_core(
    state: &AppState,
    discover: impl FnOnce() -> SaveBrowserView,
) -> Result<SaveBrowserOpenResultView, GameError> {
    list_saves_core_impl(state, discover, |_| Ok(()), |_, _| Ok(())).await
}

pub(crate) async fn list_saves_core_impl(
    state: &AppState,
    discover: impl FnOnce() -> SaveBrowserView,
    before_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
    after_flush_error: impl FnOnce(&AppState, &GameError) -> Result<(), GameError>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let has_active_session = {
        let session = state.session.lock().map_err(|_| unavailable_error())?;
        session.ensure_persistence_available()?;
        session.engine.is_some()
    };
    let flush_error = if has_active_session {
        before_flush(state)?;
        match state
            .persistence
            .flush_session(state, FlushOperation::InGameLoad)
            .await
        {
            Ok(_) => None,
            Err(error) => {
                let classified = challengeable_flush_failure(error);
                let original = match &classified {
                    Ok(error) | Err(error) => error,
                };
                after_flush_error(state, original)?;
                Some(classified?)
            }
        }
    } else {
        None
    };
    let browser = discover();
    let discovery_generation = state.persistence.complete_discovery_attempt()?;
    let continue_candidate = select_continue_candidate(&browser.slots);
    let preflight = match flush_error {
        Some(error) => {
            let (diagnostic, failure_token) = state.persistence.challenge_current_session_failure(
                state,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                Some(discovery_generation),
                error,
            )?;
            SaveBrowserPreflightView::FlushFailed {
                diagnostic,
                failure_token,
            }
        }
        None => SaveBrowserPreflightView::Ready,
    };
    Ok(SaveBrowserOpenResultView {
        browser,
        continue_candidate,
        preflight,
    })
}

#[cfg(test)]
pub(crate) async fn list_saves_core_with_flush_hooks(
    state: &AppState,
    discover: impl FnOnce() -> SaveBrowserView,
    before_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
    after_flush_error: impl FnOnce(&AppState, &GameError) -> Result<(), GameError>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    list_saves_core_impl(state, discover, before_flush, after_flush_error).await
}

pub(crate) fn read_save_thumbnail_core(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: &str,
) -> Result<Vec<u8>, GameError> {
    let persistence = state.persistence.as_ref();
    read_save_thumbnail_from_storage(
        persistence.fs.as_ref(),
        &persistence.root,
        reference,
        observed_save_id,
    )
}

pub(crate) async fn save_manual_core(
    state: &AppState,
    reference: SaveSlotRef,
    display_name: String,
    expectation: ManualSlotExpectation,
    prepared_thumbnail_ticket: String,
) -> Result<ManualSaveResultView, GameError> {
    state
        .persistence
        .flush_session(state, FlushOperation::ManualSave)
        .await?;
    let SaveSlotRef::Manual { .. } = reference else {
        return Err(GameError::save_slot_mismatch());
    };
    let display_name = validate_manual_display_name(&display_name)?;
    let persistence = Arc::clone(&state.persistence);
    let (session_generation, durable_revision, checkpoint) = {
        let session = state.session.lock().map_err(|_| unavailable_error())?;
        session.ensure_persistence_available()?;
        let engine = session
            .engine
            .as_ref()
            .ok_or_else(GameError::game_not_started)?;
        (
            session.persistence.generation,
            engine.durable_revision(),
            capture_checkpoint(engine)?,
        )
    };
    let purpose = ThumbnailCapturePurpose::ManualSave {
        session_generation,
        durable_revision,
    };
    let thumbnail = state
        .persistence
        .claim_thumbnail(&prepared_thumbnail_ticket, &purpose)?;
    let save_id = uuid::Uuid::new_v4().hyphenated().to_string();
    let envelope = persistence.envelope(
        checkpoint,
        persistence
            .discovery
            .definitions
            .content_revision()
            .to_owned(),
        reference,
        save_id.clone(),
        display_name,
    )?;
    let thumbnail = match thumbnail {
        game::save::application::CaptureTerminalResult::Available(candidate) => {
            ThumbnailWrite::Available(candidate.bind(&save_id)?)
        }
        game::save::application::CaptureTerminalResult::Unavailable => ThumbnailWrite::Unavailable,
    };
    let request = SlotWriteRequest {
        reference,
        envelope,
        thumbnail,
        expected_manual: Some(expectation),
    };
    state.persistence.publish_persistence_health_for_session(
        session_generation,
        PersistenceHealthView::Pending,
    )?;
    let outcome = match persistence
        .run_storage_write_if_session_current(session_generation, move |fs, root| {
            prepare_slot_write(fs, root, request)
                .and_then(|prepared| commit_prepared_slot_write(fs, root, prepared))
        })
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            let _ = state.persistence.publish_persistence_health_for_session(
                session_generation,
                PersistenceHealthView::Degraded {
                    diagnostic: error.clone(),
                },
            );
            return Err(error);
        }
    };
    publish_write_outcome_health(state, session_generation, &outcome.cleanup_diagnostic)?;
    let browser = persistence.discover();
    state
        .persistence
        .complete_discovery_attempt_for_session(session_generation)?;
    let saved_slot = browser
        .slots
        .iter()
        .find(|slot| slot.reference == reference)
        .cloned()
        .ok_or_else(GameError::save_discovery_unavailable)?;
    let rediscovered_save_id = match &saved_slot.status {
        SaveSlotStatusView::Valid { metadata } => &metadata.save_id,
        _ => return Err(GameError::save_write_failed()),
    };
    if rediscovered_save_id != &save_id {
        return Err(GameError::save_write_failed());
    }
    Ok(ManualSaveResultView {
        saved_slot,
        browser,
        thumbnail_activity: state.persistence.thumbnail_activity(),
    })
}

pub(crate) fn build_selected_candidate(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: &str,
) -> Result<RestoredGameCandidate, GameError> {
    let persistence = state.persistence.as_ref();
    let envelope = read_save_envelope(
        persistence.fs.as_ref(),
        &persistence.root,
        reference,
        observed_save_id,
    )?;
    let candidate = build_restore_candidate(
        persistence.discovery.resources_dir.clone(),
        &persistence.discovery.definitions,
        envelope,
    )?;
    if candidate.source != reference || candidate.save_id != observed_save_id {
        return Err(GameError::stale_save_selection());
    }
    Ok(candidate)
}

pub(crate) fn fresh_ready_browser(
    state: &AppState,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let browser = state.persistence.discover();
    state.persistence.complete_discovery_attempt()?;
    Ok(SaveBrowserOpenResultView {
        continue_candidate: select_continue_candidate(&browser.slots),
        browser,
        preflight: SaveBrowserPreflightView::Ready,
    })
}

pub(crate) async fn load_save_core(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: String,
) -> Result<GameplayCommandResultView, GameError> {
    load_save_core_impl(state, reference, observed_save_id, |_| Ok(())).await
}

pub(crate) async fn load_save_core_impl(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: String,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    let expected = state.persistence.transition_identity(state)?;
    let has_active_session = expected.durable_revision.is_some();
    if has_active_session {
        if let Err(error) = state
            .persistence
            .flush_session(state, FlushOperation::InGameLoad)
            .await
        {
            let error = challengeable_flush_failure(error)?;
            return Err(state.persistence.challenge_current_selected_save_failure(
                state,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                reference,
                &observed_save_id,
                error,
            )?);
        }
    }
    after_flush(state)?;
    let candidate = build_selected_candidate(state, reference, &observed_save_id)?;
    let state_view = session_persistence(state)?
        .install_session_if_current(candidate.engine, Some(candidate.source), expected)
        .await?;
    finish_persistence_mutation(state_view, MutationPersistencePolicy::PersistenceManaged)
}

#[cfg(test)]
pub(crate) async fn load_save_core_with_post_flush_hook(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: String,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    load_save_core_impl(state, reference, observed_save_id, after_flush).await
}

pub(crate) async fn load_save_discarding_current_core(
    state: &AppState,
    reference: SaveSlotRef,
    observed_save_id: String,
    failure_token: PersistenceFailureTokenView,
) -> Result<GameplayCommandResultView, GameError> {
    let expected = state.persistence.consume_current_selected_save_failure(
        state,
        &failure_token,
        PersistenceBypassOperation::LoadDiscardingCurrent,
        reference,
        &observed_save_id,
    )?;
    let candidate = build_selected_candidate(state, reference, &observed_save_id)?;
    let state_view = session_persistence(state)?
        .install_session_if_current(candidate.engine, Some(candidate.source), expected)
        .await?;
    finish_persistence_mutation(state_view, MutationPersistencePolicy::PersistenceManaged)
}

pub(crate) async fn continue_game_core(
    state: &AppState,
) -> Result<GameplayCommandResultView, GameError> {
    continue_game_core_impl(state, |_| Ok(())).await
}

pub(crate) async fn continue_game_core_impl(
    state: &AppState,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    let expected = state.persistence.transition_identity(state)?;
    let has_active_session = expected.durable_revision.is_some();
    if has_active_session {
        if let Err(error) = state
            .persistence
            .flush_session(state, FlushOperation::InGameLoad)
            .await
        {
            let error = challengeable_flush_failure(error)?;
            return Err(state.persistence.challenge_current_discovery_failure(
                state,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                error,
            )?);
        }
    }
    after_flush(state)?;
    let persistence = state.persistence.as_ref();
    let browser = persistence.discover();
    state.persistence.complete_discovery_attempt()?;
    if let SaveDiscoveryStatusView::Unavailable { diagnostic } = browser.discovery {
        return Err(diagnostic);
    }
    let reference =
        select_continue_candidate(&browser.slots).ok_or_else(GameError::stale_save_selection)?;
    let selected = browser
        .slots
        .iter()
        .find(|slot| slot.reference == reference)
        .ok_or_else(GameError::stale_save_selection)?;
    let observed_save_id = match &selected.status {
        SaveSlotStatusView::Valid { metadata } => metadata.save_id.clone(),
        SaveSlotStatusView::Invalid { diagnostic, .. } => return Err(diagnostic.clone()),
        SaveSlotStatusView::Empty => return Err(GameError::stale_save_selection()),
    };
    let candidate = build_selected_candidate(state, reference, &observed_save_id)?;
    let state_view = session_persistence(state)?
        .install_session_if_current(candidate.engine, Some(candidate.source), expected)
        .await?;
    finish_persistence_mutation(state_view, MutationPersistencePolicy::PersistenceManaged)
}

#[cfg(test)]
pub(crate) async fn continue_game_core_with_post_flush_hook(
    state: &AppState,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<GameplayCommandResultView, GameError> {
    continue_game_core_impl(state, after_flush).await
}

pub(crate) async fn delete_save_core(
    state: &AppState,
    reference: SaveSlotRef,
    expectation: OccupiedSlotExpectation,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let session_generation = {
        let session = state.session.lock().map_err(|_| unavailable_error())?;
        session.ensure_persistence_available()?;
        session.persistence.generation
    };
    let persistence = Arc::clone(&state.persistence);
    state.persistence.publish_persistence_health_for_session(
        session_generation,
        PersistenceHealthView::Pending,
    )?;
    let outcome = match persistence
        .run_storage_write_if_session_current(session_generation, move |fs, root| {
            delete_slot(fs, root, reference, expectation)
        })
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            let _ = state.persistence.publish_persistence_health_for_session(
                session_generation,
                PersistenceHealthView::Degraded {
                    diagnostic: error.clone(),
                },
            );
            return Err(error);
        }
    };
    publish_write_outcome_health(state, session_generation, &outcome.cleanup_diagnostic)?;
    let browser = persistence.discover();
    state
        .persistence
        .complete_discovery_attempt_for_session(session_generation)?;
    Ok(SaveBrowserOpenResultView {
        continue_candidate: select_continue_candidate(&browser.slots),
        browser,
        preflight: SaveBrowserPreflightView::Ready,
    })
}

pub(crate) async fn return_to_title_core(
    state: &AppState,
) -> Result<SaveBrowserOpenResultView, GameError> {
    return_to_title_core_impl(state, |_| Ok(())).await
}

pub(crate) async fn return_to_title_core_impl(
    state: &AppState,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let expected = state.persistence.transition_identity(state)?;
    if let Err(error) = state
        .persistence
        .flush_session(state, FlushOperation::ReturnToTitle)
        .await
    {
        let error = challengeable_flush_failure(error)?;
        return Err(state.persistence.challenge_current_session_error(
            state,
            PersistenceBypassOperation::ReturnWithoutSaving,
            error,
        )?);
    }
    after_flush(state)?;
    session_persistence(state)?
        .clear_session_if_current(expected)
        .await?;
    fresh_ready_browser(state)
}

#[cfg(test)]
pub(crate) async fn return_to_title_core_with_post_flush_hook(
    state: &AppState,
    after_flush: impl FnOnce(&AppState) -> Result<(), GameError>,
) -> Result<SaveBrowserOpenResultView, GameError> {
    return_to_title_core_impl(state, after_flush).await
}

pub(crate) async fn return_to_title_without_saving_core(
    state: &AppState,
    failure_token: PersistenceFailureTokenView,
) -> Result<SaveBrowserOpenResultView, GameError> {
    let expected = state.persistence.consume_current_session_failure(
        state,
        &failure_token,
        PersistenceBypassOperation::ReturnWithoutSaving,
    )?;
    session_persistence(state)?
        .clear_session_if_current(expected)
        .await?;
    fresh_ready_browser(state)
}

pub(crate) fn challengeable_flush_failure(error: GameError) -> Result<GameError, GameError> {
    if error.is_persistence_operation_in_progress() {
        Err(error)
    } else {
        Ok(error)
    }
}

pub(crate) fn finish_persistence_mutation(
    state: GameStateView,
    policy: MutationPersistencePolicy,
) -> Result<GameplayCommandResultView, GameError> {
    match policy {
        MutationPersistencePolicy::PersistenceManaged => Ok(GameplayCommandResultView {
            state,
            thumbnail_capture: None,
        }),
        MutationPersistencePolicy::AutosaveIfAdvanced
        | MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail => {
            Err(GameError::unavailable())
        }
    }
}
