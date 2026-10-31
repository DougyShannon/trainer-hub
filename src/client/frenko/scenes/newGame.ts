// Starting a new game: choose to play as a boy or a girl, then type a name. The name screen works
// with the keyboard (just type) and with the D-pad (pick letters from the grid, as on the GBA).

import type { Gender } from "../art/player";
import { PLAYER_LOOKS } from "../art/player";
import { sprite } from "../art/pixels";
import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { COLORS, SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { NEW_GAME_INTRO } from "../data/placeholders";
import { NAME_LENGTH, newSave } from "../save/saveFile";
import { drawText, measureText } from "../ui/font";
import { Menu } from "../ui/menu";
import { drawMessageBox } from "../ui/textbox";
import { drawWindow } from "../ui/window";
import { OverworldScene } from "./overworld";

const BACKGROUND = "#5868a0";

/** The player's picture (standing, facing down) drawn `scale` times bigger. */
function drawPlayer(ctx: CanvasRenderingContext2D, gender: Gender, x: number, y: number, scale: number) {
  const look = PLAYER_LOOKS[gender];
  const image = sprite(`player-${gender}-down-stand`, look.frames.down.stand, look.palette);
  ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
}

export class GenderScene implements Scene {
  private menu = new Menu([{ label: "BOY" }, { label: "GIRL" }], 180, 70);

  constructor(private back: () => Scene) {}

  update(game: Game) {
    const picked = this.menu.update(game);
    if (picked === null) return;
    if (picked === "back") return game.switchTo(this.back());
    game.push(new NameScene(picked === 0 ? "boy" : "girl"));
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    // Both trainers, the highlighted one standing forward.
    (["boy", "girl"] as const).forEach((gender, i) => {
      const chosen = this.menu.cursor === i;
      ctx.globalAlpha = chosen ? 1 : 0.45;
      drawPlayer(ctx, gender, 30 + i * 70, chosen ? 18 : 24, 3);
      ctx.globalAlpha = 1;
    });
    this.menu.draw(ctx);
    drawMessageBox(ctx, ["Are you a boy or a girl?"]);
  }
}

const PAGES = [
  ["ABCDEFGHI", "JKLMNOPQR", "STUVWXYZ-"],
  ["abcdefghi", "jklmnopqr", "stuvwxyz-"],
];
const BUTTONS = ["UPPER/lower", "DEL", "OK"];
const COLS = 9;
const CELL_W = 24;
const CELL_H = 18;
const GRID_X = 12;
const GRID_Y = 46;

class NameScene implements Scene {
  private name = "";
  private page = 0;
  private col = 0;
  private row = 0; // 0 to 2 are letters, 3 is the button row

  constructor(private gender: Gender) {}

  update(game: Game) {
    const input = game.input;
    input.textMode = true;
    for (const char of input.typed()) this.add(char);
    if (input.repeated("left")) this.col = (this.col + COLS - 1) % COLS;
    if (input.repeated("right")) this.col = (this.col + 1) % COLS;
    if (input.repeated("up")) this.row = (this.row + 3) % 4;
    if (input.repeated("down")) this.row = (this.row + 1) % 4;
    if (input.pressed("b")) {
      if (this.name) this.name = this.name.slice(0, -1);
      else this.leave(game);
      return;
    }
    if (input.pressed("start")) return this.finish(game);
    if (!input.pressed("a")) return;
    if (this.row < 3) return this.add(PAGES[this.page][this.row][this.col]);
    const button = BUTTONS[Math.floor(this.col / 3)];
    if (button === "DEL") this.name = this.name.slice(0, -1);
    else if (button === "OK") this.finish(game);
    else this.page = 1 - this.page;
  }

  private add(char: string) {
    if (this.name.length < NAME_LENGTH) this.name += char;
  }

  private leave(game: Game) {
    game.input.textMode = false;
    game.pop();
  }

  private finish(game: Game) {
    if (!this.name.trim()) return;
    game.input.textMode = false;
    game.save = newSave({ name: this.name.trim(), gender: this.gender });
    game.saveSlot = null;
    game.switchTo(new OverworldScene(game, NEW_GAME_INTRO));
  }

  draw(ctx: CanvasRenderingContext2D, game: Game) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    // The name so far, with a blinking line where the next letter goes.
    drawWindow(ctx, 4, 4, SCREEN_WIDTH - 8, 36);
    drawPlayer(ctx, this.gender, 12, 11, 1);
    drawText(ctx, "YOUR NAME?", 36, 10);
    drawText(ctx, this.name, 36, 23);
    const end = 36 + measureText(this.name) + (this.name ? 2 : 0);
    if (this.name.length < NAME_LENGTH && Math.floor(game.time * 2) % 2 === 0) {
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(end, 31, 5, 1);
    }
    drawText(ctx, `${this.name.length}/${NAME_LENGTH}`, SCREEN_WIDTH - 36, 23, { color: COLORS.dim });

    drawWindow(ctx, 4, GRID_Y - 4, SCREEN_WIDTH - 8, SCREEN_HEIGHT - GRID_Y);
    PAGES[this.page].forEach((letters, row) =>
      [...letters].forEach((char, col) => {
        const x = GRID_X + col * CELL_W;
        drawText(ctx, char, x + Math.floor((CELL_W - measureText(char)) / 2), GRID_Y + row * CELL_H + 4);
      }),
    );
    BUTTONS.forEach((label, i) => {
      const x = GRID_X + i * 3 * CELL_W;
      drawText(ctx, label, x + Math.floor((3 * CELL_W - measureText(label)) / 2), GRID_Y + 3 * CELL_H + 6);
    });
    // The cursor: a box round the chosen letter, or round the whole button.
    const wide = this.row === 3;
    const x = GRID_X + (wide ? Math.floor(this.col / 3) * 3 : this.col) * CELL_W;
    const y = GRID_Y + this.row * CELL_H + (wide ? 2 : 0);
    const w = wide ? 3 * CELL_W : CELL_W;
    ctx.strokeStyle = COLORS.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1.5, y + 0.5, w - 3, CELL_H - 2);
    drawText(ctx, "Type, or pick letters. START when done", 12, SCREEN_HEIGHT - 16, { color: COLORS.dim, shadow: null });
  }
}
