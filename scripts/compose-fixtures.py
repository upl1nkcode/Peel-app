"""Builds the auto cutout e2e fixtures (spec 0007 AC-21 to AC-23).

Run by hand; the outputs in e2e/fixtures/auto/ are committed. Needs Pillow.

    py scripts/compose-fixtures.py SOURCES_DIR

SOURCES_DIR holds the CC0 originals from Wikimedia Commons (see
e2e/fixtures/auto/README.md), under these names:

    teacup.png   Teacup.png (Rijksmuseum)
    shoe.png     Worn Shoe.png (Aupajo)
    woman.png    Woman in White Sleeveless Dress ... transparent.png
    gravel.jpg   Dog on dirt road.jpg, the 1920 px-wide rendition

Each composite is 960x600, JPEG quality 95. Each subject's alpha, placed
exactly as composited, is saved as <fixture>.<subject>.alpha.png.
"""

import json
import sys
from pathlib import Path

from PIL import Image

SIZE = (960, 600)
OUT = Path(__file__).resolve().parent.parent / "e2e" / "fixtures" / "auto"
# Pixels this faint are not part of the subject when cropping it.
CROP_ALPHA = 8


def subject(path: Path, height: int) -> Image.Image:
    """The subject cropped to its alpha and scaled to `height` px tall."""
    im = Image.open(path).convert("RGBA")
    box = im.getchannel("A").point(lambda a: 255 if a > CROP_ALPHA else 0).getbbox()
    im = im.crop(box)
    width = round(im.width * height / im.height)
    # Pillow premultiplies RGBA while resizing, so edges keep their colour.
    return im.resize((width, height), Image.Resampling.LANCZOS)


def background(gravel: Path, box: tuple[int, int, int, int]) -> Image.Image:
    im = Image.open(gravel).convert("RGB")
    if im.width != 1920:
        raise SystemExit(f"{gravel} must be the 1920 px-wide rendition")
    return im.crop(box).convert("RGBA")


def place(canvas: Image.Image, sub: Image.Image, at: tuple[int, int]) -> Image.Image:
    """Composites `sub` with its top-left at `at`; returns its alpha on a full-size layer."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(sub, at)
    canvas.alpha_composite(layer)
    return layer.getchannel("A")


def tap_point(alpha: Image.Image) -> dict[str, float]:
    """The alpha-weighted centroid, moved to the nearest opaque pixel's centre."""
    w, h = alpha.size
    data = alpha.load()
    total = sx = sy = 0.0
    for y in range(h):
        for x in range(w):
            a = data[x, y]
            if a:
                total += a
                sx += a * (x + 0.5)
                sy += a * (y + 0.5)
    cx, cy = sx / total, sy / total
    best = None
    for y in range(h):
        for x in range(w):
            if data[x, y] == 255:
                d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
                if best is None or d < best[0]:
                    best = (d, x, y)
    if best is None:
        raise SystemExit("subject has no opaque pixel")
    return {"x": best[1] + 0.5, "y": best[2] + 0.5}


def save(name: str, canvas: Image.Image, alphas: dict[str, Image.Image]) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT / f"{name}.jpg", quality=95)
    entry: dict = {"image": f"{name}.jpg", "subjects": {}}
    for key, alpha in alphas.items():
        file = f"{name}.{key}.alpha.png"
        alpha.save(OUT / file)
        entry["subjects"][key] = {"alpha": file, "tap": tap_point(alpha)}
    return entry


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    gravel = src / "gravel.jpg"
    objects_bg = (0, 840, 960, 1440)
    person_bg = (960, 840, 1920, 1440)
    fixtures = {}

    # object: the teacup, 360 px tall, centred.
    canvas = background(gravel, objects_bg)
    cup = subject(src / "teacup.png", 360)
    at = ((SIZE[0] - cup.width) // 2, (SIZE[1] - cup.height) // 2)
    fixtures["object"] = save("object", canvas, {"A": place(canvas, cup, at)})

    # two-objects: teacup (A) and shoe (B), 280 px tall, centred at x = 260 and 700.
    canvas = background(gravel, objects_bg)
    alphas = {}
    for key, file, cx in (("A", "teacup.png", 260), ("B", "shoe.png", 700)):
        sub = subject(src / file, 280)
        at = (cx - sub.width // 2, (SIZE[1] - sub.height) // 2)
        alphas[key] = place(canvas, sub, at)
    fixtures["two-objects"] = save("two-objects", canvas, alphas)

    # person: 600 px tall, centred horizontally, touching the bottom edge.
    canvas = background(gravel, person_bg)
    woman = subject(src / "woman.png", 600)
    at = ((SIZE[0] - woman.width) // 2, SIZE[1] - woman.height)
    alpha = place(canvas, woman, at)
    entry = save("person", canvas, {"A": alpha})
    left, top, right, bottom = alpha.point(lambda a: 255 if a >= 128 else 0).getbbox()
    entry["headBox"] = {
        "x": left,
        "y": top,
        "width": right - left,
        "height": round((bottom - top) * 0.25),
    }
    fixtures["person"] = entry

    (OUT / "fixtures.json").write_text(json.dumps(fixtures, indent=2) + "\n")


if __name__ == "__main__":
    main()
