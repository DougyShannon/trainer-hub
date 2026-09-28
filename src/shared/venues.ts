// Battle venues: the gyms and stadiums trainers can pick when they open a table. Each game
// table takes its look from the venue's type. Names and types come from the main-series games;
// where versions differ we use the first one (e.g. Sword over Shield).

export type RegionId = "kanto" | "johto" | "hoenn" | "sinnoh" | "unova" | "kalos" | "alola" | "galar" | "paldea";
export type VenueKind = "gym" | "trial" | "league";

export type Venue = {
  id: string;
  name: string;
  place: string;
  region: RegionId;
  kind: VenueKind;
  /** Pokémon type that themes the table; leagues use their own arena look. */
  type: string | null;
  leader: string | null;
};

export const REGIONS: { id: RegionId; name: string; inspiredBy: string }[] = [
  { id: "kanto", name: "Kanto", inspiredBy: "the Kantō region of Japan" },
  { id: "johto", name: "Johto", inspiredBy: "the Kansai region of Japan" },
  { id: "hoenn", name: "Hoenn", inspiredBy: "Kyushu, Japan" },
  { id: "sinnoh", name: "Sinnoh", inspiredBy: "Hokkaido, Japan" },
  { id: "unova", name: "Unova", inspiredBy: "New York" },
  { id: "kalos", name: "Kalos", inspiredBy: "France" },
  { id: "alola", name: "Alola", inspiredBy: "Hawaii" },
  { id: "galar", name: "Galar", inspiredBy: "Great Britain" },
  { id: "paldea", name: "Paldea", inspiredBy: "Spain and Portugal" },
];

const gym = (region: RegionId, place: string, type: string, leader: string): Venue => ({
  id: `${place.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-gym`,
  name: `${place} Gym`,
  place,
  region,
  kind: "gym",
  type,
  leader,
});

