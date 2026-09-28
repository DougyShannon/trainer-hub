import type { GameRoom } from "./game/room";

export type User = {
  id: number;
  email: string;
  trainerName: string;
  avatarDex: number;
  favouriteDex: number | null;
  bio: string;
  country: string;
  createdAt: string;
};

export type AppEnv = {
  Bindings: {
    DB: D1Database;
    GAME_ROOM: DurableObjectNamespace<GameRoom>;
    ADMIN_TRAINERS?: string;
    ANTHROPIC_API_KEY?: string; // set as a Cloudflare secret; the assistant is switched off without it
    ASSISTANT_MODEL?: string;
    ANTHROPIC_BASE_URL?: string; // only for local testing against a stand-in server
  };
  Variables: { user: User | null };
};
