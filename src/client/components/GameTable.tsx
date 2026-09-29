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
import { CardSummary, CardText, useCardDetail } from "./CardFacts";
import { CardZoom, zoomHandlers } from "./CardZoom";
import { useCardDrag } from "./DragDrop";
import { EnergyTuck, ReadyTag } from "./EnergyTuck";
import { canPay } from "../../shared/practice/engine";
import type { PCard } from "../../shared/practice/types";
import { TurnGuide, type GuideRow } from "./TurnGuide";
import { BoardButton, HalfMat, MatPile, backdropProps } from "./Mat";
import { MATS, matById, matFor, type Mat } from "../boards/library";
import { useBoardPrefs } from "../boards/prefs";
import { newestTurnFirst } from "../lib/log";

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

/** A red counter just under the card's HP (top right) with the total damage it has taken. */
export function DamageCounter({ damage }: { damage: { taken: number; hp: number | null } }) {
  const ko = damage.hp !== null && damage.taken >= damage.hp;
  return (
    <span className={`dmg-counter${ko ? " ko" : ""}`} title={`${damage.taken} damage`}>
      {damage.taken}
    </span>
  );
}

export function GameCard({
  card,
  onClick,
  selected,
  size = "md",
  label,
  damage,
}: {
  card: CardRef | null;
  onClick?: () => void;
  selected?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
  /** Damage on a Pokémon in play, shown as a red counter under its HP. */
  damage?: { taken: number; hp: number | null };
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
  const hurt = damage && damage.taken > 0 ? damage : undefined;
  const zoom = zoomHandlers(card, hurt);
  const counter = hurt && <DamageCounter damage={hurt} />;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-label={aria} aria-pressed={selected} {...zoom}>
      {body}
      {counter}
    </button>
  ) : (
    <span className={cls} role="img" aria-label={aria} {...zoom}>
      {body}
      {counter}
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

type DropProps = { drop?: string; dropState?: "" | "ok" | "over" };

function SlotCard({
  slot,
  onClick,
  selected,
  highlight,
  label,
  drop,
  dropState = "",
}: {
  slot: SlotView | null;
  onClick?: () => void;
  selected?: boolean;
  highlight?: boolean;
  label: string;
} & DropProps) {
  const dropCls = dropState ? ` drop-${dropState}` : "";
  if (!slot) {
    return (
      <button
        type="button"
        className={`slot empty${highlight ? " target" : ""}${dropCls}`}
        onClick={onClick}
        disabled={!onClick && !drop}
        data-drop={drop}
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
  return <FilledSlot slot={slot} onClick={onClick} selected={selected} highlight={highlight} label={label} dropCls={dropCls} drop={drop} />;
}

/** Attack names this Pokémon has enough Energy attached for (the table doesn't enforce it). */
function useReadyAttacks(slot: Slot) {
  const detail = useCardDetail(topOf(slot).cardId);
  const energy = slot.attached.filter((c) => c.supertype === "Energy") as unknown as PCard[];
  if (!detail?.details.attacks || !energy.length) return [];
  return detail.details.attacks.filter((a) => canPay(a.cost ?? [], energy)).map((a) => a.name);
}

function FilledSlot({
  slot,
  onClick,
  selected,
  highlight,
  label,
  dropCls,
  drop,
}: {
  slot: Slot;
  onClick?: () => void;
  selected?: boolean;
  highlight?: boolean;
  label: string;
  dropCls: string;
  drop?: string;
}) {
  const top = topOf(slot);
  const ready = useReadyAttacks(slot);
  const energy = slot.attached.filter((c) => c.supertype === "Energy");
  const other = slot.attached.filter((c) => c.supertype !== "Energy");
  return (
    <button
      type="button"
      className={`slot${selected ? " selected" : ""}${highlight ? " target" : ""}${energy.length ? " has-energy" : ""}${dropCls}`}
      onClick={onClick}
      data-drop={drop}
      aria-label={`${label}: ${top.name}${slot.damage ? `, ${slot.damage} damage` : ""}`}
    >
      <GameCard card={top} damage={{ taken: slot.damage, hp: top.hp }} />
      <EnergyTuck energy={energy} />
      <ReadyTag attacks={ready} />
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
      {other.length > 0 && (
        <span className="attached">
          {other.map((a) => (
            <span key={a.uid} className="att tool" title={a.name}>
              {a.name}
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
  const prefs = useBoardPrefs();
  const mats = prefs.layout === "mats";
  const myMat = matById(prefs.mat) ?? MATS[0];
  // Each player's mat choice travels with the game, so both see the same two mats.
  const theirMat = matById(theirs?.mat) ?? matFor(null, myMat.id);
  useEffect(() => {
    if (view.you && connection === "open" && view.players[view.you]?.mat !== prefs.mat) act({ type: "mat", id: prefs.mat });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.you, connection, prefs.mat, view.players[me]?.mat]);
  // The turn guide option whose cards are raised in your hand.
  const [raise, setRaise] = useState<{ what: string; cards: string[] } | null>(null);
  const handKey = mine.hand?.map((c) => c.uid).join() ?? "";
  useEffect(() => setRaise(null), [handKey, myTurn]);
  useEffect(() => {
    if (raise) document.querySelector(".my-hand .hand-card.raised")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [raise]);

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

  // Drag from your hand: Energy, Tools and Evolutions onto a Pokémon, Basic Pokémon onto an
  // empty spot, and Trainers anywhere on the mat (Stadiums go into play, the rest are played).
  const canDrag = !!view.you && view.status !== "finished" && (view.status === "setup" ? !mine.ready : myTurn);
  const playsAnywhere = (c: CardRef) => c.supertype === "Trainer" && !c.subtypes.includes("Pokémon Tool");
  const slotRef = (t: string): SlotRef | null =>
    t === "active" ? { zone: "active" } : t.startsWith("bench:") ? { zone: "bench", index: Number(t.slice(6)) } : null;
  const canDrop = (card: CardRef, dropped: string) => {
    if (!canDrag) return false;
    const setup = view.status === "setup";
    if (playsAnywhere(card)) return !setup;
    if (dropped === "active-empty") return isBasicPokemon(card) && !mine.active;
    if (dropped === "bench-empty") return isBasicPokemon(card) && mine.bench.length < BENCH_SIZE;
    if (setup || !slotRef(dropped)) return false;
    return card.supertype === "Energy" || card.subtypes.includes("Pokémon Tool") || (isPokemon(card) && !isBasicPokemon(card));
  };
  const drag = useCardDrag<CardRef>({
    canDrop,
    onDrop: (card, dropped) => {
      setSel(null);
      setPicking(null);
      if (playsAnywhere(card)) return move(card, card.subtypes.includes("Stadium") ? { zone: "stadium" } : { zone: "discard" });
      if (dropped === "active-empty") return move(card, { zone: "active", mode: "place" });
      if (dropped === "bench-empty") return move(card, { zone: "bench", index: null, mode: "place" });
      const ref = slotRef(dropped)!;
      const mode = isPokemon(card) ? "evolve" : "attach";
      move(card, { zone: ref.zone, index: ref.zone === "bench" ? ref.index : null, mode } as Target);
    },
  });

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

  const backdrop = backdropProps(prefs);
  const stadiumCard = view.stadium && (
    <GameCard
      card={view.stadium.card}
      label={`Stadium: ${view.stadium.card.name}`}
      selected={sel?.kind === "card" && sel.card.uid === view.stadium.card.uid}
      onClick={() => selectCard(view.stadium!.card, "stadium", view.stadium!.owner)}
    />
  );

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
        <BoardButton />
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
        <div
          className={`board${mats ? " mats" : backdrop.className}${drag.dragging ? " dragging" : ""}${drag.dropState("board") ? ` drop-${drag.dropState("board")}` : ""}`}
          style={mats ? undefined : backdrop.style}
          data-drop={canDrag ? "board" : undefined}
        >
          {mats ? (
            <div className="play-area">
              {theirs ? (
                <Side
                  p={theirs}
                  seat={opp}
                  flipped
                  mat={theirMat}
                  stadium={view.stadium?.owner === opp ? stadiumCard : null}
                  sel={sel}
                  onSlot={(ref) => clickSlot(opp, ref)}
                  onPile={(from) =>
                    setPile({ title: `${theirs.trainerName}'s ${from === "discard" ? "discard pile" : "Lost Zone"}`, cards: theirs[from], side: opp, from })
                  }
                />
              ) : (
                <HalfMat mat={theirMat} flipped label="Opponent's mat" parts={{ tag: null, active: null, bench: [], deck: null, discard: null, prizes: [] }} cover="Waiting for an opponent…" />
              )}
              <Side
                p={mine}
                seat={me}
                mat={myMat}
                stadium={view.stadium?.owner !== opp ? stadiumCard : null}
                sel={sel}
                picking={picking}
                onSlot={(ref) => clickSlot(me, ref)}
                onEmptySlot={view.you ? clickEmptySlot : undefined}
                onPile={(from) =>
                  setPile({ title: `${view.you ? "Your" : `${mine.trainerName}'s`} ${from === "discard" ? "discard pile" : "Lost Zone"}`, cards: mine[from], side: me, from })
                }
                onDeck={playing ? () => setSel(sel?.kind === "deck" ? null : { kind: "deck" }) : undefined}
                onPrizes={playing && view.status === "playing" ? () => setSel(sel?.kind === "prizes" ? null : { kind: "prizes" }) : undefined}
                dropState={canDrag ? drag.dropState : undefined}
              />
            </div>
          ) : (
          <>
          <div className="stadium-rail">
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
          <div className="play-area">
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

          <div className="midline" />

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
            dropState={canDrag ? drag.dropState : undefined}
          />
          </div>
          </>
          )}

          <div className={`my-hand${raise ? " raising" : ""}`} aria-label="Hand">
            {mine.hand ? (
              mine.hand.length ? (
                mine.hand.map((c) => (
                  <div key={c.uid} className={`hand-card${drag.dragging?.uid === c.uid ? " lifted" : ""}${raise ? (raise.cards.includes(c.uid) ? " raised" : " sunk") : ""}`} {...(canDrag ? drag.source(c, c) : {})}>
                    <GameCard card={c} selected={sel?.kind === "card" && sel.card.uid === c.uid} onClick={view.you ? () => selectCard(c, "hand", me) : undefined} />
                  </div>
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
          {view.you && view.status === "playing" && (
            myTurn ? (
              <TurnGuide
                title="Your turn: what you can do"
                intro="This table doesn't enforce the rules, so you move the cards. Here's how to do each thing."
                rows={liveGuide(mine, view.turn, () => setSel({ kind: "slot", side: me, ref: { zone: "active" } }))}
                picked={raise?.what}
                onPick={(row) => setRaise(row ? { what: row.what, cards: row.cards ?? [] } : null)}
              />
            ) : (
              <p className="action-panel idle muted small">When it's your turn, everything you can do (and how) is listed here.</p>
            )
          )}
          <GameLog view={view} act={act} canChat={view.you !== null} />
        </aside>
      </div>

      {error && (
        <div className="toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}

      <CardZoom />
      {drag.ghost}

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
  mat,
  stadium,
  sel,
  picking,
  onSlot,
  onEmptySlot,
  onPile,
  onDeck,
  onPrizes,
  dropState,
}: {
  p: PlayerView;
  seat: Seat;
  flipped?: boolean;
  /** Draw this side on a half mat instead of the full board. */
  mat?: Mat;
  stadium?: ReactNode;
  sel: Selection | null;
  picking?: Picking | null;
  onSlot: (ref: SlotRef) => void;
  onEmptySlot?: (ref: SlotRef) => void;
  onPile: (from: "discard" | "lostZone") => void;
  onDeck?: () => void;
  onPrizes?: () => void;
  dropState?: (target: string) => "" | "ok" | "over";
}) {
  const dropFor = (target: string) => (dropState ? { drop: target, dropState: dropState(target) } : {});
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

  const tag = (
    <div className="player-tag">
      <img src={sprite(p.avatarDex)} alt="" width={48} height={48} />
      <span>
        <strong>{p.trainerName}</strong>
        <span className="muted small">
          {p.online ? "Online" : "Away"} · {p.handCount} in hand
        </span>
      </span>
    </div>
  );
  const activeSlot = (
    <SlotCard
      slot={p.active}
      label="Active Pokémon"
      selected={isSel({ zone: "active" })}
      highlight={(!!p.active && target({ zone: "active" })) || (!p.active && canPlace)}
      onClick={p.active ? () => onSlot({ zone: "active" }) : canPlace ? () => onEmptySlot?.({ zone: "active" }) : undefined}
      {...dropFor(p.active ? "active" : "active-empty")}
    />
  );
  const benchSlot = (s: SlotView | null, i: number) => (
        <SlotCard
          key={i}
          slot={s}
          label={`Bench ${i + 1}`}
          selected={isSel({ zone: "bench", index: i })}
          highlight={(!!s && target({ zone: "bench", index: i })) || (!s && i === firstEmpty && canPlace)}
          onClick={s ? () => onSlot({ zone: "bench", index: i }) : canPlace && i === firstEmpty ? () => onEmptySlot?.({ zone: "bench", index: i }) : undefined}
          {...dropFor(s ? `bench:${i}` : "bench-empty")}
        />
  );

  if (mat) {
    const pileCard = (label: string, count: number, top: CardRef | null, onClick?: () => void, selected?: boolean) =>
      count ? (
        <GameCard card={top} onClick={onClick} selected={selected} label={`${label}: ${count} cards`} />
      ) : (
        <span className="gcard md empty" aria-label={`${label}: empty`} />
      );
    const prizes = Array.from({ length: Math.min(p.prizeCount, 6) }, (_, i) => (
      <GameCard key={i} card={null} onClick={onPrizes} selected={sel?.kind === "prizes" && !flipped} label={`Prize cards: ${p.prizeCount} left`} />
    ));
    return (
      <HalfMat
        mat={mat}
        flipped={flipped}
        label={`${p.trainerName}'s mat`}
        parts={{
          tag,
          active: activeSlot,
          bench: benchSlots.map(benchSlot),
          deck: <MatPile label="Deck" count={p.deckCount}>{pileCard("Deck", p.deckCount, null, onDeck, sel?.kind === "deck" && !flipped)}</MatPile>,
          discard: (
            <MatPile label="Discard" count={p.discard.length}>
              {pileCard("Discard", p.discard.length, p.discard[p.discard.length - 1] ?? null, () => onPile("discard"))}
            </MatPile>
          ),
          prizes,
          stadium,
          lostZone: p.lostZone.length > 0 && (
            <MatPile label="Lost Zone" count={p.lostZone.length}>
              {pileCard("Lost Zone", p.lostZone.length, p.lostZone[p.lostZone.length - 1], () => onPile("lostZone"))}
            </MatPile>
          ),
        }}
      />
    );
  }

  const active = (
    <div className="active-row">
      {tag}
      {activeSlot}
      {zones}
    </div>
  );

  const bench = (
    <div className="bench" aria-label={`${p.trainerName}'s Bench`}>
      {benchSlots.map(benchSlot)}
    </div>
  );

  return <div className={`side${flipped ? " flipped" : ""}`}>{flipped ? <>{bench}{active}</> : <>{active}{bench}</>}</div>;
}

/** Every option in a turn on the manual table, from what's in your hand and on your mat. */
function liveGuide(p: PlayerView, turn: number, openActive: () => void): GuideRow[] {
  const hand = p.hand ?? [];
  const has = (test: (c: CardRef) => boolean) => hand.some(test);
  const benchFull = p.bench.length >= BENCH_SIZE;
  const firstTurns = turn <= 2;
  const trainer = (sub: string) => (c: CardRef) => c.supertype === "Trainer" && c.subtypes.includes(sub);
  const uids = (test: (c: CardRef) => boolean) => hand.filter(test).map((c) => c.uid);
  return [
    { what: "Draw a card", how: "Done for you at the start of each turn.", state: "info" },
    {
      what: "Put Basic Pokémon on your Bench",
      how: "Tap a Basic Pokémon in your hand, then press Put on your Bench.",
      state: has(isBasicPokemon) && !benchFull ? "ready" : "blocked",
      note: benchFull ? "Your Bench is full (5)." : !has(isBasicPokemon) ? "No Basic Pokémon in your hand." : "As many as you like.",
      cards: benchFull ? [] : uids(isBasicPokemon),
    },
    {
      what: "Evolve a Pokémon",
      how: "Tap the Evolution card in your hand, press Evolve a Pokémon…, then tap the Pokémon it evolves from.",
      state: has((c) => isPokemon(c) && !isBasicPokemon(c)) && !firstTurns ? "ready" : "blocked",
      note: firstTurns ? "Nobody can evolve on their first turn." : !has((c) => isPokemon(c) && !isBasicPokemon(c)) ? "No Evolution cards in your hand." : "Not a Pokémon that came into play this turn.",
      cards: uids((c) => isPokemon(c) && !isBasicPokemon(c)),
    },
    {
      what: "Attach 1 Energy",
      how: "Tap an Energy card in your hand, press Attach to a Pokémon…, then tap the Pokémon.",
      state: has((c) => c.supertype === "Energy") ? "ready" : "blocked",
      note: has((c) => c.supertype === "Energy") ? "Once per turn." : "No Energy in your hand.",
      cards: uids((c) => c.supertype === "Energy"),
    },
    {
      what: "Play Items and Tools",
      how: "Tap the card, do what it says, then press Play / discard (Tools: Attach to a Pokémon…).",
      state: has(trainer("Item")) || has(trainer("Pokémon Tool")) ? "ready" : "blocked",
      note: has(trainer("Item")) || has(trainer("Pokémon Tool")) ? "As many as you like." : "None in your hand.",
      cards: uids((c) => trainer("Item")(c) || trainer("Pokémon Tool")(c)),
    },
    {
      what: "Play 1 Supporter",
      how: "Tap the Supporter, do what it says, then press Play / discard.",
      state: has(trainer("Supporter")) && turn !== 1 ? "ready" : "blocked",
      note: turn === 1 ? "The player who goes first can't play one on turn 1." : has(trainer("Supporter")) ? "Once per turn." : "No Supporter in your hand.",
      cards: uids(trainer("Supporter")),
    },
    {
      what: "Play a Stadium",
      how: "Tap the Stadium in your hand, then press Play Stadium.",
      state: has(trainer("Stadium")) ? "ready" : "blocked",
      note: has(trainer("Stadium")) ? "Once per turn." : "No Stadium in your hand.",
      cards: uids(trainer("Stadium")),
    },
    {
      what: "Retreat",
      how: "Tap your Active Pokémon, press Retreat / switch…, pick a Benched Pokémon, then discard Energy from the old Active equal to its Retreat cost.",
      state: p.active && p.bench.length ? "ready" : "blocked",
      note: p.active && p.bench.length ? "Once per turn. Not while Asleep or Paralyzed." : "You need a Pokémon on your Bench to switch in.",
      show: { label: "Show my Active Pokémon", run: openActive },
    },
    {
      what: "Attack (ends your turn)",
      how: "Tap your Active Pokémon and read its attacks. If it has the Energy an attack needs, tap your opponent's Active and add the damage (x2 if they're weak to your type), then press End turn.",
      state: p.active && turn !== 1 ? "ready" : "blocked",
      note: turn === 1 ? "The player who goes first can't attack on turn 1." : !p.active ? "You have no Active Pokémon." : null,
      show: { label: "Show my Active Pokémon", run: openActive },
    },
    {
      what: "Take a Prize card",
      how: "When you Knock Out a Pokémon, tap your Prizes and press Take a Prize card (2 for a Pokémon ex).",
      state: "info",
    },
    { what: "End your turn", how: "Press End turn at the top of the table.", state: "info" },
  ];
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
  let how: string | null = null;

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
    if (own && from === "hand") how = setup ? (isBasicPokemon(card) ? SETUP_HOW : "Only Basic Pokémon can go into play while you set up.") : howToPlay(card);
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
    if (canMark) {
      how = !own
        ? "After you attack, add the damage to this Pokémon with the +10 / +30 / +50 buttons. If its damage reaches its HP it's Knocked Out: your opponent presses Knocked Out, and you take a Prize card."
        : sel.ref.zone === "active"
          ? "To attack: check the Energy attached matches an attack's cost (below), tap your opponent's Active Pokémon and add the damage, then press End turn. To retreat: press Retreat / switch…, pick a Benched Pokémon, then tap this one on the Bench and press Discard next to Energy equal to its Retreat cost."
          : "Press Switch with Active to swap it in (for example after your Active is Knocked Out, or when a card lets you switch).";
    }
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

  return <CardPanel title={title} preview={preview} body={body} how={how} buttons={buttons} clear={clear} />;
}

const SETUP_HOW = "Press Make it your Active Pokémon, or Put it on your Bench. Press Ready at the top when you're done.";

/** Which buttons to press to play a card from your hand on the manual table. */
function howToPlay(card: CardRef): string {
  const sub = card.subtypes;
  if (isBasicPokemon(card)) return "Press Put on your Bench. You can have up to 5 Pokémon on your Bench.";
  if (isPokemon(card))
    return "Press Evolve a Pokémon…, then tap the Pokémon it evolves from on your mat. You can't evolve on your first turn, or evolve a Pokémon that came into play this turn.";
  if (card.supertype === "Energy") return "Press Attach to a Pokémon…, then tap the Pokémon. You can attach 1 Energy from your hand each turn.";
  if (sub.includes("Pokémon Tool")) return "Press Attach to a Pokémon…, then tap the Pokémon. Each Pokémon can hold 1 Tool.";
  if (sub.includes("Stadium")) return "Press Play Stadium. It stays in play for both players until another Stadium replaces it. 1 Stadium per turn.";
  if (sub.includes("Supporter"))
    return "Do what the card says (for example, tap your Deck and press Draw a card), then press Play / discard. Only 1 Supporter per turn, and the player who goes first can't play one on their first turn.";
  return "Do what the card says (for example, tap your Deck and press Search deck), then press Play / discard. You can play as many Items as you like.";
}

/** The side panel for one card: big picture, its buttons, how to use it and its full text. */
function CardPanel({
  title,
  preview,
  body,
  how,
  buttons,
  clear,
}: {
  title: string;
  preview: CardRef | null;
  body: ReactNode;
  how: string | null;
  buttons: { label: string; run: () => void; primary?: boolean }[];
  clear: () => void;
}) {
  const detail = useCardDetail(preview?.cardId ?? null);
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
          {preview && <CardSummary card={preview} detail={detail} />}
          {buttons.length > 0 && (
            <div className="action-buttons">
              {buttons.map((b) => (
                <button key={b.label} type="button" className={b.primary ? "primary-btn small" : "secondary-btn small"} onClick={b.run}>
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {how && (
        <p className="how-to small">
          <strong>How to:</strong> {how}
        </p>
      )}
      {body}
      {preview && <CardText detail={detail} />}
    </div>
  );
}

export function CardPreview({ card }: { card: CardRef }) {
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
    if (el) el.scrollTop = 0;
  }, [last]);
  return (
    <section className="game-log" aria-label="Game log and chat">
      <h2 className="small">Game log</h2>
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
      <ol ref={list}>
        {newestTurnFirst(view.log).map((l) => (
          <li key={l.n} className={`log-${l.kind ?? "move"}${l.seat === view.you && l.seat ? " mine" : ""}`}>
            {l.text}
          </li>
        ))}
      </ol>
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
