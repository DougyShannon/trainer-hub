import { useState, type CSSProperties } from "react";
import { stadiumById, stadiumImages } from "../../battle/stadiums";
import type { Anim } from "../../battle/viewer";

const SHOWDOWN = "https://play.pokemonshowdown.com/sprites";
const POKEAPI = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

// Base species whose names have a hyphen of their own (everything else: "Rotom-Wash" is Rotom's Wash form).
const HYPHEN_NAMES = ["ho-oh", "porygon-z", "jangmo-o", "hakamo-o", "kommo-o", "chi-yu", "chien-pao", "ting-lu", "wo-chien", "nidoran-f", "nidoran-m"];
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Showdown's sprite file name, e.g. "rotom-wash" or "urshifu-rapidstrike". */
export function showdownSpriteId(species: string): string {
  const lower = species.toLowerCase();
  const special = HYPHEN_NAMES.find((n) => lower === n || lower.startsWith(`${n}-`));
  if (special) {
    const rest = lower.slice(special.length + 1);
    return toId(special) + (rest ? `-${toId(rest)}` : "");
  }
  const dash = lower.indexOf("-");
  if (dash < 0) return toId(lower);
  return `${toId(lower.slice(0, dash))}-${toId(lower.slice(dash + 1))}`;
}

/**
 * A Pokémon's sprite: Showdown's animated Gen 5 sprite first, then the Pokédex page's sprite from
 * PokeAPI for Pokémon Showdown doesn't have (most Gen 6 to 9 Pokémon).
 */
export function ShowdownSprite({
  species,
  num = 0,
  back = false,
  shiny = false,
  still = false,
  size,
  className,
}: {
  species: string;
  num?: number;
  back?: boolean;
  shiny?: boolean;
  still?: boolean;
  size?: number;
  className?: string;
}) {
  const id = showdownSpriteId(species);
  const dir = `${still ? "gen5" : "gen5ani"}${back ? "-back" : ""}${shiny ? "-shiny" : ""}`;
  const urls = [`${SHOWDOWN}/${dir}/${id}.${still ? "png" : "gif"}`];
  if (num > 0) {
    if (back) urls.push(`${POKEAPI}/back/${shiny ? "shiny/" : ""}${num}.png`);
    urls.push(`${POKEAPI}/${shiny ? "shiny/" : ""}${num}.png`);
  }
  return <SpriteImg key={urls[0]} urls={urls} size={size} className={className} flip={back} />;
}

function SpriteImg({ urls, size, className, flip }: { urls: string[]; size?: number; className?: string; flip: boolean }) {
  const [i, setI] = useState(0);
  if (i >= urls.length) return <span className={`sprite-missing ${className ?? ""}`} style={size ? { width: size, height: size } : undefined} />;
  // The Pokédex sprites only face forward, so a missing back sprite is the front one turned round.
  const mirrored = flip && i > 0 && i === urls.length - 1;
  return (
    <img
      src={urls[i]}
      alt=""
      className={`${className ?? ""}${mirrored ? " mirrored" : ""}`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setI((n) => n + 1)}
    />
  );
}

/** A stadium's scenery: its picture if one has been added, otherwise drawn in its type's colours. */
export function StadiumBackdrop({ id }: { id: string }) {
  const stadium = stadiumById(id);
  return (
    <div className="stadium-backdrop" data-venue-type={stadium.look} aria-hidden="true">
      <div className="stadium-sky" />
      <div className="stadium-pattern" />
      <div className="stadium-picture" style={{ backgroundImage: stadiumImages(stadium.id) } as CSSProperties} />
    </div>
  );
}

export function StadiumPreview({ id, label }: { id: string; label: string }) {
  return (
    <div className="stadium-preview">
      <StadiumBackdrop id={id} />
      <span className="stadium-preview-name">{label}</span>
    </div>
  );
}

export type ShownMon = {
  key: string;
  species: string;
  num: number;
  name: string;
  level: number;
  gender: string;
  shiny: boolean;
  hp: number;
  maxhp: number;
  status: string;
  fainted: boolean;
  tera: string;
  boosts: [string, number][];
  volatiles: string[];
  /** Exact HP is shown for the player's Pokémon; the computer's shows a percentage. */
  exact: boolean;
};

const STATUS_LABEL: Record<string, string> = { brn: "BRN", par: "PAR", psn: "PSN", tox: "TOX", slp: "SLP", frz: "FRZ" };
const BOOST_LABEL: Record<string, string> = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe", accuracy: "Acc", evasion: "Eva" };

export function HpBox({ mon, side }: { mon: ShownMon; side: "mine" | "foe" }) {
  const pct = mon.maxhp ? Math.max(0, Math.min(100, (mon.hp / mon.maxhp) * 100)) : 0;
  const colour = pct > 50 ? "g" : pct > 20 ? "y" : "r";
  return (
    <div className={`hp-box ${side}${mon.fainted ? " fainted" : ""}`}>
      <div className="hp-box-top">
        <strong className="hp-name">{mon.name}</strong>
        {mon.gender && mon.gender !== "N" && <span className={`hp-gender ${mon.gender === "F" ? "f" : "m"}`}>{mon.gender === "F" ? "♀" : "♂"}</span>}
        <span className="hp-level">Lv{mon.level}</span>
      </div>
      <div className="hp-bar" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${mon.name} HP`}>
        <span className={`hp-fill ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="hp-box-bottom">
        <span className="hp-text">{mon.exact ? `${mon.hp}/${mon.maxhp}` : `${Math.round(pct)}%`}</span>
        {mon.status && !mon.fainted && <span className={`status-tag ${mon.status}`}>{STATUS_LABEL[mon.status] ?? mon.status}</span>}
        {mon.tera && <span className={`tera-tag type-${mon.tera.toLowerCase()}`}>Tera {mon.tera}</span>}
      </div>
      {(mon.boosts.length > 0 || mon.volatiles.length > 0) && (
        <div className="hp-extras">
          {mon.boosts.map(([stat, n]) => (
            <span key={stat} className={`boost-tag ${n > 0 ? "up" : "down"}`}>
              {n > 0 ? "+" : ""}
              {n} {BOOST_LABEL[stat] ?? stat}
            </span>
          ))}
          {mon.volatiles.map((v) => (
            <span key={v} className="volatile-tag">
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One Pokémon on the field, on its platform. */
export function FieldMon({ mon, side, anim }: { mon: ShownMon | null; side: "mine" | "foe"; anim?: Anim & { n: number } }) {
  return (
    <div className={`field-spot ${side}`}>
      <div className="platform" aria-hidden="true" />
      {mon && (
        <div
          key={`${mon.key}-${anim?.n ?? 0}`}
          className={`field-mon${mon.fainted ? " gone" : ""}${anim ? ` anim-${anim.kind}` : ""}`}
          data-move-type={anim?.moveType?.toLowerCase()}
        >
          <ShowdownSprite species={mon.species} num={mon.num} back={side === "mine"} shiny={mon.shiny} className="field-sprite" />
          {mon.tera && <span className={`tera-glow type-${mon.tera.toLowerCase()}`} aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
