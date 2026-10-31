import json

import numpy as np
import pytest
from cutout import cutout
from pack import anchor_of, pack, write_manifest
from PIL import Image
from synth import sprite

ITEM = {"id": "publishing/house_code_a", "theme": "publishing", "category": "house", "prompt": "p"}


def test_anchor_sits_in_the_middle_of_the_diamond(tmp_path):
    im = cutout(sprite())
    ax, ay, fw = anchor_of(np.asarray(im)[..., 3] / 255)
    w, h = im.size
    # synthetic diamond: half-width 0.3·512 = 153 px, lowest point at 0.78·512 + 76.5; its centre is 0.78·512
    top = 0  # cutout trims, so compare against the trimmed bottom
    bottom = np.nonzero((np.asarray(im)[..., 3] > 127).any(1))[0].max()
    assert abs(ax * w - w / 2) < 0.02 * w
    assert abs(ay * h - (bottom - 153 / 2)) < 0.02 * h
    assert abs(fw * w - 306) < 0.03 * 306


def test_two_sizes_and_a_stable_manifest(tmp_path):
    entry = pack(cutout(sprite()), ITEM, tmp_path)
    big = Image.open(tmp_path / "publishing" / "house_code_a.webp")
    small = Image.open(tmp_path / "publishing" / "house_code_a@128.webp")
    assert max(big.size) == 512 and big.mode == "RGBA"
    assert max(small.size) <= 128
    assert entry["id"] == ITEM["id"] and entry["category"] == "house" and len(entry["promptHash"]) == 16
    m = tmp_path / "manifest.json"
    write_manifest({entry["id"]: entry}, m)
    first = m.read_bytes()
    write_manifest(json.loads(first), m)
    assert m.read_bytes() == first


def test_no_footprint_is_an_error(tmp_path):
    im = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    im.paste((200, 90, 60, 255), (20, 5, 80, 30))
    with pytest.raises(ValueError, match="footprint"):
        pack(im, ITEM, tmp_path)


def test_a_write_killed_half_way_keeps_the_old_manifest(tmp_path, monkeypatch):
    import pathlib

    m = tmp_path / "manifest.json"
    write_manifest({"a": {"id": "a"}}, m)
    before = m.read_bytes()
    real = pathlib.Path.write_text

    def half(self, text, *a, **k):
        real(self, text[: len(text) // 2], *a, **k)
        raise OSError("killed")

    monkeypatch.setattr(pathlib.Path, "write_text", half)
    with pytest.raises(OSError):
        write_manifest({"a": {"id": "a"}, "b": {"id": "b"}}, m)
    monkeypatch.undo()
    assert m.read_bytes() == before
