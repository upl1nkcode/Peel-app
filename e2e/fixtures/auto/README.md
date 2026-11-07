# Auto cutout fixtures

Test photos for spec 0007 (AC-21 to AC-23), built by `py scripts/compose-fixtures.py SOURCES_DIR` (needs Pillow) and committed. Each is a 960×600 JPEG (quality 95) of CC0 cut-outs placed on gravel. For each subject, `<fixture>.<subject>.alpha.png` is its alpha, placed exactly as composited: the ground truth.

| Fixture | Contents | Tap points (image px) |
|---|---|---|
| `object.jpg` | The teacup, 360 px tall, centred | A (436.5, 286.5) |
| `two-objects.jpg` | The teacup (A) and the shoe (B), 280 px tall, centred at x = 260 and x = 700 | A (226.5, 289.5), B (709.5, 303.5) |
| `person.jpg` | The woman, 600 px tall, centred, touching the bottom edge | A (501.5, 336.5) |

The tap points are each subject's alpha-weighted centroid, moved to the nearest fully opaque pixel's centre. The person's head box is the top 25% of the bounding box of her alpha ≥ 128: x 300–660, y 0–150 (`headBox` in `fixtures.json`). The shoe's alpha includes its faint drop shadow, which falls below the 50% line the tests compare.

## Sources

All CC0 (public domain dedication), from Wikimedia Commons, downloaded 2026-11-06.

| File in SOURCES_DIR | Original | Author | Rendition used |
|---|---|---|---|
| `teacup.png` | [Teacup.png](https://commons.wikimedia.org/wiki/File:Teacup.png) | Rijksmuseum | 1280 px wide |
| `shoe.png` | [Worn Shoe.png](https://commons.wikimedia.org/wiki/File:Worn_Shoe.png) | Aupajo | 1280 px wide |
| `woman.png` | [Woman in White Sleeveless Dress Sitting on Gray Concrete Seat during Daytime transparent.png](https://commons.wikimedia.org/wiki/File:Woman_in_White_Sleeveless_Dress_Sitting_on_Gray_Concrete_Seat_during_Daytime_transparent.png) | dzeeshah (via Pixabay) | 960 px wide |
| `gravel.jpg` | [Dog on dirt road.jpg](https://commons.wikimedia.org/wiki/File:Dog_on_dirt_road.jpg) | Arlo Barnes | 1920 px wide; crops (0, 840)–(960, 1440) for the objects and (960, 840)–(1920, 1440) for the person, below the dog |
