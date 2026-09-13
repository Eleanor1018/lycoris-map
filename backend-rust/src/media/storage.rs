//! [`ImageStore`] 的实现与错误/结果类型。

use std::io::{Cursor, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use bytes::Bytes;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder, ImageFormat, ImageReader, Limits};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// 单张上传图片的压缩字节上限（5 MiB）。
pub const MAX_UPLOAD_BYTES: usize = 5 * 1024 * 1024;
/// 允许的最大边长。
pub const MAX_DIMENSION: u32 = 10_000;
/// 允许的最大像素总数（2500 万）。
pub const MAX_PIXELS: u64 = 25_000_000;
/// 解码阶段允许的最大内存占用；25M 像素的 8 位 RGBA 约 100 MB，
/// 取 128 MiB 足以覆盖合法图片并留出解码器开销。
pub const DECODE_MAX_ALLOC_BYTES: u64 = 128 * 1024 * 1024;
/// 读取历史媒体的字节上限。远高于上传限制，避免把历史存在的大图
/// （可能超过 5 MiB）静默变成 404，只拦截明显非法的超大文件。
pub const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;
/// 默认同时执行的图片处理任务数。
pub const DEFAULT_CONCURRENCY: usize = 1;
/// JPEG 重编码质量；Java `ImageIO` 默认约 0.75，这里取 75。
const JPEG_QUALITY: u8 = 75;
/// 文件名的字节长度上限，避免文件系统错误。
const MAX_FILENAME_LEN: usize = 255;

/// 允许的媒体目录白名单。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaDirectory {
    /// 用户头像。
    Avatars,
    /// 点位图片。
    Markers,
}

impl MediaDirectory {
    /// 目录名，用于磁盘路径与 URL。
    pub const fn as_str(self) -> &'static str {
        match self {
            MediaDirectory::Avatars => "avatars",
            MediaDirectory::Markers => "markers",
        }
    }

    /// 解析目录名；仅接受白名单内的精确值（大小写敏感，与 Java 一致）。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "avatars" => Some(MediaDirectory::Avatars),
            "markers" => Some(MediaDirectory::Markers),
            _ => None,
        }
    }
}

/// 一次成功保存的结果：目录、文件名与对外 URL。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredImage {
    pub directory: MediaDirectory,
    pub filename: String,
    pub url: String,
}

impl StoredImage {
    fn new(directory: MediaDirectory, filename: String) -> Self {
        let url = format!("/uploads/{}/{}", directory.as_str(), filename);
        Self {
            directory,
            filename,
            url,
        }
    }
}

/// 读取到的图片字节与明确的 MIME 类型。
#[derive(Debug, Clone)]
pub struct ImageBytes {
    pub bytes: Bytes,
    pub content_type: &'static str,
}

/// 面向 HTTP 的流式读取句柄。
///
/// 上层应把它交给 `tokio_util::io::ReaderStream`（小缓冲）作为响应体，不整张读入
/// 内存；`len` 取自**文件句柄**的 metadata，供 Content-Length 或传输边界使用。
pub struct OpenedImage {
    pub file: tokio::fs::File,
    pub content_type: &'static str,
    pub len: u64,
}

