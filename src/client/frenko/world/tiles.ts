// The kinds of map square, each drawn with simple ORIGINAL placeholder pixel art until real tile art
// exists. A tile has a ground layer, and some also have an object standing on them (a tree, a rock,
// a sign) that is drawn in front of or behind the player depending on who is nearer the bottom of the
// screen. `solid` tiles can't be walked onto.

import { TILE } from "../engine/screen";

type Paint = (ctx: CanvasRenderingContext2D, x: number, y: number, col: number, row: number, time: number) => void;

export type TileKind = {
  name: string;
  solid: boolean;
  ground: Paint;
  object?: Paint;
};

const GRASS = "#78c058";
const GRASS_DARK = "#5ea844";
const GRASS_LIGHT = "#98d870";

/** The same "random" number every time for the same square, so speckles don't flicker. */
const hash = (col: number, row: number, salt = 0) => {
  let h = (col * 374761393 + row * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const grass: Paint = (ctx, x, y, col, row) => {
  ctx.fillStyle = GRASS;
  ctx.fillRect(x, y, TILE, TILE);
  for (let i = 0; i < 3; i++) {
    const px = x + Math.floor(hash(col, row, i) * 14) + 1;
    const py = y + Math.floor(hash(col, row, i + 7) * 13) + 1;
    ctx.fillStyle = GRASS_DARK;
    ctx.fillRect(px, py, 1, 2);
    ctx.fillRect(px + 2, py, 1, 2);
    ctx.fillStyle = GRASS_LIGHT;
    ctx.fillRect(px + 1, py - 1, 1, 1);
  }
};

const path: Paint = (ctx, x, y, col, row) => {
  ctx.fillStyle = "#e0c890";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#c8ae74";
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x + Math.floor(hash(col, row, i) * 14) + 1, y + Math.floor(hash(col, row, i + 3) * 14) + 1, 2, 1);
  }
};

const flowers: Paint = (ctx, x, y, col, row, time) => {
  grass(ctx, x, y, col, row, time);
  // Two little flowers that sway a pixel.
  const sway = Math.floor(time * 2 + col) % 2;
  for (const [fx, fy] of [
    [3, 3],
    [10, 9],
  ]) {
    ctx.fillStyle = "#f8f8f8";
    ctx.fillRect(x + fx + sway, y + fy, 3, 1);
    ctx.fillRect(x + fx + 1 + sway, y + fy - 1, 1, 3);
    ctx.fillStyle = "#f0c030";
    ctx.fillRect(x + fx + 1 + sway, y + fy, 1, 1);
  }
};

const water: Paint = (ctx, x, y, col, row, time) => {
  ctx.fillStyle = "#4890e0";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#78b8f8";
  const shift = Math.floor(time * 3 + hash(col, row) * 4) % 4;
  ctx.fillRect(x + 2 + shift, y + 4, 5, 1);
  ctx.fillRect(x + 8 - shift, y + 11, 5, 1);
};

const tree: Paint = (ctx, x, y) => {
  // Trunk on this square, leafy top reaching up over the square above.
  ctx.fillStyle = "#6a4420";
  ctx.fillRect(x + 6, y + 9, 4, 6);
  ctx.fillStyle = "#4a2e14";
  ctx.fillRect(x + 6, y + 14, 4, 1);
  ctx.fillStyle = "#2a6a30";
  ctx.fillRect(x + 1, y - 6, 14, 14);
  ctx.fillRect(x + 3, y - 9, 10, 19);
  ctx.fillRect(x, y - 3, 16, 8);
  ctx.fillStyle = "#3a8a3e";
  ctx.fillRect(x + 3, y - 7, 9, 11);
  ctx.fillRect(x + 2, y - 4, 11, 6);
  ctx.fillStyle = "#58a858";
  ctx.fillRect(x + 4, y - 7, 4, 2);
  ctx.fillRect(x + 3, y - 5, 2, 3);
  ctx.fillRect(x + 9, y - 1, 2, 2);
};

const rock: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#585860";
  ctx.fillRect(x + 2, y + 5, 12, 10);
  ctx.fillRect(x + 3, y + 3, 10, 13);
  ctx.fillStyle = "#9898a0";
  ctx.fillRect(x + 3, y + 5, 10, 8);
  ctx.fillRect(x + 4, y + 4, 8, 10);
  ctx.fillStyle = "#c0c0c8";
  ctx.fillRect(x + 5, y + 5, 3, 2);
};

const fence: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#f0e8d8";
  ctx.fillRect(x, y + 6, TILE, 2);
  ctx.fillRect(x, y + 11, TILE, 2);
  ctx.fillRect(x + 2, y + 3, 3, 12);
  ctx.fillRect(x + 11, y + 3, 3, 12);
  ctx.fillStyle = "#a89880";
  ctx.fillRect(x, y + 8, TILE, 1);
  ctx.fillRect(x, y + 13, TILE, 1);
  ctx.fillRect(x + 4, y + 3, 1, 12);
  ctx.fillRect(x + 13, y + 3, 1, 12);
};

const sign: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#6a4420";
  ctx.fillRect(x + 7, y + 10, 2, 5);
  ctx.fillStyle = "#4a2e14";
  ctx.fillRect(x + 1, y + 1, 14, 10);
  ctx.fillStyle = "#c89858";
  ctx.fillRect(x + 2, y + 2, 12, 8);
  ctx.fillStyle = "#8a6030";
  ctx.fillRect(x + 4, y + 4, 8, 1);
  ctx.fillRect(x + 4, y + 7, 6, 1);
};

/** The letter for each kind of square in the map layouts (see testArea.ts). */
export const TILES: Record<string, TileKind> = {
  ".": { name: "grass", solid: false, ground: grass },
  ",": { name: "path", solid: false, ground: path },
  f: { name: "flowers", solid: false, ground: flowers },
  "~": { name: "water", solid: true, ground: water },
  T: { name: "tree", solid: true, ground: grass, object: tree },
  R: { name: "rock", solid: true, ground: grass, object: rock },
  F: { name: "fence", solid: true, ground: grass, object: fence },
  S: { name: "sign", solid: true, ground: path, object: sign },
};
