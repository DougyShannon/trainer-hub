import { energyProvides } from "../../shared/practice/engine";
import type { PCard } from "../../shared/practice/types";
import { Energy } from "./ui";

// Attached Energy drawn the way it sits on a real table: cards tucked under the Pokémon with
// their Energy symbol peeking out below, plus a "Ready" tag when it can pay for an attack.

type EnergyCard = { uid: string; name: string; supertype: string; subtypes: string[] };

export const energyUnits = (cards: EnergyCard[]) =>
  cards.filter((c) => c.supertype === "Energy").flatMap((c) => energyProvides(c as unknown as PCard));

export function EnergyTuck({ energy }: { energy: EnergyCard[] }) {
  const cards = energy.filter((c) => c.supertype === "Energy");
  if (!cards.length) return null;
  return (
    <span className="tuck" aria-label={`Energy attached: ${cards.map((c) => c.name).join(", ")}`}>
      {cards.map((c) => (
        <span key={c.uid} className="tuck-card" title={c.name}>
          {energyProvides(c as unknown as PCard).map((t, i) => (
            <Energy key={i} type={t} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Shows on a Pokémon that has enough Energy for at least one of its attacks. */
export function ReadyTag({ attacks }: { attacks: string[] }) {
  if (!attacks.length) return null;
  return (
    <span className="ready-tag" title={`Can use ${attacks.join(" or ")}`}>
      Ready
    </span>
  );
}
