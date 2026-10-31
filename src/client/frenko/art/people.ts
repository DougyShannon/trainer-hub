// ORIGINAL placeholder pictures for the people in Frenko's towns. Everyone shares one simple body,
// and each person gets their own colours, so a new person is just a new palette. They're stand-ins
// until the real character art exists.
//
// Same format as player.ts: 16 × 20 pixels, one letter per pixel, "." is see-through, and facing
// left is the facing-right picture flipped.

import type { Direction } from "../world/direction";

export type PersonLook = "mum" | "professor";

const BODY = [
  "...kkttttttkk...",
  "..kttttttttttk..",
  "..ktTttttttTtk..",
  "..ksTttttttTsk..",
  "..kskttttttksk..",
  "...kkTTTTTTkk...",
  "....kppppppk....",
  "....kppkkppk....",
  "...kppk..kppk...",
  "...kook..kook...",
  "...kkkk..kkkk...",
];

const HEAD_TOP = ["................", ".....kkkkkk.....", "....khhhhhhk....", "...khhhhhhhhk...", "...khhhhhhhhk..."];

const FRAMES: Record<"down" | "up" | "right", string[]> = {
  down: [...HEAD_TOP, "...khssssssHk...", "...kssksskssk...", "...kssssssssk...", "....kSssssSk....", ...BODY],
  up: [...HEAD_TOP, "...khhhhhhhhk...", "...khhhhhhhhk...", "...kHhhhhhhHk...", "....kHHHHHHk....", ...BODY],
  right: [...HEAD_TOP, "...khhhhssssk...", "...khhhhsssksk..", "...khhhssssssk..", "....kHhSsssk....", ...BODY],
};

const SKIN = { k: "#282830", s: "#f8c8a0", S: "#d89870", o: "#383838" };

const PALETTES: Record<PersonLook, Record<string, string>> = {
  // Brown hair, green top, tan skirt.
  mum: { ...SKIN, h: "#7a4a28", H: "#5a3418", t: "#58a060", T: "#3e7846", p: "#c8a070" },
  // A white lab coat over dark clothes.
  professor: { ...SKIN, h: "#4a3a30", H: "#30261e", t: "#f4f4f4", T: "#c8c8d0", p: "#404858" },
};

export function personPicture(look: PersonLook, facing: Direction) {
  const view = facing === "left" ? "right" : facing;
  return { key: `person-${look}-${view}`, rows: FRAMES[view], palette: PALETTES[look], flip: facing === "left" };
}
