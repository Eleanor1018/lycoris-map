#!/usr/bin/env python3
"""从仓库根启动 Rust 后端的本地开发启动器（仅标准库，跨平台）。

用法：
    python backend-rust/scripts/run-local.py [Rust CLI 参数...]

行为：
- 可选读取 backend-rust/.env（UTF-8，容忍 BOM）；进程已有环境变量优先。
- .env 只支持 `KEY=value`、注释(#)与空行，以及一对包围引号；键须匹配常见环境变量名
  [A-Za-z_][A-Za-z0-9_]*。不做任何插值或命令执行，值中的 `$`、`#`、`=` 原样保留，
  不接受 `export` 语法；非法行只报告行号，绝不回显内容。
- 读取文件失败（权限/编码）时简短失败，不打印原始行或配置内容。
- 默认 SQLX_OFFLINE=true、CARGO_BUILD_JOBS=2（不覆盖已存在的值）。
- 在 backend-rust/ 目录以参数列表启动 `cargo run --locked -- <用户参数>`，退出码原样透传；
  启动日志只说明启动 Rust，不拼接 argv，避免误输参数被复制到日志。
- 不复制/覆盖任何文件、不建库、不启动 Docker；迁移仅在用户显式传入 --migrate 时交给 Rust。
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

CRATE = Path(__file__).resolve().parent.parent
ENV_FILE = CRATE / ".env"
REQUIRED = ("DATABASE_URL", "REDIS_URL")
QUOTE_CHARS = ("'", '"')
KEY_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def parse_env_lines(text: str) -> tuple[dict[str, str], list[int]]:
    """解析 .env 文本，返回 (键值对, 非法行行号列表)。纯函数，不回显内容。"""
    values: dict[str, str] = {}
    errors: list[int] = []
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            errors.append(lineno)
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if not KEY_PATTERN.fullmatch(key):
            errors.append(lineno)
            continue
        if "\x00" in value:
            errors.append(lineno)
            continue
        # 只去掉一对成对包围引号；不插值、不转义，其余原样保留。
        if value and value[0] in QUOTE_CHARS:
            if len(value) < 2 or value[-1] != value[0]:
                errors.append(lineno)
                continue
            value = value[1:-1]
        elif value and value[-1] in QUOTE_CHARS:
            errors.append(lineno)
            continue
        values[key] = value
    return values, errors


def read_env_file(path: Path) -> tuple[dict[str, str], list[int]]:
    """读取给定 .env（不存在视为空）；UTF-8 且容忍 BOM。读取失败向上抛出。"""
    if not path.is_file():
        return {}, []
    return parse_env_lines(path.read_text(encoding="utf-8-sig"))


def apply_env(base: dict[str, str], parsed: dict[str, str]) -> dict[str, str]:
    """把 .env 值合并进基环境；已存在的键（进程环境）优先，不被 .env 覆盖。"""
    merged = dict(base)
    for key, value in parsed.items():
        if key not in merged:
            merged[key] = value
    return merged


def launch(
    argv: list[str],
    base_env: dict[str, str] | None = None,
    env_path: Path | None = None,
    runner=None,
) -> int:
    """组装环境并启动 cargo；返回子进程退出码。runner 仅供测试注入。"""
    base = dict(os.environ) if base_env is None else dict(base_env)
    path = ENV_FILE if env_path is None else env_path

    try:
        parsed, errors = read_env_file(path)
    except (OSError, UnicodeError):
        print(
            f"错误：无法读取 {path}（权限或编码问题）；未改动环境，也未回显文件内容。",
            file=sys.stderr,
        )
        return 2
    if errors:
        joined = ", ".join(str(n) for n in errors)
        print(
            f"错误：{path} 第 {joined} 行格式非法（应为 KEY=value、注释或空行）；未回显该行内容。",
            file=sys.stderr,
        )
        return 2

    env = apply_env(base, parsed)
    env.setdefault("SQLX_OFFLINE", "true")
    env.setdefault("CARGO_BUILD_JOBS", "2")

    missing = [name for name in REQUIRED if not env.get(name, "").strip()]
    if missing:
        print(f"错误：缺少必填配置 {'、'.join(missing)}。", file=sys.stderr)
        print(
            "请在 backend-rust/.env 中设置（可参考 backend-rust/.env.example），"
            "或先导出同名环境变量；仅使用本机合成开发库。",
            file=sys.stderr,
        )
        return 2

    command = ["cargo", "run", "--locked", "--", *argv]
    print(f"[run-local] 在 {CRATE} 启动 Rust 后端（cargo run --locked）")

    invoke = subprocess.call if runner is None else runner
    try:
        return invoke(command, cwd=CRATE, env=env)
    except FileNotFoundError:
        print(
            "错误：找不到 cargo。请安装 Rust 工具链并确保 PATH 可访问"
            "（版本见 backend-rust/rust-toolchain.toml）。",
            file=sys.stderr,
        )
        return 127
    except KeyboardInterrupt:
        # 子进程已随同一信号停止，这里返回标准中断码。
        return 130


def configure_stdio() -> None:
    """入口把 stdout/stderr 设为 UTF-8，避免 Windows 管道 cp1252 下中文日志抛 UnicodeEncodeError。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main() -> int:
    configure_stdio()
    return launch(list(sys.argv[1:]))


if __name__ == "__main__":
    raise SystemExit(main())
