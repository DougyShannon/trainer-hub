import type { RegionMap } from "./index";

// Unova: two rivers run south to the sea and split it into three. Nuvema, Striaton and Nacrene sit
// in the east, Castelia on the tip of the central peninsula with Nimbasa, Opelucid and the League
// north of it, and Driftveil, Mistralton and Icirrus in the west. Bridges carry the routes over.
export const UNOVA: RegionMap = {
  region: "unova",
  width: 1000,
  height: 740,
  land: [
    // The mainland, running off the top edge.
    "M -10 -10 L 972 -10 L 960 60 L 968 130 L 952 196 L 922 238 L 916 284 L 930 326 L 962 362 L 955 440 L 944 520 L 950 600 L 928 660 L 890 690 L 820 698 L 740 690 L 660 700 L 590 688 L 560 694 L 530 704 L 490 714 L 450 702 L 428 664 L 414 610 L 404 556 L 392 516 L 370 496 L 330 470 L 290 462 L 240 470 L 190 488 L 130 480 L 70 494 L 20 486 L -10 490 Z",
  ],
  water: [
    // The western river, crossed by the Tubeline Bridge and the Driftveil Drawbridge.
    "M 325 -10 L 345 -10 L 348 100 L 355 200 L 360 300 L 370 400 L 382 470 L 396 530 L 372 530 L 362 470 L 350 400 L 340 300 L 335 200 L 328 100 Z",
    // The eastern river, crossed by the Village, Marvelous and Skyarrow bridges.
    "M 600 -10 L 620 -10 L 618 100 L 624 200 L 618 300 L 612 420 L 602 520 L 588 620 L 578 710 L 556 710 L 566 620 L 580 520 L 590 420 L 596 300 L 602 200 L 596 100 Z",
  ],
  routes: [
    { name: "1", points: [[880, 650], [880, 540]], label: [890, 600] },
    { name: "2", points: [[880, 540], [760, 540]], label: [815, 560] },
    { name: "3", points: [[760, 540], [660, 540]], label: [705, 560] },
    { name: "Pinwheel Forest", points: [[660, 540], [660, 640], [480, 640]] },
    { name: "4", points: [[480, 640], [480, 400]], label: [490, 560] },
    { name: "5", points: [[480, 400], [270, 400]], label: [420, 392] },
    { name: "6", points: [[270, 400], [270, 300], [150, 300]], label: [280, 360] },
    { name: "7", points: [[150, 300], [150, 210], [240, 210], [240, 120]], label: [160, 262] },
    { name: "Celestial Tower path", points: [[150, 232], [80, 232]] },
    { name: "Dragonspiral path", points: [[240, 120], [240, 58]] },
    { name: "8", points: [[240, 120], [300, 120], [300, 200], [345, 200]], label: [310, 162] },
    { name: "9", points: [[345, 200], [500, 200]], label: [420, 192] },
    { name: "10", points: [[500, 200], [500, 72]], label: [510, 170] },
    { name: "11", points: [[500, 200], [720, 200]], label: [550, 192] },
    { name: "13", points: [[720, 200], [890, 200], [890, 280]], label: [770, 192] },
    { name: "Giant Chasm path", points: [[800, 200], [800, 92]] },
    { name: "14", points: [[890, 280], [890, 400], [760, 400]], label: [900, 350] },
    { name: "15", points: [[760, 400], [601, 400]], label: [680, 392] },
    { name: "16", points: [[601, 400], [480, 400]], label: [530, 392] },
  ],
  places: [
    { id: "nuvema", name: "Nuvema Town", x: 880, y: 650, kind: "town", label: { dx: -16, dy: 5, anchor: "end" } },
    { id: "accumula", name: "Accumula Town", x: 880, y: 540, kind: "town", label: { dx: 0, dy: -16 } },
    { id: "striaton", name: "Striaton City", x: 760, y: 540, kind: "city", venue: "striaton-city-gym", label: { dx: 0, dy: -28 } },
    { id: "nacrene", name: "Nacrene City", x: 660, y: 540, kind: "city", venue: "nacrene-city-gym", label: { dx: -20, dy: -20, anchor: "end" } },
    { id: "pinwheel-forest", name: "Pinwheel Forest", x: 660, y: 598, kind: "landmark", glyph: "forest", label: { dx: 30, dy: 5, anchor: "start" } },
    { id: "skyarrow", name: "Skyarrow Bridge", x: 578, y: 640, kind: "landmark", label: { dx: 0, dy: -14 } },
    { id: "castelia", name: "Castelia City", x: 480, y: 640, kind: "city", venue: "castelia-city-gym", label: { dx: 0, dy: 38 } },
    { id: "desert-resort", name: "Desert Resort", x: 432, y: 506, kind: "landmark", glyph: "park", label: { dx: -2, dy: -30 } },
    { id: "nimbasa", name: "Nimbasa City", x: 480, y: 400, kind: "city", venue: "nimbasa-city-gym", label: { dx: -18, dy: -20, anchor: "end" } },
    { id: "lostlorn", name: "Lostlorn Forest", x: 540, y: 330, kind: "landmark", glyph: "forest", label: { dx: 0, dy: -28 } },
    { id: "marvelous", name: "Marvelous Bridge", x: 601, y: 400, kind: "landmark", label: { dx: 0, dy: 24 } },
    { id: "black-city", name: "Black City / White Forest", x: 760, y: 400, kind: "town", label: { dx: 0, dy: -16 } },
    { id: "undella", name: "Undella Town", x: 890, y: 280, kind: "town", label: { dx: -16, dy: 5, anchor: "end" } },
    { id: "lacunosa", name: "Lacunosa Town", x: 720, y: 200, kind: "town", label: { dx: -6, dy: -16 } },
    { id: "giant-chasm", name: "Giant Chasm", x: 800, y: 80, kind: "landmark", glyph: "mountain", label: { dx: 30, dy: 5, anchor: "start" } },
    { id: "village-bridge", name: "Village Bridge", x: 612, y: 200, kind: "landmark", label: { dx: 0, dy: 24 } },
    { id: "opelucid", name: "Opelucid City", x: 500, y: 200, kind: "city", venue: "opelucid-city-gym", label: { dx: -18, dy: -20, anchor: "end" } },
    { id: "victory-road", name: "Victory Road", x: 500, y: 128, kind: "landmark", glyph: "mountain", label: { dx: 28, dy: 4, anchor: "start" } },
    { id: "unova-league", name: "Pokémon League", x: 500, y: 72, kind: "city", venue: "unova-league", label: { dx: 26, dy: 5, anchor: "start" } },
    { id: "tubeline", name: "Tubeline Bridge", x: 345, y: 200, kind: "landmark", label: { dx: 0, dy: 24 } },
    { id: "icirrus", name: "Icirrus City", x: 240, y: 120, kind: "city", venue: "icirrus-city-gym", label: { dx: -22, dy: 5, anchor: "end" } },
    { id: "dragonspiral", name: "Dragonspiral Tower", x: 240, y: 58, kind: "landmark", label: { dx: 12, dy: 4, anchor: "start" } },
    { id: "twist-mountain", name: "Twist Mountain", x: 196, y: 210, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: -20 } },
    { id: "celestial-tower", name: "Celestial Tower", x: 80, y: 232, kind: "landmark", label: { dx: 0, dy: 22 } },
    { id: "mistralton", name: "Mistralton City", x: 150, y: 300, kind: "city", venue: "mistralton-city-gym", label: { dx: 0, dy: 36 } },
    { id: "chargestone", name: "Chargestone Cave", x: 216, y: 300, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: -22 } },
    { id: "drawbridge", name: "Driftveil Drawbridge", x: 360, y: 400, kind: "landmark", label: { dx: 0, dy: 24 } },
    { id: "driftveil", name: "Driftveil City", x: 270, y: 400, kind: "city", venue: "driftveil-city-gym", label: { dx: -22, dy: 5, anchor: "end" } },
  ],
  title: [30, 560],
  compass: [300, 670],
};
