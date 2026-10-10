// "Show the maths": the step-by-step working for one hit or one accuracy check, using the numbers
// the battle engine actually used.

import type { AccuracyCalc, Calc, DamageCalc, Mod, StatLine } from "../../battle/trace";

const NICE_NAMES: Record<string, string> = {
  RainDance: "Rain",
  SunnyDay: "Sun",
  DesolateLand: "Harsh sun",
  PrimordialSea: "Heavy rain",
  Snowscape: "Snow",
  Sandstorm: "Sandstorm",
  electricterrain: "Electric Terrain",
  grassyterrain: "Grassy Terrain",
  psychicterrain: "Psychic Terrain",
  mistyterrain: "Misty Terrain",
};
const nice = (name: string) => NICE_NAMES[name] ?? name;
const times = (m: number) => `×${Number.isInteger(m) ? m : Number(m.toFixed(3))}`;
const STAGE_MULT = ["2/8", "2/7", "2/6", "2/5", "2/4", "2/3", "2/2", "3/2", "4/2", "5/2", "6/2", "7/2", "8/2"];
const ACC_MULT = ["3/9", "3/8", "3/7", "3/6", "3/5", "3/4", "3/3", "4/3", "5/3", "6/3", "7/3", "8/3", "9/3"];

function Mods({ mods }: { mods: Mod[] }) {
  if (!mods.length) return null;
  return (
    <>
      {mods.map((m, i) => (
        <span key={i} className="calc-mod">
          {nice(m.name)} {times(m.mult)}
        </span>
      ))}
    </>
  );
}

function Stat({ line, label }: { line: StatLine; label: string }) {
  return (
    <li>
      <span className="calc-step">{label}</span>
      <span>
        {line.pokemon}'s {line.stat} <b>{line.raw}</b>
        {line.stage !== 0 && (
          <span className="calc-mod">
            {line.stageIgnored ? `stage ${line.stage > 0 ? "+" : ""}${line.stage} ignored` : `stage ${line.stage > 0 ? "+" : ""}${line.stage} (${STAGE_MULT[line.stage + 6]}) → ${line.afterStage}`}
          </span>
        )}
        <Mods mods={line.mods} />
        {line.value !== line.afterStage && <> → <b>{line.value}</b></>}
      </span>
    </li>
  );
}

function DamageCard({ c }: { c: DamageCalc }) {
  const maxhp = c.defenderMaxHp;
  const min = Math.min(...c.rolls);
  const max = Math.max(...c.rolls);
  const pct = (n: number) => (maxhp ? ` (${((n / maxhp) * 100).toFixed(1)}%)` : "");
  const typeWord = c.typeMult === 0 ? "no effect" : c.typeMult > 1 ? "super effective" : c.typeMult < 1 ? "not very effective" : "neutral";
  const lvlTerm = Math.floor((2 * c.level) / 5 + 2);
  return (
    <div className="calc-card">
      <p className="calc-title">
        <strong>
          {c.move}
          {c.hit > 0 ? ` (hit ${c.hit})` : ""}:
        </strong>{" "}
        {c.attacker} → {c.defender}
        <span className={`calc-type type-${c.moveType.toLowerCase()}`}>{c.moveType}</span>
        <span className="muted small"> {c.category}</span>
      </p>
      <ol className="calc-steps">
        <li>
          <span className="calc-step">Power</span>
          <span>
            {c.basePower.raw}
            <Mods mods={c.basePower.mods} />
            {c.basePower.value !== c.basePower.raw && <> → <b>{c.basePower.value}</b></>}
          </span>
        </li>
        {c.attack && <Stat line={c.attack} label="Attack" />}
        {c.defense && <Stat line={c.defense} label="Defence" />}
        <li>
          <span className="calc-step">Base damage</span>
          <span>
            ⌊⌊⌊2×{c.level}÷5+2⌋ × {c.basePower.value} × {c.attack?.value ?? "A"} ÷ {c.defense?.value ?? "D"}⌋ ÷ 50⌋ + 2 ={" "}
            <b>{c.baseDamage + 2}</b>
            <span className="muted small"> (level part = {lvlTerm})</span>
          </span>
        </li>
        {c.spread && (
          <li>
            <span className="calc-step">Spread</span>
            <span>Hits more than one target {times(c.spread)}</span>
          </li>
        )}
        {c.parentalBond && (
          <li>
            <span className="calc-step">Parental Bond</span>
            <span>Second hit {times(c.parentalBond)}</span>
          </li>
        )}
        {c.weather.length > 0 && (
          <li>
            <span className="calc-step">Weather</span>
            <span>
              <Mods mods={c.weather} />
            </span>
          </li>
        )}
        <li>
          <span className="calc-step">Critical hit</span>
          <span>
            {c.crit.always ? (
              "This move always lands a critical hit"
            ) : c.crit.chance === "none" ? (
              "Can't crit"
            ) : (
              <>
                Stage {c.crit.stage}, a {c.crit.chance} chance
                {c.crit.roll !== null && <span className="muted small"> (rolled {c.crit.roll})</span>}
              </>
            )}
            {c.crit.happened ? (
              <b className="calc-good"> Critical hit! ×1.5, ignoring the attacker's drops and the defender's boosts</b>
            ) : (
              <span className="muted"> no crit</span>
            )}
          </span>
        </li>
        <li>
          <span className="calc-step">Random roll</span>
          <span>
            {c.preRandom} × <b>{c.roll}%</b> (a random 85% to 100%)
          </span>
        </li>
        <li>
          <span className="calc-step">STAB</span>
          <span>
            {c.stab === 1 ? "None (the move's type doesn't match the user)" : times(c.stab)}
            {c.stabNote && <span className="muted small"> {c.stabNote}</span>}
          </span>
        </li>
        <li>
          <span className="calc-step">Type</span>
          <span>
            {c.moveType} vs {c.defenderTypes.join("/")}: <b>{times(c.typeMult)}</b> <span className="muted small">{typeWord}</span>
          </span>
        </li>
        {c.burn && (
          <li>
            <span className="calc-step">Burn</span>
            <span>Burned attacker, physical move ×0.5</span>
          </li>
        )}
        {c.final.mods.length > 0 && (
          <li>
            <span className="calc-step">Other</span>
            <span>
              <Mods mods={c.final.mods} />
            </span>
          </li>
        )}
      </ol>
      <p className="calc-result">
        Damage: <b>{c.damage}</b>
        {pct(c.damage)}
        <span className="muted">
          {" "}
          · possible range {min}–{max}
          {maxhp ? ` (${((min / maxhp) * 100).toFixed(1)}–${((max / maxhp) * 100).toFixed(1)}%)` : ""}
        </span>
      </p>
      <details className="calc-rolls">
        <summary>All 16 rolls</summary>
        <span>
          {c.rolls.map((r, i) => (
            <span key={i} className={i === c.roll - 85 ? "calc-roll-hit" : ""}>
              {r}
              {i < 15 ? ", " : ""}
            </span>
          ))}
        </span>
      </details>
    </div>
  );
}

