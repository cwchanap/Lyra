//! HPA-136 native OpenAI Responses transport. Transport only: Rust never
//! contains lens instructions, the result schema, or review semantics —
//! TypeScript owns every model-semantic byte and Rust forwards them unchanged,
//! adding only transport-owned fields. The API key is read from the native
//! process environment only and is never exposed to the webview.

use serde::Deserialize;

use crate::EditorError;

/// Wire mirror of the TS `AiReviewTransportPayload`. `text` stays opaque so
/// Rust never needs to know the result schema it carries.
#[derive(Debug, Deserialize)]
pub(crate) struct AiReviewTransportPayload {
    instructions: String,
    input: String,
    text: serde_json::Value,
}

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL: &str = "gpt-5.6-luna";
const MAX_OUTPUT_TOKENS: i64 = 4000;
const CLIENT_TIMEOUT_SECS: u64 = 60;
/// Upper bound on provider detail kept in error messages so a huge/hostile
/// response body cannot flood the editor error channel.
const PROVIDER_DETAIL_LIMIT: usize = 300;

/// Builds the final request body: forwards the received model-semantic bytes
/// (`instructions`/`input`/`text`) unchanged and adds only transport-owned
/// fields (`model`, `store: false`, `max_output_tokens`).
fn build_final_envelope(payload: &AiReviewTransportPayload, model: &str) -> serde_json::Value {
    serde_json::json!({
        "instructions": payload.instructions,
        "input": payload.input,
        "text": payload.text,
        "model": model,
        "store": false,
        "max_output_tokens": MAX_OUTPUT_TOKENS,
    })
}

/// Validates the provider response envelope and returns the single usable
/// `output_text`, parsed as the candidate JSON. Truncation is detected before
/// any JSON parsing so a partial candidate can never be reported as merely
/// invalid. Enforces: completed status, exactly one usable output text, and
/// JSON-parseable text.
fn provider_candidate(envelope: &serde_json::Value) -> Result<serde_json::Value, EditorError> {
    let status = envelope
        .get("status")
        .and_then(|status| status.as_str())
        .unwrap_or("");
    if status == "incomplete" {
        let reason = envelope
            .pointer("/incomplete_details/reason")
            .and_then(|reason| reason.as_str())
            .unwrap_or("");
        if reason == "max_output_tokens" {
            return Err(EditorError::new(
                "aiProviderResponseTruncated",
                "provider response hit max_output_tokens before completing",
            ));
        }
        return Err(invalid_response(format!(
            "provider response ended incomplete for an unsupported reason: \"{reason}\""
        )));
    }
    if status != "completed" {
        return Err(invalid_response(format!(
            "provider response status is not completed: \"{status}\""
        )));
    }

    let mut usable_text: Option<&str> = None;
    let mut usable_count = 0usize;
    if let Some(output) = envelope.get("output").and_then(|output| output.as_array()) {
        for item in output {
            let Some(content) = item.get("content").and_then(|content| content.as_array()) else {
                continue;
            };
            for part in content {
                if part.get("type").and_then(|part_type| part_type.as_str()) != Some("output_text")
                {
                    continue;
                }
                let Some(text) = part.get("text").and_then(|text| text.as_str()) else {
                    continue;
                };
                if text.is_empty() {
                    continue;
                }
                usable_count += 1;
                usable_text = Some(text);
            }
        }
    }
    let text = match (usable_count, usable_text) {
        (1, Some(text)) => text,
        (0, _) => {
            return Err(invalid_response(
                "provider response contains no usable output_text",
            ))
        }
        (_, _) => {
            return Err(invalid_response(format!(
                "provider response contains {usable_count} competing output_text entries"
            )))
        }
    };
    serde_json::from_str(text).map_err(|error| {
        invalid_response(format!("provider output_text is not valid JSON: {error}"))
    })
}

/// One-shot native OpenAI Responses call: read the key from the native process
/// environment, forward the TS-built payload unchanged plus transport-owned
/// fields, POST once with a fixed 60-second timeout, and return the parsed
/// candidate JSON. No automatic retry.
#[tauri::command]
pub(crate) async fn run_ai_review(
    payload: AiReviewTransportPayload,
) -> Result<serde_json::Value, EditorError> {
    let api_key = match std::env::var("OPENAI_API_KEY") {
        Ok(key) if !key.trim().is_empty() => key,
        _ => {
            return Err(EditorError::new(
                "aiProviderConfigMissing",
                "OPENAI_API_KEY is not set in the editor process environment",
            ))
        }
    };
    let model = std::env::var("LYRA_OPENAI_MODEL")
        .ok()
        .filter(|model| !model.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string());

    let body = build_final_envelope(&payload, &model);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CLIENT_TIMEOUT_SECS))
        .build()
        .map_err(|error| request_failed(format!("failed to build HTTP client: {error}")))?;
    let response = client
        .post(OPENAI_RESPONSES_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| request_failed(bounded(format!("provider request failed: {error}"))))?;
    let status = response.status();
    let response_text = response.text().await.map_err(|error| {
        request_failed(bounded(format!(
            "failed to read provider response: {error}"
        )))
    })?;
    if !status.is_success() {
        return Err(request_failed(format!(
            "provider returned HTTP {status}: {}",
            bounded(response_text)
        )));
    }
    let envelope: serde_json::Value = serde_json::from_str(&response_text).map_err(|error| {
        invalid_response(format!("provider response is not valid JSON: {error}"))
    })?;
    provider_candidate(&envelope)
}

