# ELCenter

A bilingual, multi-branch education operations platform. Next.js and Tailwind on the frontend, Hono Pages Functions and a relational Cloudflare D1 database on the server.

## Working release: Foundation and academic operations

- Organization creation and real email/password authentication, salted PBKDF2 hashes, hashed sessions, HttpOnly cookies and CSRF checks.
- 18 seeded roles, configurable custom roles and granular server-checked permissions. Branch-scoped memberships and organization isolation.
- Persisted branch creation, editing, activation/deactivation, searching, sorting and pagination.
- Team account creation and suspension with immediate session revocation.
- Organization settings, live dashboard counts and before/after audit history.
- English and Egyptian Arabic, RTL, dark mode, self-hosted IBM Plex Sans Arabic and local real photographs.
- Private fictional demo workspaces. No shared privileged demo password.

- Student/guardian relationships, teacher and course branch assignments, classrooms, groups and capacity-safe enrollments/waiting lists.
- Approval-based student branch transfers preserve academic history; group transfers are atomic.
- Searchable, sortable, paginated records, validated Excel imports (up to 160 rows per atomic import), spreadsheet-safe CSV exports and course duplication.
- Admin Demo mode switch adds explicitly flagged fictional records. Disabling deletes only flagged records in one transaction. Real references block cleanup instead of changing or deleting real data.

- Timezone-aware month/week/day calendars, drag/reschedule with database conflict guards, weekly recurrence, teacher availability and holidays.
- Persisted attendance, roster eligibility, manual/student-ID entry, QR cards and camera scanning where the browser supports BarcodeDetector. Physical camera operation still needs a device check.
- Exam authoring, locked publication, six question types, bounded grades, server automatic grading, rankings and student performance from stored results.

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

### Operational limits

Up to 500 attendance records save atomically in a single D1 batch. Cloudflare counts a batch as one invocation query, while each SQL statement keeps its own parameter limits. Guardian absence notices currently remain in-app, with no external delivery claim. Weekly recurrence is capped at ten sessions per atomic request. Demo academic and learning datasets are seeded in separate idempotent requests; cleanup remains atomic and refuses real-data references.

Calendar interaction uses FullCalendar's MIT-licensed packaged styles. All application-specific layout and styling uses Tailwind utilities, without authored CSS rules.