function AccuracyCard({ c }: { c: AccuracyCalc }) {
  const pctOrAlways = (v: number | true) => (v === true ? "always hits" : `${v}%`);
  return (
    <div className="calc-card">
      <p className="calc-title">
        <strong>{c.move}</strong> accuracy: {c.attacker} → {c.defender}
      </p>
      <ol className="calc-steps">
        <li>
          <span className="calc-step">Accuracy</span>
          <span>
            {c.ohko ? "One-hit KO move: 30% plus the level difference" : pctOrAlways(c.base)}
            {c.modified !== c.base && <> → {pctOrAlways(c.modified)} <span className="muted small">(abilities, items, weather)</span></>}
          </span>
        </li>
        {c.stage !== 0 && c.modified !== true && (
          <li>
            <span className="calc-step">Stages</span>
            <span>
              Accuracy minus evasion = {c.stage > 0 ? "+" : ""}
              {c.stage}, so × {ACC_MULT[c.stage + 6]}
            </span>
          </li>
        )}
        <li>
          <span className="calc-step">Final</span>
          <span>{pctOrAlways(c.final)}</span>
        </li>
        {c.roll !== null && c.final !== true && (
          <li>
            <span className="calc-step">Roll</span>
            <span>
              Rolled {c.roll} (needs under {c.final}): <b className={c.hit ? "calc-good" : "calc-bad"}>{c.hit ? "Hit!" : "Missed!"}</b>
            </span>
          </li>
        )}
      </ol>
    </div>
  );
}

export function CalcCard({ calc }: { calc: Calc }) {
  return calc.kind === "damage" ? <DamageCard c={calc} /> : <AccuracyCard c={calc} />;
}

/** One-line rules for damage and healing that isn't from a move, shown next to the log message. */
export const RESIDUAL_HINTS: Record<string, string> = {
  brn: "Burn: 1/16 of max HP each turn",
  psn: "Poison: 1/8 of max HP each turn (bad poison: 1/16, 2/16, 3/16… rising each turn)",
  tox: "Bad poison: 1/16 of max HP, then 2/16, 3/16… each turn",
  "Leech Seed": "Leech Seed: 1/8 of max HP, given to the Pokémon that planted it",
  Sandstorm: "Sandstorm: 1/16 of max HP each turn (Rock, Ground and Steel types are safe)",
  "Stealth Rock": "Stealth Rock: 1/8 of max HP × how weak it is to Rock",
  Spikes: "Spikes: 1/8, 1/6 or 1/4 of max HP for 1, 2 or 3 layers",
  Recoil: "Recoil: a share of the damage dealt (1/3 for Brave Bird, 1/4 for Take Down)",
  "Life Orb": "Life Orb: 1/10 of max HP after each hit",
  "Rocky Helmet": "Rocky Helmet: 1/6 of the attacker's max HP",
  "Rough Skin": "Rough Skin: 1/8 of the attacker's max HP",
  "Iron Barbs": "Iron Barbs: 1/8 of the attacker's max HP",
  Leftovers: "Leftovers: heals 1/16 of max HP each turn",
  "Black Sludge": "Black Sludge: heals Poison types 1/16 of max HP, hurts others 1/8",
  "Grassy Terrain": "Grassy Terrain: heals 1/16 of max HP each turn for grounded Pokémon",
  drain: "Draining move: heals a share of the damage dealt (usually half)",
  confusion: "Confusion: hits itself with a 40-power typeless attack",
  "Salt Cure": "Salt Cure: 1/8 of max HP each turn (1/4 for Water and Steel types)",
  "Sitrus Berry": "Sitrus Berry: heals 1/4 of max HP below half HP",
  "Shell Bell": "Shell Bell: heals 1/8 of the damage dealt",
  "Poison Heal": "Poison Heal: heals 1/8 of max HP instead of poison damage",
};
