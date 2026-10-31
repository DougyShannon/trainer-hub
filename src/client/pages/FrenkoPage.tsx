import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PageLogo, ErrorBox, Loading } from "../components/ui";
import type { Button, Frenko } from "../frenko";

// The game code only downloads when someone opens this page, so the rest of the site stays quick.
type FrenkoModule = typeof import("../frenko");
let loading: Promise<FrenkoModule> | null = null;
const loadFrenko = () => (loading ??= import("../frenko"));

const touchScreen = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export function FrenkoPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const console_ = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Frenko | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(touchScreen);

  useEffect(() => {
    let live = true;
    let running: Frenko | null = null;
    let keys: FrenkoModule["KEYS"] = {};
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      const button = keys[e.code];
      if (!running || !button || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); // stop the arrow keys and space scrolling the page
      running.input.press(button);
    };
    const up = (e: KeyboardEvent) => {
      const button = keys[e.code];
      if (running && button) running.input.release(button);
    };
    const blur = () => running?.input.releaseAll();

    loadFrenko()
      .then((frenko) => {
        if (!live || !canvas.current) return;
        keys = frenko.KEYS;
        running = frenko.startFrenko(canvas.current);
        setGame(running);
      })
      .catch(() => {
        loading = null;
        if (live) setError("The game didn't download. Check your connection and refresh.");
      });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      live = false;
      running?.stop();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const canFullscreen = typeof document !== "undefined" && !!document.fullscreenEnabled;
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void console_.current?.requestFullscreen();
  };

  return (
    <div className="frenko">
      <div className="page-head">
        <div>
          <h1 className="with-logo">
            <PageLogo />
            Frenko Region
          </h1>
          <p className="muted">A Pokémon-style adventure in the Frenko Region. Early test build: the game's foundation only.</p>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="frenko-console" ref={console_}>
        <div className="frenko-screen">
          <canvas ref={canvas} width={240} height={160} aria-label="Frenko game screen" />
          {!game && !error && (
            <div className="frenko-loading">
              <Loading label="Loading the game" />
            </div>
          )}
        </div>
        {showPad && game && <TouchPad game={game} />}
      </div>
      <div className="frenko-help">
        <p className="muted">
          <strong>Keyboard:</strong> arrow keys or WASD to move, Z or Space for A, X or Backspace for B, Enter for Start.
        </p>
        <div className="frenko-tools">
          <button type="button" className="secondary-btn" onClick={() => setShowPad((s) => !s)}>
            {showPad ? "Hide on-screen buttons" : "Show on-screen buttons"}
          </button>
          {canFullscreen && (
            <button type="button" className="secondary-btn" onClick={fullscreen}>
              Full screen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** GBA-style buttons for touch screens: a D-pad on the left, Start in the middle, A and B on the right. */
function TouchPad({ game }: { game: Frenko }) {
  const hold = (button: Button) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      game.input.press(button);
    },
    onPointerUp: () => game.input.release(button),
    onPointerCancel: () => game.input.release(button),
    onLostPointerCapture: () => game.input.release(button),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  });
  return (
    <div className="frenko-pad">
      <div className="frenko-dpad" aria-label="Direction pad">
        <button type="button" className="up" aria-label="Up" {...hold("up")} />
        <button type="button" className="left" aria-label="Left" {...hold("left")} />
        <span className="middle" />
        <button type="button" className="right" aria-label="Right" {...hold("right")} />
        <button type="button" className="down" aria-label="Down" {...hold("down")} />
      </div>
      <button type="button" className="frenko-start" {...hold("start")}>
        START
      </button>
      <div className="frenko-ab">
        <button type="button" className="b" {...hold("b")}>
          B
        </button>
        <button type="button" className="a" {...hold("a")}>
          A
        </button>
      </div>
    </div>
  );
}
