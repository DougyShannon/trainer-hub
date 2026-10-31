// A PLACEHOLDER test area for trying out walking, bumping into things and the camera. It is not a
// Frenko location: Stage 3 replaces it with Dougy's real towns and routes.

import { TEST_AREA_NAME, TEST_AREA_SIGN } from "../../data/placeholders";
import type { MapData } from "../map";

export const TEST_AREA: MapData = {
  id: "test-area",
  name: TEST_AREA_NAME,
  border: "T",
  // T tree   R rock   F fence   ~ water   S sign   , path   . grass   f flowers   @ start
  layout: [
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    "T..........,,,,.............TT",
    "T..f.......,,,,......T..T....T",
    "T....RR....,,,,..............T",
    "T....R.....,,,,......T..T..f.T",
    "T..........,,,,..............T",
    "T..FFFFFF..,,,,.....~~~~.....T",
    "T..........,,,,....~~~~~~....T",
    "T.f......f.,,S,....~~~~~~....T",
    "T,,,,,,,,,,,,,,,,,,,~~~~.....T",
    "T,,,,,,,,,,,,@,,,,,,,,,,,,,,,T",
    "T..........,,,,..........,,..T",
    "T...TT.....,,,,....R.....,,..T",
    "T...TT.....,,,,..........,,..T",
    "T..........,,,,...f..f...,,..T",
    "T..f..R....,,,,..........,,..T",
    "T..........,,,,..FFFFFF..,,..T",
    "T.....TTT..,,,,..........,,..T",
    "T.....TTT..,,,,...f......,,f.T",
    "T..........,,,,..........,,..T",
    "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
  ],
  signs: [{ x: 13, y: 8, text: TEST_AREA_SIGN }],
};
