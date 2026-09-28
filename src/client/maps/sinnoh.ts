import type { RegionMap } from "./index";

// Sinnoh: Mt. Coronet runs down the middle, splitting the west (Jubilife, Oreburgh, Eterna) from
// the east (Hearthome, Veilstone, Pastoria). Snowpoint sits in the snowy north, and the Pokémon
// League on a headland reached by sea from Sunyshore.
export const SINNOH: RegionMap = {
  region: "sinnoh",
  width: 1000,
  height: 740,
  land: [
    // The mainland, running off the top edge.
    "M 70 -10 L 560 -10 L 580 60 L 640 100 L 720 120 L 800 150 L 880 190 L 950 240 L 960 330 L 950 375 L 880 392 L 862 470 L 875 540 L 930 548 L 965 575 L 955 615 L 900 640 L 820 628 L 740 634 L 680 626 L 600 640 L 520 650 L 420 660 L 330 668 L 250 664 L 170 670 L 110 650 L 80 600 L 92 540 L 70 480 L 84 400 L 72 320 L 86 240 L 70 160 L 82 80 Z",
    // Iron Island
    "M 22 368 L 40 356 L 58 366 L 56 390 L 36 398 L 20 386 Z",
    // Battle Zone
    "M 915 118 L 935 108 L 956 118 L 954 140 L 932 148 L 914 136 Z",
  ],
  water: [
    // Lake Verity, Lake Valor and Lake Acuity
    "M 92 590 L 112 580 L 134 588 L 136 606 L 116 616 L 94 608 Z",
    "M 732 488 L 756 478 L 782 488 L 784 510 L 760 522 L 734 512 Z",
    "M 298 52 L 320 42 L 344 50 L 346 70 L 322 80 L 300 72 Z",
  ],
  routes: [
    { name: "201", points: [[170, 620], [290, 620]], label: [230, 612] },
    { name: "202", points: [[290, 620], [290, 500]], label: [300, 562] },
    { name: "218", points: [[290, 500], [110, 500]], label: [200, 518] },
    { name: "203", points: [[290, 500], [430, 500]], label: [322, 492] },
    { name: "204", points: [[290, 500], [290, 360]], label: [300, 432] },
    { name: "205", points: [[290, 360], [290, 220], [360, 220]], label: [300, 334] },
    { name: "206", points: [[360, 220], [360, 420], [430, 420]], label: [370, 322] },
    { name: "207", points: [[430, 500], [430, 420], [490, 420]], label: [440, 462] },
    { name: "208", points: [[490, 420], [560, 420]], label: [525, 442] },
    { name: "211", points: [[360, 220], [600, 220]], label: [420, 212] },
    { name: "Mt. Coronet path", points: [[490, 220], [490, 140]] },
    { name: "216", points: [[490, 140], [400, 140]], label: [445, 132] },
    { name: "217", points: [[400, 140], [400, 70]], label: [410, 110] },
    { name: "210", points: [[600, 220], [640, 220], [640, 380]], label: [650, 262] },
    { name: "209", points: [[560, 420], [640, 420], [640, 380]], label: [600, 412] },
    { name: "215", points: [[640, 300], [800, 300]], label: [720, 292] },
    { name: "212", points: [[560, 420], [560, 580], [680, 580]], label: [570, 530] },
    { name: "213", points: [[680, 580], [800, 580]], label: [740, 598] },
    { name: "214", points: [[800, 300], [800, 580]], label: [810, 440] },
    { name: "222", points: [[800, 580], [910, 580]], label: [868, 572] },
    { name: "223", points: [[910, 580], [935, 568], [935, 360]], sea: true, label: [943, 470] },
  ],
  places: [
    { id: "twinleaf", name: "Twinleaf Town", x: 170, y: 620, kind: "town", label: { dx: 0, dy: 26 } },
    { id: "lake-verity", name: "Lake Verity", x: 114, y: 598, kind: "landmark", label: { dx: 0, dy: -26 } },
    { id: "sandgem", name: "Sandgem Town", x: 290, y: 620, kind: "town", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "jubilife", name: "Jubilife City", x: 290, y: 500, kind: "city", label: { dx: -14, dy: -14, anchor: "end" } },
    { id: "canalave", name: "Canalave City", x: 110, y: 500, kind: "city", venue: "canalave-city-gym", label: { dx: 0, dy: -28 } },
    { id: "iron-island", name: "Iron Island", x: 38, y: 377, kind: "landmark", label: { dx: 0, dy: 38 } },
    { id: "oreburgh-gate", name: "Oreburgh Gate", x: 365, y: 500, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 34 } },
    { id: "oreburgh", name: "Oreburgh City", x: 430, y: 500, kind: "city", venue: "oreburgh-city-gym", label: { dx: 22, dy: 5, anchor: "start" } },
    { id: "floaroma", name: "Floaroma Town", x: 290, y: 360, kind: "town", label: { dx: -16, dy: 5, anchor: "end" } },
    { id: "eterna-forest", name: "Eterna Forest", x: 290, y: 280, kind: "landmark", glyph: "forest", label: { dx: -30, dy: 5, anchor: "end" } },
    { id: "eterna", name: "Eterna City", x: 360, y: 220, kind: "city", venue: "eterna-city-gym", label: { dx: 0, dy: -28 } },
    { id: "coronet-north", name: "", x: 490, y: 140, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 0 } },
    { id: "coronet-west", name: "", x: 490, y: 220, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 0 } },
    { id: "coronet", name: "Mt. Coronet", x: 490, y: 320, kind: "landmark", glyph: "mountain", label: { dx: 30, dy: 5, anchor: "start" } },
    { id: "coronet-south", name: "", x: 490, y: 420, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 0 } },
    { id: "snowpoint", name: "Snowpoint City", x: 400, y: 70, kind: "city", venue: "snowpoint-city-gym", label: { dx: 22, dy: -12, anchor: "start" } },
    { id: "lake-acuity", name: "Lake Acuity", x: 322, y: 61, kind: "landmark", label: { dx: -32, dy: 5, anchor: "end" } },
    { id: "celestic", name: "Celestic Town", x: 600, y: 220, kind: "town", label: { dx: 0, dy: -18 } },
    { id: "solaceon", name: "Solaceon Town", x: 640, y: 380, kind: "town", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "hearthome", name: "Hearthome City", x: 560, y: 420, kind: "city", venue: "hearthome-city-gym", label: { dx: -20, dy: -22, anchor: "end" } },
    { id: "veilstone", name: "Veilstone City", x: 800, y: 300, kind: "city", venue: "veilstone-city-gym", label: { dx: 0, dy: -28 } },
    { id: "lake-valor", name: "Lake Valor", x: 758, y: 500, kind: "landmark", label: { dx: 0, dy: -30 } },
    { id: "great-marsh", name: "Great Marsh", x: 620, y: 530, kind: "landmark", glyph: "park", label: { dx: 0, dy: -28 } },
    { id: "pastoria", name: "Pastoria City", x: 680, y: 580, kind: "city", venue: "pastoria-city-gym", label: { dx: 0, dy: 32 } },
    { id: "valor-lakefront", name: "Valor Lakefront", x: 800, y: 580, kind: "town", label: { dx: 0, dy: -16 } },
    { id: "sunyshore", name: "Sunyshore City", x: 910, y: 580, kind: "city", venue: "sunyshore-city-gym", label: { dx: 0, dy: 38 } },
    { id: "pokemon-league", name: "Pokémon League", x: 935, y: 360, kind: "city", venue: "sinnoh-league", label: { dx: -26, dy: 5, anchor: "end" } },
    { id: "battle-zone", name: "Battle Zone", x: 935, y: 128, kind: "landmark", label: { dx: 0, dy: 38 } },
  ],
  title: [770, 24],
  compass: [40, 700],
};
