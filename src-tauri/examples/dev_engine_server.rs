// Dev-only HTTP wrapper around GameEngine. Exposes the same 9 commands the
// Tauri shell does, so the SPA can be driven from a regular browser (Chrome
// DevTools MCP / Playwright) without WKWebView. Not bundled, not shipped.
//
// Listens on 127.0.0.1:1421. CORS is limited to localhost:1420
// (the Vite dev port pinned in vite.config.js).

#[cfg(not(any(debug_assertions, feature = "dev-engine-server")))]
compile_error!("dev_engine_server is dev-only; build it in debug mode or enable the dev-engine-server feature.");

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;

use lyra_lib::game::{GameEngine, GameError, GameStateView, QueueToken};
use serde::Deserialize;

const ADDR: &str = "127.0.0.1:1421";
const CORS_ORIGIN: &str = "http://localhost:1420";

fn resources_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/scenes")
}

struct ServerState {
    engine: Mutex<Option<GameEngine>>,
}

fn main() {
    let state = ServerState {
        engine: Mutex::new(None),
    };
    let listener = TcpListener::bind(ADDR).expect("bind");
    eprintln!("[dev_engine_server] listening on http://{ADDR}");
    for stream in listener.incoming() {
        match stream {
            Ok(s) => handle(s, &state),
            Err(e) => eprintln!("[dev_engine_server] accept error: {e}"),
        }
    }
}

fn handle(mut stream: TcpStream, state: &ServerState) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    // Parse request line + headers.
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let path = parts[1];

    let mut content_length = 0usize;
    let mut origin: Option<String> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            return;
        }
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some(v) = line
            .strip_prefix("Content-Length: ")
            .or_else(|| line.strip_prefix("content-length: "))
        {
            content_length = v.trim().parse().unwrap_or(0);
        }
        if let Some(v) = line
            .strip_prefix("Origin: ")
            .or_else(|| line.strip_prefix("origin: "))
        {
            origin = Some(v.trim().to_string());
        }
    }

    if method == "OPTIONS" {
        let status = if cors_allowed(origin.as_deref()) {
            204
        } else {
            403
        };
        write_response(&mut stream, status, "", "", origin.as_deref());
        return;
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body).ok();
    }

    let command = path.trim_start_matches('/');
    let body_str = String::from_utf8_lossy(&body);
    eprintln!("[dev_engine_server] {method} /{command}  body={body_str}");

    let result = dispatch(state, command, &body);
    match result {
        Ok(json) => write_response(
            &mut stream,
            200,
            "application/json",
            &json,
            origin.as_deref(),
        ),
        Err(err) => {
            let json = serde_json::to_string(&err).unwrap_or_else(|_| "{}".into());
            write_response(
                &mut stream,
                400,
                "application/json",
                &json,
                origin.as_deref(),
            );
        }
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
    origin: Option<&str>,
) {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        _ => "Status",
    };
    let body_bytes = body.as_bytes();
    let cors = cors_headers(origin);
    let head = if content_type.is_empty() {
        format!("HTTP/1.1 {status} {reason}\r\n{cors}Content-Length: 0\r\n\r\n")
    } else {
        format!(
            "HTTP/1.1 {status} {reason}\r\n{cors}Content-Type: {content_type}\r\nContent-Length: {}\r\n\r\n",
            body_bytes.len()
        )
    };
    let _ = stream.write_all(head.as_bytes());
    if !body_bytes.is_empty() {
        let _ = stream.write_all(body_bytes);
    }
}

fn cors_allowed(origin: Option<&str>) -> bool {
    origin.is_none_or(|value| value == CORS_ORIGIN)
}

fn cors_headers(origin: Option<&str>) -> String {
    let allow_origin = if cors_allowed(origin) {
        origin.unwrap_or(CORS_ORIGIN)
    } else {
        ""
    };
    if allow_origin.is_empty() {
        "Vary: Origin\r\n".into()
    } else {
        format!(
            "Access-Control-Allow-Origin: {allow_origin}\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nVary: Origin\r\n",
        )
    }
}