fn request_failed(message: impl Into<String>) -> EditorError {
    EditorError::new("aiProviderRequestFailed", message)
}

fn invalid_response(message: impl Into<String>) -> EditorError {
    EditorError::new("aiProviderInvalidResponse", message)
}

/// Truncates provider detail to `PROVIDER_DETAIL_LIMIT` chars.
fn bounded(detail: String) -> String {
    detail.chars().take(PROVIDER_DETAIL_LIMIT).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Sentinel payload from the task brief. Deliberately NOT the real
    /// HPA-136 schema or lens instructions.
    fn sentinel_payload() -> AiReviewTransportPayload {
        serde_json::from_value(json!({
            "instructions": "sentinel-lens-instructions",
            "input": "{\"lens\":\"dialogue\"}",
            "text": {
                "verbosity": "low",
                "format": {
                    "type": "json_schema",
                    "name": "lyra_story_review",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {"sentinel": {"type": "string"}},
                        "required": ["sentinel"],
                        "additionalProperties": false
                    }
                }
            }
        }))
        .expect("sentinel payload fixture deserializes")
    }

    fn completed_envelope(text: &str) -> serde_json::Value {
        json!({
            "status": "completed",
            "incomplete_details": null,
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": text}]
                }
            ]
        })
    }

    fn rejected_code(envelope: &serde_json::Value) -> &'static str {
        provider_candidate(envelope)
            .expect_err("envelope must be rejected")
            .code
    }

    // ---- final envelope builder ------------------------------------------

    #[test]
    fn final_envelope_forwards_model_semantic_bytes_unchanged() {
        let payload = sentinel_payload();
        let envelope = build_final_envelope(&payload, "sentinel-model");
        assert_eq!(envelope["instructions"], "sentinel-lens-instructions");
        assert_eq!(envelope["input"], "{\"lens\":\"dialogue\"}");
        assert_eq!(envelope["text"], payload.text);
        assert_eq!(envelope["text"]["verbosity"], "low");
        assert_eq!(envelope["text"]["format"]["name"], "lyra_story_review");
        assert_eq!(
            envelope["text"]["format"]["schema"]["properties"]["sentinel"],
            json!({"type": "string"})
        );
    }

    #[test]
    fn final_envelope_adds_only_transport_owned_fields() {
        let payload = sentinel_payload();
        let envelope = build_final_envelope(&payload, "sentinel-model");
        assert_eq!(envelope["model"], "sentinel-model");
        assert_eq!(envelope["store"], false);
        assert_eq!(envelope["max_output_tokens"], 4000);
        for forbidden in [
            "tools",
            "conversation",
            "previous_response_id",
            "stream",
            "background",
        ] {
            assert!(
                envelope.get(forbidden).is_none(),
                "envelope must not add {forbidden}"
            );
        }
    }

    // ---- response status / output extraction -----------------------------

    #[test]
    fn completed_single_output_text_parses_to_candidate_json() {
        let candidate = provider_candidate(&completed_envelope("{\"noChange\":true}"))
            .expect("one usable output text must parse to JSON");
        assert_eq!(candidate, json!({"noChange": true}));
    }

    #[test]
    fn max_output_truncation_wins_before_json_parsing() {
        let envelope = json!({
            "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"},
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "{\"partial\":"}]
                }
            ]
        });
        let error = provider_candidate(&envelope).expect_err("truncated response must fail");
        assert_eq!(error.code, "aiProviderResponseTruncated");
    }

    #[test]
    fn completed_envelope_without_output_text_is_invalid() {
        let envelope = json!({
            "status": "completed",
            "incomplete_details": null,
            "output": []
        });
        assert_eq!(rejected_code(&envelope), "aiProviderInvalidResponse");
    }

    #[test]
    fn refusal_only_completed_output_is_invalid() {
        let envelope = json!({
            "status": "completed",
            "incomplete_details": null,
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "refusal", "refusal": "cannot comply"}]
                }
            ]
        });
        assert_eq!(rejected_code(&envelope), "aiProviderInvalidResponse");
    }

    #[test]
    fn multiple_competing_output_texts_are_invalid() {
        let mut envelope = completed_envelope("{\"noChange\":true}");
        envelope["output"][0]["content"]
            .as_array_mut()
            .expect("content is an array")
            .push(json!({"type": "output_text", "text": "{\"noChange\":false}"}));
        assert_eq!(rejected_code(&envelope), "aiProviderInvalidResponse");
    }

    #[test]
    fn completed_non_json_output_text_is_invalid() {
        assert_eq!(
            rejected_code(&completed_envelope("not json")),
            "aiProviderInvalidResponse"
        );
    }

    #[test]
    fn incomplete_for_non_max_output_reason_is_invalid() {
        let envelope = json!({
            "status": "incomplete",
            "incomplete_details": {"reason": "content_filter"},
            "output": []
        });
        assert_eq!(rejected_code(&envelope), "aiProviderInvalidResponse");
    }

    #[test]
    fn non_completed_non_incomplete_status_is_invalid() {
        let envelope = json!({ "status": "failed", "output": [] });
        assert_eq!(rejected_code(&envelope), "aiProviderInvalidResponse");
    }
}
