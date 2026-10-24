# Sidebet — Discord prop betting with friends

A Discord Activity with free play-money points. A Cloudflare Worker serves the frontend and API; Cloudflare D1 stores cross-server wallets, server boards, stakes, votes, and hashed login sessions. No bot process, paid server, or local disk is required in production. Free-tier quotas still apply; check Cloudflare's current limits.

## Local development

Requires Node.js 24+.

```sh
npm ci --cache /tmp/prop-npm-cache
npm run db:migrate:local
npm run dev
```

Wrangler serves the built Activity and API on port 8787. The explicit `local` environment enables demo sign-in on localhost only. Frontend edits require rebuilding and restarting. Local D1 state is retained in `.wrangler/`. Use the existing checkout rather than creating a worktree.

```sh
npm test              # Real local D1/Worker runtime; accounting, concurrency and HTTP tests
npm run deploy:check  # Build and package without publishing
```

On this managed cloud machine, prefix Wrangler commands with `XDG_CONFIG_HOME=/workspace/.cloudflare-config WRANGLER_SEND_METRICS=false` because the default home configuration directory is not writable.

## Deploy to Cloudflare

Run these commands on a machine authenticated to your Cloudflare account. This repository has not been deployed remotely.

1. Authenticate: `npx wrangler login` (or use a scoped Cloudflare API token through your CI secret manager).
2. Create D1: `npx wrangler d1 create sidebet`. Replace the **top-level** placeholder `database_id` in `wrangler.jsonc` with the returned UUID. Keep the `local` environment separate.
3. Put your public Discord Application ID in the top-level `vars.DISCORD_CLIENT_ID`. Leave `DEMO_MODE` set to `false`.
4. Add the OAuth secret securely: `npx wrangler secret put DISCORD_CLIENT_SECRET --env ""`. Enter it at the prompt; never commit it. No bot token is needed.
5. Apply production schema: `npm run db:migrate:remote`. This targets the top-level production database, not the local demo database. Inspect the database ID first.
6. Deploy: `npm run deploy`. Wrangler uploads the Worker and `dist/` assets and returns an HTTPS `workers.dev` URL.
7. Request `/api/health` on that URL; it should return `{"ok":true}`. `/api/config` must show `demo:false` and your public client ID. `/api/state` must reject unauthenticated access.
8. In the Discord Developer Portal, enable Activities and map `/` to your Worker hostname. Both frontend and API use that origin. Configure any OAuth redirect/test access settings required by Discord's current Embedded App SDK instructions.
9. Launch inside a test server with two accounts. Authorize `identify` and `guilds`, create a short-lived prop, place opposing picks, settle, and check balances in another server. DMs are not supported. Live embedded authentication still needs this validation.

The browser sends its Discord authorization code to the Worker. Only the Worker uses `DISCORD_CLIENT_SECRET` and calls Discord. Sessions last one hour, survive Worker restarts, and store only token hashes in D1. Reopen the Activity after expiry.

For local testing with real Discord, copy `.dev.vars.example` to `.dev.vars`, enter the secret there, configure the public ID, apply the schema to the default local binding (`npx wrangler d1 migrations apply DB --local --env ""`), then run `npm run dev:discord`. A public HTTPS development endpoint and Discord URL mapping are required. Never commit `.dev.vars` or tokens.

## Existing SQLite demo data

The original `data/bets.sqlite` is left untouched and ignored. It is **not automatically imported** into D1. Fresh D1 starts with an empty board and creates wallets on sign-in. Do not run a raw schema dump import: the new triggers and sessions need the new schema. If preserving old real-user data is needed, plan a separate backed-up data import before opening production.

## Rules and remaining work

- Global wallet: 1,000 starting points. Below 100, refill to 1,000 at most once every 24 hours.
- Server-scoped Yes/No props; one immutable positive-integer stake per person.
- Settlement after closing by the creator or a strict majority of all bettors. Votes may change until settlement. Unresolved props remain locked pending agreement.
- Winners share the pool proportionally. Integer rounding remainder goes to the final winning user ID. No winners or explicit creator void means refunds.
- Points cannot be bought, sold, redeemed or exchanged for prizes.

See [PLAN.md](PLAN.md) for sports integration, moderation, dispute/refund rules, transaction history, privacy/deletion, rate limits and dependency review still needed before public release.
