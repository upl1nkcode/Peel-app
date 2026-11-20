# Accuracy benchmark test photos

Test photos for spec 0014 (AC-1 to AC-3), built by `py scripts/compose-accuracy-fixtures.py SOURCES_DIR` (needs Pillow) and committed. Each is a 1600 × 1000 JPEG (quality 90) of free-licence cut-outs placed on real photos. For each, `<name>.truth.png` is the subject's alpha exactly as composited (the alpha channel of a white PNG): the ground truth. `two-people` and `skin-object` also have `<name>.extra.png`, the distractor's visible alpha. Subjects are only scaled down, never up.

| Fixture | Subject (tapped) | Also in the photo | Checks |
|---|---|---|---|
| `hair` | a woman with long loose hair, at her own size | a public bookcase and street | hair, soft edge |
| `pet` | an Oriental Shorthair cat, at its own size | a dewy lawn | fur, soft edge |
| `two-people` | person A, 900 px tall | person B, behind A, their boxes overlapping | extra |
| `skin-object` | a person, 900 px tall | a stack of crispbread in front of their side, and one slice | extra |
| `glossy` | a porcelain teacup, 760 px tall | a speckled kitchen counter | glare edges |
| `hole` | a toy steering wheel, 860 px tall | autumn leaves seen through its two holes | the hole stays empty |

`fixtures.json` has each tap point: the alpha-weighted centroid of the visible subject, moved to the nearest fully opaque pixel's centre (as in spec 0007). `hole` also has `holeProbe`, the largest box of empty pixels inside a hole.

The puppy cut-out first considered for `pet` stored its body at alpha 254 and its fur was hard-cut (under 2% soft), so the cat was used (AC-3). The script scales any cut-out whose body is stored below 255 so that it is 255.

## Sources

Downloaded from Wikimedia Commons on 2026-11-20, at the rendition shown (at most 2400 px wide). CC BY works are credited here and in `docs/licenses.md`; they were cropped, resized and composited.

| File in SOURCES_DIR | Used for | Original | Author | Licence | Rendition |
|---|---|---|---|---|---|
| `woman.png` | hair | [Woman in White Sleeveless Dress Sitting on Gray Concrete Seat during Daytime transparent.png](https://commons.wikimedia.org/wiki/File:Woman_in_White_Sleeveless_Dress_Sitting_on_Gray_Concrete_Seat_during_Daytime_transparent.png) | dzeeshah (via Pixabay) | CC0 | 960 px wide |
| `bookcase.jpg` | hair | [Public bookcase of the Muri-Gümligen municipal library.jpg](https://commons.wikimedia.org/wiki/File:Public_bookcase_of_the_Muri-G%C3%BCmligen_municipal_library.jpg) | Dafadllyn | CC0 | 2400 px wide |
| `cat-oriental.png` | pet | [Lilac tortoiseshell and white Oriental Shorthair cat no background.png](https://commons.wikimedia.org/wiki/File:Lilac_tortoiseshell_and_white_Oriental_Shorthair_cat_no_background.png) | Heikki Siltala (catza.net) | CC BY 3.0 | 602 px wide |
| `lawn.jpg` | pet | [Grass at a lawn with morning dew 01.jpg](https://commons.wikimedia.org/wiki/File:Grass_at_a_lawn_with_morning_dew_01.jpg) | Leonhard Lenz | CC0 | 2400 px wide |
| `navy-1.png` | two-people (A) | [160803-N-RY232-001 - Navy Working Uniform (NWU) Type III.png](https://commons.wikimedia.org/wiki/File:160803-N-RY232-001_-_Navy_Working_Uniform_(NWU)_Type_III.png) | USN | Public domain | 588 px wide |
| `navy-4.png` | two-people (B) | [160803-N-RY232-004 - Navy Working Uniform (NWU) Type III.png](https://commons.wikimedia.org/wiki/File:160803-N-RY232-004_-_Navy_Working_Uniform_(NWU)_Type_III.png) | USN | Public domain | 622 px wide |
| `living-room.jpg` | two-people | [Living room of a typical rural house in northeast Brazil.jpg](https://commons.wikimedia.org/wiki/File:Living_room_of_a_typical_rural_house_in_northeast_Brazil.jpg) | Wilfredor | CC0 | 2400 px wide |
| `navy-2.png` | skin-object | [160803-N-RY232-002 - Navy Working Uniform (NWU) Type III.png](https://commons.wikimedia.org/wiki/File:160803-N-RY232-002_-_Navy_Working_Uniform_(NWU)_Type_III.png) | MC1 Julia A. Casper, US Navy | Public domain | 460 px wide |
| `crispbread.png` | skin-object (distractor) | [Crisp bread.png](https://commons.wikimedia.org/wiki/File:Crisp_bread.png) | Tiia Monto | CC BY 4.0 | 2400 px wide |
| `street.jpg` | skin-object | [Snowy Sainte-Famille Street in Quebec City.jpg](https://commons.wikimedia.org/wiki/File:Snowy_Sainte-Famille_Street_in_Quebec_City.jpg) | Wilfredor | CC0 | 2400 px wide |
| `teacup.png` | glossy | [Teacup.png](https://commons.wikimedia.org/wiki/File:Teacup.png) | Rijksmuseum | CC0 | 2400 px wide |
| `counter.jpg` | glossy | [Laminate Kitchen Countertop Beige.jpg](https://commons.wikimedia.org/wiki/File:Laminate_Kitchen_Countertop_Beige.jpg) | Kurtkaiser | CC0 | 2400 px wide |
| `wheel.png` | hole | [Wii-Wheel.png](https://commons.wikimedia.org/wiki/File:Wii-Wheel.png) | Evan-Amos, modified by Gunnar.offel | Public domain | 2064 px wide |
| `leaves.jpg` | hole | [Autumn leaves, Dumitru Rascanu park.jpg](https://commons.wikimedia.org/wiki/File:Autumn_leaves,_Dumitru_Rascanu_park.jpg) | Iurie Nistor | CC0 | 2400 px wide |
