// Every piece of text the game shows that isn't part of a menu lives here, so it's easy to find and
// replace. None of it is Frenko's real story: these are placeholders until Dougy writes the real
// lines. Frenko Pokémon, characters, places and rules will get their own files in this folder,
// filled only from Dougy's designs.

export const TITLE = "FRENKO REGION";
export const TITLE_NOTE = "Placeholder title screen";

export const NEW_GAME_INTRO = [
  "[Placeholder] This is where the Frenko adventure will begin.",
  "The opening story will go here once it has been written.",
];

// Places. "Roucco Town" is Dougy's name; everything else marked [Placeholder] is waiting for his.
// {PLAYER} is swapped for the player's name.
export const ROUCCO_NAME = "ROUCCO TOWN";
export const ROUTE_1_NAME = "ROUTE 1";
export const ROUCCO_SIGN = ["ROUCCO TOWN"];
export const PLAYER_HOUSE_SIGN = ["{PLAYER}'s house"];
export const LAB_SIGN = ["PROF. EUCALYPTUS's POKEMON LAB"];
export const ROUTE_1_SIGN = ["ROUTE 1 [Placeholder name]", "West to the Gym 1 town. East to ROUCCO TOWN."];
export const ROUTE_1_END_SIGN = [
  "[Placeholder] The way on to the Gym 1 town isn't built yet.",
  "It comes later in Stage 3.",
];

// People. Mum and Professor Eucalyptus are Dougy's characters; their real lines aren't written yet.
export const MUM_LINES = ["MUM: [Placeholder] Mum's real lines are still being written."];
export const PROFESSOR_LINES = [
  "PROF. EUCALYPTUS: [Placeholder] Her real lines are still being written.",
  "Choosing your first POKEMON comes in a later stage.",
];

export const NOT_READY: Record<string, string> = {
  pokedex: "The Pokédex arrives in Stage 6.",
  pokemon: "Your party arrives in Stage 6.",
  bag: "The Bag will come with items in a later stage.",
};
