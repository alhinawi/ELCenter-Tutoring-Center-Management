# ELCenter

A bilingual, multi-branch education operations platform. Next.js and Tailwind on the frontend, Hono Pages Functions and a relational Cloudflare D1 database on the server.

## Working release: Connected operations, portals and learning

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

- Issued invoices with locked line items and installment plans; partial receipts, refunds, printable invoice/receipt history and explicit teacher revenue allocations.
- Independent expense approval, supplier payables and partial settlements, immutable balanced double-entry ledger with auditable manual reversals and period closure.
- Cutoff-aware balance sheets and receivables, period income/trial balance, cash/bank movement and once-only cleared-line statement reconciliation.
- Six teacher compensation formulas, persisted calculation snapshots, bonuses/deductions, independent approval and third-person payment recording, printable payslips. No real funds move.

- Branch-scoped employees, departments, contracts, workdays, attendance, shifts, independent leave approvals, recruitment and one-time hiring.
- Employee payroll from complete attendance/approved leave and explicit contract workdays, overtime and approved adjustments. Separate approval accrues wages and a third user records settlement.
- Lead adviser assignment, campaign attribution, follow-ups/interactions, atomic student conversion, coupon-limited invoice discounts and visitor check-in/out.
- Private in-app inboxes, templates, preferences and announcement delivery logs. Unconfigured external channels record blocked delivery, never a false send.

- Dedicated identity-bound student, multi-child guardian and teacher portals, with server-side ownership and branch checks. Generic backoffice APIs are denied for these system roles.
- Family profiles, schedules, attendance, finalized results, issued invoices, recorded payments, printable invoice history and tracked requests to administration.
- Teacher class rosters/performance, own schedule/attendance, exam/question authoring and grading, approved salary snapshots and HR-linked leave requests.
- Published LMS lessons and labeled external resources, persisted completion, immutable one-time homework, grading/feedback, class discussions/moderation, scoped announcements and one-time online quizzes. Answer keys remain server-only for learners; essays await teacher review.

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

### Resource storage and migration sequence

After phase 6 migration 0008, phase 7 applies 0009_resources_service.sql, 0010_inventory.sql and 0011_library.sql in order using the existing el_migrations history. Only el_ objects are affected. Configure DOCUMENT_ENCRYPTION_KEY as a protected production secret before allowing document uploads. Keep it stable and back it up outside the repository. Losing or rotating it without re-encryption makes prior uploads unreadable. Do not put its value in source, logs or chat.

The document store accepts 1–128 KiB PDF/PNG/JPEG versions, at most 20 per document and 1000 documents per organization. All versions are retained, encrypted and downloaded as attachments with no-store headers. File signatures do not prove malware safety. Free database capacity and daily operations are shared limits, so these are application caps, not reserved storage. Resource demo records carry explicit flags; real references block atomic cleanup.
