// src-tauri/src/game/dialogue_locale.rs
//
// Read-only access to the compiler's dialogue locale manifests
// (`resources/assets/dialogue_locale.<locale>.json`): the translated text and
// voice clip asset ID of each spoken line, per chapter. The manifest is
// separate from scene JSON and never touches the engine, game state, or a
// save's content revision. Wire shape: `DialogueLocaleManifestV1` in
// `@lyra/dialogue-locale`.

use super::GameError;
use serde::{Deserialize, Serialize};
use std::io::ErrorKind;
use std::path::Path;

const SUPPORTED_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueLocaleManifest {
    pub schema_version: u32,
    pub locale: String,
    pub chapters: Vec<DialogueLocaleChapter>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueLocaleChapter {
    pub id: String,
    pub lines: Vec<DialogueLocaleLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueLocaleLine {
    pub speaker: String,
    /// Non-default portrait expression, or `None` for `standard` and
    /// portrait-less lines.
    pub expression: Option<String>,
    /// The emitted Chinese line this entry translates.
    pub zh: String,
    /// The translated line.
    pub text: String,
    /// `voice.<locale>.<clip>` asset ID, or `None` when the build has no clip.
    pub voice: Option<String>,
}

/// Locale codes such as `ja` or `pt-BR`. The code becomes part of a file
/// name, so anything else is rejected before touching the filesystem.
fn is_locale_code(locale: &str) -> bool {
    let bytes = locale.as_bytes();
    match bytes.len() {
        2 => bytes.iter().all(u8::is_ascii_lowercase),
        5 => {
            bytes[..2].iter().all(u8::is_ascii_lowercase)
                && bytes[2] == b'-'
                && bytes[3..].iter().all(u8::is_ascii_uppercase)
        }
        _ => false,
    }
}

/// `ja` -> `dialogue_locale.ja.json`.
pub fn manifest_file_name(locale: &str) -> String {
    format!("dialogue_locale.{locale}.json")
}

/// Loads `dialogue_locale.<locale>.json` from the bundled assets directory.
/// Returns `Ok(None)` when the build has no manifest for that locale, so a
/// missing translation is silence rather than an error.
pub fn load_dialogue_locale(
    assets_dir: &Path,
    locale: &str,
) -> Result<Option<DialogueLocaleManifest>, GameError> {
    if !is_locale_code(locale) {
        return Err(GameError::dialogue_locale_load_failed(format!(
            "'{locale}' is not a locale code such as ja."
        )));
    }
    let path = assets_dir.join(manifest_file_name(locale));
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(GameError::dialogue_locale_load_failed(format!(
                "cannot read {}: {error}",
                path.display()
            )))
        }
    };
    let manifest: DialogueLocaleManifest = serde_json::from_str(&text).map_err(|error| {
        GameError::dialogue_locale_load_failed(format!("cannot parse {}: {error}", path.display()))
    })?;
    if manifest.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(GameError::dialogue_locale_load_failed(format!(
            "{} has schemaVersion {}; this build reads {SUPPORTED_SCHEMA_VERSION}.",
            path.display(),
            manifest.schema_version
        )));
    }
    if manifest.locale != locale {
        return Err(GameError::dialogue_locale_load_failed(format!(
            "{} declares locale '{}' instead of '{locale}'.",
            path.display(),
            manifest.locale
        )));
    }
    Ok(Some(manifest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_manifest(dir: &Path, locale: &str, body: &str) {
        fs::write(dir.join(manifest_file_name(locale)), body).expect("write manifest");
    }

    #[test]
    fn loads_a_manifest_with_camel_case_fields() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_manifest(
            dir.path(),
            "ja",
            r#"{
              "schemaVersion": 1,
              "locale": "ja",
              "chapters": [{
                "id": "chapter_1",
                "lines": [{
                  "speaker": "相馬律",
                  "expression": null,
                  "zh": "不說謊。",
                  "text": "嘘をつかない。",
                  "voice": "voice.ja.ch1_soma_ritsu_0001"
                }]
              }]
            }"#,
        );

        let manifest = load_dialogue_locale(dir.path(), "ja")
            .expect("manifest loads")
            .expect("manifest exists");

        assert_eq!(manifest.chapters[0].id, "chapter_1");
        assert_eq!(
            manifest.chapters[0].lines[0],
            DialogueLocaleLine {
                speaker: "相馬律".into(),
                expression: None,
                zh: "不說謊。".into(),
                text: "嘘をつかない。".into(),
                voice: Some("voice.ja.ch1_soma_ritsu_0001".into()),
            }
        );
        let wire = serde_json::to_value(&manifest).expect("serializes");
        assert_eq!(wire["schemaVersion"], 1);
    }

    #[test]
    fn a_missing_manifest_is_none() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(load_dialogue_locale(dir.path(), "ja"), Ok(None));
    }

    #[test]
    fn rejects_path_like_locales_before_reading() {
        let dir = tempfile::tempdir().expect("tempdir");
        for locale in ["../ja", "ja/x", "JA", "", "pt-br", "japanese"] {
            let error = load_dialogue_locale(dir.path(), locale).expect_err(locale);
            assert_eq!(error.code, "dialogueLocaleLoadFailed");
        }
        assert_eq!(load_dialogue_locale(dir.path(), "pt-BR"), Ok(None));
    }

    #[test]
    fn rejects_a_malformed_or_mismatched_manifest() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_manifest(dir.path(), "ja", "{");
        assert_eq!(
            load_dialogue_locale(dir.path(), "ja")
                .expect_err("malformed")
                .code,
            "dialogueLocaleLoadFailed"
        );
        write_manifest(
            dir.path(),
            "ja",
            r#"{"schemaVersion": 2, "locale": "ja", "chapters": []}"#,
        );
        assert!(load_dialogue_locale(dir.path(), "ja")
            .expect_err("future schema")
            .message
            .contains("schemaVersion 2"));
        write_manifest(
            dir.path(),
            "ja",
            r#"{"schemaVersion": 1, "locale": "en", "chapters": []}"#,
        );
        assert!(load_dialogue_locale(dir.path(), "ja")
            .expect_err("wrong locale")
            .message
            .contains("declares locale 'en'"));
    }
}
