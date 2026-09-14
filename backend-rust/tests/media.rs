//! 图片存储与读取核心的集成测试。
//!
//! 只使用真实临时目录与本进程合成的小尺寸图片，不触碰真实 `uploads` 目录，
//! 不依赖 PostgreSQL / Redis。合成图覆盖四种允许格式、alpha/opaque 分支、源元数据
//! 丢弃、流式与便利读取、边界拒绝、路径安全与并发许可。Windows 上符号链接需要权限，
//! 改用无需管理员的 junction 执行同一 reparse 逃逸回归；设施建不起来时测试判失败。

use std::path::Path;

use image::{ExtendedColorType, ImageEncoder, ImageFormat};
use lycoris_backend::media::{
    ImageStore, MAX_READ_BYTES, MAX_UPLOAD_BYTES, MediaDirectory, MediaError, OpenedImage,
    StoredImage,
};
use tempfile::TempDir;
use tokio::io::AsyncReadExt;

fn store(root: &Path) -> ImageStore {
    ImageStore::with_default_concurrency(root).expect("构造 ImageStore 失败")
}

fn rgba_png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbaImage::from_fn(width, height, |x, y| {
        image::Rgba([x as u8, y as u8, 200, 255])
    });
    let mut output = Vec::new();
    image::codecs::png::PngEncoder::new(&mut output)
        .write_image(image.as_raw(), width, height, ExtendedColorType::Rgba8)
        .expect("编码测试 PNG 失败");
    output
}

fn rgb_png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_fn(width, height, |x, y| image::Rgb([x as u8, y as u8, 128]));
    let mut output = Vec::new();
    image::codecs::png::PngEncoder::new(&mut output)
        .write_image(image.as_raw(), width, height, ExtendedColorType::Rgb8)
        .expect("编码测试 PNG 失败");
    output
}

fn rgb_jpeg(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_fn(width, height, |x, y| image::Rgb([x as u8, y as u8, 64]));
    let mut output = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 85)
        .write_image(image.as_raw(), width, height, ExtendedColorType::Rgb8)
        .expect("编码测试 JPEG 失败");
    output
}

/// 借助 `image` 的通用写出合成 GIF / WebP，再读回字节，避免手工构造。
fn encoded_via_file(dir: &Path, name: &str, format: ImageFormat) -> Vec<u8> {
    let width = 2;
    let height = 2;
    let image = image::RgbaImage::from_fn(width, height, |x, y| {
        image::Rgba([x as u8 * 100, y as u8 * 100, 30, 255])
    });
    let path = dir.join(name);
    image::save_buffer_with_format(
        &path,
        image.as_raw(),
        width,
        height,
        ExtendedColorType::Rgba8,
        format,
    )
    .expect("编码测试图片失败");
    std::fs::read(&path).expect("读取测试图片失败")
}

fn list_files(dir: &Path) -> Vec<String> {
    if !dir.exists() {
        return Vec::new();
    }
    std::fs::read_dir(dir)
        .expect("读取目录失败")
        .map(|entry| {
            entry
                .expect("目录项失败")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

fn saved_path(root: &Path, image: &StoredImage) -> std::path::PathBuf {
    root.join(image.directory.as_str()).join(&image.filename)
}

#[tokio::test]
async fn alpha_png_reencodes_to_png_with_matching_file_and_url() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());
    let stored = store
        .save(MediaDirectory::Avatars, "avatar", rgba_png(3, 2))
        .await
        .expect("保存 PNG 失败");

    assert_eq!(stored.directory, MediaDirectory::Avatars);
    assert!(
        stored.filename.starts_with("avatar-"),
        "文件名应带服务端前缀"
    );
    assert!(stored.filename.ends_with(".png"), "带 alpha 应输出 PNG");
    assert_eq!(stored.url, format!("/uploads/avatars/{}", stored.filename));

    let path = saved_path(dir.path(), &stored);
    assert!(path.is_file(), "文件应落盘到对应目录");
    let decoded = image::open(&path).expect("解码落盘文件失败");
    assert_eq!((decoded.width(), decoded.height()), (3, 2));

    assert!(store.exists("avatars", &stored.filename).await.unwrap());
    let loaded = store.read("avatars", &stored.filename).await.unwrap();
    assert_eq!(loaded.content_type, "image/png");
    assert_eq!(loaded.bytes.as_ref(), std::fs::read(&path).unwrap());
}

#[tokio::test]
async fn opaque_and_jpeg_inputs_reencode_to_jpeg() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());

    for (directory, prefix, input) in [
        (MediaDirectory::Markers, "marker", rgb_png(4, 4)),
        (MediaDirectory::Avatars, "avatar", rgb_jpeg(4, 4)),
    ] {
        let stored = store
            .save(directory, prefix, input)
            .await
            .expect("保存失败");
        assert!(stored.filename.ends_with(".jpg"), "无 alpha 应输出 JPEG");
        let decoded = image::open(saved_path(dir.path(), &stored)).expect("解码失败");
        assert!(!decoded.color().has_alpha());
        assert_eq!((decoded.width(), decoded.height()), (4, 4));
    }
}

