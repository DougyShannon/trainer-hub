// One battle against the computer, run entirely in the browser with Pokémon Showdown's simulator.
// The player is always "p1"; the computer is "p2". The page reads `lines` (the battle log from the
// player's point of view) and `request` (what the player has to choose next).

import { Battle, Teams, TeamValidator } from "@pkmn/sim";
import { installTracer, type Calc } from "./trace";
import { chooseFor } from "./ai";
import type { AiSkill } from "../../shared/battle/opponents";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sim = any;

export type Side = { name: string; team: string | object[] };

export type SessionSetup = {
  formatid: string;
  p1: Side;
  p2: Side;
  skill: AiSkill;
};

/** What the player can do right now, straight from the simulator. */
export type Request = {
  wait?: boolean;
  teamPreview?: boolean;
  maxChosenTeamSize?: number;
  forceSwitch?: boolean[];
  active?: {
    moves: { move: string; id: string; pp: number; maxpp: number; target: string; disabled?: boolean | string }[];
    trapped?: boolean;
    maybeTrapped?: boolean;
    canTerastallize?: string;
  }[];
  side: {
    name: string;
    id: string;
    pokemon: {
      ident: string;
      details: string;
      condition: string;
      active: boolean;
      stats: Record<string, number>;
      moves: string[];
      baseAbility: string;
      ability?: string;
      item: string;
      teraType?: string;
      terastallized?: string;
      reviving?: boolean;
    }[];
  };
  rqid?: number;
  noCancel?: boolean;
};

export class BattleSession {
  readonly battle: Sim;
  readonly calcs: Calc[] = [];
  /** Log lines from the player's side of the screen (hidden info for the computer's side stays hidden). */
  readonly lines: string[] = [];
  request: Request | null = null;
  error: string | null = null;
  private replaying = false;
  private listeners = new Set<() => void>();

  private constructor(readonly setup: SessionSetup, replay?: string[]) {
    const start = replay?.find((l) => l.startsWith(">start "));
    const startOpts = start ? JSON.parse(start.slice(7)) : { formatid: setup.formatid };
    this.battle = new Battle({ ...startOpts, send: (type: string, data: unknown) => this.receive(type, data) });
    installTracer(this.battle, (calc) => this.calcs.push(calc) - 1);
    if (replay) {
      this.replaying = true;
      for (const line of replay) this.replayLine(line);
      this.replaying = false;
    } else {
      this.battle.setPlayer("p1", { name: setup.p1.name, team: setup.p1.team });
      this.battle.setPlayer("p2", { name: setup.p2.name, team: setup.p2.team });
    }
    this.flush();
    this.computerTurn();
  }

  /** Starts a new battle. */
  static start(setup: SessionSetup) {
    return new BattleSession(setup);
  }

  /** Carries on a saved battle by replaying its choices (the same random seed gives the same battle). */
  static resume(setup: SessionSetup, inputLog: string[]) {
    return new BattleSession(setup, inputLog);
  }

  /** Everything needed to carry on later: the seed, teams and every choice so far. */
  get inputLog(): string[] {
    return [...this.battle.inputLog];
  }

  get ended(): boolean {
    return !!this.battle.ended;
  }

  /** "p1", "p2" or "" for a tie, once the battle is over. */
  get winner(): string | null {
    if (!this.battle.ended) return null;
    const w = this.battle.winner;
    if (!w) return "";
    return this.battle.sides.find((s: Sim) => s.name === w)?.id ?? "";
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** The player's choice, in Showdown's words: "move 1", "move 2 1 terastallize", "switch 3", "team 1234". */
  choose(choice: string): boolean {
    this.error = null;
    const ok = this.battle.choose("p1", choice);
    if (!ok) {
      this.error = this.battle.sides[0].choice.error || "That choice isn't allowed.";
      this.battle.sides[0].clearChoice();
    }
    this.flush();
    this.computerTurn();
    this.emit();
    return ok;
  }

  forfeit() {
    if (this.battle.ended) return;
    this.battle.forceWin("p2");
    this.flush();
    this.emit();
  }

  private replayLine(line: string) {
    const space = line.indexOf(" ");
    const cmd = line.slice(1, space);
    const rest = line.slice(space + 1);
    if (cmd === "player") {
      const slot = rest.slice(0, 2);
      this.battle.setPlayer(slot, JSON.parse(rest.slice(3)));
    } else if (cmd === "p1" || cmd === "p2") {
      this.battle.choose(cmd, rest);
    } else if (cmd === "forcewin") {
      this.battle.forceWin(rest);
    }
  }

  /** The computer chooses whenever it has a choice to make. */
  private computerTurn() {
    if (this.replaying) return;
    for (let guard = 0; guard < 20 && !this.battle.ended; guard++) {
      const side = this.battle.sides[1];
      const req = side.activeRequest;
      if (!req || req.wait || side.isChoiceDone()) break;
      let choice = "default";
      try {
        choice = chooseFor(this.battle, 1, req, this.setup.skill);
      } catch (e) {
        console.error("Computer player failed, using a default choice", e);
      }
      if (!this.battle.choose("p2", choice)) {
        side.clearChoice();
        this.battle.choose("p2", "default");
      }
      this.flush();
    }
  }

  private flush() {
    this.battle.sendUpdates();
  }

  private receive(type: string, data: unknown) {
    if (type === "update") {
      const lines = (Array.isArray(data) ? data.join("\n") : String(data)).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("|split|")) {
          // The next line is the private version, the one after the public one.
          const mine = line.slice(7) === "p1";
          this.lines.push(mine ? lines[i + 1] : lines[i + 2]);
          i += 2;
          continue;
        }
        this.lines.push(line);
      }
      this.emit();
    } else if (type === "sideupdate") {
      const text = String(data);
      const nl = text.indexOf("\n");
      const side = text.slice(0, nl);
      const msg = text.slice(nl + 1);
      if (side !== "p1") return;
      if (msg.startsWith("|request|")) {
        this.request = JSON.parse(msg.slice(9));
      } else if (msg.startsWith("|error|")) {
        this.error = msg.slice(7).replace(/^\[[^\]]+\]\s*/, "");
      }
      this.emit();
    }
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

/** Reads a Showdown text team. */
export const importTeam = (text: string) => Teams.import(text) ?? [];

/** Problems that stop a team being used in a format (empty when it's fine). */
export function checkTeam(formatid: string, team: object[]): string[] {
  try {
    return TeamValidator.get(formatid).validateTeam(team as never) ?? [];
  } catch (e) {
    return [(e as Error).message];
  }
}
