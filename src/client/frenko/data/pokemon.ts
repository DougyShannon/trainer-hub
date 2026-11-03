// Frenko's Pokémon, from Dougy's designs. Only add a Pokémon here once Dougy has given its name and
// type. The pictures in public/art/frenko/pokemon are PLACEHOLDER pixel art drawn from Dougy's
// pictures (by scripts/frenko-draw-pokemon.py) until Milton's sprites arrive.

export type Species = {
  id: string;
  name: string;
  types: string[];
  /** Dougy's description. */
  about: string;
  /** The front picture, 64 × 64 pixels. */
  sprite: string;
};

const sprite = (id: string) => `/art/frenko/pokemon/${id}.png`;

export const POKEMON: Record<string, Species> = {
  cheektounge: { id: "cheektounge", name: "CHEEKTOUNGE", types: ["Normal"], about: "A cheeky blue-tongue lizard.", sprite: sprite("cheektounge") },
  gully: { id: "gully", name: "GULLY", types: ["Normal", "Flying"], about: "A seagull.", sprite: sprite("gully") },
  spikecoon: { id: "spikecoon", name: "SPIKECOON", types: ["Bug"], about: "A car-sized spiky caterpillar.", sprite: sprite("spikecoon") },
};
