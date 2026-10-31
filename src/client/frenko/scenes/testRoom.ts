// A blank room for trying the screen and buttons. Stage 2 puts the player character in here, and
// Stage 3 replaces it with real maps. The floor and walls are plain placeholder tiles drawn by code.

import type { Game } from "../engine/game";
import { BUTTONS, type Button } from "../engine/input";
import type { Scene } from "../engine/scene";
import { COLORS, SCREEN_HEIGHT, SCREEN_WIDTH, TILE } from "../engine/screen";
import { TEST_ROOM_SIGN } from "../data/placeholders";
import { drawText, measureText } from "../ui/font";
import { MessageScene } from "../ui/textbox";
import { drawWindow } from "../ui/window";
import { StartMenuScene } from "./startMenu";

const COLS = SCREEN_WIDTH / TILE;
const ROWS = SCREEN_HEIGHT / TILE;
const ROOM_NAME = "TEST ROOM";
/** Seconds the place name stays up after arriving. */
const NAME_TIME = 2.5;

const BUTTON_NAMES: Record<Button, string> = {
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
  a: "A",
  b: "B",
  start: "START",
};

export class TestRoomScene implements Scene {
  private arrived = 0;
  private lastButton: Button | null = null;

  /** `intro` is shown in the message box as soon as the room appears (used for New Game). */
  constructor(private intro?: string[]) {}

  update(game: Game, dt: number) {
    this.arrived += dt;
    if (this.intro) {
      game.push(new MessageScene(this.intro));
      this.intro = undefined;
      return;
    }
    for (const button of BUTTONS) if (game.input.pressed(button)) this.lastButton = button;
    if (game.input.pressed("start")) game.push(new StartMenuScene());
    else if (game.input.pressed("a")) game.push(new MessageScene(TEST_ROOM_SIGN));
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const wall = row < 2 || col === 0 || col === COLS - 1 || row === ROWS - 1;
        if (wall) drawWall(ctx, col * TILE, row * TILE, row < 2 && row === 1);
        else drawFloor(ctx, col * TILE, row * TILE, (row + col) % 2 === 0);
      }
    }
    // The test sign on the back wall.
    drawSign(ctx, 7 * TILE, 1 * TILE);

    if (this.arrived < NAME_TIME) {
      // The place name slides down from the top, then back up.
      const slide = Math.min(1, this.arrived * 4, (NAME_TIME - this.arrived) * 4);
      const w = measureText(ROOM_NAME) + 24;
      drawWindow(ctx, 4, Math.round(-24 + 28 * slide), w, 22);
      drawText(ctx, ROOM_NAME, 16, Math.round(-24 + 28 * slide) + 7);
    }

    const hint = this.lastButton ? `You pressed ${BUTTON_NAMES[this.lastButton]}` : "Press START for the menu, A to read";
    drawWindow(ctx, 4, SCREEN_HEIGHT - 26, SCREEN_WIDTH - 8, 22);
    drawText(ctx, hint, 14, SCREEN_HEIGHT - 19);
  }
}

function drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, light: boolean) {
  ctx.fillStyle = light ? "#d8d0b8" : "#cfc6ac";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#bdb399";
  ctx.fillRect(x, y + TILE - 1, TILE, 1);
  ctx.fillRect(x + TILE - 1, y, 1, TILE);
}

function drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, skirting: boolean) {
  ctx.fillStyle = "#7b8aa8";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#6a7896";
  ctx.fillRect(x, y + 7, TILE, 1);
  ctx.fillRect(x + (Math.floor(y / 8) % 2 ? 4 : 12), y, 1, 7);
  ctx.fillRect(x + (Math.floor(y / 8) % 2 ? 12 : 4), y + 8, 1, 8);
  if (skirting) {
    ctx.fillStyle = "#4a5a78";
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
  }
}

function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#8a5a2c";
  ctx.fillRect(x + 2, y + 2, 12, 9);
  ctx.fillStyle = "#e8d8a8";
  ctx.fillRect(x + 3, y + 3, 10, 7);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(x + 5, y + 5, 6, 1);
  ctx.fillRect(x + 5, y + 7, 4, 1);
  ctx.fillStyle = "#6a4420";
  ctx.fillRect(x + 7, y + 11, 2, 4);
}
