// Sprites and artwork come from the PokeAPI sprites project on GitHub.
const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export const sprite = (id: number) => `${BASE}/${id}.png`;
export const shinySprite = (id: number) => `${BASE}/shiny/${id}.png`;
export const artwork = (id: number) => `${BASE}/other/official-artwork/${id}.png`;
export const shinyArtwork = (id: number) => `${BASE}/other/official-artwork/shiny/${id}.png`;
export const animatedSprite = (id: number) => `${BASE}/other/showdown/${id}.gif`;
export const cry = (id: number) => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;

export const dexNumber = (id: number) => `#${String(id).padStart(4, "0")}`;
