import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { send, useApi, type CardPage, type CardSummary, type DeckDetail, type DeckEntry, type DeckFormat } from "../lib/api";
import { useAuth } from "../lib/auth";
import { basicCount, countOf, drawHand, exportDeck, groupEntries, SECTIONS } from "../lib/deck";
import { checkDeck, DECK_SIZE, FORMAT_LABELS, isBasicEnergy, openingBasicChance } from "../../shared/deck-rules";
import { Energy, ErrorBox, Loading, TCG_TYPES } from "../components/ui";
import { NotFoundPage } from "./NotFoundPage";

const DRAFT_KEY = "trainer-hub:deck-draft";

type Draft = { name: string; format: DeckFormat; isPublic: boolean; coverCardId: string | null; entries: DeckEntry[] };

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

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ExportModal({ entries, onClose }: { entries: DeckEntry[]; onClose: () => void }) {
  const text = useMemo(() => exportDeck(entries), [entries]);
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
    <Modal title="Export deck list" onClose={onClose}>
      <p className="muted small">This is the Pokémon TCG Live format. Paste it into TCG Live, Limitless or another simulator.</p>
      <textarea ref={area} id="export-text" className="deck-text" readOnly value={text} rows={16} onFocus={(e) => e.target.select()} />
      <div className="row-actions">
        <button type="button" className="primary-btn" onClick={copy}>
          {copied ? "Copied" : "Copy to clipboard"}
        </button>
      </div>
    </Modal>
  );
}

export function HandModal({ entries, onClose }: { entries: DeckEntry[]; onClose: () => void }) {
  const [hand, setHand] = useState(() => drawHand(entries));
  const hasBasic = hand.some((c) => c.supertype === "Pokémon" && c.subtypes.includes("Basic"));
  return (
    <Modal title="Sample opening hand" onClose={onClose}>
      <p className={hasBasic ? "form-ok" : "form-error"}>
        {hasBasic ? "You have a Basic Pokémon to start with." : "No Basic Pokémon. In a real game this is a mulligan: you'd shuffle and draw again."}
      </p>
      <div className="hand">
        {hand.map((c, i) => (
          <img key={i} src={c.image ?? ""} alt={c.name} title={c.name} width={245} height={342} />
        ))}
      </div>
      <div className="row-actions">
        <button type="button" className="primary-btn" onClick={() => setHand(drawHand(entries))}>
          Draw again
        </button>
      </div>
    </Modal>
  );
}

