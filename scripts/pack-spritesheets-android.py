#!/usr/bin/env python3
"""Pack spritesheets into ZIP shards for Android's 65,535 APK-entry limit."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "dist" / "spritesheets"
OUT = ROOT / "dist" / "sprite-archives"
MAX_FILES = 20000

if not SPRITES.is_dir():
    raise SystemExit("dist/spritesheets was not found; run npm run build first")
files = sorted(p for p in SPRITES.rglob("*") if p.is_file())
if not files:
    raise SystemExit("No spritesheet files found")
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)
mapping = {}
for shard_number, start in enumerate(range(0, len(files), MAX_FILES)):
    batch = files[start:start + MAX_FILES]
    archive_name = f"sprites-{shard_number:03d}.zip"
    archive_path = OUT / archive_name
    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED, compresslevel=6, allowZip64=False) as archive:
        for path in batch:
            relative = path.relative_to(SPRITES).as_posix()
            archive.write(path, arcname=relative)
            mapping[relative] = archive_name
    print(f"{archive_name}: {len(batch)} files, {archive_path.stat().st_size} bytes")
(OUT / "index.json").write_text(
    json.dumps({"files": mapping}, separators=(",", ":")), encoding="utf-8"
)
shutil.rmtree(SPRITES)
print(f"Packed {len(files)} files into {(len(files) + MAX_FILES - 1) // MAX_FILES} ZIP shards")
