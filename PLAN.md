# Sidebet implementation plan

## First playable slice (implemented)

- Embedded Discord Activity UI, OAuth code exchange, server-membership checks.
- D1 wallets keyed by Discord user ID across servers; server-scoped props and leaderboards.
- 1,000 starting points; refill to 1,000 below 100, once per 24 hours.
- Yes/No props, one immutable stake per participant, close deadlines.
- Creator settlement or strict majority of all bettors; void refunds.
- Proportional pooled payouts, conserved integer points, transactional writes.
- Local demo and core accounting tests.

## Cloudflare migration (implemented)

- Worker serves API and static assets; D1 owns persistent data.
- Versioned SQL migration with atomic debit/payout triggers.
- Persistent, hashed one-hour sessions and server membership verification.
- Local demo config, deployment dry-run and local D1/Worker integration tests.
- Remote D1 provisioning, secrets, deployment and in-Discord validation remain external steps.

## Before shared deployment

- Configure Discord application and HTTPS hosting; test embedded OAuth and URL mappings in Discord.
- Add authenticated multi-user end-to-end tests and an explicit dispute policy.
- Add rate limits, audit ledger, backups and migration tooling.
- Replace final-winner rounding with largest-remainder allocation if desired.
- Decide how stalled votes and abandoned creator props expire/refund.
- Refill economics need review: refills issue new play points and can reward repeated losses.

## Sports integration

- Choose league/provider and licensing before integration.
- Store provider event IDs, explicit market criteria and settlement evidence.
- Ingest signed/provider-authenticated results server-side; idempotent settlement and postponement/void rules.
- Never let clients supply automatic results. Automatic props are rejected until a provider exists.

## Later

- Challenges/invitations, Activity participant presence, history and richer moderation.
- The current leaderboard ranks global balances of people who have bet in that server.