#[tokio::test]
async fn gif_and_webp_decode_and_store() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());

    for (name, format) in [
        ("sample.gif", ImageFormat::Gif),
        ("sample.webp", ImageFormat::WebP),
    ] {
        let input = encoded_via_file(dir.path(), name, format);
        assert!(!input.is_empty(), "{name} 合成失败");
        let stored = store
            .save(MediaDirectory::Markers, "marker", input)
            .await
            .unwrap_or_else(|error| panic!("{name} 保存失败: {error}"));
        let path = saved_path(dir.path(), &stored);
        assert!(path.is_file());
        let decoded = image::open(&path).expect("解码落盘文件失败");
        assert_eq!((decoded.width(), decoded.height()), (2, 2));
        assert!(stored.filename.ends_with(".png") || stored.filename.ends_with(".jpg"));
    }
}

#[tokio::test]
async fn source_metadata_and_trailing_bytes_are_dropped() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());

    let mut input = inject_text_chunk(&rgba_png(2, 3), "Comment", "SECRET-METADATA");
    input.extend_from_slice(b"trailing-test-content");
    assert!(contains(&input, b"SECRET-METADATA"), "前置条件：源含元数据");
    assert!(
        contains(&input, b"trailing-test-content"),
        "前置条件：源含尾随数据"
    );

    let stored = store
        .save(MediaDirectory::Avatars, "avatar", input)
        .await
        .expect("保存失败");
    let saved = std::fs::read(saved_path(dir.path(), &stored)).unwrap();
    assert!(
        !contains(&saved, b"SECRET-METADATA"),
        "重编码不得继承元数据"
    );
    assert!(
        !contains(&saved, b"trailing-test-content"),
        "尾随字节不得保留"
    );
}

#[tokio::test]
async fn rejects_empty_bad_format_and_oversized_before_decode() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());

    assert!(matches!(
        store
            .save(MediaDirectory::Avatars, "avatar", Vec::new())
            .await,
        Err(MediaError::Empty)
    ));
    assert!(matches!(
        store
            .save(
                MediaDirectory::Avatars,
                "avatar",
                b"this is not an image".to_vec()
            )
            .await,
        Err(MediaError::UnsupportedFormat)
    ));
    assert!(matches!(
        store
            .save(
                MediaDirectory::Avatars,
                "avatar",
                vec![0u8; MAX_UPLOAD_BYTES + 1],
            )
            .await,
        Err(MediaError::TooLarge)
    ));

    // 失败发生在解码/落盘之前，不应留下任何图片文件。
    let avatars = dir.path().join("avatars");
    assert!(list_files(&avatars).is_empty(), "拒绝输入不得产生文件");
}

#[tokio::test]
async fn rejects_over_limit_dimensions_before_full_decode() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());

    // 头部声明超限尺寸但没有像素数据：必须在读取头后、真正分配大缓冲前拒绝。
    for (width, height) in [(10001, 1), (1, 10001), (6000, 5000), (10000, 2501)] {
        let result = store
            .save(MediaDirectory::Markers, "marker", ihdr_png(width, height))
            .await;
        assert!(
            matches!(result, Err(MediaError::Dimensions)),
            "{width}x{height} 应被尺寸校验拒绝，实际: {result:?}"
        );
    }
}

