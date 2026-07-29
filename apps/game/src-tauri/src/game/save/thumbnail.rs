use super::schema::{
    canonical_uuid_v4, ThumbnailDescriptorV1, ThumbnailFormat, MAX_THUMBNAIL_BYTES,
    MAX_THUMBNAIL_HEIGHT, MAX_THUMBNAIL_WIDTH,
};
use crate::game::GameError;
use sha2::{Digest, Sha256};

pub(crate) const PNG_HEADER_BYTES: usize = 33;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedThumbnailCandidate {
    pub(crate) bytes: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) byte_length: u32,
    pub(crate) sha256: String,
}

impl ValidatedThumbnailCandidate {
    pub(crate) fn from_png(bytes: Vec<u8>) -> Result<Self, GameError> {
        if bytes.len() > MAX_THUMBNAIL_BYTES {
            return Err(GameError::thumbnail_png_too_large());
        }
        let (width, height) = parse_png_header(&bytes)?;
        validate_dimensions(width, height)?;
        let digest = Sha256::digest(&bytes);
        Ok(Self {
            byte_length: bytes.len() as u32,
            bytes,
            width,
            height,
            sha256: format!("sha256:{digest:x}"),
        })
    }

    pub(crate) fn bind(self, object_id: &str) -> Result<ValidatedThumbnail, GameError> {
        canonical_uuid_v4(object_id)?;
        let descriptor = ThumbnailDescriptorV1::Available {
            object_id: object_id.into(),
            format: ThumbnailFormat::Png,
            width: self.width,
            height: self.height,
            byte_length: self.byte_length,
            sha256: self.sha256,
        };
        validate_descriptor(object_id, &descriptor)?;
        Ok(ValidatedThumbnail {
            bytes: self.bytes,
            descriptor,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // Task 7/10 consume validated thumbnail candidates through storage.
pub(crate) struct ValidatedThumbnail {
    pub(crate) bytes: Vec<u8>,
    pub(crate) descriptor: ThumbnailDescriptorV1,
}

impl ValidatedThumbnail {
    #[allow(dead_code)] // Task 7/10 construct thumbnails before save command wiring lands.
    pub(crate) fn from_png(bytes: Vec<u8>, object_id: &str) -> Result<Self, GameError> {
        ValidatedThumbnailCandidate::from_png(bytes)?.bind(object_id)
    }

    pub(super) fn validate_for(&self, save_id: &str) -> Result<(), GameError> {
        let rebuilt = Self::from_png(self.bytes.clone(), save_id)?;
        if rebuilt.descriptor != self.descriptor {
            return Err(GameError::thumbnail_png_malformed());
        }
        Ok(())
    }
}

pub(crate) fn parse_png_header(bytes: &[u8]) -> Result<(u32, u32), GameError> {
    if bytes.len() < PNG_HEADER_BYTES
        || bytes[..8] != *b"\x89PNG\r\n\x1a\n"
        || bytes[8..12] != 13u32.to_be_bytes()
        || bytes[12..16] != *b"IHDR"
    {
        return Err(GameError::thumbnail_png_malformed());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("fixed IHDR width"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("fixed IHDR height"));
    validate_dimensions(width, height)?;
    Ok((width, height))
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), GameError> {
    if width == 0 || height == 0 || width > MAX_THUMBNAIL_WIDTH || height > MAX_THUMBNAIL_HEIGHT {
        return Err(GameError::thumbnail_dimensions_out_of_bounds());
    }
    Ok(())
}

pub(crate) fn validate_png_bytes_for_descriptor(
    save_id: &str,
    bytes: &[u8],
    descriptor: &ThumbnailDescriptorV1,
) -> Result<(), GameError> {
    validate_descriptor(save_id, descriptor)?;
    let ThumbnailDescriptorV1::Available {
        width,
        height,
        byte_length,
        sha256,
        ..
    } = descriptor
    else {
        return Err(GameError::thumbnail_png_malformed());
    };
    if bytes.len() > MAX_THUMBNAIL_BYTES {
        return Err(GameError::thumbnail_png_too_large());
    }
    if bytes.len() != *byte_length as usize {
        return Err(GameError::thumbnail_png_malformed());
    }
    let (actual_width, actual_height) = parse_png_header(bytes)?;
    if actual_width != *width || actual_height != *height {
        return Err(GameError::thumbnail_png_malformed());
    }
    let digest = Sha256::digest(bytes);
    if format!("sha256:{digest:x}") != *sha256 {
        return Err(GameError::thumbnail_png_malformed());
    }
    Ok(())
}

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

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes
    }

    #[test]
    fn validated_thumbnail_parses_only_png_signature_and_ihdr_metadata() {
        let bytes = png(320, 180);
        let thumbnail = ValidatedThumbnail::from_png(bytes.clone(), SAVE_ID).unwrap();

        assert_eq!(thumbnail.bytes, bytes);
        assert_eq!(
            thumbnail.descriptor,
            ThumbnailDescriptorV1::Available {
                object_id: SAVE_ID.into(),
                format: ThumbnailFormat::Png,
                width: 320,
                height: 180,
                byte_length: 33,
                sha256: "sha256:e81cedab8eba5b6a45d358fcd8809fc6b31a95f2641daf5060a41513a932476f"
                    .into(),
            }
        );
    }

    #[test]
    fn validated_thumbnail_rejects_bad_signature_truncated_ihdr_and_bad_object_id() {
        let mut bad_signature = png(1, 1);
        bad_signature[0] = 0;
        let truncated = png(1, 1)[..24].to_vec();

        for error in [
            ValidatedThumbnail::from_png(bad_signature, SAVE_ID).unwrap_err(),
            ValidatedThumbnail::from_png(truncated, SAVE_ID).unwrap_err(),
            ValidatedThumbnail::from_png(png(1, 1), "not-a-uuid").unwrap_err(),
        ] {
            assert!(matches!(
                error.code.as_str(),
                "thumbnailPngMalformed" | "invalidSaveCheckpointId"
            ));
        }
    }

    #[test]
    fn validated_thumbnail_rejects_zero_and_oversized_ihdr_dimensions() {
        for (width, height) in [
            (0, 1),
            (1, 0),
            (MAX_THUMBNAIL_WIDTH + 1, 1),
            (1, MAX_THUMBNAIL_HEIGHT + 1),
        ] {
            assert_eq!(
                ValidatedThumbnail::from_png(png(width, height), SAVE_ID)
                    .unwrap_err()
                    .code,
                "thumbnailDimensionsOutOfBounds"
            );
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

    #[test]
    fn validate_png_bytes_rejects_unavailable_descriptor() {
        let error =
            validate_png_bytes_for_descriptor(SAVE_ID, &[], &ThumbnailDescriptorV1::Unavailable)
                .unwrap_err();
        assert_eq!(error.code, "thumbnailPngMalformed");
    }

    #[test]
    fn validate_png_bytes_rejects_oversized_byte_stream() {
        let bytes = vec![0u8; MAX_THUMBNAIL_BYTES + 1];
        let error = validate_png_bytes_for_descriptor(
            SAVE_ID,
            &bytes,
            &descriptor(1, 1, bytes.len() as u32, DIGEST),
        )
        .unwrap_err();
        assert_eq!(error.code, "thumbnailPngTooLarge");
    }

    #[test]
    fn validate_png_bytes_rejects_byte_length_mismatch() {
        let bytes = png(1, 1);
        let mut d = descriptor(1, 1, bytes.len() as u32, DIGEST);
        // Declare a different byte_length than the actual stream length.
        if let ThumbnailDescriptorV1::Available { byte_length, .. } = &mut d {
            *byte_length = (bytes.len() as u32) + 1;
        }
        let error = validate_png_bytes_for_descriptor(SAVE_ID, &bytes, &d).unwrap_err();
        assert_eq!(error.code, "thumbnailPngMalformed");
    }

    #[test]
    fn validate_png_bytes_rejects_dimension_mismatch() {
        let bytes = png(2, 2);
        let d = descriptor(1, 1, bytes.len() as u32, DIGEST);
        let error = validate_png_bytes_for_descriptor(SAVE_ID, &bytes, &d).unwrap_err();
        assert_eq!(error.code, "thumbnailPngMalformed");
    }

    #[test]
    fn validate_png_bytes_rejects_digest_mismatch() {
        let bytes = png(1, 1);
        let d = descriptor(1, 1, bytes.len() as u32, DIGEST);
        let error = validate_png_bytes_for_descriptor(SAVE_ID, &bytes, &d).unwrap_err();
        assert_eq!(error.code, "thumbnailPngMalformed");
    }

    #[test]
    fn validate_png_bytes_accepts_a_self_consistent_png() {
        let bytes = png(1, 1);
        let digest = format!("sha256:{:x}", Sha256::digest(&bytes));
        let d = descriptor(1, 1, bytes.len() as u32, &digest);
        assert!(validate_png_bytes_for_descriptor(SAVE_ID, &bytes, &d).is_ok());
    }
}
