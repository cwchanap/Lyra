#![allow(dead_code)] // Task 7/10 wire these crate-private primitives into the save coordinator.

use super::restore::{build_restore_candidate, CurrentDefinitions};
use super::schema::{
    canonical_uuid_v4, parse_current_envelope, validate_envelope, ReadableSaveMetadataView,
    SaveBrowserView, SaveDiscoveryStatusView, SaveEnvelopeV1, SaveMetadataView, SaveSlotRef,
    SaveSlotStatusView, SaveSlotView, SaveSummary, SaveType, ThumbnailAvailabilityView,
    ThumbnailDescriptorV1, ThumbnailUnavailableReason,
};
use super::thumbnail::{
    parse_png_header, validate_png_bytes_for_descriptor, ValidatedThumbnail, PNG_HEADER_BYTES,
};
use crate::game::GameError;
use atomic_write_file::AtomicWriteFile;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::Value;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

pub(crate) const PRODUCTION_APP_IDENTIFIER: &str = "com.chanwaichan.lyra";
pub(crate) const E2E_APP_IDENTIFIER: &str = "com.chanwaichan.lyra.e2e";
const E2E_APP_DATA_ENV: &str = "LYRA_E2E_APP_DATA_DIR";

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ManualSlotExpectation {
    Empty,
    Occupied {
        observation: OccupiedSlotExpectation,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OccupiedSlotExpectation {
    pub(crate) save_id: Option<String>,
    pub(crate) modified_at: Option<String>,
}

pub(crate) enum ThumbnailWrite {
    Available(ValidatedThumbnail),
    Unavailable,
}

pub(crate) struct SlotWriteRequest {
    pub(crate) reference: SaveSlotRef,
    pub(crate) envelope: SaveEnvelopeV1,
    pub(crate) thumbnail: ThumbnailWrite,
    pub(crate) expected_manual: Option<ManualSlotExpectation>,
}

#[derive(Debug)]
pub(crate) struct SlotWriteOutcome {
    pub(crate) committed_envelope: SaveEnvelopeV1,
    pub(crate) cleanup_diagnostic: Option<GameError>,
}

#[derive(Debug)]
pub(crate) struct SlotDeleteOutcome {
    pub(crate) cleanup_diagnostic: Option<GameError>,
}

pub(crate) struct PreparedSlotWrite {
    pub(crate) reference: SaveSlotRef,
    pub(crate) available_envelope: Option<SaveEnvelopeV1>,
    pub(crate) unavailable_envelope: SaveEnvelopeV1,
    pub(crate) expected_manual: Option<ManualSlotExpectation>,
    staged_thumbnail: Option<Box<dyn StagedAtomicWrite>>,
    staged_available_envelope: Option<Box<dyn StagedAtomicWrite>>,
    staged_unavailable_envelope: Option<Box<dyn StagedAtomicWrite>>,
}

pub(crate) struct SaveFileMetadata {
    pub(crate) modified_at: SystemTime,
    pub(crate) byte_length: u64,
}

pub(crate) struct SaveDiscoveryContext {
    pub(crate) resources_dir: PathBuf,
    pub(crate) definitions: Arc<CurrentDefinitions>,
}

const ALL_SLOT_REFS: [SaveSlotRef; 8] = [
    SaveSlotRef::Auto { slot: 1 },
    SaveSlotRef::Auto { slot: 2 },
    SaveSlotRef::Auto { slot: 3 },
    SaveSlotRef::Auto { slot: 4 },
    SaveSlotRef::Auto { slot: 5 },
    SaveSlotRef::Manual { slot: 1 },
    SaveSlotRef::Manual { slot: 2 },
    SaveSlotRef::Manual { slot: 3 },
];

pub(crate) trait SaveFilesystem: Send + Sync {
    fn create_dir_all(&self, path: &Path) -> io::Result<()>;
    fn read(&self, path: &Path) -> io::Result<Vec<u8>>;
    fn read_prefix(&self, path: &Path, limit: usize) -> io::Result<Vec<u8>>;
    fn metadata(&self, path: &Path) -> io::Result<SaveFileMetadata>;
    fn list_dir(&self, path: &Path) -> io::Result<Vec<PathBuf>>;
    fn stage_atomic(&self, path: &Path, bytes: &[u8]) -> io::Result<Box<dyn StagedAtomicWrite>>;
    fn remove_file(&self, path: &Path) -> io::Result<()>;
    fn sync_dir(&self, path: &Path) -> io::Result<()>;
}

pub(crate) trait StagedAtomicWrite: Send {
    fn install(self: Box<Self>) -> io::Result<()>;
    fn discard(self: Box<Self>) -> io::Result<()>;
}

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct ProductionSaveFilesystem;

struct ProductionStagedAtomicWrite(AtomicWriteFile);

impl SaveFilesystem for ProductionSaveFilesystem {
    fn create_dir_all(&self, path: &Path) -> io::Result<()> {
        fs::create_dir_all(path)
    }

    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        fs::read(path)
    }

    fn read_prefix(&self, path: &Path, limit: usize) -> io::Result<Vec<u8>> {
        let file = File::open(path)?;
        let mut bytes = Vec::with_capacity(limit);
        file.take(limit as u64).read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    fn metadata(&self, path: &Path) -> io::Result<SaveFileMetadata> {
        let metadata = fs::metadata(path)?;
        Ok(SaveFileMetadata {
            modified_at: metadata.modified()?,
            byte_length: metadata.len(),
        })
    }

    fn list_dir(&self, path: &Path) -> io::Result<Vec<PathBuf>> {
        fs::read_dir(path)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect()
    }

    fn stage_atomic(&self, path: &Path, bytes: &[u8]) -> io::Result<Box<dyn StagedAtomicWrite>> {
        let mut file = AtomicWriteFile::open(path)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_data()?;
        Ok(Box::new(ProductionStagedAtomicWrite(file)))
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }

    fn sync_dir(&self, path: &Path) -> io::Result<()> {
        sync_directory(path)
    }
}

impl StagedAtomicWrite for ProductionStagedAtomicWrite {
    fn install(self: Box<Self>) -> io::Result<()> {
        self.0.commit()
    }

    fn discard(self: Box<Self>) -> io::Result<()> {
        self.0.discard()
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(windows)]
fn sync_directory(path: &Path) -> io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;

    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

    let directory = fs::OpenOptions::new()
        .access_mode(GENERIC_WRITE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    directory.sync_all()
}

#[cfg(not(any(unix, windows)))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "directory synchronization is unsupported on this platform",
    ))
}

pub(crate) fn resolve_save_root(
    configured_app_data: &Path,
    production_app_data: &Path,
    app_identifier: &str,
) -> Result<PathBuf, GameError> {
    #[cfg(feature = "e2e")]
    {
        let _ = configured_app_data;
        let override_root = std::env::var_os(E2E_APP_DATA_ENV).map(PathBuf::from);
        validate_e2e_app_data_root(
            override_root.as_deref(),
            production_app_data,
            app_identifier,
        )
    }
    #[cfg(not(feature = "e2e"))]
    {
        let _ = (production_app_data, app_identifier, E2E_APP_DATA_ENV);
        Ok(configured_app_data.join("saves"))
    }
}

fn validate_e2e_app_data_root(
    override_root: Option<&Path>,
    production_app_data: &Path,
    app_identifier: &str,
) -> Result<PathBuf, GameError> {
    if app_identifier != E2E_APP_IDENTIFIER {
        return Err(GameError::unsafe_e2e_app_data_root());
    }
    let candidate = override_root.ok_or_else(GameError::unsafe_e2e_app_data_root)?;
    if !candidate.is_absolute() || !has_e2e_basename(candidate) {
        return Err(GameError::unsafe_e2e_app_data_root());
    }

    let candidate = candidate
        .canonicalize()
        .map_err(|_| GameError::unsafe_e2e_app_data_root())?;
    let temp_root = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| GameError::unsafe_e2e_app_data_root())?;
    let home = home_directory()
        .and_then(|path| path.canonicalize().ok())
        .ok_or_else(GameError::unsafe_e2e_app_data_root)?;
    let production = production_app_data.canonicalize().ok();

    if candidate == temp_root
        || candidate == home
        || production.as_ref().is_some_and(|path| path == &candidate)
        || !candidate.starts_with(&temp_root)
        || !has_e2e_basename(&candidate)
    {
        return Err(GameError::unsafe_e2e_app_data_root());
    }
    Ok(candidate.join("saves"))
}

fn has_e2e_basename(path: &Path) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.starts_with("lyra-hpa-392-"))
}

fn home_directory() -> Option<PathBuf> {
    #[cfg(windows)]
    let variable = "USERPROFILE";
    #[cfg(not(windows))]
    let variable = "HOME";
    std::env::var_os(variable).map(PathBuf::from)
}

pub(crate) fn ensure_save_layout(fs: &dyn SaveFilesystem, root: &Path) -> Result<(), GameError> {
    fs.create_dir_all(root)
        .map_err(|_| GameError::save_directory_unavailable())?;
    let thumbnails = thumbnail_directory(root);
    fs.create_dir_all(&thumbnails)
        .map_err(|_| GameError::save_directory_unavailable())?;
    let parent = root
        .parent()
        .ok_or_else(GameError::save_directory_unavailable)?;
    fs.sync_dir(parent)
        .map_err(|_| GameError::save_sync_failed())?;
    fs.sync_dir(root).map_err(|_| GameError::save_sync_failed())
}

pub(crate) fn discover_saves(
    fs: &dyn SaveFilesystem,
    root: &Path,
    context: &SaveDiscoveryContext,
) -> SaveBrowserView {
    if context.resources_dir != context.definitions.resources_dir || fs.list_dir(root).is_err() {
        return SaveBrowserView {
            discovery: SaveDiscoveryStatusView::Unavailable {
                diagnostic: GameError::save_discovery_unavailable(),
            },
            slots: Vec::new(),
        };
    }
    SaveBrowserView {
        discovery: SaveDiscoveryStatusView::Available,
        slots: ALL_SLOT_REFS
            .into_iter()
            .map(|reference| discover_slot(fs, root, context, reference))
            .collect(),
    }
}

pub(crate) fn select_autosave_target(slots: &[SaveSlotView]) -> Result<SaveSlotRef, GameError> {
    let mut autos = slots
        .iter()
        .filter(|slot| matches!(slot.reference, SaveSlotRef::Auto { .. }))
        .collect::<Vec<_>>();
    autos.sort_by_key(|slot| match slot.reference {
        SaveSlotRef::Auto { slot } => slot,
        SaveSlotRef::Manual { .. } => unreachable!("filtered autosaves"),
    });
    if let Some(empty) = autos
        .iter()
        .find(|slot| matches!(slot.status, SaveSlotStatusView::Empty))
    {
        return Ok(empty.reference);
    }
    autos
        .into_iter()
        .filter_map(|slot| {
            let SaveSlotRef::Auto { slot: number } = slot.reference else {
                return None;
            };
            slot.observed_modified_at
                .map(|modified_at| (modified_at, number, slot.reference))
        })
        .min_by_key(|(modified_at, number, _)| (*modified_at, *number))
        .map(|(_, _, reference)| reference)
        .ok_or_else(GameError::save_discovery_unavailable)
}

pub(crate) fn select_continue_candidate(slots: &[SaveSlotView]) -> Option<SaveSlotRef> {
    slots
        .iter()
        .filter(|slot| !matches!(slot.status, SaveSlotStatusView::Empty))
        .filter(|slot| slot.observed_modified_at.is_some())
        .max_by(|left, right| {
            left.observed_modified_at
                .cmp(&right.observed_modified_at)
                .then_with(|| left.observed_saved_at.cmp(&right.observed_saved_at))
                .then_with(|| slot_type_rank(left.reference).cmp(&slot_type_rank(right.reference)))
                .then_with(|| slot_number(left.reference).cmp(&slot_number(right.reference)))
        })
        .map(|slot| slot.reference)
}

