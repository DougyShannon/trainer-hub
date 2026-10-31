// Walking around a map: the player in the middle of the screen, the world scrolling around them.
// A reads the sign or talks to the person in front of you; Start opens the menu. Doors fade to the
// map inside, and walking off a joined edge carries straight on into the next map.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH, TILE } from "../engine/screen";
import { drawText, measureText } from "../ui/font";
import { MessageScene } from "../ui/textbox";
import { drawWindow } from "../ui/window";
import { personPicture } from "../art/people";
import { sprite } from "../art/pixels";
import { BUILDINGS } from "../art/buildings";
import type { Direction } from "../world/direction";
import type { GameMap, Spot } from "../world/map";
import { FIRST_MAP, loadMap } from "../world/maps";
import { Player } from "../world/player";
import { StartMenuScene } from "./startMenu";

/** Where the player's square sits on screen: the middle, like the GBA games (15 × 10 squares). */
const PLAYER_SCREEN_X = (SCREEN_WIDTH - TILE) / 2;
const PLAYER_SCREEN_Y = (SCREEN_HEIGHT - TILE) / 2;
/** Seconds the place name stays up after arriving. */
const NAME_TIME = 2.5;
const HINT = "Arrow keys or WASD to walk";

const FACING_BACK: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };

export class OverworldScene implements Scene {
  private map: GameMap;
  private player: Player;
  /** Game time when the place-name banner appeared, and which name it showed last. */
  private bannerAt: number | null = null;
  private bannerName = "";
  private startedAt: number | null = null;
  private walked = false;
  /** The square the player was on last frame, to notice arriving on a door. */
  private lastSquare = "";
  /** People who have turned to face the player while talking. */
  private turned = new Map<string, Direction>();

  /** `intro` is shown in the message box as soon as the map appears (used for New Game). */
  constructor(
    game: Game,
    private intro?: string[],
  ) {
    const location = game.save?.location;
    const saved = location && loadMap(location.map);
    this.map = saved ?? loadMap(FIRST_MAP)!;
    const start = saved && this.map.walkable(location.x, location.y) ? location : this.map.spawn;
    this.player = new Player(start, game.save?.player.gender);
    this.lastSquare = `${this.map.data.id}:${start.x},${start.y}`;
    this.arrive(game);
  }

  /** Shows the place name when arriving somewhere new outdoors (not on coming back out of a door). */
  private arrive(game: Game) {
    this.turned.clear();
    if (this.map.data.indoor || this.map.data.name === this.bannerName) return;
    this.bannerName = this.map.data.name;
    this.bannerAt = game.time;
  }

  private say(game: Game, text: string[]) {
    const name = game.save?.player.name ?? "PLAYER";
    game.push(new MessageScene(text.map((line) => line.replaceAll("{PLAYER}", name))));
  }

  update(game: Game, dt: number) {
    if (this.intro) {
      this.say(game, this.intro);
      this.intro = undefined;
      return;
    }
    const input = game.input;
    this.player.update(input, this.map, dt);
    if (this.player.moving) this.walked = true;
    this.checkSquare(game);
    if (game.save) game.save.location = { map: this.map.data.id, x: this.player.x, y: this.player.y, facing: this.player.facing };
    if (this.player.moving) return;
    if (input.pressed("start")) game.push(new StartMenuScene());
    else if (input.pressed("a")) {
      const ahead = this.player.facingSquare();
      const person = this.map.personAt(ahead.x, ahead.y);
      if (person) {
        this.turned.set(`${person.x},${person.y}`, FACING_BACK[this.player.facing]);
        return this.say(game, person.text);
      }
      const sign = this.map.signAt(ahead.x, ahead.y);
      if (sign) this.say(game, sign.text);
    }
  }

  /** After each step: walking off the edge into the next map, or onto a door. */
  private checkSquare(game: Game) {
    const square = `${this.map.data.id}:${this.player.x},${this.player.y}`;
    if (square === this.lastSquare) return;
    this.lastSquare = square;
    const across = this.map.across(this.player.x, this.player.y);
    if (across) {
      // Seamless: the next map was already showing past the edge, so just swap over.
      this.map = across.map;
      this.player.x = across.x;
      this.player.y = across.y;
      this.lastSquare = `${this.map.data.id}:${across.x},${across.y}`;
      return this.arrive(game);
    }
    const warp = this.map.warpAt(this.player.x, this.player.y);
    if (warp) this.goTo(game, warp.to);
  }

  private goTo(game: Game, to: Spot) {
    const map = loadMap(to.map);
    if (!map) return;
    game.fadeOut(() => {
      this.map = map;
      this.player = new Player(to, game.save?.player.gender);
      this.lastSquare = `${map.data.id}:${to.x},${to.y}`;
      this.arrive(game);
      game.fadeIn();
    });
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
      // Buildings are drawn with their bottom row, people with the square they stand on.
      for (const b of this.map.data.buildings ?? []) {
        const look = BUILDINGS[b.kind];
        if (b.y + look.height - 1 === row) look.draw(ctx, b.x * TILE - camX, b.y * TILE - camY, b.roof);
      }
      for (const p of this.map.data.people ?? []) {
        if (p.y !== row) continue;
        const pic = personPicture(p.look, this.turned.get(`${p.x},${p.y}`) ?? p.facing);
        const image = sprite(pic.key, pic.rows, pic.palette, pic.flip);
        ctx.drawImage(image, p.x * TILE - camX, (p.y + 1) * TILE - image.height - camY);
      }
    }
    if (!playerDrawn) this.player.draw(ctx, PLAYER_SCREEN_X, PLAYER_SCREEN_Y);
    // Things in front of everyone, like the tall grass round the player's feet.
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        this.map.tile(col, row).cover?.(ctx, col * TILE - camX, row * TILE - camY, col, row, game.time);
      }
    }

    const since = this.bannerAt === null ? Infinity : game.time - this.bannerAt;
    if (since < NAME_TIME) {
      // The place name slides down from the top, then back up.
      const slide = Math.min(1, since * 4, (NAME_TIME - since) * 4);
      const top = Math.round(-24 + 28 * slide);
      drawWindow(ctx, 4, top, measureText(this.map.data.name) + 24, 22);
      drawText(ctx, this.map.data.name, 16, top + 7);
    }
    this.startedAt ??= game.time;
    if (!this.walked && since > NAME_TIME && game.time - this.startedAt > NAME_TIME) {
      drawWindow(ctx, 4, SCREEN_HEIGHT - 26, measureText(HINT) + 24, 22);
      drawText(ctx, HINT, 16, SCREEN_HEIGHT - 19);
    }
  }
}
