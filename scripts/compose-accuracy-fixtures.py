"""Builds the accuracy benchmark's test photos (spec 0014 AC-1 to AC-3).

Run by hand; the outputs in bench/fixtures/ are committed. Needs Pillow.

    py scripts/compose-accuracy-fixtures.py SOURCES_DIR

SOURCES_DIR holds the originals listed in bench/fixtures/README.md, under
the names given there. Each photo is 1600 x 1000, JPEG quality 90, and at
most 800 KB (spec 0014 AC-2). Subjects are only ever
scaled down, never up, so a photo is as sharp as its source.

For each fixture it writes the photo, `<name>.truth.png` (the subject's
alpha exactly as composited, as the alpha of a white RGBA PNG) and, for
`two-people` and `skin-object`, `<name>.extra.png` (the distractor's visible
alpha). bench/fixtures/fixtures.json gets the tap point (the alpha-weighted
centroid moved to the nearest fully opaque pixel, as in spec 0007) and, for
`hole`, `holeProbe`: the largest box inside the hole.
"""

import io
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops

SIZE = (1600, 1000)
OUT = Path(__file__).resolve().parent.parent / "bench" / "fixtures"
MAX_BYTES = 800 * 1024
# Pixels this faint are not part of the subject when cropping it.
CROP_ALPHA = 8
# Hair and fur truths must be this soft (AC-3).
MIN_SOFT_SHARE = 0.02
# spec 0015 AC-3: the small subject's box is this share of the long side;
# overlap's B covers at least this much of A's box, in colours this close.
SMALL_SHARE = 0.2
MIN_OVERLAP = 0.3
MAX_COLOUR_GAP = 40


def normalised_alpha(im: Image.Image) -> Image.Image:
    """Some cut-outs store their opaque body as 254: scale so it is 255."""
    a = im.getchannel("A")
    hist = a.histogram()
    body = max(range(200, 256), key=lambda v: hist[v])
    if body == 255:
        return im
    scale = 255 / body
    im = im.copy()
    im.putalpha(a.point(lambda v: min(255, round(v * scale))))
    return im


def subject(path: Path, height: int | None = None) -> Image.Image:
    """The subject cropped to its alpha, scaled down to `height` px tall (never up)."""
    im = normalised_alpha(Image.open(path).convert("RGBA"))
    box = im.getchannel("A").point(lambda a: 255 if a > CROP_ALPHA else 0).getbbox()
    im = im.crop(box)
    if height is None or height >= im.height:
        return im
    width = round(im.width * height / im.height)
    # Pillow premultiplies RGBA while resizing, so edges keep their colour.
    return im.resize((width, height), Image.Resampling.LANCZOS)


def background(path: Path) -> Image.Image:
    """The photo scaled to cover 1600 x 1000, centre-cropped."""
    im = Image.open(path).convert("RGB")
    s = max(SIZE[0] / im.width, SIZE[1] / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.LANCZOS)
    left = (im.width - SIZE[0]) // 2
    top = (im.height - SIZE[1]) // 2
    return im.crop((left, top, left + SIZE[0], top + SIZE[1])).convert("RGBA")


def place(canvas: Image.Image, sub: Image.Image, at: tuple[int, int]) -> Image.Image:
    """Composites `sub` with its top-left at `at`; returns its alpha on a full-size layer."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(sub, at)
    canvas.alpha_composite(layer)
    return layer.getchannel("A")


def behind(back: Image.Image, front: Image.Image) -> Image.Image:
    """What shows of `back` with `front` over it: back x (1 - front)."""
    return ImageChops.multiply(back, ImageChops.invert(front))


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


def soft_share(alpha: Image.Image) -> float:
    """Share of the subject's bounding box with alpha in 1-254 (AC-3)."""
    crop = alpha.crop(alpha.getbbox())
    hist = crop.histogram()
    return sum(hist[1:255]) / (crop.width * crop.height)


