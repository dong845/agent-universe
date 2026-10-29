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


def test_magenta_inside_the_building_stays():
    out = cutout(sprite(window=True))
    a = alpha(out)
    h, w = a.shape
    # the window sits in the middle of the body
    assert a[int(h * 0.45), w // 2] == 255
    assert qa(out, "house") == []


def test_an_uneven_background_is_caught():
    assert "edge not clear" in qa(cutout(sprite(bg="gradient")), "house")


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
