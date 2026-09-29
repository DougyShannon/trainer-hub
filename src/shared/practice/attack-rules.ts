// Attack wording beyond the common patterns in attacks.ts. Each rule matches a sentence (or a few)
// of an attack's text; the matched words are used up so they aren't read again or reported as not
// automated. Rules run before the patterns in attacks.ts, so a rule can claim a whole compound
// sentence ("Flip 2 coins. If both are heads, ...") before a shorter pattern takes part of it.
//
// The rules themselves live in attack-rules-*.ts, grouped loosely by what they do.

import type { Seat } from "../game-types";
import type { Attack, PPlayer, PSlot, PState } from "./types";
import { rulesDamage, resumesDamage } from "./attack-rules-damage";
import { rulesEffects, resumesEffects } from "./attack-rules-effects";
import { rulesCards, resumesCards } from "./attack-rules-cards";
import { rulesMisc, resumesMisc } from "./attack-rules-misc";

/** What a rule can see and change while an attack is being worked out. */
export type AttackCtx = {
  state: PState;
  seat: Seat;
  oppSeat: Seat;
  p: PPlayer;
  opp: PPlayer;
  /** The attacking Pokémon (the player's Active Pokémon). */
  attacker: PSlot;
  /** The opponent's Active Pokémon when the attack started. */
  defender: PSlot;
  attack: Attack;
  /** The attack's text, with the Pokémon's own name read as "this Pokémon". */
  text: string;
  /** The damage to the opponent's Active Pokémon before Weakness, Resistance and other effects. Rules' `pre` may change it. */
  base: number;
  /** Set by `pre` to make the attack do nothing (no damage and no effects). */
  nothing: boolean;
  /** Set by `pre` when the damage isn't affected by Weakness and Resistance. */
  noWeakness: boolean;
  /** Set by `pre` to skip damage to the Active Pokémon (e.g. the damage goes somewhere else). Effects still happen. */
  skipDamage: boolean;
  /** Flips a coin (logged; Backtrack Badge and "every flip is tails" apply). The result is kept as the last flip. */
  coin(): boolean;
  /** Flips n coins and returns the number of heads (logged). */
  coins(n: number): number;
  /** Flips until tails and returns the number of heads (logged). */
  untilTails(): number;
  /** The result of the last coin flip in this attack, for "If heads," sentences after an earlier flip. */
  lastFlip(): boolean | null;
  /** In `post`: the damage done to the opponent's Active Pokémon. */
  damageDone: number;
  /** In `post`: effects of this attack can't touch the opponent's Active Pokémon (protection, Abilities, Mist Energy). */
  shielded: boolean;
  /** Anything a rule's `pre` wants to hand to a later rule's `post` (e.g. how many cards were discarded). */
  memo: Record<string, number | string | boolean | string[]>;
};

export type Resume = (state: PState, seat: Seat, picks: string[], data: Record<string, unknown>) => void;

export type AttackRule = {
  /** Matched against what's left of the attack text. Use `i` and match whole sentences, including the full stop. */
  re: RegExp;
  /** Before damage: change `base`, set `nothing`, flip coins, pay costs. */
  pre?: (ctx: AttackCtx, m: RegExpMatchArray) => void;
  /** After damage to the Active Pokémon: effects, extra damage elsewhere, choices (use ask with a `resumes` key). */
  post?: (ctx: AttackCtx, m: RegExpMatchArray) => void;
  /** Whether the attack can be used right now (null if it can). Checked when the player looks at the attack. */
  canUse?: (state: PState, seat: Seat, attack: Attack, m: RegExpMatchArray) => string | null;
};

let rules: AttackRule[] | null = null;
let resumes: Record<string, Resume> | null = null;
export function attackRules(): AttackRule[] {
  return (rules ??= [...rulesDamage(), ...rulesEffects(), ...rulesCards(), ...rulesMisc()]);
}
/** The resume for a choice an attack rule asked for (prompt effects start with "atk:"). */
export function attackRuleResume(effect: string): Resume | undefined {
  resumes ??= { ...resumesDamage(), ...resumesEffects(), ...resumesCards(), ...resumesMisc() };
  return resumes[effect];
}

const clean = (text: string) => text.replace(/\s*\([^)]*\)/g, "");

/** Why an attack's own wording stops it being used right now (from rules with `canUse`), or null. */
export function attackRuleCanUse(state: PState, seat: Seat, attack: Attack): string | null {
  const p = state.players[seat];
  const text = clean((attack.text ?? "").split(p.active ? p.active.pokemon[p.active.pokemon.length - 1].name : "\u0000").join("this Pokémon"));
  for (const rule of attackRules()) {
    if (!rule.canUse) continue;
    const m = text.match(rule.re);
    if (!m) continue;
    const why = rule.canUse(state, seat, attack, m);
    if (why) return why;
  }
  return null;
}
