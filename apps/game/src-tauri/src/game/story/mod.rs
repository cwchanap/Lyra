mod catalog;
mod mutations;
mod state;
mod view;

pub(crate) use catalog::StoryCatalog;
#[allow(unused_imports)]
pub(in crate::game) use catalog::{CaseRecordDefinition, SourceGroupDefinition};
#[allow(unused_imports)]
pub(in crate::game) use mutations::MutationOutcome;
#[allow(unused_imports)]
pub(in crate::game) use state::{AssertionOrigin, FactProgress, StoryEventBlockKind, StoryState};
#[allow(unused_imports)]
pub(crate) use state::{
    AuthorizationProgressSnapshot, FactProgressSnapshot, ObjectiveProgressSnapshot,
    QuestionProgressSnapshot, StoryStateSnapshot,
};
pub(in crate::game) use view::StoryStateView;
#[allow(unused_imports)]
// OriginContext{Kind,}View are consumed only inside the story module today; kept pub(in crate::game) for future cross-module view assembly.
pub(in crate::game) use view::{OriginContextKindView, OriginContextView};
