// Deck-building rules, shared by the deck builder (to show problems as you build)
// and the server (so a saved deck's "legal" badge can be trusted).
//
// Based on the Pokémon TCG rulebook:
//   - exactly 60 cards
//   - no more than 4 copies of a card with the same name, except basic Energy
//   - at least 1 Basic Pokémon
//   - no more than 1 ACE SPEC card and no more than 1 Radiant Pokémon
//   - no more than 1 copy of each Prism Star card
//   - Standard and Expanded decks may only use cards legal in that format

export type DeckFormat = "standard" | "expanded" | "unlimited";

export const FORMAT_LABELS: Record<DeckFormat, string> = {
  standard: "Standard",
  expanded: "Expanded",
  unlimited: "Unlimited",
};

export const DECK_SIZE = 60;
export const MAX_COPIES = 4;

export type RuleCard = {
  id: string;
  name: string;
  supertype: string;
  subtypes: string[];
  legal: { standard: boolean; expanded: boolean };
};

export type DeckEntry = { card: RuleCard; count: number };

export type DeckProblem = { rule: string; message: string; cardIds?: string[] };

export const isBasicEnergy = (c: RuleCard) => c.supertype === "Energy" && c.subtypes.includes("Basic");
export const isBasicPokemon = (c: RuleCard) => c.supertype === "Pokémon" && c.subtypes.includes("Basic");

export function checkDeck(entries: DeckEntry[], format: DeckFormat): DeckProblem[] {
  const problems: DeckProblem[] = [];
  const total = entries.reduce((n, e) => n + e.count, 0);

  if (total !== DECK_SIZE) {
    problems.push({
      rule: "size",
      message:
        total < DECK_SIZE
          ? `Your deck has ${total} cards. Add ${DECK_SIZE - total} more to reach ${DECK_SIZE}.`
          : `Your deck has ${total} cards. Remove ${total - DECK_SIZE} to get down to ${DECK_SIZE}.`,
    });
  }

  // Copies are counted by name across all printings, so 2 + 2 different "Arven" cards is 4.
  const byName = new Map<string, DeckEntry[]>();
  for (const e of entries) {
    if (isBasicEnergy(e.card)) continue;
    const list = byName.get(e.card.name) ?? [];
    list.push(e);
    byName.set(e.card.name, list);
  }
  for (const [name, list] of byName) {
    const copies = list.reduce((n, e) => n + e.count, 0);
    const isPrismStar = list.some((e) => e.card.subtypes.includes("Prism Star"));
    const limit = isPrismStar ? 1 : MAX_COPIES;
    if (copies > limit) {
      problems.push({
        rule: "copies",
        message: `You have ${copies} copies of ${name}. The limit is ${limit}${isPrismStar ? " for Prism Star cards" : ""}.`,
        cardIds: list.map((e) => e.card.id),
      });
    }
  }

  if (total > 0 && !entries.some((e) => isBasicPokemon(e.card))) {
    problems.push({ rule: "basic", message: "Your deck needs at least one Basic Pokémon to start the game." });
  }

  const limitedOne = (subtype: string, label: string) => {
    const matches = entries.filter((e) => e.card.subtypes.includes(subtype));
    const n = matches.reduce((sum, e) => sum + e.count, 0);
    if (n > 1) {
      problems.push({
        rule: subtype,
        message: `You have ${n} ${label} cards. A deck can only have 1.`,
        cardIds: matches.map((e) => e.card.id),
      });
    }
  };
  limitedOne("ACE SPEC", "ACE SPEC");
  limitedOne("Radiant", "Radiant Pokémon");

  if (format !== "unlimited") {
    const illegal = entries.filter((e) => !e.card.legal[format]);
    if (illegal.length) {
      const names = [...new Set(illegal.map((e) => e.card.name))];
      problems.push({
        rule: "format",
        message: `${names.length === 1 ? names[0] + " is" : names.length + " cards are"} not legal in ${FORMAT_LABELS[format]}${
          names.length > 1 ? `: ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}` : ""
        }.`,
        cardIds: illegal.map((e) => e.card.id),
      });
    }
  }

  return problems;
}

/** Chance (0 to 1) of at least one Basic Pokémon in a 7-card opening hand. */
export function openingBasicChance(deckSize: number, basics: number, handSize = 7): number {
  if (deckSize < handSize || basics <= 0) return 0;
  let noBasic = 1;
  for (let i = 0; i < handSize; i++) noBasic *= (deckSize - basics - i) / (deckSize - i);
  return 1 - Math.max(0, noBasic);
}

// TCG Live writes Energy as "Basic {R} Energy"; these letters map to our Energy types.
export const ENERGY_LETTERS: Record<string, string> = {
  G: "Grass", R: "Fire", W: "Water", L: "Lightning", P: "Psychic", F: "Fighting",
  D: "Darkness", M: "Metal", Y: "Fairy", N: "Dragon", C: "Colorless",
};

export type ParsedLine = { count: number; name: string; setCode: string | null; number: string | null; line: string };

/**
 * Reads a deck list in the Pokémon TCG Live format, e.g.
 *   Pokémon: 12
 *   4 Charmander PAF 7
 *   Energy: 8
 *   8 Basic {R} Energy SVE 2
 * Section headers and blank lines are skipped. Lines without a set code are still accepted.
 */
export function parseDeckList(text: string): { lines: ParsedLine[]; unreadable: string[] } {
  const lines: ParsedLine[] = [];
  const unreadable: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^\*\s*/, "");
    if (!line || /^(pok[eé]mon|trainer|energy|total cards)\b.*:?\s*\d*$/i.test(line)) continue;
    const withSet = line.match(/^(\d+)x?\s+(.+?)\s+([A-Z0-9]{2,6}(?:-[A-Z0-9]+)?)\s+([A-Za-z]*\d+[A-Za-z]*)$/);
    if (withSet) {
      lines.push({ count: +withSet[1], name: withSet[2], setCode: withSet[3], number: withSet[4], line });
      continue;
    }
    const nameOnly = line.match(/^(\d+)x?\s+(.+)$/);
    if (nameOnly) {
      lines.push({ count: +nameOnly[1], name: nameOnly[2], setCode: null, number: null, line });
      continue;
    }
    unreadable.push(line);
  }
  return { lines, unreadable };
}

/** Normalises TCG Live's "Basic {R} Energy" to "Basic Fire Energy". */
export function normaliseCardName(name: string): string {
  return name.replace(/\{([A-Z])\}/g, (m, letter: string) => ENERGY_LETTERS[letter] ?? m).replace(/\s+/g, " ").trim();
}
