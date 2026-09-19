//! Immutable, content-addressed renditions. Resource authorization stays in MediaService.
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use image::{ImageDecoder, ImageEncoder, ImageReader, Limits};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::{
    DECODE_MAX_ALLOC_BYTES, ImageStore, MAX_DIMENSION, MAX_PIXELS, MAX_READ_BYTES, MediaError,
    OpenedImage,
};

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ImageVariant {
    #[default]
    Original,
    Thumb,
    Detail,
}

pub struct PreparedImage {
    pub opened: OpenedImage,
    /// SHA-256 of the actual response bytes, including the thumbnail encoding.
    pub digest: String,
    pub object_key: String,
}

#[derive(Clone)]
struct Cached {
    path: Option<PathBuf>,
    digest: String,
    content_type: &'static str,
}

// Only metadata is held in memory, with a hard cap. Originals are immutable in the app;
// file-handle metadata invalidates this cache on an operator's replacement as well.
type CacheKey = (String, ImageVariant, String);
#[derive(Clone, Default)]
pub(super) struct RenditionCache(Arc<Mutex<HashMap<CacheKey, Cached>>>);

impl ImageStore {
    /// The caller must authorize and open the source first, even on every cache hit.
    pub async fn prepare(
        &self,
        source: OpenedImage,
        directory: &str,
        filename: &str,
        variant: ImageVariant,
    ) -> Result<PreparedImage, MediaError> {
        let metadata = source.file.metadata().await?;
        let mut fingerprint = format!(
            "{}:{:?}:{:?}",
            metadata.len(),
            metadata.modified()?,
            metadata.created().ok()
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            fingerprint.push_str(&format!(
                ":{}:{}:{}:{}",
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec()
            ));
        }
        let key = (format!("{directory}/{filename}"), variant, fingerprint);
        let cached = self
            .renditions
            .0
            .lock()
            .map_err(|_| MediaError::Task)?
            .get(&key)
            .cloned();
        if let Some(cached) = cached {
            return finish(source, cached, self.root()).await;
        }
        let permit = self.image_permit().await?;
        let root = self.root().to_owned();
        let source_type = source.content_type;
        let mut input = source.file.into_std().await;
        let (input, cached) = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let mut bytes = Vec::new();
            (&mut input)
                .take(MAX_READ_BYTES + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() as u64 > MAX_READ_BYTES {
                return Err(MediaError::TooLarge);
            }
            let cached = match variant {
                ImageVariant::Original => Cached {
                    path: None,
                    digest: hex_digest(&bytes),
                    content_type: source_type,
                },
                _ => {
                    let (bytes, content_type) = thumbnail(&bytes, variant)?;
                    let digest = hex_digest(&bytes);
                    let path = persist(&root, &digest, &bytes)?;
                    Cached {
                        path: Some(path),
                        digest,
                        content_type,
                    }
                }
            };
            use std::io::{Seek, SeekFrom};
            input.seek(SeekFrom::Start(0))?;
            Ok::<_, MediaError>((input, cached))
        })
        .await
        .map_err(|_| MediaError::Task)??;
        {
            let mut cache = self.renditions.0.lock().map_err(|_| MediaError::Task)?;
            if cache.len() >= 1024 {
                cache.clear();
            }
            cache.insert(key, cached.clone());
        }
        finish(
            OpenedImage {
                file: tokio::fs::File::from_std(input),
                content_type: source_type,
                len: source.len,
            },
            cached,
            self.root(),
        )
        .await
    }
}

async fn finish(
    mut source: OpenedImage,
    cached: Cached,
    root: &Path,
) -> Result<PreparedImage, MediaError> {
    if let Some(path) = cached.path {
        let metadata = tokio::fs::symlink_metadata(&path).await?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(MediaError::NotFound);
        }
        if !tokio::fs::canonicalize(&path).await?.starts_with(root) {
            return Err(MediaError::NotFound);
        }
        source.file = tokio::fs::File::open(path).await?;
        source.len = source.file.metadata().await?.len();
    }
    source.content_type = cached.content_type;
    let extension = match cached.content_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => return Err(MediaError::UnsupportedFormat),
    };
    Ok(PreparedImage {
        object_key: format!("media/v1/{}.{}", cached.digest, extension),
        digest: cached.digest,
        opened: source,
    })
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn thumbnail(bytes: &[u8], variant: ImageVariant) -> Result<(Vec<u8>, &'static str), MediaError> {
    let header = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| MediaError::Decode)?;
    let (width, height) = header.into_dimensions().map_err(|_| MediaError::Decode)?;
    if width == 0
        || height == 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(MediaError::Dimensions);
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| MediaError::Decode)?;
    let mut limits = Limits::no_limits();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(DECODE_MAX_ALLOC_BYTES);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| MediaError::Decode)?;
    let orientation = decoder.orientation().map_err(|_| MediaError::Decode)?;
    let mut decoded = image::DynamicImage::from_decoder(decoder).map_err(|_| MediaError::Decode)?;
    decoded.apply_orientation(orientation);
    let size = if variant == ImageVariant::Thumb {
        640
    } else {
        1280
    };
    let resized = if decoded.width() > size || decoded.height() > size {
        decoded.resize(size, size, image::imageops::FilterType::Triangle)
    } else {
        decoded
    };
    let mut output = Vec::new();
    let mime = if resized.color().has_alpha() {
        let pixels = resized.to_rgba8();
        image::codecs::png::PngEncoder::new(&mut output)
            .write_image(
                pixels.as_raw(),
                pixels.width(),
                pixels.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|_| MediaError::Encode)?;
        "image/png"
    } else {
        let pixels = resized.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 78)
            .write_image(
                pixels.as_raw(),
                pixels.width(),
                pixels.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|_| MediaError::Encode)?;
        "image/jpeg"
    };
    Ok((output, mime))
}

fn persist(root: &Path, digest: &str, bytes: &[u8]) -> Result<PathBuf, MediaError> {
    let directory = root.join(".renditions-v1");
    std::fs::create_dir_all(&directory)?;
    if std::fs::symlink_metadata(&directory)?
        .file_type()
        .is_symlink()
        || !directory.canonicalize()?.starts_with(root)
    {
        return Err(MediaError::InvalidDirectory);
    }
    let path = directory.join(digest);
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            return Ok(path);
        }
        Ok(_) => return Err(MediaError::InvalidName),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let mut temp = tempfile::NamedTempFile::new_in(&directory)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    match temp.persist_noclobber(&path) {
        Ok(_) => {}
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.error.into()),
    }
    Ok(path)
}