#[tokio::test]
async fn rejects_path_traversal_and_non_whitelisted_names() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());
    std::fs::create_dir_all(dir.path().join("avatars")).unwrap();
    std::fs::write(dir.path().join("avatars").join("ok.png"), b"x").unwrap();

    assert!(matches!(
        store.read("etc", "ok.png").await,
        Err(MediaError::InvalidDirectory)
    ));
    assert!(matches!(
        store.read("Avatars", "ok.png").await,
        Err(MediaError::InvalidDirectory)
    ));
    for bad in [
        "../secret.png",
        "..\\secret.png",
        "a/b.png",
        "C:\\secret.png",
        "%2e%2e%2fsecret.png",
        "a:b.png",
        "",
        ".",
        "..",
        "image.svg",
        "no_extension",
    ] {
        assert!(
            matches!(
                store.read("avatars", bad).await,
                Err(MediaError::InvalidName)
            ),
            "read 应拒绝 {bad}"
        );
        assert!(
            matches!(
                store.exists("avatars", bad).await,
                Err(MediaError::InvalidName)
            ),
            "exists 应拒绝 {bad}"
        );
    }

    for bad_prefix in ["", "a/b", "..", "a b"] {
        assert!(
            matches!(
                store
                    .save(MediaDirectory::Avatars, bad_prefix, rgba_png(1, 1))
                    .await,
                Err(MediaError::InvalidPrefix)
            ),
            "save 应拒绝前缀 {bad_prefix}"
        );
    }
}

#[tokio::test]
async fn serves_legal_historical_files_raw_and_allows_large_ones() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());
    let avatars = dir.path().join("avatars");
    std::fs::create_dir_all(&avatars).unwrap();

    // 历史大写后缀按 MIME 映射读取，内容原样返回、不重编码。
    std::fs::write(avatars.join("old-photo.JPG"), b"raw-jpeg-bytes").unwrap();
    let loaded = store.read("avatars", "old-photo.JPG").await.unwrap();
    assert_eq!(loaded.content_type, "image/jpeg");
    assert_eq!(loaded.bytes.as_ref(), b"raw-jpeg-bytes");

    // 历史大图（>5 MiB）必须仍可读，而不是被静默 404。
    let large = vec![7u8; MAX_UPLOAD_BYTES + 1024 * 1024];
    std::fs::write(avatars.join("big.png"), &large).unwrap();
    let loaded = store.read("avatars", "big.png").await.unwrap();
    assert_eq!(loaded.content_type, "image/png");
    assert_eq!(loaded.bytes.len(), large.len());

    assert!(matches!(
        store.read("avatars", "missing.png").await,
        Err(MediaError::NotFound)
    ));
    assert!(!store.exists("avatars", "missing.png").await.unwrap());
}

/// 从 `OpenedImage` 流式读完全部字节，模拟 HTTP 小缓冲发送。
async fn drain(opened: OpenedImage) -> Vec<u8> {
    let mut file = opened.file;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .await
        .expect("读取打开文件失败");
    buffer
}

#[tokio::test]
async fn open_streams_history_above_upload_limit_with_handle_length() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());
    let avatars = dir.path().join("avatars");
    std::fs::create_dir_all(&avatars).unwrap();

    // 历史文件可超过 5 MiB 上传限制（例如旧图或 PNG 重编码结果），open 不应拒绝。
    let body = vec![9u8; MAX_UPLOAD_BYTES + 4096];
    std::fs::write(avatars.join("legacy.png"), &body).unwrap();

    let opened = store.open("avatars", "legacy.png").await.unwrap();
    assert_eq!(opened.content_type, "image/png");
    assert_eq!(opened.len, body.len() as u64, "长度应取自文件句柄");
    assert!(opened.len > MAX_UPLOAD_BYTES as u64);
    assert_eq!(drain(opened).await, body);
}

#[tokio::test]
async fn open_rejects_invalid_and_missing_paths() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());
    assert!(matches!(
        store.open("etc", "a.png").await,
        Err(MediaError::InvalidDirectory)
    ));
    assert!(matches!(
        store.open("avatars", "../a.png").await,
        Err(MediaError::InvalidName)
    ));
    assert!(matches!(
        store.open("avatars", "missing.png").await,
        Err(MediaError::NotFound)
    ));
}

