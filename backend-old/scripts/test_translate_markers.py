"""Offline translation contract tests.

Run: python -m unittest discover -s scripts -p test_translate_markers.py -v
Optional real PostgreSQL tests require LYCORIS_TEST_POSTGRES_CONTAINER naming a
disposable lycoris-i18n-verify-* container labelled com.lycoris.test=translation-guard.
The caller owns container creation/removal; no existing database is contacted.
"""

from __future__ import annotations

import copy
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import translate_markers as tool


def source(marker_id=1, language="zh", title="中文诊所", description="中文描述"):
    return {"id": marker_id, "sourceLanguage": language, "title": title, "description": description}


def record(marker_id=1, language="zh", **kwargs):
    marker = source(marker_id=marker_id, language=language, **kwargs)
    marker.update({
        "targetLanguage": "en" if language == "zh" else "zh",
        "sourceHash": tool.source_hash(marker),
        "translation": {"title": "English clinic" if language == "zh" else "中文诊所",
                        "description": "Translated description" if marker["description"] else ""},
    })
    return marker


def payload(*markers):
    return {"formatVersion": 1, "markers": list(markers)}


class FakeDatabase:
    def __init__(self, rows=(), save_results=()):
        self.rows = list(rows)
        self.save_results = iter(save_results)
        self.marker_calls = []
        self.save_calls = []

    def markers(self, include_private=False):
        self.marker_calls.append(include_private)
        yield from copy.deepcopy(self.rows)

    def save(self, marker, translated, include_private=False):
        self.save_calls.append((copy.deepcopy(marker), copy.deepcopy(translated), include_private))
        return next(self.save_results, True)


class HashContractTests(unittest.TestCase):
    def test_known_java_vectors_include_unicode_control_characters_and_null(self):
        self.assertEqual(tool.source_hash(source(title=None, description=None)),
                         "3defae280890f55c022bcd5c252977969064fb6328f2927428ba4a0b02e14840")
        self.assertEqual(tool.source_hash(source(title='中"文\\\n😀', description="line\t\x1f")),
                         "69041ef21862545c32d414958ea2e68ef0287b0b67807d93ebfce3179dae8e87")

    def test_language_normalization_agrees_with_java(self):
        for language in ("en", "EN", " en ", "en-US", "en_US"):
            with self.subTest(language=language):
                self.assertEqual(tool.normalize_language(language), "en")
                self.assertEqual(tool.source_hash(source(language=language)), tool.source_hash(source(language="en")))
        for language in (None, "zh", "zh-Hant", "zh_CN", "fr", "", "system"):
            with self.subTest(language=language):
                self.assertEqual(tool.normalize_language(language), "zh")

    def test_only_original_language_and_exact_text_affect_hash(self):
        marker = source()
        initial = tool.source_hash(marker)
        for update in ({"id": 999}, {"category": "baby_room"}, {"isPublic": False},
                       {"version": 8}, {"translationOrigin": "MANUAL"}):
            with self.subTest(update=update):
                self.assertEqual(tool.source_hash({**marker, **update}), initial)
        for update in ({"title": marker["title"] + " "}, {"description": marker["description"] + "\n"},
                       {"sourceLanguage": "en"}):
            with self.subTest(update=update):
                self.assertNotEqual(tool.source_hash({**marker, **update}), initial)
        self.assertNotEqual(tool.source_hash(source(title="é")), tool.source_hash(source(title="e\u0301")))
        self.assertEqual(tool.source_hash(source(description=None)), tool.source_hash(source(description="")))


