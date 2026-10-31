// The Start menu that opens over the map. Pokédex, Pokémon and Bag are greyed out until the stages
// that build them; picking one says when it's coming.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { NOT_READY } from "../data/placeholders";
import { writeSave } from "../save/saveFile";
import { askYesNo, Menu } from "../ui/menu";
import { MessageScene } from "../ui/textbox";
import { OptionsScene } from "./options";

const ITEMS = [
  { id: "pokedex", label: "POKéDEX", disabled: true },
  { id: "pokemon", label: "POKéMON", disabled: true },
  { id: "bag", label: "BAG", disabled: true },
  { id: "save", label: "SAVE" },
  { id: "options", label: "OPTIONS" },
  { id: "exit", label: "EXIT" },
];

/** Where the cursor was last time, so the menu reopens on the same line (as in the GBA games). */
let lastCursor = 0;

export class StartMenuScene implements Scene {
  overlay = true;
  private menu = new Menu(ITEMS, 0, 2, 82);

  constructor() {
    this.menu.x = 240 - this.menu.width - 2;
    this.menu.cursor = lastCursor;
  }

  update(game: Game) {
    if (game.input.pressed("start")) return game.pop();
    const picked = this.menu.update(game);
    lastCursor = this.menu.cursor;
    if (picked === null) return;
    if (picked === "back") return game.pop();
    const id = ITEMS[picked].id;
    if (id in NOT_READY) game.push(new MessageScene(NOT_READY[id]));
    else if (id === "save") save(game);
    else if (id === "options") game.push(new OptionsScene());
    else game.pop();
  }

  draw(ctx: CanvasRenderingContext2D) {
    this.menu.draw(ctx);
  }
}

function save(game: Game) {
  askYesNo(game, "Would you like to save the game?", (yes, g) => {
    if (!yes || !g.save) return;
    const saved = writeSave(g.save);
    g.push(
      new MessageScene(
        saved
          ? "The game was saved on this device."
          : "Saving didn't work. This browser may be blocking storage, for example in a private window.",
      ),
    );
  });
}
