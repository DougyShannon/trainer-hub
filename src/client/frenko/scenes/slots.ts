// The list of 5 save slots, for CONTINUE (pick a game to load) and for the first SAVE of a new game
// (pick where to save it).

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { formatPlayTime, type SaveFile } from "../save/saveFile";
import { drawText } from "../ui/font";
import { Menu } from "../ui/menu";
import { drawWindow } from "../ui/window";

const TITLES = { load: "CONTINUE WHICH GAME?", save: "SAVE IN WHICH SLOT?" };

export class SlotsScene implements Scene {
  private menu: Menu;

  constructor(
    private slots: (SaveFile | null)[],
    private mode: "load" | "save",
    /** Called with the slot number (1 to 5) that was picked. The list has already closed. */
    private pick: (slot: number, game: Game) => void,
  ) {
    this.menu = new Menu(
      slots.map((save, i) => ({
        label: `${i + 1}  ${save ? save.player.name : "- EMPTY -"}`,
        value: save ? formatPlayTime(save.playSeconds) : undefined,
        disabled: !save && mode === "load",
      })),
      8,
      30,
      SCREEN_WIDTH - 16,
    );
    // Start on the first slot that makes sense: a saved game to load, or an empty slot to save in.
    const first = slots.findIndex((s) => (mode === "load" ? s : !s));
    this.menu.cursor = Math.max(0, first);
  }

  update(game: Game) {
    const picked = this.menu.update(game);
    if (picked === null) return;
    if (picked === "back") return game.pop();
    if (this.mode === "load" && !this.slots[picked]) return;
    game.pop();
    this.pick(picked + 1, game);
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#5868a0";
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    drawWindow(ctx, 8, 6, SCREEN_WIDTH - 16, 22);
    drawText(ctx, TITLES[this.mode], 18, 13);
    this.menu.draw(ctx);
    const save = this.slots[this.menu.cursor];
    const top = this.menu.y + this.menu.height + 4;
    drawWindow(ctx, 8, top, SCREEN_WIDTH - 16, 22);
    drawText(ctx, save ? `SAVED ${new Date(save.savedAt).toLocaleDateString()}` : "This slot is empty.", 18, top + 7);
  }
}
