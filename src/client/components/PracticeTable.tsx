import { useEffect, useRef, useState, type ReactNode } from "react";
import { otherSeat, type CardRef, type Condition, type Seat } from "../../shared/game-types";
import {
  BENCH_SIZE,
  attackCost,
  canPay,
  cantAttackReason,
  cantPlayTrainerReason,
  cantRetreatReason,
  evolveTargets,
  isAutomated,
  isBasicPokemon,
  isEnergy,
  isItem,
  isPokemon,
  isStadium,
  isSupporter,
  isTool,
  maxHp,
  prizeValue,
  retreatCost,
  slotAt,
  slotKeys,
  topCard,
  usableAttacks,
} from "../../shared/practice/engine";
import type { PAction, PCard, PPlayer, PSlot, PState, SlotKey } from "../../shared/practice/types";
import { sprite } from "../lib/sprites";
import { ByHandPanel, type ByHandFor } from "./ByHand";
import { CardSummary, CardText, useCardDetail } from "./CardFacts";
import { CardPreview, GameCard } from "./GameTable";
import { CardZoom } from "./CardZoom";
import { useCardDrag } from "./DragDrop";
import { EnergyTuck, ReadyTag } from "./EnergyTuck";
import { TurnGuide, type GuideRow } from "./TurnGuide";
import { Energy } from "./ui";

type Sel = { kind: "hand"; uid: string } | { kind: "slot"; side: Seat; key: SlotKey } | null;

const CONDITION_LABEL: Record<Condition, string> = {
  asleep: "Asleep",
  confused: "Confused",
  paralyzed: "Paralyzed",
  poisoned: "Poisoned",
  burned: "Burned",
};

/** The live table's card pieces take a CardRef; practice cards carry the same details. */
const ref = (c: PCard): CardRef => ({
  uid: c.uid,
  cardId: c.id,
  name: c.name,
  supertype: c.supertype,
  subtypes: c.subtypes,
  hp: c.hp,
  image: c.image,
  imageLarge: c.imageLarge,
});

/** A card's own words, without the reminder about how many of its kind you can play. */
const cardText = (card: PCard) => card.rules.filter((r) => !/^You may play (only 1|as many|any number)/i.test(r) && !/^ACE SPEC:/i.test(r));

const where = (key: SlotKey) => (key === "active" ? "Active" : `Bench ${Number(key.split(":")[1]) + 1}`);

/** Attacks this Pokémon has enough Energy attached for right now. */
const readyAttacks = (state: PState, slot: PSlot) =>
  topCard(slot)
    .attacks.filter((a) => canPay(attackCost(state, slot, a), slot.energy))
    .map((a) => a.name);

function PracticeSlot({
  slot,
  label,
  onClick,
  selected,
  highlight,
  ready,
  drop,
  dropState = "",
}: {
  slot: PSlot | null;
  label: string;
  onClick?: () => void;
  selected?: boolean;
  highlight?: boolean;
  ready?: string[];
  drop?: string;
  dropState?: "" | "ok" | "over";
}) {
  const dropCls = dropState ? ` drop-${dropState}` : "";
  if (!slot) {
    return (
      <div className={`slot empty${dropCls}`} aria-label={`${label}: empty`} data-drop={drop}>
        <span className="gcard md empty" />
      </div>
    );
  }
  const top = topCard(slot);
  const hp = maxHp(slot);
  return (
    <button
      type="button"
      className={`slot${selected ? " selected" : ""}${highlight ? " target" : ""}${slot.energy.length ? " has-energy" : ""}${dropCls}`}
      onClick={onClick}
      data-drop={drop}
      aria-label={`${label}: ${top.name}, ${Math.max(0, hp - slot.damage)} of ${hp} HP left`}
    >
      <GameCard card={ref(top)} damage={{ taken: slot.damage, hp }} />
      <EnergyTuck energy={slot.energy} />
      {ready && <ReadyTag attacks={ready} />}
      {slot.pokemon.length > 1 && <span className="stack-count">×{slot.pokemon.length}</span>}
      {slot.conditions.length > 0 && (
        <span className="conds">
          {slot.conditions.map((c) => (
            <span key={c} className={`cond c-${c}`}>
              {CONDITION_LABEL[c]}
            </span>
          ))}
        </span>
      )}
      {slot.tool && (
        <span className="attached">
          <span className="att tool" title={slot.tool.name}>
            {slot.tool.name}
          </span>
        </span>
      )}
    </button>
  );
}

