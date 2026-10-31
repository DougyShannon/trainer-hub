// "Please wait" while the game talks to the website (loading or saving), then hands over the result.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { drawText, measureText } from "./font";
import { drawWindow } from "./window";

export class WaitScene<T> implements Scene {
  overlay = true;
  private result: { value: T } | { error: unknown } | null = null;

  constructor(
    private label: string,
    work: Promise<T>,
    private then: (result: { value: T } | { error: unknown }, game: Game) => void,
  ) {
    work.then(
      (value) => (this.result = { value }),
      (error: unknown) => (this.result = { error }),
    );
  }

  update(game: Game) {
    if (!this.result) return;
    game.pop();
    this.then(this.result, game);
  }

  draw(ctx: CanvasRenderingContext2D, game: Game) {
    const dots = ".".repeat(Math.floor(game.time * 3) % 4);
    const w = measureText(`${this.label}...`) + 24;
    drawWindow(ctx, (SCREEN_WIDTH - w) / 2, SCREEN_HEIGHT / 2 - 11, w, 22);
    drawText(ctx, this.label + dots, (SCREEN_WIDTH - w) / 2 + 12, SCREEN_HEIGHT / 2 - 4);
  }
}
