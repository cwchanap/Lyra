//! HPA-136 native agent-CLI transport. Transport only: Rust never contains
//! lens instructions, the result schema, or review semantics — TypeScript
//! owns every model-semantic byte and Rust forwards them unchanged. Rust
//! renders the agent prompt and shells out to the configured review agent
//! CLI (default `claude`); no provider key, API call, or model name exists
//! anywhere in Lyra.

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

/// Review agent CLI used when `LYRA_AI_REVIEW_AGENT` is unset or empty.
const DEFAULT_AGENT_BINARY: &str = "claude";
/// Fixed one-shot wait for the agent; there is no retry.
const AGENT_WAIT_SECS: u64 = 180;
const AGENT_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);
/// Budget reserved after the deadline kill to drain in-flight output, so the
/// timeout diagnostic is not silently empty (mirrors the lib.rs validation
/// runner's drain floor).
const AGENT_DRAIN_BUDGET: std::time::Duration = std::time::Duration::from_secs(2);
/// Upper bound on agent detail kept in error messages so a huge/hostile
/// stderr cannot flood the editor error channel.
const PROVIDER_DETAIL_LIMIT: usize = 300;
/// Upper bound on agent stdout/stderr retained in memory. A legitimate
/// review JSON is a few KB; 1 MiB is generous while preventing a hostile
/// or broken agent from exhausting editor memory.
const OUTPUT_BYTE_LIMIT: usize = 1 << 20;

/// Renders the full agent prompt: the TS-owned lens `instructions` verbatim,
/// a return-only-JSON directive, the serialized `text.format.schema`, and the
/// TS-built `input` verbatim. `text.verbosity` is ignored by this transport
/// (shape retained as the stable wire contract).
pub(crate) fn agent_prompt(payload: &AiReviewTransportPayload) -> String {
    let schema = payload
        .text
        .pointer("/format/schema")
        .map(ToString::to_string)
        .unwrap_or_else(|| "null".to_string());
    format!(
        "{}\n\nRespond with ONLY a single JSON value that validates against \
         this JSON Schema. No prose, no code fences, no explanation:\n{}\n\n\
         ---\n\n{}",
        payload.instructions, schema, payload.input
    )
}

/// One-shot agent-CLI transport: spawn `<agent> -p --tools ""`, write the
/// full prompt to stdin (the variadic `--tools ""` swallows a trailing argv
/// argument, so stdin is the only reliable channel), capture stdout/stderr,
/// wait a fixed 180 seconds (poll `try_wait`, kill at the deadline — std
/// has no wait timeout and no new dependency is allowed), and parse stdout
/// as the candidate JSON. Spawn failure of a missing binary maps to
/// `aiProviderConfigMissing`; other spawn failures, non-zero exits, and the
/// timeout map to `aiProviderRequestFailed`; empty or unparseable stdout
/// maps to `aiProviderInvalidResponse`. No env access here, so tests inject
/// the binary directly.
pub(crate) fn run_agent_review(
    payload: &AiReviewTransportPayload,
    agent_binary: &str,
) -> Result<serde_json::Value, EditorError> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut spawn = Command::new(agent_binary);
    spawn
        .arg("-p")
        .arg("--tools")
        .arg("")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match spawn.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(EditorError::new(
                "aiProviderConfigMissing",
                format!("AI review agent CLI not found: {agent_binary}"),
            ));
        }
        Err(error) => {
            return Err(request_failed(format!(
                "failed to spawn agent CLI \"{agent_binary}\": {error}"
            )));
        }
    };

    // A full stdin pipe must never block the polling loop: write the prompt
    // on its own thread, then reuse the drain channels for stdout/stderr.
    let mut stdin = child.stdin.take().expect("stdin was piped");
    let prompt = agent_prompt(payload);
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(prompt.as_bytes());
    });

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    let (stdout_sender, stdout_receiver) = std::sync::mpsc::channel::<(Vec<u8>, bool)>();
    let (stderr_sender, stderr_receiver) = std::sync::mpsc::channel::<(Vec<u8>, bool)>();
    std::thread::spawn(move || {
        let _ = stdout_sender.send(read_bounded(stdout, OUTPUT_BYTE_LIMIT));
    });
    std::thread::spawn(move || {
        let _ = stderr_sender.send(read_bounded(stderr, OUTPUT_BYTE_LIMIT));
    });

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(AGENT_WAIT_SECS);
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (Some(status), false),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break (None, true);
                }
                std::thread::sleep(AGENT_POLL_INTERVAL);
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(request_failed(format!(
                    "failed to wait for agent CLI \"{agent_binary}\": {error}"
                )));
            }
        }
    };
    // Detach instead of joining: if a descendant of the agent inherited the
    // stdin pipe and survived the deadline kill, joining could block forever
    // once the prompt exceeds the pipe buffer. The thread terminates on its
    // own when the pipe closes — same survivor rationale as AGENT_DRAIN_BUDGET.
    drop(writer);

    let (stdout_bytes, stdout_truncated) = drain_within(stdout_receiver);
    let (stderr_bytes, _) = drain_within(stderr_receiver);
    let stderr_text = String::from_utf8_lossy(&stderr_bytes);

    if timed_out {
        return Err(request_failed(format!(
            "agent CLI \"{agent_binary}\" exceeded {AGENT_WAIT_SECS}s and was killed: {}",
            bounded(stderr_text.into_owned())
        )));
    }
    let status = status.expect("non-timeout exit carries a status");
    if !status.success() {
        return Err(request_failed(format!(
            "agent CLI \"{agent_binary}\" exited with {status}: {}",
            bounded(stderr_text.into_owned())
        )));
    }
    if stdout_truncated {
        return Err(invalid_response(format!(
            "agent CLI stdout exceeded {OUTPUT_BYTE_LIMIT} bytes and was truncated"
        )));
    }
    let stdout_text = String::from_utf8_lossy(&stdout_bytes);
    let text = stdout_text.trim();
    if text.is_empty() {
        return Err(invalid_response("agent CLI produced no output on stdout"));
    }
    serde_json::from_str(text)
        .map_err(|error| invalid_response(format!("agent CLI output is not valid JSON: {error}")))
}

