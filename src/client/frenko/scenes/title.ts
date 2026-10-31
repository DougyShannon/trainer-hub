// The title screen. Everything here is a plain placeholder drawn by code: Dougy's own title art and
// logo replace it later.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { COLORS, SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { TITLE, TITLE_NOTE } from "../data/placeholders";
import { drawText, measureText } from "../ui/font";
import { MainMenuScene } from "./mainMenu";

const SKY = ["#1b2440", "#22305a", "#2b3d70", "#354b86", "#40599a"];

export class TitleScene implements Scene {
  update(game: Game) {
    if (game.input.pressed("start") || game.input.pressed("a")) game.switchTo(new MainMenuScene());
  }

  draw(ctx: CanvasRenderingContext2D, game: Game) {
    // Banded sky.
    const band = Math.ceil(SCREEN_HEIGHT / SKY.length);
    SKY.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * band, SCREEN_WIDTH, band);
    });
    // Two rows of plain hills that drift slowly sideways.
    hills(ctx, game.time * 4, 112, 14, "#26304e");
    hills(ctx, game.time * 9, 126, 10, "#1a2138");

    const scale = 2;
    centred(ctx, TITLE, 40, { color: COLORS.white, shadow: "#10162a", scale });
    centred(ctx, TITLE_NOTE, 62, { color: COLORS.frameLight, shadow: null });
    if (Math.floor(game.time * 1.6) % 2 === 0) centred(ctx, "PRESS START", 136, { color: COLORS.white, shadow: "#10162a" });
  }
}

function centred(ctx: CanvasRenderingContext2D, text: string, y: number, style: Parameters<typeof drawText>[4]) {
  drawText(ctx, text, Math.round((SCREEN_WIDTH - measureText(text, style?.scale)) / 2), y, style);
}

function hills(ctx: CanvasRenderingContext2D, offset: number, base: number, height: number, color: string) {
  ctx.fillStyle = color;
  for (let x = 0; x < SCREEN_WIDTH; x++) {
    const y = base - Math.round(height * (0.5 + 0.5 * Math.sin((x + offset) / 23) * Math.cos((x + offset) / 41)));
    ctx.fillRect(x, y, 1, SCREEN_HEIGHT - y);
  }
}