def hole_probe(alpha: Image.Image) -> dict[str, int]:
    """The largest axis-aligned box of empty pixels not connected to the border."""
    w, h = alpha.size
    data = alpha.load()
    outside = bytearray(w * h)
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        queue.extend(((x, 0), (x, h - 1)))
    for y in range(h):
        queue.extend(((0, y), (w - 1, y)))
    while queue:
        x, y = queue.popleft()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if outside[i] or data[x, y] != 0:
            continue
        outside[i] = 1
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    # Largest rectangle of hole pixels: a histogram per row.
    heights = [0] * w
    best = (0, 0, 0, 0, 0)
    for y in range(h):
        for x in range(w):
            hole = data[x, y] == 0 and not outside[y * w + x]
            heights[x] = heights[x] + 1 if hole else 0
        stack: list[int] = []
        for x in range(w + 1):
            cur = heights[x] if x < w else 0
            while stack and heights[stack[-1]] >= cur:
                top = stack.pop()
                left = stack[-1] + 1 if stack else 0
                area = heights[top] * (x - left)
                if area > best[0]:
                    best = (area, left, y - heights[top] + 1, x - left, heights[top])
            stack.append(x)
    if best[0] == 0:
        raise SystemExit("the hole fixture has no hole")
    return {"x": best[1], "y": best[2], "width": best[3], "height": best[4]}


def box_long_side(alpha: Image.Image) -> int:
    """The long side of the subject's box (alpha >= 128)."""
    box = alpha.point(lambda a: 255 if a >= 128 else 0).getbbox()
    assert box is not None
    return max(box[2] - box[0], box[3] - box[1])


def box_overlap(a: Image.Image, b: Image.Image) -> float:
    """How much of a's box (alpha >= 128) b's box covers."""
    ba = a.point(lambda v: 255 if v >= 128 else 0).getbbox()
    bb = b.point(lambda v: 255 if v >= 128 else 0).getbbox()
    assert ba is not None and bb is not None
    w = min(ba[2], bb[2]) - max(ba[0], bb[0])
    h = min(ba[3], bb[3]) - max(ba[1], bb[1])
    if w <= 0 or h <= 0:
        return 0.0
    return w * h / ((ba[2] - ba[0]) * (ba[3] - ba[1]))


def colour_gap(canvas: Image.Image, a: Image.Image, b: Image.Image) -> float:
    """The largest per-channel gap between the mean colours of a and b as composited (alpha >= 128)."""
    rgb = canvas.convert("RGB")

    def mean(alpha: Image.Image) -> list[float]:
        m = alpha.point(lambda v: 255 if v >= 128 else 0)
        n = m.histogram()[255]
        sums = [sum(i * c for i, c in enumerate(rgb.getchannel(ch).histogram(mask=m))) for ch in range(3)]
        return [s / n for s in sums]

    return max(abs(x - y) for x, y in zip(mean(a), mean(b)))


def save_jpeg(canvas: Image.Image, path: Path) -> None:
    buf = io.BytesIO()
    canvas.convert("RGB").save(buf, format="JPEG", quality=90)
    if buf.tell() > MAX_BYTES:
        raise SystemExit(f"{path.name} is {buf.tell()} bytes, over {MAX_BYTES}")
    path.write_bytes(buf.getvalue())


def save_mask(alpha: Image.Image, path: Path) -> None:
    im = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    im.putalpha(alpha)
    im.save(path, optimize=True)


def save(name: str, canvas: Image.Image, truth: Image.Image, extra: Image.Image | None = None) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    save_jpeg(canvas, OUT / f"{name}.jpg")
    save_mask(truth, OUT / f"{name}.truth.png")
    entry: dict = {"image": f"{name}.jpg", "truth": f"{name}.truth.png"}
    if extra is not None:
        save_mask(extra, OUT / f"{name}.extra.png")
        entry["extra"] = f"{name}.extra.png"
    entry["tap"] = tap_point(truth)
    return entry


