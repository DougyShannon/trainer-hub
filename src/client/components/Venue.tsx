import type { ReactNode } from "react";
import { REGIONS, VENUES, venueById, type Venue } from "../../shared/venues";
import { TypeBadge } from "./ui";

const kindLabel = (v: Venue) => (v.kind === "gym" ? "Gym Leader" : v.kind === "trial" ? "Grand trial" : "League");

/** Drop-down of every venue, grouped by region. An empty value means "anywhere". */
export function VenueSelect({ id, value, onChange }: { id?: string; value: string; onChange: (id: string) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Anywhere (plain table)</option>
      {REGIONS.map((r) => (
        <optgroup key={r.id} label={r.name}>
          {VENUES.filter((v) => v.region === r.id).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.type ? ` (${v.type})` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Small "at Pewter City Gym" label for lobby rows. */
export function VenueTag({ id }: { id: string | null }) {
  const venue = venueById(id);
  if (!venue) return null;
  return (
    <span className="venue-tag" data-venue-type={venue.type?.toLowerCase() ?? "league"}>
      {venue.name}
    </span>
  );
}

/** Wraps a game table in its venue's colours and patterns, with a name strip on top. */
export function VenueFrame({ id, children }: { id: string | null; children: ReactNode }) {
  const venue = venueById(id);
  if (!venue) return <>{children}</>;
  const region = REGIONS.find((r) => r.id === venue.region)!;
  return (
    <div className="venue-frame" data-venue-type={venue.type?.toLowerCase() ?? "league"}>
      <div className="venue-strip">
        <span className="venue-strip-name">{venue.name}</span>
        <span className="muted small">
          {region.name} · {kindLabel(venue)} {venue.leader}
        </span>
        {venue.type && <TypeBadge type={venue.type.toLowerCase()} />}
      </div>
      {children}
    </div>
  );
}
