// src-tauri/src/game/scenes/linear.rs
use crate::game::schema::{DialogueItem, LinearSceneJson};

#[derive(Debug, Clone)]
pub struct LinearSceneState {
    pub id: String,
    pub title: String,
    pub queue: Vec<DialogueItem>,
    pub cursor: usize,
    pub queue_gen: u64,
}

impl LinearSceneState {
    pub fn from_json(j: LinearSceneJson, queue_gen: u64) -> Self {
        Self {
            id: j.id,
            title: j.title,
            queue: j.queue,
            cursor: 0,
            queue_gen,
        }
    }

    pub fn current(&self) -> Option<&DialogueItem> {
        self.queue.get(self.cursor)
    }

    pub fn queue_remaining(&self) -> usize {
        self.queue.len().saturating_sub(self.cursor + 1)
    }

    pub fn advance(&mut self) -> bool {
        self.cursor += 1;
        self.cursor >= self.queue.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str) -> DialogueItem {
        DialogueItem::Line { speaker: "A".into(), text: text.into() }
    }

    #[test]
    fn advance_walks_through_queue_and_signals_completion() {
        let mut s = LinearSceneState {
            id: "s".into(),
            title: "t".into(),
            queue: vec![line("a"), line("b")],
            cursor: 0,
            queue_gen: 1,
        };
        assert_eq!(s.current(), Some(&line("a")));
        assert!(!s.advance());
        assert_eq!(s.current(), Some(&line("b")));
        assert!(s.advance());
        assert_eq!(s.current(), None);
    }
}
