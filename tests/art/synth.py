"""Synthetic sprites on magenta for the art tests: no real art is needed."""
from PIL import Image, ImageDraw

MAGENTA = (255, 0, 255)


def sprite(footprint="diamond", bg="magenta", window=False, fringe=False, size=512):
    im = Image.new("RGB", (size, size), MAGENTA)
    d = ImageDraw.Draw(im)
    if bg == "gradient":
        for y in range(size):
            d.line([(0, y), (size, y)], fill=(255 - y // 3, y // 3, 255 - y // 4))
    cx, base, hw = size // 2, int(size * 0.78), int(size * 0.3)
    if footprint == "diamond":
        foot = [(cx - hw, base), (cx, base - hw // 2), (cx + hw, base), (cx, base + hw // 2)]
    else:  # seen front-on: a flat-bottomed slab
        foot = [(cx - hw, base - 20), (cx + hw, base - 20), (cx + hw, base + 20), (cx - hw, base + 20)]
    body = [(cx - hw, base), (cx - hw, int(size * 0.35)), (cx + hw, int(size * 0.35)), (cx + hw, base)]
    if fringe:
        d.polygon(foot, fill=(170, 70, 160))
        d.polygon(body, fill=(170, 70, 160))
        foot = [(x + (3 if x < cx else -3 if x > cx else 0), y + (-3 if y > base else 3 if y < base else 0)) for x, y in foot]
        body = [(x + (3 if x < cx else -3), y + (3 if y < base else 0)) for x, y in body]
    d.polygon(foot, fill=(150, 150, 140))
    d.polygon(body, fill=(235, 220, 190))
    d.polygon([(cx - hw, int(size * 0.35)), (cx, int(size * 0.18)), (cx + hw, int(size * 0.35))], fill=(200, 90, 60))
    if window:
        d.rectangle([cx - 20, int(size * 0.5), cx + 20, int(size * 0.58)], fill=MAGENTA)
    return im


def prop(size=512):
    im = Image.new("RGB", (size, size), MAGENTA)
    d = ImageDraw.Draw(im)
    d.ellipse([size * 0.3, size * 0.15, size * 0.7, size * 0.6], fill=(120, 160, 90))
    d.rectangle([size * 0.47, size * 0.55, size * 0.53, size * 0.8], fill=(110, 80, 50))
    return im