function Side({
  state,
  p,
  seat,
  flipped,
  tag,
  sel,
  targets,
  onSlot,
  onDiscard,
  dropState,
}: {
  state: PState;
  p: PPlayer;
  seat: Seat;
  flipped?: boolean;
  tag: ReactNode;
  sel: Sel;
  targets?: SlotKey[];
  onSlot: (key: SlotKey) => void;
  onDiscard: () => void;
  /** Only your own side takes dropped cards. */
  dropState?: (target: string) => "" | "ok" | "over";
}) {
  const isSel = (key: SlotKey) => sel?.kind === "slot" && sel.side === seat && sel.key === key;
  const zones = (
    <div className="zones">
      <div className="pile">
        {p.deck.length ? <GameCard card={null} size="sm" label={`Deck: ${p.deck.length} cards`} /> : <span className="gcard sm empty" />}
        <span className="pile-label">
          Deck <strong>{p.deck.length}</strong>
        </span>
      </div>
      <div className="pile">
        {p.discard.length ? (
          <GameCard card={ref(p.discard[p.discard.length - 1])} size="sm" onClick={onDiscard} label={`Discard pile: ${p.discard.length} cards`} />
        ) : (
          <span className="gcard sm empty" />
        )}
        <span className="pile-label">
          Discard <strong>{p.discard.length}</strong>
        </span>
      </div>
      <div className="pile">
        {p.prizes.length ? <GameCard card={null} size="sm" label={`Prize cards: ${p.prizes.length} left`} /> : <span className="gcard sm empty" />}
        <span className="pile-label">
          Prizes <strong>{p.prizes.length}</strong>
        </span>
      </div>
    </div>
  );
  const active = (
    <div className="active-row">
      {tag}
      <PracticeSlot
        slot={p.active}
        label="Active Pokémon"
        selected={isSel("active")}
        highlight={targets?.includes("active")}
        onClick={() => onSlot("active")}
        ready={p.active && state.status === "playing" ? readyAttacks(state, p.active) : undefined}
        drop={dropState && p.active ? "active" : undefined}
        dropState={dropState?.("active")}
      />
      {zones}
    </div>
  );
  const bench = (
    <div className="bench" aria-label={`${p.name}'s Bench`}>
      {Array.from({ length: BENCH_SIZE }, (_, i) => {
        const key = `bench:${i}` as SlotKey;
        const slot = p.bench[i] ?? null;
        const drop = !dropState ? undefined : slot ? key : "bench-empty";
        return (
          <PracticeSlot
            key={i}
            slot={slot}
            label={`Bench ${i + 1}`}
            selected={isSel(key)}
            highlight={targets?.includes(key)}
            onClick={() => onSlot(key)}
            ready={slot && state.status === "playing" ? readyAttacks(state, slot) : undefined}
            drop={drop}
            dropState={drop ? dropState?.(drop) : ""}
          />
        );
      })}
    </div>
  );
  return <div className={`side${flipped ? " flipped" : ""}`}>{flipped ? <>{bench}{active}</> : <>{active}{bench}</>}</div>;
}

function Cost({ cost }: { cost: string[] }) {
  return (
    <span className="type-row">
      {cost.length ? cost.map((c, i) => <Energy key={i} type={c} />) : <Energy type="Free" />}
    </span>
  );
}

