// The practice ladder: Kanto's eight Gym Leaders, then the Elite Four and the Champion at
// Indigo Plateau. Each plays a deck themed on their type, built from the Pokémon Trainer
// cards the practice rules handle well. Later opponents have stronger decks and fewer mistakes.

import type { BotSkill } from "./bot";

export type DeckEntry = [id: string, count: number];

export type Opponent = {
  level: number;
  name: string;
  title: string;
  /** Battle venue the table is themed on (see shared/venues.ts). */
  venue: string;
  badge: string;
  /** National Pokédex number of their signature Pokémon, shown as their picture. */
  ace: number;
  deckName: string;
  blurb: string;
  skill: BotSkill;
  deck: DeckEntry[];
};

// Trainer cards shared by many decks.
const T = {
  nestBall: "sv1-181",
  ultraBall: "sv1-196",
  pokeBall: "sv1-185",
  poffin: "sv5-144",
  research: "sv8pt5-122",
  iono: "sv2-185",
  boss: "sv2-172",
  arven: "sv1-166",
  rareCandy: "sv1-191",
  switch: "sv1-194",
  potion: "sv1-188",
  energyRetrieval: "sv1-171",
  energySearch: "sv1-172",
  vitalityBand: "sv1-197",
  defianceBand: "sv1-169",
  heroCape: "sv5-152",
};
const E = {
  grass: "sve-1",
  fire: "sve-2",
  water: "sve-3",
  lightning: "sve-4",
  psychic: "sve-5",
  fighting: "sve-6",
  darkness: "sve-7",
};

