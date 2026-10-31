// Every map in the game, by id. New towns and routes are added here.

import { GameMap, type MapData } from "../map";
import { LAB, PLAYER_HOUSE, ROUCCO } from "./roucco";
import { ROUTE_1 } from "./route1";

export const MAPS: Record<string, MapData> = Object.fromEntries([ROUCCO, PLAYER_HOUSE, LAB, ROUTE_1].map((m) => [m.id, m]));

/** Where a new game starts: the player's house. */
export const FIRST_MAP = PLAYER_HOUSE.id;

const loaded = new Map<string, GameMap>();

/** The ready-to-walk-on version of a map (each is only set up once). */
export function loadMap(id: string): GameMap | undefined {
  const data = MAPS[id];
  if (!data) return undefined;
  let map = loaded.get(id);
  if (!map) {
    map = new GameMap(data, loadMap);
    loaded.set(id, map);
  }
  return map;
}
