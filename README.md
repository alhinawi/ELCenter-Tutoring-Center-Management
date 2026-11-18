# ELCenter

A bilingual, multi-branch education operations platform. Next.js and Tailwind on the frontend, Hono Pages Functions and a relational Cloudflare D1 database on the server.

## Working release: Phase 1

- Organization creation and real email/password authentication, salted PBKDF2 hashes, hashed sessions, HttpOnly cookies and CSRF checks.
- 18 seeded roles, configurable custom roles and granular server-checked permissions. Branch-scoped memberships and organization isolation.
- Persisted branch creation, editing, activation/deactivation, searching, sorting and pagination.
- Team account creation and suspension with immediate session revocation.
- Organization settings, live dashboard counts and before/after audit history.
- English and Egyptian Arabic, RTL, dark mode, self-hosted IBM Plex Sans Arabic and local real photographs.
- Private fictional demo workspaces. No shared privileged demo password.

This is a phased implementation, **not yet a complete enterprise ERP**. See [the delivery plan](docs/ROADMAP.md) for the remaining phases. Do not enter real student or financial data until the remaining security and recovery work is complete.

## Local development

Node 22 required.

```sh
npm ci
npm run build
npx tsx scripts/preview.ts
```

The production-export preview at `http://localhost:3000` runs the actual API against a private local SQLite database. No frontend-only data store is used for business records.

For frontend hot reload, run `npm run api:dev` and `ELCENTER_DEV_API=1 npm run dev` separately.

```sh
npm run typecheck
npm test
npm run build
```

## Cloudflare deployment

Build command: `npm ci && npm run build`, output: `out/`, Pages Functions: `functions/`.

`DB` uses the existing database configured in `wrangler.toml`. All application tables use the `el_` prefix and the migration history uses `el_migrations`. It deliberately does not create, alter or delete another application's tables. Sharing a D1 database also shares its free-plan storage and operation limits. There is no promise of unlimited capacity on a free tier.

Only the designated deployment operator should apply migrations to the bound database, then deploy the generated `out/` directory and Functions together. Preserve generated `out/_headers`, which includes hashes for Next.js hydration scripts. The Pages domain must be approved before the first deployment.

No payment processor, email/SMS/WhatsApp provider, paid infrastructure, Redis or object-storage account is provisioned by this release. No external messages or money movements occur.

## Security boundaries

Authorization is enforced on every server route, not by hiding navigation. Login/register/demo endpoints have persisted rate limits. Critical writes and their audit records are atomic batches. Database foreign keys include organization identifiers where needed to prevent cross-organization references.

Recovery, email verification, Google sign-in, MFA, backup automation and production load testing are scheduled work, not represented as finished. Password reset cannot send email without an approved email provider. Use fictional data during development.

## Media

Photographs: Unsplash contributors, downloaded and served locally. IBM Plex Sans Arabic: Google Fonts, SIL Open Font License. Dependencies retain their upstream licenses.
