pub mod linear;
pub mod investigation;

use linear::LinearSceneState;
use investigation::InvestigationSceneState;

#[derive(Debug, Clone)]
pub enum SceneRuntime {
    Linear(LinearSceneState),
    Investigation(InvestigationSceneState),
}

impl SceneRuntime {
    pub fn id(&self) -> &str {
        match self {
            SceneRuntime::Linear(s) => &s.id,
            SceneRuntime::Investigation(s) => s.id(),
        }
    }
    pub fn title(&self) -> &str {
        match self {
            SceneRuntime::Linear(s) => &s.title,
            SceneRuntime::Investigation(s) => s.title(),
        }
    }
}
