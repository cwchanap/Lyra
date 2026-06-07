pub mod interrogation;
pub mod investigation;
pub mod linear;

use interrogation::InterrogationSceneState;
use investigation::InvestigationSceneState;
use linear::LinearSceneState;

#[derive(Debug, Clone)]
pub enum SceneRuntime {
    Linear(LinearSceneState),
    Investigation(Box<InvestigationSceneState>),
    Interrogation(Box<InterrogationSceneState>),
}

impl SceneRuntime {
    pub fn id(&self) -> &str {
        match self {
            SceneRuntime::Linear(s) => &s.id,
            SceneRuntime::Investigation(s) => s.id(),
            SceneRuntime::Interrogation(s) => s.id(),
        }
    }
    pub fn title(&self) -> &str {
        match self {
            SceneRuntime::Linear(s) => &s.title,
            SceneRuntime::Investigation(s) => s.title(),
            SceneRuntime::Interrogation(s) => s.title(),
        }
    }
}
