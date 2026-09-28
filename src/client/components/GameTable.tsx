import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  BENCH_SIZE,
  CONDITIONS,
  otherSeat,
  type CardRef,
  type Condition,
  type GameAction,
  type GameView,
  type PlayerView,
  type Seat,
  type Slot,
  type SlotRef,
  type SlotView,
  type Target,
} from "../../shared/game-types";
import { sprite } from "../lib/sprites";
import type { Connection } from "../lib/game";

type Pile = "hand" | "discard" | "lostZone" | "deck" | "attached" | "stadium" | "evolution";

type Selection =
  | { kind: "card"; card: CardRef; from: Pile; side: Seat }
  | { kind: "slot"; side: Seat; ref: SlotRef }
  | { kind: "deck" }
  | { kind: "prizes" };

type Picking = { what: "attach" | "evolve"; card: CardRef } | { what: "switch" };

type PileView = { title: string; cards: CardRef[]; side: Seat; from: Pile; search?: boolean };

const isPokemon = (c: CardRef) => c.supertype === "Pokémon";
const isBasicPokemon = (c: CardRef) => isPokemon(c) && c.subtypes.includes("Basic");
const isHidden = (s: SlotView | null): s is { hidden: true; count: number } => !!s && "hidden" in s;
const topOf = (s: Slot) => s.pokemon[s.pokemon.length - 1];
const sameRef = (a: SlotRef, b: SlotRef) => a.zone === b.zone && (a.zone === "active" || (b.zone === "bench" && a.index === b.index));

const CONDITION_LABEL: Record<Condition, string> = {
  asleep: "Asleep",
  confused: "Confused",
  paralyzed: "Paralyzed",
  poisoned: "Poisoned",
  burned: "Burned",
};

// ----- Small pieces -----

export function GameCard({
  card,
  onClick,
  selected,
  size = "md",
  label,
}: {
  card: CardRef | null;
  onClick?: () => void;
  selected?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const [broken, setBroken] = useState(false);
  const cls = `gcard ${size}${selected ? " selected" : ""}${card ? "" : " back"}${onClick ? " clickable" : ""}`;
  // The name sits under the picture, so the card is readable before (or if) the image loads.
  const body = card ? (
    <>
      <span className="gcard-text">{card.name}</span>
      {card.image && !broken && <img src={card.image} alt={card.name} loading="lazy" onError={() => setBroken(true)} />}
    </>
  ) : (
    <span className="gcard-back-mark" aria-hidden="true" />
  );
  const aria = label ?? (card ? card.name : "Face-down card");
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-label={aria} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <span className={cls} role="img" aria-label={aria}>
      {body}
    </span>
  );
}

function Pile({
  label,
  count,
  top,
  onClick,
  selected,
  faceDown,
}: {
  label: string;
  count: number;
  top?: CardRef | null;
  onClick?: () => void;
  selected?: boolean;
  faceDown?: boolean;
}) {
  return (
    <div className="pile">
      {count ? (
        <GameCard card={faceDown ? null : top ?? null} size="sm" onClick={onClick} selected={selected} label={`${label}: ${count} cards`} />
      ) : (
        <button type="button" className="gcard sm empty" onClick={onClick} disabled={!onClick} aria-label={`${label}: empty`} />
      )}
      <span className="pile-label">
        {label} <strong>{count}</strong>
      </span>
    </div>
  );
}

