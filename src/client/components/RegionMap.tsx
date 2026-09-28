import type { KeyboardEvent } from "react";
import { REGIONS, venueById, type Venue } from "../../shared/venues";
import type { MapPlace, Point, RegionMap as RegionMapData } from "../maps";

const GRID = 50;
const COLUMNS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const path = (points: Point[]) => points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");

function Glyph({ place }: { place: MapPlace }) {
  const { x, y } = place;
  switch (place.glyph) {
    case "mountain":
      return <path className="map-glyph" d={`M ${x - 24} ${y + 11} L ${x - 11} ${y - 9} L ${x + 2} ${y + 11} M ${x - 6} ${y + 11} L ${x + 9} ${y - 15} L ${x + 24} ${y + 11}`} />;
    case "forest":
      return (
        <g className="map-glyph">
          {[[-14, -10], [2, -14], [16, -6], [-18, 6], [-2, 2], [12, 10], [-8, 16]].map(([dx, dy]) => (
            <circle key={`${dx},${dy}`} cx={x + dx} cy={y + dy} r={6} />
          ))}
        </g>
      );
    case "park":
      return <rect className="map-glyph map-park" x={x - 34} y={y - 20} width={68} height={40} rx={10} />;
    case "house":
      return <path className="map-glyph" d={`M ${x - 7} ${y + 6} V ${y - 2} L ${x} ${y - 9} L ${x + 7} ${y - 2} V ${y + 6} Z`} />;
    default:
      return <circle className="map-dot" cx={x} cy={y} r={3} />;
  }
}

function Label({ place, className }: { place: MapPlace; className: string }) {
  return (
    <text className={className} x={place.x + place.label.dx} y={place.y + place.label.dy} textAnchor={place.label.anchor ?? "middle"}>
      {place.name}
    </text>
  );
}

/** A diamond for a gym or trial, a larger star-in-a-ring for a league. */
function PinShape({ venue }: { venue: Venue }) {
  if (venue.kind === "league") {
    return (
      <>
        <circle className="pin-body" r={15} />
        <path className="pin-mark" d="M 0 -9 L 2.6 -3 L 9 -2.8 L 4 1.4 L 5.6 8 L 0 4.4 L -5.6 8 L -4 1.4 L -9 -2.8 L -2.6 -3 Z" />
      </>
    );
  }
  return <rect className="pin-body" x={-10} y={-10} width={20} height={20} transform="rotate(45)" />;
}

type Props = {
  map: RegionMapData;
  selected: string | null;
  onSelect: (venueId: string) => void;
  /** Open tables waiting at each venue. */
  waitingAt: Record<string, number>;
  /** Venues whose practice badge the trainer has won. */
  earned: Set<string>;
};

