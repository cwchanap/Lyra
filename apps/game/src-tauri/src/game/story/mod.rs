mod catalog;
mod mutations;
mod state;

pub(in crate::game) use catalog::StoryCatalog;
#[allow(unused_imports)]
pub(in crate::game) use mutations::MutationOutcome;
#[allow(unused_imports)]
pub(in crate::game) use state::{AssertionOrigin, StoryEventBlockKind, StoryState};
#[allow(unused_imports)]
pub(crate) use state::{
    AuthorizationProgressSnapshot, FactProgressSnapshot, ObjectiveProgressSnapshot,
    QuestionProgressSnapshot, StoryStateSnapshot,
};
