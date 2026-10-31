// ROUTE 1 (a placeholder name): the first route, heading west out of Roucco Town toward the Gym 1
// town, as on Dougy's region map. The tall grass is where wild Pokémon will appear in Stage 4. The
// west end is closed off until the Gym 1 town is built.

import { ROUTE_1_END_SIGN, ROUTE_1_NAME, ROUTE_1_SIGN } from "../../data/placeholders";
import type { MapData } from "../map";

export const ROUTE_1: MapData = {
  id: "route-1",
  name: ROUTE_1_NAME,
  border: "T",
  // T tree   R rock   g tall grass   , path   . grass   f flowers   S sign
  layout: [
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "TTT....TTT....TTT....TTT....TTT....TTT.T",
    "T..gggggg.TT..................gggggg...T",
    "T..gggggg.TT..,,,,,,,,,,,,....ggggggTT.T",
    "T..gggggg.....,.gggggggg.,....ggggggTT.T",
    "T..gggggg....f,.gggggggg.,.fR..........T",
    "TS............,.gggggggg.,...........S.T",
    "T,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    "T,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    "T...........................gggggg.....T",
    "T...gggggggTTT..R..ggggg....ggggggf....T",
    "T...gggggggTTT.....ggggg..TTgggggg.....T",
    "T.f.ggggggg........ggggg..TTgggggg.R.f.T",
    "T...ggggggg...........f................T",
    "TTT...TT...TT...TT...TT...TT...TT...TT.T",
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
  ],
  edges: { right: { map: "roucco", offset: 2 } },
  signs: [
    { x: 37, y: 6, text: ROUTE_1_SIGN },
    { x: 1, y: 6, text: ROUTE_1_END_SIGN },
  ],
};
