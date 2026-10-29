# pact
a webapp for behavior modification

## Development

`cp .env.example .env`, then `npm run dev` (server on :3000, Vite on :5173). `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`.

Production setup (Fly, R2, Google sign-in, DNS, monitoring, practice restore): `scripts/setup-operator.sh`.
