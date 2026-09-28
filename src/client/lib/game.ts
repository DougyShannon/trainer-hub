import { useCallback, useEffect, useRef, useState } from "react";
import type { CardRef, ClientMessage, GameAction, GameView, ServerMessage } from "../../shared/game-types";

export type Connection = "connecting" | "open" | "reconnecting" | "closed";

/**
 * Keeps a live connection to a game room. Reconnects on its own if the connection drops
 * (a phone going to sleep, patchy Wi-Fi), and pings so idle connections stay open.
 */
export function useGameSocket(gameId: string | null, key = 0) {
  const [view, setView] = useState<GameView | null>(null);
  const [deck, setDeck] = useState<CardRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let stopped = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const open = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/games/${gameId}/ws`);
      socket.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnection("open");
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 25_000);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === "state") setView(msg.view);
        else if (msg.type === "deck") setDeck(msg.cards);
        else if (msg.type === "error") setError(msg.message);
      };
      ws.onclose = (e) => {
        clearInterval(ping);
        if (stopped) return;
        if (e.code === 4000) {
          setConnection("closed");
          return;
        }
        setConnection("reconnecting");
        attempts += 1;
        retry = setTimeout(open, Math.min(10_000, 500 * 2 ** attempts));
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      socket.current?.close();
    };
  }, [gameId, key]);

  const act = useCallback((action: GameAction) => {
    setError(null);
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("Not connected. Trying to reconnect…");
      return;
    }
    ws.send(JSON.stringify({ type: "action", action } satisfies ClientMessage));
  }, []);

  return { view, deck, closeDeck: () => setDeck(null), error, clearError: () => setError(null), connection, act };
}
