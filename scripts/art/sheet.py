"""Contact sheet for the owner: every new sprite, then a row of the ones that failed (待你看)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONTS = ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]


def _font(size):
    for f in FONTS:
        if Path(f).exists():
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                pass
    return ImageFont.load_default()


def make_sheet(made, failed, path, cell=220, cols=8):
    """made: [(id, image path)], failed: [(id, reasons, raw path or None)]"""
    rows_ok = (len(made) + cols - 1) // cols
    rows_bad = (len(failed) + cols - 1) // cols
    head = 44
    h = head + rows_ok * cell + (head + rows_bad * cell if failed else 0) + 10
    sheet = Image.new("RGB", (cols * cell, max(h, head + 10)), (157, 187, 111))
    d = ImageDraw.Draw(sheet)
    f, small = _font(22), _font(13)
    d.text((10, 10), f"新做的 {len(made)} 张", fill=(40, 30, 20), font=f)

    def tile(i, y0, img_path, label, bg=None):
        x, y = (i % cols) * cell, y0 + (i // cols) * cell
        if bg:
            d.rectangle([x + 2, y + 2, x + cell - 2, y + cell - 2], fill=bg)
        if img_path and Path(img_path).exists():
            im = Image.open(img_path).convert("RGBA")
            im.thumbnail((cell - 16, cell - 40))
            sheet.paste(im, (x + (cell - im.size[0]) // 2, y + 6), im)
        d.text((x + 6, y + cell - 30), label[:34], fill=(40, 30, 20), font=small)

    for i, (iid, p) in enumerate(made):
        tile(i, head, p, iid)
    if failed:
        y0 = head + rows_ok * cell
        d.text((10, y0 + 10), f"待你看：{len(failed)} 张没通过自动检查", fill=(130, 20, 20), font=f)
        for i, (iid, reasons, p) in enumerate(failed):
            tile(i, y0 + head, p, f"{iid} · {', '.join(reasons)}", bg=(230, 200, 190))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
