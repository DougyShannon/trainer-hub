import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamDetail } from "../lib/api";
import type { LiveBattleView, LiveClientMessage, LiveServerMessage } from "../../shared/live-battle";
import type { Connection } from "../lib/game";
import { loadBattleEngine } from "./load";

/** Team Builder sets in the simulator's shape (blank moves dropped). */
export function cleanForSim(set: TeamDetail["sets"][number]) {
  return {
    ...set,
    moves: set.moves.filter(Boolean),
    gender: set.gender || undefined,
    teraType: set.teraType || undefined,
    name: set.name || set.species,
  };
}

/** Problems that stop one of the trainer's own teams playing this format (empty when it's fine). */
export async function problemsFor(teamId: string, formatid: string): Promise<string[]> {
  const res = await fetch(`/api/teams/${teamId}`);
  if (!res.ok) return ["Couldn't load that team."];
  const team = (await res.json()) as TeamDetail;
  if (!team.sets.length) return ["That team has no Pokémon yet."];
  const engine = await loadBattleEngine();
  await engine.loadSimLib(formatid);
  return engine.checkTeam(formatid, team.sets.map(cleanForSim));
}

/**
 * Keeps a live connection to a battle room, like the Play tab's game rooms: reconnects on its own
 * and pings so idle connections stay open. The last choice is sent again after reconnecting in case
 * it was lost on the way; the room ignores a choice it already has.
 */
export function useLiveBattleSocket(battleId: string | null, key = 0) {
  const [view, setView] = useState<LiveBattleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const socket = useRef<WebSocket | null>(null);
  const lastChoice = useRef<LiveClientMessage | null>(null);

  useEffect(() => {
    if (!battleId) return;
    let stopped = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    setView(null);
    setConnection("connecting");

    const open = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/live-battles/${battleId}/ws`);
      socket.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnection("open");
        if (lastChoice.current) ws.send(JSON.stringify(lastChoice.current));
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 25_000);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as LiveServerMessage;
        if (msg.type === "state") setView(msg.view);
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
  }, [battleId, key]);

  const send = useCallback((msg: LiveClientMessage) => {
    setError(null);
    if (msg.type === "choose") lastChoice.current = msg;
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (msg.type !== "choose") setError("Not connected. Trying to reconnect…");
      return;
    }
    ws.send(JSON.stringify(msg));
  }, []);

  return { view, error, clearError: () => setError(null), connection, send };
}