/// Tauri command: resolves the review agent binary from the native process
/// environment (`LYRA_AI_REVIEW_AGENT`, default `claude`) and delegates to
/// the transport. The blocking spawn/wait runs on the async runtime's
/// blocking pool; there is no retry.
#[tauri::command]
pub(crate) async fn run_ai_review(
    payload: AiReviewTransportPayload,
) -> Result<serde_json::Value, EditorError> {
    let agent_binary = std::env::var("LYRA_AI_REVIEW_AGENT")
        .ok()
        .filter(|agent| !agent.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AGENT_BINARY.to_string());
    tauri::async_runtime::spawn_blocking(move || run_agent_review(&payload, &agent_binary))
        .await
        .map_err(|error| request_failed(format!("agent review task failed to complete: {error}")))?
}

fn request_failed(message: impl Into<String>) -> EditorError {
    EditorError::new("aiProviderRequestFailed", message)
}

fn invalid_response(message: impl Into<String>) -> EditorError {
    EditorError::new("aiProviderInvalidResponse", message)
}

/// Truncates agent detail to `PROVIDER_DETAIL_LIMIT` chars.
fn bounded(detail: String) -> String {
    detail.chars().take(PROVIDER_DETAIL_LIMIT).collect()
}

/// Reads up to `limit` bytes, then drains the rest without retaining so the
/// child cannot block on a full pipe. Returns `(bytes, truncated)` where
/// `truncated` is true when the stream exceeded the limit.
fn read_bounded<R: std::io::Read>(mut reader: R, limit: usize) -> (Vec<u8>, bool) {
    let mut buffer = Vec::with_capacity(limit.min(8192));
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if buffer.len() + n > limit {
                    let remaining = limit - buffer.len();
                    buffer.extend_from_slice(&chunk[..remaining]);
                    // Drain the rest so the child's pipe does not block;
                    // the data is discarded to bound memory.
                    loop {
                        match reader.read(&mut chunk) {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }
                    }
                    return (buffer, true);
                }
                buffer.extend_from_slice(&chunk[..n]);
            }
            Err(_) => break,
        }
    }
    (buffer, false)
}