/** Everything about a Pokémon in play, with its attacks (as buttons when it's yours and Active). */
function PokemonInfo({
  state,
  seat,
  slotKey,
  mine,
  act,
  byHand,
}: {
  state: PState;
  seat: Seat;
  slotKey: SlotKey;
  mine: boolean;
  act: (a: PAction) => void;
  byHand: (about: ByHandFor) => void;
}) {
  const p = state.players[seat];
  const slot = slotAt(p, slotKey);
  const [retreating, setRetreating] = useState(false);
  if (!slot) return null;
  const top = topCard(slot);
  const hp = maxHp(slot);
  const myTurn = state.status === "playing" && state.current === seat && !state.prompt && !state.pendingEnd;
  const attackBlock = mine && slotKey === "active" ? cantAttackReason(state, seat) : null;
  const retreatBlock = mine ? cantRetreatReason(state, seat) : null;

  return (
    <div className="practice-info">
      <p className="small">
        <strong>
          {Math.max(0, hp - slot.damage)}/{hp} HP
        </strong>
        {top.weaknesses.length > 0 && <> · Weak to {top.weaknesses.map((w) => `${w.type} ${w.value}`).join(", ")}</>}
        {top.resistances.length > 0 && <> · Resists {top.resistances.map((r) => `${r.type} ${r.value}`).join(", ")}</>}
        {" · "}Retreat {retreatCost(slot, state.turn)}
        {prizeValue(top) > 1 && <> · Worth {prizeValue(top)} Prize cards</>}
      </p>
      {(slot.energy.length > 0 || slot.tool) && (
        <p className="small muted">
          Attached: {[...slot.energy.map((e) => e.name), ...(slot.tool ? [slot.tool.name] : [])].join(", ")}
        </p>
      )}
      {top.abilities.map((a) => (
        <div key={a.name} className="practice-attack ability">
          <strong>
            {a.type}: {a.name}
          </strong>
          <span className="small">{a.text}</span>
          {mine && myTurn ? (
            <button type="button" className="secondary-btn small" onClick={() => byHand({ card: top, text: [`${a.name}: ${a.text}`], why: "The game doesn't use Abilities for you. Do what it says with these moves." })}>
              Use {a.name} by hand
            </button>
          ) : (
            <span className="small muted">The game doesn't use Abilities for you: its owner does what it says with the By hand moves.</span>
          )}
        </div>
      ))}
      {top.attacks.map((a, i) => {
        const cost = attackCost(state, slot, a);
        const payable = canPay(cost, slot.energy);
        const usable = mine && slotKey === "active" && myTurn && !attackBlock && payable;
        return (
          <div key={a.name + i} className={`practice-attack${usable ? " ready" : ""}`}>
            <div className="practice-attack-head">
              <Cost cost={cost} />
              <strong>{a.name}</strong>
              <span className="practice-dmg">{a.damage}</span>
            </div>
            {a.text && <span className="small">{a.text}</span>}
            {mine && slotKey === "active" && myTurn && (
              <button type="button" className={usable ? "primary-btn small" : "secondary-btn small"} disabled={!usable} onClick={() => act({ type: "attack", index: i })}>
                {usable ? `Use ${a.name}` : attackBlock ?? "Needs more Energy"}
              </button>
            )}
          </div>
        );
      })}
      {mine && myTurn && slotKey === "active" && (
        <div className="action-buttons">
          {retreatBlock ? (
            <span className="small muted">{retreatBlock}</span>
          ) : retreating ? (
            <>
              <span className="small">Switch with:</span>
              {p.bench.map((s, i) => (
                <button key={i} type="button" className="secondary-btn small" onClick={() => act({ type: "retreat", bench: i })}>
                  {topCard(s).name}
                </button>
              ))}
              <button type="button" className="link-btn" onClick={() => setRetreating(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="secondary-btn small" onClick={() => setRetreating(true)}>
              Retreat (discard {retreatCost(slot, state.turn)} Energy)…
            </button>
          )}
        </div>
      )}
      {mine && myTurn && slotKey !== "active" && !retreatBlock && (
        <div className="action-buttons">
          <button type="button" className="secondary-btn small" onClick={() => act({ type: "retreat", bench: Number(slotKey.split(":")[1]) })}>
            Retreat your Active and send this in
          </button>
        </div>
      )}
    </div>
  );
}

/** What you can do with a card in your hand right now. */
function HandCardActions({ state, me, card, act }: { state: PState; me: Seat; card: PCard; act: (a: PAction) => void }) {
  const p = state.players[me];
  const myTurn = state.status === "playing" && state.current === me && !state.prompt && !state.pendingEnd;
  const rules = card.supertype !== "Pokémon" ? cardText(card) : [];
  let controls: ReactNode = null;

  if (!myTurn) {
    controls = <p className="small muted">{state.status === "setup" ? "Choose your Active and Bench first." : "Wait for your turn."}</p>;
  } else if (isPokemon(card)) {
    if (isBasicPokemon(card)) {
      controls =
        p.bench.length >= BENCH_SIZE ? (
          <p className="small muted">Your Bench is full.</p>
        ) : (
          <button type="button" className="primary-btn small" onClick={() => act({ type: "playBasic", uid: card.uid })}>
            Put on your Bench
          </button>
        );
    } else {
      const targets = evolveTargets(state, me, card);
      controls = targets.length ? (
        targets.map((key) => (
          <button key={key} type="button" className="primary-btn small" onClick={() => act({ type: "evolve", uid: card.uid, slot: key })}>
            Evolve {topCard(slotAt(p, key)!).name} ({where(key)})
          </button>
        ))
      ) : (
        <p className="small muted">
          {state.turn <= 2
            ? "Neither player can evolve on their first turn."
            : card.candyFrom && p.hand.some((c) => c.name === "Rare Candy")
              ? `No ${card.evolvesFrom} to evolve. You could use Rare Candy on a ${card.candyFrom}.`
              : `You need a ${card.evolvesFrom} in play that wasn't played or evolved this turn.`}
        </p>
      );
    }
  } else if (isEnergy(card)) {
    controls = p.energyAttached ? (
      <p className="small muted">You've already attached an Energy this turn.</p>
    ) : (
      slotKeys(p).map((key) => (
        <button key={key} type="button" className="primary-btn small" onClick={() => act({ type: "attachEnergy", uid: card.uid, slot: key })}>
          Attach to {topCard(slotAt(p, key)!).name} ({where(key)})
        </button>
      ))
    );
  } else if (isTool(card)) {
    const free = slotKeys(p).filter((k) => !slotAt(p, k)!.tool);
    controls = free.length ? (
      free.map((key) => (
        <button key={key} type="button" className="primary-btn small" onClick={() => act({ type: "attachTool", uid: card.uid, slot: key })}>
          Attach to {topCard(slotAt(p, key)!).name} ({where(key)})
        </button>
      ))
    ) : (
      <p className="small muted">All your Pokémon already have a Tool.</p>
    );
  } else {
    const reason = cantPlayTrainerReason(state, me, card);
    controls = (
      <button type="button" className="primary-btn small" disabled={!!reason} onClick={() => act({ type: "playTrainer", uid: card.uid })}>
        {reason ?? `Play ${card.name}`}
      </button>
    );
  }

  return (
    <>
      {rules.map((r, i) => (
        <p key={i} className="small">
          {r}
        </p>
      ))}
      {card.supertype === "Trainer" && !isAutomated(card) && (
        <p className="small practice-hand">
          {isStadium(card)
            ? "The game doesn't do this Stadium's effect for you. When it lets you do something, press By hand at the top of the table and do what it says."
            : isTool(card)
              ? "The game doesn't do this Tool's effect for you. When it matters, press By hand at the top of the table and do what it says."
              : "You do this card's effect yourself: after you play it, the By hand moves open so you can do what it says."}
        </p>
      )}
      <div className="action-buttons">{controls}</div>
    </>
  );
}

/** The side panel for one card: big picture, what you can do with it, how, and its full text. */
function PracticePanel({
  card,
  title,
  close,
  how,
  controls,
  body,
}: {
  card: PCard;
  title: ReactNode;
  close: () => void;
  how: string | null;
  controls?: ReactNode;
  body?: ReactNode;
}) {
  const detail = useCardDetail(card.id);
  return (
    <div className="action-panel">
      <div className="action-head">
        <strong>{title}</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <div className="action-body">
        <CardPreview card={ref(card)} />
        <div className="action-controls">
          <CardSummary card={ref(card)} detail={detail} />
          {controls}
        </div>
      </div>
      {how && (
        <p className="how-to small">
          <strong>How to:</strong> {how}
        </p>
      )}
      {body}
      {/* A Pokémon in play shows its live attacks and stats above; a card in hand shows the printed ones. */}
      <CardText detail={detail} attacks={!body} stats={!body} rules={card.supertype === "Pokémon"} />
    </div>
  );
}

function practiceHow(card: PCard): string {
  if (isBasicPokemon(card)) return "Press Put on your Bench. You can have up to 5 Pokémon there.";
  if (isPokemon(card)) return `Press the Evolve button for the ${card.evolvesFrom ?? "Pokémon"} you want to evolve. Not on your first turn, or on a Pokémon that came into play this turn.`;
  if (isEnergy(card)) return "Press Attach to… for the Pokémon you want to power up. 1 Energy from your hand per turn.";
  if (isTool(card)) return "Press Attach to… for the Pokémon that should hold it. 1 Tool per Pokémon.";
  if (isSupporter(card)) return "Press Play. Only 1 Supporter per turn.";
  if (isStadium(card)) return "Press Play. It stays in play for both players until another Stadium replaces it.";
  return "Press Play. You can play as many Items as you like.";
}

/** Every option in a practice turn, with whether you can do it right now and which buttons to press. */
function practiceGuide(state: PState, me: Seat, open: (key: SlotKey) => void, byHand: () => void): GuideRow[] {
  const p = state.players[me];
  const hand = p.hand;
  const openActive = { label: "Show my Active Pokémon", run: () => open("active") };
  const basics = hand.filter(isBasicPokemon);
  const evolvable = hand.filter((c) => isPokemon(c) && !isBasicPokemon(c) && evolveTargets(state, me, c).length > 0);
  const items = hand.filter((c) => (isItem(c) || isTool(c)) && !cantPlayTrainerReason(state, me, c));
  const supporters = hand.filter((c) => isSupporter(c) && !cantPlayTrainerReason(state, me, c));
  const supporter = supporters[0] ?? hand.find(isSupporter);
  const supporterBlock = supporter ? cantPlayTrainerReason(state, me, supporter) : "No Supporter in your hand.";
  const stadiums = hand.filter((c) => isStadium(c) && !cantPlayTrainerReason(state, me, c));
  const stadium = stadiums[0] ?? hand.find(isStadium);
  const stadiumBlock = stadium ? cantPlayTrainerReason(state, me, stadium) : "No Stadium in your hand.";
  const energy = p.energyAttached ? [] : hand.filter(isEnergy);
  const uids = (cards: PCard[]) => cards.map((c) => c.uid);
  const retreatBlock = cantRetreatReason(state, me);
  const attackBlock = cantAttackReason(state, me);
  const canAttack = !attackBlock && usableAttacks(state, me).length > 0;
  return [
    { what: "Draw a card", how: "Done for you at the start of each turn.", state: "info" },
    {
      what: "Put Basic Pokémon on your Bench",
      how: "Tap a Basic Pokémon in your hand, then press Put on your Bench.",
      state: p.bench.length >= BENCH_SIZE ? "blocked" : basics.length ? "ready" : "blocked",
      note: p.bench.length >= BENCH_SIZE ? "Your Bench is full." : basics.length ? `You have ${basics.map((c) => c.name).join(", ")}.` : "No Basic Pokémon in your hand.",
      cards: p.bench.length >= BENCH_SIZE ? [] : uids(basics),
    },
    {
      what: "Evolve a Pokémon",
      how: "Tap the Evolution card in your hand, then press Evolve for the Pokémon it evolves from.",
      state: evolvable.length ? "ready" : "blocked",
      note: evolvable.length
        ? `You can play ${evolvable.map((c) => c.name).join(", ")}.`
        : state.turn <= 2
          ? "Nobody can evolve on their first turn."
          : "Nothing in your hand can evolve a Pokémon you have in play right now.",
      cards: uids(evolvable),
    },
    {
      what: "Attach 1 Energy",
      how: "Tap an Energy card in your hand, then press Attach to… for the Pokémon you want.",
      state: p.energyAttached ? "done" : hand.some(isEnergy) ? "ready" : "blocked",
      note: p.energyAttached ? "Once per turn, and you've done it." : hand.some(isEnergy) ? "Once per turn." : "No Energy in your hand.",
      cards: uids(energy),
    },
    {
      what: "Play Items and Tools",
      how: "Tap the card in your hand, then press Play (Tools: Attach to…).",
      state: items.length ? "ready" : "blocked",
      note: items.length ? "As many as you like." : "None you can play right now.",
      cards: uids(items),
    },
    {
      what: "Play 1 Supporter",
      how: "Tap the Supporter in your hand, then press Play.",
      state: p.supporterPlayed ? "done" : supporterBlock ? "blocked" : "ready",
      note: p.supporterPlayed ? "Once per turn, and you've done it." : supporterBlock ?? "Once per turn.",
      cards: p.supporterPlayed ? [] : uids(supporters),
    },
    {
      what: "Play a Stadium",
      how: "Tap the Stadium in your hand, then press Play.",
      state: p.stadiumPlayed ? "done" : stadiumBlock ? "blocked" : "ready",
      note: p.stadiumPlayed ? "Once per turn, and you've done it." : stadiumBlock,
      cards: p.stadiumPlayed ? [] : uids(stadiums),
    },
    {
      what: "Retreat",
      how: "Tap your Active Pokémon, press Retreat, then pick a Benched Pokémon to come in. The Energy is discarded for you.",
      state: p.retreated ? "done" : retreatBlock ? "blocked" : "ready",
      note: p.retreated ? "Once per turn, and you've done it." : retreatBlock ?? `Costs ${retreatCost(p.active!, state.turn)} Energy.`,
      show: openActive,
    },
    {
      what: "Attack (ends your turn)",
      how: "Tap your Active Pokémon, then press the button under the attack you want. Damage, Weakness and Knock Outs are worked out for you.",
      state: canAttack ? "ready" : "blocked",
      note: attackBlock ?? (canAttack ? null : "Attach more Energy first: each attack shows the Energy it needs."),
      show: openActive,
    },
    {
      what: "Do what a card says, by hand",
      how: "For Abilities, Stadiums and card text the game doesn't do for you: press By hand at the top of the table, then draw, search, heal, switch and so on.",
      state: "ready",
      show: { label: "Open the By hand moves", run: byHand },
    },
    { what: "End your turn", how: "Press End turn at the top of the table if you don't want to attack.", state: "info" },
  ];
}

/** A choice the rules are waiting on, like picking a Pokémon to search for. */
function ChoiceModal({ state, me, act }: { state: PState; me: Seat; act: (a: PAction) => void }) {
  const prompt = state.prompt!;
  const [picked, setPicked] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  const p = state.players[me];
  const opp = state.players[otherSeat(me)];

  useEffect(() => {
    setPicked([]);
    setHidden(false);
  }, [prompt]);

  const toggle = (id: string) =>
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : prompt.max === 1 ? [id] : list.length < prompt.max ? [...list, id] : list));
  const valid = picked.length >= prompt.min && picked.length <= prompt.max;
  const howMany =
    prompt.min === prompt.max ? `Choose ${prompt.min}.` : prompt.min === 0 ? `Choose up to ${prompt.max}, or none.` : `Choose ${prompt.min} to ${prompt.max}.`;

  if (hidden) {
    return (
      <div className="banner pick choice-peek">
        {prompt.title}.
        <span className="banner-actions">
          <button type="button" className="primary-btn small" onClick={() => setHidden(false)}>
            Show the choice
          </button>
        </span>
      </div>
    );
  }

  let options: ReactNode;
  if (prompt.zone === "deck" || prompt.zone === "hand" || prompt.zone === "discard") {
    const zone = prompt.zone === "deck" ? p.deck : prompt.zone === "hand" ? p.hand : p.discard;
    const shown = prompt.shown ?? prompt.options;
    const cards = zone.filter((c) => shown.includes(c.uid) || prompt.options.includes(c.uid));
    // Cards you can take first, then the rest of what you're looking at.
    cards.sort((a, b) => Number(prompt.options.includes(b.uid)) - Number(prompt.options.includes(a.uid)));
    options = (
      <div className="pile-grid">
        {cards.map((c) => {
          const can = prompt.options.includes(c.uid);
          return (
            <div key={c.uid} className={`choice-card${can ? "" : " dim"}`}>
              <GameCard card={ref(c)} selected={picked.includes(c.uid)} onClick={can ? () => toggle(c.uid) : undefined} />
            </div>
          );
        })}
      </div>
    );
  } else {
    const owner = prompt.zone === "oppBench" || prompt.zone === "oppPokemon" ? opp : p;
    options = (
      <div className="choice-slots">
        {prompt.options.map((key) => {
          const slot = slotAt(owner, key as SlotKey);
          return (
            <div key={key} className="choice-slot">
              <PracticeSlot slot={slot} label={where(key as SlotKey)} selected={picked.includes(key)} onClick={() => toggle(key)} />
              <span className="small muted">{where(key as SlotKey)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={prompt.title}>
        <div className="modal-head">
          <h2>{prompt.title}</h2>
          <button type="button" className="secondary-btn small" onClick={() => setHidden(true)}>
            Look at the table
          </button>
        </div>
        <p className="muted small">{howMany}</p>
        {options}
        <div className="row-actions">
          <button type="button" className="primary-btn" disabled={!valid} onClick={() => act({ type: "choose", picks: picked })}>
            {picked.length === 0 && prompt.min === 0 ? "Take nothing" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type Opponent = { name: string; title: string; ace: number };

export function PracticeTable({
  state,
  me,
  you,
  opponent,
  act,
  error,
  clearError,
  thinking,
  finished,
}: {
  state: PState;
  me: Seat;
  you: { name: string; avatar: number };
  opponent: Opponent;
  act: (a: PAction) => void;
  error: string | null;
  clearError: () => void;
  thinking: boolean;
  finished: ReactNode;
}) {
  const oppSeat = otherSeat(me);
  const mine = state.players[me];
  const theirs = state.players[oppSeat];
  const myTurn = state.status === "playing" && state.current === me;
  const canAct = myTurn && !state.prompt && !state.pendingEnd;
  const [sel, setSel] = useState<Sel>(null);
  const [setupPick, setSetupPick] = useState<{ active: string | null; bench: string[] }>({ active: null, bench: [] });
  const [pile, setPile] = useState<{ title: string; cards: PCard[] } | null>(null);
  const [confirmConcede, setConfirmConcede] = useState(false);
  // The turn guide option whose cards are raised in your hand.
  const [raise, setRaise] = useState<{ what: string; cards: string[] } | null>(null);
  const [byHand, setByHand] = useState<ByHandFor | "closed">("closed");

  // Playing a card the game can't resolve opens the By hand moves with the card's text.
  const play = (a: PAction) => {
    if (a.type === "playTrainer") {
      const card = mine.hand.find((c) => c.uid === a.uid);
      if (card && !isAutomated(card) && !isStadium(card) && !cantPlayTrainerReason(state, me, card)) {
        setByHand({ card, text: cardText(card), why: "The game doesn't do this card's effect for you. Do what it says with these moves, then press Done." });
      }
    }
    setRaise(null);
    act(a);
  };

  // Drag a card from your hand onto a Pokémon (Energy, Tools, Evolutions), an empty Bench spot
  // (Basic Pokémon) or anywhere on the mat (Items, Supporters, Stadiums).
  // Items, Supporters and Stadiums are played by dropping them anywhere on the mat.
  const playsAnywhere = (card: PCard) => card.supertype === "Trainer" && !isTool(card);
  const canDrop = (card: PCard, dropped: string) => {
    if (!canAct) return false;
    const target = playsAnywhere(card) ? "board" : dropped;
    if (target === "bench-empty") return isBasicPokemon(card) && mine.bench.length < BENCH_SIZE;
    if (target === "board") return card.supertype === "Trainer" && !isTool(card) && !cantPlayTrainerReason(state, me, card);
    const slot = slotAt(mine, target as SlotKey);
    if (!slot) return false;
    if (isEnergy(card)) return !mine.energyAttached;
    if (isTool(card)) return !slot.tool;
    if (isPokemon(card) && !isBasicPokemon(card)) return evolveTargets(state, me, card).includes(target as SlotKey);
    return false;
  };
  const drag = useCardDrag<PCard>({
    canDrop,
    onDrop: (card, dropped) => {
      setSel(null);
      const target = playsAnywhere(card) ? "board" : dropped;
      if (target === "bench-empty") play({ type: "playBasic", uid: card.uid });
      else if (target === "board") play({ type: "playTrainer", uid: card.uid });
      else if (isEnergy(card)) play({ type: "attachEnergy", uid: card.uid, slot: target as SlotKey });
      else if (isTool(card)) play({ type: "attachTool", uid: card.uid, slot: target as SlotKey });
      else play({ type: "evolve", uid: card.uid, slot: target as SlotKey });
    },
  });
  const logList = useRef<HTMLOListElement>(null);
  const lastLog = state.log[state.log.length - 1]?.n;

  // Keep the newest log line in view.
  useEffect(() => {
    const el = logList.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastLog]);

  // Drop a selection once the card it points at has gone.
  useEffect(() => {
    setSel((s) => {
      if (s?.kind === "hand" && !mine.hand.some((c) => c.uid === s.uid)) return null;
      if (s?.kind === "slot" && !slotAt(state.players[s.side], s.key)) return null;
      return s;
    });
  }, [lastLog, mine.hand, state.players]);

  useEffect(() => {
    if (!myTurn) setByHand("closed");
  }, [myTurn]);
  // Raised cards drop back once anything happens or the turn passes.
  useEffect(() => setRaise(null), [lastLog, canAct]);
  useEffect(() => {
    if (raise) document.querySelector(".my-hand .hand-card.raised")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [raise]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const settingUp = state.status === "setup" && !state.setupDone[me];
  const toggleSetup = (c: PCard) => {
    if (!isBasicPokemon(c)) return;
    setSetupPick((s) => {
      if (s.active === c.uid) return { active: s.bench[0] ?? null, bench: s.bench.slice(1) };
      if (s.bench.includes(c.uid)) return { ...s, bench: s.bench.filter((u) => u !== c.uid) };
      if (!s.active) return { ...s, active: c.uid };
      if (s.bench.length >= BENCH_SIZE) return s;
      return { ...s, bench: [...s.bench, c.uid] };
    });
  };

  const turnLabel =
    state.status === "setup"
      ? "Setting up"
      : state.status === "finished"
        ? "Game over"
        : myTurn
          ? `Turn ${state.turn} · Your turn`
          : `Turn ${state.turn} · ${theirs.name}'s turn`;

  const selected = sel?.kind === "hand" ? mine.hand.find((c) => c.uid === sel.uid) : null;
  const selectedSlot = sel?.kind === "slot" ? slotAt(state.players[sel.side], sel.key) : null;

  const tag = (name: string, img: string, detail: string) => (
    <div className="player-tag">
      <img src={img} alt="" width={48} height={48} />
      <span>
        <strong>{name}</strong>
        <span className="muted small">{detail}</span>
      </span>
    </div>
  );

  return (
    <div className="table-wrap practice">
      <div className="table-bar">
        <span className={`turn-pill${myTurn ? " mine" : ""}`}>{turnLabel}</span>
        {thinking && <span className="turn-pill thinking">{theirs.name} is thinking…</span>}
        <span className="bar-spacer" />
        {state.status === "playing" && (
          <button type="button" className="secondary-btn small" disabled={!canAct} onClick={() => setByHand(null)} title="Do what a card says when the game doesn't do it for you">
            By hand
          </button>
        )}
        {state.status === "playing" && (
          <button type="button" className="primary-btn small" disabled={!canAct} onClick={() => act({ type: "endTurn" })}>
            End turn
          </button>
        )}
        {state.status !== "finished" && (
          <button type="button" className="danger-btn small" onClick={() => setConfirmConcede(true)}>
            Concede
          </button>
        )}
      </div>

      {settingUp && (
        <div className="banner">
          {setupPick.active ? (
            <>
              Tap more Basic Pokémon to put them on your Bench (up to 5), then press Ready.
            </>
          ) : (
            <>
              Tap a Basic Pokémon in your hand to make it your <strong>Active Pokémon</strong>.
            </>
          )}
          <span className="banner-actions">
            <button
              type="button"
              className="primary-btn small"
              disabled={!setupPick.active}
              onClick={() => act({ type: "setup", active: setupPick.active!, bench: setupPick.bench })}
            >
              Ready
            </button>
          </span>
        </div>
      )}
      {state.status === "setup" && state.setupDone[me] && <div className="banner">Waiting for {theirs.name}…</div>}
      {finished}

      <div className="table-layout">
        <div className={`board${drag.dragging ? " dragging" : ""}${drag.dropState("board") ? ` drop-${drag.dropState("board")}` : ""}`} data-drop={canAct ? "board" : undefined}>
          <div className="stadium-rail">
            <div className="stadium">
              {state.stadium ? (
                <GameCard
                  card={ref(state.stadium.card)}
                  size="sm"
                  label={`Stadium: ${state.stadium.card.name}`}
                  onClick={
                    canAct
                      ? () => setByHand({ card: state.stadium!.card, text: cardText(state.stadium!.card), why: "The game doesn't do Stadium effects for you. If this one lets you do something, do it with these moves." })
                      : undefined
                  }
                />
              ) : (
                <span className="gcard sm empty" />
              )}
              <span className="pile-label">Stadium</span>
            </div>
          </div>
          <div className="play-area">
          <Side
            state={state}
            p={theirs}
            seat={oppSeat}
            flipped
            tag={tag(theirs.name, sprite(opponent.ace), `${opponent.title} · ${theirs.hand.length} in hand`)}
            sel={sel}
            onSlot={(key) => slotAt(theirs, key) && setSel({ kind: "slot", side: oppSeat, key })}
            onDiscard={() => setPile({ title: `${theirs.name}'s discard pile`, cards: theirs.discard })}
          />
          <div className="midline" />
          <Side
            state={state}
            p={mine}
            seat={me}
            tag={tag(you.name, sprite(you.avatar), `${mine.hand.length} in hand`)}
            sel={sel}
            onSlot={(key) => slotAt(mine, key) && setSel({ kind: "slot", side: me, key })}
            onDiscard={() => setPile({ title: "Your discard pile", cards: mine.discard })}
            dropState={canAct ? drag.dropState : undefined}
          />
          </div>
          <div className={`my-hand${raise ? " raising" : ""}`} aria-label="Your hand">
            {mine.hand.length ? (
              mine.hand.map((c) => {
                const role = setupPick.active === c.uid ? "Active" : setupPick.bench.includes(c.uid) ? "Bench" : null;
                return (
                  <div
                    key={c.uid}
                    className={`hand-card${settingUp && !isBasicPokemon(c) ? " dim" : ""}${drag.dragging?.uid === c.uid ? " lifted" : ""}${raise ? (raise.cards.includes(c.uid) ? " raised" : " sunk") : ""}`}
                    {...(canAct ? drag.source(c, { name: c.name, image: c.image }) : {})}
                  >
                    <GameCard
                      card={ref(c)}
                      selected={settingUp ? !!role : sel?.kind === "hand" && sel.uid === c.uid}
                      onClick={() => (settingUp ? toggleSetup(c) : setSel(sel?.kind === "hand" && sel.uid === c.uid ? null : { kind: "hand", uid: c.uid }))}
                    />
                    {settingUp && role && <span className="hand-role">{role}</span>}
                  </div>
                );
              })
            ) : (
              <p className="muted small">No cards in hand.</p>
            )}
          </div>
        </div>

        <aside className="table-side">
          {selected ? (
            <PracticePanel card={selected} title={selected.name} close={() => setSel(null)} how={canAct ? practiceHow(selected) : null} controls={<HandCardActions state={state} me={me} card={selected} act={play} />} />
          ) : sel?.kind === "slot" && selectedSlot ? (
            <PracticePanel
              card={topCard(selectedSlot)}
              title={
                <>
                  {topCard(selectedSlot).name}
                  {sel.side !== me && <span className="muted small"> · {theirs.name}'s</span>}
                </>
              }
              close={() => setSel(null)}
              how={
                canAct && sel.side === me
                  ? sel.key === "active"
                    ? "To attack, press the button under an attack. It lights up once enough Energy is attached. To retreat, press Retreat and pick who comes in; the Energy is discarded for you."
                    : "Press Retreat your Active and send this in to swap it into the Active Spot (it costs your Active's Retreat cost)."
                  : null
              }
              body={<PokemonInfo key={`${sel.side}${sel.key}`} state={state} seat={sel.side} slotKey={sel.key} mine={sel.side === me} act={act} byHand={setByHand} />}
            />
          ) : (
            <div className="action-panel idle">
              {canAct ? (
                <p className="small">
                  <strong>Your turn.</strong> Tap any card to read it and see what you can do with it. Hover a card to see it bigger.
                </p>
              ) : (
                <p className="muted small">
                  {state.prompt?.seat === me
                    ? "Finish your choice to carry on."
                    : state.status === "setup"
                    ? "Pick your starting Pokémon from your hand."
                    : state.status === "finished"
                      ? "Tap any Pokémon to look at it."
                      : `${theirs.name} is taking their turn. Tap any Pokémon to look at it.`}
                </p>
              )}
            </div>
          )}
          {canAct && (
            <TurnGuide
              title="Your turn: what you can do"
              rows={practiceGuide(state, me, (key) => setSel({ kind: "slot", side: me, key }), () => setByHand(null))}
              picked={raise?.what}
              onPick={(row) => setRaise(row ? { what: row.what, cards: row.cards ?? [] } : null)}
            />
          )}
          <section className="game-log" aria-label="Game log">
            <h2 className="small">Game log</h2>
            <ol ref={logList}>
              {state.log.map((l) => (
                <li key={l.n} className={`log-${l.kind ?? "move"}${l.seat === me ? " mine" : ""}`}>
                  {l.text}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {error && (
        <div className="toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}

      <CardZoom />
      {drag.ghost}

      {state.prompt?.seat === me && state.status !== "finished" && <ChoiceModal state={state} me={me} act={act} />}

      {/* Hidden while one of its moves waits on a choice, then back for the next move. */}
      {byHand !== "closed" && canAct && <ByHandPanel state={state} me={me} act={act} about={byHand} close={() => setByHand("closed")} />}

      {pile && (
        <div className="modal-backdrop" onClick={() => setPile(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={pile.title} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>
                {pile.title} ({pile.cards.length})
              </h2>
              <button type="button" className="icon-btn" onClick={() => setPile(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="pile-grid">
              {pile.cards.map((c) => (
                <GameCard key={c.uid} card={ref(c)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmConcede && (
        <div className="modal-backdrop" onClick={() => setConfirmConcede(false)}>
          <div className="modal narrow" role="dialog" aria-modal="true" aria-label="Concede" onClick={(e) => e.stopPropagation()}>
            <h2>Concede this game?</h2>
            <p>{theirs.name} will get the win.</p>
            <div className="row-actions">
              <button type="button" className="secondary-btn" onClick={() => setConfirmConcede(false)}>
                Keep playing
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => {
                  act({ type: "concede" });
                  setConfirmConcede(false);
                }}
              >
                Concede
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
