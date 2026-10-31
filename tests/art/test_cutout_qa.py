import numpy as np
import pytest
from cutout import CutoutError, cutout
from PIL import Image
from qa import qa
from synth import sprite, prop


def alpha(im):
    return np.asarray(im)[..., 3]


def test_a_clean_sprite_passes():
    out = cutout(sprite())
    assert out.mode == "RGBA"
    assert qa(out, "house") == []


def test_background_seen_through_a_gap_is_removed_too():
    # pure #FF00FF enclosed by the building is the background showing through (a tent opening, the
    # space under a bench): Codex never paints that colour on purpose
    out = cutout(sprite(window=True))
    a = alpha(out)
    h, w = a.shape
    assert a[int(h * 0.45), w // 2] == 0
    assert qa(out, "house") == []


def test_a_purple_detail_inside_the_building_stays():
    from PIL import ImageDraw

    im = sprite()
    ImageDraw.Draw(im).ellipse([236, 260, 276, 300], fill=(150, 80, 170))  # purple flowers
    out = cutout(im)
    arr = np.asarray(out)
    ys, xs = np.nonzero((arr[..., 0] == 150) & (arr[..., 2] == 170))
    assert len(ys) > 100 and arr[ys, xs, 3].min() == 255


def test_qa_catches_magenta_left_inside():
    clean = np.asarray(cutout(sprite())).copy()
    h, w = clean.shape[:2]
    clean[int(h * 0.5) : int(h * 0.5) + 30, w // 2 - 15 : w // 2 + 15] = (255, 0, 255, 255)
    assert "magenta inside" in qa(Image.fromarray(clean, "RGBA"), "house")


def test_an_uneven_background_is_refused():
    with pytest.raises(CutoutError, match="not uniform"):
        cutout(sprite(bg="gradient"))


def test_a_front_on_view_is_caught():
    assert "view" in qa(cutout(sprite(footprint="rect")), "house")


def test_props_skip_the_view_check():
    assert qa(cutout(prop()), "prop") == []


def test_all_magenta_is_an_error():
    with pytest.raises(CutoutError):
        cutout(Image.new("RGB", (64, 64), (255, 0, 255)))


def test_the_cutout_takes_the_pink_out_of_the_rim():
    assert "magenta fringe" not in qa(cutout(sprite(fringe=True)), "house")


def test_qa_catches_a_pink_rim_left_on_a_sprite():
    clean = np.asarray(cutout(sprite())).copy()
    a = clean[..., 3] > 127
    from scipy import ndimage

    rim = a & ndimage.binary_dilation(~a, iterations=2)
    clean[rim, :3] = (200, 60, 190)
    assert "magenta fringe" in qa(Image.fromarray(clean, "RGBA"), "house")


def test_trim_leaves_a_small_margin():
    out = cutout(sprite())
    a = alpha(out)
    assert a[:4].max() == 0 and a[:, :4].max() == 0
    assert out.size[0] < 512 and out.size[1] < 512


def test_a_top_down_view_is_caught():
    # seen from straight above, a square turned 45° widens 1 pixel per pixel of height, not 2
    im = Image.new("RGB", (512, 512), (255, 0, 255))
    from PIL import ImageDraw

    ImageDraw.Draw(im).polygon([(256, 80), (432, 256), (256, 432), (80, 256)], fill=(200, 90, 60))
    assert "view" in qa(cutout(im), "house")


def test_a_background_that_darkens_towards_the_building_is_refused():
    # magenta at the image border, darkening to purple near the building: a halo the border rule cannot see
    im = sprite()
    arr = np.asarray(im).astype(float)
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot(yy - h / 2, xx - w / 2) / (w / 2)
    bg = (arr == [255, 0, 255]).all(-1)
    shade = np.clip(1 - d, 0, 1)[..., None] * (np.array([90, 60, 90]) - np.array([255, 0, 255])) + np.array([255, 0, 255])
    arr[bg] = shade[bg]
    with pytest.raises(CutoutError, match="not uniform"):
        cutout(Image.fromarray(arr.astype(np.uint8)))
