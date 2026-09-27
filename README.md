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

## Where the data comes from

- **Cards:** [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data), the open data behind pokemontcg.io. Card images load from that project's image servers.
- **Pokémon:** the CSV files in [PokeAPI/pokeapi](https://github.com/PokeAPI/pokeapi). Sprites, artwork and cries load from [PokeAPI/sprites](https://github.com/PokeAPI/sprites) and [PokeAPI/cries](https://github.com/PokeAPI/cries).

`npm run data:build` downloads both and writes SQL files to `data/seed/`. Nothing in `data/` is committed.

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
3. In the **Actions** tab, open **Deploy**, click **Run workflow**, tick **Reload card and Pokémon data**, and run it.

The site appears at `https://trainer-hub.<your-subdomain>.workers.dev`. Run the workflow with the box ticked again whenever a new card set comes out.

## Project layout

- `src/worker/` is the server code: the `/api/...` routes that read the database.
- `src/client/` is the website itself (React).
- `migrations/` holds the database tables.
- `scripts/` holds the data download and loading scripts.

## Legal

Trainer Hub is an unofficial fan site. Pokémon and all related names and images are trademarks of Nintendo, Creatures Inc., GAME FREAK and The Pokémon Company. It is not affiliated with or endorsed by them.
