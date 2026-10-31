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
export const LEAFSOIL_NAME = "LEAFSOIL FARMS";
export const ROUCCO_SIGN = ["ROUCCO TOWN"];
export const PLAYER_HOUSE_SIGN = ["{PLAYER}'s house"];
export const LAB_SIGN = ["PROF. EUCALYPTUS's POKEMON LAB"];
export const ROUTE_1_SIGN = ["ROUTE 1", "West: LEAFSOIL FARMS. East: ROUCCO TOWN."];
export const ROUTE_1_WEST_SIGN = ["ROUTE 1", "East: ROUCCO TOWN. West: LEAFSOIL FARMS."];
export const LEAFSOIL_SIGN = ["LEAFSOIL FARMS"];
export const GYM_1_SIGN = ["LEAFSOIL FARMS POKEMON GYM", "LEADER: SOILY"];
export const CENTER_SIGN = ["POKEMON CENTER"];
export const MART_SIGN = ["POKE MART"];
export const LEAFSOIL_SOUTH_SIGN = ["[Placeholder] The road south to BEACHVILLE isn't built yet."];
export const CENTER_COUNTER = ["[Placeholder] Healing your POKEMON comes in a later stage."];
export const MART_COUNTER = ["[Placeholder] Shopping comes in a later stage."];
// Soily's Gym puzzle (Dougy: 4 fertiliser plots, each with a sign hinting which seed goes in it).
// The seeds and hints below are Claude's DRAFT for Dougy to change.
export const GYM_1_SEEDS = [
  { name: "CARROT SEED", color: "#f08030" },
  { name: "SUNFLOWER SEED", color: "#f8d030" },
  { name: "PUMPKIN SEED", color: "#c86818" },
  { name: "BEAN SEED", color: "#58b848" },
];
export const GYM_1_HINTS = [
  ["PLOT 1: Soft, deep fertiliser.", "Perfect for a root that grows long and orange under the ground."],
  ["PLOT 2: The sunniest plot in the Gym.", "Perfect for a tall flower that turns to face the sun."],
  ["PLOT 3: Lots of room to spread out.", "Perfect for something big, round and orange that sits on top of the soil."],
  ["PLOT 4: This plot has a pole to climb.", "Perfect for a vine that grows pods."],
];
export const PLANT_QUESTION = "Which seed will you plant here?";
export const PLANTED = "{PLAYER} planted the {SEED}.";
export const GROWING = "The {SEED} is growing well.";
export const PUZZLE_SOLVED = ["Every seed is in the right plot!", "The hedge gate to SOILY opened!"];
export const PUZZLE_WRONG = ["Every plot is planted, but nothing happened.", "Some seeds must be in the wrong plots. Try planting again."];

// People. Mum and Professor Eucalyptus are Dougy's characters; their real lines aren't written yet.
export const MUM_LINES = ["MUM: [Placeholder] Mum's real lines are still being written."];
export const PROFESSOR_LINES = [
  "PROF. EUCALYPTUS: [Placeholder] Her real lines are still being written.",
  "Choosing your first POKEMON comes in a later stage.",
];
export const SOILY_LINES = ["SOILY: [Placeholder] Soily's real lines are still being written.", "Gym battles come in a later stage."];

export const NOT_READY: Record<string, string> = {
  pokedex: "The Pokédex arrives in Stage 6.",
  pokemon: "Your party arrives in Stage 6.",
  bag: "The Bag will come with items in a later stage.",
};
