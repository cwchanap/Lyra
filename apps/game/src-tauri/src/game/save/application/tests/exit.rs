use crate::game::save::application::{
    ApplicationExit, ApplicationPersistence, ExitRequestSource, ExitStatusView,
};
use crate::game::GameError;
use std::sync::Arc;

struct FailingExit;

impl ApplicationExit for FailingExit {
    fn exit(&self, _code: i32) -> Result<(), GameError> {
        Err(GameError::save_write_failed())
    }
}

#[test]
fn exit_status_uses_the_camel_case_tagged_wire_shape() {
    let value = serde_json::to_value(ExitStatusView::Saving).unwrap();
    assert_eq!(value, serde_json::json!({ "type": "saving" }));
}

#[tokio::test]
async fn failed_exit_can_be_cancelled_by_its_exact_token() {
    let persistence = Arc::new(ApplicationPersistence::new());
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();

    let token = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { failure_token, .. } = persistence.exit_status() {
                break failure_token;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    assert_eq!(
        persistence.cancel_exit(token).unwrap(),
        ExitStatusView::Idle
    );
}
