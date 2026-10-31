// ROUCCO TOWN, the player's hometown, at the top of Dougy's region map. He based it on Fremantle, so
// this placeholder layout has a harbour with jetties, a beach, market stalls and pale stone houses.
// The layout is a first draft for Dougy to change.

import { LAB_SIGN, MUM_LINES, PLAYER_HOUSE_SIGN, PROFESSOR_LINES, ROUCCO_NAME, ROUCCO_SIGN } from "../../data/placeholders";
import type { MapData } from "../map";

export const ROUCCO: MapData = {
  id: "roucco",
  name: ROUCCO_NAME,
  border: "T",
  // T tree   ~ sea   = jetty   s sand   , path   . grass   f flowers   M market stall   S sign
  // Buildings sit on top of the grass squares under them (see `buildings`).
  layout: [
    "~~~~~~~~~~~~~~~~~~~~~~~~",
    "~~~~~~=~~~~~~~~~~~=~~~~~",
    "~~~~~~=~~~~~~~~~~~=~~~~~",
    "~~~~~~=~~~~~~~~~~~=~~~~~",
    "ssssss=sssssssssss=sssss",
    "Tsssss,sssssssssss,ssssT",
    "T.....,,,,,,,,,,,,,,,..T",
    "T..f.....M.M.M......,..T",
    "T.....,.............,..T",
    ",,,,,,,.............,..T",
    ",,,,,,,,,,,,,,,,,,,,,..T",
    "T.....,.....,.......,..T",
    "T.....,.....,.......,..T",
    "T.....,.....,.......,..T",
    "T....S,.....,.......,..T",
    "T,,,,,,,,,,,,S......,..T",
    "T.....,.....,,,,,,,,,..T",
    "T..f..,..........S.f...T",
    "T......................T",
    "T..ff.......TT.....ff..T",
    "T......................T",
    "TTTTTTTTTTTTTTTTTTTTTTTT",
  ],
  edges: { left: { map: "route-1", offset: -2 } },
  buildings: [
    { kind: "house", x: 1, y: 12, roof: "#c85040" }, // the player's house
    { kind: "house", x: 7, y: 12, roof: "#5078c0" }, // a neighbour's house (locked for now)
    { kind: "lab", x: 14, y: 12, roof: "#58a070" }, // Professor Eucalyptus's lab
  ],
  warps: [
    { x: 3, y: 14, to: { map: "player-house", x: 4, y: 6, facing: "up" } },
    { x: 16, y: 15, to: { map: "lab", x: 5, y: 8, facing: "up" } },
  ],
  signs: [
    { x: 17, y: 17, text: ROUCCO_SIGN },
    { x: 5, y: 14, text: PLAYER_HOUSE_SIGN },
    { x: 13, y: 15, text: LAB_SIGN },
  ],
};

export const PLAYER_HOUSE: MapData = {
  id: "player-house",
  name: "",
  indoor: true,
  border: "#",
  // W wall   b bookshelf   _ floor   z bed   t table   p plant   m door mat   @ where a new game starts
  layout: [
    "WWWWWWWWWW",
    "WbbWWWWWWW",
    "W_______zW",
    "W_@______W",
    "W___tt___W",
    "W___tt___W",
    "Wp_______W",
    "WWWWmWWWWW",
  ],
  people: [{ look: "mum", x: 6, y: 5, facing: "left", text: MUM_LINES }],
  warps: [{ x: 4, y: 7, to: { map: "roucco", x: 3, y: 15, facing: "down" } }],
};

export const LAB: MapData = {
  id: "lab",
  name: "",
  indoor: true,
  border: "#",
  // k lab machine (plus the letters above)
  layout: [
    "WWWWWWWWWWWW",
    "WbbbbWWbbbbW",
    "W__________W",
    "W_k______k_W",
    "W__________W",
    "W_tt____tt_W",
    "W_tt____tt_W",
    "Wp________pW",
    "W__________W",
    "WWWWWmWWWWWW",
  ],
  people: [{ look: "professor", x: 5, y: 3, facing: "down", text: PROFESSOR_LINES }],
  warps: [{ x: 5, y: 9, to: { map: "roucco", x: 16, y: 16, facing: "down" } }],
};
