// The Start menu that opens over the map. Pokédex, Pokémon and Bag are greyed out until the stages
// that build them; picking one says when it's coming.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { NOT_READY } from "../data/placeholders";
import { loadSlots, writeSlot } from "../save/saveFile";
import { askYesNo, Menu } from "../ui/menu";
import { MessageScene } from "../ui/textbox";
import { WaitScene } from "../ui/wait";
import { OptionsScene } from "./options";
import { SlotsScene } from "./slots";

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

const SIGN_IN_TO_SAVE = [
  "You need to be signed in to Trainer Hub to save.",
  "Sign in with the link above the game (it opens a new tab), then SAVE again.",
];
const SAVE_FAILED = "Saving didn't work. Check your internet connection and try again.";

/**
 * SAVE: a game that already has a slot saves straight back into it. A new game first asks which of
 * the 5 slots to use (and checks before saving over another game).
 */
function save(game: Game) {
  if (!game.save) return;
  if (game.saveSlot) {
    const slot = game.saveSlot;
    return askYesNo(game, "Would you like to save the game?", (yes, g) => yes && writeTo(g, slot));
  }
  game.push(
    new WaitScene("LOADING", loadSlots(), (result, g) => {
      if ("error" in result) return g.push(new MessageScene(SAVE_FAILED));
      const slots = result.value;
      if (!slots.signedIn) return g.push(new MessageScene(SIGN_IN_TO_SAVE));
      g.push(
        new SlotsScene(slots.slots, "save", (slot, g2) => {
          const there = slots.slots[slot - 1];
          if (!there) return writeTo(g2, slot);
          askYesNo(g2, `Slot ${slot} has ${there.player.name}'s game in it. Save over it?`, (yes, g3) => yes && writeTo(g3, slot));
        }),
      );
    }),
  );
}

function writeTo(game: Game, slot: number) {
  if (!game.save) return;
  const name = game.save.player.name;
  game.push(
    new WaitScene("SAVING", writeSlot(slot, game.save), (result, g) => {
      const outcome = "value" in result ? result.value : "failed";
      if (outcome === "signed-out") return g.push(new MessageScene(SIGN_IN_TO_SAVE));
      if (outcome === "failed") return g.push(new MessageScene(SAVE_FAILED));
      g.saveSlot = slot;
      // Back to walking around once the message is read, as in the GBA games.
      g.push(new MessageScene(`${name} saved the game in slot ${slot}.`, (after) => after.pop()));
    }),
  );
}
