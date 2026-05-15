// Game engine module. Each submodule has a single responsibility; see the
// scene-pipeline spec §4a for the layout rationale.

pub mod error;
pub mod schema;
pub mod state;
pub mod unlock;
pub mod reveals;
pub mod scenes;
pub mod loader;
pub mod view;

pub use error::GameError;

/// Top-level engine orchestrator. Fully assembled in Task 12.
pub struct GameEngine {
    // fields added in later tasks
}