/// 媒体核心错误。只描述原因，不决定 HTTP 状态——由上层按接口契约映射
/// （`Busy` 对应 503，`NotFound` 对应 404 等）。
#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("文件为空")]
    Empty,
    #[error("图片文件过大")]
    TooLarge,
    #[error("图片尺寸过大，请缩小后上传")]
    Dimensions,
    #[error("请选择 JPG、PNG、GIF 或 WebP 图片")]
    UnsupportedFormat,
    #[error("图片损坏或无法解码，请换一张图片")]
    Decode,
    #[error("图片编码失败")]
    Encode,
    #[error("图片保存位置无效")]
    InvalidDirectory,
    #[error("文件名不合法")]
    InvalidName,
    #[error("文件名前缀不合法")]
    InvalidPrefix,
    #[error("图片不存在")]
    NotFound,
    #[error("图片处理繁忙，请稍后重试")]
    Busy,
    #[error("无法准备上传根目录")]
    Root(#[source] std::io::Error),
    #[error("图片存储 I/O 失败")]
    Io(#[from] std::io::Error),
    #[error("图片处理任务失败")]
    Task,
    #[error("图片处理并发上限必须大于 0")]
    InvalidConcurrency,
}

impl MediaError {
    /// 是否为可短暂重试的繁忙错误；上层据此返回 503 与 `Retry-After`。
    pub fn is_busy(&self) -> bool {
        matches!(self, MediaError::Busy)
    }
}

/// 图片存储核心。`Clone` 廉价（`PathBuf` + `Arc<Semaphore>`），可放入共享状态。
#[derive(Clone)]
pub struct ImageStore {
    root: PathBuf,
    permits: Arc<Semaphore>,
}

impl ImageStore {
    /// 以显式 `root` 与并发上限构造。目录不存在时创建，随后 canonicalize；
    /// 之后所有路径判断都以该 canonical root 为基准。`max_concurrent` 必须大于 0：
    /// 0 会让所有保存永久繁忙，属于配置错误而非运行期繁忙。
    pub fn new(root: impl AsRef<Path>, max_concurrent: usize) -> Result<Self, MediaError> {
        if max_concurrent == 0 {
            return Err(MediaError::InvalidConcurrency);
        }
        let root = root.as_ref();
        std::fs::create_dir_all(root).map_err(MediaError::Root)?;
        let canonical = std::fs::canonicalize(root).map_err(MediaError::Root)?;
        if !canonical.is_dir() {
            return Err(MediaError::Root(std::io::Error::new(
                ErrorKind::NotADirectory,
                "上传根路径不是目录",
            )));
        }
        Ok(Self {
            root: canonical,
            permits: Arc::new(Semaphore::new(max_concurrent)),
        })
    }

    /// 使用默认并发（1 个图片任务）构造。
    pub fn with_default_concurrency(root: impl AsRef<Path>) -> Result<Self, MediaError> {
        Self::new(root, DEFAULT_CONCURRENCY)
    }

    /// canonical 上传根目录。
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 保存一张合法图片。
    ///
    /// 输入 `bytes` 是压缩后的文件字节；`prefix` 由服务端提供（如 `avatar`、
    /// `marker`），内部会校验为 ASCII 字母数字与 `-`。成功返回 [`StoredImage`]，
    /// 只有返回后上层才可用其 URL 写数据库；失败绝不返回可引用 URL。
    ///
    /// 无并发许可时立即返回 [`MediaError::Busy`]，不做无界排队。
    pub async fn save(
        &self,
        directory: MediaDirectory,
        prefix: &str,
        bytes: Vec<u8>,
    ) -> Result<StoredImage, MediaError> {
        validate_prefix(prefix)?;
        if bytes.is_empty() {
            return Err(MediaError::Empty);
        }
        if bytes.len() > MAX_UPLOAD_BYTES {
            return Err(MediaError::TooLarge);
        }

        // 立即尝试获取许可；拿不到就报繁忙，不把大对象塞进等待队列。
        let permit = self
            .permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| MediaError::Busy)?;
        let root = self.root.clone();
        let prefix = prefix.to_owned();

        // 许可被移动进阻塞任务，随任务结束才释放；外层请求超时不会提前放开许可。
        tokio::task::spawn_blocking(move || {
            let _permit: OwnedSemaphorePermit = permit;
            process_and_store(&root, directory, &prefix, bytes)
        })
        .await
        .map_err(|_| MediaError::Task)?
    }

    /// 打开一个图片文件用于**流式**发送（HTTP 图片/头像的推荐入口）。
    ///
    /// 完成目录白名单、文件名、canonical root 与普通文件检查后打开文件，并从
    /// 文件句柄取 metadata（长度以句柄为准）。不套用上传的 5 MiB 限制：历史大图
    /// （含合法 WebP 重编码成 PNG 后可能超过 5 MiB）同样可展示。传输缓冲、条件请求
    /// 与缓存头由上层决定。
    pub async fn open(&self, directory: &str, filename: &str) -> Result<OpenedImage, MediaError> {
        let directory = MediaDirectory::parse(directory).ok_or(MediaError::InvalidDirectory)?;
        validate_filename(filename)?;
        let content_type = content_type(filename).ok_or(MediaError::InvalidName)?;

        let root = self.root.clone();
        let filename = filename.to_owned();
        let path = tokio::task::spawn_blocking(move || {
            resolve_in_root(&root, directory, &filename)?.ok_or(MediaError::NotFound)
        })
        .await
        .map_err(|_| MediaError::Task)??;

        let file = tokio::fs::File::open(&path).await.map_err(MediaError::Io)?;
        let metadata = file.metadata().await.map_err(MediaError::Io)?;
        if !metadata.is_file() {
            return Err(MediaError::NotFound);
        }
        Ok(OpenedImage {
            file,
            content_type,
            len: metadata.len(),
        })
    }

    /// 按安全路径一次性读取图片原始字节，返回字节与明确 MIME。
    ///
    /// 这是带 [`MAX_READ_BYTES`] 上限的便利方法/测试辅助，**不是 HTTP 必须使用的方式**
    /// （HTTP 应使用 [`ImageStore::open`] 流式发送）。不重编码历史文件；越出 root 或
    /// 符号链接一律按不存在处理。历史上限以实际读取字节数为准：边读边计数，文件在检查
    /// 后增长也无法绕过，超限返回 [`MediaError::TooLarge`] 而不是静默 404。
    pub async fn read(&self, directory: &str, filename: &str) -> Result<ImageBytes, MediaError> {
        let directory = MediaDirectory::parse(directory).ok_or(MediaError::InvalidDirectory)?;
        validate_filename(filename)?;
        let content_type = content_type(filename).ok_or(MediaError::InvalidName)?;

        let root = self.root.clone();
        let filename = filename.to_owned();
        tokio::task::spawn_blocking(move || {
            let path = resolve_in_root(&root, directory, &filename)?.ok_or(MediaError::NotFound)?;
            // 只读上限 +1 字节即可判定是否超限，不先看 metadata，避免两步之间文件增长。
            let mut limited = std::fs::File::open(&path)?.take(MAX_READ_BYTES + 1);
            let mut buffer = Vec::new();
            limited.read_to_end(&mut buffer)?;
            if buffer.len() as u64 > MAX_READ_BYTES {
                tracing::warn!(
                    target: "lycoris_backend::media",
                    limit = MAX_READ_BYTES,
                    "读取图片超过上限，按过大错误拒绝而非静默 404"
                );
                return Err(MediaError::TooLarge);
            }
            Ok(ImageBytes {
                bytes: Bytes::from(buffer),
                content_type,
            })
        })
        .await
        .map_err(|_| MediaError::Task)?
    }

    /// 检查一个目录白名单内的文件名是否存在且为 root 内的普通文件。
    ///
    /// 目录或文件名不合法返回错误；不存在、非普通文件或符号链接逃逸返回 `false`。
    pub async fn exists(&self, directory: &str, filename: &str) -> Result<bool, MediaError> {
        let directory = MediaDirectory::parse(directory).ok_or(MediaError::InvalidDirectory)?;
        validate_filename(filename)?;
        let root = self.root.clone();
        let filename = filename.to_owned();
        tokio::task::spawn_blocking(move || {
            Ok(resolve_in_root(&root, directory, &filename)?.is_some())
        })
        .await
        .map_err(|_| MediaError::Task)?
    }

    /// 移除一个由本核心保存、且上层已确认**无数据库引用**的孤立文件。
    ///
    /// 只接受合法目录与 `[A-Za-z0-9_.-]+` 文件名，只删除 root 内的单个普通文件，
    /// 不做任何递归或目录扫描；文件已不存在视为成功（幂等）。是否可删由上层判断。
    pub async fn remove_new(&self, image: &StoredImage) -> Result<(), MediaError> {
        validate_filename(&image.filename)?;
        let directory = image.directory;
        let filename = image.filename.clone();
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || {
            // 文件已被清理视为成功（幂等）；否则删除该普通文件。
            if let Some(path) = resolve_in_root(&root, directory, &filename)? {
                std::fs::remove_file(path)?;
            }
            Ok(())
        })
        .await
        .map_err(|_| MediaError::Task)?
    }
}

