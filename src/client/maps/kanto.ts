import type { RegionMap } from "./index";

// Kanto: Johto lies off the west edge, open sea to the south and east. Pallet Town sits on the
// south coast, Cinnabar and the Seafoam Islands offshore, and the Indigo Plateau up Route 23.
export const KANTO: RegionMap = {
  region: "kanto",
  width: 1000,
  height: 740,
  land: [
    // The mainland, running off the top and west edges.
    "M -10 -10 L 905 -10 L 912 60 L 896 132 L 916 210 L 900 290 L 922 362 L 896 440 L 906 520 L 882 590 L 850 640 L 780 664 L 700 672 L 620 662 L 540 670 L 470 656 L 400 658 L 330 652 L 298 640 L 286 604 L 268 580 L 228 587 L 180 576 L 120 562 L 60 582 L -10 570 Z",
    // Cinnabar Island
    "M 214 668 L 232 648 L 262 645 L 286 662 L 281 690 L 255 703 L 224 697 Z",
    // Seafoam Islands
    "M 370 669 L 386 660 L 403 665 L 411 679 L 397 691 L 376 687 Z",
    "M 420 690 L 428 684 L 437 688 L 433 697 L 423 698 Z",
    // Rocks off the east coast
    "M 944 402 L 952 396 L 960 401 L 956 410 L 946 409 Z",
  ],
  water: [
    // Vermilion Harbor
    "M 545 506 L 615 500 L 662 520 L 652 549 L 600 561 L 552 549 L 540 526 Z",
  ],
  routes: [
    { name: "1", points: [[250, 540], [250, 410]], label: [260, 480] },
    { name: "2", points: [[250, 410], [250, 190]], label: [260, 250] },
    { name: "22", points: [[250, 410], [110, 410]], label: [180, 402] },
    { name: "27", points: [[110, 410], [40, 410]], label: [74, 402] },
    { name: "23", points: [[110, 410], [110, 120]], label: [120, 340] },
    { name: "3", points: [[250, 190], [340, 190], [340, 150], [400, 150]], label: [296, 182] },
    { name: "4", points: [[400, 150], [580, 150]], label: [490, 142] },
    { name: "24", points: [[580, 150], [580, 70]], label: [590, 108] },
    { name: "25", points: [[580, 70], [720, 70]], label: [650, 62] },
    { name: "9", points: [[580, 150], [800, 150]], label: [700, 166] },
    { name: "10", points: [[800, 150], [800, 330]], label: [810, 286] },
    { name: "5", points: [[580, 150], [580, 330]], label: [590, 244] },
    { name: "6", points: [[580, 330], [580, 480]], label: [590, 410] },
    { name: "7", points: [[420, 330], [580, 330]], label: [500, 322] },
    { name: "8", points: [[580, 330], [800, 330]], label: [690, 322] },
    { name: "11", points: [[580, 480], [800, 480]], label: [690, 472] },
    { name: "12", points: [[800, 330], [800, 560]], label: [810, 420] },
    { name: "13", points: [[800, 560], [700, 560]], label: [750, 552] },
    { name: "14", points: [[700, 560], [700, 620]], label: [710, 596] },
    { name: "15", points: [[700, 620], [500, 620]], label: [610, 612] },
    { name: "16", points: [[420, 330], [330, 330]], label: [375, 322] },
    { name: "17", points: [[330, 330], [330, 620]], label: [340, 480] },
    { name: "18", points: [[330, 620], [500, 620]], label: [415, 612] },
    { name: "19", points: [[500, 620], [500, 675]], sea: true, label: [510, 668] },
    { name: "20", points: [[500, 675], [250, 675]], sea: true, label: [318, 668] },
    { name: "21", points: [[250, 540], [250, 675]], sea: true, label: [260, 616] },
  ],
  places: [
    { id: "indigo-plateau", name: "Indigo Plateau", x: 110, y: 120, kind: "city", venue: "indigo-plateau", label: { dx: 0, dy: -30 } },
    { id: "victory-road", name: "Victory Road", x: 110, y: 250, kind: "landmark", glyph: "mountain", label: { dx: 28, dy: 4, anchor: "start" } },
    { id: "pewter", name: "Pewter City", x: 250, y: 190, kind: "city", venue: "pewter-city-gym", label: { dx: 0, dy: -28 } },
    { id: "viridian-forest", name: "Viridian Forest", x: 250, y: 305, kind: "landmark", glyph: "forest", label: { dx: -30, dy: 4, anchor: "end" } },
    { id: "viridian", name: "Viridian City", x: 250, y: 410, kind: "city", venue: "viridian-city-gym", label: { dx: 22, dy: 32, anchor: "start" } },
    { id: "pallet", name: "Pallet Town", x: 250, y: 540, kind: "town", label: { dx: -16, dy: 5, anchor: "end" } },
    { id: "cinnabar", name: "Cinnabar Island", x: 250, y: 675, kind: "city", venue: "cinnabar-island-gym", label: { dx: 0, dy: 50 } },
    { id: "seafoam", name: "Seafoam Islands", x: 395, y: 675, kind: "landmark", label: { dx: 0, dy: 40 } },
    { id: "mt-moon", name: "Mt. Moon", x: 400, y: 150, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: -24 } },
    { id: "cerulean", name: "Cerulean City", x: 580, y: 150, kind: "city", venue: "cerulean-city-gym", label: { dx: 34, dy: -14, anchor: "start" } },
    { id: "sea-cottage", name: "Sea Cottage", x: 720, y: 70, kind: "landmark", glyph: "house", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "rock-tunnel", name: "Rock Tunnel", x: 800, y: 222, kind: "landmark", glyph: "mountain", label: { dx: 28, dy: 4, anchor: "start" } },
    { id: "celadon", name: "Celadon City", x: 420, y: 330, kind: "city", venue: "celadon-city-gym", label: { dx: 0, dy: -28 } },
    { id: "saffron", name: "Saffron City", x: 580, y: 330, kind: "city", venue: "saffron-city-gym", label: { dx: 18, dy: 32, anchor: "start" } },
    { id: "lavender", name: "Lavender Town", x: 800, y: 330, kind: "town", label: { dx: -14, dy: -16, anchor: "end" } },
    { id: "vermilion", name: "Vermilion City", x: 580, y: 480, kind: "city", venue: "vermilion-city-gym", label: { dx: -22, dy: 5, anchor: "end" } },
    { id: "safari-zone", name: "Safari Zone", x: 495, y: 560, kind: "landmark", glyph: "park", label: { dx: 0, dy: -30 } },
    { id: "fuchsia", name: "Fuchsia City", x: 500, y: 620, kind: "city", venue: "fuchsia-city-gym", label: { dx: -22, dy: 30, anchor: "end" } },
    { id: "to-johto", name: "To Johto", x: 30, y: 410, kind: "landmark", exit: { to: "johto", facing: "west" }, label: { dx: -8, dy: 28, anchor: "start" } },
  ],
  title: [24, 626],
  compass: [958, 64],
};
