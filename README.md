# BoardOps — Cloudflare Edition

BoardOps runs on Cloudflare while preserving the existing product behavior and UI.

## Runtime architecture

- **Application:** Next.js 16 + React 19, compiled for Cloudflare Workers through vinext/Vite.
- **Relational data:** Cloudflare D1 through Prisma and `@prisma/adapter-d1`.
- **Uploads:** Cloudflare R2 through the `UPLOADS` binding.
- **Authentication throttling:** Cloudflare Workers Rate Limiting through `AUTH_RATE_LIMITER`.
- **Transactional email:** Cloudflare Email through the `EMAIL` binding.
- **Recovery:** Cloudflare-managed D1 backup/export/Time Travel.
- **Production runtime:** Cloudflare `workerd`. There is no long-running Node application server.

Node.js 22 and npm are the sole JavaScript toolchain for local development, build tooling, tests, and GitHub Actions. Production runs on Cloudflare workerd.

## Repository quality gates

Every push to `phase/cf-01-runtime-foundation` validates:

1. npm dependency installation;
2. Prisma client generation;
3. local D1 migrations and schema smoke queries;
4. Vitest regression tests;
5. production TypeScript with zero errors;
6. ESLint with zero warnings;
7. vinext compatibility;
8. the full Cloudflare production bundle.

## Local development

Requirements:

- Node.js 22
- npm

Install dependencies and generate Prisma types:

```bash
npm ci
npm run db:generate
```

Create the local D1 schema and a local administrator:

```bash
npm run db:bootstrap:local
```

The bootstrap command uses Wrangler `--local` only. It prints the generated local administrator credentials in your terminal and never writes them to the repository.

Start development:

```bash
npm run dev
```

Run the production-quality gates locally:

```bash
npm test
npm run typecheck
npm run lint:strict
npm run cf:check
npm run build
```

Preview the generated Worker bundle locally:

```bash
npm run preview
```

`npm run start` starts Wrangler against an already-generated `dist/server/wrangler.json`; run `npm run build` first.

## Cloudflare resource provisioning

The repository intentionally contains no real Cloudflare account credentials.

### D1

Create the production database:

```bash
npx wrangler d1 create boardops
```

The checked-in `wrangler.jsonc` intentionally keeps a placeholder D1 ID. The production GitHub workflow injects `CLOUDFLARE_D1_DATABASE_ID` into its checkout at deployment time.

Local migration:

```bash
npm run db:migrate:local
```

Remote production migration, only after the production D1 resource is configured:

```bash
npm run db:migrate:remote
```

### R2

Create the upload bucket:

```bash
npx wrangler r2 bucket create boardops-uploads
```

The Worker expects the binding `UPLOADS`.

### Authentication rate limiting

The Worker expects `AUTH_RATE_LIMITER`. Review the checked-in rate-limit policy before production launch.

### Transactional email

Configure Cloudflare Email for the production domain and set a verified sender in `EMAIL_FROM`.

```bash
npx wrangler secret put EMAIL_FROM
```

Production authentication flows that require OTP/password-reset email fail closed if email is not configured.

## Existing-data cutover

Creating D1 tables is not the same as migrating existing live data. For a production cutover:

1. take and verify a source backup/export;
2. rehearse the conversion/import into a non-production D1 database;
3. verify row counts, foreign keys, financial totals, authentication records, and representative data;
4. freeze writes on the old deployment;
5. export the final source state;
6. import/transform into D1;
7. run integrity checks;
8. deploy and test authentication, billing, meals, uploads, refunds, and administration;
9. switch production traffic only after all checks pass;
10. retain the old deployment read-only during the rollback window.

The local administrator bootstrap is never a production migration mechanism.

## Deployment safety

`npm run deploy` runs `npm run cf:preflight` first. The preflight refuses deployment when the D1 ID is still the placeholder or required D1, R2, rate-limit, email, or Worker bindings are missing.

The manual **Deploy BoardOps to Cloudflare** GitHub workflow expects:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`

Optionally configure `BOARDOPS_PRODUCTION_URL` to enable the post-deployment `/api` smoke test.

Manual validation/deployment sequence once real Cloudflare resources are provisioned:

```bash
npm ci
npm run db:generate
npm test
npm run typecheck
npm run lint:strict
npm run cf:check
npm run build
npm run db:migrate:remote
npm run deploy
```

## Security and operations

- Never commit `.env` files, `.dev.vars`, database exports, backups, generated uploads, API tokens, or runtime logs.
- Runtime application code must not depend on a writable local filesystem or a long-running server process.
- Treat D1 migrations as production changes and review them before applying remotely.
- Keep `EMAIL_FROM` and credentials in Cloudflare/GitHub managed configuration.
- The `/api/system/backup` endpoint reports D1 recovery posture; actual recovery operations belong to Cloudflare tooling.

## Deployment status

The repository has a Cloudflare-compatible application path and fail-closed deployment workflow. Real Cloudflare account resources, remote migration, live deployment, data cutover when applicable, and post-deployment validation are still separate production operations and must succeed before production is considered live.
