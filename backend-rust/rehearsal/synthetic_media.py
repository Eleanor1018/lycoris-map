#!/usr/bin/env python3
"""确定性合成图片生成（纯标准库）。

用途
    为演练生成受控 PNG 头像与点位图片，落到演练临时上传目录；不含任何真实数据。
    图像字节完全由 (kind, id) 决定，可重复生成、可校验 sha256。

命名约定（必须与 sql/02_synthetic_seed.sql 中的引用规则一致）
    - 头像：users.id 满足 id % 3 == 0 时 avatar_url = /uploads/avatars/synth-avatar-<id>.png
    - 点位：map_markers.id 满足 id % 41 == 0 时 mark_image = /uploads/markers/synth-marker-<id>.png

用法
    python synthetic_media.py --out <work-dir>/uploads --users 20 --markers 5000
"""

from __future__ import annotations

import argparse
import hashlib
import struct
import sys
import zlib
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

AVATAR_MODULO = 3
MARKER_MODULO = 41
AVATAR_SIZE = 64
MARKER_SIZE = 192


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def png_bytes(width: int, height: int, seed: int) -> bytes:
    """RGB 渐变 PNG；字节由 seed 决定。"""
    r0, g0, b0 = (seed * 37) % 256, (seed * 91 + 17) % 256, (seed * 53 + 29) % 256
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # filter type 0
        for x in range(width):
            r = (r0 + (x * 255) // max(width - 1, 1)) % 256
            g = (g0 + (y * 255) // max(height - 1, 1)) % 256
            b = (b0 + ((x + y) * 255) // max(width + height - 2, 1)) % 256
            rows += bytes((r, g, b))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + _chunk(b"IEND", b"")
    )


def avatar_entries(user_count: int) -> list[tuple[int, str]]:
    return [
        (i, f"synth-avatar-{i}.png")
        for i in range(1, user_count + 1)
        if i % AVATAR_MODULO == 0
    ]


def marker_entries(marker_count: int) -> list[tuple[int, str]]:
    return [
        (i, f"synth-marker-{i}.png")
        for i in range(1, marker_count + 1)
        if i % MARKER_MODULO == 0
    ]


def write_media(upload_root: Path, *, users: int, markers: int) -> dict[str, object]:
    avatars_dir = upload_root / "avatars"
    markers_dir = upload_root / "markers"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    markers_dir.mkdir(parents=True, exist_ok=True)
    written: list[dict[str, str]] = []
    for uid, name in avatar_entries(users):
        data = png_bytes(AVATAR_SIZE, AVATAR_SIZE, uid * 7 + 1)
        (avatars_dir / name).write_bytes(data)
        written.append(
            {
                "path": f"avatars/{name}",
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    for mid, name in marker_entries(markers):
        data = png_bytes(MARKER_SIZE, MARKER_SIZE, mid * 13 + 5)
        (markers_dir / name).write_bytes(data)
        written.append(
            {
                "path": f"markers/{name}",
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    combined = hashlib.sha256(
        "\n".join(f"{e['path']}:{e['sha256']}" for e in written).encode("utf-8")
    ).hexdigest()
    return {
        "users": users,
        "markers": markers,
        "fileCount": len(written),
        "combinedSha256": combined,
        "files": written,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="生成确定性合成 PNG（头像/点位）")
    parser.add_argument("--out", type=Path, help="上传根目录")
    parser.add_argument("--users", type=int, default=20)
    parser.add_argument("--markers", type=int, default=5000)
    parser.add_argument("--selftest", action="store_true", help="只验证 PNG 编码正确性")
    return parser


def _selftest() -> int:
    """验证生成的 PNG 签名、IHDR 尺寸与 IDAT 解压行数。"""
    data = png_bytes(8, 8, 42)
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        print("[media] FAIL 签名")
        return 1
    if data[12:16] != b"IHDR":
        print("[media] FAIL 缺少 IHDR")
        return 1
    width, height, depth, color = struct.unpack(">IIBB", data[16:26])
    if (width, height, depth, color) != (8, 8, 8, 2):
        print(f"[media] FAIL IHDR {(width, height, depth, color)}")
        return 1
    idx = data.index(b"IDAT") - 4
    idat_len = struct.unpack(">I", data[idx : idx + 4])[0]
    raw = zlib.decompress(data[idx + 8 : idx + 8 + idat_len])
    if len(raw) != height * (1 + width * 3):
        print("[media] FAIL IDAT 长度")
        return 1
    print("[media] self-test OK（PNG 签名/IHDR/IDAT）")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.selftest:
        return _selftest()
    if args.out is None:
        parser.error("--out 必填（除非 --selftest）")
    if args.users <= 0 or args.markers <= 0:
        print("[error] users/markers 必须为正", file=sys.stderr)
        return 1
    summary = write_media(args.out, users=args.users, markers=args.markers)
    print(
        f"[media] 生成 {summary['fileCount']} 个文件 -> {args.out} "
        f"(combined sha256 {summary['combinedSha256'][:16]}…)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
