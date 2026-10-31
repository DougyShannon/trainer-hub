// LEAFSOIL FARMS, the Gym 1 town, west of Roucco Town along Route 1 (Dougy's region map). Gym Leader
// Soily's puzzle is planting the right seeds in the right fertiliser plots: 4 plots, each with a sign
// hinting at its seed, and a hedge gate to Soily that opens once all 4 are right.
// The layout (fields, Gym, Pokémon Center, Poké Mart) is a first draft.

import {
  CENTER_COUNTER,
  CENTER_SIGN,
  GYM_1_SIGN,
  GYM_1_HINTS,
  GYM_1_SEEDS,
  LEAFSOIL_NAME,
  LEAFSOIL_SIGN,
  LEAFSOIL_SOUTH_SIGN,
  MART_COUNTER,
  MART_SIGN,
  SOILY_LINES,
} from "../../data/placeholders";
import type { MapData } from "../map";

export const LEAFSOIL: MapData = {
  id: "leafsoil",
  name: LEAFSOIL_NAME,
  border: "T",
  // T tree   F fence   c crops   o soil   h hay bale   , path   . grass   f flowers   S sign
  layout: [
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "TTT......................TTT",
    "TTT.....................fTTT",
    "T...f....f.........f.......T",
    "T......................f...T",
    "T..........................T",
    "T............,,............T",
    "T..f.........,,..........f.T",
    "T......,.....,,.....,......T",
    "T..,,,,,,,,,,,,,,,,,,,,,,,,,",
    "T..,,,,,,,,,,,,,,,,,,,,,,,,,",
    "T......,.....,,S...........T",
    "T.FFFFF,FFFF.,,..FFFFFFFFF.T",
    "T.FccccccccF.,,..FcccccccF.T",
    "T.FccccccccF.,,..FcccccccF.T",
    "T.FccccccccF.,,..FoooooooF.T",
    "T.FccccccccF.,,..FoooooooF.T",
    "T.FccccccccF.,,..FFFFFFFFF.T",
    "T.FFFFFFFFFF.,,S.......hh..T",
    "T............TT.......h....T",
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
  ],
  edges: { right: { map: "route-1", offset: -3 } },
  buildings: [
    { kind: "gym", x: 11, y: 3, roof: "#6a9a40" },
    { kind: "house", x: 5, y: 6, roof: "#4878c8" }, // Poké Mart
    { kind: "house", x: 18, y: 6, roof: "#d04848" }, // Pokémon Center
    { kind: "house", x: 20, y: 19, roof: "#8a5a34" }, // farmhouse (locked for now)
  ],
  warps: [
    { x: 13, y: 6, to: { map: "leafsoil-gym", x: 5, y: 10, facing: "up" } },
    { x: 7, y: 8, to: { map: "leafsoil-mart", x: 4, y: 6, facing: "up" } },
    { x: 20, y: 8, to: { map: "leafsoil-center", x: 4, y: 6, facing: "up" } },
  ],
  signs: [
    { x: 15, y: 12, text: LEAFSOIL_SIGN },
    { x: 15, y: 19, text: LEAFSOIL_SOUTH_SIGN },
    { x: 12, y: 7, text: GYM_1_SIGN },
    { x: 21, y: 9, text: CENTER_SIGN },
    { x: 6, y: 9, text: MART_SIGN },
  ],
};

export const LEAFSOIL_CENTER: MapData = {
  id: "leafsoil-center",
  name: "",
  indoor: true,
  border: "#",
  layout: [
    "WWWWWWWWWW",
    "WWWWWWWWWW",
    "W________W",
    "W__tttt__W",
    "W________W",
    "Wp______pW",
    "W________W",
    "WWWWmWWWWW",
  ],
  signs: [{ x: 4, y: 3, text: CENTER_COUNTER }],
  warps: [{ x: 4, y: 7, to: { map: "leafsoil", x: 20, y: 9, facing: "down" } }],
};

export const LEAFSOIL_MART: MapData = {
  id: "leafsoil-mart",
  name: "",
  indoor: true,
  border: "#",
  layout: [
    "WWWWWWWWWW",
    "WbbbWWbbbW",
    "W________W",
    "Wtt______W",
    "W____bb__W",
    "W____bb__W",
    "W________W",
    "WWWWmWWWWW",
  ],
  signs: [{ x: 1, y: 3, text: MART_COUNTER }],
  warps: [{ x: 4, y: 7, to: { map: "leafsoil", x: 7, y: 9, facing: "down" } }],
};

/** The flag set once Soily's seed puzzle is solved. */
const GYM_1_PUZZLE = "leafsoil-gym-seeds";

export const LEAFSOIL_GYM: MapData = {
  id: "leafsoil-gym",
  name: "",
  indoor: true,
  border: "#",
  // H hedge (the middle two squares of the hedge are a gate)   o fertiliser plot   S hint sign
  layout: [
    "WWWWWWWWWWWW",
    "WWWWWWWWWWWW",
    "Wp________pW",
    "W__________W",
    "WHHHH__HHHHW",
    "W__________W",
    "W_oS____So_W",
    "W__________W",
    "W__________W",
    "W_oS____So_W",
    "W__________W",
    "WWWWWmWWWWWW",
  ],
  people: [{ look: "soily", x: 5, y: 2, facing: "down", text: SOILY_LINES }],
  gates: [
    { x: 5, y: 4, flag: GYM_1_PUZZLE },
    { x: 6, y: 4, flag: GYM_1_PUZZLE },
  ],
  seedPuzzle: {
    flag: GYM_1_PUZZLE,
    seeds: GYM_1_SEEDS,
    plots: [
      { x: 2, y: 6, seed: 0 },
      { x: 9, y: 6, seed: 1 },
      { x: 2, y: 9, seed: 2 },
      { x: 9, y: 9, seed: 3 },
    ],
  },
  signs: [
    { x: 3, y: 6, text: GYM_1_HINTS[0] },
    { x: 8, y: 6, text: GYM_1_HINTS[1] },
    { x: 3, y: 9, text: GYM_1_HINTS[2] },
    { x: 8, y: 9, text: GYM_1_HINTS[3] },
  ],
  warps: [{ x: 5, y: 11, to: { map: "leafsoil", x: 13, y: 7, facing: "down" } }],
};
