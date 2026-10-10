// Turns the simulator's battle log into what the battle screen shows: who is out, their HP,
// status and boosts, the weather and hazards, and the written log. It reads the log one line at a
// time, so the page can pause between lines and animate like the games do.
//
// @pkmn/client keeps track of the battle from the player's side (MIT licence) and @pkmn/view
// writes the same English messages Pokémon Showdown does (MIT licence).

import { Dex } from "@pkmn/sim";
import { Generations } from "@pkmn/data";
import { Battle as Client } from "@pkmn/client";
import { LogFormatter } from "@pkmn/view";
import { Protocol } from "@pkmn/protocol";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type LogEntry = {
  id: number;
  turn: number;
  text: string;
  kind: "turn" | "move" | "switch" | "faint" | "damage" | "heal" | "status" | "info" | "end";
  /** Damage and accuracy maths for this line (indexes into the session's calcs). */
  calcs: number[];
  /** What caused residual damage or healing, e.g. "brn", "Leftovers", "Stealth Rock". */
  from?: string;
};

export type Anim = {
  kind: "move" | "hit" | "faint" | "switch" | "heal" | "status" | "boost" | "unboost" | "miss" | "tera";
  /** Position like "p1a" or "p2b". */
  at: string;
  moveType?: string;
  category?: string;
};

const DELAY: Record<string, number> = {
  move: 850,
  "-damage": 650,
  "-heal": 450,
  switch: 750,
  drag: 750,
  replace: 400,
  faint: 850,
  "-status": 450,
  "-boost": 450,
  "-unboost": 450,
  "-weather": 550,
  "-fieldstart": 550,
  "-sidestart": 500,
  "-terastallize": 900,
  "-crit": 300,
  "-supereffective": 300,
  "-resisted": 300,
  "-miss": 450,
  turn: 250,
  win: 300,
};

let gens: Generations | null = null;

export class Viewer {
  readonly client: any;
  private formatter: LogFormatter;
  readonly entries: LogEntry[] = [];
  /** How many of the session's log lines have been shown. */
  pos = 0;
  turn = 0;
  private lastMove: LogEntry | null = null;

  constructor() {
    gens ??= new Generations(Dex as any);
    this.client = new Client(gens as any);
    this.formatter = new LogFormatter("p1", this.client);
  }

  /** Shows one log line. Returns how long to pause after it (at normal speed) and any animation. */
  step(line: string): { delay: number; anim?: Anim } {
    this.pos++;
    if (!line || line === "|") return { delay: 0 };
    if (line.startsWith("|th-calc|")) {
      const n = Number(line.slice(9));
      (this.lastMove ?? this.entries[this.entries.length - 1])?.calcs.push(n);
      return { delay: 0 };
    }
    if (line.startsWith("|t:|") || line.startsWith("|debug|") || line.startsWith("|raw|") || line.startsWith("|html|")) return { delay: 0 };
    let parsed: { args: any; kwArgs: any };
    try {
      parsed = Protocol.parseBattleLine(line) as any;
    } catch {
      return { delay: 0 };
    }
    const { args, kwArgs } = parsed;
    const cmd = args[0] as string;
    let text = "";
    try {
      text = this.formatter.formatText(args, kwArgs).trim();
    } catch {
      text = "";
    }
    try {
      this.client.add(args, kwArgs);
    } catch (e) {
      console.warn("Battle display skipped a line", line, e);
    }

    if (cmd === "turn") this.turn = Number(args[1]);
    const at = typeof args[1] === "string" ? args[1].slice(0, 3) : "";
    let anim: Anim | undefined;
    let kind: LogEntry["kind"] = "info";
    if (cmd === "move") {
      kind = "move";
      const move = Dex.moves.get(args[2]);
      anim = { kind: "move", at, moveType: move.type, category: move.category };
    } else if (cmd === "switch" || cmd === "drag" || cmd === "replace") {
      kind = "switch";
      anim = { kind: "switch", at };
    } else if (cmd === "faint") {
      kind = "faint";
      anim = { kind: "faint", at };
    } else if (cmd === "-damage") {
      kind = "damage";
      anim = { kind: "hit", at };
    } else if (cmd === "-heal") {
      kind = "heal";
      anim = { kind: "heal", at };
    } else if (cmd === "-status") {
      kind = "status";
      anim = { kind: "status", at };
    } else if (cmd === "-boost") anim = { kind: "boost", at };
    else if (cmd === "-unboost") anim = { kind: "unboost", at };
    else if (cmd === "-miss") anim = { kind: "miss", at: typeof args[2] === "string" ? args[2].slice(0, 3) : at };
    else if (cmd === "-terastallize") anim = { kind: "tera", at };
    else if (cmd === "turn") kind = "turn";
    else if (cmd === "win" || cmd === "tie") kind = "end";

    if (text) {
      const entry: LogEntry = { id: this.entries.length, turn: this.turn, text, kind, calcs: [] };
      if (kwArgs?.from) entry.from = String(kwArgs.from).replace(/^(item|ability|move):\s*/, "");
      this.entries.push(entry);
      if (kind === "move") this.lastMove = entry;
      if (kind === "turn") this.lastMove = null;
    }
    return { delay: text || anim ? (DELAY[cmd] ?? 350) : 0, anim };
  }
}

/** Showdown's sprite name for a species, e.g. "rotom-wash", "urshifu-rapidstrike". */
export function spriteId(species: string): string {
  const s = Dex.species.get(species);
  return s.exists ? s.spriteid : species.toLowerCase().replace(/[^a-z0-9-]+/g, "");
}