function SlotCard({
  slot,
  onClick,
  selected,
  highlight,
  label,
}: {
  slot: SlotView | null;
  onClick?: () => void;
  selected?: boolean;
  highlight?: boolean;
  label: string;
}) {
  if (!slot) {
    return (
      <button
        type="button"
        className={`slot empty${highlight ? " target" : ""}`}
        onClick={onClick}
        disabled={!onClick}
        aria-label={`${label}: empty`}
      >
        <span className="gcard md empty" />
      </button>
    );
  }
  if (isHidden(slot)) {
    return (
      <div className="slot" aria-label={`${label}: face down`}>
        <GameCard card={null} />
      </div>
    );
  }
  const top = topOf(slot);
  const remaining = top.hp ? top.hp - slot.damage : null;
  return (
    <button
      type="button"
      className={`slot${selected ? " selected" : ""}${highlight ? " target" : ""}`}
      onClick={onClick}
      aria-label={`${label}: ${top.name}${slot.damage ? `, ${slot.damage} damage` : ""}`}
    >
      <GameCard card={top} />
      {slot.damage > 0 && <span className={`dmg${remaining !== null && remaining <= 0 ? " ko" : ""}`}>{slot.damage}</span>}
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
      {slot.attached.length > 0 && (
        <span className="attached">
          {slot.attached.map((a) => (
            <span key={a.uid} className="att" title={a.name}>
              {a.name.replace(/^Basic /, "").replace(/ Energy$/, "")}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

// ----- The table -----

export function GameTable({
  view,
  deck,
  closeDeck,
  error,
  clearError,
  connection,
  act,
}: {
  view: GameView;
  deck: CardRef[] | null;
  closeDeck: () => void;
  error: string | null;
  clearError: () => void;
  connection: Connection;
  act: (a: GameAction) => void;
}) {
  const me: Seat = view.you ?? "p1";
  const opp = otherSeat(me);
  const playing = view.you !== null && view.status !== "finished";
  const mine = view.players[me]!;
  const theirs = view.players[opp];
  const myTurn = view.status === "playing" && view.current === me;

  const [sel, setSel] = useState<Selection | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [pile, setPile] = useState<PileView | null>(null);
  const [confirmConcede, setConfirmConcede] = useState(false);

  // Drop a selection once the card it points at has moved (by either player).
  useEffect(() => {
    const where = (uid: string) => {
      for (const seat of [me, opp]) {
        const p = view.players[seat];
        if (!p) continue;
        if (p.hand?.some((c) => c.uid === uid)) return "hand";
        if (p.discard.some((c) => c.uid === uid)) return "discard";
        if (p.lostZone.some((c) => c.uid === uid)) return "lostZone";
        for (const s of [p.active, ...p.bench]) {
          if (!s || isHidden(s)) continue;
          if (s.attached.some((c) => c.uid === uid)) return "attached";
          if (s.pokemon.some((c) => c.uid === uid)) return "evolution";
        }
      }
      if (view.stadium?.card.uid === uid) return "stadium";
      return null;
    };
    setSel((s) => {
      if (s?.kind === "card" && s.from !== "deck" && where(s.card.uid) !== s.from) return null;
      if (s?.kind === "card" && s.from === "deck") return null;
      if (s?.kind === "slot") {
        const p = view.players[s.side];
        const slot = s.ref.zone === "active" ? p?.active : p?.bench[s.ref.index];
        if (!slot) return null;
      }
      return s;
    });
  }, [view, me, opp]);

  // A deck search arrives from the server; show it.
  useEffect(() => {
    if (deck) setPile({ title: "Your deck", cards: deck, side: me, from: "deck", search: true });
  }, [deck, me]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const move = (card: CardRef, to: Target) => act({ type: "move", uid: card.uid, to });

  const clickSlot = (side: Seat, ref: SlotRef) => {
    if (picking && side === me) {
      if (picking.what === "switch") {
        if (ref.zone === "bench") act({ type: "switch", bench: ref.index });
      } else {
        move(picking.card, { zone: ref.zone, index: ref.zone === "bench" ? ref.index : null, mode: picking.what } as Target);
      }
      setPicking(null);
      return;
    }
    setPicking(null);
    setSel(sel?.kind === "slot" && sel.side === side && sameRef(sel.ref, ref) ? null : { kind: "slot", side, ref });
  };

  const clickEmptySlot = (ref: SlotRef) => {
    if (sel?.kind === "card" && sel.side === me && isPokemon(sel.card)) {
      move(sel.card, { zone: ref.zone, index: null, mode: "place" } as Target);
    }
  };

  const selectCard = (card: CardRef, from: Pile, side: Seat) => {
    setPicking(null);
    setSel(sel?.kind === "card" && sel.card.uid === card.uid ? null : { kind: "card", card, from, side });
  };

  const turnLabel =
    view.status === "setup"
      ? "Setting up"
      : view.status === "finished"
        ? "Game over"
        : view.current === me && view.you
          ? `Turn ${view.turn} · Your turn`
          : `Turn ${view.turn} · ${view.players[view.current ?? opp]?.trainerName}'s turn`;

  return (
    <div className="table-wrap">
      <div className="table-bar">
        <span className={`turn-pill${myTurn ? " mine" : ""}`}>{turnLabel}</span>
        {connection !== "open" && <span className="conn-pill">{connection === "closed" ? "Table closed" : "Reconnecting…"}</span>}
        {view.you === null && <span className="conn-pill">Watching</span>}
        <span className="bar-spacer" />
        {playing && view.status === "playing" && (
          <>
            <button type="button" className="secondary-btn small" onClick={() => act({ type: "coin" })}>
              Flip a coin
            </button>
            {view.canClaimWin && (
              <button type="button" className="primary-btn small" onClick={() => act({ type: "claimWin" })}>
                Claim the win
              </button>
            )}
            <button type="button" className="primary-btn small" disabled={!myTurn} onClick={() => act({ type: "endTurn" })}>
              End turn
            </button>
          </>
        )}
        {playing && (
          <button type="button" className="danger-btn small" onClick={() => setConfirmConcede(true)}>
            Concede
          </button>
        )}
      </div>

      {view.status === "setup" && view.you && (
        <SetupBanner view={view} me={mine} act={act} />
      )}
      {view.status === "finished" && (
        <div className="banner done">
          <strong>{view.winner ? `${view.players[view.winner]?.trainerName} wins!` : "Game over."}</strong> {view.endReason}{" "}
          <Link to="/play">Back to the lobby</Link>
        </div>
      )}
      {picking && (
        <div className="banner pick">
          {picking.what === "switch"
            ? "Choose a Benched Pokémon to switch with."
            : picking.what === "attach"
              ? `Choose a Pokémon to attach ${picking.card.name} to.`
              : `Choose a Pokémon to evolve into ${picking.card.name}.`}{" "}
          <button type="button" className="link-btn" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </div>
      )}

      <div className="table-layout">
        <div className="board">
          {theirs ? (
            <Side
              p={theirs}
              seat={opp}
              flipped
              sel={sel}
              onSlot={(ref) => clickSlot(opp, ref)}
              onPile={(from) =>
                setPile({ title: `${theirs.trainerName}'s ${from === "discard" ? "discard pile" : "Lost Zone"}`, cards: theirs[from], side: opp, from })
              }
            />
          ) : (
            <div className="side waiting">Waiting for an opponent…</div>
          )}

          <div className="midline">
            <div className="stadium">
              {view.stadium ? (
                <GameCard
                  card={view.stadium.card}
                  size="sm"
                  selected={sel?.kind === "card" && sel.card.uid === view.stadium.card.uid}
                  onClick={() => selectCard(view.stadium!.card, "stadium", view.stadium!.owner)}
                />
              ) : (
                <span className="gcard sm empty" />
              )}
              <span className="pile-label">Stadium</span>
            </div>
          </div>

          <Side
            p={mine}
            seat={me}
            sel={sel}
            picking={picking}
            onSlot={(ref) => clickSlot(me, ref)}
            onEmptySlot={view.you ? clickEmptySlot : undefined}
            onPile={(from) =>
              setPile({ title: `${view.you ? "Your" : `${mine.trainerName}'s`} ${from === "discard" ? "discard pile" : "Lost Zone"}`, cards: mine[from], side: me, from })
            }
            onDeck={playing ? () => setSel(sel?.kind === "deck" ? null : { kind: "deck" }) : undefined}
            onPrizes={playing && view.status === "playing" ? () => setSel(sel?.kind === "prizes" ? null : { kind: "prizes" }) : undefined}
          />

          <div className="my-hand" aria-label="Hand">
            {mine.hand ? (
              mine.hand.length ? (
                mine.hand.map((c) => (
                  <GameCard
                    key={c.uid}
                    card={c}
                    selected={sel?.kind === "card" && sel.card.uid === c.uid}
                    onClick={view.you ? () => selectCard(c, "hand", me) : undefined}
                  />
                ))
              ) : (
                <p className="muted small">No cards in hand.</p>
              )
            ) : (
              <p className="muted small">
                {mine.trainerName} has {mine.handCount} cards in hand.
              </p>
            )}
          </div>
        </div>

        <aside className="table-side">
          <ActionPanel
            view={view}
            me={me}
            sel={sel}
            act={act}
            move={move}
            setPicking={(p) => {
              setPicking(p);
            }}
            clear={() => setSel(null)}
          />
          <GameLog view={view} act={act} canChat={view.you !== null} />
        </aside>
      </div>

      {error && (
        <div className="toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}

      {pile && (
        <PileModal
          pile={pile}
          onClose={() => {
            setPile(null);
            if (pile.search) closeDeck();
          }}
          onPick={
            pile.side === me && view.you
              ? (c) => {
                  selectCard(c, pile.from, pile.side);
                  setPile(null);
                  if (pile.search) closeDeck();
                }
              : (c) => {
                  selectCard(c, pile.from, pile.side);
                  setPile(null);
                }
          }
          onShuffle={
            pile.search
              ? () => {
                  act({ type: "shuffle" });
                  setPile(null);
                  closeDeck();
                }
              : undefined
          }
        />
      )}

      {confirmConcede && (
        <div className="modal-backdrop" onClick={() => setConfirmConcede(false)}>
          <div className="modal narrow" role="dialog" aria-modal="true" aria-label="Concede" onClick={(e) => e.stopPropagation()}>
            <h2>Concede this game?</h2>
            <p>Your opponent will get the win.</p>
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

function Side({
  p,
  seat,
  flipped,
  sel,
  picking,
  onSlot,
  onEmptySlot,
  onPile,
  onDeck,
  onPrizes,
}: {
  p: PlayerView;
  seat: Seat;
  flipped?: boolean;
  sel: Selection | null;
  picking?: Picking | null;
  onSlot: (ref: SlotRef) => void;
  onEmptySlot?: (ref: SlotRef) => void;
  onPile: (from: "discard" | "lostZone") => void;
  onDeck?: () => void;
  onPrizes?: () => void;
}) {
  const isSel = (ref: SlotRef) => sel?.kind === "slot" && sel.side === seat && sameRef(sel.ref, ref);
  const canPlace = sel?.kind === "card" && sel.side === seat && isPokemon(sel.card) && !!onEmptySlot;
  const target = (ref: SlotRef) =>
    !!picking && (picking.what !== "switch" || ref.zone === "bench");

  const benchSlots = Array.from({ length: BENCH_SIZE }, (_, i) => p.bench[i] ?? null);
  const firstEmpty = p.bench.length;

  const zones = (
    <div className="zones">
      <Pile label="Deck" count={p.deckCount} faceDown onClick={onDeck} selected={sel?.kind === "deck" && !flipped} />
      <Pile label="Discard" count={p.discard.length} top={p.discard[p.discard.length - 1]} onClick={() => onPile("discard")} />
      <Pile label="Prizes" count={p.prizeCount} faceDown onClick={onPrizes} selected={sel?.kind === "prizes" && !flipped} />
      {p.lostZone.length > 0 && <Pile label="Lost Zone" count={p.lostZone.length} top={p.lostZone[p.lostZone.length - 1]} onClick={() => onPile("lostZone")} />}
    </div>
  );

  const active = (
    <div className="active-row">
      <div className="player-tag">
        <img src={sprite(p.avatarDex)} alt="" width={48} height={48} />
        <span>
          <strong>{p.trainerName}</strong>
          <span className="muted small">
            {p.online ? "Online" : "Away"} · {p.handCount} in hand
          </span>
        </span>
      </div>
      <SlotCard
        slot={p.active}
        label="Active Pokémon"
        selected={isSel({ zone: "active" })}
        highlight={(!!p.active && target({ zone: "active" })) || (!p.active && canPlace)}
        onClick={p.active ? () => onSlot({ zone: "active" }) : canPlace ? () => onEmptySlot?.({ zone: "active" }) : undefined}
      />
      {zones}
    </div>
  );

  const bench = (
    <div className="bench" aria-label={`${p.trainerName}'s Bench`}>
      {benchSlots.map((s, i) => (
        <SlotCard
          key={i}
          slot={s}
          label={`Bench ${i + 1}`}
          selected={isSel({ zone: "bench", index: i })}
          highlight={(!!s && target({ zone: "bench", index: i })) || (!s && i === firstEmpty && canPlace)}
          onClick={s ? () => onSlot({ zone: "bench", index: i }) : canPlace && i === firstEmpty ? () => onEmptySlot?.({ zone: "bench", index: i }) : undefined}
        />
      ))}
    </div>
  );

  return <div className={`side${flipped ? " flipped" : ""}`}>{flipped ? <>{bench}{active}</> : <>{active}{bench}</>}</div>;
}

function SetupBanner({ view, me, act }: { view: GameView; me: PlayerView; act: (a: GameAction) => void }) {
  const hasBasic = me.hand?.some(isBasicPokemon) || !!me.active || me.bench.length > 0;
  const opp = view.players[otherSeat(view.you!)];
  if (me.ready) {
    return (
      <div className="banner">
        You're ready. Waiting for {opp?.trainerName ?? "your opponent"} to finish setting up.
      </div>
    );
  }
  return (
    <div className="banner">
      {hasBasic ? (
        <>
          Choose a Basic Pokémon from your hand for your <strong>Active Spot</strong>, and up to 5 for your{" "}
          <strong>Bench</strong>. Your opponent won't see them until you both press Ready.
        </>
      ) : (
        <>You have no Basic Pokémon, so you need to take a mulligan: show your hand, shuffle it back and draw 7 new cards.</>
      )}
      <span className="banner-actions">
        {!hasBasic && (
          <button type="button" className="primary-btn small" onClick={() => act({ type: "mulligan" })}>
            Mulligan
          </button>
        )}
        {hasBasic && (
          <button type="button" className="primary-btn small" disabled={!me.active} onClick={() => act({ type: "ready" })}>
            Ready
          </button>
        )}
      </span>
    </div>
  );
}

function ActionPanel({
  view,
  me,
  sel,
  act,
  move,
  setPicking,
  clear,
}: {
  view: GameView;
  me: Seat;
  sel: Selection | null;
  act: (a: GameAction) => void;
  move: (card: CardRef, to: Target) => void;
  setPicking: (p: Picking) => void;
  clear: () => void;
}) {
  const player = view.players[me]!;
  const isPlayer = view.you !== null && view.status !== "finished";
  const setup = view.status === "setup";
  const buttons: { label: string; run: () => void; primary?: boolean }[] = [];
  let preview: CardRef | null = null;
  let title = "";
  let body: ReactNode = null;

  if (!sel) {
    return (
      <div className="action-panel idle">
        <p className="muted small">
          {view.you
            ? "Tap a card in your hand, a Pokémon in play, or your deck to see what you can do with it."
            : "Tap any face-up card to see it bigger."}
        </p>
        {isPlayer && !setup && (
          <div className="action-buttons">
            <button type="button" className="secondary-btn small" onClick={() => act({ type: "draw" })}>
              Draw a card
            </button>
            <button type="button" className="secondary-btn small" onClick={() => act({ type: "revealHand" })}>
              Show my hand
            </button>
            <button type="button" className="secondary-btn small" onClick={() => act({ type: "shuffleHandIntoDeck" })}>
              Shuffle hand into deck
            </button>
          </div>
        )}
      </div>
    );
  }

  if (sel.kind === "deck") {
    title = `Your deck (${player.deckCount} cards)`;
    buttons.push(
      { label: "Draw a card", run: () => act({ type: "draw" }), primary: true },
      { label: "Search deck", run: () => act({ type: "searchDeck" }) },
      { label: "Shuffle", run: () => act({ type: "shuffle" }) },
      { label: "Discard top card", run: () => act({ type: "mill" }) },
    );
  } else if (sel.kind === "prizes") {
    title = `Your Prize cards (${player.prizeCount} left)`;
    body = <p className="muted small">Take a Prize card when you Knock Out one of your opponent's Pokémon.</p>;
    buttons.push({ label: "Take a Prize card", run: () => act({ type: "takePrize", index: 0 }), primary: true });
  } else if (sel.kind === "card") {
    const { card, from } = sel;
    preview = card;
    title = card.name;
    const own = sel.side === me && isPlayer;
    if (own) {
      if (setup) {
        if (from === "hand" && isBasicPokemon(card)) {
          if (!player.active) buttons.push({ label: "Make it your Active Pokémon", run: () => move(card, { zone: "active", mode: "place" }), primary: true });
          if (player.bench.length < BENCH_SIZE) buttons.push({ label: "Put it on your Bench", run: () => move(card, { zone: "bench", index: null, mode: "place" }), primary: !!player.active });
        }
      } else {
        if (isPokemon(card)) {
          if (isBasicPokemon(card) || from !== "hand") {
            if (!player.active) buttons.push({ label: "Put in the Active Spot", run: () => move(card, { zone: "active", mode: "place" }) });
            if (player.bench.length < BENCH_SIZE) buttons.push({ label: "Put on your Bench", run: () => move(card, { zone: "bench", index: null, mode: "place" }), primary: isBasicPokemon(card) });
          }
          if (!isBasicPokemon(card)) buttons.push({ label: "Evolve a Pokémon…", run: () => setPicking({ what: "evolve", card }), primary: true });
        }
        if (card.subtypes.includes("Stadium") && from !== "stadium") buttons.push({ label: "Play Stadium", run: () => move(card, { zone: "stadium" }), primary: true });
        if (card.supertype === "Energy" || card.subtypes.includes("Pokémon Tool")) {
          buttons.push({ label: "Attach to a Pokémon…", run: () => setPicking({ what: "attach", card }), primary: true });
        }
        if (from !== "hand") buttons.push({ label: "Put in your hand", run: () => move(card, { zone: "hand" }) });
        if (from !== "discard") buttons.push({ label: card.supertype === "Trainer" && from === "hand" ? "Play / discard" : "Discard", run: () => move(card, { zone: "discard" }) });
        if (card.supertype !== "Energy" && !card.subtypes.includes("Pokémon Tool")) {
          buttons.push({ label: "Attach to a Pokémon…", run: () => setPicking({ what: "attach", card }) });
        }
        buttons.push(
          { label: "Put on top of deck", run: () => move(card, { zone: "deckTop" }) },
          { label: "Put on bottom of deck", run: () => move(card, { zone: "deckBottom" }) },
          { label: "Shuffle into deck", run: () => move(card, { zone: "deckShuffle" }) },
        );
        if (from !== "lostZone") buttons.push({ label: "Put in the Lost Zone", run: () => move(card, { zone: "lostZone" }) });
      }
    }
  } else {
    const p = view.players[sel.side];
    const slot = sel.ref.zone === "active" ? p?.active : p?.bench[sel.ref.index];
    if (!slot || isHidden(slot)) return null;
    const top = topOf(slot);
    preview = top;
    title = `${top.name}${top.hp ? ` · ${Math.max(0, top.hp - slot.damage)}/${top.hp} HP` : ""}`;
    const own = sel.side === me && isPlayer;
    const canMark = isPlayer && view.status === "playing";
    const ref = sel.ref;

    body = (
      <>
        {canMark && (
          <div className="damage-row" aria-label="Damage counters">
            <span className="small">Damage {slot.damage}</span>
            {[-10, 10, 30, 50].map((d) => (
              <button key={d} type="button" className="chip-btn" onClick={() => act({ type: "damage", side: sel.side, slot: ref, delta: d })}>
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
        )}
        {canMark && ref.zone === "active" && (
          <div className="cond-row" aria-label="Special Conditions">
            {CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip-btn${slot.conditions.includes(c) ? " on" : ""}`}
                aria-pressed={slot.conditions.includes(c)}
                onClick={() => act({ type: "condition", side: sel.side, slot: ref, condition: c })}
              >
                {CONDITION_LABEL[c]}
              </button>
            ))}
          </div>
        )}
        {(slot.attached.length > 0 || slot.pokemon.length > 1) && (
          <div className="stack-list">
            <span className="small muted">Cards in this stack</span>
            {[...slot.pokemon.slice(0, -1).map((c) => ({ c, kind: "evolution" as const })), ...slot.attached.map((c) => ({ c, kind: "attached" as const }))].map(
              ({ c, kind }, i) => (
                <div key={c.uid} className="stack-item">
                  <span>{c.name}</span>
                  {own && kind === "attached" && (
                    <>
                      <button type="button" className="link-btn" onClick={() => move(c, { zone: "discard" })}>
                        Discard
                      </button>
                      <button type="button" className="link-btn" onClick={() => move(c, { zone: "hand" })}>
                        To hand
                      </button>
                    </>
                  )}
                  {own && kind === "evolution" && i === slot.pokemon.length - 2 && (
                    <button type="button" className="link-btn" onClick={() => move(top, { zone: "hand" })}>
                      Devolve ({top.name} to hand)
                    </button>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </>
    );

    if (own && !setup) {
      if (ref.zone === "active" && player.bench.length) buttons.push({ label: "Retreat / switch…", run: () => setPicking({ what: "switch" }), primary: true });
      if (ref.zone === "bench") {
        buttons.push({
          label: player.active ? "Switch with Active" : "Move to Active Spot",
          run: () => act({ type: "switch", bench: ref.index }),
          primary: !player.active,
        });
      }
      buttons.push(
        { label: "Knocked Out (discard all)", run: () => act({ type: "slot", slot: ref, op: "discard" }) },
        { label: "Return to hand", run: () => act({ type: "slot", slot: ref, op: "hand" }) },
        { label: "Shuffle into deck", run: () => act({ type: "slot", slot: ref, op: "deckShuffle" }) },
        { label: "Put in the Lost Zone", run: () => act({ type: "slot", slot: ref, op: "lostZone" }) },
      );
    } else if (own && setup && !player.ready) {
      buttons.push({ label: "Take back to hand", run: () => act({ type: "slot", slot: ref, op: "hand" }) });
    }
  }

  return (
    <div className="action-panel">
      <div className="action-head">
        <strong>{title}</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={clear}>
          ×
        </button>
      </div>
      <div className="action-body">
        {preview && <CardPreview card={preview} />}
        <div className="action-controls">
          {body}
          {buttons.length > 0 && (
            <div className="action-buttons">
              {buttons.map((b) => (
                <button key={b.label} type="button" className={b.primary ? "primary-btn small" : "secondary-btn small"} onClick={b.run}>
                  {b.label}
                </button>
              ))}
            </div>
          )}
          {preview && (
            <Link to={`/cards/${preview.cardId}`} target="_blank" rel="noreferrer" className="small">
              Card details
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function CardPreview({ card }: { card: CardRef }) {
  const [broken, setBroken] = useState(false);
  const src = card.imageLarge ?? card.image;
  return (
    <div className="card-preview">
      <div className="gcard-text big">{card.name}</div>
      {src && !broken && <img src={src} alt={card.name} onError={() => setBroken(true)} />}
    </div>
  );
}

function GameLog({ view, act, canChat }: { view: GameView; act: (a: GameAction) => void; canChat: boolean }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const last = view.log[view.log.length - 1]?.n;
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);
  return (
    <section className="game-log" aria-label="Game log and chat">
      <h2 className="small">Game log</h2>
      <ol ref={list}>
        {view.log.map((l) => (
          <li key={l.n} className={`log-${l.kind ?? "move"}${l.seat === view.you && l.seat ? " mine" : ""}`}>
            {l.text}
          </li>
        ))}
      </ol>
      {canChat && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            act({ type: "chat", text });
            setText("");
          }}
        >
          <label htmlFor="chat" className="sr-only">
            Chat message
          </label>
          <input id="chat" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Say something…" autoComplete="off" />
          <button type="submit" className="secondary-btn small">
            Send
          </button>
        </form>
      )}
    </section>
  );
}

function PileModal({
  pile,
  onClose,
  onPick,
  onShuffle,
}: {
  pile: PileView;
  onClose: () => void;
  onPick: (c: CardRef) => void;
  onShuffle?: () => void;
}) {
  const [filter, setFilter] = useState("");
  const cards = useMemo(
    () => (filter ? pile.cards.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase())) : pile.cards),
    [pile.cards, filter],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={pile.title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            {pile.title} ({pile.cards.length})
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {pile.search && <p className="muted small">Pick a card to move it. Your opponent sees that you searched, not what you took. Shuffle when you're done.</p>}
        {pile.cards.length > 8 && (
          <input type="search" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter cards" />
        )}
        {cards.length ? (
          <div className="pile-grid">
            {cards.map((c) => (
              <GameCard key={c.uid} card={c} onClick={() => onPick(c)} />
            ))}
          </div>
        ) : (
          <p className="muted">No cards here.</p>
        )}
        {onShuffle && (
          <div className="row-actions">
            <button type="button" className="primary-btn" onClick={onShuffle}>
              Done, shuffle my deck
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
