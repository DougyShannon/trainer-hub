// A map is a grid of squares written as rows of letters (see tiles.ts for what each letter means),
// so a map can be drawn and changed just by editing text. On top of the squares a map can have
// buildings, people, signs, doors (warps) to other maps, and edges that join straight onto the next
// map, so walking off the side of a town carries on into the route next to it.

import { BUILDINGS, type BuildingKind } from "../art/buildings";
import type { PersonLook } from "../art/people";
import type { Direction } from "./direction";
import { TILES, type TileKind } from "./tiles";

/** A square on a particular map, and which way to face on arriving there. */
export type Spot = { map: string; x: number; y: number; facing: Direction };

export type MapData = {
  id: string;
  /** Shown in the banner when the player arrives outdoors. */
  name: string;
  /** Inside a building: no place-name banner. */
  indoor?: boolean;
  /** One string per row, one letter per square. "@" marks where a new game starts. */
  layout: string[];
  /** The square drawn beyond the edges, so the world never ends in black (the sea carries on as sea). */
  border: string;
  /**
   * Maps joined onto an edge. `offset` lines them up: for a map joined on the left or right, a row
   * here is row (row + offset) there; for one above or below, column (column + offset) there.
   */
  edges?: Partial<Record<Direction, { map: string; offset: number }>>;
  /** Stepping onto one of these squares (a door, a door mat) takes the player to `to`. */
  warps?: { x: number; y: number; to: Spot }[];
  /** Placed by their top-left square. A building without a door warp is locked. */
  buildings?: { kind: BuildingKind; x: number; y: number; roof: string }[];
  people?: { look: PersonLook; x: number; y: number; facing: Direction; text: string[] }[];
  /** What each sign says, by its column and row. */
  signs?: { x: number; y: number; text: string[] }[];
  /** Hedge gates that stand closed until the player has the named flag (see SaveFile.flags). */
  gates?: { x: number; y: number; flag: string }[];
  /**
   * A seed-planting puzzle: the player plants one of `seeds` in each plot, and the puzzle is solved
   * (setting `flag`) when every plot has its right seed (`seed` is its number in the list).
   */
  seedPuzzle?: { flag: string; seeds: { name: string; color: string }[]; plots: { x: number; y: number; seed: number }[] };
};

/** Which way to look for the map joined on, for a square just off the edge. */
const OPPOSITE: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly spawn: Spot;
  private rows: string[];
  private solid = new Set<string>();
  /** The player's flags, so gates know whether they're open (set by the overworld). */
  flags: Record<string, boolean> = {};

  constructor(
    readonly data: MapData,
    /** Finds a joined-on map by id (passed in so maps don't need to know about each other). */
    private find: (id: string) => GameMap | undefined = () => undefined,
  ) {
    this.width = data.layout[0].length;
    this.height = data.layout.length;
    let spawn: Spot = { map: data.id, x: 1, y: 1, facing: "down" };
    this.rows = data.layout.map((row, y) => {
      if (row.length !== this.width) throw new Error(`Map ${data.id}: row ${y} is ${row.length} squares wide, not ${this.width}.`);
      const x = row.indexOf("@");
      if (x >= 0) spawn = { map: data.id, x, y, facing: "down" };
      for (const char of row.replace("@", "")) if (!TILES[char]) throw new Error(`Map ${data.id}: unknown square "${char}".`);
      // The start square is plain floor indoors, plain path outdoors.
      return row.replace("@", data.indoor ? "_" : ",");
    });
    this.spawn = spawn;
    for (const b of data.buildings ?? []) {
      const look = BUILDINGS[b.kind];
      for (let y = 0; y < look.height; y++) for (let x = 0; x < look.width; x++) this.solid.add(`${b.x + x},${b.y + y}`);
      const door = { x: b.x + look.door, y: b.y + look.height - 1 };
      if (this.warpAt(door.x, door.y)) this.solid.delete(`${door.x},${door.y}`);
    }
    for (const p of data.people ?? []) this.solid.add(`${p.x},${p.y}`);
    for (const p of data.seedPuzzle?.plots ?? []) this.solid.add(`${p.x},${p.y}`);
  }

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Which edge a square just off the map is beyond (corners count as above or below). */
  sideOf(x: number, y: number): Direction | null {
    if (y < 0) return "up";
    if (y >= this.height) return "down";
    if (x < 0) return "left";
    if (x >= this.width) return "right";
    return null;
  }

  /** The joined-on map and matching square for a square off this map's edge, if a map is joined there. */
  across(x: number, y: number): { map: GameMap; x: number; y: number } | null {
    const side = this.sideOf(x, y);
    const edge = side && this.data.edges?.[side];
    const map = edge && this.find(edge.map);
    if (!side || !edge || !map) return null;
    const spot =
      side === "left" ? { x: x + map.width, y: y + edge.offset }
      : side === "right" ? { x: x - this.width, y: y + edge.offset }
      : side === "up" ? { x: x + edge.offset, y: y + map.height }
      : { x: x + edge.offset, y: y - this.height };
    // Only straight across: a corner beyond two edges shows the border instead.
    if (!map.inside(spot.x, spot.y) || map.data.edges?.[OPPOSITE[side]]?.map !== this.data.id) return null;
    return { map, ...spot };
  }

  tile(x: number, y: number): TileKind {
    if (this.inside(x, y)) return TILES[this.rows[y][x]];
    const there = this.across(x, y);
    if (there) return there.map.tile(there.x, there.y);
    const nearest = TILES[this.rows[Math.min(Math.max(y, 0), this.height - 1)][Math.min(Math.max(x, 0), this.width - 1)]];
    return nearest.name === "water" ? nearest : TILES[this.data.border];
  }

  /** Can the player stand on this square? Off the edge only where another map joins on. */
  walkable(x: number, y: number): boolean {
    if (!this.inside(x, y)) {
      const there = this.across(x, y);
      return !!there && there.map.walkable(there.x, there.y);
    }
    return !this.tile(x, y).solid && !this.solid.has(`${x},${y}`) && !this.closedGateAt(x, y);
  }

  closedGateAt(x: number, y: number) {
    return this.data.gates?.some((g) => g.x === x && g.y === y && !this.flags[g.flag]) ?? false;
  }

  plotAt(x: number, y: number) {
    return this.data.seedPuzzle?.plots.find((p) => p.x === x && p.y === y);
  }

  warpAt(x: number, y: number) {
    return this.data.warps?.find((w) => w.x === x && w.y === y);
  }

  signAt(x: number, y: number) {
    return this.data.signs?.find((s) => s.x === x && s.y === y);
  }

  personAt(x: number, y: number) {
    return this.data.people?.find((p) => p.x === x && p.y === y);
  }
}
