use super::schema::{
    ThumbnailDescriptorV1, MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_HEIGHT, MAX_THUMBNAIL_WIDTH,
};
use crate::game::GameError;

pub(crate) fn validate_descriptor(
    save_id: &str,
    descriptor: &ThumbnailDescriptorV1,
) -> Result<(), GameError> {
    if let ThumbnailDescriptorV1::Available {
        object_id,
        width,
        height,
        byte_length,
        sha256,
        ..
    } = descriptor
    {
        if object_id != save_id {
            return Err(GameError::new(
                "thumbnailPngMalformed",
                "Thumbnail object ID does not match the save ID.",
            ));
        }
        if *byte_length == 0 || (*byte_length as usize) > MAX_THUMBNAIL_BYTES {
            return Err(GameError::new(
                "thumbnailPngTooLarge",
                "Thumbnail byte length is outside the allowed range.",
            ));
        }
        if *width == 0
            || *height == 0
            || *width > MAX_THUMBNAIL_WIDTH
            || *height > MAX_THUMBNAIL_HEIGHT
        {
            return Err(GameError::new(
                "thumbnailDimensionsOutOfBounds",
                "Thumbnail dimensions are outside the allowed range.",
            ));
        }
        let digest = sha256.strip_prefix("sha256:").unwrap_or("");
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(GameError::new(
                "thumbnailPngMalformed",
                "Thumbnail SHA-256 digest is malformed.",
            ));
        }
    }
    Ok(())
}
