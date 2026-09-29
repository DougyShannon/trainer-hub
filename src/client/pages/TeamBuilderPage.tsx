import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { send, useApi, type TeamDetail } from "../lib/api";
import { useAuth } from "../lib/auth";
import { sprite, shinySprite } from "../lib/sprites";
import { ErrorBox, Loading } from "../components/ui";
import { Modal } from "./DeckBuilderPage";
import { NotFoundPage } from "./NotFoundPage";
import { useEngine } from "../teams/load";
import type { Engine, MoveRow, NamedRow, SpeciesRow } from "../teams/engine";
import { DEFAULT_FORMAT, FORMATS, isWild, type FormatGroup } from "../teams/formats";
import { STAT_IDS, type PokemonSet, type StatID } from "../../shared/team-sets";

const DRAFT_KEY = "trainer-hub:team-draft";
type Draft = { name: string; format: string; isPublic: boolean; sets: PokemonSet[] };

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage blocked: the draft just won't survive a reload.
  }
}

const STAT_NAMES: Record<StatID, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const GROUPS: FormatGroup[] = ["Singles", "Doubles", "Wild"];

export function TypeTag({ type }: { type: string }) {
  return <span className={`type-badge t-${type.toLowerCase()}`}>{type}</span>;
}

export function MonSprite({ set, size = 96 }: { set: { species: string; shiny?: boolean }; size?: number }) {
  const { engine } = useEngine();
  const n = engine?.spriteFor(set.species) ?? 0;
  if (!n) return <span className="team-sprite-empty named" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img src={set.shiny ? shinySprite(n) : sprite(n)} alt="" width={size} height={size} className="pixel" />;
}

// ---------------------------------------------------------------------------------------------
// The search lists that open under the editor (Pokémon, items, abilities, moves)

type PickerState =
  | { kind: "species"; slot: number | "new" }
  | { kind: "item"; slot: number }
  | { kind: "ability"; slot: number }
  | { kind: "move"; slot: number; index: number };

const PAGE = 80;

/** Search results with exact name matches first, then names that start with the search. */
function byRelevance<T extends { name: string }>(rows: T[], needle: string): T[] {
  if (!needle) return rows;
  const score = (r: T) => {
    const n = r.name.toLowerCase();
    return n === needle ? 0 : n.startsWith(needle) ? 1 : n.includes(needle) ? 2 : 3;
  };
  return rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.r);
}

function useShowMore(resetKey: unknown) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [resetKey]);
  return { limit, more: () => setLimit((n) => n + PAGE * 2) };
}

type SortKey = "tier" | "num" | "name" | "bst" | StatID;

