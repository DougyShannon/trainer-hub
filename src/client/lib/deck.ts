import type { CardSummary, DeckEntry } from "./api";
import { isBasicPokemon } from "../../shared/deck-rules";

export const SECTIONS = ["Pokémon", "Trainer", "Energy"] as const;

const sectionOf = (c: CardSummary) => (SECTIONS as readonly string[]).includes(c.supertype) ? c.supertype : "Trainer";

/** Splits a deck into Pokémon, Trainer and Energy, sorted the way players usually list them. */
export function groupEntries(entries: DeckEntry[]) {
  const groups = Object.fromEntries(SECTIONS.map((s) => [s, [] as DeckEntry[]])) as Record<(typeof SECTIONS)[number], DeckEntry[]>;
  for (const e of entries) groups[sectionOf(e.card) as (typeof SECTIONS)[number]].push(e);
  const trainerOrder = ["Supporter", "Item", "Pokémon Tool", "Stadium"];
  const rank = (c: CardSummary) => {
    const i = trainerOrder.findIndex((t) => c.subtypes.includes(t));
    return i === -1 ? trainerOrder.length : i;
  };
  groups["Pokémon"].sort((a, b) => b.count - a.count || a.card.name.localeCompare(b.card.name));
  groups.Trainer.sort((a, b) => rank(a.card) - rank(b.card) || b.count - a.count || a.card.name.localeCompare(b.card.name));
  groups.Energy.sort((a, b) => b.count - a.count || a.card.name.localeCompare(b.card.name));
  return groups;
}

export const countOf = (entries: DeckEntry[]) => entries.reduce((n, e) => n + e.count, 0);
export const basicCount = (entries: DeckEntry[]) => countOf(entries.filter((e) => isBasicPokemon(e.card)));

const TYPE_LETTER: Record<string, string> = {
  Grass: "G", Fire: "R", Water: "W", Lightning: "L", Psychic: "P", Fighting: "F", Darkness: "D", Metal: "M", Fairy: "Y",
};

/** Writes the deck in the Pokémon TCG Live format so it can be pasted into TCG Live, Limitless and other sites. */
export function exportDeck(entries: DeckEntry[]) {
  const groups = groupEntries(entries);
  const lines: string[] = [];
  for (const section of SECTIONS) {
    const list = groups[section];
    if (!list.length) continue;
    lines.push(`${section}: ${countOf(list)}`);
    for (const { card, count } of list) {
      const basicEnergy = card.name.match(/^(?:Basic )?(\w+) Energy$/);
      const name =
        section === "Energy" && card.subtypes.includes("Basic") && basicEnergy && TYPE_LETTER[basicEnergy[1]]
          ? `Basic {${TYPE_LETTER[basicEnergy[1]]}} Energy`
          : card.name;
      lines.push(`${count} ${name}${card.setCode ? ` ${card.setCode} ${card.number}` : ""}`);
    }
    lines.push("");
  }
  lines.push(`Total Cards: ${countOf(entries)}`);
  return lines.join("\n");
}

/** Shuffles the deck and deals a 7-card opening hand. */
export function drawHand(entries: DeckEntry[], size = 7): CardSummary[] {
  const pile = entries.flatMap((e) => Array.from({ length: e.count }, () => e.card));
  for (let i = pile.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pile[i], pile[j]] = [pile[j], pile[i]];
  }
  return pile.slice(0, size);
}
