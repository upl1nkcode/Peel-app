# Orientation fixtures (spec 0008 AC-1)

`orientation-1.jpg` … `orientation-8.jpg` each carry EXIF Orientation 1–8. Their stored pixels are the upright 120 × 80 test pattern transformed by the inverse of that orientation, so a reader that applies the tag shows the same upright pattern:

| Quadrant | Colour (RGB) |
|---|---|
| top-left | 230, 30, 30 (red) |
| top-right | 30, 200, 30 (green) |
| bottom-left | 30, 30, 230 (blue) |
| bottom-right | 230, 220, 30 (yellow) |

Made with `py scripts/make-orientation-fixtures.py` (Pillow; JPEG quality 95, 4:4:4), which also checks each file with Pillow's `exif_transpose`. Our own test images; no licence restrictions.
