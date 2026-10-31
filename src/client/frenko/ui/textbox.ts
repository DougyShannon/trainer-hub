// The message box along the bottom of the screen. Text types itself out letter by letter, two lines
// at a time. A finishes the line or moves on to the next two; after the last, the box closes.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { TEXT_SPEEDS } from "../save/options";
import { drawText, LINE_HEIGHT, wrapText } from "./font";
import { drawMoreArrow, drawWindow } from "./window";

const BOX_HEIGHT = 44;
const PAD_X = 10;
const PAD_Y = 9;
const LINES_PER_PAGE = 2;

export class MessageScene implements Scene {
  overlay = true;
  private pages: string[][] = [];
  private page = 0;
  private shown = 0; // letters typed out on this page so far

  /**
   * `messages` are shown one after another; each one starts on a fresh box. `then` runs after the
   * box closes. With `waitAtEnd` false the box hands over as soon as the last line has typed out,
   * without waiting for A (used for questions, so YES / NO appears straight away).
   */
  constructor(
    messages: string | string[],
    private then?: (game: Game) => void,
    private waitAtEnd = true,
  ) {
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      const lines = wrapText(message, SCREEN_WIDTH - PAD_X * 2 - 8);
      for (let i = 0; i < lines.length; i += LINES_PER_PAGE) this.pages.push(lines.slice(i, i + LINES_PER_PAGE));
    }
  }

  private get pageLength() {
    return this.pages[this.page].join("").length;
  }

  update(game: Game, dt: number) {
    const typing = this.shown < this.pageLength;
    if (typing) this.shown = Math.min(this.pageLength, this.shown + dt * TEXT_SPEEDS[game.options.textSpeed]);
    const lastPage = this.page === this.pages.length - 1;
    if (!this.waitAtEnd && lastPage && this.shown >= this.pageLength) return this.close(game);
    if (!game.input.pressed("a") && !game.input.pressed("b")) return;
    if (typing) {
      this.shown = this.pageLength;
    } else if (this.page < this.pages.length - 1) {
      this.page++;
      this.shown = 0;
    } else {
      this.close(game);
    }
  }

  private close(game: Game) {
    game.pop();
    this.then?.(game);
  }

  draw(ctx: CanvasRenderingContext2D, game: Game) {
    drawMessageBox(ctx, this.pages[this.page], Math.floor(this.shown));
    if (this.shown >= this.pageLength) drawMoreArrow(ctx, SCREEN_WIDTH - 16, SCREEN_HEIGHT - 14, game.time);
  }
}

/** The message box with `lines` in it, typed out as far as `letters` (all of them if left out). */
export function drawMessageBox(ctx: CanvasRenderingContext2D, lines: string[], letters = Infinity) {
  const top = SCREEN_HEIGHT - BOX_HEIGHT;
  drawWindow(ctx, 0, top, SCREEN_WIDTH, BOX_HEIGHT);
  let left = letters;
  lines.forEach((line, i) => {
    drawText(ctx, line.slice(0, Math.max(0, left)), PAD_X, top + PAD_Y + i * (LINE_HEIGHT + 2));
    left -= line.length;
  });
}

/** The last two lines of `message`, as they are left showing once it has typed out. */
export function lastLines(message: string): string[] {
  return wrapText(message, SCREEN_WIDTH - PAD_X * 2 - 8).slice(-LINES_PER_PAGE);
}
