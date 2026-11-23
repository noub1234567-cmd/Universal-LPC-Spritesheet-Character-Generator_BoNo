#!/usr/bin/env python3
"""Validate the Android spritesheet archive index and every ZIP entry."""
from pathlib import Path
from zipfile import ZipFile
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_DIR = ROOT / "dist" / "sprite-archives"
INDEX = ARCHIVE_DIR / "index.json"

if not INDEX.is_file():
    raise SystemExit("Missing dist/sprite-archives/index.json")

data = json.loads(INDEX.read_text(encoding="utf-8"))
mapping = data.get("files")
if not isinstance(mapping, dict) or not mapping:
    raise SystemExit("Archive index must contain a non-empty 'files' object")

archives = {p.name: p for p in ARCHIVE_DIR.glob("*.zip")}
if not archives:
    raise SystemExit("No sprite ZIP shards were generated")

seen = set()
for relative_path, archive_name in mapping.items():
    if not isinstance(relative_path, str) or not relative_path or relative_path.startswith("/"):
        raise SystemExit(f"Invalid sprite path in index: {relative_path!r}")
    if ".." in Path(relative_path).parts:
        raise SystemExit(f"Unsafe sprite path in index: {relative_path}")
    archive_path = archives.get(archive_name)
    if archive_path is None:
        raise SystemExit(f"Index references missing archive: {archive_name}")
    with ZipFile(archive_path) as archive:
        if relative_path not in archive.namelist():
            raise SystemExit(f"Indexed sprite missing from {archive_name}: {relative_path}")
    seen.add((archive_name, relative_path))

actual = set()
for archive_name, archive_path in archives.items():
    with ZipFile(archive_path) as archive:
        for member in archive.namelist():
            if member.endswith("/"):
                continue
            key = (archive_name, member)
            if key in actual:
                raise SystemExit(f"Duplicate ZIP entry: {key}")
            actual.add(key)

if actual != seen:
    missing = sorted(actual - seen)[:5]
    dangling = sorted(seen - actual)[:5]
    raise SystemExit(f"Index/archive mismatch; unindexed={missing}, missing={dangling}")

if (ROOT / "dist" / "spritesheets").exists():
    raise SystemExit("Original dist/spritesheets directory remains; APK entry reduction did not run")

print(f"Validated {len(mapping)} sprites across {len(archives)} ZIP shards")
