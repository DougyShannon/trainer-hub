// Practice games against the computer run entirely in the browser with the rules enforced,
// unlike live games, where the table is manual. These are the shapes the rules engine uses.

import type { Condition, Seat } from "../game-types";

export type Attack = { name: string; cost: string[]; damage: string; text: string };

/** Everything the rules need to know about one physical card in a practice game. */
export type PCard = {
  uid: string;
  id: string;
  name: string;
  supertype: "Pokémon" | "Trainer" | "Energy";
  subtypes: string[];
  hp: number | null;
  types: string[];
  evolvesFrom: string | null;
  image: string | null;
  imageLarge: string | null;
  attacks: Attack[];
  abilities: { name: string; text: string; type: string }[];
  weaknesses: { type: string; value: string }[];
  resistances: { type: string; value: string }[];
  retreat: number;
  /** Rules text: a Trainer's effect, or "Pokémon ex" rules on a Pokémon. */
  rules: string[];
  /** For Stage 2 cards: the Basic Pokémon it ultimately evolves from (lets Rare Candy work). */
  candyFrom?: string | null;
};

/** A Pokémon in play. `pokemon` is the evolution stack; the last card is the current Pokémon. */
export type PSlot = {
  pokemon: PCard[];
  energy: PCard[];
  tool: PCard | null;
  damage: number;
  conditions: Condition[];
  /** Turn number this Pokémon was put into play or last evolved (it can't evolve again that turn). */
  playedTurn: number;
  /** Set by attacks like "During your next turn, this Pokémon can't attack." */
  cantAttackTurn: number | null;
  /** Other attack effects that last until a later turn, keyed by the turn they apply in. They end if it moves to the Bench or evolves. */
  effects: {
    cantRetreat?: number;
    /** Retreat Cost and attack costs are one Colorless more during this turn. */
    retreatTax?: number;
    attackTax?: number;
    /** Heavier Poison, e.g. 80 damage instead of 10 during Pokémon Checkup. */
    poisonDamage?: number;
    protect?: { turn: number; effects: boolean };
    guard?: { turn: number; amount: number };
    boost?: { turn: number; amount: number };
  };
};

export type PPlayer = {
  name: string;
  deck: PCard[]; // index 0 is the top
  hand: PCard[];
  prizes: PCard[];
  discard: PCard[];
  active: PSlot | null;
  bench: PSlot[];
  mulligans: number;
  // Once-per-turn limits, reset at the start of each turn.
  energyAttached: boolean;
  supporterPlayed: boolean;
  retreated: boolean;
  stadiumPlayed: boolean;
};

/** Where a choice's options come from. */
export type PickZone = "deck" | "hand" | "discard" | "myBench" | "oppBench" | "myPokemon" | "oppPokemon";

/**
 * A choice the engine is waiting on, e.g. "Choose a Basic Pokémon to put onto your Bench".
 * `options` are card uids (or slot keys like "bench:2" for Pokémon in play).
 */
export type Prompt = {
  seat: Seat;
  title: string;
  zone: PickZone;
  options: string[];
  /** Cards shown but not choosable (e.g. the rest of the deck while searching). */
  shown?: string[];
  min: number;
  max: number;
  /** Which effect asked, and anything it needs to carry on once the choice is made. */
  effect: string;
  data?: Record<string, unknown>;
};

export type PLog = { n: number; seat: Seat | null; text: string; kind?: "turn" | "attack" | "ko" | "coin" | "system" };

export type PStatus = "setup" | "playing" | "finished";

export type PState = {
  status: PStatus;
  players: Record<Seat, PPlayer>;
  stadium: { card: PCard; owner: Seat } | null;
  turn: number; // counts both players' turns, starting at 1
  current: Seat;
  first: Seat;
  prompt: Prompt | null;
  /** Choices waiting behind the current one (an attack can ask for more than one). */
  queue: Prompt[];
  winner: Seat | null;
  endReason: string | null;
  log: PLog[];
  /** Setup is done by each player choosing an Active and Bench from their opening hand. */
  setupDone: Record<Seat, boolean>;
  /** After an attack, the turn ends once any choices it caused (like promoting a Pokémon) are made. */
  pendingEnd: boolean;
};

export type SlotKey = "active" | `bench:${number}`;

export type PAction =
  | { type: "setup"; active: string; bench: string[] }
  | { type: "playBasic"; uid: string }
  | { type: "evolve"; uid: string; slot: SlotKey }
  | { type: "attachEnergy"; uid: string; slot: SlotKey }
  | { type: "attachTool"; uid: string; slot: SlotKey }
  | { type: "playTrainer"; uid: string }
  | { type: "retreat"; bench: number }
  | { type: "attack"; index: number }
  | { type: "choose"; picks: string[] }
  | { type: "endTurn" }
  | { type: "concede" };
