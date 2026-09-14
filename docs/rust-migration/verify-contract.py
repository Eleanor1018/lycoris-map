#!/usr/bin/env python3
"""Verify docs/rust-migration/api-contract.json against the Java controllers.

Standard library only. It reads the contract JSON and the six production
controller sources under backend/src/main/java/com/lycoris/controller. It does
not start a server, connect to a database, or read credentials or data.

Checks:
  * top-level shape and per-endpoint required fields
  * unique (method, path) pairs in the contract, and no duplicate paths per verb
  * method-level @Get/@Post/@Patch/@DeleteMapping extracted from each controller,
    including annotations without parentheses and value=/path= forms
  * class-level @RequestMapping merged as the path prefix
  * Spring template suffixes such as {filename:.+} normalized to {filename}
  * the normalized source route set compared item by item with the contract

Exit code 0 means the contract matches the source. Missing routes (in source
but not contract), extra routes (in contract but not source), duplicates, or
malformed structures exit non-zero.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
CONTRACT_PATH = SCRIPT_DIR / "api-contract.json"
CONTROLLER_DIR = REPO_ROOT / "backend" / "src" / "main" / "java" / "com" / "lycoris" / "controller"

REQUIRED_TOP_LEVEL = ("baselineCommit", "endpoints")
REQUIRED_ENDPOINT_FIELDS = (
    "method",
    "path",
    "controller",
    "handler",
    "auth",
    "request",
    "success",
    "errors",
    "notes",
)
VALID_METHODS = {"GET", "POST", "PATCH", "DELETE"}

METHOD_ANNOTATION = re.compile(r"@(Get|Post|Patch|Delete)Mapping\b\s*(?:\(([^)]*)\))?", re.DOTALL)
CLASS_MAPPING = re.compile(r"@RequestMapping\s*\(\s*(?:value\s*=\s*)?\"([^\"]*)\"")
CLASS_DECLARATION = re.compile(r"\bclass\s+(\w+)")
SPRING_TEMPLATE_SUFFIX = re.compile(r"\{([^}:]+):[^}]+\}")
QUOTED = re.compile(r"\"([^\"]*)\"")
NAMED_PATH = re.compile(r"(?:value|path)\s*=\s*\"([^\"]*)\"")


def normalize_path(path: str) -> str:
    """Normalize a Spring route for comparison."""
    cleaned = SPRING_TEMPLATE_SUFFIX.sub(r"{\1}", path.strip())
    if not cleaned:
        return "/"
    if not cleaned.startswith("/"):
        cleaned = "/" + cleaned
    cleaned = re.sub(r"/{2,}", "/", cleaned)
    if len(cleaned) > 1 and cleaned.endswith("/"):
        cleaned = cleaned.rstrip("/")
    return cleaned


def annotation_path(args: str | None) -> str:
    """Return the path declared by a mapping annotation's argument list."""
    if args is None:
        return ""
    named = NAMED_PATH.search(args)
    if named:
        return named.group(1)
    positional = QUOTED.search(args)
    return positional.group(1) if positional else ""


def parse_controllers(directory: Path) -> tuple[set[tuple[str, str]], list[str]]:
    """Return (normalized routes, referenced controller class names)."""
    if not directory.is_dir():
        raise SystemExit(f"controller directory not found: {directory}")

    controllers = sorted(directory.glob("*Controller.java"))
    if not controllers:
        raise SystemExit(f"no *Controller.java files found in {directory}")

    routes: set[tuple[str, str]] = set()
    class_names: list[str] = []
    for path in controllers:
        text = path.read_text(encoding="utf-8")
        class_match = CLASS_DECLARATION.search(text)
        class_name = class_match.group(1) if class_match else path.stem
        class_names.append(class_name)

        class_match_path = CLASS_MAPPING.search(text)
        base = class_match_path.group(1) if class_match_path else ""

        for match in METHOD_ANNOTATION.finditer(text):
            verb = match.group(1).upper()
            route = normalize_path(base + annotation_path(match.group(2)))
            routes.add((verb, route))
    return routes, class_names


def load_contract() -> dict:
    if not CONTRACT_PATH.is_file():
        raise SystemExit(f"contract file not found: {CONTRACT_PATH}")
    try:
        data = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"contract JSON is invalid: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("contract JSON must be an object")
    return data


def main() -> int:
    data = load_contract()
    errors: list[str] = []

    for field in REQUIRED_TOP_LEVEL:
        if field not in data:
            errors.append(f"missing top-level field: {field}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    endpoints = data["endpoints"]
    if not isinstance(endpoints, list) or not endpoints:
        print("endpoints must be a non-empty list", file=sys.stderr)
        return 1
    if "endpointCount" in data and data["endpointCount"] != len(endpoints):
        errors.append(
            f"endpointCount is {data['endpointCount']} but there are {len(endpoints)} endpoints"
        )

    contract_routes: set[tuple[str, str]] = set()
    seen: dict[tuple[str, str], int] = {}
    for index, endpoint in enumerate(endpoints):
        where = f"endpoints[{index}]"
        if not isinstance(endpoint, dict):
            errors.append(f"{where} is not an object")
            continue
        for field in REQUIRED_ENDPOINT_FIELDS:
            if field not in endpoint:
                errors.append(f"{where} missing field: {field}")
        method = endpoint.get("method")
        path = endpoint.get("path")
        if not isinstance(method, str) or method.upper() not in VALID_METHODS:
            errors.append(f"{where} has invalid method: {method!r}")
            continue
        if not isinstance(path, str) or not path.startswith("/"):
            errors.append(f"{where} has invalid path: {path!r}")
            continue
        if not isinstance(endpoint.get("errors"), list):
            errors.append(f"{where}.errors must be a list")

        key = (method.upper(), normalize_path(path))
        if key in contract_routes:
            first = seen[key]
            errors.append(
                f"duplicate contract route {key[0]} {key[1]} at endpoints[{first}] and endpoints[{index}]"
            )
        else:
            contract_routes.add(key)
            seen[key] = index

    source_routes, class_names = parse_controllers(CONTROLLER_DIR)

    missing = sorted(source_routes - contract_routes)
    extra = sorted(contract_routes - source_routes)

    referenced = {endpoint.get("controller") for endpoint in endpoints if isinstance(endpoint, dict)}
    unknown_controllers = sorted(name for name in referenced if name not in class_names)

    if missing:
        errors.append("routes present in source but missing from contract:")
        errors.extend(f"  - {verb} {path}" for verb, path in missing)
    if extra:
        errors.append("routes present in contract but not found in source:")
        errors.extend(f"  - {verb} {path}" for verb, path in extra)
    if unknown_controllers:
        errors.append("contract references unknown controllers:")
        errors.extend(f"  - {name}" for name in unknown_controllers)

    print(f"contract endpoints: {len(endpoints)}")
    print(f"source routes:      {len(source_routes)}")
    print(f"controllers:        {', '.join(class_names)}")

    if errors:
        print(f"\nFAIL ({len(errors)} problem(s)):", file=sys.stderr)
        print("\n".join(errors), file=sys.stderr)
        return 1

    print("\nOK: contract matches the six Java controllers exactly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
