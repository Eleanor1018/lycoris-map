#!/usr/bin/env python3
"""Export and import marker translations without any external API calls.

Uses psql's standard PG* environment variables. A normal run counts pending work.
--export writes a reviewable JSON file; --import validates a translated file.
Only --import together with --apply writes translations, after checking the
current source and protecting manual edits. Requires Python 3.10+ and psql.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any


class TranslationError(RuntimeError):
    """An actionable error whose text contains no response bodies or secrets."""


def normalize_language(value: str | None) -> str:
    normalized = (value or "").strip().lower().replace("_", "-")
    return "en" if normalized == "en" or normalized.startswith("en-") else "zh"


def source_hash(marker: dict[str, Any]) -> str:
    payload = [normalize_language(marker.get("sourceLanguage")),
               marker.get("title") or "", marker.get("description") or ""]
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def sql_literal(value: str | None) -> str:
    if value is None:
        return "NULL"
    if "\x00" in value:
        raise TranslationError("NUL characters are not supported in database text")
    # Explicit E strings remain safe regardless of standard_conforming_strings.
    return "E'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


class Database:
    def __init__(self, executable: str = "psql"):
        self.executable = executable

    def query(self, sql: str) -> str:
        try:
            result = subprocess.run(
                [self.executable, "-X", "-q", "-t", "-A", "-w",
                 "-v", "ON_ERROR_STOP=1"],
                input=sql, text=True, encoding="utf-8", capture_output=True,
                timeout=60, check=False,
                env={**os.environ, "PGCLIENTENCODING": "UTF8",
                     "PGCONNECT_TIMEOUT": "15"},
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TranslationError("Could not run psql; check installation and PG* connection settings") from exc
        if result.returncode:
            # psql errors can echo SQL text, credentials, or private text.
            raise TranslationError("Database operation failed; check connection, migration and database permissions")
        return result.stdout.strip()

    def markers(self, include_private: bool = False) -> Iterator[dict[str, Any]]:
        after_id = 0
        visibility = "" if include_private else "AND m.is_public = true"
        while True:
            raw = self.query(f"""
                SELECT coalesce(json_agg(page), '[]'::json) FROM (
                    SELECT m.id, coalesce(m.source_language, 'zh') AS "sourceLanguage",
                           m.title, m.description,
                           t.source_hash AS "translationHash", t.origin AS "translationOrigin"
                    FROM map_markers m
                    LEFT JOIN map_marker_translations t ON t.marker_id = m.id
                        AND t.language = CASE WHEN m.source_language = 'en' THEN 'zh' ELSE 'en' END
                    WHERE m.id > {int(after_id)} AND m.review_status = 'APPROVED' {visibility}
                    ORDER BY m.id LIMIT 500
                ) page;
            """)
            try:
                rows = json.loads(raw)
                if not isinstance(rows, list):
                    raise ValueError()
            except (ValueError, TypeError) as exc:
                raise TranslationError("Database returned an unexpected marker response") from exc
            if not rows:
                return
            for row in rows:
                after_id = int(row["id"])
                yield row

    def save(self, marker: dict[str, Any], translated: dict[str, str],
             include_private: bool = False) -> bool:
        source_language = normalize_language(marker.get("sourceLanguage"))
        target_language = "zh" if source_language == "en" else "en"
        visibility = "" if include_private else "AND is_public = true"
        # Lock and compare the original fields, not just an earlier version read.
        # This also rechecks visibility/review after the external API request.
        result = self.query(f"""
            WITH current_source AS (
                SELECT id FROM map_markers
                WHERE id = {int(marker['id'])}
                    AND source_language = {sql_literal(source_language)}
                    AND title IS NOT DISTINCT FROM {sql_literal(marker.get('title'))}
                    AND description IS NOT DISTINCT FROM {sql_literal(marker.get('description'))}
                    AND review_status = 'APPROVED' {visibility}
                FOR UPDATE
            ), saved AS (
                INSERT INTO map_marker_translations
                    (marker_id, language, title, description, source_hash, origin, updated_at)
                SELECT id, {sql_literal(target_language)}, {sql_literal(translated['title'])},
                    {sql_literal(translated['description'])}, {sql_literal(source_hash(marker))},
                    'MACHINE', now() FROM current_source
                ON CONFLICT (marker_id, language) DO UPDATE SET
                    title = EXCLUDED.title, description = EXCLUDED.description,
                    source_hash = EXCLUDED.source_hash, origin = 'MACHINE', updated_at = now()
                WHERE map_marker_translations.origin <> 'MANUAL'
                RETURNING id
            ) SELECT count(*) FROM saved;
        """)
        return result == "1"


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def validate_translation(value: Any, marker: dict[str, Any]) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"title", "description"}:
        raise TranslationError("Model output must have exactly title and description fields")
    if any(not isinstance(value[key], str) for key in value):
        raise TranslationError("Model output fields must be strings")
    if not value["title"].strip() or utf16_length(value["title"]) > 120:
        raise TranslationError("Translated title is blank or exceeds its database limit")
    if utf16_length(value["description"]) > 20000:
        raise TranslationError("Translated description exceeds the supported text limit")
    if any("\x00" in text for text in value.values()):
        raise TranslationError("Model output contains an invalid NUL character")
    if not (marker.get("description") or "").strip() and value["description"].strip():
        raise TranslationError("Model invented a description for a blank source")
    original = (marker.get("title") or "") + "\n" + (marker.get("description") or "")
    result = value["title"] + "\n" + value["description"]
    url_pattern = r"https?://[^\s<>\"\u3000-\u303f\uff00-\uffef]+"
    urls = re.findall(url_pattern, original)
    translated_urls = re.findall(url_pattern, result)
    if any(url not in translated_urls for url in urls):
        raise TranslationError("Model output did not preserve a source URL")
    return value


def collect_pending(database: Database, *, limit: int, include_private: bool
                    ) -> tuple[list[dict[str, Any]], dict[str, int]]:
    counts = {"examined": 0, "current": 0, "manual": 0, "pending": 0}
    pending = []
    for marker in database.markers(include_private):
        counts["examined"] += 1
        if marker.get("translationOrigin") == "MANUAL":
            counts["manual"] += 1
            continue
        if marker.get("translationHash") == source_hash(marker):
            counts["current"] += 1
            continue
        counts["pending"] += 1
        pending.append({
            "id": int(marker["id"]),
            "sourceLanguage": normalize_language(marker.get("sourceLanguage")),
            "targetLanguage": "zh" if normalize_language(marker.get("sourceLanguage")) == "en" else "en",
            "title": marker.get("title"), "description": marker.get("description"),
            "sourceHash": source_hash(marker), "translation": None,
        })
        if counts["pending"] >= limit:
            break
    return pending, counts


def validate_import(payload: Any, limit: int = 500) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or payload.get("formatVersion") != 1:
        raise TranslationError("Expected a formatVersion 1 translation file")
    markers = payload.get("markers")
    if not isinstance(markers, list) or len(markers) > limit:
        raise TranslationError("Translation file must contain no more than the configured record limit")
    ids = set()
    for marker in markers:
        if not isinstance(marker, dict) or type(marker.get("id")) is not int or marker["id"] <= 0:
            raise TranslationError("Each translation must have a positive integer marker ID")
        if marker["id"] in ids:
            raise TranslationError("Duplicate marker IDs in translation file")
        ids.add(marker["id"])
        if marker.get("sourceLanguage") not in {"zh", "en"}:
            raise TranslationError("Unsupported source language")
        if marker.get("targetLanguage") != ("en" if marker["sourceLanguage"] == "zh" else "zh"):
            raise TranslationError("Target language must be the other supported language")
        if not isinstance(marker.get("title"), str) or not (
                marker.get("description") is None or isinstance(marker.get("description"), str)):
            raise TranslationError("Original text fields are invalid")
        if marker.get("sourceHash") != source_hash(marker):
            raise TranslationError("Source snapshot hash does not match; export a fresh file")
        validate_translation(marker.get("translation"), marker)
    return markers


def import_translations(database: Database, markers: list[dict[str, Any]], *,
                        apply: bool, include_private: bool) -> dict[str, int]:
    counts = {"validated": len(markers), "saved": 0, "changed_or_protected": 0}
    if apply:
        for marker in markers:
            if database.save(marker, marker["translation"], include_private):
                counts["saved"] += 1
            else:
                counts["changed_or_protected"] += 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    operation = parser.add_mutually_exclusive_group()
    operation.add_argument("--export", dest="export_path", help="Write pending records to a UTF-8 JSON file; - for stdout")
    operation.add_argument("--import", dest="import_path", help="Validate a translated UTF-8 JSON file")
    parser.add_argument("--apply", action="store_true", help="Save validated --import translations")
    parser.add_argument("--limit", type=int, default=100, help="Maximum pending records (1-500, default 100)")
    parser.add_argument("--include-private", action="store_true", help="Also translate approved private records")
    parser.add_argument("--psql", default="psql", help="Path to psql executable")
    args = parser.parse_args()
    if not 1 <= args.limit <= 500:
        parser.error("--limit must be between 1 and 500")
    if args.apply and not args.import_path:
        parser.error("--apply requires --import")
    try:
        database = Database(args.psql)
        if args.import_path:
            payload = json.loads(Path(args.import_path).read_text(encoding="utf-8-sig"))
            markers = validate_import(payload, args.limit)
            counts = import_translations(database, markers, apply=args.apply,
                                         include_private=args.include_private)
            mode = "import" if args.apply else "validate-only"
        else:
            pending, counts = collect_pending(database, limit=args.limit,
                                               include_private=args.include_private)
            mode = "export" if args.export_path else "dry-run"
            if args.export_path:
                payload = json.dumps({"formatVersion": 1, "markers": pending}, ensure_ascii=False, indent=2)
                if args.export_path == "-":
                    print(payload)
                else:
                    with open(args.export_path, "x", encoding="utf-8") as output:
                        output.write(payload + "\n")
        print(json.dumps({"mode": mode, **counts}),
              file=sys.stderr if args.export_path == "-" else sys.stdout)
        return 0
    except (TranslationError, OSError, ValueError, UnicodeError) as exc:
        if not isinstance(exc, TranslationError):
            print("Could not read/write a valid translation file; existing files are not overwritten", file=sys.stderr)
            return 1
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