class ImportValidationTests(unittest.TestCase):
    def test_accepts_both_translation_directions_and_empty_descriptions(self):
        for marker in (record(), record(language="en"), record(description=None), record(description="")):
            with self.subTest(marker=marker):
                self.assertEqual(tool.validate_import(payload(marker)), [marker])

    def test_rejects_tampered_original_fields(self):
        for changes in ({"title": "Changed source"}, {"description": "Changed source description"},
                        {"sourceLanguage": "en", "targetLanguage": "zh"}, {"sourceHash": "0" * 64}):
            marker = record()
            marker.update(changes)
            with self.subTest(changes=changes), self.assertRaises(tool.TranslationError):
                tool.validate_import(payload(marker))

    def test_rejects_duplicate_or_invalid_marker_ids(self):
        with self.assertRaises(tool.TranslationError):
            tool.validate_import(payload(record(), record()))
        for marker_id in (0, -1, True, "1", 1.5, None):
            marker = record()
            marker["id"] = marker_id
            with self.subTest(marker_id=marker_id), self.assertRaises(tool.TranslationError):
                tool.validate_import(payload(marker))

    def test_rejects_unsupported_or_same_target_language(self):
        for language in ("zh", "fr", "EN", "en-US", None):
            marker = record()
            marker["targetLanguage"] = language
            with self.subTest(language=language), self.assertRaises(tool.TranslationError):
                tool.validate_import(payload(marker))
        marker = record()
        marker["sourceLanguage"] = "fr"
        with self.assertRaises(tool.TranslationError):
            tool.validate_import(payload(marker))

    def test_rejects_wrong_format_record_count_and_non_text_originals(self):
        for value in ([], {}, {"formatVersion": 2, "markers": []},
                      {"formatVersion": 1, "markers": {}}, payload(record(), record(2))):
            with self.subTest(value=value), self.assertRaises(tool.TranslationError):
                tool.validate_import(value, limit=1)
        for field in ("title", "description"):
            marker = record()
            marker[field] = 123
            with self.subTest(field=field), self.assertRaises(tool.TranslationError):
                tool.validate_import(payload(marker))

    def test_translation_requires_exactly_two_string_fields(self):
        for translation in (None, [], {}, {"title": "Name"},
                            {"title": "Name", "description": "Details", "note": "extra"},
                            {"title": None, "description": "Details"},
                            {"title": "Name", "description": None}):
            with self.subTest(translation=translation), self.assertRaises(tool.TranslationError):
                tool.validate_translation(translation, source())

    def test_utf16_length_limits_cover_astral_unicode(self):
        for title in ("a" * 120, "😀" * 60):
            self.assertEqual(tool.validate_translation({"title": title, "description": ""}, source())["title"], title)
        for title in ("", " \t\n", "a" * 121, "😀" * 61):
            with self.subTest(title_length=len(title)), self.assertRaises(tool.TranslationError):
                tool.validate_translation({"title": title, "description": ""}, source())
        tool.validate_translation({"title": "Name", "description": "😀" * 10000}, source())
        with self.assertRaises(tool.TranslationError):
            tool.validate_translation({"title": "Name", "description": "😀" * 10001}, source())

    def test_blank_source_description_cannot_gain_invented_text(self):
        for description in (None, "", " \t\n"):
            with self.subTest(description=description):
                marker = source(description=description)
                tool.validate_translation({"title": "Name", "description": ""}, marker)
                with self.assertRaises(tool.TranslationError):
                    tool.validate_translation({"title": "Name", "description": "Invented details"}, marker)

    def test_source_urls_must_be_preserved_as_complete_urls(self):
        marker = source(description="https://example.org/path?q=a&b=2")
        exact = {"title": "Name", "description": "See https://example.org/path?q=a&b=2"}
        self.assertEqual(tool.validate_translation(exact, marker), exact)
        for description in ("No URL", "https://different.example/path?q=a&b=2",
                            "https://example.org/path?q=a&b=2/changed"):
            with self.subTest(description=description), self.assertRaises(tool.TranslationError):
                tool.validate_translation({"title": "Name", "description": description}, marker)
        marker = source(description="https://example.org")
        with self.assertRaises(tool.TranslationError):
            tool.validate_translation({"title": "Name", "description": "https://example.org.evil"}, marker)

    def test_nul_text_is_rejected_and_sql_literals_preserve_quotes_and_backslashes(self):
        with self.assertRaises(tool.TranslationError):
            tool.validate_translation({"title": "Name", "description": "bad\x00text"}, source())
        with self.assertRaises(tool.TranslationError):
            tool.sql_literal("bad\x00text")
        self.assertEqual(tool.sql_literal(None), "NULL")
        self.assertEqual(tool.sql_literal("O'Reilly\\path"), "E'O''Reilly\\\\path'")


