import type { RegionMap } from "./index";

// Johto: Kanto lies off the east edge (Route 27 from New Bark Town), open sea to the west and
// south. Cianwood sits on an island across Routes 40 and 41, past the Whirl Islands.
export const JOHTO: RegionMap = {
  region: "johto",
  width: 1000,
  height: 740,
  land: [
    // The mainland, running off the top and east edges.
    "M 215 -10 L 1010 -10 L 1010 640 L 930 640 L 860 628 L 780 622 L 720 632 L 660 650 L 560 660 L 470 652 L 380 660 L 345 640 L 352 560 L 338 500 L 350 440 L 330 392 L 290 372 L 242 368 L 232 330 L 220 270 L 236 200 L 218 130 L 228 60 Z",
    // Cianwood's island
    "M 62 468 L 70 432 L 105 415 L 145 425 L 160 460 L 150 500 L 115 515 L 78 500 Z",
    // Whirl Islands
    "M 176 498 L 186 490 L 197 495 L 194 507 L 181 508 Z",
    "M 208 512 L 218 505 L 229 511 L 225 522 L 212 522 Z",
    "M 186 526 L 195 520 L 205 526 L 200 535 L 189 534 Z",
  ],
  water: [
    // Lake of Rage
    "M 660 50 L 700 34 L 746 44 L 762 74 L 736 100 L 690 102 L 660 86 Z",
  ],
  routes: [
    { name: "29", points: [[740, 580], [900, 580]], label: [780, 572] },
    { name: "30", points: [[740, 580], [740, 350]], label: [750, 470] },
    { name: "31", points: [[740, 350], [620, 350]], label: [680, 368] },
    { name: "32", points: [[620, 350], [620, 610]], label: [630, 480] },
    { name: "33", points: [[620, 610], [500, 610]], label: [560, 602] },
    { name: "Ilex Forest path", points: [[500, 610], [400, 610]] },
    { name: "34", points: [[400, 610], [400, 470]], label: [410, 545] },
    { name: "35", points: [[400, 470], [400, 350]], label: [410, 420] },
    { name: "36", points: [[400, 350], [620, 350]], label: [520, 342] },
    { name: "37", points: [[480, 350], [480, 190]], label: [490, 272] },
    { name: "38", points: [[480, 190], [270, 190]], label: [375, 182] },
    { name: "39", points: [[270, 190], [270, 330]], label: [280, 262] },
    { name: "40", points: [[270, 330], [270, 470]], sea: true, label: [280, 422] },
    { name: "41", points: [[270, 470], [110, 470]], sea: true, label: [226, 462] },
    { name: "42", points: [[480, 190], [700, 190]], label: [650, 182] },
    { name: "43", points: [[700, 190], [700, 102]], label: [710, 150] },
    { name: "44", points: [[700, 190], [830, 190]], label: [765, 182] },
    { name: "Ice Path", points: [[830, 190], [830, 110], [900, 110]] },
    { name: "45", points: [[900, 110], [900, 400]], label: [910, 262] },
    { name: "46", points: [[900, 400], [820, 400], [820, 580]], label: [830, 500] },
    { name: "27", points: [[900, 580], [975, 580]], label: [940, 572] },
  ],
  places: [
    { id: "cianwood", name: "Cianwood City", x: 110, y: 470, kind: "city", venue: "cianwood-city-gym", label: { dx: 0, dy: 64 } },
    { id: "whirl-islands", name: "Whirl Islands", x: 202, y: 512, kind: "landmark", label: { dx: 0, dy: 42 } },
    { id: "olivine", name: "Olivine City", x: 270, y: 330, kind: "city", venue: "olivine-city-gym", label: { dx: -24, dy: 5, anchor: "end" } },
    { id: "ecruteak", name: "Ecruteak City", x: 480, y: 190, kind: "city", venue: "ecruteak-city-gym", label: { dx: 0, dy: -28 } },
    { id: "mt-mortar", name: "Mt. Mortar", x: 590, y: 190, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: -24 } },
    { id: "mahogany", name: "Mahogany Town", x: 700, y: 190, kind: "city", venue: "mahogany-town-gym", label: { dx: 18, dy: 32, anchor: "start" } },
    { id: "lake-of-rage", name: "Lake of Rage", x: 700, y: 70, kind: "landmark", label: { dx: -52, dy: 5, anchor: "end" } },
    { id: "ice-path", name: "Ice Path", x: 830, y: 150, kind: "landmark", glyph: "mountain", label: { dx: -30, dy: 5, anchor: "end" } },
    { id: "blackthorn", name: "Blackthorn City", x: 900, y: 110, kind: "city", venue: "blackthorn-city-gym", label: { dx: 0, dy: -28 } },
    { id: "dark-cave", name: "Dark Cave", x: 800, y: 290, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 32 } },
    { id: "national-park", name: "National Park", x: 400, y: 350, kind: "landmark", glyph: "park", label: { dx: 0, dy: -30 } },
    { id: "goldenrod", name: "Goldenrod City", x: 400, y: 470, kind: "city", venue: "goldenrod-city-gym", label: { dx: 22, dy: 5, anchor: "start" } },
    { id: "ruins-of-alph", name: "Ruins of Alph", x: 540, y: 425, kind: "landmark", label: { dx: 0, dy: 22 } },
    { id: "violet", name: "Violet City", x: 620, y: 350, kind: "city", venue: "violet-city-gym", label: { dx: 20, dy: -18, anchor: "start" } },
    { id: "union-cave", name: "Union Cave", x: 620, y: 610, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 34 } },
    { id: "azalea", name: "Azalea Town", x: 500, y: 610, kind: "city", venue: "azalea-town-gym", label: { dx: 0, dy: -26 } },
    { id: "ilex-forest", name: "Ilex Forest", x: 440, y: 610, kind: "landmark", glyph: "forest", label: { dx: -8, dy: 40 } },
    { id: "cherrygrove", name: "Cherrygrove City", x: 740, y: 580, kind: "town", label: { dx: 0, dy: 30 } },
    { id: "new-bark", name: "New Bark Town", x: 900, y: 580, kind: "town", label: { dx: 0, dy: -18 } },
    { id: "to-kanto", name: "To Kanto", x: 982, y: 580, kind: "landmark", exit: { to: "kanto", facing: "east" }, label: { dx: 8, dy: 28, anchor: "end" } },
  ],
  title: [24, 626],
  compass: [60, 64],
};
