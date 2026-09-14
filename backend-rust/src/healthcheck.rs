//! 容器健康检查辅助。
//!
//! `--healthcheck [path]` 对本地 HTTP 探针（默认 `/health/ready`）发起一次真实 GET 请求，
//! 只读取并校验**状态行本身**（必须在 [`MAX_STATUS_LINE`] 字节内以换行结束），不读/不解析
//! 响应体；连接、写与读共用同一个 deadline。仅当状态行为合法 `HTTP/1.0|1.1` + 3 位状态码且
//! 为 2xx 时以退出码 0 结束。
//!
//! 它只使用标准库，不读取 `DATABASE_URL`/`REDIS_URL`，因此可作为镜像 `HEALTHCHECK` 与演练
//! 探针真实执行。监听端口取 `SERVER_PORT`；**非法 SERVER_PORT 直接失败**，不静默回落默认值。
//! 可选探针路径只接受可打印 ASCII（拒绝空白/控制符与超长值），请求行不会被注入。

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use crate::config::DEFAULT_SERVER_PORT;

/// 连接超时上限。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
/// 连接 + 读写整体 deadline。
const TOTAL_TIMEOUT: Duration = Duration::from_secs(3);
/// 状态行最大读取字节数；超过即视为损坏/过长，不再继续读。
const MAX_STATUS_LINE: usize = 512;
/// 探针路径最大长度。
const MAX_PATH_LEN: usize = 512;
/// 默认探针路径：就绪探针同时校验 PG 与 Redis。
const DEFAULT_PATH: &str = "/health/ready";

/// 执行健康检查并返回进程退出码。
pub fn run(path: Option<String>) -> ExitCode {
    let port = match resolve_port() {
        Ok(port) => port,
        Err(message) => {
            eprintln!("healthcheck: {message}");
            return ExitCode::FAILURE;
        }
    };
    let path = match path {
        Some(raw) => match validate_path(&raw) {
            Some(path) => path,
            None => {
                // 不回显原始实参，避免把控制字符/日志注入写进输出。
                eprintln!(
                    "healthcheck: 探针路径非法（须为可打印 ASCII，且不超过 {MAX_PATH_LEN} 字节）"
                );
                return ExitCode::FAILURE;
            }
        },
        None => DEFAULT_PATH.to_string(),
    };

    match probe(port, &path) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => {
            eprintln!("healthcheck: 探针 {path} 未返回合法 2xx 状态");
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("healthcheck: 探针 {path} 失败: {error}");
            ExitCode::FAILURE
        }
    }
}

/// 解析 `SERVER_PORT`：未设置用默认值；设置为空或非法一律报错，不静默回落。
fn resolve_port() -> Result<u16, &'static str> {
    parse_port(std::env::var("SERVER_PORT").ok().as_deref())
}

fn parse_port(value: Option<&str>) -> Result<u16, &'static str> {
    match value {
        None => Ok(DEFAULT_SERVER_PORT),
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err("SERVER_PORT 为空");
            }
            trimmed
                .parse::<u16>()
                .map_err(|_| "SERVER_PORT 非法（需为 0-65535 的十进制整数）")
        }
    }
}

/// 校验可选探针路径：只允许可打印 ASCII，非空且不超长；必要时补前导 `/`。
fn validate_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_PATH_LEN {
        return None;
    }
    if !trimmed.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        return None;
    }
    Some(if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    })
}

/// 连接本机回环端口，发起极简 GET，只读状态行并判断是否为 2xx。
///
/// 写超时取同一 deadline 的剩余时间：连接 2s + 写 2s 会超过文档声称的 3s，这里统一收敛。
fn probe(port: u16, path: &str) -> std::io::Result<bool> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + TOTAL_TIMEOUT;

    let mut stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT)?;
    let write_budget = deadline.saturating_duration_since(Instant::now());
    if write_budget.is_zero() {
        return Ok(false);
    }
    stream.set_write_timeout(Some(write_budget))?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes())?;

    let mut buffer = [0u8; MAX_STATUS_LINE];
    let mut filled = 0usize;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(false);
        }
        stream.set_read_timeout(Some(remaining))?;
        let read = match stream.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                return Ok(false);
            }
            Err(error) => return Err(error),
        };
        filled += read;
        if buffer[..filled].contains(&b'\n') {
            break;
        }
        if filled == MAX_STATUS_LINE {
            // 状态行过长或损坏，无需继续读取（也避免读入大响应体）。
            return Ok(false);
        }
    }
    Ok(is_2xx_status(&buffer[..filled]))
}

/// 校验完整状态行：必须出现首个 `LF`，且其前内容为
/// `HTTP/1.0|HTTP/1.1` + 单个空格 + 3 位状态码；状态码为 2xx。
///
/// 只在首个 `LF` 之前解析，因此状态行之后的二进制响应体不会被当作 UTF-8 误判；
/// 没有换行（例如 EOF 截断）一律拒绝。
fn is_2xx_status(bytes: &[u8]) -> bool {
    let Some(newline) = bytes.iter().position(|byte| *byte == b'\n') else {
        return false;
    };
    let line = &bytes[..newline];
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    let Ok(text) = std::str::from_utf8(line) else {
        return false;
    };

    let mut parts = text.split(' ');
    let version = parts.next().unwrap_or_default();
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return false;
    }
    let code = parts.next().unwrap_or_default();
    if code.len() != 3 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    matches!(code.parse::<u16>(), Ok(value) if (200..300).contains(&value))
}

