import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { send } from "../lib/api";
import { useAuth } from "../lib/auth";
import { setTheme, type Theme } from "../lib/theme";

type Message = { role: "user" | "assistant"; text: string; decks?: { id: string; name: string }[]; error?: boolean };
type Status = { enabled: boolean; loggedIn: boolean; isAdmin?: boolean; remaining?: number | null; notes?: string[] };
type Action = { type: "navigate"; to: string } | { type: "theme"; theme: Theme };

const STORE = "trainer-hub:assistant-chat";
const SUGGESTIONS = [
  "Build me a Fire deck that beats Psychic decks",
  "What is Charizard ex weak to?",
  "Which Pokémon evolve from Eevee?",
  "Switch the site to dark mode",
];

// ----- Speech (built into Chrome, Edge and Safari) -----

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const SpeechRecognitionImpl: (new () => Recognition) | undefined =
  typeof window !== "undefined"
    ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as
        | (new () => Recognition)
        | undefined
    : undefined;
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

const plainForSpeech = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

function speak(text: string) {
  if (!canSpeak) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plainForSpeech(text).slice(0, 1500));
  u.rate = 1.03;
  window.speechSynthesis.speak(u);
}

// ----- A tiny, safe markdown renderer: paragraphs, bullet lists, **bold** and links -----

function inline(text: string, onLink: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[3]) out.push(<strong key={k++}>{m[3]}</strong>);
    else if (m[2].startsWith("/") && !m[2].startsWith("//")) {
      out.push(
        <Link key={k++} to={m[2]} onClick={onLink}>
          {m[1]}
        </Link>,
      );
    } else if (/^https:\/\//.test(m[2])) {
      out.push(
        <a key={k++} href={m[2]} target="_blank" rel="noopener noreferrer">
          {m[1]}
        </a>,
      );
    } else out.push(m[1]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text, onLink }: { text: string; onLink: () => void }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), onLink)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ""), onLink)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

// ----- The chat panel -----

