import { Hono } from "hono";
import type { AppEnv } from "./types";
import { jsonOnlyWrites, loadUser } from "./lib/auth";
import { reference } from "./routes/reference";
import { accounts } from "./routes/accounts";
import { decks } from "./routes/decks";
import { games } from "./routes/games";

const app = new Hono<AppEnv>();

app.use("/api/*", jsonOnlyWrites);
app.use("/api/*", loadUser);

app.route("/", reference);
app.route("/", accounts);
app.route("/", decks);
app.route("/", games);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong on our side" }, 500);
});

export default app;
export { GameRoom } from "./game/room";
