"""Bring already-drawn raw images into the art set (spec v3 7) through the same cut-out, checks and
packing. They are marked interim (promptHash "interim"), so the next real batch redraws them from
the catalogue. Usage: python3 scripts/art/import_raw.py <raw dir> <mapping.json>"""
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cutout import CutoutError, cutout  # noqa: E402
from pack import pack, write_manifest  # noqa: E402
from qa import qa  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def _category(iid):
    name = iid.split("/", 1)[1]
    for c in ("landmark", "house", "public", "misc", "prop"):
        if name.startswith(c):
            return c
    raise ValueError(f"{iid}: no category in its name")


def import_dir(raw_dir, mapping, out_dir, manifest_path):
    """mapping: {file name: catalogue id} → {imported: [ids], failed: [(id, reasons)]}"""
    manifest = json.loads(Path(manifest_path).read_text()) if Path(manifest_path).exists() else {}
    rep = {"imported": [], "failed": []}
    for fname, iid in mapping.items():
        p = Path(raw_dir) / fname
        if not p.exists():
            rep["failed"].append((iid, ["missing file"]))
            continue
        try:
            rgba = cutout(Image.open(p))
        except CutoutError as e:
            rep["failed"].append((iid, [f"cutout: {e}"]))
            continue
        problems = qa(rgba, _category(iid))
        if problems:
            rep["failed"].append((iid, problems))
            continue
        item = {"id": iid, "theme": iid.split("/")[0], "category": _category(iid), "prompt": ""}
        entry = pack(rgba, item, out_dir)
        entry["promptHash"] = "interim"
        entry["source"] = "interim"
        manifest[iid] = entry
        rep["imported"].append(iid)
    write_manifest(manifest, manifest_path)
    return rep


if __name__ == "__main__":
    raw, mapfile = sys.argv[1], sys.argv[2]
    r = import_dir(raw, json.loads(Path(mapfile).read_text()), ROOT / "packages" / "web" / "public" / "art", ROOT / "art" / "manifest.json")
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(1 if r["failed"] else 0)
