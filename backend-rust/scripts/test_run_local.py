#!/usr/bin/env python3
"""run-local.py 的针对性检查（仅标准库）：解析与 mock 测试使用临时配置，
另有真实 Cargo --help 进程检查，会读取可选本地 .env，但不连接数据库。

覆盖启动契约：.env 解析（严格键名、无插值、一对引号、$/#/= 原样）、进程环境优先、
非法配置/秘密字符串不泄露、文件读取失败简短失败，以及子进程 cwd/参数/默认环境/退出码转交。
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

MODULE_PATH = Path(__file__).resolve().with_name("run-local.py")
_spec = importlib.util.spec_from_file_location("run_local", MODULE_PATH)
mod = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mod)

CREDS_DB = "postgres://user:supersecret@127.0.0.1:55432/lycoris_rust"
CREDS_REDIS = "redis://127.0.0.1:56379"


class FakeRunner:
    """记录调用参数并按需返回退出码或模拟 cargo 缺失；绝不真正启动进程。"""

    def __init__(self, code: int = 0, raise_missing: bool = False):
        self.calls: list[dict] = []
        self.code = code
        self.raise_missing = raise_missing

    def __call__(self, command, cwd=None, env=None):
        self.calls.append({"command": list(command), "cwd": cwd, "env": env})
        if self.raise_missing:
            raise FileNotFoundError("cargo")
        return self.code


def absent_env_path() -> Path:
    tmp = tempfile.NamedTemporaryFile(delete=False)
    tmp.close()
    path = Path(tmp.name)
    path.unlink()
    return path


class ParseTests(unittest.TestCase):
    def test_comments_quotes_blank_and_no_interpolation(self) -> None:
        text = (
            "# comment\n"
            "\n"
            "DATABASE_URL=literal\n"
            'QUOTED="a b"\n'
            "LITERAL=${DATABASE_URL}\n"
            "ADMIN_SECOND_PASSWORD_HASH=$2b$10$abc=def\n"
            "FRAGMENT=a#b\n"
        )
        values, errors = mod.parse_env_lines(text)
        self.assertEqual(errors, [])
        self.assertEqual(values["DATABASE_URL"], "literal")
        self.assertEqual(values["QUOTED"], "a b")
        self.assertEqual(values["LITERAL"], "${DATABASE_URL}")
        self.assertEqual(values["ADMIN_SECOND_PASSWORD_HASH"], "$2b$10$abc=def")
        self.assertEqual(values["FRAGMENT"], "a#b")

    def test_invalid_line_reports_line_number(self) -> None:
        values, errors = mod.parse_env_lines("# c\nNOEQUALS\nKEY=ok\n")
        self.assertEqual(errors, [2])
        self.assertEqual(values, {"KEY": "ok"})

    def test_key_charset_is_enforced(self) -> None:
        values, errors = mod.parse_env_lines(
            "export KEY=value\n1KEY=x\nK-EY=x\nA_1=ok\n_x=ok\nlower=ok\n"
        )
        self.assertEqual(errors, [1, 2, 3])
        self.assertEqual(values, {"A_1": "ok", "_x": "ok", "lower": "ok"})

    def test_value_nul_and_unmatched_quotes_rejected(self) -> None:
        values, errors = mod.parse_env_lines('A=ab\x00cd\nB="unterminated\nC=trailing"\nD=""\n')
        self.assertEqual(errors, [1, 2, 3])
        self.assertEqual(values, {"D": ""})


class LaunchTests(unittest.TestCase):
    def test_process_env_priority_and_file_applied(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                f"DATABASE_URL=file-db\nOTHER=file-other\nREDIS_URL={CREDS_REDIS}\n",
                encoding="utf-8-sig",
            )
            fake = FakeRunner(code=5)
            with contextlib.redirect_stdout(io.StringIO()):
                rc = mod.launch(
                    ["--migrate"],
                    base_env={"DATABASE_URL": "proc-db", "REDIS_URL": CREDS_REDIS},
                    env_path=env_file,
                    runner=fake,
                )
        self.assertEqual(rc, 5)
        call = fake.calls[0]
        self.assertEqual(call["command"], ["cargo", "run", "--locked", "--", "--migrate"])
        self.assertEqual(call["cwd"], mod.CRATE)
        self.assertEqual(call["env"]["DATABASE_URL"], "proc-db")
        self.assertEqual(call["env"]["OTHER"], "file-other")
        self.assertEqual(call["env"]["SQLX_OFFLINE"], "true")
        self.assertEqual(call["env"]["CARGO_BUILD_JOBS"], "2")

    def test_startup_log_omits_argv(self) -> None:
        fake = FakeRunner()
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = mod.launch(
                ["--migrate"],
                base_env={"DATABASE_URL": CREDS_DB, "REDIS_URL": CREDS_REDIS},
                env_path=absent_env_path(),
                runner=fake,
            )
        self.assertEqual(rc, 0)
        log = out.getvalue()
        self.assertIn("启动 Rust", log)
        self.assertNotIn("--migrate", log)

    def test_missing_required_rejected_without_launch_and_without_secret(self) -> None:
        fake = FakeRunner()
        wrong = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(wrong):
            rc = mod.launch(
                [],
                base_env={"DATABASE_URL": CREDS_DB},
                env_path=absent_env_path(),
                runner=fake,
            )
        self.assertEqual(rc, 2)
        self.assertEqual(fake.calls, [])
        message = wrong.getvalue()
        self.assertIn("REDIS_URL", message)
        self.assertNotIn("supersecret", message)

    def test_invalid_config_does_not_leak_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(f'DATABASE_URL="{CREDS_DB}\n', encoding="utf-8")
            fake = FakeRunner()
            wrong = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(wrong):
                rc = mod.launch(
                    [],
                    base_env={"REDIS_URL": CREDS_REDIS},
                    env_path=env_file,
                    runner=fake,
                )
        self.assertEqual(rc, 2)
        self.assertEqual(fake.calls, [])
        self.assertNotIn("supersecret", wrong.getvalue())

    def test_read_failure_is_short_and_hides_contents(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_bytes(b"DATABASE_URL=\xff\xfe\x00\x01\n")
            fake = FakeRunner()
            wrong = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(wrong):
                rc = mod.launch(
                    [],
                    base_env={"DATABASE_URL": CREDS_DB, "REDIS_URL": CREDS_REDIS},
                    env_path=env_file,
                    runner=fake,
                )
        self.assertEqual(rc, 2)
        self.assertEqual(fake.calls, [])
        message = wrong.getvalue()
        self.assertIn("无法读取", message)
        self.assertNotIn("DATABASE_URL=", message)

    def test_cargo_missing_reports_clear_error(self) -> None:
        fake = FakeRunner(raise_missing=True)
        wrong = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(wrong):
            rc = mod.launch(
                [],
                base_env={"DATABASE_URL": CREDS_DB, "REDIS_URL": CREDS_REDIS},
                env_path=absent_env_path(),
                runner=fake,
            )
        self.assertEqual(rc, 127)
        self.assertIn("cargo", wrong.getvalue())


class RealProcessTests(unittest.TestCase):
    """真实子进程检查：管道编码为 cp1252 时仍能启动并透传 Rust 帮助（不连库）。"""

    def test_help_succeeds_under_cp1252_pipe(self) -> None:
        if shutil.which("cargo") is None:
            self.skipTest("cargo 不可用，跳过真实子进程检查")
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "cp1252"
        # 进程环境覆盖必填连接配置；--help 只显示帮助，不连接数据库或输出配置。
        env["DATABASE_URL"] = CREDS_DB
        env["REDIS_URL"] = CREDS_REDIS
        proc = subprocess.run(
            [sys.executable, str(MODULE_PATH), "--help"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=900,
        )
        self.assertEqual(proc.returncode, 0, f"stderr:\n{proc.stderr}")
        self.assertNotIn("UnicodeEncodeError", proc.stderr)
        self.assertNotIn("Traceback", proc.stderr)
        self.assertIn("用法", proc.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
