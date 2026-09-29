/**
 * The game board library: play mats for the "Two half mats" layout and backgrounds for the full board.
 *
 * To add your own, upload the picture to public/art/mats (a half mat) or public/art/boards (a full board
 * background), then copy one of the entries below and change its details. The step-by-step guide is
 * "adding-game-boards.md", and the Mat maker page (/play/mats) lines the card spots up for you.
 */

/** The centre of a card spot, as [% across the mat from the left, % down the mat from the top]. */
export type Spot = [x: number, y: number];

/** Where each card sits on a half mat. Every number is a % of the picture, so it works at any size. */
export type MatLayout = {
  /** How wide a card is, as a % of the mat's width. */
  card: number;
  active: Spot;
  stadium: Spot;
  deck: Spot;
  discard: Spot;
  /** Only shown when there are cards in it. */
  lostZone: Spot;
  /** The five Bench spots, left to right. */
  bench: [Spot, Spot, Spot, Spot, Spot];
  /** The six Prize card spots. They fill up in this order. */
  prizes: [Spot, Spot, Spot, Spot, Spot, Spot];
  /** The player's name and picture (usually over the logo). */
  tag: Spot;
};

/**
 * The usual play mat layout: Prizes down the left, Stadium and Active across the top, Deck on the
 * right, and the Bench plus Discard along the bottom. All six mats that came with the site use it.
 */
export const STANDARD_LAYOUT: MatLayout = {
  card: 10.2,
  active: [51.5, 20],
  stadium: [28, 20],
  deck: [92, 50],
  discard: [92, 81],
  lostZone: [78, 50],
  bench: [
    [28, 81],
    [40.5, 81],
    [53, 81],
    [65.5, 81],
    [78, 81],
  ],
  prizes: [
    [14.5, 20],
    [8, 23.3],
    [14.5, 47.3],
    [8, 50.5],
    [14.5, 75],
    [8, 78],
  ],
  tag: [85, 14],
};

export type Mat = {
  /** A short name for the address bar and saved choices: lower case letters, numbers and dashes. */
  id: string;
  /** The name players see. */
  name: string;
  /** The picture, from the public folder (public/art/mats/my-mat.webp is "/art/mats/my-mat.webp"). */
  image: string;
  /** A small copy for the picker. Leave it out and the full picture is used. */
  thumb?: string;
  /** Width divided by height of the picture (1400 wide and 826 high is 1400 / 826 = 1.695). */
  aspect: number;
  /** Where the card spots are. Leave it out for STANDARD_LAYOUT. */
  layout?: MatLayout;
  /** Pokémon types this mat suits. Practice opponents from a Gym of that type use it. */
  types?: string[];
};

/** A picture behind the whole board in the "Full board" layout. The site places the cards itself. */
export type Backdrop = {
  id: string;
  name: string;
  image: string;
  thumb?: string;
};

// ----- Half mats -----

export const MATS: Mat[] = [
  { id: "thunder", name: "Thunder", image: "/art/mats/thunder.webp", thumb: "/art/mats/thunder-thumb.webp", aspect: 1.695, types: ["Electric"] },
  { id: "blaze", name: "Blaze", image: "/art/mats/blaze.webp", thumb: "/art/mats/blaze-thumb.webp", aspect: 1.695, types: ["Fire", "Dragon"] },
  { id: "bloom", name: "Bloom", image: "/art/mats/bloom.webp", thumb: "/art/mats/bloom-thumb.webp", aspect: 1.696, types: ["Grass", "Bug"] },
  { id: "tide", name: "Tide", image: "/art/mats/tide.webp", thumb: "/art/mats/tide-thumb.webp", aspect: 1.695, types: ["Water", "Ice"] },
  { id: "starters", name: "Starter trio", image: "/art/mats/starters.webp", thumb: "/art/mats/starters-thumb.webp", aspect: 1.693 },
  { id: "pokeball", name: "Classic ball", image: "/art/mats/pokeball.webp", thumb: "/art/mats/pokeball-thumb.webp", aspect: 1.694 },
  // Add new half mats here, for example:
  // { id: "my-mat", name: "My mat", image: "/art/mats/my-mat.webp", aspect: 1.695 },
];

// ----- Full board backgrounds -----

export const BACKDROPS: Backdrop[] = [
  { id: "field", name: "Stadium field", image: "/art/boards/field.svg" },
  { id: "night", name: "Starry night", image: "/art/boards/night.svg" },
  { id: "seaside", name: "Seaside", image: "/art/boards/seaside.svg" },
  // Add new full board backgrounds here, for example:
  // { id: "my-board", name: "My board", image: "/art/boards/my-board.jpg" },
];

export const DEFAULT_MAT = MATS[0].id;

export const matById = (id: string | null | undefined): Mat | undefined => MATS.find((m) => m.id === id);
export const backdropById = (id: string | null | undefined): Backdrop | undefined => BACKDROPS.find((b) => b.id === id);
export const layoutOf = (mat: Mat): MatLayout => mat.layout ?? STANDARD_LAYOUT;

/** A mat for someone whose choice we don't know: one of the given type if there is one, else one that isn't `not`. */
export function matFor(type: string | null | undefined, not?: string): Mat {
  return (
    (type && MATS.find((m) => m.types?.includes(type) && m.id !== not)) ||
    MATS.find((m) => m.id === "pokeball" && m.id !== not) ||
    MATS.find((m) => m.id !== not) ||
    MATS[0]
  );
}
