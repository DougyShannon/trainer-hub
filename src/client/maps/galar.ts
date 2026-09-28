import type { RegionMap } from "./index";

// Galar: a long island running north to south. Postwick and Wedgehurst are at the southern tip, the
// Wild Area fills the middle with Motostoke on its south-east edge and Hammerlocke on its north,
// and the rail line carries on north to Wyndon Stadium. Route 5 crosses the Wild Area on a bridge.
export const GALAR: RegionMap = {
  region: "galar",
  width: 1000,
  height: 740,
  land: [
    // The mainland
    "M 100 40 L 300 24 L 480 20 L 620 30 L 700 50 L 740 90 L 790 110 L 830 100 L 862 70 L 904 60 L 930 120 L 920 200 L 890 260 L 905 340 L 920 420 L 900 500 L 880 560 L 820 620 L 740 660 L 640 690 L 560 715 L 470 730 L 400 725 L 310 700 L 220 662 L 150 604 L 100 530 L 80 440 L 90 350 L 70 260 L 90 170 L 70 100 Z",
    // The Isle of Armor
    "M 918 552 L 940 536 L 972 538 L 988 560 L 980 588 L 952 600 L 924 590 Z",
  ],
  water: [
    // Lake of Outrage, in the Wild Area
    "M 392 330 L 410 316 L 436 318 L 448 334 L 438 350 L 412 354 L 394 346 Z",
  ],
  routes: [
    { name: "1", points: [[480, 700], [480, 650]], label: [490, 680] },
    { name: "2", points: [[480, 650], [570, 650]], label: [520, 642] },
    { name: "Wedgehurst rail", points: [[480, 650], [480, 560]], rail: true },
    { name: "Wild Area", points: [[480, 560], [480, 270]] },
    { name: "Wild Area south", points: [[480, 540], [640, 540]] },
    { name: "3", points: [[640, 540], [640, 610], [330, 610]], label: [560, 602] },
    { name: "4", points: [[330, 610], [220, 610], [220, 470]], label: [230, 548] },
    { name: "5", points: [[220, 470], [220, 440], [850, 440]], label: [300, 432] },
    { name: "Galar Mine No. 2", points: [[850, 440], [850, 540], [640, 540]] },
    { name: "6", points: [[480, 270], [220, 270]], label: [350, 262] },
    { name: "Glimwood Tangle", points: [[220, 270], [220, 190], [150, 190], [150, 120]] },
    { name: "7", points: [[480, 270], [640, 270]], label: [560, 262] },
    { name: "8", points: [[640, 270], [640, 120]], label: [650, 200] },
    { name: "9", points: [[640, 120], [720, 120], [720, 170], [860, 170], [860, 240]], label: [780, 162] },
    { name: "Hammerlocke rail", points: [[480, 270], [480, 160]], rail: true },
    { name: "10", points: [[480, 160], [480, 60]], label: [490, 120] },
  ],
  places: [
    { id: "postwick", name: "Postwick", x: 480, y: 700, kind: "town", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "slumbering-weald", name: "Slumbering Weald", x: 400, y: 690, kind: "landmark", glyph: "forest", label: { dx: -30, dy: 5, anchor: "end" } },
    { id: "wedgehurst", name: "Wedgehurst", x: 480, y: 650, kind: "town", label: { dx: -16, dy: 5, anchor: "end" } },
    { id: "magnolia", name: "Magnolia's house", x: 580, y: 650, kind: "landmark", glyph: "house", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "wild-area-station", name: "Wild Area Station", x: 480, y: 560, kind: "town", label: { dx: -14, dy: 5, anchor: "end" } },
    { id: "wild-area", name: "Wild Area", x: 480, y: 405, kind: "landmark", glyph: "park", size: [220, 210], label: { dx: -100, dy: -84, anchor: "start" } },
    { id: "bridge-field", name: "Bridge Field", x: 480, y: 440, kind: "landmark", label: { dx: 10, dy: -10, anchor: "start" } },
    { id: "motostoke", name: "Motostoke", x: 640, y: 540, kind: "city", venue: "motostoke-gym", label: { dx: 0, dy: -28 } },
    { id: "galar-mine", name: "Galar Mine", x: 330, y: 610, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: -22 } },
    { id: "turffield", name: "Turffield", x: 220, y: 470, kind: "city", venue: "turffield-gym", label: { dx: -22, dy: 5, anchor: "end" } },
    { id: "galar-mine-2", name: "Galar Mine No. 2", x: 750, y: 540, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 32 } },
    { id: "hulbury", name: "Hulbury", x: 850, y: 440, kind: "city", venue: "hulbury-gym", label: { dx: 0, dy: -28 } },
    { id: "hammerlocke", name: "Hammerlocke", x: 480, y: 270, kind: "city", venue: "hammerlocke-gym", label: { dx: -18, dy: -20, anchor: "end" } },
    { id: "stow-on-side", name: "Stow-on-Side", x: 220, y: 270, kind: "city", venue: "stow-on-side-gym", label: { dx: 0, dy: 34 } },
    { id: "glimwood", name: "Glimwood Tangle", x: 150, y: 160, kind: "landmark", glyph: "forest", label: { dx: 28, dy: 5, anchor: "start" } },
    { id: "ballonlea", name: "Ballonlea", x: 150, y: 120, kind: "city", venue: "ballonlea-gym", label: { dx: 0, dy: -28 } },
    { id: "circhester", name: "Circhester", x: 640, y: 120, kind: "city", venue: "circhester-gym", label: { dx: -22, dy: 5, anchor: "end" } },
    { id: "circhester-bay", name: "Circhester Bay", x: 800, y: 60, kind: "landmark", glyph: "label", label: { dx: 0, dy: 0 } },
    { id: "spikemuth", name: "Spikemuth", x: 860, y: 240, kind: "city", venue: "spikemuth-gym", label: { dx: -22, dy: 5, anchor: "end" } },
    { id: "white-hill", name: "White Hill Station", x: 480, y: 160, kind: "town", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "wyndon", name: "Wyndon", x: 480, y: 60, kind: "city", venue: "wyndon-stadium", label: { dx: 24, dy: 5, anchor: "start" } },
    { id: "isle-of-armor", name: "Isle of Armor", x: 952, y: 568, kind: "landmark", label: { dx: 0, dy: 50 } },
  ],
  title: [20, 650],
  compass: [940, 686],
};
