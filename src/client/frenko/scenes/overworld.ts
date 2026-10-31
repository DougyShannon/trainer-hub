// Walking around a map: the player in the middle of the screen, the world scrolling around them.
// A reads the sign or talks to the person in front of you; Start opens the menu. Doors fade to the
// map inside, and walking off a joined edge carries straight on into the next map.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH, TILE } from "../engine/screen";
import { drawText, measureText } from "../ui/font";
import { askChoice } from "../ui/menu";
import { MessageScene } from "../ui/textbox";
import { GROWING, PLANT_QUESTION, PLANTED, PUZZLE_SOLVED, PUZZLE_WRONG } from "../data/placeholders";
import { hedge } from "../world/tiles";
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
  /** Seeds planted in puzzle plots this visit ("x,y" to seed number). They reset on leaving. */
  private planted = new Map<string, number>();

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
    this.planted.clear();
    this.map.flags = game.save?.flags ?? {};
    if (this.map.data.indoor || this.map.data.name === this.bannerName) return;
    this.bannerName = this.map.data.name;
    this.bannerAt = game.time;
  }

  private fill(game: Game, line: string) {
    return line.replaceAll("{PLAYER}", game.save?.player.name ?? "PLAYER");
  }

  private say(game: Game, text: string[], then?: (game: Game) => void) {
    game.push(new MessageScene(text.map((line) => this.fill(game, line)), then));
  }

  /** A on a puzzle plot: pick a seed to plant, then check whether every plot is right. */
  private plant(game: Game, plot: { x: number; y: number }) {
    const puzzle = this.map.data.seedPuzzle!;
    const solved = !!game.save?.flags[puzzle.flag];
    const key = `${plot.x},${plot.y}`;
    if (solved) {
      const right = puzzle.plots.find((p) => p.x === plot.x && p.y === plot.y)!;
      return this.say(game, [GROWING.replace("{SEED}", puzzle.seeds[right.seed].name)]);
    }
    askChoice(game, this.fill(game, PLANT_QUESTION), puzzle.seeds.map((s) => s.name), (picked, g) => {
      if (picked === null) return;
      this.planted.set(key, picked);
      const done = puzzle.plots.every((p) => this.planted.has(`${p.x},${p.y}`));
      const right = puzzle.plots.every((p) => this.planted.get(`${p.x},${p.y}`) === p.seed);
      const message = [PLANTED.replace("{SEED}", puzzle.seeds[picked].name)];
      if (done && right && g.save) {
        g.save.flags[puzzle.flag] = true;
        this.map.flags = g.save.flags;
      }
      this.say(g, done ? [...message, ...(right ? PUZZLE_SOLVED : PUZZLE_WRONG)] : message);
    });
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
      const plot = this.map.plotAt(ahead.x, ahead.y);
      if (plot) return this.plant(game, plot);
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
      for (const gate of this.map.data.gates ?? []) {
        if (gate.y === row && this.map.closedGateAt(gate.x, gate.y)) hedge(ctx, gate.x * TILE - camX, row * TILE - camY, gate.x, row, game.time);
      }
      const puzzle = this.map.data.seedPuzzle;
      for (const plot of puzzle?.plots ?? []) {
        if (plot.y !== row) continue;
        const seed = game.save?.flags[puzzle!.flag] ? plot.seed : this.planted.get(`${plot.x},${plot.y}`);
        drawPlot(ctx, plot.x * TILE - camX, row * TILE - camY, seed === undefined ? null : puzzle!.seeds[seed].color);
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

/** A fertiliser plot: a raised bed of dark soil, with a little sprout once something is planted. */
function drawPlot(ctx: CanvasRenderingContext2D, x: number, y: number, sprout: string | null) {
  ctx.fillStyle = "#6a4020";
  ctx.fillRect(x + 1, y + 2, 14, 13);
  ctx.fillStyle = "#3e2614";
  ctx.fillRect(x + 2, y + 3, 12, 10);
  ctx.fillStyle = "#4e3018";
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 3 + i * 4, y + 5 + (i % 2) * 3, 2, 1);
  if (!sprout) return;
  ctx.fillStyle = "#3a8a3e";
  ctx.fillRect(x + 7, y + 3, 2, 8);
  ctx.fillRect(x + 4, y + 5, 3, 2);
  ctx.fillRect(x + 9, y + 4, 3, 2);
  ctx.fillStyle = sprout;
  ctx.fillRect(x + 6, y + 1, 4, 3);
}
