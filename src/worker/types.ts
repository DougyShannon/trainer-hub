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
  Bindings: { DB: D1Database };
  Variables: { user: User | null };
};