class WorkflowTests(unittest.TestCase):
    def test_export_target_is_opposite_the_normalized_source_language(self):
        database = FakeDatabase((source(language="EN"),))
        pending, _ = tool.collect_pending(database, limit=100, include_private=False)
        self.assertEqual(pending[0]["sourceLanguage"], "en")
        self.assertEqual(pending[0]["targetLanguage"], "zh")

    def test_pending_filter_skips_current_and_manual_even_when_manual_is_stale(self):
        current = source(1)
        current["translationHash"] = tool.source_hash(current)
        manual = {**source(2), "translationOrigin": "MANUAL", "translationHash": "stale"}
        untranslated = source(3, language="en")
        stale = {**source(4), "translationHash": "stale", "translationOrigin": "MACHINE"}
        database = FakeDatabase((current, manual, untranslated, stale))
        pending, counts = tool.collect_pending(database, limit=100, include_private=False)
        self.assertEqual([row["id"] for row in pending], [3, 4])
        self.assertEqual([row["targetLanguage"] for row in pending], ["zh", "en"])
        self.assertTrue(all(row["translation"] is None for row in pending))
        self.assertEqual(counts, {"examined": 4, "current": 1, "manual": 1, "pending": 2})
        self.assertEqual(database.marker_calls, [False])

    def test_pending_limit_counts_only_records_that_need_translation(self):
        manual = {**source(1), "translationOrigin": "MANUAL"}
        database = FakeDatabase((manual, source(2), source(3)))
        pending, counts = tool.collect_pending(database, limit=1, include_private=True)
        self.assertEqual([row["id"] for row in pending], [2])
        self.assertEqual(counts, {"examined": 2, "current": 0, "manual": 1, "pending": 1})
        self.assertEqual(database.marker_calls, [True])

    def test_validate_only_never_reads_or_writes_database(self):
        database = FakeDatabase()
        records = tool.validate_import(payload(record()))
        counts = tool.import_translations(database, records, apply=False, include_private=False)
        self.assertEqual(counts, {"validated": 1, "saved": 0, "changed_or_protected": 0})
        self.assertEqual(database.marker_calls, [])
        self.assertEqual(database.save_calls, [])

    def test_apply_counts_source_changes_and_manual_protection_as_skipped(self):
        database = FakeDatabase(save_results=(True, False, False))
        records = tool.validate_import(payload(record(1), record(2), record(3)))
        counts = tool.import_translations(database, records, apply=True, include_private=True)
        self.assertEqual(counts, {"validated": 3, "saved": 1, "changed_or_protected": 2})
        self.assertEqual([call[0]["id"] for call in database.save_calls], [1, 2, 3])
        self.assertTrue(all(call[2] for call in database.save_calls))

    def test_cli_validates_file_without_apply_and_rejects_tampering_before_save(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "translations.json"
            for tampered in (False, True):
                value = payload(record())
                if tampered:
                    value["markers"][0]["title"] = "Changed original"
                path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8-sig")
                database = FakeDatabase()
                argv = ["translate_markers.py", "--import", str(path)] + (["--apply"] if tampered else [])
                output, errors = io.StringIO(), io.StringIO()
                with self.subTest(tampered=tampered), patch.object(sys, "argv", argv), \
                     patch.object(tool, "Database", return_value=database), \
                     redirect_stdout(output), redirect_stderr(errors):
                    self.assertEqual(tool.main(), 1 if tampered else 0)
                self.assertEqual(database.save_calls, [])
                if not tampered:
                    self.assertEqual(json.loads(output.getvalue())["mode"], "validate-only")


class DockerDatabase(tool.Database):
    """Run the unmodified production SQL through psql in an explicitly isolated container."""
    def __init__(self, container):
        if not re.fullmatch(r"lycoris-i18n-verify-[a-zA-Z0-9-]+", container):
            raise RuntimeError("Refusing a container outside the disposable verification namespace")
        label = subprocess.run(
            ["docker", "inspect", "--format", '{{ index .Config.Labels "com.lycoris.test" }}', container],
            capture_output=True, text=True, check=True, timeout=15,
        ).stdout.strip()
        if label != "translation-guard":
            raise RuntimeError("Refusing a container without the dedicated test label")
        self.container = container

    def query(self, sql):
        result = subprocess.run(
            ["docker", "exec", "-i", self.container, "psql", "-X", "-q", "-t", "-A",
             "-U", "marker_test", "-d", "marker_test", "-v", "ON_ERROR_STOP=1"],
            input=sql, text=True, encoding="utf-8", capture_output=True, check=False, timeout=30,
        )
        if result.returncode:
            raise tool.TranslationError("Disposable PostgreSQL verification query failed")
        return result.stdout.strip()


@unittest.skipUnless(os.environ.get("LYCORIS_TEST_POSTGRES_CONTAINER"), "requires an explicitly isolated PostgreSQL container")
class PostgreSQLGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = DockerDatabase(os.environ["LYCORIS_TEST_POSTGRES_CONTAINER"])
        cls.database.query("""
            CREATE TABLE map_markers (
                id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                title varchar(120) NOT NULL, description text,
                is_public boolean NOT NULL DEFAULT true,
                review_status varchar(16) NOT NULL DEFAULT 'APPROVED'
            );
            CREATE TABLE marker_edit_proposals (id bigint PRIMARY KEY);
            INSERT INTO map_markers (title, description) VALUES ('迁移前原文', '迁移前描述');
            INSERT INTO marker_edit_proposals (id) VALUES (1);
        """)
        migration = Path(__file__).resolve().parents[1] / "deploy/migrations/2026-09-06-marker-translations.sql"
        sql = migration.read_text(encoding="utf-8-sig")
        cls.database.query(sql)
        cls.database.query(sql)  # The additive migration is safe to reapply.
        cls.migrated_marker = json.loads(cls.database.query(
            "SELECT row_to_json(m) FROM map_markers m WHERE id=1"))
        cls.migrated_proposal_language = cls.database.query("SELECT language FROM marker_edit_proposals WHERE id=1")

    def setUp(self):
        self.database.query("TRUNCATE map_marker_translations, map_markers, marker_edit_proposals RESTART IDENTITY CASCADE")

    def insert_source(self, language="zh", title="原始中文", description="原文描述", public=True, review="APPROVED"):
        self.database.query(f"""
            INSERT INTO map_markers (source_language,title,description,is_public,review_status)
            VALUES ({tool.sql_literal(language)}, {tool.sql_literal(title)}, {tool.sql_literal(description)},
                    {'true' if public else 'false'}, {tool.sql_literal(review)})
        """)
        return next(self.database.markers(include_private=True))

    def test_migration_preserves_source_text_and_defaults_historical_languages(self):
        self.assertEqual(self.migrated_marker["title"], "迁移前原文")
        self.assertEqual(self.migrated_marker["description"], "迁移前描述")
        self.assertEqual(self.migrated_marker["source_language"], "zh")
        self.assertEqual(self.migrated_proposal_language, "zh")

    def test_normal_and_repeated_import_keep_one_translation_and_preserve_original(self):
        marker = self.insert_source(title="原文 O'Reilly\\路径😀", description=None)
        translated = {"title": "English O'Reilly\\path😀", "description": ""}
        self.assertTrue(self.database.save(marker, translated))
        self.assertTrue(self.database.save(marker, translated))
        saved = json.loads(self.database.query("SELECT row_to_json(t) FROM map_marker_translations t"))
        self.assertEqual(saved["language"], "en")
        self.assertEqual(saved["title"], translated["title"])
        self.assertEqual(saved["description"], "")
        self.assertEqual(saved["origin"], "MACHINE")
        self.assertEqual(saved["source_hash"], tool.source_hash(marker))
        self.assertEqual(self.database.query("SELECT count(*) FROM map_marker_translations"), "1")
        original = next(self.database.markers())
        self.assertEqual(original["title"], marker["title"])
        self.assertIsNone(original["description"])

    def test_english_source_creates_only_chinese_translation(self):
        marker = self.insert_source(language="en", title="Original English", description="Original description")
        self.assertTrue(self.database.save(marker, {"title": "中文译文", "description": "中文说明"}))
        self.assertEqual(self.database.query("SELECT language FROM map_marker_translations"), "zh")
        self.assertEqual(self.database.query("SELECT title FROM map_markers"), "Original English")

    def test_changed_original_is_skipped_even_if_export_hash_was_valid(self):
        marker = self.insert_source()
        self.database.query("UPDATE map_markers SET title='原文已改变'")
        self.assertFalse(self.database.save(marker, {"title": "Stale English", "description": "Stale details"}))
        self.assertEqual(self.database.query("SELECT count(*) FROM map_marker_translations"), "0")

    def test_manual_translation_is_protected_after_export(self):
        marker = self.insert_source()
        self.assertTrue(self.database.save(marker, {"title": "Initial machine title", "description": "Details"}))
        self.database.query("UPDATE map_marker_translations SET origin='MANUAL', title='Manual title'")
        self.assertFalse(self.database.save(marker, {"title": "Late machine title", "description": "Details"}))
        self.assertEqual(self.database.query("SELECT title FROM map_marker_translations"), "Manual title")

    def test_public_and_review_status_are_rechecked_at_save_time(self):
        marker = self.insert_source()
        translated = {"title": "Translated title", "description": "Details"}
        self.database.query("UPDATE map_markers SET is_public=false")
        self.assertFalse(self.database.save(marker, translated))
        self.assertTrue(self.database.save(marker, translated, include_private=True))
        self.database.query("UPDATE map_markers SET review_status='PENDING'")
        self.assertFalse(self.database.save(marker, translated, include_private=True))

    def test_foreign_key_cascades_translation_when_marker_is_deleted(self):
        marker = self.insert_source()
        self.assertTrue(self.database.save(marker, {"title": "Translated title", "description": "Details"}))
        self.database.query("DELETE FROM map_markers")
        self.assertEqual(self.database.query("SELECT count(*) FROM map_marker_translations"), "0")


if __name__ == "__main__":
    unittest.main()
