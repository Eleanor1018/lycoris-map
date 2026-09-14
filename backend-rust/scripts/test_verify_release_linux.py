#!/usr/bin/env python3
"""verify-release-linux.py 的边界针对性测试（仅标准库，不调用真实 Docker）。

覆盖温晓第三轮要求：
- 恶意宿主 URL 在**任何 Docker/Compose 操作之前**失败，且不发起任何调用；
- 隐式 `.env` 无法替换目标：已验证/默认值被显式固定进子进程 env，且禁用 Compose `.env`；
- guard failure 不会触发清理（不关闭其它正在运行的同项容器）；
- `--remove-test-volumes` 在目标非法时也不发起任何 Docker 调用；
- 证据写入失败必须返回非零。
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# 不在 scripts/ 生成 __pycache__（保持工作树干净）。
sys.dont_write_bytecode = True

MODULE_PATH = Path(__file__).resolve().with_name("verify-release-linux.py")
_spec = importlib.util.spec_from_file_location("verify_release_linux", MODULE_PATH)
mod = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mod)


def completed(argv, returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(argv, returncode, stdout, stderr)


@contextlib.contextmanager
def quiet():
    """吞掉被测函数自身输出，让测试运行输出保持可读。"""
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        yield


class FakeDocker:
    """记录每次 subprocess.run 调用的 argv/env，并按 Docker 子命令给出受控应答。"""

    def __init__(self, *, guard_rc: int = 0, fail_first: bool = False):
        self.calls: list[list[str]] = []
        self.envs: list[dict[str, str] | None] = []
        self.guard_rc = guard_rc
        self.fail_first = fail_first

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        self.envs.append(kwargs.get("env"))
        if self.fail_first:
            raise mod.VerifyError("stop-after-first-call")
        if argv[:3] == ["docker", "image", "inspect"]:
            stdout = "sha256:fake-image\n" if "--format" in argv else ""
            return completed(argv, 0, stdout)
        if argv[:2] == ["docker", "inspect"]:
            return completed(argv, 0, "running|healthy\n")
        if any("test-runner-guards.sh" in part for part in argv):
            if self.guard_rc == 0:
                return completed(argv, 0, "[guard] ok\n")
            return completed(argv, self.guard_rc, "", "[guard] FAIL: forced\n")
        return completed(argv, 0, "")

    def flat(self) -> str:
        return " ".join(" ".join(call) for call in self.calls)


class TargetValidationTests(unittest.TestCase):
    def test_resolve_accepts_defaults_and_explicit_fixture(self) -> None:
        self.assertEqual(mod.resolve_targets({}), (mod.DEFAULT_DATABASE_URL, mod.DEFAULT_REDIS_URL))
        explicit = "postgres://lycoris:other@host.docker.internal:55432/lycoris_rust"
        db, redis = mod.resolve_targets(
            {"RELEASE_DATABASE_URL": explicit, "RELEASE_REDIS_URL": "redis://host.docker.internal:56379"}
        )
        self.assertEqual(db, explicit)
        self.assertEqual(redis, "redis://host.docker.internal:56379")

    def test_resolve_rejects_unauthorized_targets(self) -> None:
        bad = [
            {"RELEASE_DATABASE_URL": "postgres://u:p@evil.example:55432/lycoris_rust"},
            {"RELEASE_DATABASE_URL": "postgres://u:p@host.docker.internal:55433/lycoris_rust"},
            {"RELEASE_DATABASE_URL": "postgres://u:p@host.docker.internal:55432/other"},
            {"RELEASE_DATABASE_URL": "postgres://u:p@host.docker.internal:55432/lycoris_rust?host=evil"},
            {"RELEASE_DATABASE_URL": "postgres://u:p@host.docker.internal:55432/lycoris_rust#frag"},
            {"RELEASE_REDIS_URL": "redis://evil.example:56379"},
            {"RELEASE_REDIS_URL": "redis://host.docker.internal:56380"},
            {"RELEASE_REDIS_URL": "redis://host.docker.internal:56379/0?x=1"},
        ]
        for env in bad:
            with self.subTest(env=env), self.assertRaises(mod.VerifyError):
                mod.resolve_targets(env)

    def test_pin_target_env_disables_dotenv(self) -> None:
        env: dict[str, str] = {}
        mod.pin_target_env(env, mod.DEFAULT_DATABASE_URL, mod.DEFAULT_REDIS_URL)
        self.assertEqual(env["RELEASE_DATABASE_URL"], mod.DEFAULT_DATABASE_URL)
        self.assertEqual(env["RELEASE_REDIS_URL"], mod.DEFAULT_REDIS_URL)
        self.assertEqual(env["COMPOSE_DISABLE_ENV_FILE"], "1")


class NoDockerBeforeValidationTests(unittest.TestCase):
    def test_malicious_host_url_makes_no_docker_call(self) -> None:
        fake = FakeDocker()
        with (
            mock.patch.object(subprocess, "run", side_effect=fake),
            mock.patch.dict(
                os.environ,
                {"RELEASE_DATABASE_URL": "postgres://u:p@evil.example:55432/lycoris_rust"},
                clear=True,
            ),
        ):
            with quiet():
                rc = mod.main([])
        self.assertEqual(rc, 1)
        self.assertEqual(fake.calls, [], f"目标非法却发起了 Docker 调用: {fake.flat()}")

    def test_invalid_target_with_remove_volumes_makes_no_docker_call(self) -> None:
        fake = FakeDocker()
        with (
            mock.patch.object(subprocess, "run", side_effect=fake),
            mock.patch.dict(
                os.environ,
                {"RELEASE_DATABASE_URL": "postgres://u:p@host.docker.internal:55432/lycoris_rust?x=1"},
                clear=True,
            ),
        ):
            with quiet():
                rc = mod.main(["--remove-test-volumes"])
        self.assertEqual(rc, 1)
        self.assertEqual(fake.calls, [], f"目标非法却发起了 Docker 调用: {fake.flat()}")


class EnvPinsAndCleanupTests(unittest.TestCase):
    def test_defaults_are_pinned_into_subprocess_env(self) -> None:
        fake = FakeDocker(fail_first=True)
        with (
            mock.patch.object(subprocess, "run", side_effect=fake),
            mock.patch.dict(os.environ, {}, clear=True),
        ):
            with quiet():
                rc = mod.main([])
        self.assertEqual(rc, 1)  # 第一处 Docker 调用被 fake 中止，但 env 已被记录
        self.assertTrue(fake.envs and fake.envs[0], "未捕获到子进程 env")
        env = fake.envs[0]
        assert env is not None
        self.assertEqual(env["RELEASE_DATABASE_URL"], mod.DEFAULT_DATABASE_URL)
        self.assertEqual(env["RELEASE_REDIS_URL"], mod.DEFAULT_REDIS_URL)
        self.assertEqual(env["COMPOSE_DISABLE_ENV_FILE"], "1")

    def test_guard_failure_does_not_cleanup_other_runs(self) -> None:
        fake = FakeDocker(guard_rc=1)
        with (
            mock.patch.object(subprocess, "run", side_effect=fake),
            mock.patch.dict(os.environ, {}, clear=True),
        ):
            with quiet():
                rc = mod.main(["--skip-migrate"])
        self.assertEqual(rc, 1)
        self.assertNotIn("down", fake.flat(), f"guard 失败不应触发 down: {fake.flat()}")
        self.assertNotIn("volume rm", fake.flat(), f"guard 失败不应删卷: {fake.flat()}")
        self.assertNotIn("docker exec", fake.flat(), "guard 失败前不应 exec 容器")


class EvidenceTests(unittest.TestCase):
    def test_evidence_write_failure_returns_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)  # 目录不可写为文件
            with quiet():
                self.assertEqual(mod.finalize_return_code(0, directory, {"k": "v"}), 1)

    def test_evidence_write_success_returns_success(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "evidence.json"
            with quiet():
                self.assertEqual(mod.finalize_return_code(0, path, {"k": "v"}), 0)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"k": "v"})

    def test_no_evidence_path_keeps_return_code(self) -> None:
        with quiet():
            self.assertEqual(mod.finalize_return_code(1, None, {"k": "v"}), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
