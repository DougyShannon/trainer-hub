import type { RegionMap } from "./index";

// Alola: four islands and Aether Paradise. Melemele in the north-west (Iki Town), Akala in the
// north-east (Konikoni City), Ula'ula in the south-east (Malie City, with the League on top of
// Mount Lanakila) and Poni in the south-west (Vast Poni Canyon). Each island has its grand trial.
export const ALOLA: RegionMap = {
  region: "alola",
  width: 1000,
  height: 740,
  land: [
    // Melemele Island
    "M 110 110 L 170 76 L 250 66 L 320 84 L 364 130 L 372 196 L 346 256 L 290 292 L 210 298 L 140 272 L 98 220 L 92 160 Z",
    // Akala Island
    "M 570 150 L 610 98 L 690 72 L 790 70 L 870 96 L 920 150 L 926 230 L 900 296 L 830 330 L 730 336 L 640 316 L 580 272 L 560 210 Z",
    // Ula'ula Island
    "M 560 470 L 600 420 L 680 396 L 790 392 L 890 410 L 950 460 L 962 550 L 940 640 L 870 694 L 760 710 L 650 700 L 580 660 L 550 590 Z",
    // Poni Island
    "M 120 470 L 180 430 L 260 418 L 340 432 L 390 480 L 398 560 L 370 630 L 300 676 L 220 690 L 150 664 L 104 604 L 96 530 Z",
    // Exeggutor Island
    "M 86 694 L 104 680 L 126 684 L 132 704 L 114 716 L 92 712 Z",
    // Aether Paradise
    "M 430 352 L 450 340 L 476 340 L 494 352 L 494 372 L 476 384 L 450 384 L 430 372 Z",
  ],
  water: [
    // Brooklet Hill's pools
    "M 780 110 L 800 102 L 820 110 L 818 126 L 798 132 L 780 124 Z",
  ],
  routes: [
    // Melemele
    { name: "1", points: [[230, 120], [230, 250]], label: [240, 226] },
    { name: "2", points: [[230, 250], [140, 250], [140, 180]], label: [180, 242] },
    { name: "3", points: [[140, 180], [140, 130]], label: [150, 160] },
    // Akala
    { name: "4", points: [[600, 240], [600, 130], [660, 130]], label: [610, 190] },
    { name: "5", points: [[660, 130], [770, 130]], label: [715, 122] },
    { name: "6", points: [[700, 130], [700, 240]], label: [710, 190] },
    { name: "7", points: [[700, 240], [780, 240], [780, 210]], label: [736, 232] },
    { name: "8", points: [[700, 240], [700, 290], [830, 290]], label: [760, 282] },
    { name: "Memorial Hill", points: [[830, 290], [880, 290]] },
    // Ula'ula
    { name: "10", points: [[610, 600], [610, 480]], label: [620, 540] },
    { name: "12", points: [[610, 600], [700, 600], [700, 540], [860, 540]], label: [780, 532] },
    { name: "Lanakila trail", points: [[860, 540], [860, 460], [770, 460]] },
    { name: "17", points: [[860, 540], [860, 640], [910, 640]], label: [870, 600] },
    // Poni
    { name: "Poni Wilds", points: [[230, 660], [230, 560]] },
    { name: "Ancient Poni Path", points: [[230, 560], [300, 560], [300, 510]] },
    { name: "Canyon trail", points: [[300, 510], [300, 450]] },
    { name: "Exeggutor crossing", points: [[230, 660], [114, 698]], sea: true },
  ],
  places: [
    { id: "melemele", name: "Melemele Island", x: 230, y: 330, kind: "landmark", glyph: "label", label: { dx: 0, dy: 0 } },
    { id: "iki-town", name: "Iki Town", x: 230, y: 120, kind: "city", venue: "melemele-grand-trial", label: { dx: 0, dy: -28 } },
    { id: "hauoli", name: "Hau'oli City", x: 230, y: 250, kind: "city", label: { dx: 16, dy: 24, anchor: "start" } },
    { id: "verdant-cavern", name: "Verdant Cavern", x: 140, y: 180, kind: "landmark", glyph: "mountain", label: { dx: 28, dy: 4, anchor: "start" } },
    { id: "melemele-meadow", name: "Melemele Meadow", x: 140, y: 126, kind: "landmark", glyph: "park", label: { dx: 0, dy: -26 } },

    { id: "akala", name: "Akala Island", x: 745, y: 48, kind: "landmark", glyph: "label", label: { dx: 0, dy: 0 } },
    { id: "heahea", name: "Heahea City", x: 600, y: 240, kind: "city", label: { dx: 0, dy: 26 } },
    { id: "paniola", name: "Paniola Town", x: 660, y: 130, kind: "town", label: { dx: -10, dy: -16 } },
    { id: "brooklet-hill", name: "Brooklet Hill", x: 800, y: 118, kind: "landmark", label: { dx: 28, dy: 4, anchor: "start" } },
    { id: "royal-avenue", name: "Royal Avenue", x: 700, y: 240, kind: "town", label: { dx: 12, dy: 24, anchor: "start" } },
    { id: "wela-volcano", name: "Wela Volcano Park", x: 780, y: 200, kind: "landmark", glyph: "mountain", label: { dx: 28, dy: 4, anchor: "start" } },
    { id: "konikoni", name: "Konikoni City", x: 830, y: 290, kind: "city", venue: "akala-grand-trial", label: { dx: -20, dy: 30, anchor: "end" } },
    { id: "ruins-of-life", name: "Ruins of Life", x: 880, y: 290, kind: "landmark", label: { dx: 0, dy: -12 } },

    { id: "aether-paradise", name: "Aether Paradise", x: 462, y: 362, kind: "landmark", label: { dx: 0, dy: 44 } },

    { id: "ulaula", name: "Ula'ula Island", x: 760, y: 376, kind: "landmark", glyph: "label", label: { dx: 0, dy: 0 } },
    { id: "malie", name: "Malie City", x: 610, y: 600, kind: "city", venue: "ulaula-grand-trial", label: { dx: 0, dy: 36 } },
    { id: "hokulani", name: "Mount Hokulani", x: 610, y: 466, kind: "landmark", glyph: "mountain", label: { dx: 28, dy: 4, anchor: "start" } },
    { id: "lanakila-peak", name: "", x: 770, y: 500, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 0 } },
    { id: "lanakila", name: "Mount Lanakila", x: 770, y: 460, kind: "city", venue: "alola-league", label: { dx: 0, dy: -30 } },
    { id: "tapu-village", name: "Tapu Village", x: 860, y: 540, kind: "town", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "haina-desert", name: "Haina Desert", x: 910, y: 472, kind: "landmark", glyph: "park", label: { dx: 0, dy: -30 } },
    { id: "po-town", name: "Po Town", x: 910, y: 640, kind: "town", label: { dx: 0, dy: 26 } },

    { id: "poni", name: "Poni Island", x: 245, y: 400, kind: "landmark", glyph: "label", label: { dx: 0, dy: 0 } },
    { id: "seafolk", name: "Seafolk Village", x: 230, y: 660, kind: "town", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "ancient-path", name: "Ancient Poni Path", x: 230, y: 596, kind: "landmark", glyph: "forest", label: { dx: -30, dy: 5, anchor: "end" } },
    { id: "vast-poni-canyon", name: "Vast Poni Canyon", x: 300, y: 510, kind: "city", venue: "poni-grand-trial", label: { dx: 22, dy: 32, anchor: "start" } },
    { id: "altar", name: "Altar of the Sunne", x: 300, y: 450, kind: "landmark", glyph: "house", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "exeggutor-island", name: "Exeggutor Island", x: 110, y: 698, kind: "landmark", label: { dx: 30, dy: 26, anchor: "start" } },
  ],
  title: [400, 40],
  compass: [470, 680],
};