export const VENUES: Venue[] = [
  // Kanto
  gym("kanto", "Pewter City", "Rock", "Brock"),
  gym("kanto", "Cerulean City", "Water", "Misty"),
  gym("kanto", "Vermilion City", "Electric", "Lt. Surge"),
  gym("kanto", "Celadon City", "Grass", "Erika"),
  gym("kanto", "Fuchsia City", "Poison", "Koga"),
  gym("kanto", "Saffron City", "Psychic", "Sabrina"),
  gym("kanto", "Cinnabar Island", "Fire", "Blaine"),
  gym("kanto", "Viridian City", "Ground", "Giovanni"),
  { id: "indigo-plateau", name: "Indigo Plateau", place: "Indigo Plateau", region: "kanto", kind: "league", type: null, leader: "Elite Four" },
  // Johto
  gym("johto", "Violet City", "Flying", "Falkner"),
  gym("johto", "Azalea Town", "Bug", "Bugsy"),
  gym("johto", "Goldenrod City", "Normal", "Whitney"),
  gym("johto", "Ecruteak City", "Ghost", "Morty"),
  gym("johto", "Cianwood City", "Fighting", "Chuck"),
  gym("johto", "Olivine City", "Steel", "Jasmine"),
  gym("johto", "Mahogany Town", "Ice", "Pryce"),
  gym("johto", "Blackthorn City", "Dragon", "Clair"),
  // Hoenn
  gym("hoenn", "Rustboro City", "Rock", "Roxanne"),
  gym("hoenn", "Dewford Town", "Fighting", "Brawly"),
  gym("hoenn", "Mauville City", "Electric", "Wattson"),
  gym("hoenn", "Lavaridge Town", "Fire", "Flannery"),
  gym("hoenn", "Petalburg City", "Normal", "Norman"),
  gym("hoenn", "Fortree City", "Flying", "Winona"),
  gym("hoenn", "Mossdeep City", "Psychic", "Tate & Liza"),
  gym("hoenn", "Sootopolis City", "Water", "Juan"),
  { id: "ever-grande-city", name: "Ever Grande Pokémon League", place: "Ever Grande City", region: "hoenn", kind: "league", type: null, leader: "Elite Four" },
  // Sinnoh
  gym("sinnoh", "Oreburgh City", "Rock", "Roark"),
  gym("sinnoh", "Eterna City", "Grass", "Gardenia"),
  gym("sinnoh", "Veilstone City", "Fighting", "Maylene"),
  gym("sinnoh", "Pastoria City", "Water", "Crasher Wake"),
  gym("sinnoh", "Hearthome City", "Ghost", "Fantina"),
  gym("sinnoh", "Canalave City", "Steel", "Byron"),
  gym("sinnoh", "Snowpoint City", "Ice", "Candice"),
  gym("sinnoh", "Sunyshore City", "Electric", "Volkner"),
  { id: "sinnoh-league", name: "Sinnoh Pokémon League", place: "Pokémon League", region: "sinnoh", kind: "league", type: null, leader: "Elite Four" },
  // Unova (Black and White)
  gym("unova", "Striaton City", "Grass", "Cilan, Chili & Cress"),
  gym("unova", "Nacrene City", "Normal", "Lenora"),
  gym("unova", "Castelia City", "Bug", "Burgh"),
  gym("unova", "Nimbasa City", "Electric", "Elesa"),
  gym("unova", "Driftveil City", "Ground", "Clay"),
  gym("unova", "Mistralton City", "Flying", "Skyla"),
  gym("unova", "Icirrus City", "Ice", "Brycen"),
  gym("unova", "Opelucid City", "Dragon", "Drayden"),
  { id: "unova-league", name: "Unova Pokémon League", place: "Pokémon League", region: "unova", kind: "league", type: null, leader: "Elite Four" },
  // Kalos
  gym("kalos", "Santalune City", "Bug", "Viola"),
  gym("kalos", "Cyllage City", "Rock", "Grant"),
  gym("kalos", "Shalour City", "Fighting", "Korrina"),
  gym("kalos", "Coumarine City", "Grass", "Ramos"),
  gym("kalos", "Lumiose City", "Electric", "Clemont"),
  gym("kalos", "Laverre City", "Fairy", "Valerie"),
  gym("kalos", "Anistar City", "Psychic", "Olympia"),
  gym("kalos", "Snowbelle City", "Ice", "Wulfric"),
  { id: "kalos-league", name: "Kalos Pokémon League", place: "Pokémon League", region: "kalos", kind: "league", type: null, leader: "Elite Four" },
  // Alola: no gyms, so the island Kahunas' grand trials stand in
  { id: "melemele-grand-trial", name: "Melemele Grand Trial", place: "Iki Town", region: "alola", kind: "trial", type: "Fighting", leader: "Kahuna Hala" },
  { id: "akala-grand-trial", name: "Akala Grand Trial", place: "Konikoni City", region: "alola", kind: "trial", type: "Rock", leader: "Kahuna Olivia" },
  { id: "ulaula-grand-trial", name: "Ula'ula Grand Trial", place: "Ula'ula Island", region: "alola", kind: "trial", type: "Dark", leader: "Kahuna Nanu" },
  { id: "poni-grand-trial", name: "Poni Grand Trial", place: "Poni Island", region: "alola", kind: "trial", type: "Ground", leader: "Kahuna Hapu" },
  { id: "alola-league", name: "Alola Pokémon League", place: "Mount Lanakila", region: "alola", kind: "league", type: null, leader: "Elite Four" },
  // Galar (Sword)
  gym("galar", "Turffield", "Grass", "Milo"),
  gym("galar", "Hulbury", "Water", "Nessa"),
  gym("galar", "Motostoke", "Fire", "Kabu"),
  gym("galar", "Stow-on-Side", "Fighting", "Bea"),
  gym("galar", "Ballonlea", "Fairy", "Opal"),
  gym("galar", "Circhester", "Rock", "Gordie"),
  gym("galar", "Spikemuth", "Dark", "Piers"),
  gym("galar", "Hammerlocke", "Dragon", "Raihan"),
  { id: "wyndon-stadium", name: "Wyndon Stadium", place: "Wyndon", region: "galar", kind: "league", type: null, leader: "Champion Cup" },
  // Paldea
  gym("paldea", "Cortondo", "Bug", "Katy"),
  gym("paldea", "Artazon", "Grass", "Brassius"),
  gym("paldea", "Levincia", "Electric", "Iono"),
  gym("paldea", "Cascarrafa", "Water", "Kofu"),
  gym("paldea", "Medali", "Normal", "Larry"),
  gym("paldea", "Montenevera", "Ghost", "Ryme"),
  gym("paldea", "Alfornada", "Psychic", "Tulip"),
  gym("paldea", "Glaseado", "Ice", "Grusha"),
  { id: "paldea-league", name: "Paldea Pokémon League", place: "Pokémon League", region: "paldea", kind: "league", type: null, leader: "Elite Four" },
];

export const venueById = (id: unknown): Venue | null => (typeof id === "string" && VENUES.find((v) => v.id === id)) || null;
