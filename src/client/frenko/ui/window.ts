// The boxes every menu and message sits in, and the little arrows that go with them.

import { COLORS } from "../engine/screen";

/** A box with a two-tone frame and slightly rounded corners. */
export function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // Dark outer edge, corners cut by one pixel.
  ctx.fillStyle = COLORS.frame;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  // Lighter inner band.
  ctx.fillStyle = COLORS.frameLight;
  ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 4);
  // Paper.
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
}

/** The ▶ that points at the chosen menu line. */
export function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = COLORS.ink;
  for (let i = 0; i < 4; i++) ctx.fillRect(x + i, y + i, 1, 7 - i * 2);
}

/** The bobbing ▼ that says "press A to carry on". */
export function drawMoreArrow(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const bob = Math.floor(time * 3) % 2;
  ctx.fillStyle = COLORS.ink;
  for (let i = 0; i < 3; i++) ctx.fillRect(x + i, y + bob + i, 5 - i * 2, 1);
}
