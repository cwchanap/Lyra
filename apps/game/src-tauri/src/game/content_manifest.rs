use crate::game::GameError;
use serde::Deserialize;
use std::path::Path;

const CONTENT_MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::game) struct ContentManifest {
    manifest_version: u32,
    content_revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContentManifestVersionEnvelope {
    manifest_version: u32,
}

impl ContentManifest {
    pub(in crate::game) fn load(resources_dir: &Path) -> Result<Self, GameError> {
        let path = resources_dir.join("save_content_manifest.json");
        let source = std::fs::read_to_string(&path).map_err(|error| {
            GameError::content_manifest_load_failed(
                &path,
                format!("could not read content manifest resource: {error}"),
            )
        })?;
        let envelope: ContentManifestVersionEnvelope =
            serde_json::from_str(&source).map_err(|error| {
                GameError::content_manifest_load_failed(
                    &path,
                    format!("content manifest resource is malformed: {error}"),
                )
            })?;

        if envelope.manifest_version != CONTENT_MANIFEST_VERSION {
            return Err(GameError::unsupported_content_manifest_version(
                &path,
                envelope.manifest_version,
            ));
        }

        let manifest: Self = serde_json::from_str(&source).map_err(|error| {
            GameError::content_manifest_load_failed(
                &path,
                format!("content manifest resource is malformed: {error}"),
            )
        })?;

        manifest.validate(&path)?;
        Ok(manifest)
    }

    #[allow(dead_code)] // Task 7's crate-private save adapters consume this before HPA-129 lands.
    pub(in crate::game) fn content_revision(&self) -> &str {
        &self.content_revision
    }

    #[cfg(test)]
    pub(in crate::game) fn for_test() -> Self {
        Self {
            manifest_version: CONTENT_MANIFEST_VERSION,
            content_revision:
                "sha256:0000000000000000000000000000000000000000000000000000000000000000".into(),
        }
    }

    fn validate(&self, path: &Path) -> Result<(), GameError> {
        if self.manifest_version != CONTENT_MANIFEST_VERSION {
            return Err(GameError::unsupported_content_manifest_version(
                path,
                self.manifest_version,
            ));
        }

        let digest = self
            .content_revision
            .strip_prefix("sha256:")
            .ok_or_else(|| {
                GameError::content_manifest_validation_failed(
                    path,
                    "contentRevision must use the sha256: prefix.".into(),
                )
            })?;

        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (byte.is_ascii_lowercase() && byte <= b'f'))
        {
            return Err(GameError::content_manifest_validation_failed(
                path,
                "contentRevision must contain exactly 64 lowercase hexadecimal characters after sha256:."
                    .into(),
            ));
        }

        Ok(())
    }
}
