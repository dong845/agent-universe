"""Cut-out sprite → two WebP sizes and a manifest entry with its footprint anchor (spec v3 7.2)."""
import hashlib
import json
from pathlib import Path

import numpy as np


def anchor_of(a):
    """(ax, ay, fw) as fractions of width/height: the footprint is the widest opaque row in the bottom
    40%; on a 2:1 diamond its centre lies a quarter of that width above the lowest opaque row"""
    h, w = a.shape
    op = a > 0.5
    rows = np.nonzero(op.any(1))[0]
    if not len(rows):
        raise ValueError("no footprint: the sprite is empty")
    bottom = rows.max()
    best, left = 0, 0
    for y in range(bottom, int(h * 0.6) - 1, -1):
        xs = np.nonzero(op[y])[0]
        if len(xs) and xs.max() - xs.min() > best:
            best, left = xs.max() - xs.min(), xs.min()
    if best == 0 or bottom < h * 0.6:
        raise ValueError("no footprint in the bottom 40% of the sprite")
    return (left + best / 2) / w, (bottom - best / 4) / h, best / w


def pack(rgba, item, out_dir, big=512, small=128):
    theme, name = item["id"].split("/", 1)
    ax, ay, fw = anchor_of(np.asarray(rgba.convert("RGBA"))[..., 3] / 255)
    d = Path(out_dir) / theme
    d.mkdir(parents=True, exist_ok=True)
    for size, suffix in ((big, ""), (small, "@128")):
        im = rgba.copy()
        im.thumbnail((size, size), resample=1)  # LANCZOS
        if max(rgba.size) < size and suffix == "":
            im = rgba.resize((round(rgba.size[0] * size / max(rgba.size)), round(rgba.size[1] * size / max(rgba.size))), 1)
        im.save(d / f"{name}{suffix}.webp", "WEBP", quality=88, method=6, exact=True)
    w, h = rgba.size
    return {
        "id": item["id"], "theme": item["theme"], "category": item["category"],
        "w": w, "h": h, "anchor": [round(ax, 4), round(ay, 4)], "footprint": round(fw, 4),
        "promptHash": hashlib.sha256(item["prompt"].encode()).hexdigest()[:16],
    }


def write_manifest(entries, path):
    Path(path).write_text(json.dumps(entries, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