/// Collects a drain channel with a small post-kill budget so a descendant
/// that somehow survived the kill cannot extend the wait past the bound.
fn drain_within(receiver: std::sync::mpsc::Receiver<(Vec<u8>, bool)>) -> (Vec<u8>, bool) {
    receiver
        .recv_timeout(AGENT_DRAIN_BUDGET)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Unique suffix for stub dirs so concurrent/rapid tests never collide.
    static STUB_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

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

    /// Writes a stub review-agent shell script to a unique temp dir and
    /// returns its path. Tests inject this path as the agent binary, so the
    /// transport is exercised with no network and no real agent.
    fn stub_agent(script_body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "lyra-ai-review-stub-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock is after the epoch")
                .as_nanos(),
            STUB_DIR_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir_all(&dir).expect("stub dir is created");
        let path = dir.join("stub-agent.sh");
        std::fs::write(&path, format!("#!/bin/sh\n{script_body}\n"))
            .expect("stub script is written");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("stub script is made executable");
        path
    }

    fn run_with_stub(script_body: &str) -> Result<serde_json::Value, EditorError> {
        let payload = sentinel_payload();
        run_agent_review(&payload, &stub_agent(script_body).to_string_lossy())
    }

    // ---- prompt composition (pure) ----------------------------------------

    #[test]
    fn agent_prompt_composes_instructions_directive_schema_and_input() {
        let payload = sentinel_payload();
        let prompt = agent_prompt(&payload);
        assert!(prompt.starts_with("sentinel-lens-instructions"));
        assert!(
            prompt.ends_with("{\"lens\":\"dialogue\"}"),
            "input must be verbatim at the end"
        );
        assert!(
            prompt.contains("JSON"),
            "prompt must carry a JSON-only directive"
        );
        let schema = payload.text["format"]["schema"].to_string();
        assert!(
            prompt.contains(&schema),
            "serialized schema must be embedded"
        );
    }

    // ---- stub-CLI transport -----------------------------------------------

    #[test]
    fn successful_agent_json_stdout_parses_to_candidate() {
        let candidate = run_with_stub("cat >/dev/null\nprintf '{\"noChange\":true}'")
            .expect("stub success must return the parsed candidate");
        assert_eq!(candidate, json!({"noChange": true}));
    }

    #[test]
    fn prompt_reaches_agent_via_stdin() {
        let candidate = run_with_stub(
            "if grep -q sentinel-lens-instructions; then printf '{\"onStdin\":true}'; \
             else echo 'prompt missing from stdin' >&2; exit 1; fi",
        )
        .expect("stub must find the prompt on stdin");
        assert_eq!(candidate, json!({"onStdin": true}));
    }

    #[test]
    fn nonzero_exit_with_stderr_maps_to_request_failed() {
        let error = run_with_stub("cat >/dev/null\necho 'agent exploded' >&2\nexit 1")
            .expect_err("non-zero exit must fail");
        assert_eq!(error.code, "aiProviderRequestFailed");
        assert!(error.message.contains("agent exploded"));
    }

    #[test]
    fn stderr_detail_is_bounded() {
        let path = stub_agent("cat >/dev/null\nhead -c 1000 </dev/zero | tr '\\0' 'q' >&2\nexit 1");
        let error = run_agent_review(&sentinel_payload(), &path.to_string_lossy())
            .expect_err("non-zero exit must fail");
        assert_eq!(error.code, "aiProviderRequestFailed");
        // Exact bound: fixed prefix (with the binary path) + detail limited to
        // PROVIDER_DETAIL_LIMIT of the 1000-char stderr.
        let prefix = format!(
            "agent CLI \"{}\" exited with exit status: 1: ",
            path.display()
        );
        assert_eq!(
            error.message.chars().count(),
            prefix.chars().count() + PROVIDER_DETAIL_LIMIT
        );
    }

    #[test]
    fn garbage_stdout_maps_to_invalid_response() {
        let error = run_with_stub("cat >/dev/null\nprintf 'not json'")
            .expect_err("garbage stdout must fail");
        assert_eq!(error.code, "aiProviderInvalidResponse");
    }

    #[test]
    fn empty_stdout_maps_to_invalid_response() {
        let error = run_with_stub("cat >/dev/null").expect_err("empty stdout must fail");
        assert_eq!(error.code, "aiProviderInvalidResponse");
    }

    #[test]
    fn truncated_stdout_maps_to_invalid_response() {
        // Produce just over OUTPUT_BYTE_LIMIT so read_bounded truncates and
        // the transport rejects the candidate as an invalid response.
        let script = format!(
            "cat >/dev/null\nhead -c {} /dev/zero | tr '\\0' 'x'",
            OUTPUT_BYTE_LIMIT + 1,
        );
        let error = run_with_stub(&script).expect_err("truncated stdout must fail");
        assert_eq!(error.code, "aiProviderInvalidResponse");
        assert!(error.message.contains("truncated"));
    }

    #[test]
    fn read_bounded_returns_truncation_flag() {
        let input = [b'x'; 100];
        let (bytes, truncated) = read_bounded(&input[..], 50);
        assert_eq!(bytes.len(), 50);
        assert!(truncated);

        let (bytes, truncated) = read_bounded(&input[..], 200);
        assert_eq!(bytes.len(), 100);
        assert!(!truncated);
    }

    #[test]
    fn missing_agent_binary_maps_to_config_missing() {
        let payload = sentinel_payload();
        let error = run_agent_review(&payload, "/nonexistent/lyra-review-agent")
            .expect_err("missing binary must fail");
        assert_eq!(error.code, "aiProviderConfigMissing");
        assert!(error.message.contains("AI review agent CLI not found"));
    }
}