#[tokio::test]
async fn read_rejects_over_limit_by_actual_bytes_not_metadata() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());
    let avatars = dir.path().join("avatars");
    std::fs::create_dir_all(&avatars).unwrap();

    // 用 set_len 造出超上限的稀疏文件；读取必须按实际字节数判定，而不是先信 metadata。
    let file = std::fs::File::create(avatars.join("huge.png")).unwrap();
    file.set_len(MAX_READ_BYTES + 1).unwrap();
    drop(file);

    assert!(matches!(
        store.read("avatars", "huge.png").await,
        Err(MediaError::TooLarge)
    ));
}

#[tokio::test]
async fn repeated_saves_get_distinct_names_and_survive() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());

    let first = store
        .save(MediaDirectory::Avatars, "avatar", rgba_png(2, 2))
        .await
        .unwrap();
    let second = store
        .save(MediaDirectory::Avatars, "avatar", rgba_png(2, 2))
        .await
        .unwrap();
    assert_ne!(first.filename, second.filename, "UUID 文件名必须互不相同");
    assert!(saved_path(dir.path(), &first).is_file());
    assert!(saved_path(dir.path(), &second).is_file());
}

#[tokio::test]
async fn remove_new_deletes_only_the_named_orphan() {
    let dir = TempDir::new().unwrap();
    let store = store(dir.path());

    let first = store
        .save(MediaDirectory::Avatars, "avatar", rgba_png(2, 2))
        .await
        .unwrap();
    let second = store
        .save(MediaDirectory::Avatars, "avatar", rgba_png(2, 2))
        .await
        .unwrap();

    store.remove_new(&first).await.expect("删除孤立文件失败");
    assert!(!saved_path(dir.path(), &first).exists());
    assert!(
        saved_path(dir.path(), &second).is_file(),
        "不得误删其他文件"
    );

    // 幂等：再次删除不存在的文件视为成功。
    store.remove_new(&first).await.expect("重复删除应幂等");

    // 只接受服务端返回的合法文件名，任意路径被拒。
    let forged = StoredImage {
        directory: MediaDirectory::Avatars,
        filename: "../secret.png".to_string(),
        url: "/uploads/avatars/../secret.png".to_string(),
    };
    assert!(matches!(
        store.remove_new(&forged).await,
        Err(MediaError::InvalidName)
    ));
}

#[tokio::test]
async fn new_creates_and_canonicalizes_root() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("a").join("b");
    let store = ImageStore::with_default_concurrency(&nested).unwrap();
    assert!(store.root().is_absolute(), "root 应为 canonical 绝对路径");
    assert!(store.root().is_dir());
    let stored = store
        .save(MediaDirectory::Markers, "marker", rgb_jpeg(2, 2))
        .await
        .unwrap();
    assert!(store.root().join("markers").join(stored.filename).is_file());
}

/// 仅 Unix/Windows 视为支持 reparse 逃逸回归的平台；其他目标用 cfg 排除并记录。
#[cfg(any(unix, windows))]
#[tokio::test]
async fn rejects_reparse_escape_on_read() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    std::fs::write(outside.path().join("secret.png"), b"secret-bytes").unwrap();
    let store = store(root.path());
    std::fs::create_dir_all(root.path().join("avatars")).unwrap();

    // 优先测试“文件名本身是符号链接”的逃逸；Windows 无权限时改用目录 junction。
    let link = root.path().join("avatars").join("escape.png");
    let (name, describe) = match create_file_symlink(&outside.path().join("secret.png"), &link) {
        Ok(()) => ("escape.png", "文件符号链接"),
        Err(file_error) => {
            // 文件符号链接不可用时退回目录 reparse（Windows junction 无需管理员权限），
            // 通过中间目录逃逸同样验证 canonical root 检查。设施建立失败必须判失败。
            std::fs::remove_dir(root.path().join("avatars")).unwrap();
            create_dir_reparse(outside.path(), &root.path().join("avatars")).unwrap_or_else(
                |dir_error| {
                    panic!(
                        "无法建立 reparse 逃逸测试设施（文件符号链接: {file_error}; \
                         目录 reparse: {dir_error}）"
                    )
                },
            );
            ("secret.png", "目录 reparse/junction")
        }
    };
    eprintln!("[media-test] read 逃逸回归实际执行分支: {describe}");

    assert!(
        matches!(store.read("avatars", name).await, Err(MediaError::NotFound)),
        "越出 root 的 reparse 不得被 read"
    );
    assert!(
        matches!(store.open("avatars", name).await, Err(MediaError::NotFound)),
        "越出 root 的 reparse 不得被 open"
    );
    assert!(!store.exists("avatars", name).await.unwrap());
}

