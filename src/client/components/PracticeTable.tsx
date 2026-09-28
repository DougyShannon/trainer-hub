import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
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
  isPokemon,
  isTool,
  maxHp,
  prizeValue,
  retreatCost,
  slotAt,
  slotKeys,
  topCard,
} from "../../shared/practice/engine";
import type { PAction, PCard, PPlayer, PSlot, PState, SlotKey } from "../../shared/practice/types";
import { sprite } from "../lib/sprites";
import { CardPreview, GameCard } from "./GameTable";
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

const where = (key: SlotKey) => (key === "active" ? "Active" : `Bench ${Number(key.split(":")[1]) + 1}`);
const shortEnergy = (c: PCard) => c.name.replace(/^Basic /, "").replace(/ Energy$/, "");

function PracticeSlot({
  slot,
  label,
  onClick,
  selected,
  highlight,
}: {
  slot: PSlot | null;
  label: string;
  onClick?: () => void;
  selected?: boolean;
  highlight?: boolean;
}) {
  if (!slot) {
    return (
      <div className="slot empty" aria-label={`${label}: empty`}>
        <span className="gcard md empty" />
      </div>
    );
  }
  const top = topCard(slot);
  const hp = maxHp(slot);
  return (
    <button
      type="button"
      className={`slot${selected ? " selected" : ""}${highlight ? " target" : ""}`}
      onClick={onClick}
      aria-label={`${label}: ${top.name}, ${Math.max(0, hp - slot.damage)} of ${hp} HP left`}
    >
      <GameCard card={ref(top)} />
      {slot.damage > 0 && <span className={`dmg${slot.damage >= hp ? " ko" : ""}`}>{slot.damage}</span>}
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
      {(slot.energy.length > 0 || slot.tool) && (
        <span className="attached">
          {slot.energy.map((e) => (
            <span key={e.uid} className="att" title={e.name}>
              {shortEnergy(e)}
            </span>
          ))}
          {slot.tool && (
            <span className="att tool" title={slot.tool.name}>
              {slot.tool.name}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function Side({
  p,
  seat,
  flipped,
  tag,
  sel,
  targets,
  onSlot,
  onDiscard,
}: {
  p: PPlayer;
  seat: Seat;
  flipped?: boolean;
  tag: ReactNode;
  sel: Sel;
  targets?: SlotKey[];
  onSlot: (key: SlotKey) => void;
  onDiscard: () => void;
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
      />
      {zones}
    </div>
  );
  const bench = (
    <div className="bench" aria-label={`${p.name}'s Bench`}>
      {Array.from({ length: BENCH_SIZE }, (_, i) => {
        const key = `bench:${i}` as SlotKey;
        return (
          <PracticeSlot
            key={i}
            slot={p.bench[i] ?? null}
            label={`Bench ${i + 1}`}
            selected={isSel(key)}
            highlight={targets?.includes(key)}
            onClick={() => onSlot(key)}
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
}: {
  state: PState;
  seat: Seat;
  slotKey: SlotKey;
  mine: boolean;
  act: (a: PAction) => void;
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
          <span className="small muted">Abilities aren't automated in practice games yet.</span>
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
  const rules = card.supertype !== "Pokémon" ? card.rules.filter((r) => !/^You may play (only 1|as many)/i.test(r)) : [];
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
        <p className="small practice-warn">This card's effect isn't automated in practice games yet, so playing it does nothing.</p>
      )}
      <div className="action-buttons">{controls}</div>
    </>
  );
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
        <div className="board">
          <Side
            p={theirs}
            seat={oppSeat}
            flipped
            tag={tag(theirs.name, sprite(opponent.ace), `${opponent.title} · ${theirs.hand.length} in hand`)}
            sel={sel}
            onSlot={(key) => slotAt(theirs, key) && setSel({ kind: "slot", side: oppSeat, key })}
            onDiscard={() => setPile({ title: `${theirs.name}'s discard pile`, cards: theirs.discard })}
          />
          <div className="midline">
            <div className="stadium">
              {state.stadium ? <GameCard card={ref(state.stadium.card)} size="sm" /> : <span className="gcard sm empty" />}
              <span className="pile-label">Stadium</span>
            </div>
          </div>
          <Side
            p={mine}
            seat={me}
            tag={tag(you.name, sprite(you.avatar), `${mine.hand.length} in hand`)}
            sel={sel}
            onSlot={(key) => slotAt(mine, key) && setSel({ kind: "slot", side: me, key })}
            onDiscard={() => setPile({ title: "Your discard pile", cards: mine.discard })}
          />
          <div className="my-hand" aria-label="Your hand">
            {mine.hand.length ? (
              mine.hand.map((c) => {
                const role = setupPick.active === c.uid ? "Active" : setupPick.bench.includes(c.uid) ? "Bench" : null;
                return (
                  <div key={c.uid} className={`hand-card${settingUp && !isBasicPokemon(c) ? " dim" : ""}`}>
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
            <div className="action-panel">
              <div className="action-head">
                <strong>{selected.name}</strong>
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setSel(null)}>
                  ×
                </button>
              </div>
              <div className="action-body">
                <CardPreview card={ref(selected)} />
                <div className="action-controls">
                  <HandCardActions state={state} me={me} card={selected} act={act} />
                  <Link to={`/cards/${selected.id}`} target="_blank" rel="noreferrer" className="small">
                    Card details
                  </Link>
                </div>
              </div>
            </div>
          ) : sel?.kind === "slot" && selectedSlot ? (
            <div className="action-panel">
              <div className="action-head">
                <strong>
                  {topCard(selectedSlot).name}
                  {sel.side !== me && <span className="muted small"> · {theirs.name}'s</span>}
                </strong>
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setSel(null)}>
                  ×
                </button>
              </div>
              <div className="action-body">
                <CardPreview card={ref(topCard(selectedSlot))} />
                <div className="action-controls">
                  <PokemonInfo key={`${sel.side}${sel.key}`} state={state} seat={sel.side} slotKey={sel.key} mine={sel.side === me} act={act} />
                </div>
              </div>
            </div>
          ) : (
            <div className="action-panel idle">
              {canAct ? (
                <>
                  <p className="small">
                    <strong>Your turn.</strong> Tap a card in your hand to play it, or your Active Pokémon to attack or retreat.
                  </p>
                  <ul className="turn-checklist small">
                    <li className={mine.energyAttached ? "done" : ""}>Attach 1 Energy {mine.energyAttached ? "(done)" : ""}</li>
                    <li className={mine.supporterPlayed ? "done" : ""}>Play 1 Supporter {mine.supporterPlayed ? "(done)" : ""}</li>
                    <li className={mine.retreated ? "done" : ""}>Retreat once {mine.retreated ? "(done)" : "(optional)"}</li>
                    <li>Attack, which ends your turn</li>
                  </ul>
                </>
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

      {state.prompt?.seat === me && state.status !== "finished" && <ChoiceModal state={state} me={me} act={act} />}

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
