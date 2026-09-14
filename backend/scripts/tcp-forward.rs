//! 测试运行器专用的极简 TCP 回环转发器（仅标准库，`rustc -O` 直接编译）。
//!
//! 用途：在受控 Linux 测试容器内，把已授权的合成服务转发到容器回环 `127.0.0.1`，满足
//! `tests/common/mod.rs` 的**回环地址强制校验**。它只做字节转发，不解析协议、不记录内容。
//!
//! 安全边界（本转发器自身强制，不依赖调用方）：
//!   - `TCP_FORWARD_LISTEN` 必须是回环地址（`127.0.0.1`）；拒绝 `0.0.0.0`/外部/主机名；
//!   - `TCP_FORWARD_UPSTREAM` 只允许 `host.docker.internal:55432` 或 `host.docker.internal:56379`；
//!   - 监听端口必须等于上游端口（不跨接、不转 55433 等恢复环境）。
//!
//! 通过环境变量配置：
//!   TCP_FORWARD_LISTEN    监听地址，例如 `127.0.0.1:55432`
//!   TCP_FORWARD_UPSTREAM  上游地址，例如 `host.docker.internal:55432`
//!
//! 限制：只应指向温晓授权的合成测试服务；绝不指向 `lycoris-restore-review`、恢复库或生产地址。

use std::env;
use std::io::{self};
use std::net::{SocketAddr, Shutdown, TcpListener, TcpStream};
use std::process::ExitCode;
use std::thread;

/// 唯一允许的上游主机（Docker Desktop 到宿主合成服务的固定别名）。
const ALLOWED_UPSTREAM_HOST: &str = "host.docker.internal";
/// 唯一允许的上游端口：合成 PostgreSQL / Redis。
const ALLOWED_PORTS: [u16; 2] = [55432, 56379];

fn main() -> ExitCode {
    let listen = match env::var("TCP_FORWARD_LISTEN") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("tcp-forward: 缺少 TCP_FORWARD_LISTEN");
            return ExitCode::FAILURE;
        }
    };
    let upstream = match env::var("TCP_FORWARD_UPSTREAM") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("tcp-forward: 缺少 TCP_FORWARD_UPSTREAM");
            return ExitCode::FAILURE;
        }
    };

    let listen_addr = match validate_listen(&listen) {
        Ok(addr) => addr,
        Err(reason) => {
            eprintln!("tcp-forward: 监听地址被拒绝（{reason}）");
            return ExitCode::FAILURE;
        }
    };
    if let Err(reason) = validate_upstream(&upstream, listen_addr.port()) {
        eprintln!("tcp-forward: 上游地址被拒绝（{reason}）");
        return ExitCode::FAILURE;
    }

    let listener = match TcpListener::bind(listen_addr) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("tcp-forward: 监听失败: {error}");
            return ExitCode::FAILURE;
        }
    };
    eprintln!("tcp-forward: {listen_addr} -> host.docker.internal:{}", listen_addr.port());

    for incoming in listener.incoming() {
        match incoming {
            Ok(client) => {
                let target = upstream.clone();
                // 每个连接独立线程；测试连接数有限，连接关闭后线程随之结束。
                thread::spawn(move || forward(client, &target));
            }
            Err(error) => eprintln!("tcp-forward: accept 失败: {error}"),
        }
    }
    ExitCode::SUCCESS
}

/// 监听地址必须是数值回环地址（拒绝 `0.0.0.0`、外部地址与主机名）。
fn validate_listen(raw: &str) -> Result<SocketAddr, &'static str> {
    let addr: SocketAddr = raw
        .parse()
        .map_err(|_| "必须是 127.0.0.1:<port> 形式的回环地址")?;
    if !addr.ip().is_loopback() {
        return Err("只允许回环地址 127.0.0.1");
    }
    Ok(addr)
}

/// 上游只允许 host.docker.internal 上的两个合成端口，且端口与监听一致。
fn validate_upstream(raw: &str, listen_port: u16) -> Result<(), &'static str> {
    let (host, port) = raw
        .rsplit_once(':')
        .ok_or("必须是 host:port 形式")?;
    if host != ALLOWED_UPSTREAM_HOST {
        return Err("只允许 host.docker.internal");
    }
    let port: u16 = port.parse().map_err(|_| "端口非法")?;
    if !ALLOWED_PORTS.contains(&port) {
        return Err("只允许 55432 或 56379");
    }
    if port != listen_port {
        return Err("监听端口必须与上游端口一致");
    }
    Ok(())
}

/// 建立上游连接并双向拷贝，任一侧结束即关闭对端写方向。
fn forward(client: TcpStream, upstream: &str) {
    let server = match TcpStream::connect(upstream) {
        Ok(server) => server,
        Err(_) => return,
    };
    let _ = client.set_nodelay(true);
    let _ = server.set_nodelay(true);

    let (mut client_reader, mut server_writer) = match (client.try_clone(), server.try_clone()) {
        (Ok(client_reader), Ok(server_writer)) => (client_reader, server_writer),
        _ => return,
    };
    let mut client_writer = client;
    let mut server_reader = server;

    let upward = thread::spawn(move || {
        let _ = io::copy(&mut client_reader, &mut server_writer);
        let _ = server_writer.shutdown(Shutdown::Write);
    });
    let downward = thread::spawn(move || {
        let _ = io::copy(&mut server_reader, &mut client_writer);
        let _ = client_writer.shutdown(Shutdown::Write);
    });
    let _ = upward.join();
    let _ = downward.join();
}
