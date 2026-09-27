import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import typeChart from "../../../shared/type-chart.json";
import { useApi, type PokemonSummary } from "../../lib/api";
import { sprite } from "../../lib/sprites";
import { useBest } from "../../lib/best";
import { ErrorBox, GAME_TYPES, Loading, TypeBadge } from "../../components/ui";

const chart = typeChart as Record<string, Record<string, number>>;
const ROUND_LENGTH = 10;

type Question = { attack: string; defender: PokemonSummary; parts: { type: string; value: number }[]; total: number };

const LABEL: Record<number, string> = { 4: "4×", 2: "2×", 1: "1×", 0.5: "½×", 0.25: "¼×", 0: "0×" };
const MEANING: Record<number, string> = {
  4: "super effective (4×)",
  2: "super effective",
  1: "normal damage",
  0.5: "not very effective",
  0.25: "barely effective (¼×)",
  0: "no effect",
};
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function makeQuestion(pokemon: PokemonSummary[]): Question {
  // Most questions have an interesting answer; about one in four is plain 1× damage.
  const wantPlain = Math.random() < 0.25;
  for (let tries = 0; tries < 200; tries++) {
    const defender = pokemon[Math.floor(Math.random() * pokemon.length)];
    const attack = GAME_TYPES[Math.floor(Math.random() * GAME_TYPES.length)];
    const parts = defender.types.map((t) => ({ type: t, value: chart[attack]?.[t] ?? 1 }));
    const total = parts.reduce((m, p) => m * p.value, 1);
    if ((total === 1) === wantPlain || tries > 150) return { attack, defender, parts, total };
  }
  throw new Error("unreachable");
}

export function TypeQuizPage() {
  const { data, error, loading } = useApi<PokemonSummary[]>("/api/pokemon");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [right, setRight] = useState(0);
  const [best, offerBest] = useBest("type-quiz");
  const [finished, setFinished] = useState<{ score: number; newBest: boolean } | null>(null);

  const start = useCallback(() => {
    if (!data?.length) return;
    setQuestions(Array.from({ length: ROUND_LENGTH }, () => makeQuestion(data)));
    setIndex(0);
    setPicked(null);
    setRight(0);
    setFinished(null);
  }, [data]);

  useEffect(() => {
    start();
  }, [start]);

  const q = questions[index];
  const options = useMemo(() => (q ? (q.parts.length > 1 ? [4, 2, 1, 0.5, 0.25, 0] : [2, 1, 0.5, 0]) : []), [q]);

  const choose = (value: number) => {
    if (picked !== null || !q) return;
    setPicked(value);
    if (value === q.total) setRight((n) => n + 1);
  };

  const next = () => {
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      setPicked(null);
    } else {
      setFinished({ score: right, newBest: offerBest(right) });
    }
  };

  if (loading && !data) return <Loading label="Loading Pokémon" />;
  if (error || !data) return <ErrorBox message={error ?? "Unknown error"} />;

  return (
    <div className="arcade-game">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link to="/arcade">Arcade</Link>
          </p>
          <h1>Type Matchup Quiz</h1>
        </div>
        <div className="arcade-scores">
          <span>
            Question <strong>{finished ? ROUND_LENGTH : index + 1}</strong>/{ROUND_LENGTH}
          </span>
          <span>
            Correct <strong>{right}</strong>
          </span>
          <span>
            Best <strong>{best}</strong>/{ROUND_LENGTH}
          </span>
        </div>
      </div>

      {finished ? (
        <section className="panel quiz-done">
          <h2>
            You got {finished.score} out of {ROUND_LENGTH}
          </h2>
          <p>
            {finished.newBest
              ? "That's your new best!"
              : finished.score === ROUND_LENGTH
                ? "A perfect round!"
                : finished.score >= 7
                  ? "Great type knowledge."
                  : "Every Pokémon page has a type matchup table if you want to brush up."}
          </p>
          <div className="row-actions">
            <button type="button" className="primary-btn" onClick={start}>
              Play again
            </button>
            <Link to="/arcade" className="secondary-btn">
              Back to the Arcade
            </Link>
          </div>
        </section>
      ) : (
        q && (
          <section className="panel quiz-card" aria-live="polite">
            <div className="quiz-question">
              <img src={sprite(q.defender.id)} alt="" width={96} height={96} className="quiz-sprite" />
              <p>
                A <TypeBadge type={q.attack} /> move hits <strong>{q.defender.name}</strong>{" "}
                <span className="type-row inline">
                  {q.defender.types.map((t) => (
                    <TypeBadge key={t} type={t} />
                  ))}
                </span>
                . How effective is it?
              </p>
            </div>
            <div className="quiz-options">
              {options.map((v) => {
                const state = picked === null ? "" : v === q.total ? " right" : v === picked ? " wrong" : " faded";
                return (
                  <button key={v} type="button" className={`quiz-option${state}`} disabled={picked !== null} onClick={() => choose(v)}>
                    {LABEL[v]}
                  </button>
                );
              })}
            </div>
            {picked !== null && (
              <div className={`quiz-explain ${picked === q.total ? "right" : "wrong"}`}>
                <p>
                  <strong>{picked === q.total ? "Correct!" : "Not quite."}</strong> {capitalise(q.attack)} is {MEANING[q.total]} against{" "}
                  {q.defender.name}.
                </p>
                {q.parts.length > 1 && (
                  <p className="small">
                    {q.parts.map((p) => `${capitalise(q.attack)} vs ${capitalise(p.type)}: ${LABEL[p.value]}`).join(" · ")} → {LABEL[q.total]}
                  </p>
                )}
                <button type="button" className="primary-btn" onClick={next} autoFocus>
                  {index + 1 < questions.length ? "Next question" : "See my score"}
                </button>
              </div>
            )}
          </section>
        )
      )}
    </div>
  );
}
