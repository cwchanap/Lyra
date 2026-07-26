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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::save::schema::ThumbnailFormat;

    const SAVE_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
    const DIGEST: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn descriptor(
        width: u32,
        height: u32,
        byte_length: u32,
        sha256: &str,
    ) -> ThumbnailDescriptorV1 {
        ThumbnailDescriptorV1::Available {
            object_id: SAVE_ID.into(),
            format: ThumbnailFormat::Png,
            width,
            height,
            byte_length,
            sha256: sha256.into(),
        }
    }

    #[test]
    fn accepts_nonzero_thumbnail_values_at_each_upper_bound() {
        assert!(validate_descriptor(
            SAVE_ID,
            &descriptor(
                MAX_THUMBNAIL_WIDTH,
                MAX_THUMBNAIL_HEIGHT,
                MAX_THUMBNAIL_BYTES as u32,
                DIGEST
            )
        )
        .is_ok());
    }

    #[test]
    fn rejects_zero_and_oversized_thumbnail_byte_lengths() {
        for byte_length in [0, MAX_THUMBNAIL_BYTES as u32 + 1] {
            assert_eq!(
                validate_descriptor(SAVE_ID, &descriptor(1, 1, byte_length, DIGEST))
                    .unwrap_err()
                    .code,
                "thumbnailPngTooLarge"
            );
        }
    }

    #[test]
    fn rejects_zero_and_oversized_thumbnail_dimensions() {
        for (width, height) in [
            (0, 1),
            (1, 0),
            (MAX_THUMBNAIL_WIDTH + 1, 1),
            (1, MAX_THUMBNAIL_HEIGHT + 1),
        ] {
            assert_eq!(
                validate_descriptor(SAVE_ID, &descriptor(width, height, 1, DIGEST))
                    .unwrap_err()
                    .code,
                "thumbnailDimensionsOutOfBounds"
            );
        }
    }

    #[test]
    fn rejects_malformed_and_uppercase_thumbnail_digests() {
        for digest in [
            "sha256:ABCDEF",
            "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "sha512:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ] {
            assert_eq!(
                validate_descriptor(SAVE_ID, &descriptor(1, 1, 1, digest))
                    .unwrap_err()
                    .code,
                "thumbnailPngMalformed"
            );
        }
    }
}
