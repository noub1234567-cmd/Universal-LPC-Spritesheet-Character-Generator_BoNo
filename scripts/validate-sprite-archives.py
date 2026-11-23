#!/usr/bin/env python3
"""Validate the Android spritesheet archive index and every ZIP entry."""
from pathlib import Path
from zipfile import ZipFile
from collections import defaultdict
import json

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

indexed_by_archive = defaultdict(set)
for relative_path, archive_name in mapping.items():
    if not isinstance(relative_path, str) or not relative_path or relative_path.startswith("/"):
        raise SystemExit(f"Invalid sprite path in index: {relative_path!r}")
    if ".." in Path(relative_path).parts:
        raise SystemExit(f"Unsafe sprite path in index: {relative_path}")
    if archive_name not in archives:
        raise SystemExit(f"Index references missing archive: {archive_name}")
    indexed_by_archive[archive_name].add(relative_path)

actual = set()
for archive_name, archive_path in archives.items():
    with ZipFile(archive_path) as archive:
        members = {name for name in archive.namelist() if not name.endswith("/")}
        expected = indexed_by_archive.get(archive_name, set())
        if members != expected:
            missing = sorted(expected - members)[:5]
            unindexed = sorted(members - expected)[:5]
            raise SystemExit(
                f"Archive/index mismatch for {archive_name}; "
                f"missing={missing}, unindexed={unindexed}"
            )
        actual.update((archive_name, name) for name in members)

if sum(len(paths) for paths in indexed_by_archive.values()) != len(mapping):
    raise SystemExit("Duplicate archive index keys detected")

if (ROOT / "dist" / "spritesheets").exists():
    raise SystemExit("Original dist/spritesheets directory remains; APK entry reduction did not run")

print(f"Validated {len(mapping)} sprites across {len(archives)} ZIP shards")
