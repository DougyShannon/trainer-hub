// ORIGINAL placeholder buildings for the towns, drawn with simple shapes until real art exists. Each
// kind has a size in map squares and a door in its bottom row. A map places buildings by their
// top-left square (see world/maps).

import { TILE } from "../engine/screen";

export type BuildingKind = "house" | "lab" | "gym";

type Look = {
  /** Size in map squares. */
  width: number;
  height: number;
  /** Which column of the bottom row the door is in. */
  door: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, roof: string) => void;
};

/** A darker version of a colour like "#c84848", for shading. */
function shade(color: string, amount = 0.7) {
  const n = parseInt(color.slice(1), 16);
  const part = (shift: number) => Math.round(((n >> shift) & 255) * amount);
  return `rgb(${part(16)},${part(8)},${part(0)})`;
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#585060";
  ctx.fillRect(x, y, 12, 10);
  ctx.fillStyle = "#a8d8f8";
  ctx.fillRect(x + 1, y + 1, 10, 8);
  ctx.fillStyle = "#e8f8ff";
  ctx.fillRect(x + 2, y + 2, 3, 2);
  ctx.fillStyle = "#585060";
  ctx.fillRect(x + 6, y + 1, 1, 8);
}

function drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#4a2e14";
  ctx.fillRect(x + 2, y, 12, TILE);
  ctx.fillStyle = "#8a5a2c";
  ctx.fillRect(x + 3, y + 1, 10, TILE - 1);
  ctx.fillStyle = "#f0c030";
  ctx.fillRect(x + 10, y + 8, 2, 2);
}

/** Pale stone walls and a pitched roof (Roucco's old stone buildings). */
function drawHouse(ctx: CanvasRenderingContext2D, x: number, y: number, roof: string, width: number, height: number, door: number) {
  const w = width * TILE;
  const wallTop = y + (height - 1.5) * TILE;
  // Roof.
  ctx.fillStyle = shade(roof, 0.6);
  ctx.fillRect(x, y + 2, w, wallTop - y);
  ctx.fillStyle = roof;
  ctx.fillRect(x + 1, y + 2, w - 2, wallTop - y - 3);
  ctx.fillStyle = shade(roof, 0.85);
  for (let ry = y + 6; ry < wallTop - 2; ry += 5) ctx.fillRect(x + 1, ry, w - 2, 1);
  ctx.fillStyle = shade(roof, 0.5);
  ctx.fillRect(x, y, w, 3);
  // Walls.
  ctx.fillStyle = "#e8dcc0";
  ctx.fillRect(x + 1, wallTop, w - 2, y + height * TILE - wallTop);
  ctx.fillStyle = "#c8b890";
  for (let wy = wallTop + 5; wy < y + height * TILE; wy += 6) ctx.fillRect(x + 1, wy, w - 2, 1);
  ctx.fillStyle = "#a89870";
  ctx.fillRect(x + 1, y + height * TILE - 2, w - 2, 2);
  const doorX = x + door * TILE;
  const bottom = y + (height - 1) * TILE;
  drawDoor(ctx, doorX, bottom);
  for (let col = 0; col < width; col++) if (col !== door) drawWindow(ctx, x + col * TILE + 2, wallTop + 6);
}

export const BUILDINGS: Record<BuildingKind, Look> = {
  house: { width: 4, height: 3, door: 2, draw: (ctx, x, y, roof) => drawHouse(ctx, x, y, roof, 4, 3, 2) },
  lab: { width: 6, height: 4, door: 2, draw: (ctx, x, y, roof) => drawHouse(ctx, x, y, roof, 6, 4, 2) },
  gym: {
    width: 6,
    height: 4,
    door: 2,
    draw: (ctx, x, y, roof) => {
      drawHouse(ctx, x, y, roof, 6, 4, 2);
      // A plain placeholder badge on the roof, so the Gym stands out from the houses.
      ctx.fillStyle = "#f8f8f8";
      ctx.fillRect(x + 40, y + 10, 16, 16);
      ctx.fillStyle = "#f0c030";
      ctx.fillRect(x + 42, y + 12, 12, 12);
      ctx.fillStyle = "#c89818";
      ctx.fillRect(x + 46, y + 14, 4, 8);
      ctx.fillRect(x + 44, y + 16, 8, 4);
    },
  },
};
