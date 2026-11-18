# Security and recovery operations

This is a development release. Completing a phase does not certify the entire requested ERP or authorize production use with real student and financial information.

## Deployment order

Only the designated deployment operator applies remote migrations or deploys. First reconcile the shared D1 database's `el_migrations` history and take a restorable backup. Never use unfiltered schema/data operations against another application's tables. Apply 0001 through 0011, the separate 0012 read-efficiency PR when approved/merged, then 0013_security_automation.sql and 0014_mfa.sql in filename order. Back up before changes, record the exact commit and migration list, and verify the deployed API/UI version together. No script in this release applies production migrations automatically.

Keep `DOCUMENT_ENCRYPTION_KEY` outside source control, logs and messages. It protects document versions and domain-separated authenticator secrets. Missing configuration fails closed. A lost key makes encrypted documents and authenticator seeds unreadable. Preserve the key securely with the backup recovery material; do not rotate it without a tested re-encryption plan. Recovery codes are hashed, not encrypted.

## Account security

Account security shows the current account's active sessions and successful login history. User-agent strings are untrusted browser labels, not verified devices. IPs can identify a proxy rather than the physical device. Revocation invalidates the selected session. Password changes require the old password, are rate limited, and revoke other sessions. No email password-reset or email ownership verification is implemented. Do not promise recovery by email.

Optional authenticator enrollment requires the current password and a current six-digit TOTP. The enrollment secret expires after ten minutes. Confirming enrollment binds the original pending secret, checks a current timestep and returns eight recovery codes once. Save those codes securely, outside the application. A recovery code can log in only once. Never put a password, seed, QR image or recovery code into support messages or screenshots. Enabling/disabling the authenticator revokes other sessions. TOTP accepts the adjacent 30-second step for clock drift, but a consumed timestep cannot be replayed. Keep clocks synchronized.

There is no unauthenticated administrator bypass. If a user loses every session, password and recovery method, pause access and follow a separately approved identity-verified recovery procedure. Never infer ownership from an email address or support ticket alone.

## In-app automation and digests

Organization automation defaults OFF. Headquarters managers can opt in and manually run the same in-app reminder workflow, subject to a five-minute cooldown. It creates document-expiry alerts for uploaders, due-invoice and library reminders for linked families, and private scheduled report snapshots. Separately enabled staff rules add assigned lead follow-ups, contract expiration and low-stock notices. All three new staff rules default OFF, including for already opted-in organizations. Headquarters can enable each rule and set a 1–90-day contract notice window. Manual runs respect the same rules. Notification preferences apply. Event keys deduplicate each recipient/entity/kind/period. No email, SMS, WhatsApp, push subscription or payment request is sent.

Each run processes at most 100 eligible recipient/source pairs per source and five report schedules. Staff selection excludes demo records and portal roles, rechecks active memberships, resource:view permission and branch scope, and rechecks both source eligibility and recipient access inside the notification-write transaction. Lead alerts go only to the assigned user once per due date. Contract alerts go to authorized HR users once per end date, from today through the configured notice window, excluding former employees. Low-stock alerts go to authorized inventory users once per calendar month per branch/item, only where an explicit stock balance exists and is at or below the reorder level (including zero). They are not repeated on every quantity change and are not a purchasing workflow. Existing alerts already delivered are historical inbox records; permission changes prevent new delivery, not retroactive deletion. Sources exclude completed event keys before the limit. Report snapshots use the schedule owner's current permissions and branch; subsequent reads remove finance fields if permission has changed. Saved digests contain capacity, session/completion ranges and permitted collections, not the entire reporting engine or an emailed spreadsheet. Daily/weekly/monthly reporting uses the organization's timezone.

`wrangler.automation.toml` describes an OPTIONAL, separately deployed Worker. It is not enabled by deploying Pages. The cron runs at minute 17 of each hour and processes one opted-in organization in ID order, then wraps after the last. With N enabled organizations an organization can wait roughly N+1 hours, including the wrap cycle. This is not a guaranteed hourly job per organization. The worker shares the database's quota. Monitor actual usage and failures; no free-tier capacity is reserved. Do not deploy it before migrations and operator approval.

Global search is permission/branch-scoped prefix search, limited to eight matches per entity type. It does not search encrypted file bytes or provide fuzzy/full-text matching. Ctrl/Cmd+K opens the search dialog.

## Local backup/restore rehearsal

The local-only script does not connect to Cloudflare or perform production backup automation:

```sh
npx tsx scripts/backup.ts export SOURCE.sqlite NEW-BACKUP.json
npx tsx scripts/backup.ts restore NEW-BACKUP.json NEW-RESTORED.sqlite
```

Exports include only `el_` tables, excluding migration bookkeeping, sessions and login rate-limit records. JSON contains sensitive personal records and password hashes; encryption is not added by the script. Protect the files with encrypted storage and controlled retention. Output files have owner-only permissions and never overwrite an existing destination. Keep the companion SHA-256 checksum. The checksum detects corruption, not a malicious replacement of both files.

Restore targets a new local SQLite file, applies the repository's current migrations, loads data transactionally with deferred foreign keys, temporarily disables and reinstates triggers so inventory is not applied twice, and checks integrity/foreign keys. Keep the application version and migration set with every backup. Rehearse recovery on an isolated copy and verify counts, ownership, document decryption, stock balances, ledger totals and login behavior before any separately authorized production restore. This script is not a production D1 import tool.

Production backup scheduling, encryption-at-rest of backup artifacts, retention, monitored restore drills and disaster-recovery objectives remain an operator task, not a completed automated service.

## Release gates still open

- Production quota reset, namespace reconciliation, backup and controlled migration/deployment.
- Live authentication, MFA, document and cross-branch smoke checks after deployment.
- Email reset/verification, Google sign-in and separately approved external providers.
- Full load/security review and remaining detailed ERP requirements in ROADMAP.md.
- Device camera verification and assistive-technology testing beyond automated browser checks.