function SpeciesPicker({ engine, format, onPick }: { engine: Engine; format: string; onPick: (name: string) => void }) {
  const all = useMemo(() => engine.speciesFor(format), [engine, format]);
  const wild = isWild(format);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [tier, setTier] = useState("");
  const [learns, setLearns] = useState("");
  const [sort, setSort] = useState<SortKey>(wild ? "num" : "tier");
  const tiers = useMemo(() => [...new Set(all.map((s) => s.tier).filter(Boolean))], [all]);
  const learnMove = learns.trim() ? engine.moveRow(learns.trim()) : null;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = all.filter(
      (s) =>
        (!needle || s.name.toLowerCase().includes(needle) || s.abilities.some((a) => a.toLowerCase().includes(needle))) &&
        (!type || s.types.includes(type)) &&
        (!tier || s.tier === tier),
    );
    if (learnMove) list = list.filter((s) => engine.canLearn(format, s.name, learnMove.name));
    if (sort !== "tier") {
      const key = sort;
      list = [...list].sort((a, b) =>
        key === "name" ? a.name.localeCompare(b.name) : key === "num" ? a.num - b.num : key === "bst" ? b.bst - a.bst : b.stats[key] - a.stats[key],
      );
    }
    return byRelevance(list, needle);
  }, [all, q, type, tier, learnMove, sort, engine, format]);
  const { limit, more } = useShowMore(rows);

  return (
    <div className="picker-panel">
      <div className="picker-filters">
        <input
          id="pick-species"
          type="search"
          autoFocus
          placeholder="Search Pokémon or abilities"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && rows[0] && onPick(rows[0].name)}
        />
        <select id="pick-type" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Any type</option>
          {engine.TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        {!wild && (
          <select id="pick-tier" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier">
            <option value="">Any tier</option>
            {tiers.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
        <input id="pick-learns" type="search" placeholder="Learns a move, e.g. Protect" value={learns} onChange={(e) => setLearns(e.target.value)} list="all-moves" />
        <datalist id="all-moves">
          {engine.movesFor("gen9customgame", "").map((m) => (
            <option key={m.id} value={m.name} />
          ))}
        </datalist>
        <select id="pick-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          {!wild && <option value="tier">Sort: tier</option>}
          <option value="num">Sort: Pokédex number</option>
          <option value="name">Sort: name</option>
          <option value="bst">Sort: base stat total</option>
          {STAT_IDS.map((s) => (
            <option key={s} value={s}>
              Sort: {STAT_NAMES[s]}
            </option>
          ))}
        </select>
      </div>
      {learns.trim() && !learnMove && <p className="muted small">No move called “{learns}”. Pick one from the list.</p>}
      <p className="muted small">
        {rows.length} Pokémon{wild ? "" : " allowed in this format"}. Click one to choose it.
      </p>
      <div className="pick-list species" role="list">
        {rows.slice(0, limit).map((s: SpeciesRow) => (
          <button key={s.id} type="button" role="listitem" className="pick-row" onClick={() => onPick(s.name)}>
            <img src={s.sprite ? sprite(s.sprite) : ""} alt="" width={40} height={40} loading="lazy" className="pixel" />
            <span className="pick-name">{s.name}</span>
            <span className="pick-types">
              {s.types.map((t) => (
                <TypeTag key={t} type={t} />
              ))}
            </span>
            <span className="pick-tier">{s.tier}</span>
            <span className="pick-abilities small muted">{s.abilities.join(" · ")}</span>
            <span className="pick-stats">
              {STAT_IDS.map((k) => (
                <span key={k}>
                  <em>{STAT_NAMES[k]}</em>
                  {s.stats[k]}
                </span>
              ))}
              <span className="bst">
                <em>Total</em>
                {s.bst}
              </span>
            </span>
          </button>
        ))}
      </div>
      {rows.length > limit && (
        <button type="button" className="secondary-btn more-results" onClick={more}>
          Show more ({rows.length - limit} left)
        </button>
      )}
    </div>
  );
}

function MovePicker({
  engine,
  format,
  set,
  index,
  onPick,
}: {
  engine: Engine;
  format: string;
  set: PokemonSet;
  index: number;
  onPick: (name: string) => void;
}) {
  const all = useMemo(() => engine.movesFor(format, set.species), [engine, format, set.species]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<"name" | "power" | "accuracy">("name");
  const speciesTypes = useMemo(() => engine.speciesRow(format, set.species)?.types ?? [], [engine, format, set.species]);
  const chosen = new Set(set.moves.filter((m, i) => m && i !== index).map((m) => m.toLowerCase()));

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter(
      (m) =>
        (!needle || m.name.toLowerCase().includes(needle) || m.desc.toLowerCase().includes(needle)) &&
        (!type || m.type === type) &&
        (!cat || m.category === cat),
    );
    if (sort === "power") return [...list].sort((a, b) => b.power - a.power);
    if (sort === "accuracy") return [...list].sort((a, b) => (b.accuracy === true ? 101 : b.accuracy) - (a.accuracy === true ? 101 : a.accuracy));
    return byRelevance(list, needle);
  }, [all, q, type, cat, sort]);
  const { limit, more } = useShowMore(rows);

  return (
    <div className="picker-panel">
      <div className="picker-filters">
        <input
          id="pick-move"
          type="search"
          autoFocus
          placeholder={`Search moves for ${set.species}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            const first = rows.find((m) => !chosen.has(m.name.toLowerCase()));
            if (e.key === "Enter" && first) onPick(first.name);
          }}
        />
        <select id="pick-move-type" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Any type</option>
          {engine.TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <div className="segmented small" role="group" aria-label="Category">
          {["", "Physical", "Special", "Status"].map((c) => (
            <button key={c || "all"} type="button" className={cat === c ? "active" : ""} aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c || "All"}
            </button>
          ))}
        </div>
        <select id="pick-move-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort by">
          <option value="name">Sort: name</option>
          <option value="power">Sort: power</option>
          <option value="accuracy">Sort: accuracy</option>
        </select>
      </div>
      <p className="muted small">
        Move {index + 1} of 4. {rows.length} moves {isWild(format) ? "to choose from" : `${set.species} can learn`}.
        {speciesTypes.length > 0 && ` Moves of its own type (${speciesTypes.join(", ")}) get a 50% power boost.`}
      </p>
      <div className="pick-list moves" role="list">
        <div className="pick-head" aria-hidden="true">
          <span>Move</span>
          <span>Type</span>
          <span>Cat.</span>
          <span>Pow</span>
          <span>Acc</span>
          <span>PP</span>
          <span>Effect</span>
        </div>
        {rows.slice(0, limit).map((m: MoveRow) => {
          const taken = chosen.has(m.name.toLowerCase());
          return (
            <button
              key={m.id}
              type="button"
              role="listitem"
              className={`pick-row move${speciesTypes.includes(m.type) && m.category !== "Status" ? " stab" : ""}`}
              disabled={taken}
              onClick={() => onPick(m.name)}
              title={taken ? "Already on this Pokémon" : m.desc}
            >
              <span className="pick-name">{m.name}</span>
              <TypeTag type={m.type} />
              <span className={`cat cat-${m.category.toLowerCase()}`}>{m.category}</span>
              <span className="num">{m.power || "—"}</span>
              <span className="num">{m.accuracy === true ? "—" : `${m.accuracy}%`}</span>
              <span className="num">{m.pp}</span>
              <span className="small muted pick-desc">{m.desc}</span>
            </button>
          );
        })}
      </div>
      {rows.length > limit && (
        <button type="button" className="secondary-btn more-results" onClick={more}>
          Show more ({rows.length - limit} left)
        </button>
      )}
    </div>
  );
}

function NamedPicker({
  id,
  rows,
  placeholder,
  none,
  onPick,
}: {
  id: string;
  rows: NamedRow[];
  placeholder: string;
  none?: string;
  onPick: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? byRelevance(rows.filter((r) => r.name.toLowerCase().includes(needle) || r.desc.toLowerCase().includes(needle)), needle) : rows;
  }, [rows, q]);
  const { limit, more } = useShowMore(list);
  return (
    <div className="picker-panel">
      <div className="picker-filters">
        <input
          id={id}
          type="search"
          autoFocus
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && list[0] && onPick(list[0].name)}
        />
      </div>
      <div className="pick-list named" role="list">
        {none && !q && (
          <button type="button" role="listitem" className="pick-row" onClick={() => onPick("")}>
            <span className="pick-name muted">{none}</span>
            <span />
          </button>
        )}
        {list.slice(0, limit).map((r) => (
          <button key={r.id} type="button" role="listitem" className="pick-row" onClick={() => onPick(r.name)}>
            <span className="pick-name">
              {r.name} {r.hidden && <span className="tag">Hidden</span>}
            </span>
            <span className="small muted">{r.desc}</span>
          </button>
        ))}
      </div>
      {list.length > limit && (
        <button type="button" className="secondary-btn more-results" onClick={more}>
          Show more ({list.length - limit} left)
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One Pokémon's details

function StatsEditor({ engine, format, set, onChange }: { engine: Engine; format: string; set: PokemonSet; onChange: (s: PokemonSet) => void }) {
  const rules = engine.formatRules(format);
  const species = engine.speciesRow(format, set.species);
  const final = engine.calcStats(set, format);
  const nature = engine.natureOf(set.nature);
  const evTotal = STAT_IDS.reduce((n, s) => n + set.evs[s], 0);
  const limit = rules.evLimit;
  const left = limit == null ? null : limit - evTotal;

  const setEv = (stat: StatID, raw: number) => {
    let value = Math.max(0, Math.min(252, Math.floor(raw) || 0));
    if (limit != null) value = Math.min(value, set.evs[stat] + Math.max(0, limit - evTotal));
    onChange({ ...set, evs: { ...set.evs, [stat]: value } });
  };
  const setIv = (stat: StatID, raw: number) => onChange({ ...set, ivs: { ...set.ivs, [stat]: Math.max(0, Math.min(31, Math.floor(raw) || 0)) } });

  return (
    <div className="stats-editor">
      <label className="field">
        <span className="field-label">Nature</span>
        <select id="set-nature" value={set.nature} onChange={(e) => onChange({ ...set, nature: e.target.value })}>
          <option value="">Serious (no change)</option>
          {engine.NATURES.filter((n) => n.plus && n.plus !== n.minus).map((n) => (
            <option key={n.name} value={n.name}>
              {n.name} (+{STAT_NAMES[n.plus!]} −{STAT_NAMES[n.minus!]})
            </option>
          ))}
          <optgroup label="No change">
            {engine.NATURES.filter((n) => !n.plus || n.plus === n.minus)
              .filter((n) => n.name !== "Serious")
              .map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
      <table className="ev-table">
        <thead>
          <tr>
            <th scope="col">Stat</th>
            <th scope="col" className="num base-col">
              Base
            </th>
            <th scope="col">EVs</th>
            <th scope="col" className="num">
              IVs
            </th>
            <th scope="col" className="num">
              Final
            </th>
          </tr>
        </thead>
        <tbody>
          {STAT_IDS.map((stat) => {
            const up = nature?.plus === stat && nature.minus !== stat;
            const down = nature?.minus === stat && nature.plus !== stat;
            const value = final?.[stat] ?? 0;
            return (
              <tr key={stat}>
                <th scope="row" className={up ? "up" : down ? "down" : ""}>
                  {STAT_NAMES[stat]}
                  {up ? "+" : down ? "−" : ""}
                </th>
                <td className="num muted base-col">{species?.stats[stat] ?? "?"}</td>
                <td className="ev-cell">
                  <input
                    type="range"
                    min={0}
                    max={252}
                    step={4}
                    value={set.evs[stat]}
                    onChange={(e) => setEv(stat, Number(e.target.value))}
                    aria-label={`${STAT_NAMES[stat]} EVs`}
                  />
                  <input
                    type="number"
                    min={0}
                    max={252}
                    value={set.evs[stat]}
                    onChange={(e) => setEv(stat, Number(e.target.value))}
                    aria-label={`${STAT_NAMES[stat]} EVs`}
                    className="ev-num"
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    max={31}
                    value={set.ivs[stat]}
                    onChange={(e) => setIv(stat, Number(e.target.value))}
                    aria-label={`${STAT_NAMES[stat]} IVs`}
                    className="iv-num"
                  />
                </td>
                <td className="num final">
                  <span className="stat-track" aria-hidden="true">
                    <span className="stat-bar" style={{ width: `${Math.min(100, (value / (rules.levelLocked || set.level <= 50 ? 250 : 450)) * 100)}%` }} />
                  </span>
                  <strong className={up ? "up" : down ? "down" : ""}>{value}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small ev-left">
        {left == null ? (
          `${evTotal} EVs used (no limit in this format)`
        ) : (
          <>
            <strong className={left < 0 ? "bad" : ""}>{left}</strong> of {limit} EVs left to spend. Each stat can take up to 252.
          </>
        )}{" "}
        <button type="button" className="link-btn" onClick={() => onChange({ ...set, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } })}>
          Clear EVs
        </button>
      </p>
      <p className="small muted">
        Final stats are at level {rules.levelLocked ? rules.level : set.level}
        {rules.levelLocked ? ", which this format sets for everyone" : ""}.
      </p>
    </div>
  );
}

function SetEditor({
  engine,
  format,
  set,
  slot,
  count,
  picker,
  onChange,
  onPick,
  onMove,
  onRemove,
}: {
  engine: Engine;
  format: string;
  set: PokemonSet;
  slot: number;
  count: number;
  picker: PickerState | null;
  onChange: (s: PokemonSet) => void;
  onPick: (p: PickerState) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const rules = engine.formatRules(format);
  const row = engine.speciesRow(format, set.species);
  const gender = engine.fixedGender(set.species);
  const abilities = engine.abilitiesFor(format, set.species);
  const wild = rules.wild;
  const active = (p: PickerState) => JSON.stringify(p) === JSON.stringify(picker);

  return (
    <section className="set-editor panel" aria-label={`Pokémon ${slot + 1}: ${set.species}`}>
      <div className="set-col set-who">
        <div className="set-sprite">
          <MonSprite set={set} size={120} />
        </div>
        <button
          type="button"
          className={`field-btn species-btn${active({ kind: "species", slot }) ? " active" : ""}`}
          onClick={() => onPick({ kind: "species", slot })}
        >
          <span className="field-label">Pokémon</span>
          <strong>{set.species}</strong>
        </button>
        {row && (
          <div className="type-row">
            {row.types.map((t) => (
              <TypeTag key={t} type={t} />
            ))}
            {row.tier && <span className="tag">{row.tier}</span>}
          </div>
        )}
        <label className="field">
          <span className="field-label">Nickname</span>
          <input id="set-nick" type="text" maxLength={18} placeholder={set.species} value={set.name} onChange={(e) => onChange({ ...set, name: e.target.value })} />
        </label>
        <div className="set-details">
          <label className="field">
            <span className="field-label">Level</span>
            <input
              id="set-level"
              type="number"
              min={1}
              max={rules.maxLevel}
              value={rules.levelLocked ? rules.level : set.level}
              disabled={rules.levelLocked}
              title={rules.levelLocked ? `This format sets every Pokémon to level ${rules.level}` : undefined}
              onChange={(e) => onChange({ ...set, level: Math.max(1, Math.min(rules.maxLevel, Math.floor(Number(e.target.value)) || 1)) })}
            />
          </label>
          <label className="field">
            <span className="field-label">Gender</span>
            <select id="set-gender" value={gender ? "" : set.gender} disabled={!!gender} onChange={(e) => onChange({ ...set, gender: e.target.value })}>
              {gender ? (
                <option value="">{gender === "N" ? "None" : gender === "M" ? "Always male" : "Always female"}</option>
              ) : (
                <>
                  <option value="">Random</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </>
              )}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Tera Type</span>
            <select id="set-tera" value={set.teraType} onChange={(e) => onChange({ ...set, teraType: e.target.value })}>
              {engine.TERA_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input id="set-shiny" type="checkbox" checked={set.shiny} onChange={(e) => onChange({ ...set, shiny: e.target.checked })} />
            Shiny
          </label>
        </div>
        {row && (
          <Link to={`/pokedex/${row.num}`} className="small">
            Pokédex entry
          </Link>
        )}
      </div>

      <div className="set-col set-gear">
        <button type="button" className={`field-btn${active({ kind: "item", slot }) ? " active" : ""}`} onClick={() => onPick({ kind: "item", slot })}>
          <span className="field-label">Held item</span>
          <strong>{set.item || <span className="muted">No item</span>}</strong>
          {set.item && <span className="small muted">{engine.itemDesc(set.item)}</span>}
        </button>
        {wild ? (
          <button type="button" className={`field-btn${active({ kind: "ability", slot }) ? " active" : ""}`} onClick={() => onPick({ kind: "ability", slot })}>
            <span className="field-label">Ability (any)</span>
            <strong>{set.ability || <span className="muted">Choose an ability</span>}</strong>
            {set.ability && <span className="small muted">{engine.abilityDesc(set.ability)}</span>}
          </button>
        ) : (
          <label className="field ability-field">
            <span className="field-label">Ability</span>
            <select id="set-ability" value={set.ability} onChange={(e) => onChange({ ...set, ability: e.target.value })}>
              {!abilities.some((a) => a.name === set.ability) && <option value={set.ability}>{set.ability || "Choose"}</option>}
              {abilities.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                  {a.hidden ? " (hidden)" : ""}
                </option>
              ))}
            </select>
            <span className="small muted">{engine.abilityDesc(set.ability)}</span>
          </label>
        )}
        <div className="field">
          <span className="field-label">Moves</span>
          <ol className="move-slots">
            {[0, 1, 2, 3].map((i) => {
              const name = set.moves[i] ?? "";
              const move = name ? engine.moveRow(name) : null;
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`move-btn${active({ kind: "move", slot, index: i }) ? " active" : ""}`}
                    onClick={() => onPick({ kind: "move", slot, index: i })}
                  >
                    {move ? (
                      <>
                        <span>{move.name}</span>
                        <TypeTag type={move.type} />
                      </>
                    ) : (
                      <span className="muted">{name || `Choose move ${i + 1}`}</span>
                    )}
                  </button>
                  {name && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${name}`}
                      onClick={() => onChange({ ...set, moves: set.moves.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="set-col set-stats">
        <StatsEditor engine={engine} format={format} set={set} onChange={onChange} />
      </div>

      <div className="set-actions">
        <button type="button" className="secondary-btn small" onClick={() => onMove(-1)} disabled={slot === 0}>
          ← Move left
        </button>
        <button type="button" className="secondary-btn small" onClick={() => onMove(1)} disabled={slot >= count - 1}>
          Move right →
        </button>
        <button type="button" className="link-btn danger" onClick={onRemove}>
          Remove {set.name || set.species}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Team checks: Showdown's rules and type coverage

function TeamChecks({ engine, format, sets }: { engine: Engine; format: string; sets: PokemonSet[] }) {
  const problems = useMemo(() => engine.validateTeam(sets, format), [engine, sets, format]);
  const coverage = useMemo(
    () => engine.defensiveCoverage(sets).sort((a, b) => b.weak - (b.resist + b.immune) - (a.weak - (a.resist + a.immune)) || b.weak - a.weak),
    [engine, sets],
  );
  const info = engine.formatInfo(format);
  const [allTypes, setAllTypes] = useState(false);
  const shown = allTypes ? coverage : coverage.slice(0, 6);

  return (
    <aside className="team-checks" aria-label="Team checks">
      <section className="panel">
        <h2>Rules check</h2>
        {!sets.length ? (
          <p className="muted small">Add a Pokémon to check the team.</p>
        ) : problems.length ? (
          <>
            <p className="form-error">Not legal in {info.label} yet:</p>
            <ul className="problems">
              {problems.slice(0, 12).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
              {problems.length > 12 && <li>and {problems.length - 12} more.</li>}
            </ul>
          </>
        ) : (
          <p className="form-ok">
            Legal in {info.label}. Showdown will accept it as “{engine.showdownFormatName(format)}”.
          </p>
        )}
      </section>
      {sets.length > 0 && (
        <section className="panel">
          <h2>Defensive coverage</h2>
          <p className="muted small">How many of your team take extra damage from each attacking type, and how many resist it. Worst first.</p>
          <table className="coverage">
            <thead>
              <tr>
                <th scope="col">Attack</th>
                <th scope="col" className="num">
                  Weak
                </th>
                <th scope="col" className="num">
                  Resist
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.type} className={r.weak >= 3 || (r.weak > 0 && r.resist + r.immune === 0) ? "risk" : ""}>
                  <th scope="row">
                    <TypeTag type={r.type} />
                  </th>
                  <td className="num">{r.weak || "·"}</td>
                  <td className="num">
                    {r.resist + r.immune || "·"}
                    {r.immune > 0 && <span className="muted small"> ({r.immune} immune)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="link-btn" onClick={() => setAllTypes(!allTypes)}>
            {allTypes ? "Show fewer" : "Show all 18 types"}
          </button>
        </section>
      )}
      {isWild(format) && (
        <section className="panel">
          <h2>Battling with a wild team</h2>
          <p className="small">
            Wild teams break the normal rules, so Showdown's ranked formats won't take them. To battle one: export it, paste it into Showdown's
            teambuilder with the format set to “{engine.showdownFormatName(format)}”, then challenge a friend (their team can be wild too).
          </p>
        </section>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
// Import and export

export function ExportTeamModal({ text, format, onClose }: { text: string; format: string; onClose: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      area.current?.select();
    }
  };
  return (
    <Modal title="Export team" onClose={onClose}>
      <p className="muted small">
        This is Showdown's team format. On Showdown, open Teambuilder, choose New Team, press Import from text, paste this in, then set the format
        to “{format}”.
      </p>
      <textarea ref={area} id="team-export" className="deck-text mono" readOnly value={text} rows={18} onFocus={(e) => e.target.select()} />
      <div className="row-actions">
        <button type="button" className="primary-btn" onClick={copy}>
          {copied ? "Copied" : "Copy to clipboard"}
        </button>
      </div>
    </Modal>
  );
}

function ImportTeamModal({
  engine,
  format,
  room,
  onImport,
  onClose,
}: {
  engine: Engine;
  format: string;
  room: number;
  onImport: (sets: PokemonSet[], mode: "replace" | "add") => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = (mode: "replace" | "add") => {
    const res = engine.importTeam(text, format);
    if (!res.sets.length) {
      setError("We couldn't find any Pokémon in that text. It should look like Showdown's export, starting with a line such as “Garchomp @ Choice Scarf”.");
      setProblems(res.problems);
      return;
    }
    let sets = res.sets;
    const extra = [...res.problems];
    if (mode === "add" && sets.length > room) {
      extra.push(`Your team only had room for ${room} more, so the rest were left out.`);
      sets = sets.slice(0, room);
    }
    onImport(sets, mode);
    if (extra.length) {
      setProblems(extra);
      setError(null);
    } else onClose();
  };

  return (
    <Modal title="Import from Showdown" onClose={onClose}>
      {problems.length && !error ? (
        <>
          <p className="form-ok">Imported. A few things to know:</p>
          <ul className="not-found">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <div className="row-actions">
            <button type="button" className="primary-btn" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            On Showdown, open your team in the Teambuilder and press Import/Export, then copy the text and paste it here. One Pokémon or a whole
            team both work.
          </p>
          <textarea
            id="team-import"
            className="deck-text mono"
            rows={16}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Garchomp @ Choice Scarf\nAbility: Rough Skin\nTera Type: Steel\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang"}
          />
          {error && <p className="form-error">{error}</p>}
          <div className="row-actions">
            <button type="button" className="primary-btn" onClick={() => run("replace")} disabled={!text.trim()}>
              Replace my team
            </button>
            <button type="button" className="secondary-btn" onClick={() => run("add")} disabled={!text.trim() || room === 0}>
              Add to my team
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// The page

export function TeamBuilderPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, ready } = useAuth();
  const { engine, error: engineError } = useEngine();
  const existing = useApi<TeamDetail>(id ? `/api/teams/${id}` : null, { fresh: true });

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("New team");
  const [format, setFormat] = useState(DEFAULT_FORMAT);
  const [isPublic, setIsPublic] = useState(false);
  const [sets, setSets] = useState<PokemonSet[]>([]);
  const [slot, setSlot] = useState(0);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [modal, setModal] = useState<"import" | "export" | "delete" | null>(params.get("import") ? "import" : null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Load the saved team (or a draft started before logging in) once the Pokémon data is ready.
  useEffect(() => {
    if (!engine || loaded) return;
    if (id) {
      if (!existing.data) return;
      const d = existing.data;
      setName(d.name);
      setFormat(d.format);
      setIsPublic(d.isPublic);
      setSets(
        d.sets.map((s, i) => engine.completeSet(d.format, { ...s, species: engine.resolveSpecies(s.species, d.preview[i]?.sprite) ?? s.species })),
      );
      // A Pokémon added from the Pokédex arrives with level 0; filling it in counts as a change to save.
      setDirty(d.sets.some((s) => !s.level));
      setLoaded(true);
      return;
    }
    const draft = readDraft();
    let start: PokemonSet[] = [];
    let f = DEFAULT_FORMAT;
    if (draft && !params.get("fresh")) {
      setName(draft.name);
      setFormat(draft.format);
      f = draft.format;
      setIsPublic(draft.isPublic);
      start = draft.sets;
    }
    const add = params.get("add");
    if (add) {
      const species = engine.resolveSpecies(add, Number(params.get("num")) || 0);
      if (species && start.length < 6) start = [...start, engine.newSet(f, species)];
    }
    setSets(start);
    setSlot(Math.max(0, start.length - 1));
    setDirty(start.length > 0);
    setLoaded(true);
  }, [engine, id, existing.data, loaded, params]);

  useEffect(() => {
    if (!id && loaded && dirty) writeDraft({ name, format, isPublic, sets });
  }, [id, loaded, dirty, name, format, isPublic, sets]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (picker && pickerRef.current && pickerRef.current.getBoundingClientRect().top > window.innerHeight - 120) {
      pickerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [picker]);

  const change = (fn: () => void) => {
    fn();
    setDirty(true);
    setMessage(null);
  };
  const updateSet = (i: number, s: PokemonSet) => change(() => setSets((list) => list.map((x, j) => (j === i ? s : x))));

  const changeFormat = (next: string) => {
    if (!engine) return;
    const before = engine.formatRules(format);
    const after = engine.formatRules(next);
    change(() => {
      setFormat(next);
      setSets((list) =>
        list.map((s) => ({ ...s, level: s.level === before.level || s.level > after.maxLevel ? Math.min(after.level, after.maxLevel) : s.level })),
      );
    });
  };

  const pick = (value: string) => {
    if (!engine || !picker) return;
    if (picker.kind === "species") {
      if (picker.slot === "new") {
        const s = engine.newSet(format, value);
        change(() => setSets((list) => [...list, s]));
        setSlot(sets.length);
        setPicker({ kind: "move", slot: sets.length, index: 0 });
      } else {
        const old = sets[picker.slot];
        const fresh = engine.newSet(format, value);
        // Keep what still makes sense for the new Pokémon: nickname, item, nature, EVs and moves it can use.
        const moves = old.moves.filter((m) => engine.canLearn(format, value, m));
        updateSet(picker.slot, { ...fresh, name: old.name, item: old.item, nature: old.nature, evs: old.evs, ivs: old.ivs, level: old.level, shiny: old.shiny, moves });
        setPicker(null);
      }
      return;
    }
    const set = sets[picker.slot];
    if (picker.kind === "item") updateSet(picker.slot, { ...set, item: value });
    if (picker.kind === "ability") updateSet(picker.slot, { ...set, ability: value });
    if (picker.kind === "move") {
      const moves = [...set.moves];
      const at = Math.min(picker.index, moves.length);
      moves[at] = value;
      updateSet(picker.slot, { ...set, moves: moves.filter(Boolean) });
      const next = moves.filter(Boolean).length;
      setPicker(next < 4 ? { kind: "move", slot: picker.slot, index: next } : null);
      return;
    }
    setPicker(null);
  };

  const save = async () => {
    if (!engine) return;
    if (!user) {
      writeDraft({ name, format, isPublic, sets });
      navigate(`/login?next=${encodeURIComponent("/teams/new")}`);
      return;
    }
    setSaving(true);
    setMessage(null);
    const body = { name, format, isPublic, sets, preview: engine.previewOf(sets) };
    try {
      if (id) {
        await send("PUT", `/api/teams/${id}`, body);
      } else {
        const res = await send<{ id: string }>("POST", "/api/teams", body);
        writeDraft(null);
        setDirty(false);
        navigate(`/teams/${res.id}/edit`, { replace: true });
      }
      setDirty(false);
      const problems = engine.validateTeam(sets, format);
      setMessage({ ok: true, text: problems.length ? "Saved. The rules check lists what to fix before Showdown will accept it." : "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    await send("DELETE", `/api/teams/${id}`);
    setDirty(false);
    navigate("/teams", { replace: true });
  };

  const exportText = useMemo(() => (engine && modal === "export" ? engine.exportTeam(sets) : ""), [engine, modal, sets]);

  if (id && existing.error === "Team not found") return <NotFoundPage what="team" />;
  if (id && existing.error) return <ErrorBox message={existing.error} />;
  if (engineError) return <ErrorBox message={engineError} />;
  if (!engine || !loaded || !ready) return <Loading label="Loading the Pokémon data" />;
  if (id && existing.data && !existing.data.isOwner) {
    return (
      <div className="empty-state">
        <h1>This team belongs to {existing.data.owner.trainerName}</h1>
        <p>
          You can <Link to={`/teams/${id}`}>view it</Link> and copy it to your own teams from there.
        </p>
      </div>
    );
  }

  const info = engine.formatInfo(format);
  const current = sets[slot] ? slot : -1;
  const pickerSet = picker && picker.slot !== "new" ? sets[picker.slot] : null;

  return (
    <div className="builder team-builder">
      <div className="builder-bar">
        <label className="builder-name">
          <span className="sr-only">Team name</span>
          <input id="team-name" value={name} maxLength={60} onChange={(e) => change(() => setName(e.target.value))} />
        </label>
        <label>
          <span className="sr-only">Format</span>
          <select id="team-format" value={format} onChange={(e) => changeFormat(e.target.value)}>
            {!FORMATS.some((f) => f.id === format) && <option value={format}>{info.label}</option>}
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {FORMATS.filter((f) => f.group === g).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="check">
          <input id="team-public" type="checkbox" checked={isPublic} onChange={(e) => change(() => setIsPublic(e.target.checked))} />
          Show on my profile
        </label>
        <div className="builder-actions">
          <button type="button" className="secondary-btn" onClick={() => setModal("import")}>
            Import
          </button>
          <button type="button" className="secondary-btn" onClick={() => setModal("export")} disabled={!sets.length}>
            Export
          </button>
          <button type="button" className="primary-btn" onClick={save} disabled={saving || (!!id && !dirty)}>
            {saving ? "Saving…" : !user ? "Log in to save" : id && !dirty ? "Saved" : "Save team"}
          </button>
        </div>
      </div>
      <p className={`format-note small${info.group === "Wild" ? " wild" : ""}`}>
        <strong>{info.label}.</strong> {info.blurb}
      </p>
      {message && <p className={message.ok ? "form-ok" : "form-error"}>{message.text}</p>}
      {!user && (
        <p className="muted small">
          You can build without an account. Your team is kept in this browser until you <Link to="/signup?next=/teams/new">create an account</Link> to
          save it.
        </p>
      )}

      <nav className="team-slots" aria-label="Your team">
        {sets.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`team-slot${i === current ? " active" : ""}`}
            aria-current={i === current}
            onClick={() => {
              setSlot(i);
              setPicker(null);
            }}
          >
            <MonSprite set={s} size={56} />
            <span className="team-slot-name">{s.name || s.species}</span>
            <span className="team-slot-meta small muted">{s.item || "No item"}</span>
          </button>
        ))}
        {sets.length < 6 && (
          <button
            type="button"
            className={`team-slot add${picker?.kind === "species" && picker.slot === "new" ? " active" : ""}`}
            onClick={() => setPicker({ kind: "species", slot: "new" })}
          >
            <span className="plus" aria-hidden="true">
              +
            </span>
            <span className="team-slot-name">Add Pokémon</span>
            <span className="team-slot-meta small muted">{6 - sets.length} spaces left</span>
          </button>
        )}
      </nav>

      <div className="team-grid-main">
        <div className="team-work">
          {current >= 0 ? (
            <SetEditor
              engine={engine}
              format={format}
              set={sets[current]}
              slot={current}
              count={sets.length}
              picker={picker}
              onChange={(s) => updateSet(current, s)}
              onPick={(p) => setPicker(JSON.stringify(p) === JSON.stringify(picker) ? null : p)}
              onMove={(by) => {
                const to = current + by;
                change(() =>
                  setSets((list) => {
                    const next = [...list];
                    [next[current], next[to]] = [next[to], next[current]];
                    return next;
                  }),
                );
                setSlot(to);
                setPicker(null);
              }}
              onRemove={() => {
                change(() => setSets((list) => list.filter((_, j) => j !== current)));
                setSlot(Math.max(0, current - 1));
                setPicker(null);
              }}
            />
          ) : (
            !picker && (
              <div className="empty-state panel">
                <h2>Your team is empty</h2>
                <p>Add up to six Pokémon, or import a team you already have on Showdown.</p>
                <div className="row-actions">
                  <button type="button" className="primary-btn" onClick={() => setPicker({ kind: "species", slot: "new" })}>
                    Add a Pokémon
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => setModal("import")}>
                    Import from Showdown
                  </button>
                </div>
              </div>
            )
          )}

          {picker && (
            <div className="picker-wrap" ref={pickerRef}>
              <div className="picker-title">
                <h2>
                  {picker.kind === "species"
                    ? picker.slot === "new"
                      ? "Choose a Pokémon to add"
                      : `Change ${pickerSet?.species}`
                    : picker.kind === "item"
                      ? `Held item for ${pickerSet?.species}`
                      : picker.kind === "ability"
                        ? `Ability for ${pickerSet?.species}`
                        : `Move ${picker.index + 1} for ${pickerSet?.species}`}
                </h2>
                <button type="button" className="icon-btn" aria-label="Close the list" onClick={() => setPicker(null)}>
                  ×
                </button>
              </div>
              {picker.kind === "species" && <SpeciesPicker engine={engine} format={format} onPick={pick} />}
              {picker.kind === "item" && (
                <NamedPicker id="pick-item" rows={engine.itemsFor(format)} placeholder="Search items" none="No item" onPick={pick} />
              )}
              {picker.kind === "ability" && pickerSet && (
                <NamedPicker id="pick-ability" rows={engine.abilitiesFor(format, pickerSet.species)} placeholder="Search abilities" onPick={pick} />
              )}
              {picker.kind === "move" && pickerSet && (
                <MovePicker key={`${picker.slot}-${picker.index}`} engine={engine} format={format} set={pickerSet} index={picker.index} onPick={pick} />
              )}
            </div>
          )}

          {id && (
            <div className="deck-tools">
              <div className="row-actions">
                {isPublic && !dirty && (
                  <Link to={`/teams/${id}`} className="secondary-btn">
                    Open the share page
                  </Link>
                )}
                <button type="button" className="link-btn danger" onClick={() => setModal("delete")}>
                  Delete team
                </button>
              </div>
            </div>
          )}
        </div>

        <TeamChecks engine={engine} format={format} sets={sets} />
      </div>

      {modal === "import" && (
        <ImportTeamModal
          engine={engine}
          format={format}
          room={6 - sets.length}
          onClose={() => setModal(null)}
          onImport={(list, mode) => {
            change(() => setSets((old) => (mode === "replace" ? list : [...old, ...list].slice(0, 6))));
            setSlot(mode === "replace" ? 0 : sets.length);
            setPicker(null);
          }}
        />
      )}
      {modal === "export" && <ExportTeamModal text={exportText} format={engine.showdownFormatName(format)} onClose={() => setModal(null)} />}
      {modal === "delete" && (
        <Modal title="Delete this team?" onClose={() => setModal(null)}>
          <p>“{name}” will be deleted for good.</p>
          <div className="row-actions">
            <button type="button" className="danger-btn" onClick={remove}>
              Delete team
            </button>
            <button type="button" className="secondary-btn" onClick={() => setModal(null)}>
              Keep it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
