"""Automatic checks on a cut-out sprite (spec v3 7.2). Returns the names of the problems found."""
import numpy as np
from scipy import ndimage

BUILDINGS = {"landmark", "house", "public", "misc"}


def view_slope(a):
    """how fast the opaque half-width grows per pixel of height above the lowest opaque row (2:1 iso → 2)"""
    h, w = a.shape
    op = a > 0.5
    rows = np.nonzero(op.any(1))[0]
    if not len(rows):
        return None
    bottom = rows.max()
    hs, ws = [], []
    for dh in range(int(0.03 * w), int(0.2 * w)):
        y = bottom - dh
        if y < 0:
            break
        xs = np.nonzero(op[y])[0]
        if len(xs):
            hs.append(dh)
            ws.append((xs.max() - xs.min()) / 2)
    if len(hs) < 5:
        return None
    return float(np.polyfit(hs, ws, 1)[0])


def qa(rgba, category):
    arr = np.asarray(rgba.convert("RGBA")).astype(np.float32)
    a = arr[..., 3] / 255
    rgb = arr[..., :3]
    problems = []
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    if edge.max() > 0.05:
        problems.append("edge not clear")
    kept = (a > 0.5).mean()
    if not 0.15 <= kept <= 0.95:
        problems.append("kept ratio")
    # magenta only counts on the rim: purple flowers and red roofs inside the building are fine
    op = a > 0.5
    rim = op & ndimage.binary_dilation(~op, iterations=3)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    pink = (np.minimum(r, b) - g > 60) & (np.abs(r - b) < 60)
    if (pink & rim).sum() > 0.005 * max(op.sum(), 1):
        problems.append("magenta fringe")
    # pure magenta anywhere in the opaque part: background left inside (a gap the cut-out missed)
    pure = op & (np.sqrt(((rgb - np.array([255, 0, 255])) ** 2).sum(-1)) < 60)
    if pure.sum() > max(20, 0.0005 * op.sum()):
        problems.append("magenta inside")
    w, h = rgba.size
    if not 0.45 <= w / h <= 2.2:
        problems.append("aspect")
    if category in BUILDINGS:
        s = view_slope(a)
        # calibrated on 18 real Codex buildings (all at the right angle): 1.67–2.63; front-on ≈ 0, top-down ≈ 1
        if s is None or not 1.5 <= s <= 3.0:
            problems.append("view")
    return problems
