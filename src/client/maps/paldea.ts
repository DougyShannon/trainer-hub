import type { RegionMap } from "./index";

// Paldea: a round land with the Great Crater in the middle and Mesagoza on its southern rim. Paths
// (Paldea has no numbered routes) run from Cabo Poco on the south coast up through Los Platos, west to
// Cortondo, Cascarrafa and Medali, east to Artazon and Levincia, and over Glaseado Mountain in the north.
export const PALDEA: RegionMap = {
  region: "paldea",
  width: 1000,
  height: 740,
  land: [
    "M 500 34 L 600 40 L 700 62 L 790 100 L 860 150 L 920 220 L 955 300 L 962 380 L 945 460 L 905 540 L 840 610 L 760 660 L 660 700 L 560 718 L 460 716 L 360 700 L 270 670 L 190 625 L 120 560 L 70 480 L 44 400 L 48 320 L 72 240 L 110 170 L 170 110 L 250 70 L 340 46 L 420 36 Z",
  ],
  water: [
    // Casseroya Lake
    "M 148 168 L 165 152 L 195 150 L 215 162 L 212 182 L 188 192 L 160 188 Z",
  ],
  routes: [
    { name: "Poco Path", points: [[500, 660], [500, 540]], label: [510, 604] },
    { name: "Los Platos road", points: [[500, 540], [500, 450]] },
    { name: "League road", points: [[500, 450], [400, 450]] },
    { name: "South Province west", points: [[500, 540], [300, 540], [300, 490]] },
    { name: "Cortondo road", points: [[300, 490], [240, 490], [240, 360]] },
    { name: "Alfornada road", points: [[240, 490], [240, 560], [190, 560]] },
    { name: "Asado Desert road", points: [[240, 360], [70, 360]] },
    { name: "Medali road", points: [[240, 360], [240, 220]] },
    { name: "Dalizapa Passage", points: [[240, 220], [240, 120], [620, 120]], label: [300, 112] },
    { name: "Glaseado summit", points: [[470, 120], [470, 80]] },
    { name: "East Province", points: [[500, 450], [700, 450], [890, 450], [890, 320]] },
    { name: "Levincia road", points: [[890, 320], [890, 230], [720, 230]] },
    { name: "Zapapico climb", points: [[720, 230], [720, 120], [620, 120]] },
  ],
  places: [
    { id: "great-crater", name: "Great Crater", x: 500, y: 290, kind: "landmark", glyph: "crater", size: [320, 240], label: { dx: 0, dy: 4 } },
    { id: "zero-gate", name: "Zero Gate", x: 387, y: 205, kind: "landmark", label: { dx: -10, dy: 5, anchor: "end" } },
    { id: "cabo-poco", name: "Cabo Poco", x: 500, y: 660, kind: "town", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "los-platos", name: "Los Platos", x: 500, y: 540, kind: "town", label: { dx: 16, dy: 5, anchor: "start" } },
    { id: "mesagoza", name: "Mesagoza", x: 500, y: 450, kind: "city", label: { dx: 16, dy: 24, anchor: "start" } },
    { id: "paldea-league", name: "Pokémon League", x: 400, y: 450, kind: "city", venue: "paldea-league", label: { dx: 0, dy: -30 } },
    { id: "cortondo", name: "Cortondo", x: 300, y: 490, kind: "city", venue: "cortondo-gym", label: { dx: 18, dy: 30, anchor: "start" } },
    { id: "alfornada", name: "Alfornada", x: 190, y: 560, kind: "city", venue: "alfornada-gym", label: { dx: 0, dy: 34 } },
    { id: "cascarrafa", name: "Cascarrafa", x: 240, y: 360, kind: "city", venue: "cascarrafa-gym", label: { dx: 22, dy: 5, anchor: "start" } },
    { id: "asado-desert", name: "Asado Desert", x: 150, y: 360, kind: "landmark", glyph: "park", size: [100, 56], label: { dx: 0, dy: -40 } },
    { id: "porto-marinada", name: "Porto Marinada", x: 70, y: 360, kind: "town", label: { dx: -16, dy: 40, anchor: "start" } },
    { id: "casseroya", name: "Casseroya Lake", x: 180, y: 170, kind: "landmark", glyph: "label", label: { dx: -10, dy: -30 } },
    { id: "medali", name: "Medali", x: 240, y: 220, kind: "city", venue: "medali-gym", label: { dx: -22, dy: 5, anchor: "end" } },
    { id: "glaseado", name: "Glaseado Mountain", x: 470, y: 80, kind: "city", venue: "glaseado-gym", label: { dx: 0, dy: -28 } },
    { id: "glaseado-peak-west", name: "", x: 390, y: 86, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 0 } },
    { id: "glaseado-peak-east", name: "", x: 555, y: 84, kind: "landmark", glyph: "mountain", label: { dx: 0, dy: 0 } },
    { id: "montenevera", name: "Montenevera", x: 620, y: 120, kind: "city", venue: "montenevera-gym", label: { dx: 0, dy: 34 } },
    { id: "zapapico", name: "Zapapico", x: 720, y: 230, kind: "town", label: { dx: 0, dy: 24 } },
    { id: "artazon", name: "Artazon", x: 700, y: 450, kind: "city", venue: "artazon-gym", label: { dx: 0, dy: -28 } },
    { id: "levincia", name: "Levincia", x: 890, y: 320, kind: "city", venue: "levincia-gym", label: { dx: -22, dy: 5, anchor: "end" } },
  ],
  title: [808, 650],
  compass: [950, 64],
};