/// 仅 Unix/Windows 视为支持 reparse 逃逸回归的平台；其他目标用 cfg 排除并记录。
#[cfg(any(unix, windows))]
#[tokio::test]
async fn rejects_reparse_subdirectory_escape_on_save() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let store = store(root.path());
    create_dir_reparse(outside.path(), &root.path().join("avatars"))
        .unwrap_or_else(|error| panic!("无法建立 reparse 保存逃逸测试设施: {error}"));
    eprintln!("[media-test] save 逃逸回归实际执行分支: 目录 reparse/junction");

    let result = store
        .save(MediaDirectory::Avatars, "avatar", rgba_png(2, 2))
        .await;
    assert!(result.is_err(), "子目录指向 root 外时必须拒绝保存");
    assert!(list_files(outside.path()).is_empty(), "不得写入 root 之外");
}

#[cfg(unix)]
fn create_file_symlink(source: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, link)
}

#[cfg(windows)]
fn create_file_symlink(source: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(source, link)
}

/// 目录级 reparse 点：Unix 用符号链接，Windows 先试符号链接、失败则用 junction。
#[cfg(unix)]
fn create_dir_reparse(source: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, link)
}

#[cfg(windows)]
fn create_dir_reparse(source: &Path, link: &Path) -> std::io::Result<()> {
    if std::os::windows::fs::symlink_dir(source, link).is_ok() {
        return Ok(());
    }
    // `mklink /J` 创建 junction，普通用户即可，用于验证 reparse 逃逸。
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(source)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!("mklink /J 退出码 {status}")))
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

/// 构造带合法 IHDR（含 CRC）与占位 IDAT 的 PNG：`ImageReader` 能读出声明尺寸，
/// 但尺寸校验会在真正解码、分配巨大像素缓冲之前触发。
fn ihdr_png(width: u32, height: u32) -> Vec<u8> {
    let mut output = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    // 位深 8、颜色类型 6（RGBA）、压缩 0、过滤 0、隔行 0。
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    output.extend_from_slice(&png_chunk(b"IHDR", &ihdr));
    // 头部解析器会读到首个 IDAT 才认为信息完整；给一个不参与解码的占位 IDAT，
    // 使尺寸校验能在真正解码之前触发（无需分配巨大像素缓冲）。
    output.extend_from_slice(&png_chunk(
        b"IDAT",
        &[0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01],
    ));
    output.extend_from_slice(&png_chunk(b"IEND", &[]));
    output
}

/// 在第一个 PNG 块（IHDR）之后插入一个 `tEXt` 块，用于元数据丢弃测试。
fn inject_text_chunk(png: &[u8], keyword: &str, text: &str) -> Vec<u8> {
    assert!(png.len() > 8, "PNG 太短");
    let first_length = u32::from_be_bytes(png[8..12].try_into().unwrap()) as usize;
    let insert_at = 8 + 4 + 4 + first_length + 4;
    let mut data = Vec::new();
    data.extend_from_slice(keyword.as_bytes());
    data.push(0);
    data.extend_from_slice(text.as_bytes());
    let chunk = png_chunk(b"tEXt", &data);

    let mut output = Vec::with_capacity(png.len() + chunk.len());
    output.extend_from_slice(&png[..insert_at]);
    output.extend_from_slice(&chunk);
    output.extend_from_slice(&png[insert_at..]);
    output
}

fn png_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(12 + data.len());
    output.extend_from_slice(&(data.len() as u32).to_be_bytes());
    output.extend_from_slice(kind);
    output.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(kind);
    crc_input.extend_from_slice(data);
    output.extend_from_slice(&crc32(&crc_input).to_be_bytes());
    output
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}