/// 校验服务端提供的文件名前缀：非空、长度有界、仅 ASCII 字母数字与 `-`。
fn validate_prefix(prefix: &str) -> Result<(), MediaError> {
    if prefix.is_empty() || prefix.len() > 100 {
        return Err(MediaError::InvalidPrefix);
    }
    if !prefix
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(MediaError::InvalidPrefix);
    }
    Ok(())
}

/// 校验文件名：非空、非 `.`/`..`、仅 `[A-Za-z0-9_.-]`、后缀在图片白名单内。
///
/// 该字符集天然排除 `/`、`\`、`:`、`%`（含百分号编码穿越）与空白；绝对路径与
/// Windows 盘符同样因含分隔符/冒号被拒。
fn validate_filename(filename: &str) -> Result<(), MediaError> {
    if filename.is_empty() || filename == "." || filename == ".." {
        return Err(MediaError::InvalidName);
    }
    if filename.len() > MAX_FILENAME_LEN {
        return Err(MediaError::InvalidName);
    }
    if !filename
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
    {
        return Err(MediaError::InvalidName);
    }
    if content_type(filename).is_none() {
        return Err(MediaError::InvalidName);
    }
    Ok(())
}

/// 按扩展名（大小写不敏感，兼容历史大写后缀）映射 MIME。
fn content_type(filename: &str) -> Option<&'static str> {
    let (_, extension) = filename.rsplit_once('.')?;
    match extension.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// 解析 root 内的普通文件路径。
