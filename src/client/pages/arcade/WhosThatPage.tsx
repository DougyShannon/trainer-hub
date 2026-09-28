import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useApi, type PokemonSummary } from "../../lib/api";
import { artwork, cry, dexNumber } from "../../lib/sprites";
import { shuffled, useBest } from "../../lib/best";
import { ErrorBox, Loading, TypeBadge } from "../../components/ui";

const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const simplify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

type Round = { answer: PokemonSummary; choices: PokemonSummary[] };
type Result = { correct: boolean; guess: string } | null;

function newRound(pool: PokemonSummary[]): Round {
  const answer = pool[Math.floor(Math.random() * pool.length)];
  const others = shuffled(pool.filter((p) => p.id !== answer.id)).slice(0, 3);
  return { answer, choices: shuffled([answer, ...others]) };
}

export function WhosThatPage() {
  const { data, error, loading } = useApi<PokemonSummary[]>("/api/pokemon");
  const [gens, setGens] = useState<number[]>([]); // empty = every generation
  const [typing, setTyping] = useState(false);
  const [sound, setSound] = useState(true);
  const [round, setRound] = useState<Round | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [guess, setGuess] = useState("");
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState({ right: 0, played: 0 });
  const [best, offerBest] = useBest("whos-that-pokemon");
  const [newBest, setNewBest] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);

  const pool = useMemo(() => (data ?? []).filter((p) => !gens.length || gens.includes(p.generation)), [data, gens]);

  const next = useCallback(() => {
    if (pool.length < 4) return;
    setRound(newRound(pool));
    setResult(null);
    setGuess("");
    setNewBest(false);
    setImageReady(false);
  }, [pool]);

  // Start (or restart) when the list arrives or the settings change.
  useEffect(() => {
    next();
  }, [next]);

  useEffect(() => {
    if (result) nextButton.current?.focus();
    else if (typing) input.current?.focus();
  }, [result, typing, round]);

  const answer = (picked: string) => {
    if (!round || result) return;
    const correct = simplify(picked) === simplify(round.answer.name);
    setResult({ correct, guess: picked });
    setScore((s) => ({ right: s.right + (correct ? 1 : 0), played: s.played + 1 }));
    const streakNow = correct ? streak + 1 : 0;
    setStreak(streakNow);
    if (correct && offerBest(streakNow)) setNewBest(true);
    if (sound) {
      const audio = new Audio(cry(round.answer.id));
      audio.volume = 0.4;
      audio.play().catch(() => {});
    }
  };

  const toggleGen = (g: number) => setGens((list) => (list.includes(g) ? list.filter((x) => x !== g) : [...list, g].sort()));

  if (loading && !data) return <Loading label="Loading Pokémon" />;
  if (error || !data) return <ErrorBox message={error ?? "Unknown error"} />;

  return (
    <div className="arcade-game">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link to="/arcade">Arcade</Link>
          </p>
          <h1>Who's That Pokémon?</h1>
        </div>
        <div className="arcade-scores">
          <span>
            Streak <strong>{streak}</strong>
          </span>
          <span>
            Best <strong>{best}</strong>
          </span>
          <span>
            Score{" "}
            <strong>
              {score.right}/{score.played}
            </strong>
          </span>
        </div>
      </div>

      <div className="wtp-layout">
        <section className="wtp-stage" aria-live="polite">
          {round && (
            <>
              <div className={`wtp-art${result ? " revealed" : ""}`}>
                {!imageReady && <span className="spinner" aria-hidden="true" />}
                <img
                  key={round.answer.id}
                  src={artwork(round.answer.id)}
                  alt={result ? round.answer.name : "A mystery Pokémon's silhouette"}
                  width={320}
                  height={320}
                  onLoad={() => setImageReady(true)}
                  draggable={false}
                />
              </div>

              {result ? (
                <div className={`wtp-result ${result.correct ? "right" : "wrong"}`}>
                  <p className="wtp-verdict">
                    {result.correct ? (newBest ? "New best streak!" : "Correct!") : result.guess ? "Not quite." : "Here's who it was."}
                  </p>
                  <p className="wtp-name">
                    It's <strong>{round.answer.name}</strong> <span className="dex-no">{dexNumber(round.answer.id)}</span>
                  </p>
                  <span className="type-row">
                    {round.answer.types.map((t) => (
                      <TypeBadge key={t} type={t} />
                    ))}
                  </span>
                  <div className="row-actions">
                    <button ref={nextButton} type="button" className="primary-btn" onClick={next}>
                      Next Pokémon
                    </button>
                    <Link to={`/pokedex/${round.answer.slug}`} className="secondary-btn">
                      See its Pokédex entry
                    </Link>
                  </div>
                </div>
              ) : typing ? (
                <form
                  className="wtp-type"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (guess.trim()) answer(guess.trim());
                  }}
                >
                  <label htmlFor="wtp-guess" className="sr-only">
                    Your guess
                  </label>
                  <input
                    id="wtp-guess"
                    ref={input}
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    placeholder="Type the Pokémon's name"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <button type="submit" className="primary-btn">
                    Guess
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => answer("")}>
                    Give up
                  </button>
                </form>
              ) : (
                <div className="wtp-choices">
                  {round.choices.map((c) => (
                    <button key={c.id} type="button" className="secondary-btn" onClick={() => answer(c.name)}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <aside className="panel wtp-settings">
          <h2>Settings</h2>
          <div className="field">
            <span>Generations</span>
            <div className="chip-set" role="group" aria-label="Generations">
              <button type="button" className={`chip-btn${!gens.length ? " on" : ""}`} aria-pressed={!gens.length} onClick={() => setGens([])}>
                All
              </button>
              {GENERATIONS.map((g) => (
                <button key={g} type="button" className={`chip-btn${gens.includes(g) ? " on" : ""}`} aria-pressed={gens.includes(g)} onClick={() => toggleGen(g)}>
                  Gen {g}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>How to answer</span>
            <div className="segmented small" role="group" aria-label="How to answer">
              <button type="button" className={!typing ? "active" : ""} onClick={() => setTyping(false)}>
                Pick from 4
              </button>
              <button type="button" className={typing ? "active" : ""} onClick={() => setTyping(true)}>
                Type the name
              </button>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Play the Pokémon's cry
          </label>
          <p className="muted small">
            {pool.length.toLocaleString()} Pokémon in play. Your best streak is saved in this browser.
          </p>
        </aside>
      </div>
    </div>
  );
}
