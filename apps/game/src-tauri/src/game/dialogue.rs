// src-tauri/src/game/dialogue.rs
//
// Dialogue history and queue lifecycle.

use super::schema::DialogueItem;
use super::view::{DialogueHistoryEntry, QueueToken};

const DIALOGUE_HISTORY_LIMIT: usize = 50;

/// The engine's rolling dialogue log. Owns dedup-by-token, the entry cap, and
/// the rule that scene tags are not logged.
#[derive(Clone)]
pub(super) struct DialogueHistory {
    entries: Vec<DialogueHistoryEntry>,
    next_id: u64,
    last_token: Option<QueueToken>,
}

impl Default for DialogueHistory {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            next_id: 1,
            last_token: None,
        }
    }
}

impl DialogueHistory {
    pub(super) fn entries(&self) -> &[DialogueHistoryEntry] {
        &self.entries
    }

    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(super) fn is_last_token(&self, token: &QueueToken) -> bool {
        self.last_token.as_ref() == Some(token)
    }

    pub(super) fn record(
        &mut self,
        token: QueueToken,
        item: DialogueItem,
        chapter_title: String,
        scene_title: String,
    ) {
        if self.is_last_token(&token) {
            return;
        }
        let id = self.next_id;
        let entry = match item {
            DialogueItem::Line {
                speaker,
                text,
                portrait: _,
            } => DialogueHistoryEntry::Line {
                id,
                speaker,
                text,
                chapter_title,
                scene_title,
            },
            DialogueItem::Action { text } => DialogueHistoryEntry::Action {
                id,
                text,
                chapter_title,
                scene_title,
            },
            // Scene tags are not logged, and must not consume the token —
            // matching the pre-extraction early return.
            DialogueItem::SceneTag { .. } => return,
        };

        self.next_id += 1;
        self.last_token = Some(token);
        self.entries.push(entry);
        let overflow = self.entries.len().saturating_sub(DIALOGUE_HISTORY_LIMIT);
        if overflow > 0 {
            self.entries.drain(0..overflow);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::DialogueItem;
    use crate::game::view::{DialogueHistoryEntry, QueueToken};

    fn token(cursor: usize) -> QueueToken {
        QueueToken {
            scene_id: "s".into(),
            queue_gen: 1,
            cursor,
        }
    }

    fn line(text: &str) -> DialogueItem {
        DialogueItem::Line {
            speaker: "A".into(),
            text: text.into(),
            portrait: None,
        }
    }

    #[test]
    fn record_dedups_on_repeated_token() {
        let mut h = DialogueHistory::default();
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        assert_eq!(h.entries().len(), 1);
    }

    #[test]
    fn record_keeps_newest_fifty() {
        let mut h = DialogueHistory::default();
        for i in 0..55 {
            h.record(
                token(i),
                line(&format!("line {i}")),
                "ch".into(),
                "sc".into(),
            );
        }
        assert_eq!(h.entries().len(), 50);
        match &h.entries()[0] {
            DialogueHistoryEntry::Line { text, .. } => assert_eq!(text, "line 5"),
            other => panic!("expected line, got {other:?}"),
        }
    }

    #[test]
    fn record_ignores_scene_tags_without_consuming_the_token() {
        let mut h = DialogueHistory::default();
        h.record(
            token(0),
            DialogueItem::SceneTag {
                text: "tag".into(),
                asset_cue: None,
            },
            "ch".into(),
            "sc".into(),
        );
        assert!(h.entries().is_empty());
        // A SceneTag must not mark the token as recorded, or the real item at
        // that cursor would be deduped away.
        assert!(!h.is_last_token(&token(0)));
    }

    #[test]
    fn reset_clears_entries_and_restarts_ids() {
        let mut h = DialogueHistory::default();
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        h.reset();
        assert!(h.entries().is_empty());
        h.record(token(1), line("b"), "ch".into(), "sc".into());
        match &h.entries()[0] {
            DialogueHistoryEntry::Line { id, .. } => assert_eq!(*id, 1),
            other => panic!("expected line, got {other:?}"),
        }
    }
}