export const OPPONENTS: Opponent[] = [
  {
    level: 1,
    name: "Brock",
    title: "Pewter City Gym Leader",
    venue: "pewter-city-gym",
    badge: "Boulder Badge",
    ace: 95,
    deckName: "Rock Solid",
    blurb: "Tough Rock and Ground Pokémon with simple attacks. A good first battle.",
    skill: { blunder: 0.45, smart: false, benchMax: 2 },
    deck: [
      ["sv3pt5-74", 4], // Geodude
      ["sv3pt5-75", 2], // Graveler
      ["me1-70", 3], // Onix
      ["sv3pt5-27", 3], // Sandshrew
      ["sv3pt5-28", 2], // Sandslash
      ["sv3pt5-50", 3], // Diglett
      ["sv3pt5-51", 2], // Dugtrio
      [T.potion, 4],
      [T.pokeBall, 4],
      [T.research, 3],
      [T.nestBall, 2],
      [E.fighting, 28],
    ],
  },
  {
    level: 2,
    name: "Misty",
    title: "Cerulean City Gym Leader",
    venue: "cerulean-city-gym",
    badge: "Cascade Badge",
    ace: 121,
    deckName: "Tidal Wave",
    blurb: "Quick Water Pokémon that evolve fast. Watch out for Golduck's Super Splash.",
    skill: { blunder: 0.35, smart: false, benchMax: 3 },
    deck: [
      ["sv3pt5-120", 4], // Staryu
      ["sv3pt5-121", 3], // Starmie
      ["sv3pt5-54", 3], // Psyduck
      ["sv3pt5-55", 2], // Golduck
      ["sv3pt5-116", 3], // Horsea
      ["sv3pt5-117", 2], // Seadra
      ["sv3pt5-118", 2], // Goldeen
      ["sv3pt5-119", 2], // Seaking
      [T.potion, 3],
      [T.nestBall, 3],
      [T.pokeBall, 3],
      [T.research, 3],
      [T.switch, 2],
      [E.water, 25],
    ],
  },
  {
    level: 3,
    name: "Lt. Surge",
    title: "Vermilion City Gym Leader",
    venue: "vermilion-city-gym",
    badge: "Thunder Badge",
    ace: 26,
    deckName: "Lightning Strike",
    blurb: "Hard-hitting Electric Pokémon. Raichu's Thunder does 180 but hurts itself too.",
    skill: { blunder: 0.2, smart: false, benchMax: 3 },
    deck: [
      ["sv3pt5-25", 4], // Pikachu
      ["sv3pt5-26", 3], // Raichu
      ["sv3pt5-100", 3], // Voltorb
      ["sv3pt5-101", 2], // Electrode
      ["sv3pt5-81", 3], // Magnemite
      ["sv3pt5-82", 2], // Magneton
      ["sv3pt5-125", 3], // Electabuzz
      [T.nestBall, 4],
      [T.research, 4],
      [T.switch, 2],
      [T.potion, 2],
      [T.energySearch, 2],
      [T.vitalityBand, 2],
      [E.lightning, 24],
    ],
  },
  {
    level: 4,
    name: "Erika",
    title: "Celadon City Gym Leader",
    venue: "celadon-city-gym",
    badge: "Rainbow Badge",
    ace: 45,
    deckName: "Garden Party",
    blurb: "Grass Pokémon that grow into big Stage 2s. From here on, opponents plan their Energy and retreat.",
    skill: { blunder: 0.3, smart: true, benchMax: 4 },
    deck: [
      ["sv3pt5-43", 4], // Oddish
      ["sv3pt5-44", 3], // Gloom
      ["sv3pt5-45", 2], // Vileplume
      ["sv3pt5-102", 4], // Exeggcute
      ["sv3pt5-103", 3], // Exeggutor
      ["sv3pt5-127", 2], // Pinsir
      ["sv3pt5-123", 2], // Scyther
      [T.rareCandy, 3],
      [T.nestBall, 4],
      [T.research, 4],
      [T.potion, 2],
      [T.switch, 2],
      [T.ultraBall, 2],
      [E.grass, 23],
    ],
  },
  {
    level: 5,
    name: "Koga",
    title: "Fuchsia City Gym Leader",
    venue: "fuchsia-city-gym",
    badge: "Soul Badge",
    ace: 110,
    deckName: "Toxic Ninja",
    blurb: "Poison and Confusion wear you down, and Muk makes it hard to retreat.",
    skill: { blunder: 0.2, smart: true, benchMax: 5 },
    deck: [
      ["sv3pt5-109", 4], // Koffing
      ["sv3pt5-110", 3], // Weezing
      ["sv3pt5-88", 3], // Grimer
      ["sv3pt5-89", 2], // Muk
      ["sv3pt5-23", 3], // Ekans
      ["sv3pt5-24", 2], // Arbok ex
      ["sv3pt5-32", 3], // Nidoran ♂
      ["sv3pt5-33", 2], // Nidorino
      [T.nestBall, 4],
      [T.ultraBall, 2],
      [T.research, 4],
      [T.iono, 2],
      [T.switch, 2],
      [T.potion, 2],
      [E.darkness, 22],
    ],
  },
  {
    level: 6,
    name: "Sabrina",
    title: "Saffron City Gym Leader",
    venue: "saffron-city-gym",
    badge: "Marsh Badge",
    ace: 65,
    deckName: "Mind Games",
    blurb: "Alakazam ex hits harder the more Pokémon you bench, and she'll use Boss's Orders.",
    skill: { blunder: 0.12, smart: true, benchMax: 5 },
    deck: [
      ["sv3pt5-63", 4], // Abra
      ["sv3pt5-64", 3], // Kadabra
      ["sv3pt5-65", 3], // Alakazam ex
      ["sv3pt5-96", 3], // Drowzee
      ["sv3pt5-97", 2], // Hypno
      ["sv3pt5-79", 3], // Slowpoke
      ["sv3pt5-80", 2], // Slowbro
      ["sv3pt5-150", 2], // Mewtwo
      [T.rareCandy, 3],
      [T.ultraBall, 3],
      [T.nestBall, 3],
      [T.research, 4],
      [T.iono, 2],
      [T.boss, 2],
      [T.switch, 2],
      [E.psychic, 19],
    ],
  },
  {
    level: 7,
    name: "Blaine",
    title: "Cinnabar Island Gym Leader",
    venue: "cinnabar-island-gym",
    badge: "Volcano Badge",
    ace: 59,
    deckName: "Hot Headed",
    blurb: "Arcanine and Charizard ex hit very hard. Burns add up fast.",
    skill: { blunder: 0.05, smart: true, benchMax: 5 },
    deck: [
      ["sv3pt5-58", 4], // Growlithe
      ["sv3pt5-59", 3], // Arcanine
      ["sv3pt5-37", 3], // Vulpix
      ["sv3pt5-38", 2], // Ninetales ex
      ["sv3pt5-126", 2], // Magmar
      ["sv3pt5-4", 3], // Charmander
      ["sv3pt5-5", 2], // Charmeleon
      ["sv3pt5-6", 2], // Charizard ex
      [T.rareCandy, 3],
      [T.ultraBall, 3],
      [T.nestBall, 4],
      [T.research, 4],
      [T.iono, 2],
      [T.boss, 2],
      [T.energyRetrieval, 2],
      [T.switch, 1],
      [E.fire, 18],
    ],
  },
  {
    level: 8,
    name: "Giovanni",
    title: "Viridian City Gym Leader",
    venue: "viridian-city-gym",
    badge: "Earth Badge",
    ace: 34,
    deckName: "Team Rocket",
    blurb: "The Gym Leader is also the boss of Team Rocket. Nidoking ex and Persian ex, with a full set of Trainers.",
    skill: { blunder: 0.03, smart: true, benchMax: 5 },
    deck: [
      ["sv10-117", 4], // Team Rocket's Nidoran ♂
      ["sv10-118", 3], // Team Rocket's Nidorino
      ["sv10-119", 3], // Team Rocket's Nidoking ex
      ["sv10-149", 4], // Team Rocket's Meowth
      ["sv10-150", 3], // Team Rocket's Persian ex
      [T.rareCandy, 4],
      [T.ultraBall, 4],
      [T.nestBall, 4],
      [T.research, 4],
      [T.iono, 3],
      [T.boss, 3],
      [T.arven, 1],
      [T.switch, 2],
      [T.defianceBand, 1],
      [T.vitalityBand, 1],
      [E.darkness, 16],
    ],
  },
  {
    level: 9,
    name: "Lance",
    title: "Elite Four, Indigo Plateau",
    venue: "indigo-plateau",
    badge: "Elite Four Ribbon",
    ace: 149,
    deckName: "Dragon Tamer",
    blurb: "Dragonite ex and Gyarados ex, backed by a tournament-style Trainer line-up.",
    skill: { blunder: 0, smart: true, benchMax: 5 },
    deck: [
      ["me2pt5-150", 4], // Dratini
      ["sv3pt5-148", 3], // Dragonair
      ["sv3-159", 3], // Dragonite ex
      ["sv3pt5-129", 3], // Magikarp
      ["sv1-45", 2], // Gyarados ex
      ["sv7-32", 2], // Lapras ex
      [T.rareCandy, 4],
      [T.ultraBall, 4],
      [T.nestBall, 4],
      [T.research, 4],
      [T.iono, 3],
      [T.boss, 3],
      [T.switch, 2],
      [T.energyRetrieval, 2],
      [T.heroCape, 1],
      [T.arven, 1],
      [E.water, 9],
      [E.lightning, 6],
    ],
  },
  {
    level: 10,
    name: "Blue",
    title: "Pokémon League Champion",
    venue: "indigo-plateau",
    badge: "Champion Trophy",
    ace: 6,
    deckName: "Champion's Team",
    blurb: "Charizard ex, Pidgeot ex and Arcanine ex, played without mistakes. The final battle.",
    skill: { blunder: 0, smart: true, benchMax: 5 },
    deck: [
      ["sv3pt5-4", 4], // Charmander
      ["me2-12", 2], // Charmeleon
      ["sv3-125", 3], // Charizard ex
      ["sv3pt5-16", 3], // Pidgey
      ["sv3pt5-17", 1], // Pidgeotto
      ["sv3-164", 2], // Pidgeot ex
      ["sv3pt5-58", 2], // Growlithe
      ["sv1-32", 2], // Arcanine ex
      [T.rareCandy, 4],
      [T.ultraBall, 4],
      [T.nestBall, 2],
      [T.poffin, 1],
      [T.research, 4],
      [T.iono, 3],
      [T.boss, 3],
      [T.arven, 1],
      [T.switch, 2],
      [T.heroCape, 1],
      [T.vitalityBand, 1],
      [E.fire, 15],
    ],
  },
];

