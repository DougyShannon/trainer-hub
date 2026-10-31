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
  /** Drawn over the player too (tall grass hiding their feet). */
  cover?: Paint;
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

const tallGrass: Paint = (ctx, x, y, col, row) => {
  ctx.fillStyle = GRASS_DARK;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#4a9036";
  for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 4 + 1, y + 2 + ((col + row + i) % 2) * 6, 2, 4);
};

/** The front blades of tall grass, which hide the bottom of whoever stands in it. */
const tallGrassFront: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#3e8030";
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + i * 4, y + 10, 3, 6);
    ctx.fillRect(x + i * 4 + 1, y + 8, 1, 2);
  }
  ctx.fillStyle = "#68b850";
  for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 4 + 1, y + 10, 1, 3);
};

const sand: Paint = (ctx, x, y, col, row) => {
  ctx.fillStyle = "#f0dca0";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#d8c080";
  for (let i = 0; i < 4; i++) ctx.fillRect(x + Math.floor(hash(col, row, i) * 15), y + Math.floor(hash(col, row, i + 5) * 15), 1, 1);
};

/** Wooden planks of a jetty, walked on over the water. */
const jetty: Paint = (ctx, x, y, col, row, time) => {
  water(ctx, x, y, col, row, time);
  ctx.fillStyle = "#a07040";
  ctx.fillRect(x + 1, y, 14, TILE);
  ctx.fillStyle = "#7a5028";
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 1, y + i * 4 + 3, 14, 1);
  ctx.fillRect(x + 1, y, 1, TILE);
  ctx.fillRect(x + 14, y, 1, TILE);
};

/** A market stall with a striped awning. */
const stall: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#8a6030";
  ctx.fillRect(x + 1, y + 2, 2, 13);
  ctx.fillRect(x + 13, y + 2, 2, 13);
  ctx.fillStyle = "#c89858";
  ctx.fillRect(x, y + 9, TILE, 5);
  ctx.fillStyle = "#f08838";
  ctx.fillRect(x + 4, y + 7, 3, 2);
  ctx.fillStyle = "#e84848";
  ctx.fillRect(x + 9, y + 7, 3, 2);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? "#f8f8f8" : "#d84040";
    ctx.fillRect(x + i * 4, y - 4, 4, 7);
  }
};

const soil: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#8a5a34";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#6e4426";
  for (let i = 0; i < 3; i++) ctx.fillRect(x, y + 2 + i * 5, TILE, 2);
};

/** Rows of young crops growing in the soil. */
const crops: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#3a8a3e";
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 3; j++) {
      ctx.fillRect(x + 2 + i * 8, y + 1 + j * 5, 4, 3);
      ctx.fillRect(x + 3 + i * 8, y + j * 5, 2, 1);
    }
  }
  ctx.fillStyle = "#68b850";
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) ctx.fillRect(x + 3 + i * 8, y + 1 + j * 5, 1, 1);
};

/** A clipped hedge, used for walls of greenery and for gates that open. */
export const hedge: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#2a6a30";
  ctx.fillRect(x, y - 2, TILE, 17);
  ctx.fillStyle = "#3a8a3e";
  ctx.fillRect(x + 1, y - 1, 14, 13);
  ctx.fillStyle = "#58a858";
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 2 + i * 5, y + 1 + (i % 2) * 4, 3, 2);
};

const hay: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#b08828";
  ctx.fillRect(x + 1, y + 3, 14, 12);
  ctx.fillStyle = "#e8c050";
  ctx.fillRect(x + 2, y + 2, 12, 11);
  ctx.fillStyle = "#c8a038";
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 2, y + 4 + i * 3, 12, 1);
  ctx.fillStyle = "#a05028";
  ctx.fillRect(x + 5, y + 2, 1, 11);
  ctx.fillRect(x + 10, y + 2, 1, 11);
};

// Inside buildings.
const floor: Paint = (ctx, x, y, col) => {
  ctx.fillStyle = "#d8b880";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#c0a068";
  ctx.fillRect(x, y + 7, TILE, 1);
  ctx.fillRect(x, y + 15, TILE, 1);
  ctx.fillRect(x + (col % 2 ? 4 : 11), y, 1, 7);
  ctx.fillRect(x + (col % 2 ? 11 : 4), y + 8, 1, 7);
};

const wall: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#e8e0c8";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#c8bc98";
  ctx.fillRect(x, y + 12, TILE, 4);
  ctx.fillStyle = "#d8ceb0";
  ctx.fillRect(x + 7, y, 2, 12);
};

const mat: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#c84848";
  ctx.fillRect(x + 1, y + 3, 14, 10);
  ctx.fillStyle = "#e87070";
  ctx.fillRect(x + 3, y + 5, 10, 6);
};

