import type { RegionMap } from "./index";

// Hoenn: the mainland fills the west, with Lilycove on its north-east tip. The east and south are
// open sea, dotted with Mossdeep, Sootopolis, Ever Grande, Pacifidlog and Dewford.
export const HOENN: RegionMap = {
  region: "hoenn",
  width: 1000,
  height: 740,
  land: [
    // The mainland, running off the top edge.
    "M 60 -10 L 780 -10 L 792 60 L 776 124 L 792 190 L 782 240 L 640 244 L 632 330 L 636 420 L 596 470 L 540 560 L 510 600 L 460 598 L 400 604 L 330 600 L 250 588 L 160 562 L 80 528 L 66 460 L 74 380 L 62 300 L 72 220 L 58 140 L 68 60 Z",
    // Dewford
    "M 98 626 L 118 612 L 150 616 L 166 638 L 156 662 L 124 668 L 102 652 Z",
    // Mt. Pyre
    "M 690 272 L 712 266 L 728 282 L 724 306 L 702 312 L 688 296 Z",
    // Mossdeep
    "M 836 196 L 868 180 L 904 188 L 918 214 L 900 238 L 862 242 L 838 224 Z",
    // Sootopolis, a ring of rock around a crater lake
    "M 786 404 L 812 386 L 846 392 L 858 420 L 844 450 L 810 456 L 786 438 Z",
    // Ever Grande
    "M 900 560 L 936 548 L 968 566 L 972 606 L 946 626 L 910 620 L 894 594 Z",
    // Pacifidlog, a town built on floating logs
    "M 626 654 L 640 646 L 654 654 L 650 668 L 632 670 Z",
    // Sky Pillar
    "M 748 690 L 762 684 L 774 692 L 770 706 L 754 708 Z",
  ],
  water: [
    // Sootopolis crater
    "M 804 412 L 822 402 L 838 412 L 836 430 L 818 438 L 804 428 Z",
  ],
  routes: [
    { name: "101", points: [[330, 560], [330, 470]], label: [340, 522] },
    { name: "102", points: [[330, 470], [190, 470]], label: [258, 462] },
    { name: "103", points: [[330, 470], [330, 430]], label: [340, 454] },
    { name: "103 by sea", points: [[330, 430], [460, 430]], sea: true },
    { name: "104", points: [[190, 470], [100, 470], [100, 290], [140, 290]], label: [108, 350] },
    { name: "105", points: [[100, 470], [100, 640], [130, 640]], sea: true, label: [108, 590] },
    { name: "107", points: [[130, 640], [460, 640]], sea: true, label: [300, 632] },
    { name: "109", points: [[460, 640], [460, 570]], sea: true, label: [470, 594] },
    { name: "110", points: [[460, 570], [460, 330]], label: [470, 500] },
    { name: "111", points: [[460, 330], [460, 90]], label: [470, 262] },
    { name: "112", points: [[460, 200], [300, 200]], label: [410, 192] },
    { name: "113", points: [[460, 90], [190, 90]], label: [330, 82] },
    { name: "114", points: [[190, 90], [140, 90], [140, 190]], label: [148, 140] },
    { name: "115", points: [[140, 190], [140, 290]], label: [148, 246] },
    { name: "116", points: [[140, 290], [245, 290]], label: [190, 282] },
    { name: "Rusturf Tunnel path", points: [[245, 290], [330, 290], [330, 330]] },
    { name: "117", points: [[330, 330], [460, 330]], label: [395, 322] },
    { name: "118", points: [[460, 330], [560, 330]], label: [510, 322] },
    { name: "119", points: [[560, 330], [560, 110]], label: [570, 232] },
    { name: "120", points: [[560, 110], [620, 110], [620, 210]], label: [628, 162] },
    { name: "121", points: [[620, 210], [740, 210]], label: [650, 202] },
    { name: "123", points: [[560, 330], [630, 330]], label: [595, 322] },
    { name: "122", points: [[630, 330], [680, 330], [680, 210]], sea: true, label: [688, 252] },
    { name: "124", points: [[740, 210], [870, 210]], sea: true, label: [806, 202] },
    { name: "127", points: [[870, 210], [870, 420], [820, 420]], sea: true, label: [878, 322] },
    { name: "128", points: [[870, 420], [930, 420], [930, 590]], sea: true, label: [938, 500] },
    { name: "130", points: [[930, 590], [930, 660], [640, 660]], sea: true, label: [800, 652] },
    { name: "134", points: [[640, 660], [640, 610], [460, 610]], sea: true, label: [550, 602] },
  ],
  places: [
    { id: "littleroot", name: "Littleroot Town", x: 330, y: 560, kind: "town", label: { dx: -16, dy: 5, anchor: "end" } },
    { id: "oldale", name: "Oldale Town", x: 330, y: 470, kind: "town", label: { dx: 16, dy: 24, anchor: "start" } },
    { id: "petalburg", name: "Petalburg City", x: 190, y: 470, kind: "city", venue: "petalburg-city-gym", label: { dx: 0, dy: -26 } },
    { id: "petalburg-woods", name: "Petalburg Woods", x: 100, y: 390, kind: "landmark", glyph: "forest", label: { dx: 30, dy: 5, anchor: "start" } },
    { id: "rustboro", name: "Rustboro City", x: 140, y: 290, kind: "city", venue: "rustboro-city-gym", label: { dx: 0, dy: 34 } },
    { id: "rusturf-tunnel", name: "Rusturf Tunnel", x: 245, y: 290, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: -22 } },
    { id: "verdanturf", name: "Verdanturf Town", x: 330, y: 330, kind: "town", label: { dx: 0, dy: 26 } },
    { id: "mauville", name: "Mauville City", x: 460, y: 330, kind: "city", venue: "mauville-city-gym", label: { dx: 18, dy: -18, anchor: "start" } },
    { id: "slateport", name: "Slateport City", x: 460, y: 570, kind: "city", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "dewford", name: "Dewford Town", x: 130, y: 640, kind: "city", venue: "dewford-town-gym", label: { dx: 0, dy: 44 } },
    { id: "lavaridge", name: "Lavaridge Town", x: 300, y: 200, kind: "city", venue: "lavaridge-town-gym", label: { dx: 0, dy: 34 } },
    { id: "mt-chimney", name: "Mt. Chimney", x: 380, y: 140, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 32 } },
    { id: "fallarbor", name: "Fallarbor Town", x: 190, y: 90, kind: "town", label: { dx: 0, dy: -18 } },
    { id: "meteor-falls", name: "Meteor Falls", x: 140, y: 190, kind: "landmark", glyph: "mountain", label: { dx: -30, dy: 5, anchor: "end" } },
    { id: "fortree", name: "Fortree City", x: 560, y: 110, kind: "city", venue: "fortree-city-gym", label: { dx: 0, dy: -28 } },
    { id: "safari-zone", name: "Safari Zone", x: 700, y: 150, kind: "landmark", glyph: "park", label: { dx: 0, dy: -28 } },
    { id: "lilycove", name: "Lilycove City", x: 740, y: 210, kind: "city", label: { dx: 0, dy: 24 } },
    { id: "mt-pyre", name: "Mt. Pyre", x: 708, y: 290, kind: "landmark", glyph: "mountain", label: { dx: 30, dy: 5, anchor: "start" } },
    { id: "mossdeep", name: "Mossdeep City", x: 870, y: 210, kind: "city", venue: "mossdeep-city-gym", label: { dx: 0, dy: -36 } },
    { id: "sootopolis", name: "Sootopolis City", x: 820, y: 420, kind: "city", venue: "sootopolis-city-gym", label: { dx: -44, dy: 5, anchor: "end" } },
    { id: "ever-grande", name: "Ever Grande City", x: 930, y: 590, kind: "city", venue: "ever-grande-city", label: { dx: -44, dy: 5, anchor: "end" } },
    { id: "pacifidlog", name: "Pacifidlog Town", x: 640, y: 660, kind: "town", label: { dx: 0, dy: 30 } },
    { id: "sky-pillar", name: "Sky Pillar", x: 761, y: 697, kind: "landmark", glyph: "house", label: { dx: 18, dy: 5, anchor: "start" } },
  ],
  title: [812, 24],
  compass: [40, 700],
};
