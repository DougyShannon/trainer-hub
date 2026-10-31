// Walking around a map: the player in the middle of the screen, the world scrolling around them.
// A reads the sign in front of you; Start opens the menu.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH, TILE } from "../engine/screen";
import { drawText, measureText } from "../ui/font";
import { MessageScene } from "../ui/textbox";
import { drawWindow } from "../ui/window";
import { GameMap } from "../world/map";
import { FIRST_MAP, MAPS } from "../world/maps";
import { Player } from "../world/player";
import { StartMenuScene } from "./startMenu";

/** Where the player's square sits on screen: the middle, like the GBA games (15 × 10 squares). */
const PLAYER_SCREEN_X = (SCREEN_WIDTH - TILE) / 2;
const PLAYER_SCREEN_Y = (SCREEN_HEIGHT - TILE) / 2;
/** Seconds the place name stays up after arriving. */
const NAME_TIME = 2.5;
const HINT = "Arrow keys or WASD to walk";

export class OverworldScene implements Scene {
  private map: GameMap;
  private player: Player;
  /** Game time when the map first appeared (the banner keeps its own clock, even under menus). */
  private arrivedAt: number | null = null;
  private walked = false;

  /** `intro` is shown in the message box as soon as the map appears (used for New Game). */
  constructor(
    game: Game,
    private intro?: string[],
  ) {
    const location = game.save?.location;
    this.map = new GameMap(MAPS[location?.map ?? ""] ?? MAPS[FIRST_MAP]);
    const start = location && location.map === this.map.data.id && this.map.walkable(location.x, location.y) ? location : this.map.spawn;
    this.player = new Player(start);
  }

  update(game: Game, dt: number) {
    if (this.intro) {
      game.push(new MessageScene(this.intro));
      this.intro = undefined;
      return;
    }
    const input = game.input;
    this.player.update(input, this.map, dt);
    if (this.player.moving) this.walked = true;
    if (game.save) game.save.location = { map: this.map.data.id, x: this.player.x, y: this.player.y, facing: this.player.facing };
    if (this.player.moving) return;
    if (input.pressed("start")) game.push(new StartMenuScene());
    else if (input.pressed("a")) {
      const ahead = this.player.facingSquare();
      const sign = this.map.signAt(ahead.x, ahead.y);
      if (sign) game.push(new MessageScene(sign.text));
    }
  }

  draw(ctx: CanvasRenderingContext2D, game: Game) {
    const me = this.player.pixelPosition();
    // The camera: everything is shifted so the player stays in the middle.
    const camX = me.x - PLAYER_SCREEN_X;
    const camY = me.y - PLAYER_SCREEN_Y;
    const firstCol = Math.floor(camX / TILE);
    const firstRow = Math.floor(camY / TILE);
    const lastCol = firstCol + SCREEN_WIDTH / TILE + 1;
    // One extra row below, because tree tops reach up into the square above them.
    const lastRow = firstRow + SCREEN_HEIGHT / TILE + 2;

    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        this.map.tile(col, row).ground(ctx, col * TILE - camX, row * TILE - camY, col, row, game.time);
      }
    }
    // Objects and the player, top of the screen first, so nearer things cover farther ones.
    let playerDrawn = false;
    for (let row = firstRow; row <= lastRow; row++) {
      if (!playerDrawn && row * TILE > me.y) {
        this.player.draw(ctx, PLAYER_SCREEN_X, PLAYER_SCREEN_Y);
        playerDrawn = true;
      }
      for (let col = firstCol; col <= lastCol; col++) {
        this.map.tile(col, row).object?.(ctx, col * TILE - camX, row * TILE - camY, col, row, game.time);
      }
    }

    this.arrivedAt ??= game.time;
    const since = game.time - this.arrivedAt;
    if (since < NAME_TIME) {
      // The place name slides down from the top, then back up.
      const slide = Math.min(1, since * 4, (NAME_TIME - since) * 4);
      const top = Math.round(-24 + 28 * slide);
      drawWindow(ctx, 4, top, measureText(this.map.data.name) + 24, 22);
      drawText(ctx, this.map.data.name, 16, top + 7);
    }
    if (!this.walked && since > NAME_TIME) {
      drawWindow(ctx, 4, SCREEN_HEIGHT - 26, measureText(HINT) + 24, 22);
      drawText(ctx, HINT, 16, SCREEN_HEIGHT - 19);
    }
  }
}
