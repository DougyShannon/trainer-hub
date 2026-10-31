// Every map in the game, by id. Stage 3 adds Frenko's towns and routes here.

import type { MapData } from "../map";
import { TEST_AREA } from "./testArea";

export const MAPS: Record<string, MapData> = {
  [TEST_AREA.id]: TEST_AREA,
};

/** Where a new game starts. */
export const FIRST_MAP = TEST_AREA.id;