export function Assistant() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORE) ?? "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [listening, setListening] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40)));
    } catch {
      // ignore
    }
  }, [messages]);

  const loadStatus = useCallback(() => {
    fetch("/api/assistant/status", { cache: "no-store" })
      .then((r) => r.json() as Promise<Status>)
      .then((s: Status) => setStatus(s))
      .catch(() => setStatus({ enabled: false, loggedIn: !!user }));
  }, [user]);

  useEffect(() => {
    if (open) loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const runActions = (actions: Action[]) => {
    for (const a of actions) {
      if (a.type === "navigate" && a.to.startsWith("/") && !a.to.startsWith("//")) navigate(a.to);
      if (a.type === "theme") setTheme(a.theme);
    }
  };

  const ask = async (text: string, spoken = false) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: Message[] = [...messages, { role: "user", text: question }];
    setMessages(next);
    setInput("");
    setBusy("Thinking");
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text })) }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Something went wrong. Try again.");
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let answered = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as
            | { type: "status"; text: string }
            | { type: "reply"; text: string; decks: Message["decks"]; actions: Action[] }
            | { type: "error"; message: string };
          if (ev.type === "status") setBusy(ev.text);
          else if (ev.type === "error") throw new Error(ev.message);
          else {
            answered = true;
            setMessages((m) => [...m, { role: "assistant", text: ev.text, decks: ev.decks }]);
            if (readAloud || spoken) speak(ev.text);
            runActions(ev.actions ?? []);
          }
        }
      }
      if (!answered) throw new Error("The answer got cut off. Try again.");
      loadStatus();
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: (e as Error).message, error: true }]);
    } finally {
      setBusy(null);
    }
  };

  const toggleMic = () => {
    if (!SpeechRecognitionImpl) return;
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new SpeechRecognitionImpl();
    r.lang = navigator.language || "en-AU";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setInput(finalText || interim);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setMessages((m) => [...m, { role: "assistant", text: "I need permission to use your microphone. Check your browser's site settings.", error: true }]);
    };
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) ask(finalText, true);
    };
    recognition.current = r;
    window.speechSynthesis?.cancel();
    setListening(true);
    r.start();
  };

  const forgetAll = async () => {
    await send("DELETE", "/api/assistant/memory").catch(() => {});
    setShowNotes(false);
    loadStatus();
  };

  if (pathname.startsWith("/play/")) return null; // keep the game table clear

  const closeOnPhone = () => {
    if (window.matchMedia("(max-width: 640px)").matches) setOpen(false);
  };

  return (
    <>
      {!open && (
        <button type="button" className="assistant-fab" onClick={() => setOpen(true)} aria-label="Ask Professor Hub">
          <span aria-hidden="true" className="assistant-fab-icon">?</span>
          <span className="assistant-fab-label">Ask Professor Hub</span>
        </button>
      )}
      {open && (
        <section className="assistant-panel" role="dialog" aria-label="Professor Hub assistant">
          <header className="assistant-head">
            <div>
              <strong>Professor Hub</strong>
              <span className="muted small">
                {status?.remaining != null ? `${status.remaining} questions left today` : "Your Pokémon assistant"}
              </span>
            </div>
            <div className="assistant-head-actions">
              {status?.loggedIn && status.enabled && (
                <button type="button" className="chip-btn" onClick={() => setShowNotes((s) => !s)} aria-expanded={showNotes}>
                  Memory
                </button>
              )}
              {messages.length > 0 && (
                <button type="button" className="chip-btn" onClick={() => setMessages([])}>
                  New chat
                </button>
              )}
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
          </header>

          {showNotes && status?.notes && (
            <div className="assistant-notes">
              <p className="small">
                <strong>What I remember about you</strong>
              </p>
              {status.notes.length ? (
                <ol>
                  {status.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ol>
              ) : (
                <p className="muted small">Nothing yet. Tell me your favourite Pokémon or what deck you're building and I'll remember it.</p>
              )}
              {status.notes.length > 0 && (
                <button type="button" className="link-btn danger" onClick={forgetAll}>
                  Forget everything
                </button>
              )}
              {status.isAdmin && (
                <Link to="/admin/requests" className="small" onClick={closeOnPhone}>
                  Site change requests
                </Link>
              )}
            </div>
          )}

          <div className="assistant-body" ref={list} aria-live="polite">
            {!status ? (
              <p className="muted small">Loading…</p>
            ) : !status.enabled ? (
              <div className="assistant-empty">
                <p>
                  <strong>Professor Hub is almost ready.</strong>
                </p>
                <p className="muted">The assistant hasn't been switched on for this site yet. Check back soon!</p>
              </div>
            ) : !status.loggedIn ? (
              <div className="assistant-empty">
                <p>
                  <strong>Hi, I'm Professor Hub!</strong> I can build decks, answer Pokémon questions and help you find your way around.
                </p>
                <p>
                  <Link to={`/login?next=${encodeURIComponent(pathname)}`} onClick={() => setOpen(false)}>
                    Log in
                  </Link>{" "}
                  or{" "}
                  <Link to="/signup" onClick={() => setOpen(false)}>
                    sign up
                  </Link>{" "}
                  to chat with me.
                </p>
              </div>
            ) : (
              <>
                {!messages.length && (
                  <div className="assistant-empty">
                    <p>
                      <strong>Hi {user?.trainerName}, I'm Professor Hub!</strong> Ask me about any card or Pokémon, ask for a deck, or tell
                      me what you'd like to change.
                      {SpeechRecognitionImpl ? " You can talk to me with the microphone too." : ""}
                    </p>
                    <div className="assistant-suggestions">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} type="button" className="chip-btn" onClick={() => ask(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`bubble ${m.role}${m.error ? " error" : ""}`}>
                    {m.role === "assistant" ? <Markdown text={m.text} onLink={closeOnPhone} /> : <p>{m.text}</p>}
                    {m.decks?.map((d) => (
                      <Link key={d.id} to={`/decks/${d.id}`} className="bubble-deck" onClick={closeOnPhone}>
                        Open deck: {d.name}
                      </Link>
                    ))}
                    {m.role === "assistant" && !m.error && canSpeak && (
                      <button type="button" className="link-btn small" onClick={() => speak(m.text)}>
                        Read aloud
                      </button>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="bubble assistant working" role="status">
                    <span className="spinner" aria-hidden="true" /> {busy}…
                  </div>
                )}
              </>
            )}
          </div>

          {status?.enabled && status.loggedIn && (
            <form
              className="assistant-input"
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
            >
              <label htmlFor="assistant-q" className="sr-only">
                Ask Professor Hub
              </label>
              <textarea
                id="assistant-q"
                ref={field}
                rows={1}
                value={input}
                maxLength={2000}
                placeholder={listening ? "Listening…" : "Ask anything about Pokémon"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
              />
              {SpeechRecognitionImpl && (
                <button
                  type="button"
                  className={`mic-btn${listening ? " on" : ""}`}
                  onClick={toggleMic}
                  aria-label={listening ? "Stop listening" : "Speak your question"}
                  aria-pressed={listening}
                  disabled={!!busy}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
                  </svg>
                </button>
              )}
              <button type="submit" className="primary-btn small" disabled={!!busy || !input.trim()}>
                Send
              </button>
              {canSpeak && (
                <label className="check assistant-aloud">
                  <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} /> Read answers aloud
                </label>
              )}
            </form>
          )}
        </section>
      )}
    </>
  );
}
