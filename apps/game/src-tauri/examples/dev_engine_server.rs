// Dev-only HTTP wrapper around the same application facade used by Tauri, so
// the SPA can be driven from a regular browser (Chrome DevTools MCP /
// Playwright) without WKWebView. Not bundled, not shipped.
//
// Listens on 127.0.0.1:1421. CORS is limited to localhost:1420
// (the Vite dev port pinned in vite.config.js).

#[cfg(not(any(debug_assertions, feature = "dev-engine-server")))]
compile_error!("dev_engine_server is dev-only; build it in debug mode or enable the dev-engine-server feature.");

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;

use lyra_lib::game::GameError;
use lyra_lib::{
    build_development_app_state, dispatch_development_command_with_exit,
    validate_thumbnail_submission, AppState, DevelopmentExitDriver, RawThumbnailHeader,
    MAX_THUMBNAIL_SUBMISSION_BYTES,
};

const ADDR: &str = "127.0.0.1:1421";
const CORS_ORIGIN: &str = "http://localhost:1420";
const MAX_REQUEST_BODY_BYTES: usize = 16 * 1024 * 1024;

fn resources_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/scenes")
}

struct ServerState {
    app: AppState,
    exit: Arc<DevelopmentExitDriver>,
    runtime: tokio::runtime::Runtime,
}

fn main() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    let state = ServerState {
        app: build_development_app_state(
            resources_dir(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/dev-engine-server/saves"),
        )
        .expect("application state"),
        exit: Arc::new(DevelopmentExitDriver::default()),
        runtime,
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
    let request = match read_request_head(&mut reader) {
        Ok(request) => request,
        Err(error) => {
            write_error_response(&mut stream, error, None);
            return;
        }
    };

    if request.method == "OPTIONS" {
        let status = if cors_allowed(request.origin.as_deref()) {
            204
        } else {
            403
        };
        write_response(&mut stream, status, "", b"", request.origin.as_deref());
        return;
    }

    // Enforce CORS origin validation for every non-OPTIONS request before
    // command validation or dispatch. A browser-readable response is only
    // useful to the single approved dev origin; reject any other origin up
    // front so a malicious page on a different origin cannot drive the dev
    // server. Requests without an Origin header (e.g. curl, server-to-server)
    // are still allowed, mirroring `cors_allowed`.
    if let Some(origin) = request.origin.as_deref() {
        if origin != CORS_ORIGIN {
            write_forbidden_response(
                &mut stream,
                GameError::request_origin_forbidden(origin),
                Some(origin),
            );
            return;
        }
    }

    let command = normalize_command_path(&request.path);
    let raw_headers = request
        .headers
        .iter()
        .map(|header| RawThumbnailHeader::new(&header.name, &header.value))
        .collect::<Vec<_>>();
    if let Err(error) =
        validate_thumbnail_request_head(command, &raw_headers, request.content_length)
    {
        write_error_response(&mut stream, error, request.origin.as_deref());
        return;
    }

    let body = match read_request_body(&mut reader, request.content_length) {
        Ok(body) => body,
        Err(error) => {
            write_error_response(&mut stream, error, request.origin.as_deref());
            return;
        }
    };

    eprintln!(
        "[dev_engine_server] {} /{} body_bytes={}",
        request.method,
        command,
        body.len()
    );

    let result = dispatch(state, command, &raw_headers, &body);
    match result {
        Ok(response) => write_response(
            &mut stream,
            200,
            response.content_type,
            &response.body,
            request.origin.as_deref(),
        ),
        Err(error) => write_error_response(&mut stream, error, request.origin.as_deref()),
    }
}

#[derive(Debug)]
struct HttpRequestHead {
    method: String,
    path: String,
    headers: Vec<OwnedHttpHeader>,
    content_length: usize,
    origin: Option<String>,
}

#[derive(Debug)]
struct OwnedHttpHeader {
    name: Vec<u8>,
    value: Vec<u8>,
}

fn read_request_head(reader: &mut impl BufRead) -> Result<HttpRequestHead, GameError> {
    let request_line = read_http_line(reader)?;
    let request_line = std::str::from_utf8(trim_http_line(&request_line))
        .map_err(|_| request_parse_failure("request line is not UTF-8"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| request_parse_failure("request method is missing"))?;
    let path = parts
        .next()
        .ok_or_else(|| request_parse_failure("request path is missing"))?;
    if parts.next().is_none() {
        return Err(request_parse_failure("HTTP version is missing"));
    }

    let mut headers = Vec::new();
    loop {
        let line = read_http_line(reader)?;
        let line = trim_http_line(&line);
        if line.is_empty() {
            break;
        }
        let separator = line
            .iter()
            .position(|byte| *byte == b':')
            .ok_or_else(|| request_parse_failure("request header is malformed"))?;
        let name = trim_http_whitespace(&line[..separator]).to_vec();
        let value = trim_http_whitespace(&line[separator + 1..]).to_vec();
        if name.is_empty() {
            return Err(request_parse_failure("request header name is missing"));
        }
        headers.push(OwnedHttpHeader { name, value });
    }

    let content_lengths = headers
        .iter()
        .filter(|header| header.name.eq_ignore_ascii_case(b"content-length"))
        .collect::<Vec<_>>();
    let content_length = match content_lengths.as_slice() {
        [] => 0,
        [header] => std::str::from_utf8(&header.value)
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| request_parse_failure("Content-Length is invalid"))?,
        _ => return Err(request_parse_failure("Content-Length is duplicated")),
    };
    let origins = headers
        .iter()
        .filter(|header| header.name.eq_ignore_ascii_case(b"origin"))
        .collect::<Vec<_>>();
    let origin = match origins.as_slice() {
        [] => None,
        [header] => Some(
            std::str::from_utf8(&header.value)
                .map_err(|_| request_parse_failure("Origin is not UTF-8"))?
                .to_owned(),
        ),
        _ => return Err(request_parse_failure("Origin is duplicated")),
    };

    Ok(HttpRequestHead {
        method: method.to_owned(),
        path: path.to_owned(),
        headers,
        content_length,
        origin,
    })
}

fn read_http_line(reader: &mut impl BufRead) -> Result<Vec<u8>, GameError> {
    let mut line = Vec::new();
    let read = reader
        .read_until(b'\n', &mut line)
        .map_err(|_| request_parse_failure("request head could not be read"))?;
    if read == 0 {
        return Err(request_parse_failure(
            "request head ended before the blank line",
        ));
    }
    if line.len() > 16 * 1024 {
        return Err(request_parse_failure("request header line is too large"));
    }
    Ok(line)
}

fn trim_http_line(line: &[u8]) -> &[u8] {
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    line.strip_suffix(b"\r").unwrap_or(line)
}

fn trim_http_whitespace(mut value: &[u8]) -> &[u8] {
    while value
        .first()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[1..];
    }
    while value
        .last()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[..value.len() - 1];
    }
    value
}