pub(crate) fn read_save_thumbnail(
    fs: &dyn SaveFilesystem,
    root: &Path,
    reference: SaveSlotRef,
    observed_save_id: &str,
) -> Result<Vec<u8>, GameError> {
    canonical_uuid_v4(observed_save_id).map_err(|_| GameError::stale_save_selection())?;
    let path = slot_path(root, reference)?;
    let envelope_bytes = fs
        .read(&path)
        .map_err(|_| GameError::stale_save_selection())?;
    let envelope =
        parse_current_envelope(&envelope_bytes).map_err(|_| GameError::thumbnail_corrupt())?;
    if !slot_agrees_with_envelope(reference, &envelope) || envelope.save_id != observed_save_id {
        return Err(GameError::stale_save_selection());
    }
    let ThumbnailDescriptorV1::Available { object_id, .. } = &envelope.thumbnail else {
        return Err(GameError::thumbnail_missing());
    };
    if object_id != observed_save_id || canonical_uuid_v4(object_id).is_err() {
        return Err(GameError::thumbnail_corrupt());
    }
    let thumbnail_path =
        thumbnail_path(root, observed_save_id).map_err(|_| GameError::thumbnail_corrupt())?;
    let bytes = match fs.read_prefix(&thumbnail_path, super::schema::MAX_THUMBNAIL_BYTES + 1) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(GameError::thumbnail_missing());
        }
        Err(_) => return Err(GameError::thumbnail_read_failed()),
    };
    if bytes.len() > super::schema::MAX_THUMBNAIL_BYTES {
        return Err(GameError::thumbnail_corrupt());
    }
    validate_png_bytes_for_descriptor(observed_save_id, &bytes, &envelope.thumbnail)
        .map_err(|_| GameError::thumbnail_corrupt())?;
    Ok(bytes)
}

/// The caller owns the persistence writer turn for the full duration of this
/// rescan and cleanup. Task 8 supplies that serialization boundary.
pub(crate) fn clean_orphaned_save_files(
    fs: &dyn SaveFilesystem,
    root: &Path,
) -> Result<(), GameError> {
    let mut referenced_sidecars = std::collections::BTreeSet::new();
    for reference in ALL_SLOT_REFS {
        let path = slot_path(root, reference).expect("fixed slot references are valid");
        match fs.read(&path) {
            Ok(bytes) => {
                if let Some(sidecar) = possible_sidecar_from_slot(root, &bytes) {
                    referenced_sidecars.insert(sidecar);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(GameError::save_read_failed()),
        }
    }

    let root_entries = fs
        .list_dir(root)
        .map_err(|_| GameError::save_read_failed())?;
    let thumbnails = thumbnail_directory(root);
    let thumbnail_entries = fs
        .list_dir(&thumbnails)
        .map_err(|_| GameError::save_read_failed())?;

    let mut root_changed = false;
    for path in root_entries {
        if is_owned_slot_temporary(&path) {
            fs.remove_file(&path)
                .map_err(|_| GameError::save_write_failed())?;
            root_changed = true;
        }
    }
    let mut thumbnails_changed = false;
    for path in thumbnail_entries {
        let remove = is_owned_thumbnail_temporary(&path)
            || (is_canonical_thumbnail_path(&path) && !referenced_sidecars.contains(&path));
        if remove {
            fs.remove_file(&path)
                .map_err(|_| GameError::save_write_failed())?;
            thumbnails_changed = true;
        }
    }
    if root_changed {
        fs.sync_dir(root)
            .map_err(|_| GameError::save_sync_failed())?;
    }
    if thumbnails_changed {
        fs.sync_dir(&thumbnails)
            .map_err(|_| GameError::save_sync_failed())?;
    }
    Ok(())
}

fn possible_sidecar_from_slot(root: &Path, bytes: &[u8]) -> Option<PathBuf> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    let save_id = value.get("saveId")?.as_str()?;
    canonical_uuid_v4(save_id).ok()?;
    let thumbnail = value.get("thumbnail")?;
    if thumbnail.get("type")?.as_str()? != "available" {
        return None;
    }
    let object_id = thumbnail.get("objectId")?.as_str()?;
    (object_id == save_id).then_some(())?;
    thumbnail_path(root, save_id).ok()
}

fn is_owned_slot_temporary(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(OsStr::to_str) else {
        return false;
    };
    ALL_SLOT_REFS.into_iter().any(|reference| {
        slot_path(Path::new(""), reference)
            .ok()
            .and_then(|path| path.file_name().and_then(OsStr::to_str).map(str::to_owned))
            .is_some_and(|final_name| is_atomic_temporary_name(name, &final_name))
    })
}

fn is_owned_thumbnail_temporary(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(OsStr::to_str) else {
        return false;
    };
    let Some((base, suffix)) = name.rsplit_once('.') else {
        return false;
    };
    if suffix.len() != 6 || !suffix.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return false;
    }
    let Some(final_name) = base.strip_prefix('.') else {
        return false;
    };
    let candidate = Path::new(final_name);
    is_canonical_thumbnail_path(candidate)
}

fn is_atomic_temporary_name(name: &str, final_name: &str) -> bool {
    let Some(suffix) = name.strip_prefix(&format!(".{final_name}.")) else {
        return false;
    };
    suffix.len() == 6 && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn is_canonical_thumbnail_path(path: &Path) -> bool {
    if path.extension().and_then(OsStr::to_str) != Some("png") {
        return false;
    }
    path.file_stem()
        .and_then(OsStr::to_str)
        .is_some_and(|stem| canonical_uuid_v4(stem).is_ok())
}

fn slot_type_rank(reference: SaveSlotRef) -> u8 {
    match reference {
        SaveSlotRef::Auto { .. } => 0,
        SaveSlotRef::Manual { .. } => 1,
    }
}

fn slot_number(reference: SaveSlotRef) -> u8 {
    match reference {
        SaveSlotRef::Auto { slot } | SaveSlotRef::Manual { slot } => slot,
    }
}

fn discover_slot(
    fs: &dyn SaveFilesystem,
    root: &Path,
    context: &SaveDiscoveryContext,
    reference: SaveSlotRef,
) -> SaveSlotView {
    let path = slot_path(root, reference).expect("fixed slot references are valid");
    let metadata = match fs.metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return SaveSlotView {
                reference,
                modified_at: None,
                status: SaveSlotStatusView::Empty,
                observed_modified_at: None,
                observed_saved_at: None,
            };
        }
        Err(_) => {
            return invalid_slot(reference, None, None, None, GameError::save_read_failed());
        }
    };
    let modified_at = Some(format_modified_at(metadata.modified_at));
    let bytes = match fs.read(&path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return invalid_slot(
                reference,
                modified_at,
                Some(metadata.modified_at),
                None,
                GameError::save_read_failed(),
            );
        }
    };
    let observed_saved_at = independently_valid_saved_at(&bytes);
    let envelope = match parse_current_envelope(&bytes) {
        Ok(envelope) => envelope,
        Err(error) => {
            let readable = readable_metadata(fs, root, &bytes);
            return invalid_slot(
                reference,
                modified_at,
                Some(metadata.modified_at),
                observed_saved_at,
                error,
            )
            .with_readable_metadata(readable);
        }
    };
    if !slot_agrees_with_envelope(reference, &envelope) {
        let readable = readable_metadata(fs, root, &bytes);
        return invalid_slot(
            reference,
            modified_at,
            Some(metadata.modified_at),
            observed_saved_at,
            GameError::save_slot_mismatch(),
        )
        .with_readable_metadata(readable);
    }
    if let Err(error) = build_restore_candidate(
        context.resources_dir.clone(),
        &context.definitions,
        envelope.clone(),
    ) {
        let readable = readable_metadata(fs, root, &bytes);
        return invalid_slot(
            reference,
            modified_at,
            Some(metadata.modified_at),
            observed_saved_at,
            error,
        )
        .with_readable_metadata(readable);
    }
    let thumbnail = thumbnail_availability(fs, root, &envelope.save_id, &envelope.thumbnail);
    SaveSlotView {
        reference,
        modified_at,
        observed_modified_at: Some(metadata.modified_at),
        observed_saved_at,
        status: SaveSlotStatusView::Valid {
            metadata: SaveMetadataView {
                save_id: envelope.save_id,
                save_type: envelope.save_type,
                schema_version: envelope.schema_version,
                content_revision: envelope.content_revision,
                saved_at: envelope.saved_at,
                display_name: envelope.display_name,
                thumbnail,
                summary: envelope.summary,
            },
        },
    }
}

trait InvalidSlotMetadata {
    fn with_readable_metadata(self, metadata: Option<ReadableSaveMetadataView>) -> Self;
}

impl InvalidSlotMetadata for SaveSlotView {
    fn with_readable_metadata(mut self, metadata: Option<ReadableSaveMetadataView>) -> Self {
        if let SaveSlotStatusView::Invalid {
            metadata: current, ..
        } = &mut self.status
        {
            *current = metadata;
        }
        self
    }
}

fn invalid_slot(
    reference: SaveSlotRef,
    modified_at: Option<String>,
    observed_modified_at: Option<SystemTime>,
    observed_saved_at: Option<DateTime<chrono::FixedOffset>>,
    diagnostic: GameError,
) -> SaveSlotView {
    SaveSlotView {
        reference,
        modified_at,
        status: SaveSlotStatusView::Invalid {
            metadata: None,
            diagnostic,
        },
        observed_modified_at,
        observed_saved_at,
    }
}

fn readable_metadata(
    fs: &dyn SaveFilesystem,
    root: &Path,
    bytes: &[u8],
) -> Option<ReadableSaveMetadataView> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    let object = value.as_object()?;
    let save_id = object
        .get("saveId")
        .and_then(Value::as_str)
        .filter(|id| canonical_uuid_v4(id).is_ok())
        .map(str::to_owned);
    let saved_at = object
        .get("savedAt")
        .and_then(Value::as_str)
        .filter(|value| valid_utc_timestamp(value))
        .map(str::to_owned);
    let display_name = object
        .get("displayName")
        .and_then(Value::as_str)
        .and_then(|value| super::schema::validate_manual_display_name(value).ok());
    let summary = object
        .get("summary")
        .and_then(|value| serde_json::from_value::<SaveSummary>(value.clone()).ok());
    let descriptor = object
        .get("thumbnail")
        .and_then(|value| serde_json::from_value::<ThumbnailDescriptorV1>(value.clone()).ok());
    let thumbnail = match (save_id.as_deref(), descriptor.as_ref()) {
        (Some(save_id), Some(descriptor)) => thumbnail_availability(fs, root, save_id, descriptor),
        _ => ThumbnailAvailabilityView::Unavailable {
            reason: ThumbnailUnavailableReason::Corrupt,
        },
    };
    Some(ReadableSaveMetadataView {
        save_id,
        saved_at,
        display_name,
        thumbnail,
        summary,
    })
}

fn independently_valid_saved_at(bytes: &[u8]) -> Option<DateTime<chrono::FixedOffset>> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    let saved_at = value.get("savedAt")?.as_str()?;
    let parsed = DateTime::parse_from_rfc3339(saved_at).ok()?;
    (parsed.offset().local_minus_utc() == 0).then_some(parsed)
}

fn valid_utc_timestamp(value: &str) -> bool {
    DateTime::parse_from_rfc3339(value).is_ok_and(|parsed| parsed.offset().local_minus_utc() == 0)
}

fn slot_agrees_with_envelope(reference: SaveSlotRef, envelope: &SaveEnvelopeV1) -> bool {
    matches!(
        (reference, envelope.save_type),
        (SaveSlotRef::Auto { slot }, SaveType::Auto) if slot == envelope.slot
    ) || matches!(
        (reference, envelope.save_type),
        (SaveSlotRef::Manual { slot }, SaveType::Manual) if slot == envelope.slot
    )
}