///
/// 不合法（越界、符号链接、非普通文件、缺失）返回 `Ok(None)`；目录/文件名校验
/// 由调用方在进入阻塞任务前完成。canonical 结果必须仍在 canonical root 内。
fn resolve_in_root(
    root: &Path,
    directory: MediaDirectory,
    filename: &str,
) -> Result<Option<PathBuf>, MediaError> {
    let candidate = root.join(directory.as_str()).join(filename);
    let metadata = match std::fs::symlink_metadata(&candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(MediaError::Io(error)),
    };
    // 最终项为符号链接或非普通文件：拒绝（不跟随、不泄露存在性）。
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Ok(None);
    }
    // canonicalize 会解析中间目录的符号链接/reparse；越出 root 一律拒绝。
    // 只记录结论，不记录用户提供的原始路径。
    let canonical = std::fs::canonicalize(&candidate).map_err(MediaError::Io)?;
    if !canonical.starts_with(root) {
        tracing::debug!(target: "lycoris_backend::media", "拒绝越出上传根目录的路径");
        return Ok(None);
    }
    Ok(Some(canonical))
}

/// 确保并返回白名单子目录的 canonical 路径，且该路径位于 root 内。
fn ensure_subdirectory(root: &Path, directory: MediaDirectory) -> Result<PathBuf, MediaError> {
    let directory_path = root.join(directory.as_str());
    std::fs::create_dir_all(&directory_path)?;
    let canonical = std::fs::canonicalize(&directory_path)?;
    if !canonical.starts_with(root) {
        return Err(MediaError::Io(std::io::Error::new(
            ErrorKind::PermissionDenied,
            "上传子目录越出根目录",
        )));
    }
    Ok(canonical)
}

/// 解码校验并重编码，返回新文件字节与扩展名。
///
/// 先按魔数判格式 → 只读头部尺寸并做边界检查 → 再设解码内存上限 → 只解首帧 →
/// 复核尺寸 → 按 alpha 重编码为 PNG/JPEG。全程不复制源元数据。
fn process_and_store(
    root: &Path,
    directory: MediaDirectory,
    prefix: &str,
    bytes: Vec<u8>,
) -> Result<StoredImage, MediaError> {
    let (data, extension) = decode_and_reencode(&bytes)?;
    let directory_path = ensure_subdirectory(root, directory)?;
    let filename = format!("{prefix}-{}.{extension}", uuid::Uuid::new_v4());
    let final_path = directory_path.join(&filename);
    write_atomically(&directory_path, &final_path, &data)?;
    Ok(StoredImage::new(directory, filename))
}

