"""Magenta chroma-key cut-out (spec v3 7.2). Removed: the magenta background connected to the image
border, and any enclosed patch that is (nearly) pure #FF00FF — background seen through a gap, since
Codex never paints that colour on purpose. A purple or pink detail inside the building survives. The
edge is softened and the magenta spill is pulled out of the rim only."""
import numpy as np
from PIL import Image
from scipy import ndimage

KEY = np.array([255, 0, 255], np.float32)


class CutoutError(ValueError):
    pass


def cutout(img, hard=90.0, soft=170.0, margin=4):
    im = np.asarray(img.convert("RGB")).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    chroma = np.minimum(r, b) - g  # high on magenta, near zero or negative on warm and neutral colours
    dist = np.sqrt(((im - KEY) ** 2).sum(-1))
    cand = (dist < soft) | (chroma > 120)
    lab, _ = ndimage.label(cand)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    if not border:
        raise CutoutError("no background connected to the border: not a magenta-keyed image")
    # enclosed patches whose typical pixel is pure magenta are holes, not details
    n = lab.max()
    if n:
        med = ndimage.median(dist, lab, index=np.arange(1, n + 1))
        holes = {i + 1 for i, m in enumerate(np.atleast_1d(med)) if m < 45}
    else:
        holes = set()
    bg = np.isin(lab, list(border | holes))
    alpha = np.where(bg, np.clip((dist - hard) / (soft - hard), 0, 1), 1.0)
    alpha[bg & (chroma > 120)] = np.minimum(alpha[bg & (chroma > 120)], 0.0)
    if (alpha > 0.05).sum() == 0:
        raise CutoutError("nothing left after removing the background")
    # despill on the rim: within 3 px of the background, pull r and b down toward g
    rim = ndimage.binary_dilation(alpha < 0.5, iterations=3) & (alpha > 0)
    excess = np.clip(np.minimum(r, b) - g, 0, None) * rim
    fix = im.copy()
    fix[..., 0] -= excess
    fix[..., 2] -= excess
    rgba = np.dstack([np.clip(fix, 0, 255), alpha * 255]).astype(np.uint8)
    ys, xs = np.nonzero(alpha > 0.05)
    box = (max(xs.min() - margin, 0), max(ys.min() - margin, 0), min(xs.max() + margin + 1, im.shape[1]), min(ys.max() + margin + 1, im.shape[0]))
    return Image.fromarray(rgba, "RGBA").crop(box)
