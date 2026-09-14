//! 图片存储与读取核心，以及阶段 2/3 的媒体业务编排。
//!
//! 拆分为两层：
//!
//! - [`storage`]（私有实现，经本模块重导出）：图片校验、解码重编码、原子落盘、安全
//!   读取、存在性检查与孤立新文件清理。它只处理磁盘媒体本身，**不做身份或权限判断**，
//!   也不解析 URL、不注册 HTTP 路由。
//! - [`service::MediaService`]：头像引用/条件更新、受控 `/uploads` 读取授权、点位图片
//!   提案提交与管理端审批/清理。身份由调用方以可信 [`modules::markers::model::Viewer`]
//!   传入，资源级可见性复用 `markers::model::can_view`，不另立身份系统。
//!
//! 关键边界：
//!
//! - 上传：压缩字节 1 字节以上、至多 5 MiB；只认真实 JPEG/PNG/GIF/WebP（按魔数，
//!   不看扩展名或 `Content-Type`）。先读头部尺寸，宽高各 `1..=10000` 且像素乘积
//!   `<= 25_000_000`，再限制解码内存（128 MiB 量级）并只解首帧；解码后复核尺寸。
//!   有 alpha 重编码为 PNG，否则为 JPEG（质量 75，接近 Java `ImageIO` 默认）；
//!   不复制源元数据（EXIF 等），彻底重编码。
//! - 并发：图片 CPU 处理在线程池执行；同一 [`ImageStore`] 共享一个并发许可池，
//!   默认 1 个任务。许可用 `try_acquire_owned` 获取后**移动进阻塞任务并持有到任务
//!   结束**，因此请求超时不会提前释放许可、也不会造成无限并发；无许可立即返回
//!   [`MediaError::Busy`]（由上层映射为 503），输入的 `Vec<u8>` 也不进入无限排队。
//! - 命名：文件名为 `prefix-UUID.ext`，`prefix` 由服务端提供并再次校验（仅 ASCII
//!   字母数字与 `-`）；URL 固定为 `/uploads/{directory}/{filename}`。
//! - 路径：`root` 由配置显式给出并在构造时创建、canonicalize；目录白名单仅
//!   `avatars`/`markers`；文件名限 `[A-Za-z0-9_.-]+` 且后缀属于白名单。解析出的
//!   canonical 路径必须落在 canonical root 内，最终项必须是普通文件，拒绝符号
//!   链接/reparse 跳出。读取失败一律按不存在处理，不泄露存在性。
//! - 磁盘：同目录临时文件写完并 `sync_all` 后，原子且**不覆盖已有文件**地落到最终
//!   名，Unix 上再尽力 `sync` 父目录；失败不返回 URL。中途取消可能留下可清理的孤立
//!   临时/最终文件，因此核心不在 `Drop` 中删除可能已被数据库提交引用的文件。
//! - 读取：HTTP 发送应使用 [`ImageStore::open`] 拿到 `tokio::fs::File` 并流式传输；
//!   [`ImageStore::read`] 只是带 [`MAX_READ_BYTES`] 上限的便利方法/测试辅助，避免把整张
//!   图片读入内存。
//!
//! 部署提醒：`root`（`UPLOAD_DIR`）应由服务运行用户独占写权限，避免其他本地用户
//! 放入可执行内容或替换目录；详见 `backend-rust/README.md`。本核心不引入 `unsafe`。

mod storage;

pub mod model;
pub mod repository;
pub mod service;

pub use model::{CleanupResult, PendingImageItem};
pub use repository::MediaRepository;
pub use service::{AvatarUpdateOutcome, MediaService, MediaServiceError};
pub use storage::{
    DECODE_MAX_ALLOC_BYTES, DEFAULT_CONCURRENCY, ImageBytes, ImageStore, MAX_DIMENSION, MAX_PIXELS,
    MAX_READ_BYTES, MAX_UPLOAD_BYTES, MediaDirectory, MediaError, OpenedImage, StoredImage,
    parse_media_url,
};