/// 校验并重编码；不触盘，便于在测试中直接验证边界。
fn decode_and_reencode(bytes: &[u8]) -> Result<(Vec<u8>, &'static str), MediaError> {
    // 1) 只读头部尺寸。`with_guessed_format` 依据魔数判格式，忽略扩展名/Content-Type。
    let header = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| MediaError::Decode)?;
    let format = header.format().ok_or(MediaError::UnsupportedFormat)?;
    if !is_allowed_format(format) {
        return Err(MediaError::UnsupportedFormat);
    }
    let (width, height) = header.into_dimensions().map_err(|_| MediaError::Decode)?;
    if !dimensions_within_limits(width, height) {
        return Err(MediaError::Dimensions);
    }

    // 2) 配置内存与边长上限后只解首帧，避免为动画/超大图分配整段缓冲。
    let mut decode_reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| MediaError::Decode)?;
    let mut limits = Limits::no_limits();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(DECODE_MAX_ALLOC_BYTES);
    decode_reader.limits(limits);
    let decoded = decode_reader.decode().map_err(|_| MediaError::Decode)?;

    // 3) 真正解码后复核维度，防止头部与实际不一致的构造文件。
    if !dimensions_within_limits(decoded.width(), decoded.height()) {
        return Err(MediaError::Dimensions);
    }

    // 4) 有 alpha 存 PNG，否则存 JPEG；to_rgba8/to_rgb8 统一为 8 位并剥离调色板/16 位。
    let alpha = decoded.color().has_alpha();
    let mut output = Vec::new();
    let extension = if alpha {
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
        PngEncoder::new(&mut output)
            .write_image(rgba.as_raw(), width, height, ExtendedColorType::Rgba8)
            .map_err(|_| MediaError::Encode)?;
        "png"
    } else {
        let rgb = decoded.to_rgb8();
        let (width, height) = rgb.dimensions();
        JpegEncoder::new_with_quality(&mut output, JPEG_QUALITY)
            .write_image(rgb.as_raw(), width, height, ExtendedColorType::Rgb8)
            .map_err(|_| MediaError::Encode)?;
        "jpg"
    };
    Ok((output, extension))
}

fn is_allowed_format(format: ImageFormat) -> bool {
    matches!(
        format,
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::Gif | ImageFormat::WebP
    )
}

fn dimensions_within_limits(width: u32, height: u32) -> bool {
    width >= 1
        && height >= 1
        && width <= MAX_DIMENSION
        && height <= MAX_DIMENSION
        && u64::from(width) * u64::from(height) <= MAX_PIXELS
}