export const opponentByLevel = (level: unknown) => OPPONENTS.find((o) => o.level === Number(level)) ?? null;

/** Loaner decks for trainers who haven't built a 60-card deck yet. */
export const STARTER_DECKS: { id: string; name: string; type: string; deck: DeckEntry[] }[] = [
  {
    id: "starter-fire",
    name: "Charmander starter",
    type: "Fire",
    deck: [
      ["sv3pt5-4", 4], // Charmander
      ["sv3pt5-5", 3], // Charmeleon
      ["sv3pt5-6", 2], // Charizard ex
      ["sv3pt5-77", 3], // Ponyta
      ["sv3pt5-78", 2], // Rapidash
      ["sv3pt5-37", 3], // Vulpix
      ["sv3pt5-126", 2], // Magmar
      [T.rareCandy, 2],
      [T.nestBall, 4],
      [T.pokeBall, 3],
      [T.research, 4],
      [T.potion, 2],
      [T.switch, 2],
      [E.fire, 24],
    ],
  },
  {
    id: "starter-water",
    name: "Squirtle starter",
    type: "Water",
    deck: [
      ["sv3pt5-7", 4], // Squirtle
      ["sv3pt5-8", 3], // Wartortle
      ["sv3pt5-9", 2], // Blastoise ex
      ["sv3pt5-131", 2], // Lapras
      ["sv3pt5-60", 3], // Poliwag
      ["sv3pt5-61", 2], // Poliwhirl
      ["sv3pt5-62", 1], // Poliwrath
      ["sv3pt5-86", 2], // Seel
      ["sv3pt5-87", 2], // Dewgong
      [T.rareCandy, 2],
      [T.nestBall, 4],
      [T.pokeBall, 3],
      [T.research, 4],
      [T.potion, 2],
      [T.switch, 2],
      [E.water, 22],
    ],
  },
  {
    id: "starter-grass",
    name: "Bulbasaur starter",
    type: "Grass",
    deck: [
      ["sv3pt5-1", 4], // Bulbasaur
      ["sv3pt5-2", 3], // Ivysaur
      ["sv3pt5-3", 2], // Venusaur ex
      ["sv3pt5-123", 2], // Scyther
      ["sv3pt5-127", 2], // Pinsir
      ["sv3pt5-46", 3], // Paras
      ["sv3pt5-47", 2], // Parasect
      ["sv3pt5-128", 2], // Tauros
      [T.rareCandy, 2],
      [T.nestBall, 4],
      [T.pokeBall, 3],
      [T.research, 4],
      [T.potion, 2],
      [T.switch, 2],
      [E.grass, 23],
    ],
  },
];
