use crate::game::save::schema::SAVE_SCHEMA_VERSION;
use crate::game::GameError;

pub(crate) fn dispatch_current(version: u32) -> Result<(), GameError> {
    dispatch_with_registry(version, &[(SAVE_SCHEMA_VERSION, true)])
}

fn dispatch_with_registry(version: u32, registry: &[(u32, bool)]) -> Result<(), GameError> {
    let Some((_, linked)) = registry
        .iter()
        .find(|(registered, _)| *registered == version)
    else {
        return Err(GameError::unsupported_save_schema_version());
    };
    if !linked {
        return Err(GameError::missing_save_schema_migration());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_a_missing_registry_link_with_its_typed_code() {
        assert_eq!(
            dispatch_with_registry(1, &[(1, false)]).unwrap_err().code,
            "missingSaveSchemaMigration"
        );
    }
}