function ImportModal({ onImport, onClose }: { onImport: (entries: DeckEntry[]) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await send<{ entries: DeckEntry[]; notFound: string[] }>("POST", "/api/decks/import", { text });
      if (!res.entries.length) {
        setError("We couldn't find any cards in that list. Check it's one card per line, like “4 Arven SVI 166”.");
      } else if (res.notFound.length) {
        onImport(res.entries);
        setNotFound(res.notFound);
      } else {
        onImport(res.entries);
        onClose();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import a deck list" onClose={onClose}>
      {notFound.length ? (
        <>
          <p className="form-ok">Imported. These lines didn't match a card, so they were left out:</p>
          <ul className="not-found">
            {notFound.map((l, i) => (
              <li key={i}>{l}</li>
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
            Paste a list exported from Pokémon TCG Live, Limitless or another deck builder. This replaces the cards in the deck you're
            editing.
          </p>
          <textarea
            id="import-text"
            className="deck-text"
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Pokémon: 12\n4 Charmander PAF 7\n3 Charizard ex OBF 125\n…\nTrainer: 36\n4 Arven SVI 166\n…\nEnergy: 12\n8 Basic {R} Energy SVE 2"}
          />
          {error && <p className="form-error">{error}</p>}
          <div className="row-actions">
            <button type="button" className="primary-btn" onClick={run} disabled={busy || !text.trim()}>
              {busy ? "Finding cards…" : "Import"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function CardSearch({ format, counts, onAdd }: { format: DeckFormat; counts: Map<string, number>; onAdd: (c: CardSummary) => void }) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [supertype, setSupertype] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, supertype, type, format]);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (supertype) params.set("supertype", supertype);
  if (type) params.set("type", type);
  if (format !== "unlimited") params.set("format", format);
  if (page > 1) params.set("page", String(page));
  const { data, loading, error } = useApi<CardPage>(`/api/cards?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="builder-search" aria-label="Find cards">
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <label htmlFor="b-q" className="sr-only">
          Search cards
        </label>
        <input id="b-q" type="search" placeholder="Search cards to add" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit">Search</button>
      </form>
      <div className="builder-filters">
        <div className="segmented small" role="group" aria-label="Card kind">
          {["", "Pokémon", "Trainer", "Energy"].map((s) => (
            <button key={s || "all"} type="button" className={supertype === s ? "active" : ""} aria-pressed={supertype === s} onClick={() => setSupertype(s)}>
              {s || "All"}
            </button>
          ))}
        </div>
        <div className="energy-filter" role="group" aria-label="Energy type">
          {TCG_TYPES.map((t) => (
            <button key={t} type="button" className={`energy-btn ${type === t ? "active" : ""}`} aria-pressed={type === t} onClick={() => setType(type === t ? "" : t)} title={t}>
              <Energy type={t} />
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">
        {data ? `${data.total.toLocaleString()} cards` : "Searching"}
        {format !== "unlimited" && ` legal in ${FORMAT_LABELS[format]}`}. Click a card to add it.
      </p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading label="Finding cards" />}
      <div className={`builder-results ${loading ? "is-stale" : ""}`}>
        {data?.cards.map((c) => (
          <button key={c.id} type="button" className="add-card" onClick={() => onAdd(c)} title={`Add ${c.name} (${c.setName} ${c.number})`}>
            <img src={c.image ?? ""} alt={c.name} loading="lazy" width={245} height={342} />
            {counts.get(c.id) ? <span className="in-deck">{counts.get(c.id)}</span> : null}
            <span className="add-card-name">{c.name}</span>
            <span className="add-card-meta">
              {c.setCode ?? c.setName} {c.number}
            </span>
          </button>
        ))}
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

export function DeckBuilderPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, ready } = useAuth();
  const existing = useApi<DeckDetail>(id ? `/api/decks/${id}` : null, { fresh: true });

  const [loaded, setLoaded] = useState(!id);
  const [name, setName] = useState("New deck");
  const [format, setFormat] = useState<DeckFormat>("standard");
  const [isPublic, setIsPublic] = useState(false);
  const [coverCardId, setCoverCardId] = useState<string | null>(null);
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [modal, setModal] = useState<"import" | "export" | "hand" | "delete" | null>(params.get("import") ? "import" : null);
  const [tab, setTab] = useState<"search" | "deck">("search");

  // Load a saved deck, or pick up a draft started before logging in.
  useEffect(() => {
    if (id && existing.data && !loaded) {
      const d = existing.data;
      setName(d.name);
      setFormat(d.format);
      setIsPublic(d.isPublic);
      setCoverCardId(d.coverCardId);
      setEntries(d.cards);
      setLoaded(true);
    }
  }, [id, existing.data, loaded]);

  useEffect(() => {
    if (id) return;
    const draft = readDraft();
    if (draft) {
      setName(draft.name);
      setFormat(draft.format);
      setIsPublic(draft.isPublic);
      setCoverCardId(draft.coverCardId);
      setEntries(draft.entries);
      setDirty(draft.entries.length > 0);
    }
  }, [id]);

  // Keep new, unsaved decks in this browser so they survive a reload or a trip to the login page.
  useEffect(() => {
    if (!id && dirty) writeDraft({ name, format, isPublic, coverCardId, entries });
  }, [id, dirty, name, format, isPublic, coverCardId, entries]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const counts = useMemo(() => new Map(entries.map((e) => [e.card.id, e.count])), [entries]);
  const total = countOf(entries);
  const problems = useMemo(() => checkDeck(entries, format), [entries, format]);
  const flagged = useMemo(() => new Set(problems.flatMap((p) => p.cardIds ?? [])), [problems]);
  const groups = useMemo(() => groupEntries(entries), [entries]);
  const basics = basicCount(entries);

  const change = (fn: () => void) => {
    fn();
    setDirty(true);
    setMessage(null);
  };

  const add = (card: CardSummary, by = 1) =>
    change(() =>
      setEntries((list) => {
        const found = list.find((e) => e.card.id === card.id);
        if (!found) return by > 0 ? [...list, { card, count: by }] : list;
        const count = found.count + by;
        if (count <= 0) return list.filter((e) => e.card.id !== card.id);
        return list.map((e) => (e.card.id === card.id ? { ...e, count: Math.min(count, isBasicEnergy(card) ? 59 : 60) } : e));
      }),
    );

  const save = async () => {
    if (!user) {
      writeDraft({ name, format, isPublic, coverCardId, entries });
      navigate(`/login?next=${encodeURIComponent("/decks/new")}`);
      return;
    }
    setSaving(true);
    setMessage(null);
    const body = { name, format, isPublic, coverCardId, cards: entries.map((e) => ({ id: e.card.id, count: e.count })) };
    try {
      if (id) {
        await send("PUT", `/api/decks/${id}`, body);
      } else {
        const res = await send<{ id: string }>("POST", "/api/decks", body);
        writeDraft(null);
        setDirty(false);
        navigate(`/decks/${res.id}/edit`, { replace: true });
      }
      setDirty(false);
      setMessage({ ok: true, text: problems.length ? "Saved. Fix the problems listed before you can play with it." : "Saved. This deck is ready to play." });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    await send("DELETE", `/api/decks/${id}`);
    setDirty(false);
    navigate("/decks", { replace: true });
  };

  if (id && existing.error === "Deck not found") return <NotFoundPage what="deck" />;
  if (id && existing.error) return <ErrorBox message={existing.error} />;
  if (!loaded || !ready) return <Loading label="Loading deck" />;
  if (id && existing.data && !existing.data.isOwner) {
    return (
      <div className="empty-state">
        <h1>This deck belongs to {existing.data.owner.trainerName}</h1>
        <p>
          You can <Link to={`/decks/${id}`}>view it</Link> and copy it to your own decks from there.
        </p>
      </div>
    );
  }

  return (
    <div className="builder">
      <div className="builder-bar">
        <label className="builder-name">
          <span className="sr-only">Deck name</span>
          <input id="deck-name" value={name} maxLength={60} onChange={(e) => change(() => setName(e.target.value))} />
        </label>
        <label>
          <span className="sr-only">Format</span>
          <select id="deck-format" value={format} onChange={(e) => change(() => setFormat(e.target.value as DeckFormat))}>
            {Object.entries(FORMAT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input id="deck-public" type="checkbox" checked={isPublic} onChange={(e) => change(() => setIsPublic(e.target.checked))} />
          Show on my profile
        </label>
        <div className="builder-actions">
          <button type="button" className="secondary-btn" onClick={() => setModal("import")}>
            Import
          </button>
          <button type="button" className="secondary-btn" onClick={() => setModal("export")} disabled={!entries.length}>
            Export
          </button>
          <button type="button" className="primary-btn" onClick={save} disabled={saving || (!!id && !dirty)}>
            {saving ? "Saving…" : !user ? "Log in to save" : id && !dirty ? "Saved" : "Save deck"}
          </button>
        </div>
      </div>
      {message && <p className={message.ok ? "form-ok" : "form-error"}>{message.text}</p>}
      {!user && (
        <p className="muted small">
          You can build without an account. Your deck is kept in this browser until you <Link to="/signup?next=/decks/new">create an account</Link> to save it.
        </p>
      )}

      <div className="builder-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "search"} className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
          Find cards
        </button>
        <button type="button" role="tab" aria-selected={tab === "deck"} className={tab === "deck" ? "active" : ""} onClick={() => setTab("deck")}>
          Your deck ({total})
        </button>
      </div>

      <div className={`builder-grid show-${tab}`}>
        <CardSearch format={format} counts={counts} onAdd={(c) => add(c)} />

        <aside className="builder-deck" aria-label="Your deck">
          <div className="deck-meter">
            <div className="deck-meter-head">
              <strong className={total === DECK_SIZE ? "ok" : ""}>
                {total} / {DECK_SIZE}
              </strong>
              <span className="muted small">
                {SECTIONS.map((s) => `${countOf(groups[s])} ${s}`).join(" · ")}
              </span>
            </div>
            <div className="meter">
              <span style={{ width: `${Math.min(100, (total / DECK_SIZE) * 100)}%` }} className={total > DECK_SIZE ? "over" : total === DECK_SIZE ? "full" : ""} />
            </div>
          </div>

          {entries.length > 0 &&
            (problems.length ? (
              <ul className="problems">
                {problems.map((p) => (
                  <li key={p.rule}>{p.message}</li>
                ))}
              </ul>
            ) : (
              <p className="form-ok">This deck follows all the rules for {FORMAT_LABELS[format]}.</p>
            ))}

          {entries.length === 0 ? (
            <div className="deck-empty">
              <p>Your deck is empty.</p>
              <p className="muted small">Search for cards and click them to add, or import a list you already have.</p>
            </div>
          ) : (
            SECTIONS.map((section) =>
              groups[section].length ? (
                <div key={section} className="deck-section">
                  <h3>
                    {section} <span className="muted">{countOf(groups[section])}</span>
                  </h3>
                  <ul>
                    {groups[section].map(({ card, count }) => (
                      <li key={card.id} className={flagged.has(card.id) ? "flagged" : ""}>
                        <img src={card.image ?? ""} alt="" width={36} height={50} loading="lazy" />
                        <span className="deck-row-name">
                          <Link to={`/cards/${card.id}`} target="_blank" rel="noreferrer">
                            {card.name}
                          </Link>
                          <span className="muted small">
                            {card.setCode ?? card.setName} {card.number}
                          </span>
                        </span>
                        {section === "Pokémon" ? (
                          <button
                            type="button"
                            className={`icon-btn star ${coverCardId === card.id ? "active" : ""}`}
                            title="Use as deck cover"
                            aria-label={`Use ${card.name} as the deck cover`}
                            aria-pressed={coverCardId === card.id}
                            onClick={() => change(() => setCoverCardId(card.id))}
                          >
                            ★
                          </button>
                        ) : (
                          <span />
                        )}
                        <span className="stepper">
                          <button type="button" aria-label={`Remove one ${card.name}`} onClick={() => add(card, -1)}>
                            −
                          </button>
                          <span className="stepper-count">{count}</span>
                          <button type="button" aria-label={`Add one ${card.name}`} onClick={() => add(card, 1)}>
                            +
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )
          )}

          {entries.length > 0 && (
            <div className="deck-tools">
              <p className="small">
                <strong>{Math.round(openingBasicChance(total, basics) * 100)}%</strong> chance of a Basic Pokémon in your opening hand ({basics}{" "}
                Basic Pokémon).
              </p>
              <div className="row-actions">
                <button type="button" className="secondary-btn" onClick={() => setModal("hand")} disabled={total < 7}>
                  Draw a sample hand
                </button>
                <button type="button" className="link-btn" onClick={() => change(() => setEntries([]))}>
                  Remove all cards
                </button>
                {id && (
                  <button type="button" className="link-btn danger" onClick={() => setModal("delete")}>
                    Delete deck
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {modal === "import" && (
        <ImportModal
          onClose={() => setModal(null)}
          onImport={(list) =>
            change(() => {
              setEntries(list);
              setCoverCardId(list.find((e) => e.card.supertype === "Pokémon")?.card.id ?? null);
            })
          }
        />
      )}
      {modal === "export" && <ExportModal entries={entries} onClose={() => setModal(null)} />}
      {modal === "hand" && <HandModal entries={entries} onClose={() => setModal(null)} />}
      {modal === "delete" && (
        <Modal title="Delete this deck?" onClose={() => setModal(null)}>
          <p>“{name}” will be deleted for good.</p>
          <div className="row-actions">
            <button type="button" className="danger-btn" onClick={remove}>
              Delete deck
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
