// src-tauri/src/game/scenes/linear.rs
use crate::game::dialogue_queue::{ActiveDialogueQueue, DialogueSegment, DialogueSegmentOriginV1};
use crate::game::schema::LinearSceneJson;

#[derive(Debug, Clone)]
pub struct LinearSceneState {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub(crate) queue: Option<ActiveDialogueQueue>,
}

impl LinearSceneState {
    pub fn from_json(j: LinearSceneJson, chapter_id: &str, queue_gen: u64) -> Self {
        let id = j.id;
        let segment = DialogueSegment::new(
            DialogueSegmentOriginV1::LinearScene {
                chapter_id: chapter_id.into(),
                scene_id: id.clone(),
            },
            j.queue,
        );
        Self {
            id,
            title: j.title,
            summary: j.summary,
            queue: segment.and_then(|segment| ActiveDialogueQueue::new(vec![segment], queue_gen)),
        }
    }

    pub fn current(&self) -> Option<&crate::game::schema::DialogueItem> {
        self.queue.as_ref()?.current()
    }

    pub fn queue_remaining(&self) -> usize {
        self.queue
            .as_ref()
            .map(ActiveDialogueQueue::queue_remaining)
            .unwrap_or(0)
    }

    pub fn advance(&mut self) -> bool {
        self.queue.as_mut().is_none_or(ActiveDialogueQueue::advance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::DialogueItem;

    fn line(text: &str) -> DialogueItem {
        DialogueItem::Line {
            speaker: "A".into(),
            text: text.into(),
            portrait: None,
        }
    }

    #[test]
    fn advance_walks_through_queue_and_signals_completion() {
        let mut s = LinearSceneState::from_json(
            LinearSceneJson {
                id: "s".into(),
                title: "t".into(),
                summary: "summary".into(),
                asset_refs: vec![],
                queue: vec![line("a"), line("b")],
            },
            "chapter_1",
            1,
        );
        assert_eq!(s.current(), Some(&line("a")));
        assert!(!s.advance());
        assert_eq!(s.current(), Some(&line("b")));
        assert!(s.advance());
    }
}