fn normalize_command_path(path: &str) -> &str {
    path.trim_start_matches('/')
        .strip_prefix("command/")
        .unwrap_or_else(|| path.trim_start_matches('/'))
}

fn validate_thumbnail_request_head(
    command: &str,
    headers: &[RawThumbnailHeader<'_>],
    content_length: usize,
) -> Result<(), GameError> {
    if command != "submit_save_thumbnail" {
        return Ok(());
    }
    validate_thumbnail_submission(headers, b"")?;
    if content_length > MAX_THUMBNAIL_SUBMISSION_BYTES {
        return Err(GameError::thumbnail_png_too_large());
    }
    Ok(())
}

fn read_request_body(reader: &mut impl Read, content_length: usize) -> Result<Vec<u8>, GameError> {
    if content_length > MAX_REQUEST_BODY_BYTES {
        return Err(request_parse_failure("request body is too large"));
    }
    let mut body = Vec::new();
    body.try_reserve_exact(content_length)
        .map_err(|_| request_parse_failure("request body is too large"))?;
    body.resize(content_length, 0);
    reader
        .read_exact(&mut body)
        .map_err(|_| request_parse_failure("request body ended before Content-Length"))?;
    Ok(body)
}

fn request_parse_failure(detail: &str) -> GameError {
    GameError::parse_failure(detail.to_owned())
}

fn write_error_response(stream: &mut TcpStream, error: GameError, origin: Option<&str>) {
    let body = serde_json::to_vec(&error).unwrap_or_else(|_| b"{}".to_vec());
    write_response(stream, 400, "application/json", &body, origin);
}

fn write_forbidden_response(stream: &mut TcpStream, error: GameError, origin: Option<&str>) {
    let body = serde_json::to_vec(&error).unwrap_or_else(|_| b"{}".to_vec());
    write_response(stream, 403, "application/json", &body, origin);
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    origin: Option<&str>,
) {
    let response = encode_response(status, content_type, body, origin);
    let _ = stream.write_all(&response);
}

fn encode_response(status: u16, content_type: &str, body: &[u8], origin: Option<&str>) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        _ => "Status",
    };
    let cors = cors_headers(origin);
    let head = if content_type.is_empty() {
        format!("HTTP/1.1 {status} {reason}\r\n{cors}Content-Length: 0\r\n\r\n")
    } else {
        format!(
            "HTTP/1.1 {status} {reason}\r\n{cors}Content-Type: {content_type}\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
    };
    let mut response = Vec::with_capacity(head.len() + body.len());
    response.extend_from_slice(head.as_bytes());
    response.extend_from_slice(body);
    response
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
            "Access-Control-Allow-Origin: {allow_origin}\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Lyra-Thumbnail-Ticket\r\nVary: Origin\r\n",
        )
    }
}

