# BoardOps — Cloudflare Edition

Production migration target for the existing `sahid-code404/Board-Ops` application.

The goal of this repository is feature parity with the existing Board-Ops project while replacing traditional persistent-server assumptions with Cloudflare-native infrastructure:

- Next.js 16 / React 19 UI and application behavior preserved
- Cloudflare Workers runtime via vinext when compatibility passes
- Cloudflare D1 for relational data
- Cloudflare R2 for user-uploaded files
- Durable Objects for coordinated realtime/WebSocket state where required
- Cloudflare Queues / Workflows / Cron Triggers for background and scheduled work
- Cloudflare Email Service for OTP and transactional email
- Workers-native rate limiting and observability

## Migration rule

The existing `Board-Ops` repository is the behavioral reference. Do not remove or redesign working product functionality merely to make the runtime migration easier. Runtime-specific code must be replaced behind stable application interfaces and validated with regression tests.

## Security rule

No source `.env`, SQLite database, database backup, generated upload, or runtime log is imported into this repository. Production credentials belong in Cloudflare/GitHub secret stores only.

## Status

Cloudflare migration bootstrap in progress.