/** A region's tactical map. Gyms and stadiums are pins you can click or tab to. */
export function RegionMap({ map, selected, onSelect, waitingAt, earned }: Props) {
  const region = REGIONS.find((r) => r.id === map.region)!;
  const pins = map.places.filter((p) => p.venue);
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onSelect(id);
  };
  const cols = Math.floor(map.width / GRID);
  const rows = Math.floor(map.height / GRID);

  return (
    <svg viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label={`Map of ${region.name}. Choose a gym or stadium.`}>
      <defs>
        <pattern id="map-sea-lines" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="14" className="map-sea-line" />
        </pattern>
      </defs>

      <rect className="map-sea" width={map.width} height={map.height} />
      <rect fill="url(#map-sea-lines)" width={map.width} height={map.height} />
      {map.land.map((d) => (
        <path key={d} className="map-land" d={d} />
      ))}
      {map.water?.map((d) => (
        <g key={d}>
          <path className="map-water" d={d} />
          <path fill="url(#map-sea-lines)" d={d} />
        </g>
      ))}

      <g className="map-grid" aria-hidden="true">
        {Array.from({ length: cols - 1 }, (_, i) => (
          <line key={`c${i}`} x1={(i + 1) * GRID} y1={0} x2={(i + 1) * GRID} y2={map.height} />
        ))}
        {Array.from({ length: rows }, (_, i) => (
          <line key={`r${i}`} x1={0} y1={(i + 1) * GRID} x2={map.width} y2={(i + 1) * GRID} />
        ))}
      </g>

      <g aria-hidden="true">
        {map.places.filter((p) => p.glyph).map((p) => (
          <Glyph key={p.id} place={p} />
        ))}
        {map.routes.map((r) => (
          <path key={r.name} className={r.sea ? "map-route map-sea-route" : "map-route"} d={path(r.points)} />
        ))}
        {map.routes.map((r) =>
          r.label ? (
            <text key={r.name} className="map-route-label" x={r.label[0]} y={r.label[1]}>
              {r.name}
            </text>
          ) : null,
        )}
        {map.places
          .filter((p) => !p.venue)
          .map((p) =>
            p.kind === "landmark" ? (
              <g key={p.id}>
                {!p.glyph && <Glyph place={p} />}
                <Label place={p} className="map-landmark-label" />
              </g>
            ) : (
              <g key={p.id}>
                <rect className="map-town" x={p.x - 6} y={p.y - 6} width={12} height={12} />
                <Label place={p} className="map-label" />
              </g>
            ),
          )}
      </g>

      {pins.map((p) => {
        const venue = venueById(p.venue);
        if (!venue) return null;
        const waiting = waitingAt[venue.id] ?? 0;
        const isSelected = selected === venue.id;
        const detail = [
          venue.name,
          venue.type ? `${venue.type} type` : "Pokémon League",
          venue.kind === "gym" ? `Gym Leader ${venue.leader}` : venue.leader,
          waiting ? `${waiting} table${waiting > 1 ? "s" : ""} waiting` : "",
          earned.has(venue.id) ? "badge earned" : "",
        ].filter(Boolean);
        return (
          <g
            key={p.id}
            className={`map-pin${isSelected ? " selected" : ""}${waiting ? " waiting" : ""}`}
            data-venue-type={venue.type?.toLowerCase() ?? "league"}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={detail.join(". ")}
            onClick={() => onSelect(venue.id)}
            onKeyDown={(e) => onKey(e, venue.id)}
          >
            <Label place={p} className="map-label map-pin-label" />
            <g transform={`translate(${p.x} ${p.y})`}>
              <circle className="pin-hit" r={30} />
              {waiting > 0 && <circle className="pin-pulse" r={14} />}
              {isSelected && (
                <path className="pin-target" d="M -28 -18 V -28 H -18 M 18 -28 H 28 V -18 M 28 18 V 28 H 18 M -18 28 H -28 V 18" />
              )}
              <PinShape venue={venue} />
              {earned.has(venue.id) && <circle className="pin-earned" cx={13} cy={-13} r={5} />}
              {waiting > 0 && (
                <g transform="translate(-15 -15)">
                  <circle className="pin-count" r={8} />
                  <text className="pin-count-text" y={3.5}>
                    {waiting}
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}

      <g className="map-frame" aria-hidden="true">
        <rect x={0.5} y={0.5} width={map.width - 1} height={map.height - 1} />
        {Array.from({ length: cols }, (_, i) => (
          <text key={`c${i}`} className="map-grid-label" x={i * GRID + GRID / 2} y={14} textAnchor="middle">
            {COLUMNS[i]}
          </text>
        ))}
        {Array.from({ length: rows }, (_, i) => (
          <text key={`r${i}`} className="map-grid-label" x={8} y={i * GRID + GRID / 2 + 4}>
            {i + 1}
          </text>
        ))}
        <g transform={`translate(${map.title[0]} ${map.title[1]})`}>
          <text className="map-title" y={40}>
            {region.name}
          </text>
          <text className="map-subtitle" y={62}>
            Sector map · {pins.length} venues
          </text>
          <line className="map-title-rule" x1={0} y1={0} x2={150} y2={0} />
        </g>
        <g className="map-compass" transform={`translate(${map.compass[0]} ${map.compass[1]})`}>
          <circle r={22} />
          <path d="M 0 -18 L 5 0 L 0 18 L -5 0 Z" />
          <path className="map-compass-north" d="M 0 -18 L 5 0 L -5 0 Z" />
          <text y={-28} textAnchor="middle">
            N
          </text>
        </g>
      </g>
    </svg>
  );
}