fn dispatch(
    state: &ServerState,
    command: &str,
    headers: &[RawThumbnailHeader<'_>],
    body: &[u8],
) -> Result<lyra_lib::DevelopmentCommandResponse, GameError> {
    state
        .runtime
        .block_on(dispatch_development_command_with_exit(
            &state.app,
            command,
            headers,
            body,
            Arc::clone(&state.exit),
        ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lyra_lib::{validate_thumbnail_submission, RawThumbnailHeader};

    #[test]
    fn binary_response_preserves_bytes_and_uses_exact_content_length() {
        let bytes = b"\x89PNG\xff\0";

        let encoded = encode_response(200, "image/png", bytes, None);
        let boundary = encoded
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap();
        let head = std::str::from_utf8(&encoded[..boundary]).unwrap();

        assert!(head.contains("Content-Type: image/png\r\n"));
        assert!(head.ends_with("Content-Length: 6"));
        assert_eq!(&encoded[boundary + 4..], bytes);
    }

    #[test]
    fn cors_allows_exactly_the_two_approved_request_headers() {
        let headers = cors_headers(Some(CORS_ORIGIN));

        assert!(headers
            .contains("Access-Control-Allow-Headers: Content-Type, X-Lyra-Thumbnail-Ticket\r\n"));
        assert_eq!(headers.matches("Access-Control-Allow-Headers:").count(), 1);
    }

    #[test]
    fn request_origin_forbidden_error_carries_typed_code() {
        let error = GameError::request_origin_forbidden("http://evil.example");
        assert_eq!(error.code, "requestOriginForbidden");
        assert!(error.message.contains("http://evil.example"));
    }

    #[test]
    fn cors_allowed_permits_missing_origin_and_approved_origin_only() {
        assert!(cors_allowed(None));
        assert!(cors_allowed(Some(CORS_ORIGIN)));
        assert!(!cors_allowed(Some("http://evil.example")));
        assert!(!cors_allowed(Some("http://localhost:9999")));
    }

    #[test]
    fn http_missing_and_duplicate_ticket_headers_use_the_shared_typed_error() {
        let ticket = uuid::Uuid::new_v4().hyphenated().to_string();
        let duplicate = [
            RawThumbnailHeader::new(b"x-lyra-thumbnail-ticket", ticket.as_bytes()),
            RawThumbnailHeader::new(b"X-Lyra-Thumbnail-Ticket", ticket.as_bytes()),
        ];

        assert_eq!(
            validate_thumbnail_submission(&[], b"png").unwrap_err().code,
            "staleThumbnailTicket"
        );
        assert_eq!(
            validate_thumbnail_submission(&duplicate, b"png")
                .unwrap_err()
                .code,
            "staleThumbnailTicket"
        );
    }

    #[test]
    fn command_path_normalization_accepts_the_explicit_command_prefix() {
        assert_eq!(
            normalize_command_path("/command/submit_save_thumbnail"),
            "submit_save_thumbnail"
        );
        assert_eq!(normalize_command_path("/get_state"), "get_state");
    }

    #[test]
    fn request_head_preserves_repeated_raw_headers_and_rejects_length_overflow() {
        let mut request = std::io::Cursor::new(
            b"POST /command/submit_save_thumbnail HTTP/1.1\r\n\
              X-Lyra-Thumbnail-Ticket: first\r\n\
              x-lyra-thumbnail-ticket: \xff\r\n\
              Content-Length: 3\r\n\r\n",
        );
        let parsed = read_request_head(&mut request).unwrap();
        let tickets = parsed
            .headers
            .iter()
            .filter(|header| header.name.eq_ignore_ascii_case(b"x-lyra-thumbnail-ticket"))
            .collect::<Vec<_>>();
        assert_eq!(tickets.len(), 2);
        assert_eq!(tickets[1].value, b"\xff");
        assert_eq!(parsed.content_length, 3);

        let mut overflow = std::io::Cursor::new(
            b"POST /get_state HTTP/1.1\r\n\
              Content-Length: 999999999999999999999999999999999999\r\n\r\n",
        );
        assert_eq!(
            read_request_head(&mut overflow).unwrap_err().code,
            "parseFailure"
        );
    }

    #[test]
    fn thumbnail_ingress_cap_and_early_eof_fail_before_body_dispatch() {
        let ticket = uuid::Uuid::new_v4().hyphenated().to_string();
        let headers = [RawThumbnailHeader::new(
            b"x-lyra-thumbnail-ticket",
            ticket.as_bytes(),
        )];
        assert_eq!(
            validate_thumbnail_request_head(
                "submit_save_thumbnail",
                &headers,
                MAX_THUMBNAIL_SUBMISSION_BYTES + 1,
            )
            .unwrap_err()
            .code,
            "thumbnailPngTooLarge"
        );
        assert_eq!(
            read_request_body(&mut std::io::Cursor::new(b"short"), 6)
                .unwrap_err()
                .code,
            "parseFailure"
        );
    }
}
