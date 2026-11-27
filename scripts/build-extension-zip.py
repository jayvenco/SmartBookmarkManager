"""Packs extension/ into backend/app/assets/smart-bookmark-extension.zip (deterministic).

Run after every change under extension/ (the web app serves this file to logged-in users).
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
OUT = ROOT / "backend" / "app" / "assets" / "smart-bookmark-extension.zip"


def files():
    return sorted(p for p in SRC.rglob("*") if p.is_file() and p.name != ".DS_Store")


def build() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files():
            info = zipfile.ZipInfo("smart-bookmark-extension/" + p.relative_to(SRC).as_posix(), (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, p.read_bytes())
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {len(files())} files)")


if __name__ == "__main__":
    build()