/// 同目录临时文件写完并刷盘后，原子且不覆盖已有文件地落到最终名。
///
/// 数据先 `sync_all`，再用 `persist_noclobber` 落到最终名（已存在同名文件则失败，
/// 不覆盖）；Unix 上随后尽力 `sync` 父目录，使新目录项在 PG 提交引用前尽可能持久。
/// Windows 无目录 fsync，依赖已落盘数据文件 + `persist_noclobber`，全程不使用 `unsafe`。
fn write_atomically(directory: &Path, final_path: &Path, data: &[u8]) -> Result<(), MediaError> {
    let mut temp = tempfile::Builder::new()
        .prefix(".tmp-")
        .tempfile_in(directory)?;
    temp.write_all(data)?;
    temp.flush()?;
    temp.as_file().sync_all()?;
    temp.persist_noclobber(final_path)
        .map_err(|error| MediaError::Io(error.error))?;
    #[cfg(unix)]
    {
        // 目录 fsync 在部分文件系统会返回错误，属于尽力而为，不影响已落盘文件。
        if let Ok(dir) = std::fs::File::open(directory) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_rules_enforce_charset_and_extension() {
        for ok in [
            "avatar-1234.png",
            "marker.jpeg",
            "a.b.c.webp",
            "A_1-2.GIF",
            ".png",
        ] {
            assert!(validate_filename(ok).is_ok(), "{ok} 应合法");
        }
        for bad in [
            "",
            ".",
            "..",
            "../secret.png",
            "a/b.png",
            "a\\b.png",
            "C:\\x.png",
            "/etc/passwd",
            "a:b.png",
            "%2e%2e%2fsecret.png",
            "a b.png",
            "image.svg",
            "no_extension",
            "trailing.",
        ] {
            assert!(validate_filename(bad).is_err(), "{bad} 应被拒绝");
        }
    }

    #[test]
    fn mime_mapping_is_case_insensitive() {
        assert_eq!(content_type("a.JPG"), Some("image/jpeg"));
        assert_eq!(content_type("a.JPEG"), Some("image/jpeg"));
        assert_eq!(content_type("a.PNG"), Some("image/png"));
        assert_eq!(content_type("a.gif"), Some("image/gif"));
        assert_eq!(content_type("a.WebP"), Some("image/webp"));
        assert_eq!(content_type("a.bmp"), None);
    }

    #[test]
    fn prefix_rejects_paths_and_empty() {
        assert!(validate_prefix("avatar").is_ok());
        assert!(validate_prefix("marker-1A").is_ok());
        for bad in ["", "a/b", "a\\b", "..", "a.png", "a b", "头像"] {
            assert!(validate_prefix(bad).is_err(), "{bad} 应被拒绝");
        }
    }

    #[test]
    fn read_limit_is_above_upload_limit_to_keep_history_visible() {
        // 历史存在的 >5 MiB 媒体必须可读，而不是被当成 404。
        assert!(MAX_READ_BYTES > MAX_UPLOAD_BYTES as u64);
    }

    #[test]
    fn new_rejects_zero_concurrency() {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        assert!(matches!(
            ImageStore::new(dir.path(), 0),
            Err(MediaError::InvalidConcurrency)
        ));
        assert!(ImageStore::new(dir.path(), 1).is_ok());
    }

    #[test]
    fn dimensions_limits_are_strict() {
        assert!(dimensions_within_limits(1, 1));
        assert!(dimensions_within_limits(5000, 5000));
        assert!(!dimensions_within_limits(0, 10));
        assert!(!dimensions_within_limits(10, 0));
        assert!(!dimensions_within_limits(10001, 1));
        assert!(!dimensions_within_limits(1, 10001));
        // 6000 * 5000 = 30M > 25M，即便两边都 <= 10000 也应拒绝。
        assert!(!dimensions_within_limits(6000, 5000));
    }

    #[test]
    fn atomic_write_does_not_overwrite_existing_file() {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let final_path = dir.path().join("avatar-dup.png");
        std::fs::write(&final_path, b"existing").expect("预置文件失败");

        let error = write_atomically(dir.path(), &final_path, b"replacement").unwrap_err();
        assert!(matches!(error, MediaError::Io(_)), "覆盖已有名必须失败");
        assert_eq!(
            std::fs::read(&final_path).expect("读取预置文件失败"),
            b"existing",
            "已有文件不得被覆盖"
        );

        let fresh = dir.path().join("avatar-new.png");
        write_atomically(dir.path(), &fresh, b"data").expect("新名应能落盘");
        assert_eq!(std::fs::read(&fresh).unwrap(), b"data");
    }

    #[tokio::test]
    async fn busy_when_no_permit_and_permit_returned_after_task() {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let store = ImageStore::new(dir.path(), 1).expect("构造 ImageStore 失败");
        assert_eq!(store.permits.available_permits(), 1);

        // 占住唯一许可，保存必须立即繁忙，且不会落盘。
        let held = store.permits.clone().try_acquire_owned().unwrap();
        assert_eq!(store.permits.available_permits(), 0);
        let busy = store
            .save(MediaDirectory::Avatars, "avatar", vec![0u8; 16])
            .await;
        assert!(matches!(busy, Err(MediaError::Busy)));
        assert!(busy.unwrap_err().is_busy());

        // 释放后许可归还；无效图片会在阻塞任务中失败，但许可必须随任务结束归还。
        drop(held);
        assert_eq!(store.permits.available_permits(), 1);
        let invalid = store
            .save(MediaDirectory::Avatars, "avatar", vec![0u8; 16])
            .await;
        assert!(matches!(invalid, Err(MediaError::UnsupportedFormat)));
        assert_eq!(
            store.permits.available_permits(),
            1,
            "阻塞任务结束后许可必须归还"
        );
    }
}