const nothing: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#101010";
  ctx.fillRect(x, y, TILE, TILE);
};

const table: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#8a5a2c";
  ctx.fillRect(x, y + 2, TILE, 11);
  ctx.fillStyle = "#b07840";
  ctx.fillRect(x, y + 2, TILE, 8);
  ctx.fillStyle = "#6a4420";
  ctx.fillRect(x + 1, y + 13, 2, 3);
  ctx.fillRect(x + 13, y + 13, 2, 3);
};

const shelf: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#7a4e26";
  ctx.fillRect(x, y - 6, TILE, 22);
  ctx.fillStyle = "#5a3818";
  for (const sy of [-4, 3, 10]) ctx.fillRect(x + 1, y + sy, 14, 5);
  const books = ["#d84040", "#4878d8", "#48a848", "#e8c040"];
  for (const [i, sy] of [-4, 3, 10].entries()) {
    for (let b = 0; b < 4; b++) {
      ctx.fillStyle = books[(b + i) % 4];
      ctx.fillRect(x + 2 + b * 3, y + sy + 1, 2, 4);
    }
  }
};

const bed: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#6a4420";
  ctx.fillRect(x + 1, y - 6, 14, 22);
  ctx.fillStyle = "#f8f8f8";
  ctx.fillRect(x + 2, y - 5, 12, 6);
  ctx.fillStyle = "#4878d8";
  ctx.fillRect(x + 2, y + 2, 12, 12);
  ctx.fillStyle = "#3860b0";
  ctx.fillRect(x + 2, y + 2, 12, 1);
};

const plant: Paint = (ctx, x, y) => {
  ctx.fillStyle = "#b05a30";
  ctx.fillRect(x + 4, y + 9, 8, 6);
  ctx.fillStyle = "#3a8a3e";
  ctx.fillRect(x + 3, y - 2, 10, 11);
  ctx.fillRect(x + 1, y + 1, 14, 5);
  ctx.fillStyle = "#58a858";
  ctx.fillRect(x + 5, y - 1, 3, 3);
};

/** A lab machine with blinking lights. */
const machine: Paint = (ctx, x, y, _col, _row, time) => {
  ctx.fillStyle = "#585868";
  ctx.fillRect(x + 1, y - 6, 14, 21);
  ctx.fillStyle = "#9898a8";
  ctx.fillRect(x + 2, y - 5, 12, 8);
  ctx.fillStyle = "#58c8f0";
  ctx.fillRect(x + 3, y - 4, 10, 6);
  const blink = Math.floor(time * 2) % 2;
  ctx.fillStyle = blink ? "#f04040" : "#40d040";
  ctx.fillRect(x + 4, y + 6, 2, 2);
  ctx.fillStyle = blink ? "#40d040" : "#f0c030";
  ctx.fillRect(x + 9, y + 6, 2, 2);
};

/** The letter for each kind of square in the map layouts (see the maps folder). */
export const TILES: Record<string, TileKind> = {
  ".": { name: "grass", solid: false, ground: grass },
  ",": { name: "path", solid: false, ground: path },
  f: { name: "flowers", solid: false, ground: flowers },
  "~": { name: "water", solid: true, ground: water },
  T: { name: "tree", solid: true, ground: grass, object: tree },
  R: { name: "rock", solid: true, ground: grass, object: rock },
  F: { name: "fence", solid: true, ground: grass, object: fence },
  S: { name: "sign", solid: true, ground: path, object: sign },
  g: { name: "tall grass", solid: false, ground: tallGrass, cover: tallGrassFront },
  s: { name: "sand", solid: false, ground: sand },
  "=": { name: "jetty", solid: false, ground: jetty },
  M: { name: "market stall", solid: true, ground: path, object: stall },
  o: { name: "soil", solid: false, ground: soil },
  c: { name: "crops", solid: true, ground: soil, object: crops },
  h: { name: "hay bale", solid: true, ground: grass, object: hay },
  H: { name: "hedge", solid: true, ground: floor, object: hedge },
  // Inside buildings.
  _: { name: "floor", solid: false, ground: floor },
  W: { name: "wall", solid: true, ground: wall },
  m: { name: "door mat", solid: false, ground: (ctx, x, y, col, row, time) => (floor(ctx, x, y, col, row, time), mat(ctx, x, y, col, row, time)) },
  "#": { name: "nothing", solid: true, ground: nothing },
  t: { name: "table", solid: true, ground: floor, object: table },
  b: { name: "bookshelf", solid: true, ground: wall, object: shelf },
  z: { name: "bed", solid: true, ground: floor, object: bed },
  p: { name: "plant", solid: true, ground: floor, object: plant },
  k: { name: "machine", solid: true, ground: floor, object: machine },
};
