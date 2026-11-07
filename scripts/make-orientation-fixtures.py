"""Builds e2e/fixtures/orientation/orientation-1.jpg … orientation-8.jpg (spec 0008 AC-1).

Each file stores the same upright 120 × 80 test pattern, transformed by the
inverse of its EXIF Orientation and tagged with it, so a reader that applies
the tag shows the upright pattern. Quadrants: top-left red, top-right green,
bottom-left blue, bottom-right yellow.

Run by hand (needs Pillow): py scripts/make-orientation-fixtures.py
The outputs are committed; CI never runs this.
"""

from pathlib import Path

from PIL import Image, ImageOps

OUT = Path(__file__).resolve().parent.parent / "e2e" / "fixtures" / "orientation"
WIDTH, HEIGHT = 120, 80
QUADRANTS = {
    "top-left": (230, 30, 30),
    "top-right": (30, 200, 30),
    "bottom-left": (30, 30, 230),
    "bottom-right": (230, 220, 30),
}

# What a reader does to the stored pixels for each tag; we store the inverse.
T = Image.Transpose
TO_UPRIGHT = {
    1: None,
    2: T.FLIP_LEFT_RIGHT,
    3: T.ROTATE_180,
    4: T.FLIP_TOP_BOTTOM,
    5: T.TRANSPOSE,
    6: T.ROTATE_270,
    7: T.TRANSVERSE,
    8: T.ROTATE_90,
}
INVERSE = {
    None: None,
    T.FLIP_LEFT_RIGHT: T.FLIP_LEFT_RIGHT,
    T.ROTATE_180: T.ROTATE_180,
    T.FLIP_TOP_BOTTOM: T.FLIP_TOP_BOTTOM,
    T.TRANSPOSE: T.TRANSPOSE,
    T.ROTATE_270: T.ROTATE_90,
    T.TRANSVERSE: T.TRANSVERSE,
    T.ROTATE_90: T.ROTATE_270,
}


def upright() -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT))
    half_w, half_h = WIDTH // 2, HEIGHT // 2
    boxes = {
        "top-left": (0, 0, half_w, half_h),
        "top-right": (half_w, 0, WIDTH, half_h),
        "bottom-left": (0, half_h, half_w, HEIGHT),
        "bottom-right": (half_w, half_h, WIDTH, HEIGHT),
    }
    for name, box in boxes.items():
        img.paste(QUADRANTS[name], box)
    return img


def mean(img: Image.Image, box: tuple[int, int, int, int]) -> tuple[float, ...]:
    region = list(img.crop(box).getdata())
    return tuple(sum(p[c] for p in region) / len(region) for c in range(3))


def check(path: Path) -> None:
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    assert img.size == (WIDTH, HEIGHT), (path, img.size)
    inner = {
        "top-left": (10, 10, 50, 30),
        "top-right": (70, 10, 110, 30),
        "bottom-left": (10, 50, 50, 70),
        "bottom-right": (70, 50, 110, 70),
    }
    for name, box in inner.items():
        got = mean(img, box)
        want = QUADRANTS[name]
        assert all(abs(g - w) <= 12 for g, w in zip(got, want)), (path, name, got)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = upright()
    for orientation, method in TO_UPRIGHT.items():
        inverse = INVERSE[method]
        stored = base.transpose(inverse) if inverse is not None else base.copy()
        exif = Image.Exif()
        exif[0x0112] = orientation
        path = OUT / f"orientation-{orientation}.jpg"
        stored.save(path, "JPEG", quality=95, subsampling=0, exif=exif.tobytes())
        check(path)
        print(path.name, stored.size)


if __name__ == "__main__":
    main()
