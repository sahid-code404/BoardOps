# BoardOps — Cloudflare Edition

BoardOps migrated to a Cloudflare-native production runtime while preserving the existing product behavior and UI.

## Runtime architecture

- **Application:** Next.js 16 + React 19, built for Cloudflare Workers through vinext/Vite.
- **Relational data:** Cloudflare D1, accessed through Prisma with `@prisma/adapter-d1`.
- **Uploads:** Cloudflare R2 through the `UPLOADS` binding. Avatar files are no longer written to a local server filesystem.
- **Authentication throttling:** Cloudflare Workers Rate Limiting through the `AUTH_RATE_LIMITER` binding.
- **Transactional email:** Cloudflare Email Workers through the `EMAIL` binding. Production email fails closed when `EMAIL_FROM` is not configured.
- **Database backup:** Cloudflare-managed D1 backup/export/PITR. The application does not shell out to `sqlite3` or create local database snapshots.

The application is designed for an ephemeral Worker filesystem. Runtime code must not depend on a long-running Node process, a local SQLite file, a writable `public/` directory, shell scripts, or process-local rate-limit counters.

## Current repository gates

Every push to `phase/cf-01-runtime-foundation` runs the permanent Cloudflare validation workflow. It must pass all of the following before the branch is considered deployable:

1. locked Bun dependency installation;
2. Prisma client generation;
3. production TypeScript with zero errors;
4. ESLint with zero warnings;
5. vinext compatibility checking;
6. the full Cloudflare production bundle build.

`next.config.ts` does not suppress TypeScript build failures.

## Local development

Install dependencies and generate Prisma types:

```bash
bun install --frozen-lockfile
bun run db:generate
```

Run the vinext development server:

```bash
bun run dev
```

Run the production quality gates locally:

```bash
bun run typecheck
bun run lint:strict
bun run cf:check
bun run build
```

Preview the generated Worker bundle locally:

```bash
bun run preview
```

`bun run start` starts Wrangler against an already-generated `dist/server/wrangler.json`; run `bun run build` first.

## Cloudflare resource provisioning

The repository intentionally does **not** contain real Cloudflare resource IDs or credentials. Before the first remote deployment, provision the account resources and replace/configure the placeholders.

### 1. D1

Create the production database:

```bash
wrangler d1 create boardops
```

Cloudflare will return a database ID. Replace the all-zero `database_id` currently present in `wrangler.jsonc` with that real ID. Do not commit account secrets.

Apply the checked-in D1 migration locally when testing:

```bash
bun run db:migrate:local
```

Apply it to the real production D1 database only after the resource ID has been configured and the migration has been reviewed:

```bash
bun run db:migrate:remote
```

### 2. R2

Create the upload bucket if it does not already exist:

```bash
wrangler r2 bucket create boardops-uploads
```

The application expects the R2 binding name `UPLOADS` and bucket name `boardops-uploads`.

### 3. Authentication rate limiting

The Worker expects the binding `AUTH_RATE_LIMITER`. Its repository configuration currently limits authentication actions to five requests per 60-second period per action/IP key. Review that policy for the intended production traffic before launch.

### 4. Transactional email

Configure Cloudflare Email Routing/Email Workers for the production domain and ensure the sender address is valid for that Cloudflare account. The Worker binding name is `EMAIL`.

Set the sender address as a Worker secret or environment variable named `EMAIL_FROM`, for example:

```bash
wrangler secret put EMAIL_FROM
```

Do not enable production login flows that require OTP/password-reset email until a real sender has been configured and verified end-to-end.

## Existing-data cutover

Creating the D1 schema is **not** the same as migrating existing production data. If an existing BoardOps installation contains live data, use a controlled cutover:

1. take and verify a source backup/export;
2. rehearse the conversion/import into a non-production D1 database;
3. verify row counts, foreign-key relationships, financial totals, user/session policy, and representative records;
4. schedule a write freeze on the old deployment;
5. export the final source state;
6. import/transform it into D1;
7. run post-import integrity checks;
8. deploy the Worker and execute authentication, billing, meal, upload, refund, and admin smoke tests;
9. switch production traffic only after those checks pass;
10. keep the old deployment read-only until the rollback window closes.

Never use the demo seed as a production migration mechanism. `bun run seed:demo:local` exists only for disposable local/demo databases and creates known demo accounts/data.

## Build and deployment

Once the real Cloudflare resources and email sender are configured:

```bash
bun install --frozen-lockfile
bun run db:generate
bun run typecheck
bun run lint:strict
bun run cf:check
bun run build
bun run db:migrate:remote
bun run deploy
```

The exact ordering of the final D1 migration and Worker traffic cutover should follow the rehearsed migration plan when existing live data is involved.

## Security and operations

- Do not commit `.env` files, database exports, backups, generated uploads, API tokens, or runtime logs.
- Do not restore the old local-server/SQLite operational scripts into the Cloudflare deployment path.
- Treat D1 migrations as production changes and review them before applying remotely.
- Keep `EMAIL_FROM` and any future credentials in Cloudflare/GitHub managed configuration.
- Use the `/api/system/backup` endpoint only to inspect the application's D1 backup posture; actual backup/export/PITR operations belong to Cloudflare tooling.

## Deployment status

The repository runtime is Cloudflare-compatible and protected by strict build/type/lint compatibility gates. **Cloudflare account resources are not provisioned by this repository itself.** A real D1 database ID, R2 bucket, Email Worker sender/domain configuration, production data migration, deployment, and post-deploy smoke testing remain required before declaring a live production cutover complete.