fn dispatch(state: &ServerState, command: &str, body: &[u8]) -> Result<String, GameError> {
    match command {
        "start_game" | "reset_game" => {
            let engine = GameEngine::new_started(resources_dir())?;
            let mut guard = state.engine.lock().map_err(|_| GameError::unavailable())?;
            let view = engine.view();
            *guard = Some(engine);
            serialize(view)
        }
        "get_state" => with_engine(state, |e| Ok(e.view())),
        "advance_dialogue" => {
            #[derive(Deserialize)]
            struct Args {
                expected: QueueToken,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| e.advance_dialogue(args.expected.clone()))
        }
        "inspect_hotspot" => {
            #[derive(Deserialize)]
            struct Args {
                #[serde(rename = "hotspotId")]
                hotspot_id: String,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| e.inspect_hotspot(&args.hotspot_id))
        }
        "interview_topic" => {
            #[derive(Deserialize)]
            struct Args {
                #[serde(rename = "characterId")]
                character_id: String,
                #[serde(rename = "topicId")]
                topic_id: String,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| {
                e.interview_topic(&args.character_id, &args.topic_id)
            })
        }
        "enter_sublocation" => {
            #[derive(Deserialize)]
            struct Args {
                #[serde(rename = "sublocationId")]
                sublocation_id: String,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| e.enter_sublocation(&args.sublocation_id))
        }
        "reexamine_evidence" => {
            #[derive(Deserialize)]
            struct Args {
                #[serde(rename = "evidenceId")]
                evidence_id: String,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| e.reexamine_evidence(&args.evidence_id))
        }
        "reexamine_statement" => {
            #[derive(Deserialize)]
            struct Args {
                #[serde(rename = "statementId")]
                statement_id: String,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| e.reexamine_statement(&args.statement_id))
        }
        "answer_interrogation_question" => {
            #[derive(Deserialize)]
            struct Args {
                #[serde(rename = "questionId")]
                question_id: String,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| e.answer_interrogation_question(&args.question_id))
        }
        "press_testimony_statement" => {
            #[derive(Deserialize)]
            struct Args {
                #[serde(rename = "statementId")]
                statement_id: String,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| e.press_testimony_statement(&args.statement_id))
        }
        "present_testimony_item" => {
            #[derive(Deserialize)]
            struct Args {
                #[serde(rename = "statementId")]
                statement_id: String,
                #[serde(rename = "itemKind")]
                item_kind: String,
                #[serde(rename = "itemId")]
                item_id: String,
            }
            let args: Args = parse_body(body)?;
            with_engine(state, |e| {
                e.present_testimony_item(&args.statement_id, &args.item_kind, &args.item_id)
            })
        }
        other => Err(GameError::new(
            "unknownCommand",
            format!("unknown command: {other}"),
        )),
    }
}

fn with_engine<F>(state: &ServerState, f: F) -> Result<String, GameError>
where
    F: FnOnce(&mut GameEngine) -> Result<GameStateView, GameError>,
{
    let mut guard = state.engine.lock().map_err(|_| GameError::unavailable())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    let view = f(engine)?;
    serialize(view)
}

fn serialize(v: GameStateView) -> Result<String, GameError> {
    serde_json::to_string(&v).map_err(|e| GameError::parse_failure(format!("serialize view: {e}")))
}

fn parse_body<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, GameError> {
    serde_json::from_slice(body).map_err(|e| GameError::parse_failure(format!("body json: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_state() -> ServerState {
        ServerState {
            engine: Mutex::new(None),
        }
    }

    #[test]
    fn interrogation_commands_dispatch_camel_case_args() {
        let state = empty_state();

        for (command, body) in [
            (
                "answer_interrogation_question",
                r#"{"questionId":"wakatsuki_where"}"#,
            ),
            (
                "press_testimony_statement",
                r#"{"statementId":"wakatsuki_statement_1"}"#,
            ),
            (
                "present_testimony_item",
                r#"{"statementId":"wakatsuki_statement_1","itemKind":"evidence","itemId":"receipt"}"#,
            ),
        ] {
            let err = dispatch(&state, command, body.as_bytes()).unwrap_err();
            assert_eq!(err.code, "gameNotStarted");
        }
    }
}
