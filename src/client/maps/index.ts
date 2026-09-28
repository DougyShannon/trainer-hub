import type { RegionId } from "../../shared/venues";
import { HOENN } from "./hoenn";
import { JOHTO } from "./johto";
import { KANTO } from "./kanto";
import { SINNOH } from "./sinnoh";

// Our own schematic "tactical" region maps: coastlines, routes and towns drawn from scratch in
// SVG coordinates, loosely following each region's layout in the games (not traced from any
// official map art). Venue pins link a town to its entry in shared/venues.ts.

export type Point = [x: number, y: number];

export type MapRoute = {
  name: string;
  points: Point[];
  /** Water routes draw dashed. */
  sea?: boolean;
  /** Where the route's name sits. */
  label?: Point;
};

export type MapPlace = {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: "city" | "town" | "landmark";
  /** A venue id from shared/venues.ts: the place gets a pin you can pick. */
  venue?: string;
  /** Label offset from the place, and which way the text runs from there. */
  label: { dx: number; dy: number; anchor?: "start" | "middle" | "end" };
  glyph?: "mountain" | "forest" | "park" | "house";
  /** Makes the place an arrow off the map's edge that opens a neighbouring region's map. */
  exit?: { to: RegionId; facing: "east" | "west" };
};

export type RegionMap = {
  region: RegionId;
  width: number;
  height: number;
  /** SVG path data for land, drawn over the sea. */
  land: string[];
  /** Lakes and harbours, drawn over the land. */
  water?: string[];
  routes: MapRoute[];
  places: MapPlace[];
  /** Where the title block and compass go, so they sit over open sea. */
  title: Point;
  compass: Point;
};

export const REGION_MAPS: Partial<Record<RegionId, RegionMap>> = {
  kanto: KANTO,
  johto: JOHTO,
  hoenn: HOENN,
  sinnoh: SINNOH,
};
