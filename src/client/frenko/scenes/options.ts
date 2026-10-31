// The Options screen. Left and right change a setting; B or CANCEL goes back and keeps the changes.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { saveOptions, type TextSpeed } from "../save/options";
import { drawText } from "../ui/font";
import { Menu } from "../ui/menu";
import { drawWindow } from "../ui/window";

const SPEEDS: TextSpeed[] = ["slow", "mid", "fast"];
const SPEED_LABELS: Record<TextSpeed, string> = { slow: "SLOW", mid: "MID", fast: "FAST" };

export class OptionsScene implements Scene {
  private menu = new Menu([{ label: "TEXT SPEED" }, { label: "CANCEL" }], 8, 30, SCREEN_WIDTH - 16);

  update(game: Game) {
    const input = game.input;
    if (this.menu.cursor === 0 && (input.repeated("left") || input.repeated("right"))) {
      const step = input.repeated("right") ? 1 : SPEEDS.length - 1;
      game.options.textSpeed = SPEEDS[(SPEEDS.indexOf(game.options.textSpeed) + step) % SPEEDS.length];
      saveOptions(game.options);
    }
    const picked = this.menu.update(game);
    if (picked === "back" || picked === 1) game.pop();
  }

  draw(ctx: CanvasRenderingContext2D, game: Game) {
    ctx.fillStyle = "#5868a0";
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    drawWindow(ctx, 8, 6, SCREEN_WIDTH - 16, 22);
    drawText(ctx, "OPTIONS", 18, 13);
    this.menu.items[0].value = `< ${SPEED_LABELS[game.options.textSpeed]} >`;
    this.menu.draw(ctx);
  }
}