#[cfg(test)]
mod tests {
    use super::{is_2xx_status, parse_port, probe, validate_path};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// 启动一次性本地服务：接受一个连接、读掉请求，再写回给定响应。
    fn serve_once(response: Vec<u8>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定本地测试端口失败");
        let port = listener.local_addr().expect("读取本地端口失败").port();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut scratch = [0u8; 1024];
                let _ = stream.read(&mut scratch);
                // 客户端只读状态行即关闭时，写响应体可能失败，测试忽略。
                let _ = stream.write_all(&response);
            }
        });
        port
    }

    #[test]
    fn probe_accepts_2xx_without_reading_body() {
        let mut response = b"HTTP/1.1 200 OK\r\nContent-Length: 10485760\r\n\r\n".to_vec();
        response.extend(std::iter::repeat_n(b'x', 1024 * 1024));
        let port = serve_once(response);
        assert!(probe(port, "/health/ready").expect("探针不应报 IO 错"));
    }

    #[test]
    fn probe_rejects_non_2xx() {
        let port = serve_once(b"HTTP/1.1 503 Service Unavailable\r\n\r\n".to_vec());
        assert!(!probe(port, "/health/ready").expect("探针不应报 IO 错"));
    }

    #[test]
    fn probe_rejects_overlong_status_line() {
        let port = serve_once(vec![b'a'; 600]);
        assert!(!probe(port, "/health/ready").expect("探针不应报 IO 错"));
    }

    #[test]
    fn probe_rejects_corrupt_status_line() {
        let port = serve_once(b"not-http\r\n".to_vec());
        assert!(!probe(port, "/health/ready").expect("探针不应报 IO 错"));
    }

    #[test]
    fn probe_rejects_missing_newline_eof() {
        // 状态行未以 LF 结束（连接在行中途关闭）必须拒绝，不能把残缺首块当状态。
        let port = serve_once(b"HTTP/1.1 200 OK".to_vec());
        assert!(!probe(port, "/health/ready").expect("探针不应报 IO 错"));
    }

    #[test]
    fn probe_accepts_2xx_with_non_utf8_body() {
        // 状态行完整；其后的二进制 body 不属于状态行，不应参与 UTF-8 解析。
        let mut response = b"HTTP/1.1 200 OK\r\n".to_vec();
        response.extend_from_slice(&[0xff, 0xfe, 0x00, 0x80, 0x0a, 0xc3, 0x28]);
        let port = serve_once(response);
        assert!(probe(port, "/health/ready").expect("探针不应报 IO 错"));
    }

    #[test]
    fn status_line_parser_is_strict() {
        assert!(is_2xx_status(b"HTTP/1.1 200 OK\r\n"));
        assert!(is_2xx_status(b"HTTP/1.0 204 No Content\n"));
        assert!(is_2xx_status(b"HTTP/1.1 200 OK\r\n\xff\xfe binary body"));
        assert!(!is_2xx_status(b"HTTP/1.1 301 Moved\r\n"));
        assert!(!is_2xx_status(b"HTTP/1.1 20 OK\r\n"));
        assert!(!is_2xx_status(b"HTTP/1.1 abc OK\r\n"));
        assert!(!is_2xx_status(b"HTTP/broken 200 OK\r\n"));
        assert!(!is_2xx_status(b"HTTP/2.0 200 OK\r\n"));
        assert!(!is_2xx_status(b"HTTP/1.1 200"));
        assert!(!is_2xx_status(b"200 OK\r\n"));
        assert!(!is_2xx_status(b"\xff\xfe\r\n"));
    }

    #[test]
    fn path_validation_rejects_injection_and_overlong() {
        assert_eq!(
            validate_path("/health/ready").as_deref(),
            Some("/health/ready")
        );
        assert_eq!(
            validate_path("health/ready").as_deref(),
            Some("/health/ready")
        );
        assert_eq!(
            validate_path("/api/markers/public?lat=1").as_deref(),
            Some("/api/markers/public?lat=1")
        );
        assert!(validate_path("").is_none());
        assert!(validate_path("   ").is_none());
        assert!(validate_path("/a b").is_none());
        assert!(validate_path("/a\r\nHost: evil").is_none());
        assert!(validate_path(&format!("/{}", "x".repeat(600))).is_none());
    }

    #[test]
    fn port_parsing_never_silently_defaults_on_invalid() {
        assert_eq!(
            parse_port(None).expect("未设置应回落默认"),
            super::DEFAULT_SERVER_PORT
        );
        assert_eq!(parse_port(Some(" 18081 ")).expect("合法端口"), 18081);
        assert!(parse_port(Some("")).is_err());
        assert!(parse_port(Some("abc")).is_err());
        assert!(parse_port(Some("70000")).is_err());
    }
}