fn thumbnail_availability(
    fs: &dyn SaveFilesystem,
    root: &Path,
    save_id: &str,
    descriptor: &ThumbnailDescriptorV1,
) -> ThumbnailAvailabilityView {
    let ThumbnailDescriptorV1::Available {
        width,
        height,
        byte_length,
        ..
    } = descriptor
    else {
        return ThumbnailAvailabilityView::Unavailable {
            reason: ThumbnailUnavailableReason::CaptureUnavailable,
        };
    };
    if super::thumbnail::validate_descriptor(save_id, descriptor).is_err() {
        return ThumbnailAvailabilityView::Unavailable {
            reason: ThumbnailUnavailableReason::Corrupt,
        };
    }
    let path = match thumbnail_path(root, save_id) {
        Ok(path) => path,
        Err(_) => {
            return ThumbnailAvailabilityView::Unavailable {
                reason: ThumbnailUnavailableReason::Corrupt,
            };
        }
    };
    match fs.metadata(&path) {
        Ok(metadata) if metadata.byte_length != u64::from(*byte_length) => {
            return ThumbnailAvailabilityView::Unavailable {
                reason: ThumbnailUnavailableReason::Corrupt,
            };
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return ThumbnailAvailabilityView::Unavailable {
                reason: ThumbnailUnavailableReason::Missing,
            };
        }
        Err(_) => {
            return ThumbnailAvailabilityView::Unavailable {
                reason: ThumbnailUnavailableReason::ReadFailed,
            };
        }
    }
    let header = match fs.read_prefix(&path, PNG_HEADER_BYTES) {
        Ok(header) => header,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return ThumbnailAvailabilityView::Unavailable {
                reason: ThumbnailUnavailableReason::Missing,
            };
        }
        Err(_) => {
            return ThumbnailAvailabilityView::Unavailable {
                reason: ThumbnailUnavailableReason::ReadFailed,
            };
        }
    };
    match parse_png_header(&header) {
        Ok((actual_width, actual_height)) if actual_width == *width && actual_height == *height => {
            ThumbnailAvailabilityView::Available {
                width: *width,
                height: *height,
            }
        }
        _ => ThumbnailAvailabilityView::Unavailable {
            reason: ThumbnailUnavailableReason::Corrupt,
        },
    }
}

pub(crate) fn prepare_slot_write(
    fs: &dyn SaveFilesystem,
    root: &Path,
    request: SlotWriteRequest,
) -> Result<PreparedSlotWrite, GameError> {
    let slot_path = validate_request_and_slot_path(root, &request)?;
    let mut unavailable_envelope = request.envelope;
    unavailable_envelope.thumbnail = ThumbnailDescriptorV1::Unavailable;
    validate_envelope(&unavailable_envelope)?;

    let (available_envelope, thumbnail_bytes) = match request.thumbnail {
        ThumbnailWrite::Available(thumbnail) => {
            thumbnail.validate_for(&unavailable_envelope.save_id)?;
            let mut available = unavailable_envelope.clone();
            available.thumbnail = thumbnail.descriptor;
            validate_envelope(&available)?;
            (Some(available), Some(thumbnail.bytes))
        }
        ThumbnailWrite::Unavailable => (None, None),
    };
    let unavailable_bytes = serialize_envelope(&unavailable_envelope)?;
    let available_bytes = available_envelope
        .as_ref()
        .map(serialize_envelope)
        .transpose()?;

    let staged_thumbnail = match thumbnail_bytes {
        Some(bytes) => fs
            .stage_atomic(
                &thumbnail_path(root, &unavailable_envelope.save_id)?,
                &bytes,
            )
            .ok(),
        None => None,
    };

    let staged_available_envelope = match available_bytes {
        Some(bytes) => fs.stage_atomic(&slot_path, &bytes).ok(),
        None => None,
    };

    let staged_unavailable_envelope = match fs.stage_atomic(&slot_path, &unavailable_bytes) {
        Ok(staged) => staged,
        Err(_) => {
            discard_ignoring_error(staged_thumbnail);
            discard_ignoring_error(staged_available_envelope);
            return Err(GameError::save_write_failed());
        }
    };

    let can_commit_available = staged_thumbnail.is_some() && staged_available_envelope.is_some();
    Ok(PreparedSlotWrite {
        reference: request.reference,
        available_envelope: if can_commit_available {
            available_envelope
        } else {
            None
        },
        unavailable_envelope,
        expected_manual: request.expected_manual,
        staged_thumbnail,
        staged_available_envelope,
        staged_unavailable_envelope: Some(staged_unavailable_envelope),
    })
}

pub(crate) fn commit_prepared_slot_write(
    fs: &dyn SaveFilesystem,
    root: &Path,
    mut prepared: PreparedSlotWrite,
) -> Result<SlotWriteOutcome, GameError> {
    let slot_path = slot_path(root, prepared.reference)?;
    let thumbnails = thumbnail_directory(root);
    let mut cleanup_diagnostic = None;
    let prior_bytes = match read_optional(fs, &slot_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = discard_prepared_slot_write(prepared);
            return Err(error);
        }
    };
    if prior_bytes
        .as_deref()
        .and_then(safely_canonical_save_id)
        .is_some_and(|id| id.hyphenated().to_string() == prepared.unavailable_envelope.save_id)
    {
        let _ = discard_prepared_slot_write(prepared);
        return Err(GameError::invalid_save_checkpoint_id());
    }

    let thumbnail_is_durable = match prepared.staged_thumbnail.take() {
        Some(staged) if prepared.available_envelope.is_some() => {
            staged.install().is_ok() && fs.sync_dir(&thumbnails).is_ok()
        }
        Some(staged) => {
            if staged.discard().is_err() {
                cleanup_diagnostic = Some(GameError::save_write_failed());
            }
            false
        }
        None => false,
    };
    let commit_available = thumbnail_is_durable
        && prepared.available_envelope.is_some()
        && prepared.staged_available_envelope.is_some();

    let (committed_envelope, staged_envelope, unselected) = if commit_available {
        (
            prepared
                .available_envelope
                .take()
                .expect("checked available envelope"),
            prepared
                .staged_available_envelope
                .take()
                .expect("checked available staged write"),
            prepared.staged_unavailable_envelope.take(),
        )
    } else {
        (
            prepared.unavailable_envelope.clone(),
            prepared
                .staged_unavailable_envelope
                .take()
                .expect("prepare always stages unavailable envelope"),
            prepared.staged_available_envelope.take(),
        )
    };
    if let Some(unselected) = unselected {
        if unselected.discard().is_err() && cleanup_diagnostic.is_none() {
            cleanup_diagnostic = Some(GameError::save_write_failed());
        }
    }

    let current_bytes_result = match prepared.reference {
        SaveSlotRef::Manual { .. } => match_manual_expectation(
            fs,
            &slot_path,
            prepared.expected_manual.as_ref(),
            GameError::stale_manual_overwrite_confirmation,
        ),
        SaveSlotRef::Auto { .. } => read_optional(fs, &slot_path),
    };
    let current_bytes = match current_bytes_result {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = staged_envelope.discard();
            return Err(error);
        }
    };
    let old_sidecar = current_bytes
        .as_deref()
        .and_then(|bytes| validated_sidecar_from_slot(root, prepared.reference, bytes));

    staged_envelope
        .install()
        .map_err(|_| GameError::save_replace_failed())?;
    fs.sync_dir(root)
        .map_err(|_| GameError::save_sync_failed())?;

    let committed_sidecar = descriptor_sidecar(root, &committed_envelope.thumbnail);
    if old_sidecar.as_ref() != committed_sidecar.as_ref() {
        if let Some(old_sidecar) = old_sidecar {
            if let Some(diagnostic) = cleanup_sidecar(fs, &thumbnails, &old_sidecar) {
                if cleanup_diagnostic.is_none() {
                    cleanup_diagnostic = Some(diagnostic);
                }
            }
        }
    }

    Ok(SlotWriteOutcome {
        committed_envelope,
        cleanup_diagnostic,
    })
}

pub(crate) fn discard_prepared_slot_write(
    mut prepared: PreparedSlotWrite,
) -> Result<(), GameError> {
    let mut failed = false;
    for staged in [
        prepared.staged_thumbnail.take(),
        prepared.staged_available_envelope.take(),
        prepared.staged_unavailable_envelope.take(),
    ]
    .into_iter()
    .flatten()
    {
        failed |= staged.discard().is_err();
    }
    if failed {
        Err(GameError::save_write_failed())
    } else {
        Ok(())
    }
}

pub(crate) fn delete_slot(
    fs: &dyn SaveFilesystem,
    root: &Path,
    reference: SaveSlotRef,
    observation: OccupiedSlotExpectation,
) -> Result<SlotDeleteOutcome, GameError> {
    let path = slot_path(root, reference)?;
    let bytes =
        match_occupied_observation(fs, &path, &observation, GameError::stale_save_selection)?;
    let old_sidecar = validated_sidecar_from_slot(root, reference, &bytes);

    fs.remove_file(&path)
        .map_err(|_| GameError::save_write_failed())?;
    fs.sync_dir(root)
        .map_err(|_| GameError::save_sync_failed())?;

    let cleanup_diagnostic = old_sidecar
        .as_ref()
        .and_then(|path| cleanup_sidecar(fs, &thumbnail_directory(root), path));
    Ok(SlotDeleteOutcome { cleanup_diagnostic })
}

fn validate_request_and_slot_path(
    root: &Path,
    request: &SlotWriteRequest,
) -> Result<PathBuf, GameError> {
    let path = slot_path(root, request.reference)?;
    let matches = matches!(
        (request.reference, request.envelope.save_type),
        (SaveSlotRef::Auto { slot }, SaveType::Auto) if slot == request.envelope.slot
    ) || matches!(
        (request.reference, request.envelope.save_type),
        (SaveSlotRef::Manual { slot }, SaveType::Manual) if slot == request.envelope.slot
    );
    if !matches {
        return Err(GameError::save_slot_mismatch());
    }
    validate_envelope(&request.envelope)?;
    Ok(path)
}

fn slot_path(root: &Path, reference: SaveSlotRef) -> Result<PathBuf, GameError> {
    let filename = match reference {
        SaveSlotRef::Auto { slot } if (1..=5).contains(&slot) => {
            format!("autosave-{slot}.json")
        }
        SaveSlotRef::Manual { slot } if (1..=3).contains(&slot) => {
            format!("manual-{slot}.json")
        }
        _ => return Err(GameError::save_slot_mismatch()),
    };
    Ok(root.join(filename))
}

fn thumbnail_directory(root: &Path) -> PathBuf {
    root.join("thumbnails")
}

fn thumbnail_path(root: &Path, save_id: &str) -> Result<PathBuf, GameError> {
    let id = canonical_uuid_v4(save_id)?;
    Ok(thumbnail_directory(root).join(format!("{}.png", id.hyphenated())))
}

fn descriptor_sidecar(root: &Path, descriptor: &ThumbnailDescriptorV1) -> Option<PathBuf> {
    match descriptor {
        ThumbnailDescriptorV1::Available { object_id, .. } => thumbnail_path(root, object_id).ok(),
        ThumbnailDescriptorV1::Unavailable => None,
    }
}

fn serialize_envelope(envelope: &SaveEnvelopeV1) -> Result<Vec<u8>, GameError> {
    let mut bytes = serde_json::to_vec(envelope).map_err(|_| GameError::save_write_failed())?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn read_optional(fs: &dyn SaveFilesystem, path: &Path) -> Result<Option<Vec<u8>>, GameError> {
    match fs.read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(GameError::save_read_failed()),
    }
}

fn match_manual_expectation(
    fs: &dyn SaveFilesystem,
    path: &Path,
    expectation: Option<&ManualSlotExpectation>,
    stale: fn() -> GameError,
) -> Result<Option<Vec<u8>>, GameError> {
    match expectation {
        Some(ManualSlotExpectation::Empty) => {
            if read_optional(fs, path)?.is_none() {
                Ok(None)
            } else {
                Err(stale())
            }
        }
        Some(ManualSlotExpectation::Occupied { observation }) => {
            match_occupied_observation(fs, path, observation, stale).map(Some)
        }
        None => Err(stale()),
    }
}

