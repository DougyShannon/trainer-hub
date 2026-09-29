# Trainer Hub

A fan-made site for playing the Pokémon Trading Card Game online with other people, building decks, and browsing every card and Pokémon. Runs on Cloudflare Workers with a D1 database.

## What's here so far

| Page | Address |
| --- | --- |
| Home | `/` |
| Card database | `/cards` (search and filter every English card) |
| Card detail | `/cards/:id`, for example `/cards/base1-4` |
| Pokédex | `/pokedex` |
| Pokémon detail | `/pokedex/:name`, for example `/pokedex/eevee` |
| Sign up and log in | `/signup`, `/login` |
| Trainer profile | `/trainer/:name` |
| Settings | `/me/settings` |
| My decks | `/decks` |
| Deck builder | `/decks/new`, `/decks/:id/edit` |
| Deck page | `/decks/:id` (shareable when the deck is public) |
| My battle teams | `/teams` |
| Team builder | `/teams/new`, `/teams/:id/edit` (six Pokémon with moves, items and EVs; Showdown rules and text format) |
| Team page | `/teams/:id` (shareable when the team is public) |
| Play lobby | `/play` (open a table, join one, or watch a game) |
| Game table | `/play/:id` (the link you send to an opponent) |
| Arcade | `/arcade`, with `/arcade/whos-that-pokemon` and `/arcade/type-quiz` |

## Where the data comes from

- **Cards:** [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data), the open data behind pokemontcg.io. Card images load from that project's image servers.
- **Pokémon:** the CSV files in [PokeAPI/pokeapi](https://github.com/PokeAPI/pokeapi). Sprites, artwork and cries load from [PokeAPI/sprites](https://github.com/PokeAPI/sprites) and [PokeAPI/cries](https://github.com/PokeAPI/cries).

`npm run data:build` downloads both and writes SQL files to `data/seed/`, one per card set. Nothing in `data/` is committed.

## Running it on your own computer

Needs Node.js 22 or newer.

```sh
npm install
npm run data:build        # download cards and Pokémon (about a minute)
npm run db:setup:local    # create the local database and load the data (a few minutes)
npm run dev               # open http://localhost:5173
```

## Putting it online

The **Deploy** GitHub Action publishes the site every time `main` changes.

1. In Cloudflare, go to **My Profile → API Tokens → Create Token** and use the **Edit Cloudflare Workers** template. Add the **D1 → Edit** permission to it.
2. In GitHub, open this repository's **Settings → Secrets and variables → Actions** and add two secrets:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID`: shown on the right of your Cloudflare dashboard's home page
3. In the **Actions** tab, open **Deploy**, click **Run workflow**, tick **Load new card sets and Pokémon**, and run it.

The site appears at `https://trainer-hub.<your-subdomain>.workers.dev`. Run the workflow with the box ticked again whenever a new card set comes out. It only loads sets that are new or have changed, which keeps it inside Cloudflare's free allowance of 100,000 database row writes a day. The very first load of all ~20,000 cards goes over that allowance for the day it runs, so saving accounts and decks may fail until it resets at midnight UTC. To wipe and reload everything, run `node scripts/load-seed.mjs --remote --full` yourself.

## Switching on the assistant

Professor Hub, the chat assistant in the corner of every page, runs on Claude. It stays switched off (and says so) until it has an API key:

1. Create a key at [console.anthropic.com](https://console.anthropic.com) under **API Keys**, and add some credit under **Billing**.
2. In Cloudflare, open **Workers & Pages → trainer-hub → Settings → Variables and Secrets**, click **Add**, choose type **Secret**, name it `ANTHROPIC_API_KEY` and paste the key.

Each trainer can ask 40 questions a day. Trainers named in `ADMIN_TRAINERS` in `wrangler.jsonc` have no limit and can see the site change requests other trainers make, at `/admin/requests`. To try it locally without a key, point `ANTHROPIC_BASE_URL` in `.dev.vars` at a stand-in server.

## Project layout

- `src/worker/` is the server code: the `/api/...` routes. `routes/reference.ts` serves cards and Pokémon, `routes/accounts.ts` handles sign-up, log-in and profiles, and `routes/decks.ts` saves and imports decks.
- `src/worker/routes/games.ts` opens, lists and joins games. Each game runs in its own `GameRoom` Durable Object (`src/worker/game/room.ts`), which players and spectators connect to over a WebSocket.
- `src/worker/game/engine.ts` is the game table: zones, turns, prizes, coin flips and what each player is allowed to see. Moves are made by the players, like on a real play mat; card text isn't enforced.
- `src/worker/routes/assistant.ts` runs the assistant: it sends the question to Claude with a guide to the site and the trainer's saved notes, and runs the tools Claude asks for (`src/worker/assistant/tools.ts`): card search, deck checking and saving, profile changes, notes, opening pages and switching the theme. The chat panel is `src/client/components/Assistant.tsx`, which also handles the microphone and reading answers aloud.
- The Team Builder's game data and rules come from `@pkmn/sim`, the browser build of Pokémon Showdown's simulator (MIT licence). `src/client/teams/engine.ts` wraps it and is only downloaded on the Teams pages (about 1 MB). `src/client/teams/form-sprites.json` maps Pokémon forms to PokeAPI sprite numbers. Teams are saved by `src/worker/routes/teams.ts`, one database row per team.
- `src/shared/deck-rules.ts` holds the 60-card deck rules, used by both the deck builder and the server. `src/shared/game-types.ts` holds the game types shared by the server and the table.
- `src/client/` is the website itself (React).
- `migrations/` holds the database tables.
- `scripts/` holds the data download and loading scripts.

## Legal

Trainer Hub is an unofficial fan site. Pokémon and all related names and images are trademarks of Nintendo, Creatures Inc., GAME FREAK and The Pokémon Company. It is not affiliated with or endorsed by them.
