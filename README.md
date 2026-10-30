# pact
a webapp for behavior modification

## Development

`cp .env.example .env`, then `npm run dev` (server on :3000, Vite on :5173). `npm run check` runs what CI runs: typecheck, lint, test and build, stopping at the first failure. Each is also its own script, plus `npm run format`.

Production setup (Fly, R2, Google sign-in, DNS, monitoring, practice restore): `scripts/setup-operator.sh`.
