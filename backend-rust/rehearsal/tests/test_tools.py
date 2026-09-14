#!/usr/bin/env python3
"""演练工具单元/集成测试（纯标准库，无需 Docker/PG）。

运行：python backend-rust/rehearsal/tests/test_tools.py
覆盖：Sampler 真实 start/stop、负载边界、worker 致命异常上报、有界请求窗口、
零成功拒绝、401 计入错误、切换失败重冻结、generation 复用/损坏/启动前登记、
Cookie 严格 401、响应上限溢出检测。
"""

from __future__ import annotations

import http.server
import hashlib
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

REHEARSAL = Path(__file__).resolve().parent.parent
if str(REHEARSAL) not in sys.path:
    sys.path.insert(0, str(REHEARSAL))

import bench_core  # noqa: E402
import switching  # noqa: E402


def _start_server(handler_cls):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


class _JsonHandler(http.server.BaseHTTPRequestHandler):
    status = 200
    body = b"[]"

    def _respond(self) -> None:
        self.send_response(self.status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(self.body)

    def do_GET(self) -> None:  # noqa: N802
        self._respond()

    def do_POST(self) -> None:  # noqa: N802
        self._respond()

    def log_message(self, *args) -> None:  # noqa: D102
        pass


class TestSampler(unittest.TestCase):
    def test_start_stop_real(self) -> None:
        class Fake(bench_core.Sampler):
            def _sample_once(self) -> None:
                self.samples.append(bench_core.Sample(1, 0.1, 2, 0.01))

        sampler = Fake("dummy-container", interval=0.05)
        sampler.start()
        time.sleep(0.25)
        samples = sampler.stop_collect()
        self.assertGreaterEqual(len(samples), 1)
        self.assertFalse(sampler.is_alive())
        self.assertFalse(sampler.stop_failed)

    def test_stop_event_not_shadowing_thread_method(self) -> None:
        sampler = bench_core.Sampler("dummy")
        self.assertIn("_stop_event", vars(sampler))
        self.assertNotIn("_stop", vars(sampler))
        thread_stop = getattr(threading.Thread, "_stop", None)
        if thread_stop is not None:
            self.assertTrue(callable(sampler._stop))


class TestLoadBounds(unittest.TestCase):
    def test_rejects_unbounded(self) -> None:
        invalid = [
            dict(warmup=1, duration=float("inf"), concurrency=1, repeats=1, request_timeout=5),
            dict(warmup=1, duration=float("nan"), concurrency=1, repeats=1, request_timeout=5),
            dict(warmup=-1, duration=5, concurrency=1, repeats=1, request_timeout=5),
            dict(warmup=1, duration=5, concurrency=33, repeats=1, request_timeout=5),
            dict(warmup=1, duration=5, concurrency=0, repeats=1, request_timeout=5),
            dict(warmup=1, duration=5, concurrency=1, repeats=0, request_timeout=5),
            dict(warmup=1, duration=5, concurrency=1, repeats=6, request_timeout=5),
            dict(warmup=1, duration=5, concurrency=1, repeats=1, request_timeout=999),
        ]
        for kwargs in invalid:
            with self.assertRaises(bench_core.BenchError, msg=str(kwargs)):
                bench_core.validate_load_args(**kwargs)

    def test_accepts_bounded(self) -> None:
        bench_core.validate_load_args(warmup=10, duration=20, concurrency=8, repeats=3, request_timeout=10)


class TestWorkerHandling(unittest.TestCase):
    def test_fatal_exception_is_reported(self) -> None:
        original = bench_core._read_request

        def boom(*args, **kwargs):
            raise ValueError("boom")

        bench_core._read_request = boom
        try:
            stats, stuck = bench_core.run_workers(
                scenario="read", base_url="http://127.0.0.1:1", duration=0.3, concurrency=2,
                seed=1, marker_ids=[1], usernames=["u"], password="p", request_timeout=1,
            )
        finally:
            bench_core._read_request = original
        self.assertEqual(stuck, [])
        self.assertTrue(stats.fatal_errors, stats.fatal_errors)

    def test_bounded_window_and_all_threads_finish(self) -> None:
        server, port = _start_server(_JsonHandler)
        try:
            started = time.monotonic()
            stats, stuck = bench_core.run_workers(
                scenario="read", base_url=f"http://127.0.0.1:{port}", duration=0.5,
                concurrency=4, seed=7, marker_ids=[1, 2, 3], usernames=["u"],
                password="p", request_timeout=2,
            )
            elapsed = time.monotonic() - started
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(stuck, [])
        self.assertGreaterEqual(stats.total, 1)
        self.assertEqual(stats.success, stats.total)
        self.assertGreaterEqual(elapsed, 0.4)
        self.assertLess(elapsed, 5.0)

    def test_zero_success_rejected(self) -> None:
        class FailHandler(_JsonHandler):
            status = 500

        server, port = _start_server(FailHandler)
        try:
            stats, _ = bench_core.run_workers(
                scenario="read", base_url=f"http://127.0.0.1:{port}", duration=0.3,
                concurrency=2, seed=3, marker_ids=[1], usernames=["u"], password="p",
                request_timeout=2,
            )
        finally:
            server.shutdown()
            server.server_close()
        self.assertGreater(stats.total, 0)
        self.assertEqual(stats.success, 0)
        result = bench_core.RoundResult(0, stats, "", "", 0.3, [])
        with self.assertRaises(bench_core.BenchError):
            bench_core.assert_meaningful(result, "read")

    def test_401_counted_as_error_not_success(self) -> None:
        class UnauthorizedHandler(_JsonHandler):
            status = 401

        server, port = _start_server(UnauthorizedHandler)
        try:
            stats, _ = bench_core.run_workers(
                scenario="login", base_url=f"http://127.0.0.1:{port}", duration=0.3,
                concurrency=2, seed=5, marker_ids=[1], usernames=["u"], password="p",
                request_timeout=2,
            )
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(stats.success, 0)  # 401 不是成功
        self.assertGreater(stats.by_status.get("401", 0), 0)
        self.assertEqual(stats.total, sum(stats.by_status.values()))

    def test_reject_login_scenario_treats_401_as_success(self) -> None:
        class UnauthorizedHandler(_JsonHandler):
            status = 401

        server, port = _start_server(UnauthorizedHandler)
        try:
            stats, _ = bench_core.run_workers(
                scenario="reject-login", base_url=f"http://127.0.0.1:{port}", duration=0.3,
                concurrency=1, seed=5, marker_ids=[1], usernames=["u"], password="p",
                request_timeout=2,
            )
        finally:
            server.shutdown()
            server.server_close()
        self.assertGreater(stats.success, 0)


class TestProbeBounds(unittest.TestCase):
    def test_overflow_detected(self) -> None:
        class BigHandler(_JsonHandler):
            body = b"[" + b"1," * 100 + b"1]"

        server, port = _start_server(BigHandler)
        try:
            _, body, overflow = switching._http_bounded(f"http://127.0.0.1:{port}/x", cap=16)
        finally:
            server.shutdown()
            server.server_close()
        self.assertTrue(overflow)
        self.assertGreater(len(body), 16)

    def test_no_overflow_small(self) -> None:
        server, port = _start_server(_JsonHandler)
        try:
            status, body, overflow = switching._http_bounded(f"http://127.0.0.1:{port}/x", cap=1024)
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(status, 200)
        self.assertFalse(overflow)


class TestGeneration(unittest.TestCase):
    def test_reuse_rejected_and_increasing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            first = switching.validate_generation(work, "java", 1)
            self.assertIn(":java:g1", str(first["namespace"]))
            switching.commit_generation(work, "java", 1)
            with self.assertRaises(switching.SwitchError):
                switching.validate_generation(work, "java", 1)
            with self.assertRaises(switching.SwitchError):
                switching.validate_generation(work, "java", 0)
            second = switching.validate_generation(work, "java", 2)
            self.assertTrue(str(second["cookie"]).endswith("G2"))

    def test_reservation_prevents_reuse_before_commit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            switching.validate_generation(work, "java", 5)  # 启动前登记
            with self.assertRaises(switching.SwitchError):
                switching.validate_generation(work, "java", 5)
            # 预约高代次后，较低代次也拒绝（比较 max(current, reserved)）。
            with self.assertRaises(switching.SwitchError):
                switching.validate_generation(work, "java", 4)
            self.assertTrue(switching.validate_generation(work, "java", 6)["generation"] == 6)

    def test_corrupt_state_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "generations.json").write_text("{not json", encoding="utf-8")
            with self.assertRaises(switching.SwitchError):
                switching.validate_generation(work, "java", 1)

    def test_run_id_isolates_namespaces(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            gen = switching.validate_generation(work, "java", 1)
            run_id = str(gen["runId"])
            self.assertIn(run_id, str(gen["namespace"]))

    def test_bad_generation_types(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            for bad in (0, -1, True):
                with self.assertRaises(switching.SwitchError):
                    switching.validate_generation(work, "java", bad)


class TestSwitchOrchestration(unittest.TestCase):
    def _deps(self, calls, *, fail_at=None, replay=None, freeze_fail_after=None):
        state = {"freezes": 0}

        def freeze() -> None:
            state["freezes"] += 1
            calls.append("freeze")
            if freeze_fail_after is not None and state["freezes"] > freeze_fail_after:
                raise RuntimeError("freeze boom")

        def step(name):
            def run():
                calls.append(name)
                if fail_at == name:
                    raise RuntimeError(f"{name} boom")
            return run

        return switching.SwitchDeps(
            freeze=freeze,
            stop=step("stop"),
            start=step("start"),
            wait_ready=step("ready"),
            activate=step("activate"),
            probe=step("probe"),
            replay_cookie=replay or (lambda cookie: 401),
        )

    def test_failure_refreezes_and_keeps_maintenance(self) -> None:
        calls: list[str] = []
        with self.assertRaises(switching.SwitchError) as ctx:
            switching.run_switch(self._deps(calls, fail_at="start"))
        self.assertNotIn("activate", calls)
        self.assertGreaterEqual(calls.count("freeze"), 2)  # 初始 + 失败后重冻结
        self.assertIn("refrozen=True", str(ctx.exception))
        facts = ctx.exception.facts
        self.assertIn("freeze", facts["steps"])
        self.assertIn("stop-writer", facts["steps"])
        self.assertTrue(facts["refrozen"])

    def test_initial_freeze_failure_reports_unverified(self) -> None:
        calls: list[str] = []
        with self.assertRaises(switching.SwitchError) as ctx:
            switching.run_switch(self._deps(calls, freeze_fail_after=0))
        facts = ctx.exception.facts
        self.assertEqual(facts["steps"], [])
        self.assertEqual(facts["refrozen"], "unverified")
        self.assertTrue(facts.get("initialFreezeFailed"))

    def test_refreeze_failure_reports_unknown(self) -> None:
        calls: list[str] = []
        with self.assertRaises(switching.SwitchError) as ctx:
            switching.run_switch(self._deps(calls, fail_at="start", freeze_fail_after=1))
        self.assertIn("refrozen=unknown", str(ctx.exception))

    def test_cookie_strict_401(self) -> None:
        calls: list[str] = []
        facts = switching.run_switch(
            self._deps(calls, replay=lambda c: 401), cookies_to_verify=("a", "b")
        )
        self.assertTrue(facts["allOldCookiesRejected"])
        self.assertEqual(facts["cookieReplayStatuses"], [401, 401])

    def test_cookie_non_401_fails(self) -> None:
        calls: list[str] = []
        with self.assertRaises(switching.SwitchError):
            switching.run_switch(
                self._deps(calls, replay=lambda c: 503), cookies_to_verify=("a",)
            )
        with self.assertRaises(switching.SwitchError):
            switching.run_switch(
                self._deps(calls, replay=lambda c: 200), cookies_to_verify=("a",)
            )


class TestCookieVault(unittest.TestCase):
    def test_save_load(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            switching.save_cookie(work, "java", 1, "LYC=abc")
            cookies = switching.load_cookies(work)
            self.assertEqual(cookies["java:g1"], "LYC=abc")

    def test_missing_file_allowed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(switching.load_cookies(Path(tmp)), {})

    def test_corrupt_vault_refused_and_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "session-cookies.json").write_text("{bad json", encoding="utf-8")
            with self.assertRaises(switching.SwitchError):
                switching.load_cookies(work)
            with self.assertRaises(switching.SwitchError):
                switching.save_cookie(work, "java", 2, "X=1")
            # 不覆盖：损坏内容仍在
            self.assertEqual((work / "session-cookies.json").read_text(encoding="utf-8"), "{bad json")

    def test_non_dict_vault_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "session-cookies.json").write_text("[1,2]", encoding="utf-8")
            with self.assertRaises(switching.SwitchError):
                switching.load_cookies(work)


class TestBaselineFixture(unittest.TestCase):
    def test_label_guard(self) -> None:
        import db_rehearsal

        for bad in ("", "../x", "a b", "a/b", "x" * 65):
            with self.assertRaises(db_rehearsal.DbRollbackError):
                db_rehearsal._safe_label(bad)
        self.assertEqual(db_rehearsal._safe_label("pair-1_ok"), "pair-1_ok")

    def test_baseline_paths_within_workdir(self) -> None:
        import db_rehearsal

        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            paths = db_rehearsal.baseline_paths(work, "b1")
            for key, path in paths.items():
                self.assertTrue(db_rehearsal._within(work, path), key)

    def test_manifest_corrupt_refused(self) -> None:
        import db_rehearsal

        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            paths = db_rehearsal.baseline_paths(work, "b1")
            paths["manifest"].parent.mkdir(parents=True, exist_ok=True)
            paths["manifest"].write_text("{bad", encoding="utf-8")
            with self.assertRaises(db_rehearsal.DbRollbackError):
                db_rehearsal.read_manifest(paths["manifest"], "b1")

    def test_verify_media_dir(self) -> None:
        import db_rehearsal
        import common

        with tempfile.TemporaryDirectory() as tmp:
            media = Path(tmp) / "uploads"
            media.mkdir()
            (media / "a.png").write_bytes(b"abc")
            fingerprint = common.media_fingerprint(media)
            manifest = {
                "media": {
                    "fileCount": fingerprint["fileCount"],
                    "combinedSha256": fingerprint["combinedSha256"],
                }
            }
            db_rehearsal.verify_media_dir(media, manifest)  # ok
            (media / "b.png").write_bytes(b"def")
            with self.assertRaises(db_rehearsal.DbRollbackError):
                db_rehearsal.verify_media_dir(media, manifest)


class TestBaselineRestoreOrder(unittest.TestCase):
    """恢复必须先完成只读预检；坏 dump/media/database 时零 freeze/stop/DDL/delete。"""

    def _make_fixture(self, work: Path, *, database: str | None = None, tamper_dump: bool = False,
                      missing_dump: bool = False, bad_media: bool = False):
        import db_rehearsal
        import common

        paths = db_rehearsal.baseline_paths(work, "pairA")
        paths["media"].mkdir(parents=True, exist_ok=True)
        (paths["media"] / "a.png").write_bytes(b"abc")
        media = common.media_fingerprint(paths["media"])
        dump = b"DUMPBYTES"
        if not missing_dump:
            paths["dump"].write_bytes(dump)
        manifest = {
            "label": "pairA",
            "database": database or db_rehearsal.UP_DB,
            "dumpSha256": hashlib.sha256(dump).hexdigest(),
            "fingerprint": {"label": "up", "database": db_rehearsal.UP_DB, "tables": {}, "sequences": {}},
            "media": {"fileCount": media["fileCount"], "combinedSha256": media["combinedSha256"]},
        }
        if tamper_dump:
            paths["dump"].write_bytes(b"TAMPERED")
        if bad_media:
            (paths["media"] / "b.png").write_bytes(b"def")
        db_rehearsal._atomic_write_json(paths["manifest"], manifest)
        return paths, manifest

    def _run_restore(self, work: Path, calls: list[str], fingerprint_fp: dict):
        import db_rehearsal
        import common
        from unittest import mock

        report = common.Report("restore-baseline", work)

        def rec(name, result=None):
            def fn(*args, **kwargs):
                calls.append(name)
                return result
            return fn

        with mock.patch.multiple(
            db_rehearsal.switching,
            freeze_entry=rec("freeze"),
            stop_backend=rec("stop"),
        ), mock.patch.multiple(
            db_rehearsal.common,
            wait_healthy=rec("wait"),
            database_exists=rec("exists", True),
            drop_database=rec("drop"),
            create_database=rec("create"),
            pg_restore_stdin=rec("restore"),
            fingerprint_database=rec("fingerprint", fingerprint_fp),
            compare_fingerprints=rec("compare", {"equal": True, "differences": []}),
        ):
            db_rehearsal.run_restore_baseline(work_dir=work, user="u", report=report, label="pairA")
        return report

    def _assert_preflight_only(self, calls: list[str]) -> None:
        self.assertEqual(calls, [])

    def test_bad_dump_hash_no_side_effects(self) -> None:
        import db_rehearsal
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            self._make_fixture(work, tamper_dump=True)
            calls: list[str] = []
            with self.assertRaises(db_rehearsal.DbRollbackError):
                self._run_restore(work, calls, {"tables": {}, "sequences": {}})
            self._assert_preflight_only(calls)

    def test_missing_dump_no_side_effects(self) -> None:
        import db_rehearsal
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            self._make_fixture(work, missing_dump=True)
            calls: list[str] = []
            with self.assertRaises(db_rehearsal.DbRollbackError):
                self._run_restore(work, calls, {"tables": {}, "sequences": {}})
            self._assert_preflight_only(calls)

    def test_bad_media_no_side_effects(self) -> None:
        import db_rehearsal
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            self._make_fixture(work, bad_media=True)
            calls: list[str] = []
            with self.assertRaises(db_rehearsal.DbRollbackError):
                self._run_restore(work, calls, {"tables": {}, "sequences": {}})
            self._assert_preflight_only(calls)

    def test_wrong_database_no_side_effects(self) -> None:
        import db_rehearsal
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            self._make_fixture(work, database="lycoris_rehearsal_src")
            calls: list[str] = []
            with self.assertRaises(db_rehearsal.DbRollbackError):
                self._run_restore(work, calls, {"tables": {}, "sequences": {}})
            self._assert_preflight_only(calls)

    def test_valid_fixture_restores_in_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            _, manifest = self._make_fixture(work)
            calls: list[str] = []
            self._run_restore(work, calls, manifest["fingerprint"])
            self.assertLess(calls.index("freeze"), calls.index("drop"))
            self.assertIn("restore", calls)
            self.assertIn("compare", calls)
            self.assertIn("fingerprint", calls)

    def test_snapshot_refuses_existing_label(self) -> None:
        import db_rehearsal
        import common
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            paths = db_rehearsal.baseline_paths(work, "pairA")
            paths["dump"].parent.mkdir(parents=True, exist_ok=True)
            paths["dump"].write_bytes(b"x")
            calls: list[str] = []
            with mock.patch.multiple(
                db_rehearsal.switching, freeze_entry=lambda *a, **k: calls.append("freeze")
            ):
                with self.assertRaises(db_rehearsal.DbRollbackError):
                    db_rehearsal.run_snapshot_baseline(
                        work_dir=work, user="u", report=common.Report("snapshot-baseline", work), label="pairA"
                    )
            self._assert_preflight_only(calls)


class TestHttpFlowAssertions(unittest.TestCase):
    def test_marker_fields_match_and_mismatch(self) -> None:
        import http_flows

        expected = {
            "id": 1,
            "title": "t",
            "description": "d",
            "category": "accessible_toilet",
            "sourceLanguage": "zh",
        }
        http_flows._assert_marker_fields(dict(expected), expected, where="x")
        for field in ("title", "description", "category", "sourceLanguage"):
            bad = dict(expected)
            bad[field] = "WRONG"
            with self.assertRaises(http_flows.FlowError):
                http_flows._assert_marker_fields(bad, expected, where="x")

    def test_favorites_parsing_forms(self) -> None:
        import http_flows

        class Resp:
            def __init__(self, payload):
                self.status = 200
                self._payload = payload

            def json(self):
                return self._payload

        class C:
            def __init__(self, payload):
                self.payload = payload

            def request(self, *a, **k):
                return Resp(self.payload)

        self.assertEqual(http_flows._favorites(C([1, 2, 3])), [1, 2, 3])
        self.assertEqual(http_flows._favorites(C({"data": [{"id": 7}]})), [7])

    def test_upload_image_info_stable_512(self) -> None:
        info = bench_core.upload_image_info()
        self.assertEqual((info["width"], info["height"]), (512, 512))
        self.assertEqual(info, bench_core.upload_image_info())

    def test_media_refs_strict(self) -> None:
        import http_flows

        media = {"avatarUrl": "/uploads/avatars/a.png", "markerImageUrl": "/uploads/markers/m.png"}
        me = {"avatarUrl": "/uploads/avatars/a.png"}
        zh = {"markImage": "/uploads/markers/m.png"}
        http_flows._assert_media_refs(zh, me, media, where="x")
        with self.assertRaises(http_flows.FlowError):
            http_flows._assert_media_refs({"markImage": "/uploads/markers/other.png"}, me, media, where="x")
        with self.assertRaises(http_flows.FlowError):
            http_flows._assert_media_refs(zh, {"avatarUrl": "/uploads/avatars/other.png"}, media, where="x")
        with self.assertRaises(http_flows.FlowError):
            http_flows._assert_media_refs(zh, {}, media, where="x")

    def test_required_media_rejects_missing(self) -> None:
        import http_flows

        with self.assertRaises(http_flows.FlowError):
            http_flows._required_media({})
        with self.assertRaises(http_flows.FlowError):
            http_flows._required_media({"media": {"avatarUrl": "a"}, "mediaHashes": {}})
        media, hashes = http_flows._required_media(
            {
                "media": {"avatarUrl": "a", "markerImageUrl": "b"},
                "mediaHashes": {"avatarSha256": "h1", "markerImageSha256": "h2"},
            }
        )
        self.assertEqual(media["avatarUrl"], "a")
        self.assertEqual(hashes["markerImageSha256"], "h2")


class TestUidModeCheck(unittest.TestCase):
    def test_world_writable_detection(self) -> None:
        import uidcheck

        self.assertEqual(uidcheck._parse_mode("UID_J=10001\nMODE_J=644", "MODE_J"), 0o644)
        for mode in ("666", "777", "662"):
            with self.assertRaises(uidcheck.UidCheckError):
                uidcheck._parse_mode(f"MODE_J={mode}", "MODE_J")
        with self.assertRaises(uidcheck.UidCheckError):
            uidcheck._parse_mode("UID_J=10001", "MODE_J")

    def test_volume_name_guard(self) -> None:
        import uidcheck

        original = uidcheck.VOLUME_NAME
        uidcheck.VOLUME_NAME = "some-other-volume"
        try:
            with self.assertRaises(uidcheck.UidCheckError):
                uidcheck._volume("inspect", "some-other-volume")
        finally:
            uidcheck.VOLUME_NAME = original


if __name__ == "__main__":
    unittest.main(verbosity=2)
