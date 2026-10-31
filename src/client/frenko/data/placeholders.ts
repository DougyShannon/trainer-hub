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

export const TEST_AREA_NAME = "TEST AREA";
export const TEST_AREA_SIGN = [
  "This is a placeholder test area for trying out walking around.",
  "Real Frenko towns and routes arrive in Stage 3.",
];

export const NOT_READY: Record<string, string> = {
  pokedex: "The Pokédex arrives in Stage 6.",
  pokemon: "Your party arrives in Stage 6.",
  bag: "The Bag will come with items in a later stage.",
};
