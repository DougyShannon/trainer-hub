// A map is a grid of squares written as rows of letters (see tiles.ts for what each letter means),
// so a map can be drawn and changed just by editing text. Stage 3 adds real towns and routes, and
// can load maps drawn in the free Tiled map editor into this same shape.

import type { Direction } from "./direction";
import { TILES, type TileKind } from "./tiles";

export type MapData = {
  id: string;
  /** Shown in the banner when the player arrives. */
  name: string;
  /** One string per row, one letter per square. "@" marks where a new game starts (it's a path square). */
  layout: string[];
  /** The square drawn beyond the edges, so the world never ends in black (like the GBA games). */
  border: string;
  /** What each sign says, by its column and row. */
  signs?: { x: number; y: number; text: string[] }[];
};

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly spawn: { x: number; y: number; facing: Direction };
  private rows: string[];

  constructor(readonly data: MapData) {
    this.width = data.layout[0].length;
    this.height = data.layout.length;
    let spawn = { x: 1, y: 1, facing: "down" as Direction };
    this.rows = data.layout.map((row, y) => {
      if (row.length !== this.width) throw new Error(`Map ${data.id}: row ${y} is ${row.length} squares wide, not ${this.width}.`);
      const x = row.indexOf("@");
      if (x >= 0) spawn = { x, y, facing: "down" };
      for (const char of row.replace("@", "")) if (!TILES[char]) throw new Error(`Map ${data.id}: unknown square "${char}".`);
      return row.replace("@", ",");
    });
    this.spawn = spawn;
  }

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  tile(x: number, y: number): TileKind {
    return TILES[this.inside(x, y) ? this.rows[y][x] : this.data.border];
  }

  /** Can the player stand on this square? Nothing outside the map can be walked onto. */
  walkable(x: number, y: number) {
    return this.inside(x, y) && !this.tile(x, y).solid;
  }

  signAt(x: number, y: number) {
    return this.data.signs?.find((s) => s.x === x && s.y === y);
  }
}
