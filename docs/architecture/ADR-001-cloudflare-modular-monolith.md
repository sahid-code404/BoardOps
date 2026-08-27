# ADR-001 — Final BoardOps Cloudflare architecture

Status: Accepted
Date: 2026-08-27

## Context

BoardOps is an authenticated operational management application with users, roles, meals, kitchen operations, billing, payments, refunds, expenses, notifications, settings, formulas, reports, uploads, audit trails, authentication, 2FA and administration.

The current `phase/cf-01-runtime-foundation` branch proved that the existing Next.js application can run on Cloudflare through vinext, Prisma's D1 adapter, R2, Workers Rate Limiting and Email Workers. That branch remains the frozen behavioral reference while this architecture is migrated.

The final architecture should minimize framework-specific runtime layers, stay close to Cloudflare's supported runtime, keep one deployable application, remain easy to run locally, and preserve all existing product behavior.

## Decision

BoardOps will be a Cloudflare-native modular monolith.

### Frontend

- React 19
- Vite
- React Router
- TanStack Query
- Zustand
- React Hook Form + Zod
- Tailwind CSS + the existing Radix/shadcn component system

The frontend is a SPA served as Worker static assets. BoardOps is primarily an authenticated application, so server-side rendering is not required for the product to function correctly.

### Backend

- Hono
- Cloudflare Workers
- Web-standard Request/Response APIs
- Versioned HTTP API under `/api/v1`
- Zod contracts shared with the frontend

No application code may depend on a long-running Node.js server, local writable filesystem, child processes, process-local correctness state or a TCP database connection.

### Data

- Cloudflare D1 remains the relational database.
- Drizzle ORM is the final typed SQL layer.
- Existing checked-in SQL migrations remain the authoritative database history during the migration.
- D1 migrations must be validated against a local Wrangler D1 database in CI.

The Prisma implementation is removed only after every repository has a Drizzle equivalent and parity tests prove the same behavior. The ORM swap is intentionally isolated behind repository interfaces rather than mixed into UI/API rewrites.

### Cloudflare services

- D1: relational data
- R2: uploads and user files
- Workers Rate Limiting: authentication throttling
- Email Workers: transactional/OTP email
- Workers Observability: structured logs
- D1 Time Travel/export: recovery
- Cron/Workflows only when a real scheduled/background requirement exists
- Durable Objects only when a real coordinated realtime requirement exists

We do not add KV, Queues, Durable Objects, Hyperdrive, PostgreSQL or separate microservices merely for architectural fashion.

## Code boundaries

The target source tree is organized by responsibility:

```text
src/modern/
  client/          React application and route composition
  server/          Hono application, middleware and HTTP route adapters
  domain/          business rules with no framework/runtime imports
  application/     use-cases/services orchestrating domain + repositories
  infrastructure/  D1/Drizzle, R2, email and Cloudflare implementations
  shared/          API contracts, result/error types and common validation
```

Dependencies point inward:

```text
client -> shared contracts
server -> application + shared
application -> domain + repository ports
domain -> no infrastructure/framework
infrastructure -> repository ports + Cloudflare bindings
```

Business rules must not live in React components, Hono route handlers or ORM query expressions when they can be expressed as independently testable domain/application code.

## Migration invariants

The migration is incremental, not a big-bang rewrite.

1. `phase/cf-01-runtime-foundation` remains the behavior reference.
2. New architecture is built on `phase/cf-02-modular-monolith`.
3. Old and new implementations may coexist temporarily.
4. A feature is considered migrated only when API behavior, authorization, validation and key UI behavior have parity tests.
5. The Next/vinext runtime is removed only after all production routes are served by the Vite/Hono application.
6. Prisma is removed only after all production data access is implemented through Drizzle/repository adapters and migrations remain valid.
7. Existing D1 production data must not require destructive conversion merely because the ORM changes.

## API rules

- New API routes are versioned under `/api/v1`.
- Responses use a stable JSON envelope.
- Validation occurs at the HTTP boundary.
- Authentication and authorization are middleware/application concerns, not UI-only checks.
- Request IDs are returned and included in structured error logs.
- Error responses never expose stack traces or secrets.
- Mutating financial/administrative operations retain audit logging.

## Security rules

- HttpOnly, Secure, SameSite cookies for production sessions.
- CSRF protection for cookie-authenticated mutations where browser same-origin guarantees are insufficient.
- Cloudflare client IP header is canonical in production.
- Constant-time/password library primitives for credential verification.
- Rate limiting for authentication and sensitive abuse-prone routes.
- No secrets in repository source or client bundles.
- R2 object keys are generated server-side and validated before reads/writes.
- Role checks are enforced server-side for every privileged operation.

## Why not PostgreSQL + Hyperdrive now?

BoardOps currently maps well to SQLite/D1 semantics, and the source system already used SQLite. Adding PostgreSQL would add another vendor/service, credentials, network connectivity, pooling and operational work without solving a demonstrated product limitation. Repository interfaces keep that future option open if D1 eventually becomes an actual constraint.

## Why not microservices?

BoardOps has strongly related transactional domains and one product/team boundary. A modular monolith gives clear ownership and testability without distributed transactions, multiple deployments, duplicated authentication or service-to-service failure modes. Modules may be extracted later if measured scaling or organizational requirements justify it.

## Removal criteria for legacy stack

Next.js, vinext and Prisma may be deleted when all of the following are green on the new stack:

- feature-parity checklist complete;
- authentication and role tests;
- meal/kitchen tests;
- billing/payment/refund tests;
- settings/formula/report tests;
- upload/R2 tests;
- email/2FA tests;
- local D1 migration smoke test;
- TypeScript zero errors;
- ESLint zero warnings;
- modern Worker build and preview smoke test;
- production deployment rehearsal against non-production Cloudflare resources.
