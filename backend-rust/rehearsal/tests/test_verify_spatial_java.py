#!/usr/bin/env python3
"""阶段5 工具（verify-spatial-java.py）纯逻辑离线测试：无需 Docker/HTTP/SQL。"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

REHEARSAL = Path(__file__).resolve().parent.parent
if str(REHEARSAL) not in sys.path:
    sys.path.insert(0, str(REHEARSAL))

SCRIPT = REHEARSAL.parent / "scripts" / "verify-spatial-java.py"
_spec = importlib.util.spec_from_file_location("verify_spatial_java_mod", SCRIPT)
stage5 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(stage5)

import guard  # noqa: E402


class TestBusinessFingerprintSql(unittest.TestCase):
    def test_excludes_location_and_includes_id(self) -> None:
        for table, cols in stage5.BUSINESS_COLUMNS.items():
            self.assertNotIn("location", cols, table)
            self.assertIn("id", cols, table)
            sql = stage5.business_fingerprint_sql(table)
            self.assertNotIn("location", sql.lower(), table)
            self.assertIn("ORDER BY id", sql)

    def test_unknown_table_rejected(self) -> None:
        with self.assertRaises(stage5.Stage5Error):
            stage5.business_fingerprint_sql("nope")


class TestRustDatabaseUrl(unittest.TestCase):
    USER, PASS = "lycoris_rehearsal", "rehearsal-synth-01"
    GOOD = f"postgres://{USER}:{PASS}@pg18:5432/lycoris_rehearsal_up"

    def test_valid(self) -> None:
        facts = stage5.validate_rust_database_url(self.GOOD, user=self.USER, password=self.PASS)
        self.assertEqual(facts, {"host": "pg18", "port": 5432, "database": "lycoris_rehearsal_up"})

    def test_bad_variants(self) -> None:
        bad = [
            f"postgres://{self.USER}:{self.PASS}@localhost:5432/lycoris_rehearsal_up",
            f"postgres://{self.USER}:{self.PASS}@pg18:5433/lycoris_rehearsal_up",
            f"postgres://{self.USER}:{self.PASS}@pg18:5432/lycoris_rehearsal_back",
            f"postgres://{self.USER}:{self.PASS}@pg18:5432/lycoris_rehearsal_up?host=evil",
            f"postgres://{self.USER}:{self.PASS}@pg18:5432/lycoris_rehearsal%5Fup",
            f"postgres://{self.USER}:wrong@pg18:5432/lycoris_rehearsal_up",
            "mysql://x:y@pg18:5432/lycoris_rehearsal_up",
        ]
        for url in bad:
            with self.assertRaises(stage5.Stage5Error, msg=url):
                stage5.validate_rust_database_url(url, user=self.USER, password=self.PASS)


class TestMigrationRows(unittest.TestCase):
    SHA = stage5.EXPECTED_MIGRATION_SHA384

    def _rows(self, v1=True, v2=True, cs1=None, cs2=None):
        return [
            {"version": 1, "success": v1, "checksum": cs1 or self.SHA["1"]},
            {"version": 2, "success": v2, "checksum": cs2 or self.SHA["2"]},
        ]

    def test_valid(self) -> None:
        stage5.validate_migration_rows(self._rows())

    def test_success_and_checksum(self) -> None:
        with self.assertRaises(stage5.Stage5Error):
            stage5.validate_migration_rows(self._rows(v2=False))
        with self.assertRaises(stage5.Stage5Error):
            stage5.validate_migration_rows(self._rows(cs2="a" * 96))
        with self.assertRaises(stage5.Stage5Error):
            stage5.validate_migration_rows([{"version": 1, "success": True, "checksum": self.SHA["1"]}])

    def test_parse_real_psql_text(self) -> None:
        line = "1|true|" + self.SHA["1"]
        row = stage5.parse_migration_line(line)
        self.assertEqual(row, {"version": 1, "success": True, "checksum": self.SHA["1"]})
        self.assertTrue(stage5.parse_migration_line("2|t|" + self.SHA["2"])["success"])
        self.assertFalse(stage5.parse_migration_line("2|false|" + self.SHA["2"])["success"])
        self.assertIsNone(stage5.parse_migration_line("garbage"))

    def test_constants_are_sha384(self) -> None:
        for value in self.SHA.values():
            self.assertTrue(stage5.SHA384_RE.match(value))


class TestLocationAndIndexes(unittest.TestCase):
    def test_exact_location_type(self) -> None:
        self.assertTrue(stage5.is_exact_location_type("geography(Point,4326)"))
        self.assertTrue(stage5.is_exact_location_type(" geography(Point,4326) "))
        self.assertFalse(stage5.is_exact_location_type("geography(Point)"))
        self.assertFalse(stage5.is_exact_location_type("geography(Point,4326) extra"))

    def test_check_index_defs(self) -> None:
        defs = [
            "idx_gist|CREATE INDEX idx_gist ON public.map_markers USING gist (location) "
            "WHERE (is_public AND (review_status)::text = 'APPROVED'::text AND location IS NOT NULL)",
            "idx_legacy|CREATE INDEX idx_legacy ON public.map_markers USING btree (id) "
            "WHERE (is_public AND (review_status)::text = 'APPROVED'::text AND location IS NULL)",
        ]
        self.assertEqual(stage5.check_index_defs(defs), [])
        self.assertTrue(stage5.check_index_defs(defs[:1]))
        self.assertTrue(stage5.check_index_defs(defs[1:]))


class TestBackendIdentity(unittest.TestCase):
    def test_rust_compares_image_id(self) -> None:
        stage5.validate_backend_identity(
            "rust", config_image_id="sha256:abc", verified_image_id="sha256:abc",
            verified_jar_sha256=None, actual_jar_sha256=None,
        )
        with self.assertRaises(stage5.Stage5Error):
            stage5.validate_backend_identity(
                "rust", config_image_id="sha256:def", verified_image_id="sha256:abc",
                verified_jar_sha256=None, actual_jar_sha256=None,
            )

    def test_java_compares_jar_not_image(self) -> None:
        # Java 不比对 stage5 镜像 ID，只比对运行容器 JAR SHA。
        stage5.validate_backend_identity(
            "java", config_image_id="sha256:jreimage", verified_image_id="sha256:stage5",
            verified_jar_sha256="a" * 64, actual_jar_sha256="A" * 64,
        )
        with self.assertRaises(stage5.Stage5Error):
            stage5.validate_backend_identity(
                "java", config_image_id="sha256:jreimage", verified_image_id="sha256:stage5",
                verified_jar_sha256="a" * 64, actual_jar_sha256="b" * 64,
            )

    def test_namespace_key(self) -> None:
        self.assertEqual(stage5.namespace_env_key("java"), "SPRING_SESSION_REDIS_NAMESPACE")
        self.assertEqual(stage5.namespace_env_key("rust"), "SESSION_NAMESPACE")
        self.assertEqual(stage5.parse_generation("lycoris:session:rehearsal:run:java:g22"), 22)
        self.assertIsNone(stage5.parse_generation("nope"))


class TestFailureReportClassification(unittest.TestCase):
    def test_classifies_status_and_unparsable(self) -> None:
        work = Path(tempfile.mkdtemp())
        reports = work / "reports"
        reports.mkdir(parents=True)
        (reports / "stage5-ok.json").write_text(json.dumps({"status": "ok"}), encoding="utf-8")
        (reports / "stage5-bad.json").write_text(json.dumps({"status": "failed"}), encoding="utf-8")
        (reports / "stage5-blocked.json").write_text(json.dumps({"status": "blocked"}), encoding="utf-8")
        (reports / "stage5-corrupt.json").write_text("{bad", encoding="utf-8")
        classified = stage5.Ctx(work).failure_reports()
        self.assertEqual(classified["failed"], ["stage5-bad.json"])
        self.assertEqual(classified["blocked"], ["stage5-blocked.json"])
        self.assertEqual(classified["unparsable"], ["stage5-corrupt.json"])


class TestStateIsolation(unittest.TestCase):
    def _ctx(self):
        return stage5.Ctx(Path(tempfile.mkdtemp()))

    def test_rejects_non_whitelist_and_password(self) -> None:
        ctx = self._ctx()
        with self.assertRaises(stage5.Stage5Error):
            ctx.save_state({"newUser": {"password": "secret"}})
        with self.assertRaises(stage5.Stage5Error):
            ctx.save_state({"whatever": 1})

    def test_allowed_merge_and_atomic(self) -> None:
        ctx = self._ctx()
        ctx.save_state({"label": "b1"})
        merged = ctx.save_state({"mediaBefore": {"fileCount": 0}})
        self.assertEqual(merged["label"], "b1")
        self.assertEqual(ctx.load_state()["label"], "b1")

    def test_corrupt_state_refused(self) -> None:
        ctx = self._ctx()
        path = ctx.artifact_path("stage5-compat.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{bad", encoding="utf-8")
        with self.assertRaises(stage5.Stage5Error):
            ctx.load_state()

    def test_prereqs(self) -> None:
        stage5.assert_prereqs({"label": "x", "businessAfter0002": {"tables": {}}}, ["label", "businessAfter0002"])
        with self.assertRaises(stage5.Stage5Error):
            stage5.assert_prereqs({"label": "x"}, ["label", "javaCrud"])

    def test_credentials_in_memory_requires_user(self) -> None:
        with self.assertRaises(stage5.Stage5Error):
            stage5._stage4_credentials_in_memory({})
        creds = stage5._stage4_credentials_in_memory({"newUser": {"username": "u", "password": "p"}})
        self.assertEqual(creds["newUser"]["username"], "u")


class TestGuardScope(unittest.TestCase):
    def _ctx(self, pg18_url: str) -> "stage5.Ctx":
        ctx = stage5.Ctx(Path(tempfile.mkdtemp()))
        ctx.env = {
            "PG17_URL": "postgres://u:p@127.0.0.1:55435/lycoris_rehearsal_src",
            "PG18_URL": pg18_url,
            "REDIS_URL": "redis://127.0.0.1:56380",
            "ENTRY_URL": "http://127.0.0.1:18180",
            "PG_REHEARSAL_USER": "lycoris_rehearsal",
            "PG_REHEARSAL_PASSWORD": "rehearsal-synth-01",
        }
        return ctx

    def test_accepts_up_only(self) -> None:
        self._ctx("postgres://u:p@127.0.0.1:55434/lycoris_rehearsal_up").guard()

    def test_rejects_back_and_other_db(self) -> None:
        for url in (
            "postgres://u:p@127.0.0.1:55434/lycoris_rehearsal_back",
            "postgres://u:p@127.0.0.1:55434/lycoris_rehearsal_src",
        ):
            with self.assertRaises(stage5.Stage5Error):
                self._ctx(url).guard()

    def test_rejects_query_override(self) -> None:
        with self.assertRaises(guard.GuardError):
            self._ctx("postgres://u:p@127.0.0.1:55434/lycoris_rehearsal_up?host=10.0.0.9").guard()


class TestMisc(unittest.TestCase):
    def test_assert_expected_hash(self) -> None:
        self.assertEqual(stage5.assert_expected_hash("x", "abc", "abc"), "abc")
        with self.assertRaises(stage5.Stage5Error):
            stage5.assert_expected_hash("x", "abc", "def")
        with self.assertRaises(stage5.Stage5Error):
            stage5.assert_expected_hash("x", None, "abc")

    def test_unique_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "stage5-java-compatibility.json"
            self.assertEqual(stage5.unique_path(base), base)
            base.write_text("{}", encoding="utf-8")
            self.assertEqual(stage5.unique_path(base).name, "stage5-java-compatibility-2.json")


if __name__ == "__main__":
    unittest.main(verbosity=2)
