//! The accepted pre-release current-format and Tauri development namespace
//! policy is recorded in
//! `docs/superpowers/specs/2026-08-03-hpa-540-pre-release-save-compatibility-policy.md`.

pub(crate) mod capture;
pub(crate) mod coordinator;
#[cfg(feature = "e2e")]
pub(crate) mod e2e_faults;
pub(crate) mod migrations;
pub(crate) mod restore;
pub(crate) mod schema;
pub(crate) mod storage;
pub(crate) mod thumbnail;
