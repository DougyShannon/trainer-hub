// Meeting a wild Pokémon in the tall grass. The screen flashes, the battle scene appears and the
// Pokémon slides in. For now the player can only RUN: catching (Stage 4) and battling (Stage 5)
// are still to come, and the other choices say so.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { COLORS, SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { BATTLE_NOT_READY, GOT_AWAY, WHAT_WILL_YOU_DO, WILD_APPEARED } from "../data/placeholders";
import type { Species } from "../data/pokemon";
import { drawText, measureText } from "../ui/font";
import { MessageScene, drawMessageBox } from "../ui/textbox";
import { drawCursor, drawWindow } from "../ui/window";

const CHOICES = ["FIGHT", "BAG", "POKEMON", "RUN"];
/** Seconds the Pokémon takes to slide in. */
const SLIDE_TIME = 0.6;
/** Where the wild Pokémon stands (the middle of its platform). */
const FOE_X = 176;
const FOE_Y = 70;

const images = new Map<string, HTMLImageElement>();
function picture(src: string) {
  let image = images.get(src);
  if (!image) {
    image = new Image();
    image.src = src;
    images.set(src, image);
  }
  return image;
}

export class WildEncounterScene implements Scene {
  private time = 0;
  private cursor = 0;
  private image: HTMLImageElement;
  /** Waiting for the "appeared" message to be read before showing the choices. */
  private introduced = false;

  constructor(
    private species: Species,
    private level: number,
  ) {
    this.image = picture(species.sprite);
  }

  update(game: Game, dt: number) {
    this.time += dt;
    if (this.time < SLIDE_TIME) return;
    if (!this.introduced) {
      this.introduced = true;
      game.push(new MessageScene(WILD_APPEARED.replace("{POKEMON}", this.species.name)));
      return;
    }
    const input = game.input;
    // Two by two, like the GBA: FIGHT BAG / POKEMON RUN.
    if (input.repeated("left") || input.repeated("right")) this.cursor ^= 1;
    if (input.repeated("up") || input.repeated("down")) this.cursor ^= 2;
    if (!input.pressed("a") && !input.pressed("start")) return;
    const choice = CHOICES[this.cursor];
    if (choice !== "RUN") return game.push(new MessageScene(BATTLE_NOT_READY[choice]));
    game.push(
      new MessageScene(GOT_AWAY, (g) =>
        g.fadeOut(() => {
          g.pop();
          g.fadeIn();
        }),
      ),
    );
  }

  draw(ctx: CanvasRenderingContext2D, game: Game) {
    drawBackground(ctx);
    // The Pokémon slides in from the left onto its platform.
    const slide = Math.min(1, this.time / SLIDE_TIME);
    const x = Math.round(FOE_X - 32 - (1 - slide) * 200);
    if (this.image.complete && this.image.naturalWidth) ctx.drawImage(this.image, x, FOE_Y - 54);
    if (slide >= 1) this.drawInfo(ctx);
    if (!this.introduced) return;
    const name = game.save?.player.name ?? "PLAYER";
    drawMessageBox(ctx, [WHAT_WILL_YOU_DO.replace("{PLAYER}", name)]);
    drawWindow(ctx, 128, SCREEN_HEIGHT - 44, SCREEN_WIDTH - 128, 44);
    CHOICES.forEach((label, i) => {
      const cx = 144 + (i % 2) * 48;
      const cy = SCREEN_HEIGHT - 35 + Math.floor(i / 2) * 15;
      drawText(ctx, label, cx, cy);
      if (i === this.cursor) drawCursor(ctx, cx - 8, cy);
    });
  }

  /** The box with the wild Pokémon's name, level and HP bar (top left, as on the GBA). */
  private drawInfo(ctx: CanvasRenderingContext2D) {
    drawWindow(ctx, 8, 10, 104, 34);
    drawText(ctx, this.species.name, 16, 16);
    const level = `Lv${this.level}`;
    drawText(ctx, level, 104 - measureText(level), 16);
    drawText(ctx, "HP", 16, 30, { color: COLORS.dim, shadow: null });
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(32, 30, 70, 6);
    ctx.fillStyle = "#58d080";
    ctx.fillRect(33, 31, 68, 4);
  }
}

/** A grassy field with a platform under the wild Pokémon and one for the player's side. */
function drawBackground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#c8f0d8";
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  ctx.fillStyle = "#b0e4c0";
  ctx.fillRect(0, 44, SCREEN_WIDTH, 40);
  ctx.fillStyle = "#98d8a8";
  ctx.fillRect(0, 84, SCREEN_WIDTH, SCREEN_HEIGHT - 84);
  platform(ctx, FOE_X, FOE_Y, 46, 10);
  platform(ctx, 56, 112, 54, 11);
}

function platform(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  ctx.fillStyle = "#68a868";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#88c878";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 2, rx - 4, ry - 3, 0, 0, Math.PI * 2);
  ctx.fill();
}