def centred(sub: Image.Image, cx: int, bottom_gap: int) -> tuple[int, int]:
    return (cx - sub.width // 2, SIZE[1] - bottom_gap - sub.height)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    fixtures: dict[str, dict] = {}

    # hair: the woman at her own size, on a bookcase.
    canvas = background(src / "bookcase.jpg")
    woman = subject(src / "woman.png")
    truth = place(canvas, woman, centred(woman, 800, 0))
    fixtures["hair"] = save("hair", canvas, truth)

    # pet: the cat at its own size, on a lawn.
    canvas = background(src / "lawn.jpg")
    cat = subject(src / "cat-oriental.png")
    truth = place(canvas, cat, centred(cat, 820, 60))
    fixtures["pet"] = save("pet", canvas, truth)

    # two-people: person B behind person A, their boxes overlapping; tap A.
    canvas = background(src / "living-room.jpg")
    b = subject(src / "navy-4.png", 900)
    a = subject(src / "navy-1.png", 900)
    alpha_b = place(canvas, b, centred(b, 900, 30))
    alpha_a = place(canvas, a, centred(a, 700, 30))
    fixtures["two-people"] = save("two-people", canvas, alpha_a, behind(alpha_b, alpha_a))

    # skin-object: a crispbread in front of the person's side, overlapping them.
    canvas = background(src / "street.jpg")
    person = subject(src / "navy-2.png", 900)
    bread = subject(src / "crispbread.png")
    bread = bread.resize((420, round(bread.height * 420 / bread.width)), Image.Resampling.LANCZOS)
    alpha_p = place(canvas, person, centred(person, 760, 30))
    alpha_bread = place(canvas, bread, (780, 360))
    fixtures["skin-object"] = save("skin-object", canvas, behind(alpha_p, alpha_bread), alpha_bread)

    # glossy: the teacup on a kitchen counter.
    canvas = background(src / "counter.jpg")
    cup = subject(src / "teacup.png", 760)
    truth = place(canvas, cup, centred(cup, 800, 120))
    fixtures["glossy"] = save("glossy", canvas, truth)

    # hole: the wheel on autumn leaves, which show through its hole.
    canvas = background(src / "leaves.jpg")
    wheel = subject(src / "wheel.png", 860)
    truth = place(canvas, wheel, centred(wheel, 800, 70))
    entry = save("hole", canvas, truth)
    entry["holeProbe"] = hole_probe(truth)
    fixtures["hole"] = entry

    # small-subject (spec 0015 AC-3): the woman small in a busy street photo,
    # standing on the bottom edge (her cut-out ends in a straight line there).
    canvas = background(src / "street.jpg")
    woman = subject(src / "woman.png")
    s = SMALL_SHARE * SIZE[0] / max(woman.size)
    small = woman.resize((round(woman.width * s), round(woman.height * s)), Image.Resampling.LANCZOS)
    truth = place(canvas, small, (1040, SIZE[1] - small.height))
    box_long = box_long_side(truth)
    if not 0.15 <= box_long / max(SIZE) <= 0.25:
        raise SystemExit(f"small-subject: its box is {box_long / max(SIZE):.1%} of the long side; AC-3 needs 15-25%")
    fixtures["small-subject"] = save("small-subject", canvas, truth)

    # overlap (spec 0015 AC-3, #159): person A in front, person B behind and
    # partly hidden by A, in similar colours; tap A.
    canvas = background(src / "bookcase.jpg")
    b = subject(src / "navy-4.png", 880)
    a = subject(src / "navy-2.png", 900)
    alpha_b = place(canvas, b, centred(b, 880, 40))
    alpha_a = place(canvas, a, centred(a, 800, 20))
    shown_b = behind(alpha_b, alpha_a)
    share = box_overlap(alpha_a, shown_b)
    if share < MIN_OVERLAP:
        raise SystemExit(f"overlap: B covers {share:.0%} of A's box; AC-3 needs {MIN_OVERLAP:.0%}")
    gap = colour_gap(canvas, alpha_a, shown_b)
    if gap > MAX_COLOUR_GAP:
        raise SystemExit(f"overlap: mean colours differ by {gap:.0f} levels; AC-3 allows {MAX_COLOUR_GAP}")
    fixtures["overlap"] = save("overlap", canvas, alpha_a, shown_b)

    for name in ("hair", "pet"):
        share = soft_share(Image.open(OUT / f"{name}.truth.png").getchannel("A"))
        if share < MIN_SOFT_SHARE:
            raise SystemExit(f"{name}: only {share:.2%} of its box is soft; AC-3 needs {MIN_SOFT_SHARE:.0%}")

    (OUT / "fixtures.json").write_text(json.dumps(fixtures, indent=2) + "\n")


if __name__ == "__main__":
    main()