fn match_occupied_observation(
    fs: &dyn SaveFilesystem,
    path: &Path,
    observation: &OccupiedSlotExpectation,
    stale: fn() -> GameError,
) -> Result<Vec<u8>, GameError> {
    let bytes = read_optional(fs, path)?.ok_or_else(stale)?;
    let current_id = safely_canonical_save_id(&bytes);
    match observation.save_id.as_deref() {
        Some(expected) => {
            let expected = canonical_uuid_v4(expected).map_err(|_| stale())?;
            if current_id.as_ref() != Some(&expected) {
                return Err(stale());
            }
        }
        None => {
            if current_id.is_some() {
                return Err(stale());
            }
            let expected_modified = observation.modified_at.as_deref().ok_or_else(stale)?;
            let metadata = fs
                .metadata(path)
                .map_err(|_| GameError::save_read_failed())?;
            if format_modified_at(metadata.modified_at) != expected_modified {
                return Err(stale());
            }
        }
    }
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveIdProbe {
    save_id: String,
}

fn safely_canonical_save_id(bytes: &[u8]) -> Option<uuid::Uuid> {
    let probe = serde_json::from_slice::<SaveIdProbe>(bytes).ok()?;
    canonical_uuid_v4(&probe.save_id).ok()
}

fn format_modified_at(modified_at: SystemTime) -> String {
    DateTime::<Utc>::from(modified_at).to_rfc3339_opts(SecondsFormat::Nanos, true)
}

fn validated_sidecar_from_slot(
    root: &Path,
    reference: SaveSlotRef,
    bytes: &[u8],
) -> Option<PathBuf> {
    let envelope = parse_current_envelope(bytes).ok()?;
    let agrees = matches!(
        (reference, envelope.save_type),
        (SaveSlotRef::Auto { slot }, SaveType::Auto) if slot == envelope.slot
    ) || matches!(
        (reference, envelope.save_type),
        (SaveSlotRef::Manual { slot }, SaveType::Manual) if slot == envelope.slot
    );
    agrees
        .then(|| descriptor_sidecar(root, &envelope.thumbnail))
        .flatten()
}

fn cleanup_sidecar(fs: &dyn SaveFilesystem, thumbnails: &Path, path: &Path) -> Option<GameError> {
    match fs.remove_file(path) {
        Ok(()) => fs
            .sync_dir(thumbnails)
            .err()
            .map(|_| GameError::save_sync_failed()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(_) => Some(GameError::save_write_failed()),
    }
}

fn discard_ignoring_error(staged: Option<Box<dyn StagedAtomicWrite>>) {
    if let Some(staged) = staged {
        let _ = staged.discard();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::save::schema::{SaveEnvelopeV1, SaveSlotRef, SaveType, ThumbnailDescriptorV1};
    use crate::game::save::thumbnail::ValidatedThumbnail;
    use crate::game::test_support::representative_save_envelope;
    use std::collections::{BTreeMap, BTreeSet};
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    const OLD_SAVE_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
    const NEW_SAVE_ID: &str = "67e55044-10b1-426f-9247-bb680e5fe0c8";
    const OTHER_SAVE_ID: &str = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const OBSERVED_MTIME: &str = "2023-11-14T22:13:20.000000000Z";

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum FaultMoment {
        Before,
        After,
    }

    #[derive(Debug, Clone, Copy)]
    struct Fault {
        event: &'static str,
        moment: FaultMoment,
    }

    #[derive(Clone)]
    struct FakeFilesystem {
        state: Arc<Mutex<FakeState>>,
    }

    struct FakeState {
        files: BTreeMap<PathBuf, FakeFile>,
        directories: BTreeSet<PathBuf>,
        staged: BTreeMap<u64, FakeStagedRecord>,
        events: Vec<String>,
        reads: Vec<(PathBuf, Option<usize>)>,
        read_failures: BTreeSet<PathBuf>,
        next_stage_id: u64,
        next_mtime_tick: u64,
        fault: Option<Fault>,
    }

    #[derive(Clone)]
    struct FakeFile {
        bytes: Vec<u8>,
        modified_at: SystemTime,
    }

    struct FakeStagedRecord {
        target: PathBuf,
        bytes: Vec<u8>,
        install_event: &'static str,
    }

    struct FakeStagedAtomicWrite {
        state: Arc<Mutex<FakeState>>,
        id: u64,
    }

    impl FakeFilesystem {
        fn new() -> Self {
            Self {
                state: Arc::new(Mutex::new(FakeState {
                    files: BTreeMap::new(),
                    directories: BTreeSet::new(),
                    staged: BTreeMap::new(),
                    events: Vec::new(),
                    reads: Vec::new(),
                    read_failures: BTreeSet::new(),
                    next_stage_id: 1,
                    next_mtime_tick: 1,
                    fault: None,
                })),
            }
        }

        fn put_file(&self, path: PathBuf, bytes: Vec<u8>, modified_at: SystemTime) {
            self.state
                .lock()
                .unwrap()
                .files
                .insert(path, FakeFile { bytes, modified_at });
        }

        fn set_fault(&self, fault: Fault) {
            self.state.lock().unwrap().fault = Some(fault);
        }

        fn bytes(&self, path: &Path) -> Option<Vec<u8>> {
            self.state
                .lock()
                .unwrap()
                .files
                .get(path)
                .map(|file| file.bytes.clone())
        }

        fn exists(&self, path: &Path) -> bool {
            self.state.lock().unwrap().files.contains_key(path)
        }

        fn events(&self) -> Vec<String> {
            self.state.lock().unwrap().events.clone()
        }

        fn staged_targets(&self) -> Vec<PathBuf> {
            self.state
                .lock()
                .unwrap()
                .staged
                .values()
                .map(|record| record.target.clone())
                .collect()
        }

        fn reads(&self) -> Vec<(PathBuf, Option<usize>)> {
            self.state.lock().unwrap().reads.clone()
        }

        fn fail_reads_for(&self, path: PathBuf) {
            self.state.lock().unwrap().read_failures.insert(path);
        }
    }

    fn fault_error(event: &str) -> io::Error {
        io::Error::other(format!("injected fault at {event}"))
    }

    fn begin_event(state: &mut FakeState, event: &'static str) -> io::Result<()> {
        state.events.push(event.into());
        if state
            .fault
            .is_some_and(|fault| fault.event == event && fault.moment == FaultMoment::Before)
        {
            return Err(fault_error(event));
        }
        Ok(())
    }

    fn finish_event(state: &FakeState, event: &'static str) -> io::Result<()> {
        if state
            .fault
            .is_some_and(|fault| fault.event == event && fault.moment == FaultMoment::After)
        {
            return Err(fault_error(event));
        }
        Ok(())
    }

    fn staged_kind(path: &Path, bytes: &[u8]) -> (&'static str, &'static str) {
        if path.extension().and_then(|value| value.to_str()) == Some("png") {
            return ("stagePng", "installPng");
        }
        let value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
        match value
            .pointer("/thumbnail/type")
            .and_then(|value| value.as_str())
        {
            Some("available") => ("stageAvailableEnvelope", "installEnvelope"),
            Some("unavailable") => ("stageUnavailableEnvelope", "installEnvelope"),
            other => panic!("unexpected staged JSON thumbnail: {other:?}"),
        }
    }

    impl SaveFilesystem for FakeFilesystem {
        fn create_dir_all(&self, path: &Path) -> io::Result<()> {
            let mut state = self.state.lock().unwrap();
            let event = if path.ends_with("thumbnails") {
                "createThumbnails"
            } else {
                "createSaves"
            };
            begin_event(&mut state, event)?;
            state.directories.insert(path.to_path_buf());
            finish_event(&state, event)
        }

        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            let mut state = self.state.lock().unwrap();
            state.reads.push((path.to_path_buf(), None));
            if state.read_failures.contains(path) {
                return Err(io::Error::other("injected read failure"));
            }
            state
                .files
                .get(path)
                .map(|file| file.bytes.clone())
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
        }

        fn read_prefix(&self, path: &Path, limit: usize) -> io::Result<Vec<u8>> {
            let mut state = self.state.lock().unwrap();
            state.reads.push((path.to_path_buf(), Some(limit)));
            if state.read_failures.contains(path) {
                return Err(io::Error::other("injected read failure"));
            }
            state
                .files
                .get(path)
                .map(|file| file.bytes[..file.bytes.len().min(limit)].to_vec())
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
        }

        fn metadata(&self, path: &Path) -> io::Result<SaveFileMetadata> {
            self.state
                .lock()
                .unwrap()
                .files
                .get(path)
                .map(|file| SaveFileMetadata {
                    modified_at: file.modified_at,
                    byte_length: file.bytes.len() as u64,
                })
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
        }

        fn list_dir(&self, path: &Path) -> io::Result<Vec<PathBuf>> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .files
                .keys()
                .filter(|entry| entry.parent() == Some(path))
                .cloned()
                .collect())
        }

        fn stage_atomic(
            &self,
            path: &Path,
            bytes: &[u8],
        ) -> io::Result<Box<dyn StagedAtomicWrite>> {
            let (stage_event, install_event) = staged_kind(path, bytes);
            let mut state = self.state.lock().unwrap();
            begin_event(&mut state, stage_event)?;
            let id = state.next_stage_id;
            state.next_stage_id += 1;
            state.staged.insert(
                id,
                FakeStagedRecord {
                    target: path.to_path_buf(),
                    bytes: bytes.to_vec(),
                    install_event,
                },
            );
            finish_event(&state, stage_event)?;
            Ok(Box::new(FakeStagedAtomicWrite {
                state: Arc::clone(&self.state),
                id,
            }))
        }

        fn remove_file(&self, path: &Path) -> io::Result<()> {
            let mut state = self.state.lock().unwrap();
            let event = if path.extension().and_then(|value| value.to_str()) == Some("png") {
                "removeOldThumbnail"
            } else {
                "removeSlot"
            };
            begin_event(&mut state, event)?;
            if state.files.remove(path).is_none() {
                return Err(io::Error::from(io::ErrorKind::NotFound));
            }
            finish_event(&state, event)
        }

        fn sync_dir(&self, path: &Path) -> io::Result<()> {
            let mut state = self.state.lock().unwrap();
            let event = if path.ends_with("thumbnails") {
                if state
                    .events
                    .last()
                    .is_some_and(|event| event == "removeOldThumbnail")
                {
                    "syncThumbnailCleanup"
                } else {
                    "syncNewThumbnail"
                }
            } else if path.ends_with("saves") {
                "syncSaves"
            } else {
                "syncAppData"
            };
            begin_event(&mut state, event)?;
            finish_event(&state, event)
        }
    }

    impl StagedAtomicWrite for FakeStagedAtomicWrite {
        fn install(self: Box<Self>) -> io::Result<()> {
            let mut state = self.state.lock().unwrap();
            let install_event = state.staged.get(&self.id).unwrap().install_event;
            begin_event(&mut state, install_event)?;
            let staged = state.staged.remove(&self.id).unwrap();
            let modified_at =
                UNIX_EPOCH + Duration::from_secs(1_700_000_000 + state.next_mtime_tick);
            state.next_mtime_tick += 1;
            state.files.insert(
                staged.target,
                FakeFile {
                    bytes: staged.bytes,
                    modified_at,
                },
            );
            finish_event(&state, install_event)
        }

        fn discard(self: Box<Self>) -> io::Result<()> {
            self.state.lock().unwrap().staged.remove(&self.id);
            Ok(())
        }
    }

    fn root() -> PathBuf {
        PathBuf::from("/virtual/app/saves")
    }

    fn slot_path(reference: SaveSlotRef) -> PathBuf {
        let filename = match reference {
            SaveSlotRef::Auto { slot } => format!("autosave-{slot}.json"),
            SaveSlotRef::Manual { slot } => format!("manual-{slot}.json"),
        };
        root().join(filename)
    }

    fn sidecar_path(save_id: &str) -> PathBuf {
        root().join("thumbnails").join(format!("{save_id}.png"))
    }

    fn envelope(save_id: &str, reference: SaveSlotRef) -> SaveEnvelopeV1 {
        let mut envelope = representative_save_envelope();
        envelope.save_id = save_id.into();
        match reference {
            SaveSlotRef::Auto { slot } => {
                envelope.save_type = SaveType::Auto;
                envelope.slot = slot;
            }
            SaveSlotRef::Manual { slot } => {
                envelope.save_type = SaveType::Manual;
                envelope.slot = slot;
            }
        }
        envelope.thumbnail = ThumbnailDescriptorV1::Unavailable;
        envelope
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes
    }

    fn thumbnail(save_id: &str) -> ValidatedThumbnail {
        ValidatedThumbnail::from_png(png(1, 1), save_id).unwrap()
    }

    fn old_envelope(reference: SaveSlotRef) -> SaveEnvelopeV1 {
        let mut old = envelope(OLD_SAVE_ID, reference);
        old.thumbnail = thumbnail(OLD_SAVE_ID).descriptor;
        old
    }

    fn occupied_fs(reference: SaveSlotRef) -> FakeFilesystem {
        let fs = FakeFilesystem::new();
        let old = old_envelope(reference);
        fs.put_file(
            slot_path(reference),
            serde_json::to_vec(&old).unwrap(),
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        );
        fs.put_file(
            sidecar_path(OLD_SAVE_ID),
            png(1, 1),
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        );
        fs
    }

    fn request(
        reference: SaveSlotRef,
        expected_manual: Option<ManualSlotExpectation>,
    ) -> SlotWriteRequest {
        SlotWriteRequest {
            reference,
            envelope: envelope(NEW_SAVE_ID, reference),
            thumbnail: ThumbnailWrite::Available(thumbnail(NEW_SAVE_ID)),
            expected_manual,
        }
    }

    fn committed_envelope(fs: &FakeFilesystem, reference: SaveSlotRef) -> SaveEnvelopeV1 {
        crate::game::save::schema::parse_current_envelope(&fs.bytes(&slot_path(reference)).unwrap())
            .unwrap()
    }

    #[test]
    fn ordinary_build_resolves_only_the_configured_app_data_save_root() {
        #[cfg(not(feature = "e2e"))]
        assert_eq!(
            resolve_save_root(
                Path::new("/configured/app-data"),
                Path::new("/production/app-data"),
                PRODUCTION_APP_IDENTIFIER,
            )
            .unwrap(),
            PathBuf::from("/configured/app-data/saves")
        );
    }

    #[test]
    fn e2e_guard_refuses_every_unsafe_root_before_any_mutation() {
        let allowed = tempfile::Builder::new()
            .prefix("lyra-hpa-392-")
            .tempdir_in(std::env::temp_dir())
            .unwrap();
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let production = allowed.path().to_path_buf();

        let temp_root = std::env::temp_dir();
        let cases = [
            (
                None,
                E2E_APP_IDENTIFIER,
                Path::new("/definitely/not/production"),
            ),
            (
                Some(Path::new("relative/lyra-hpa-392-test")),
                E2E_APP_IDENTIFIER,
                Path::new("/definitely/not/production"),
            ),
            (
                Some(home.as_path()),
                E2E_APP_IDENTIFIER,
                Path::new("/definitely/not/production"),
            ),
            (
                Some(allowed.path()),
                E2E_APP_IDENTIFIER,
                production.as_path(),
            ),
            (
                Some(allowed.path()),
                PRODUCTION_APP_IDENTIFIER,
                Path::new("/definitely/not/production"),
            ),
            (
                Some(temp_root.as_path()),
                E2E_APP_IDENTIFIER,
                Path::new("/definitely/not/production"),
            ),
        ];

        for (override_root, identifier, production_root) in cases {
            assert_eq!(
                validate_e2e_app_data_root(override_root, production_root, identifier)
                    .unwrap_err()
                    .code,
                "unsafeE2eAppDataRoot"
            );
        }

        assert!(allowed.path().exists());
        assert!(home.exists());
    }

    #[cfg(unix)]
    #[test]
    fn e2e_guard_rejects_a_prefixed_symlink_that_escapes_temp() {
        use std::os::unix::fs::symlink;

        let holder = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let link = holder.path().join("lyra-hpa-392-symlink");
        symlink(env!("CARGO_MANIFEST_DIR"), &link).unwrap();

        assert_eq!(
            validate_e2e_app_data_root(
                Some(&link),
                Path::new("/definitely/not/production"),
                E2E_APP_IDENTIFIER,
            )
            .unwrap_err()
            .code,
            "unsafeE2eAppDataRoot"
        );
        assert!(Path::new(env!("CARGO_MANIFEST_DIR")).exists());
    }

    #[cfg(unix)]
    #[test]
    fn e2e_guard_rejects_a_nonprefixed_symlink_to_an_otherwise_allowed_root() {
        use std::os::unix::fs::symlink;

        let allowed = tempfile::Builder::new()
            .prefix("lyra-hpa-392-")
            .tempdir_in(std::env::temp_dir())
            .unwrap();
        let holder = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let link = holder.path().join("not-a-test-root");
        symlink(allowed.path(), &link).unwrap();

        assert_eq!(
            validate_e2e_app_data_root(
                Some(&link),
                Path::new("/definitely/not/production"),
                E2E_APP_IDENTIFIER,
            )
            .unwrap_err()
            .code,
            "unsafeE2eAppDataRoot"
        );
    }

    #[test]
    fn e2e_guard_accepts_only_a_canonical_prefixed_directory_beneath_temp() {
        let allowed = tempfile::Builder::new()
            .prefix("lyra-hpa-392-")
            .tempdir_in(std::env::temp_dir())
            .unwrap();

        assert_eq!(
            validate_e2e_app_data_root(
                Some(allowed.path()),
                Path::new("/definitely/not/production"),
                E2E_APP_IDENTIFIER,
            )
            .unwrap(),
            allowed.path().canonicalize().unwrap().join("saves")
        );
    }

    #[test]
    fn ensure_layout_creates_and_syncs_only_the_fixed_directories() {
        let fs = FakeFilesystem::new();

        ensure_save_layout(&fs, &root()).unwrap();

        assert_eq!(
            fs.events(),
            vec![
                "createSaves",
                "createThumbnails",
                "syncAppData",
                "syncSaves",
            ]
        );
    }

    #[test]
    fn ensure_layout_surfaces_create_and_parent_sync_failures() {
        for (event, expected_code) in [
            ("createSaves", "saveDirectoryUnavailable"),
            ("createThumbnails", "saveDirectoryUnavailable"),
            ("syncAppData", "saveSyncFailed"),
            ("syncSaves", "saveSyncFailed"),
        ] {
            for moment in [FaultMoment::Before, FaultMoment::After] {
                let fs = FakeFilesystem::new();
                fs.set_fault(Fault { event, moment });
                assert_eq!(
                    ensure_save_layout(&fs, &root()).unwrap_err().code,
                    expected_code,
                    "{event} {moment:?}"
                );
            }
        }
    }

    #[test]
    fn fixed_paths_reject_slot_mismatch_and_foreign_thumbnail_identity_before_io() {
        let fs = FakeFilesystem::new();
        let reference = SaveSlotRef::Manual { slot: 1 };
        let mut mismatch = request(reference, None);
        mismatch.envelope.slot = 2;
        assert_eq!(
            prepare_slot_write(&fs, &root(), mismatch)
                .err()
                .unwrap()
                .code,
            "saveSlotMismatch"
        );

        let mut out_of_bounds = request(reference, None);
        out_of_bounds.reference = SaveSlotRef::Manual { slot: 4 };
        out_of_bounds.envelope.slot = 4;
        assert_eq!(
            prepare_slot_write(&fs, &root(), out_of_bounds)
                .err()
                .unwrap()
                .code,
            "saveSlotMismatch"
        );

        let mut foreign = request(reference, None);
        foreign.thumbnail = ThumbnailWrite::Available(thumbnail(OTHER_SAVE_ID));
        assert_eq!(
            prepare_slot_write(&fs, &root(), foreign)
                .err()
                .unwrap()
                .code,
            "thumbnailPngMalformed"
        );
        assert!(fs.events().is_empty());
    }

    #[test]
    fn write_paths_are_opaque_to_display_summary_and_snapshot_text() {
        let fs = FakeFilesystem::new();
        let reference = SaveSlotRef::Manual { slot: 1 };
        let mut malicious = request(reference, Some(ManualSlotExpectation::Empty));
        malicious.envelope.display_name = "../../../../escape.json".into();
        malicious.envelope.summary.chapter_title = "../thumbnails/escape.png".into();
        malicious.envelope.summary.scene_title = "/tmp/escape".into();

        let prepared = prepare_slot_write(&fs, &root(), malicious).unwrap();

        assert!(fs
            .staged_targets()
            .iter()
            .all(|path| path == &slot_path(reference) || path == &sidecar_path(NEW_SAVE_ID)));
        discard_prepared_slot_write(prepared).unwrap();
    }

    #[test]
    fn prepare_then_commit_obeys_the_durable_replacement_order() {
        let reference = SaveSlotRef::Auto { slot: 1 };
        let fs = occupied_fs(reference);

        let prepared = prepare_slot_write(&fs, &root(), request(reference, None)).unwrap();
        let outcome = commit_prepared_slot_write(&fs, &root(), prepared).unwrap();

        assert_eq!(
            fs.events(),
            vec![
                "stagePng",
                "stageAvailableEnvelope",
                "stageUnavailableEnvelope",
                "installPng",
                "syncNewThumbnail",
                "installEnvelope",
                "syncSaves",
                "removeOldThumbnail",
                "syncThumbnailCleanup",
            ]
        );
        assert_eq!(outcome.committed_envelope.save_id, NEW_SAVE_ID);
        assert!(matches!(
            outcome.committed_envelope.thumbnail,
            ThumbnailDescriptorV1::Available { .. }
        ));
        assert!(outcome.cleanup_diagnostic.is_none());
        assert!(!fs.exists(&sidecar_path(OLD_SAVE_ID)));
        assert!(fs.exists(&sidecar_path(NEW_SAVE_ID)));
    }

    #[test]
    fn unavailable_thumbnail_stages_only_the_authoritative_unavailable_envelope() {
        let reference = SaveSlotRef::Auto { slot: 1 };
        let fs = occupied_fs(reference);
        let mut request = request(reference, None);
        request.thumbnail = ThumbnailWrite::Unavailable;

        let prepared = prepare_slot_write(&fs, &root(), request).unwrap();
        let outcome = commit_prepared_slot_write(&fs, &root(), prepared).unwrap();

        assert!(matches!(
            outcome.committed_envelope.thumbnail,
            ThumbnailDescriptorV1::Unavailable
        ));
        assert!(!fs.exists(&sidecar_path(NEW_SAVE_ID)));
        assert_eq!(
            fs.events(),
            vec![
                "stageUnavailableEnvelope",
                "installEnvelope",
                "syncSaves",
                "removeOldThumbnail",
                "syncThumbnailCleanup",
            ]
        );
    }

    #[test]
    fn replacement_never_reuses_the_prior_checkpoint_sidecar_identity() {
        let reference = SaveSlotRef::Auto { slot: 1 };
        let fs = occupied_fs(reference);
        fs.put_file(
            sidecar_path(OLD_SAVE_ID),
            b"last-good-sidecar".to_vec(),
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        );
        let mut same_id = request(reference, None);
        same_id.envelope.save_id = OLD_SAVE_ID.into();
        same_id.thumbnail = ThumbnailWrite::Available(thumbnail(OLD_SAVE_ID));
        let prepared = prepare_slot_write(&fs, &root(), same_id).unwrap();

        assert_eq!(
            commit_prepared_slot_write(&fs, &root(), prepared)
                .err()
                .unwrap()
                .code,
            "invalidSaveCheckpointId"
        );
        assert_eq!(
            fs.bytes(&sidecar_path(OLD_SAVE_ID)).unwrap(),
            b"last-good-sidecar"
        );
        assert_eq!(committed_envelope(&fs, reference).save_id, OLD_SAVE_ID);
    }

    #[test]
    fn thumbnail_prepare_and_install_failures_use_the_presynced_unavailable_envelope() {
        let reference = SaveSlotRef::Auto { slot: 1 };
        for event in [
            "stagePng",
            "stageAvailableEnvelope",
            "installPng",
            "syncNewThumbnail",
        ] {
            for moment in [FaultMoment::Before, FaultMoment::After] {
                let fs = occupied_fs(reference);
                fs.set_fault(Fault { event, moment });

                let prepared = prepare_slot_write(&fs, &root(), request(reference, None)).unwrap();
                let outcome = commit_prepared_slot_write(&fs, &root(), prepared).unwrap();

                assert!(matches!(
                    outcome.committed_envelope.thumbnail,
                    ThumbnailDescriptorV1::Unavailable
                ));
                assert!(matches!(
                    committed_envelope(&fs, reference).thumbnail,
                    ThumbnailDescriptorV1::Unavailable
                ));
                assert!(!fs.exists(&sidecar_path(OLD_SAVE_ID)));
            }
        }
    }

    #[test]
    fn unavailable_envelope_stage_failure_preserves_last_good_json_and_sidecar() {
        let reference = SaveSlotRef::Auto { slot: 1 };
        for moment in [FaultMoment::Before, FaultMoment::After] {
            let fs = occupied_fs(reference);
            let original = fs.bytes(&slot_path(reference)).unwrap();
            fs.set_fault(Fault {
                event: "stageUnavailableEnvelope",
                moment,
            });

            assert_eq!(
                prepare_slot_write(&fs, &root(), request(reference, None))
                    .err()
                    .unwrap()
                    .code,
                "saveWriteFailed"
            );
            assert_eq!(fs.bytes(&slot_path(reference)).unwrap(), original);
            assert!(fs.exists(&sidecar_path(OLD_SAVE_ID)));
            assert!(fs.staged_targets().iter().all(|path| path
                .parent()
                .is_some_and(|parent| parent.starts_with(root()))));
        }
    }

    #[test]
    fn replacement_faults_never_destroy_or_restore_the_last_good_json() {
        let reference = SaveSlotRef::Auto { slot: 1 };
        for moment in [FaultMoment::Before, FaultMoment::After] {
            let fs = occupied_fs(reference);
            fs.set_fault(Fault {
                event: "installEnvelope",
                moment,
            });

            let prepared = prepare_slot_write(&fs, &root(), request(reference, None)).unwrap();
            assert_eq!(
                commit_prepared_slot_write(&fs, &root(), prepared)
                    .unwrap_err()
                    .code,
                "saveReplaceFailed"
            );

            let current = committed_envelope(&fs, reference);
            let expected_id = if moment == FaultMoment::Before {
                OLD_SAVE_ID
            } else {
                NEW_SAVE_ID
            };
            assert_eq!(current.save_id, expected_id);
            assert!(fs.exists(&sidecar_path(OLD_SAVE_ID)));
            assert!(fs.exists(&sidecar_path(NEW_SAVE_ID)));
        }

        for moment in [FaultMoment::Before, FaultMoment::After] {
            let fs = occupied_fs(reference);
            fs.set_fault(Fault {
                event: "syncSaves",
                moment,
            });
            let prepared = prepare_slot_write(&fs, &root(), request(reference, None)).unwrap();
            assert_eq!(
                commit_prepared_slot_write(&fs, &root(), prepared)
                    .unwrap_err()
                    .code,
                "saveSyncFailed"
            );
            assert_eq!(committed_envelope(&fs, reference).save_id, NEW_SAVE_ID);
            assert!(fs.exists(&sidecar_path(OLD_SAVE_ID)));
        }
    }

    #[test]
    fn post_commit_sidecar_cleanup_failure_is_a_nonrollback_diagnostic() {
        let reference = SaveSlotRef::Auto { slot: 1 };
        for event in ["removeOldThumbnail", "syncThumbnailCleanup"] {
            for moment in [FaultMoment::Before, FaultMoment::After] {
                let fs = occupied_fs(reference);
                fs.set_fault(Fault { event, moment });
                let prepared = prepare_slot_write(&fs, &root(), request(reference, None)).unwrap();

                let outcome = commit_prepared_slot_write(&fs, &root(), prepared).unwrap();

                assert_eq!(outcome.committed_envelope.save_id, NEW_SAVE_ID);
                assert_eq!(
                    outcome.cleanup_diagnostic.unwrap().code,
                    if event == "removeOldThumbnail" {
                        "saveWriteFailed"
                    } else {
                        "saveSyncFailed"
                    }
                );
                assert_eq!(committed_envelope(&fs, reference).save_id, NEW_SAVE_ID);
            }
        }
    }

    #[test]
    fn discarded_preparation_changes_no_authoritative_path_and_removes_owned_temps() {
        let reference = SaveSlotRef::Auto { slot: 1 };
        let fs = occupied_fs(reference);
        let original = fs.bytes(&slot_path(reference)).unwrap();
        let prepared = prepare_slot_write(&fs, &root(), request(reference, None)).unwrap();

        discard_prepared_slot_write(prepared).unwrap();

        assert_eq!(fs.bytes(&slot_path(reference)).unwrap(), original);
        assert!(fs.exists(&sidecar_path(OLD_SAVE_ID)));
        assert!(!fs.exists(&sidecar_path(NEW_SAVE_ID)));
        assert!(fs.staged_targets().is_empty());
    }

    #[test]
    fn manual_corrupt_slot_confirmation_matches_no_id_and_exact_mtime_only() {
        let reference = SaveSlotRef::Manual { slot: 1 };
        let expectation = ManualSlotExpectation::Occupied {
            observation: OccupiedSlotExpectation {
                save_id: None,
                modified_at: Some(OBSERVED_MTIME.into()),
            },
        };

        let matching = FakeFilesystem::new();
        matching.put_file(
            slot_path(reference),
            b"{corrupt".to_vec(),
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        );
        let prepared = prepare_slot_write(
            &matching,
            &root(),
            request(reference, Some(expectation.clone())),
        )
        .unwrap();
        assert!(commit_prepared_slot_write(&matching, &root(), prepared).is_ok());

        let retouched = FakeFilesystem::new();
        retouched.put_file(
            slot_path(reference),
            b"{corrupt".to_vec(),
            UNIX_EPOCH + Duration::from_secs(1_700_000_001),
        );
        let prepared =
            prepare_slot_write(&retouched, &root(), request(reference, Some(expectation))).unwrap();
        assert_eq!(
            commit_prepared_slot_write(&retouched, &root(), prepared)
                .unwrap_err()
                .code,
            "staleManualOverwriteConfirmation"
        );
        assert_eq!(retouched.bytes(&slot_path(reference)).unwrap(), b"{corrupt");
        assert!(retouched.staged_targets().is_empty());
    }

    #[test]
    fn manual_empty_and_canonical_id_expectations_reject_replaced_slots() {
        let reference = SaveSlotRef::Manual { slot: 1 };
        let fs = occupied_fs(reference);
        let prepared = prepare_slot_write(
            &fs,
            &root(),
            request(reference, Some(ManualSlotExpectation::Empty)),
        )
        .unwrap();
        assert_eq!(
            commit_prepared_slot_write(&fs, &root(), prepared)
                .unwrap_err()
                .code,
            "staleManualOverwriteConfirmation"
        );
        assert!(fs.staged_targets().is_empty());

        let expected_old = ManualSlotExpectation::Occupied {
            observation: OccupiedSlotExpectation {
                save_id: Some(OLD_SAVE_ID.into()),
                modified_at: None,
            },
        };
        let fs = occupied_fs(reference);
        fs.put_file(
            slot_path(reference),
            serde_json::to_vec(&envelope(OTHER_SAVE_ID, reference)).unwrap(),
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        );
        let prepared =
            prepare_slot_write(&fs, &root(), request(reference, Some(expected_old))).unwrap();
        assert_eq!(
            commit_prepared_slot_write(&fs, &root(), prepared)
                .unwrap_err()
                .code,
            "staleManualOverwriteConfirmation"
        );
    }

    #[test]
    fn manual_canonical_id_expectation_allows_the_same_observed_checkpoint() {
        let reference = SaveSlotRef::Manual { slot: 1 };
        let fs = occupied_fs(reference);
        let prepared = prepare_slot_write(
            &fs,
            &root(),
            request(
                reference,
                Some(ManualSlotExpectation::Occupied {
                    observation: OccupiedSlotExpectation {
                        save_id: Some(OLD_SAVE_ID.into()),
                        modified_at: None,
                    },
                }),
            ),
        )
        .unwrap();

        let outcome = commit_prepared_slot_write(&fs, &root(), prepared).unwrap();

        assert_eq!(outcome.committed_envelope.save_id, NEW_SAVE_ID);
        assert_eq!(committed_envelope(&fs, reference).save_id, NEW_SAVE_ID);
    }

    #[test]
    fn deletion_is_json_first_then_cleans_only_its_validated_sidecar() {
        let reference = SaveSlotRef::Manual { slot: 1 };
        let fs = occupied_fs(reference);

        let outcome = delete_slot(
            &fs,
            &root(),
            reference,
            OccupiedSlotExpectation {
                save_id: Some(OLD_SAVE_ID.into()),
                modified_at: None,
            },
        )
        .unwrap();

        assert!(outcome.cleanup_diagnostic.is_none());
        assert!(!fs.exists(&slot_path(reference)));
        assert!(!fs.exists(&sidecar_path(OLD_SAVE_ID)));
        assert_eq!(
            fs.events(),
            vec![
                "removeSlot",
                "syncSaves",
                "removeOldThumbnail",
                "syncThumbnailCleanup"
            ]
        );
    }

    #[test]
    fn deletion_rejects_replacement_and_preserves_sidecars_for_corrupt_json() {
        let reference = SaveSlotRef::Manual { slot: 1 };
        let replaced = occupied_fs(reference);
        assert_eq!(
            delete_slot(
                &replaced,
                &root(),
                reference,
                OccupiedSlotExpectation {
                    save_id: Some(OTHER_SAVE_ID.into()),
                    modified_at: None,
                },
            )
            .unwrap_err()
            .code,
            "staleSaveSelection"
        );
        assert!(replaced.exists(&slot_path(reference)));

        let corrupt = FakeFilesystem::new();
        corrupt.put_file(
            slot_path(reference),
            b"{corrupt".to_vec(),
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        );
        corrupt.put_file(
            sidecar_path(OLD_SAVE_ID),
            png(1, 1),
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        );
        let outcome = delete_slot(
            &corrupt,
            &root(),
            reference,
            OccupiedSlotExpectation {
                save_id: None,
                modified_at: Some(OBSERVED_MTIME.into()),
            },
        )
        .unwrap();
        assert!(outcome.cleanup_diagnostic.is_none());
        assert!(!corrupt.exists(&slot_path(reference)));
        assert!(corrupt.exists(&sidecar_path(OLD_SAVE_ID)));
    }

    #[test]
    fn deletion_faults_preserve_json_first_authority_and_report_cleanup_only_after_commit() {
        let reference = SaveSlotRef::Manual { slot: 1 };
        let observation = || OccupiedSlotExpectation {
            save_id: Some(OLD_SAVE_ID.into()),
            modified_at: None,
        };

        for moment in [FaultMoment::Before, FaultMoment::After] {
            let fs = occupied_fs(reference);
            fs.set_fault(Fault {
                event: "removeSlot",
                moment,
            });
            assert_eq!(
                delete_slot(&fs, &root(), reference, observation())
                    .unwrap_err()
                    .code,
                "saveWriteFailed"
            );
            assert_eq!(
                fs.exists(&slot_path(reference)),
                moment == FaultMoment::Before
            );
            assert!(fs.exists(&sidecar_path(OLD_SAVE_ID)));
        }

        for moment in [FaultMoment::Before, FaultMoment::After] {
            let fs = occupied_fs(reference);
            fs.set_fault(Fault {
                event: "syncSaves",
                moment,
            });
            assert_eq!(
                delete_slot(&fs, &root(), reference, observation())
                    .unwrap_err()
                    .code,
                "saveSyncFailed"
            );
            assert!(!fs.exists(&slot_path(reference)));
            assert!(fs.exists(&sidecar_path(OLD_SAVE_ID)));
        }

        for event in ["removeOldThumbnail", "syncThumbnailCleanup"] {
            for moment in [FaultMoment::Before, FaultMoment::After] {
                let fs = occupied_fs(reference);
                fs.set_fault(Fault { event, moment });
                let outcome = delete_slot(&fs, &root(), reference, observation()).unwrap();
                assert!(!fs.exists(&slot_path(reference)));
                assert_eq!(
                    outcome.cleanup_diagnostic.unwrap().code,
                    if event == "removeOldThumbnail" {
                        "saveWriteFailed"
                    } else {
                        "saveSyncFailed"
                    }
                );
            }
        }
    }

    #[test]
    fn production_adapter_stages_in_target_directory_and_supports_install_and_discard() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("manual-1.json");
        let fs = ProductionSaveFilesystem;

        let staged = fs.stage_atomic(&target, b"new").unwrap();
        let entries = fs.list_dir(dir.path()).unwrap();
        assert!(!target.exists());
        assert_eq!(entries.len(), 1);
        assert!(entries[0]
            .parent()
            .is_some_and(|parent| parent == dir.path()));
        staged.discard().unwrap();
        assert!(fs.list_dir(dir.path()).unwrap().is_empty());

        let staged = fs.stage_atomic(&target, b"installed").unwrap();
        staged.install().unwrap();
        assert_eq!(std::fs::read(target).unwrap(), b"installed");
    }

    #[test]
    fn production_adapter_propagates_directory_sync_errors() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-directory");

        assert!(ProductionSaveFilesystem.sync_dir(&missing).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_production_adapter_flushes_an_existing_directory() {
        let dir = tempfile::tempdir().unwrap();

        ProductionSaveFilesystem.sync_dir(dir.path()).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_production_adapter_propagates_directory_open_errors() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-directory");

        assert_eq!(
            ProductionSaveFilesystem
                .sync_dir(&missing)
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
    }

    fn discovery_fixture() -> (PathBuf, SaveDiscoveryContext, SaveEnvelopeV1) {
        let resources = crate::game::test_support::save_capture_fixture_resources();
        let engine = crate::game::GameEngine::new_started(resources.clone()).unwrap();
        let checkpoint = crate::game::save::capture::capture_checkpoint_v1(&engine).unwrap();
        let envelope = SaveEnvelopeV1 {
            schema_version: crate::game::save::schema::SAVE_SCHEMA_VERSION,
            content_revision: engine.content_revision().into(),
            save_id: OLD_SAVE_ID.into(),
            save_type: SaveType::Auto,
            slot: 1,
            saved_at: "2026-07-26T12:34:56.123456789Z".into(),
            display_name: "Discovery fixture".into(),
            thumbnail: ThumbnailDescriptorV1::Unavailable,
            summary: checkpoint.summary,
            snapshot: checkpoint.snapshot,
        };
        let definitions = crate::game::save::restore::load_current_definitions(&resources).unwrap();
        (
            resources.clone(),
            SaveDiscoveryContext {
                resources_dir: resources,
                definitions: Arc::new(definitions),
            },
            envelope,
        )
    }

    fn slot_reference(index: usize) -> SaveSlotRef {
        if index < 5 {
            SaveSlotRef::Auto {
                slot: index as u8 + 1,
            }
        } else {
            SaveSlotRef::Manual {
                slot: index as u8 - 4,
            }
        }
    }

    fn envelope_for_slot(
        template: &SaveEnvelopeV1,
        index: usize,
        with_thumbnail: bool,
    ) -> (SaveEnvelopeV1, Option<Vec<u8>>) {
        let reference = slot_reference(index);
        let mut envelope = template.clone();
        envelope.save_id = format!("550e8400-e29b-41d4-a716-44665544000{index}");
        match reference {
            SaveSlotRef::Auto { slot } => {
                envelope.save_type = SaveType::Auto;
                envelope.slot = slot;
            }
            SaveSlotRef::Manual { slot } => {
                envelope.save_type = SaveType::Manual;
                envelope.slot = slot;
            }
        }
        if with_thumbnail {
            let bytes = png(320, 180);
            envelope.thumbnail = ValidatedThumbnail::from_png(bytes.clone(), &envelope.save_id)
                .unwrap()
                .descriptor;
            (envelope, Some(bytes))
        } else {
            envelope.thumbnail = ThumbnailDescriptorV1::Unavailable;
            (envelope, None)
        }
    }

    #[test]
    fn discovery_reads_only_eight_fixed_slots_and_fixed_thumbnail_headers() {
        let (_resources, context, template) = discovery_fixture();
        let fs = FakeFilesystem::new();
        for index in 0..8 {
            let reference = slot_reference(index);
            let (envelope, thumbnail) = envelope_for_slot(&template, index, true);
            fs.put_file(
                slot_path(reference),
                serde_json::to_vec(&envelope).unwrap(),
                UNIX_EPOCH + Duration::from_secs(100 + index as u64),
            );
            fs.put_file(
                sidecar_path(&envelope.save_id),
                thumbnail.unwrap(),
                UNIX_EPOCH + Duration::from_secs(200 + index as u64),
            );
        }

        let view = discover_saves(&fs, &root(), &context);

        assert_eq!(view.slots.len(), 8);
        assert!(matches!(view.discovery, SaveDiscoveryStatusView::Available));
        assert!(view
            .slots
            .iter()
            .all(|slot| matches!(slot.status, SaveSlotStatusView::Valid { .. })));
        let reads = fs.reads();
        let slot_reads = reads
            .iter()
            .filter(|(path, _)| path.extension().and_then(OsStr::to_str) == Some("json"))
            .collect::<Vec<_>>();
        let thumbnail_reads = reads
            .iter()
            .filter(|(path, _)| path.extension().and_then(OsStr::to_str) == Some("png"))
            .collect::<Vec<_>>();
        assert_eq!(slot_reads.len(), 8);
        assert_eq!(thumbnail_reads.len(), 8);
        assert!(thumbnail_reads
            .iter()
            .all(|(_, limit)| *limit == Some(PNG_HEADER_BYTES)));
        assert!(thumbnail_reads.iter().all(|(_, limit)| limit.is_some()));
    }

    #[test]
    fn discovery_classifies_empty_valid_corrupt_oversize_and_incompatible_slots() {
        let (_resources, context, template) = discovery_fixture();
        let fs = FakeFilesystem::new();
        let (valid, _) = envelope_for_slot(&template, 0, false);
        fs.put_file(
            slot_path(SaveSlotRef::Auto { slot: 1 }),
            serde_json::to_vec(&valid).unwrap(),
            UNIX_EPOCH + Duration::from_secs(11),
        );
        fs.put_file(
            slot_path(SaveSlotRef::Auto { slot: 2 }),
            b"{broken".to_vec(),
            UNIX_EPOCH + Duration::from_secs(12),
        );
        let (mut oversize, _) = envelope_for_slot(&template, 2, false);
        let png = png(320, 180);
        oversize.thumbnail = ValidatedThumbnail::from_png(png, &oversize.save_id)
            .unwrap()
            .descriptor;
        if let ThumbnailDescriptorV1::Available { byte_length, .. } = &mut oversize.thumbnail {
            *byte_length = (crate::game::save::schema::MAX_THUMBNAIL_BYTES + 1) as u32;
        }
        fs.put_file(
            slot_path(SaveSlotRef::Auto { slot: 3 }),
            serde_json::to_vec(&oversize).unwrap(),
            UNIX_EPOCH + Duration::from_secs(13),
        );
        let (mut incompatible, _) = envelope_for_slot(&template, 3, false);
        incompatible.content_revision =
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".into();
        fs.put_file(
            slot_path(SaveSlotRef::Auto { slot: 4 }),
            serde_json::to_vec(&incompatible).unwrap(),
            UNIX_EPOCH + Duration::from_secs(14),
        );
        let future =
            br#"{"schemaVersion":99,"saveId":"550e8400-e29b-41d4-a716-446655440004"}"#.to_vec();
        fs.put_file(
            slot_path(SaveSlotRef::Auto { slot: 5 }),
            future.clone(),
            UNIX_EPOCH + Duration::from_secs(15),
        );

        let view = discover_saves(&fs, &root(), &context);

        assert!(matches!(
            view.slots[0].status,
            SaveSlotStatusView::Valid { .. }
        ));
        assert!(matches!(
            view.slots[1].status,
            SaveSlotStatusView::Invalid { ref diagnostic, .. }
                if diagnostic.code == "malformedSaveJson"
        ));
        assert!(matches!(
            view.slots[2].status,
            SaveSlotStatusView::Invalid { ref diagnostic, .. }
                if diagnostic.code == "thumbnailPngTooLarge"
        ));
        assert!(matches!(
            view.slots[3].status,
            SaveSlotStatusView::Invalid { ref diagnostic, .. }
                if diagnostic.code == "incompatibleContentRevision"
        ));
        assert!(matches!(
            view.slots[4].status,
            SaveSlotStatusView::Invalid { ref diagnostic, .. }
                if diagnostic.code == "unsupportedSaveSchemaVersion"
        ));
        assert!(matches!(view.slots[5].status, SaveSlotStatusView::Empty));
        assert_eq!(
            fs.bytes(&slot_path(SaveSlotRef::Auto { slot: 5 })).unwrap(),
            future,
            "discovery never modifies incompatible sources"
        );
    }

    fn selection_slot(
        reference: SaveSlotRef,
        modified_at: Option<SystemTime>,
        saved_at: Option<&str>,
        valid: bool,
    ) -> SaveSlotView {
        let observed_saved_at = saved_at.and_then(|value| DateTime::parse_from_rfc3339(value).ok());
        let status = if modified_at.is_none() {
            SaveSlotStatusView::Empty
        } else if valid {
            let (save_type, slot) = match reference {
                SaveSlotRef::Auto { slot } => (SaveType::Auto, slot),
                SaveSlotRef::Manual { slot } => (SaveType::Manual, slot),
            };
            let mut envelope = representative_save_envelope();
            envelope.save_type = save_type;
            envelope.slot = slot;
            envelope.saved_at = saved_at.unwrap_or("2026-01-01T00:00:00Z").into();
            SaveSlotStatusView::Valid {
                metadata: SaveMetadataView {
                    save_id: envelope.save_id,
                    save_type,
                    schema_version: envelope.schema_version,
                    content_revision: envelope.content_revision,
                    saved_at: envelope.saved_at,
                    display_name: envelope.display_name,
                    thumbnail: ThumbnailAvailabilityView::Unavailable {
                        reason: ThumbnailUnavailableReason::CaptureUnavailable,
                    },
                    summary: envelope.summary,
                },
            }
        } else {
            SaveSlotStatusView::Invalid {
                metadata: None,
                diagnostic: GameError::malformed_save_json(),
            }
        };
        SaveSlotView {
            reference,
            modified_at: modified_at.map(format_modified_at),
            status,
            observed_modified_at: modified_at,
            observed_saved_at,
        }
    }

    #[test]
    fn autosave_rotation_chooses_lowest_empty_then_oldest_occupied_with_stable_ties() {
        let second = UNIX_EPOCH + Duration::from_secs(2);
        let third = UNIX_EPOCH + Duration::from_secs(3);
        let mut slots = vec![
            selection_slot(SaveSlotRef::Auto { slot: 1 }, Some(third), None, true),
            selection_slot(SaveSlotRef::Auto { slot: 2 }, None, None, true),
            selection_slot(SaveSlotRef::Auto { slot: 3 }, Some(second), None, false),
            selection_slot(SaveSlotRef::Auto { slot: 4 }, Some(third), None, true),
            selection_slot(SaveSlotRef::Auto { slot: 5 }, Some(third), None, true),
        ];
        assert_eq!(
            select_autosave_target(&slots).unwrap(),
            SaveSlotRef::Auto { slot: 2 }
        );

        slots[1] = selection_slot(
            SaveSlotRef::Auto { slot: 2 },
            Some(second),
            Some("2099-01-01T00:00:00Z"),
            true,
        );
        assert_eq!(
            select_autosave_target(&slots).unwrap(),
            SaveSlotRef::Auto { slot: 2 },
            "invalid/corrupt entries are occupied and savedAt cannot override mtime"
        );

        slots[1] = selection_slot(
            SaveSlotRef::Auto { slot: 2 },
            Some(third),
            Some("2000-01-01T00:00:00Z"),
            true,
        );
        assert_eq!(
            select_autosave_target(&slots).unwrap(),
            SaveSlotRef::Auto { slot: 3 }
        );
        slots[2] = selection_slot(SaveSlotRef::Auto { slot: 3 }, Some(third), None, false);
        assert_eq!(
            select_autosave_target(&slots).unwrap(),
            SaveSlotRef::Auto { slot: 1 },
            "equal mtimes use ascending autosave slot"
        );
    }

    #[test]
    fn continue_returns_newest_invalid_and_uses_all_documented_tie_breaks() {
        let newest = UNIX_EPOCH + Duration::from_secs(9);
        let older = UNIX_EPOCH + Duration::from_secs(8);
        let invalid_newest =
            selection_slot(SaveSlotRef::Auto { slot: 1 }, Some(newest), None, false);
        let valid_older = selection_slot(
            SaveSlotRef::Manual { slot: 3 },
            Some(older),
            Some("2099-01-01T00:00:00Z"),
            true,
        );
        assert_eq!(
            select_continue_candidate(&[valid_older, invalid_newest]),
            Some(SaveSlotRef::Auto { slot: 1 })
        );

        let tied = vec![
            selection_slot(
                SaveSlotRef::Auto { slot: 5 },
                Some(newest),
                Some("2026-01-01T00:00:00Z"),
                true,
            ),
            selection_slot(
                SaveSlotRef::Manual { slot: 1 },
                Some(newest),
                Some("2026-01-02T00:00:00Z"),
                false,
            ),
            selection_slot(
                SaveSlotRef::Manual { slot: 3 },
                Some(newest),
                Some("2026-01-02T00:00:00Z"),
                true,
            ),
        ];
        assert_eq!(
            select_continue_candidate(&tied),
            Some(SaveSlotRef::Manual { slot: 3 }),
            "savedAt desc, manual before auto, then higher slot"
        );
    }

    fn thumbnail_slot(fs: &FakeFilesystem, template: &SaveEnvelopeV1) -> (SaveSlotRef, Vec<u8>) {
        let reference = SaveSlotRef::Manual { slot: 1 };
        let (mut envelope, _) = envelope_for_slot(template, 5, false);
        let bytes = png(320, 180);
        envelope.thumbnail = ValidatedThumbnail::from_png(bytes.clone(), &envelope.save_id)
            .unwrap()
            .descriptor;
        fs.put_file(
            slot_path(reference),
            serde_json::to_vec(&envelope).unwrap(),
            UNIX_EPOCH + Duration::from_secs(20),
        );
        fs.put_file(
            sidecar_path(&envelope.save_id),
            bytes.clone(),
            UNIX_EPOCH + Duration::from_secs(21),
        );
        (reference, bytes)
    }

    #[test]
    fn lazy_thumbnail_rereads_identity_and_validates_one_bounded_body() {
        let (_resources, _context, template) = discovery_fixture();
        let fs = FakeFilesystem::new();
        let (reference, expected) = thumbnail_slot(&fs, &template);
        let observed_save_id = match reference {
            SaveSlotRef::Manual { .. } => "550e8400-e29b-41d4-a716-446655440005",
            SaveSlotRef::Auto { .. } => unreachable!(),
        };

        let actual = read_save_thumbnail(&fs, &root(), reference, observed_save_id).unwrap();

        assert_eq!(actual, expected);
        let png_reads = fs
            .reads()
            .into_iter()
            .filter(|(path, _)| path.extension().and_then(OsStr::to_str) == Some("png"))
            .collect::<Vec<_>>();
        assert_eq!(
            png_reads,
            vec![(
                sidecar_path(observed_save_id),
                Some(crate::game::save::schema::MAX_THUMBNAIL_BYTES + 1)
            )]
        );
    }

    #[test]
    fn lazy_thumbnail_closes_stale_missing_corrupt_and_oversize_failures() {
        let (_resources, _context, template) = discovery_fixture();
        let reference = SaveSlotRef::Manual { slot: 1 };

        let stale = FakeFilesystem::new();
        thumbnail_slot(&stale, &template);
        assert_eq!(
            read_save_thumbnail(&stale, &root(), reference, OLD_SAVE_ID)
                .unwrap_err()
                .code,
            "staleSaveSelection"
        );
        assert!(stale
            .reads()
            .iter()
            .all(|(path, _)| path.extension().and_then(OsStr::to_str) != Some("png")));

        let missing = FakeFilesystem::new();
        thumbnail_slot(&missing, &template);
        missing
            .state
            .lock()
            .unwrap()
            .files
            .remove(&sidecar_path("550e8400-e29b-41d4-a716-446655440005"));
        assert_eq!(
            read_save_thumbnail(
                &missing,
                &root(),
                reference,
                "550e8400-e29b-41d4-a716-446655440005"
            )
            .unwrap_err()
            .code,
            "thumbnailMissing"
        );

        let unreadable = FakeFilesystem::new();
        thumbnail_slot(&unreadable, &template);
        unreadable.fail_reads_for(sidecar_path("550e8400-e29b-41d4-a716-446655440005"));
        assert_eq!(
            read_save_thumbnail(
                &unreadable,
                &root(),
                reference,
                "550e8400-e29b-41d4-a716-446655440005"
            )
            .unwrap_err()
            .code,
            "thumbnailReadFailed"
        );

        let corrupt = FakeFilesystem::new();
        thumbnail_slot(&corrupt, &template);
        corrupt
            .state
            .lock()
            .unwrap()
            .files
            .get_mut(&sidecar_path("550e8400-e29b-41d4-a716-446655440005"))
            .unwrap()
            .bytes[20] ^= 1;
        assert_eq!(
            read_save_thumbnail(
                &corrupt,
                &root(),
                reference,
                "550e8400-e29b-41d4-a716-446655440005"
            )
            .unwrap_err()
            .code,
            "thumbnailCorrupt"
        );

        let oversize = FakeFilesystem::new();
        thumbnail_slot(&oversize, &template);
        oversize
            .state
            .lock()
            .unwrap()
            .files
            .get_mut(&sidecar_path("550e8400-e29b-41d4-a716-446655440005"))
            .unwrap()
            .bytes = vec![0; crate::game::save::schema::MAX_THUMBNAIL_BYTES + 2];
        assert_eq!(
            read_save_thumbnail(
                &oversize,
                &root(),
                reference,
                "550e8400-e29b-41d4-a716-446655440005"
            )
            .unwrap_err()
            .code,
            "thumbnailCorrupt"
        );
        assert!(oversize.reads().iter().any(|(path, limit)| {
            path.extension().and_then(OsStr::to_str) == Some("png")
                && *limit == Some(crate::game::save::schema::MAX_THUMBNAIL_BYTES + 1)
        }));
    }

    #[test]
    fn browser_view_never_serializes_paths_or_thumbnail_object_ids() {
        let (_resources, context, template) = discovery_fixture();
        let fs = FakeFilesystem::new();
        thumbnail_slot(&fs, &template);

        let json = serde_json::to_string(&discover_saves(&fs, &root(), &context)).unwrap();

        assert!(!json.contains("/virtual/app/saves"));
        assert!(!json.contains("objectId"));
        assert!(!json.contains("thumbnails/"));
    }

    #[test]
    fn orphan_cleanup_removes_only_owned_temps_and_unreferenced_canonical_pngs() {
        let (_resources, _context, template) = discovery_fixture();
        let fs = FakeFilesystem::new();
        let (reference, _) = thumbnail_slot(&fs, &template);
        let referenced = sidecar_path("550e8400-e29b-41d4-a716-446655440005");
        let orphan = sidecar_path(OTHER_SAVE_ID);
        let owned_slot_temp = root().join(".manual-1.json.A1b2C3");
        let owned_png_temp = root()
            .join("thumbnails")
            .join(format!(".{OTHER_SAVE_ID}.png.Z9y8X7"));
        let foreign = root().join("thumbnails").join("notes.png");
        for path in [&orphan, &owned_slot_temp, &owned_png_temp, &foreign] {
            fs.put_file(
                path.clone(),
                b"orphan".to_vec(),
                UNIX_EPOCH + Duration::from_secs(1),
            );
        }

        clean_orphaned_save_files(&fs, &root()).unwrap();

        assert!(fs.exists(&slot_path(reference)));
        assert!(fs.exists(&referenced));
        assert!(!fs.exists(&orphan));
        assert!(!fs.exists(&owned_slot_temp));
        assert!(!fs.exists(&owned_png_temp));
        assert!(fs.exists(&foreign));
    }

    #[test]
    fn orphan_cleanup_rescans_after_writer_turn_and_preserves_possible_corrupt_sources() {
        let (_resources, _context, template) = discovery_fixture();
        let fs = FakeFilesystem::new();
        let new_sidecar = sidecar_path("550e8400-e29b-41d4-a716-446655440005");
        fs.put_file(
            new_sidecar.clone(),
            png(320, 180),
            UNIX_EPOCH + Duration::from_secs(1),
        );

        let _advisory_scan_before_waiting_for_writer = fs.list_dir(&root()).unwrap();
        thumbnail_slot(&fs, &template);
        clean_orphaned_save_files(&fs, &root()).unwrap();
        assert!(fs.exists(&new_sidecar));

        let corrupt_sidecar = sidecar_path(OLD_SAVE_ID);
        let corrupt_json = format!(
            r#"{{"schemaVersion":99,"saveId":"{OLD_SAVE_ID}","thumbnail":{{"type":"available","objectId":"{OLD_SAVE_ID}","format":"png","width":1,"height":1,"byteLength":33,"sha256":"sha256:{}"}}}}"#,
            "a".repeat(64)
        );
        fs.put_file(
            slot_path(SaveSlotRef::Auto { slot: 1 }),
            corrupt_json.into_bytes(),
            UNIX_EPOCH + Duration::from_secs(2),
        );
        fs.put_file(
            corrupt_sidecar.clone(),
            png(1, 1),
            UNIX_EPOCH + Duration::from_secs(2),
        );
        clean_orphaned_save_files(&fs, &root()).unwrap();
        assert!(fs.exists(&corrupt_sidecar));
    }

    #[test]
    fn discovery_and_load_share_exact_schema_cursor_history_and_scene_diagnostics() {
        type Mutation = Box<dyn Fn(&mut SaveEnvelopeV1)>;
        let (_resources, context, template) = discovery_fixture();
        let cases: Vec<(&str, Mutation)> = vec![
            (
                "malformed checkpoint ID",
                Box::new(|save| save.save_id = "not-a-checkpoint".into()),
            ),
            (
                "dialogue coordinates",
                Box::new(|save| save.snapshot.next_queue_gen = 0),
            ),
            (
                "history invariant",
                Box::new(|save| save.snapshot.dialogue_history.next_id = 0),
            ),
            (
                "scene progress",
                Box::new(|save| {
                    save.snapshot.scene =
                        crate::game::save::schema::SceneProgressSnapshotV1::Investigation {
                            intro_played: false,
                            outro_played: false,
                            current_sublocation_id: None,
                            inspected_hotspot_ids: Vec::new(),
                            discussed_topic_ids: Vec::new(),
                            entered_sublocation_ids: Vec::new(),
                            unlocked_overrides: Vec::new(),
                        };
                }),
            ),
        ];
        for (label, mutate) in cases {
            let mut envelope = template.clone();
            mutate(&mut envelope);
            let load_error = crate::game::save::restore::build_restore_candidate(
                context.resources_dir.clone(),
                &context.definitions,
                envelope.clone(),
            )
            .unwrap_err();
            let fs = FakeFilesystem::new();
            fs.put_file(
                slot_path(SaveSlotRef::Auto { slot: 1 }),
                serde_json::to_vec(&envelope).unwrap(),
                UNIX_EPOCH + Duration::from_secs(50),
            );

            let view = discover_saves(&fs, &root(), &context);
            let SaveSlotStatusView::Invalid { diagnostic, .. } = &view.slots[0].status else {
                panic!("{label}: discovery unexpectedly accepted invalid save");
            };
            assert_eq!(diagnostic, &load_error, "{label}");
        }
    }

    #[test]
    fn discovery_rejects_manual_files_claiming_auto_or_another_manual_slot() {
        let (_resources, context, template) = discovery_fixture();
        for (save_type, claimed_slot) in [(SaveType::Auto, 2), (SaveType::Manual, 1)] {
            let fs = FakeFilesystem::new();
            let mut envelope = template.clone();
            envelope.save_type = save_type;
            envelope.slot = claimed_slot;
            fs.put_file(
                slot_path(SaveSlotRef::Manual { slot: 2 }),
                serde_json::to_vec(&envelope).unwrap(),
                UNIX_EPOCH + Duration::from_secs(60),
            );

            let view = discover_saves(&fs, &root(), &context);
            assert!(matches!(
                view.slots[6].status,
                SaveSlotStatusView::Invalid { ref diagnostic, .. }
                    if diagnostic.code == "saveSlotMismatch"
            ));
        }
    }

    #[test]
    fn discovery_rejects_a_context_detached_from_its_preloaded_definitions_globally() {
        let (_resources, mut context, template) = discovery_fixture();
        context.resources_dir = PathBuf::from("/different/package");
        let fs = FakeFilesystem::new();
        let (envelope, _) = envelope_for_slot(&template, 0, false);
        fs.put_file(
            slot_path(SaveSlotRef::Auto { slot: 1 }),
            serde_json::to_vec(&envelope).unwrap(),
            UNIX_EPOCH + Duration::from_secs(1),
        );

        let view = discover_saves(&fs, &root(), &context);

        assert!(matches!(
            view.discovery,
            SaveDiscoveryStatusView::Unavailable { .. }
        ));
        assert!(view.slots.is_empty());
    }

    #[test]
    fn six_normal_autosaves_retain_five_deep_rotation_and_reuse_the_oldest_slot() {
        let mut slots = (1..=5)
            .map(|slot| selection_slot(SaveSlotRef::Auto { slot }, None, None, true))
            .collect::<Vec<_>>();
        let mut targets = Vec::new();
        for tick in 1..=6 {
            let target = select_autosave_target(&slots).unwrap();
            targets.push(slot_number(target));
            let index = usize::from(slot_number(target) - 1);
            slots[index] = selection_slot(
                target,
                Some(UNIX_EPOCH + Duration::from_secs(tick)),
                Some("2026-07-26T00:00:00Z"),
                true,
            );
        }
        assert_eq!(targets, vec![1, 2, 3, 4, 5, 1]);
    }
}
