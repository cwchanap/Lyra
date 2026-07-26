use crate::game::GameError;

pub(crate) fn missing_schema_migration(version: u32) -> GameError {
    GameError::new(
        "missingSaveSchemaMigration",
        format!("Save schema version {version} has no registered migration."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_a_missing_registry_link_with_its_typed_code() {
        assert_eq!(
            missing_schema_migration(9).code,
            "missingSaveSchemaMigration"
        );
    }
}
