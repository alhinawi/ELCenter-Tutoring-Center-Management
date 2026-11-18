# Delivery plan and honest release scope

Each phase is a real pull request with tested server persistence and usable screens. A phase is not complete merely because its navigation label exists.

| Phase | Scope                                                                           | State         |
| ----- | ------------------------------------------------------------------------------- | ------------- |
| 1     | Foundation, authentication, organization, branches, users, RBAC, dashboard      | Merged, PR #1 |
| 2     | Students, guardians, teachers, courses, groups, classrooms, safe demo toggle    | Merged, PR #2 |
| 3     | Timetables, sessions, attendance, exams, performance                            | Merged, PR #3 |
| 4     | Invoices, payments, expenses, accounting, payroll                               | Merged, PR #4 |
| 5     | HR, CRM, notifications, marketing, reception                                    | Merged, PR #5 |
| 6     | Student, guardian and teacher portals, LMS                                      | Merged, PR #6 |
| 7     | Inventory, library, support, documents, reports                                 | Merged, PR #7 |
| 8     | Security hardening, automations, integrations, performance, testing, deployment | Core merged, detail open |

The original request includes extensive details within each phase. The implementation should preserve that scope rather than treating this table as permission to omit it. External payment processing, outbound notifications, Google authentication, object storage and scheduled infrastructure require separately configured provider capabilities. Free operation and no purchases remain binding constraints. Provider-dependent features must never claim success without a provider delivery result.

## Remaining depth within earlier phases

The core workflows above are not a claim that every detailed requirement is already delivered. Later increments implement course prerequisite enforcement, atomic package enrollment/draft billing and independently approved backoffice attendance corrections. Before final commercial-readiness sign-off, finish remaining teacher contract depth, dedicated teacher/family correction screens, enhanced academic reporting, profile-photo upload, keyboard-focus audits and print-specific layouts. Identity-bound self-service portals and scoped document uploads are already implemented. External guardian delivery needs configured channels and must not be described as sent merely because an in-app alert was saved.

## Finance delivery notes

Phase 4 adds persisted invoice issue, partial receipt/refund, draft installment plans, approved expenses, supplier payables and partial settlements, balanced immutable double-entry journals with reversals, branch scopes, closed-period guards, cutoff-aware balance sheets, income/trial balance and cash/bank movement reports, cleared-line reconciliation, and six teacher compensation formulas with immutable calculation snapshots and separate preparer/approver/payer. Print views provide invoices/receipts and teacher payslips. These are operational records, not a payment gateway or a claim of statutory accounting compliance.

Remaining detailed finance scope before final sign-off: advances/loan recovery, configurable revenue classifications and recurring subscriptions, zero-payroll closure, richer cost-center dimensions beyond branches, independent accountant review, full ledger cursor pagination and statement export. Cash-flow output is a cash/bank movement breakdown by source, not a statutory operating/investing/financing cash-flow statement. Reconciliation matches selected statement-cleared ledger lines once; it does not connect to a bank or import bank statements. Invoice and receipt print views are not electronic tax invoices.

## People and admissions delivery notes

Phase 5 adds branch-scoped employee profiles, departments, contracts with explicit ISO workdays and overtime rates, staff attendance, shift overlap/leave guards, independent leave decisions, reviews/history, recruitment stages and one-time offer-to-hire. Employee payroll uses a full-month contract, complete recorded attendance, approved leave, explicit workdays, overtime, bonus/deduction reasons and an immutable calculation snapshot. Approval accrues wages to payroll payable, then a separate payer records settlement. Partial-month or ambiguous contracts are held for review, not guessed.

Admissions includes campaign attribution, assigned advisers, lead follow-ups and interaction logs, one-time student conversion, acquisition counts, branch coupons with issue-time limits, visits/appointments and ordered check-in/out. Personal inboxes, notification preferences, stored templates and branch announcements have stored/read/blocked logs. External email, SMS and WhatsApp remain blocked until a provider is configured; no messages are claimed sent.

Remaining detailed scope includes advances/loans, configurable paid-leave entitlements, referral-reward accounting, seasonal package validity, richer automated reception queues, external delivery providers and the remaining configurable automation rules. Scoped contract documents, operational package enrollment and a bounded subset of in-app reminders are implemented by later increments. Earlier phase details remain binding until the final verification pass.

## Portals and LMS delivery notes

Phase 6 introduces explicit, administrator-managed links between a login and one student, guardian or teacher profile. Self-linking and email-based identity inference are not allowed. These system roles cannot use generic backoffice APIs. Each portal and class operation checks the linked identity, organization, branch and enrollment/teacher assignment on the server. Unlinking revokes existing sessions.

Students and guardians can view permitted profiles, schedules, attendance, finalized results, issued invoices and recorded receipts/refunds. Guardians can switch between explicitly related children. Family absence, meeting and contact requests are stored for an independent administrator response, which enters the requester's own inbox. Invoice print/PDF uses the saved financial record, not a payment claim.

Teachers have assigned-class rosters with class-only performance aggregates, personal schedules and attendance recording, exam/question authoring, final grade review, lesson and assignment management, moderated class discussions and linked-family announcements. Leave requests require HR to bind the same active employee, teacher and login; the normal independent HR decision workflow applies. Salary statements show only approved/paid teacher payroll snapshots, not another teacher's figures or draft payroll.

The LMS stores published article/video/live/material links, one-time homework submissions, bounded grades/feedback, completed lessons and class discussions. Learners never receive question answer keys. Quizzes submit once, automatically grade supported question types and hold essays for teacher review. Submitted coursework is protected by database locks; published exams keep the earlier grading-rule locks. Demo lessons/materials are explicitly flagged. No shared privileged demo login is added.

Scoped encrypted PDF/file upload and support tickets are implemented in phase 7. Payment gateway, conference-provider creation and external delivery remain provider-dependent open work. External HTTPS links are labeled resources, not hosted video or access-controlled third-party content. Protected application metadata does not make a third-party URL private. Completion is based on published lesson checks, not proof of video watch time or an accredited certificate. Quiz attempts currently have a start time and manual close, not timed/proctored exam sessions. Broader keyboard/focus, recovery and load testing remain part of the final security pass.

## Resource and service delivery notes

Phase 7 persists inventory catalogs/suppliers, nonnegative immutable movements, independently received purchase orders, independent branch stock and asset transfers, invoice-bound physical dispatch/one-time stock returns, assigned assets/maintenance, book/copy catalogs, first-in reservations, unique active loans and saved late penalties. Support has scoped requesters, internal notes, independent staff assignment, resolution times, immutable satisfaction and encrypted attachments. Documents use authenticated permission checks, AES-GCM encrypted bytes, immutable versions, search, expiry filters/in-view warnings and download audit. Teachers can share class attachments; families can read shared documents and borrowing history. Reports have branch/course/teacher/date filters, operational data, Excel/CSV and landscape PDF/print.

Free document storage is deliberately small: 128 KiB per PDF/PNG/JPEG version, 20 retained versions per document, 1000 document records per organization. Signature checks are not malware scanning. Downloaded files remain untrusted. A dedicated, stable DOCUMENT_ENCRYPTION_KEY must be stored securely by the deployment operator and included in protected recovery procedures. Missing/wrong keys fail closed. D1 storage and daily reads remain shared with other applications. This is not unlimited object storage.

Later phase-8 work adds bounded in-app expiry reminders and private scheduled capacity/session/collection digests. These are not a full scheduled reporting/export service, and the optional Worker still needs separate deployment. Remaining detailed scope is still binding. Inventory valuation is standard catalog cost, not FIFO or a perpetual inventory ledger. Purchase receipt changes stock but does not automatically create/settle a supplier payable; finance retains its separate approval and settlement workflow. Physical dispatch does not charge a payment gateway; returns never silently refund an invoice. Library penalties are records, not collected money. Cross-center analytics explicitly label current counts versus historical cohort retention, room booked minutes versus utilization capacity, and lesson progress versus certified completion. Final release must finish or clearly hold those unmet detailed requirements rather than claim commercial completeness.

## Phase 8 progress and remaining gates

Implemented locally: password change and session revocation, successful-login history, optional authenticator MFA with replay protection and one-time recovery codes, permission-scoped prefix search, deduplicated in-app expiry/payment/library reminders, private report digests, opt-in bounded scheduler, and isolated local backup/restore rehearsal. The focused additive D1 index migration is tracked separately in PR #8. See SECURITY-OPERATIONS.md for limits and deployment sequencing.

Not finished: email recovery/verification, Google sign-in, external providers, production backup scheduling/retention and restore drill, live D1/application validation, load/security review, and settings depth such as custom fields, tax configuration and editable print templates. Earlier phase detail remains binding; phase labels do not remove these requirements. No external delivery, money movement or production migration has occurred as part of this local work.

## Record customization increment

Typed custom field definitions and values are attached to students, guardians, teachers, courses, groups and classrooms. Headquarters managers create/archive/restore definitions; record view/edit and branch permissions govern values. Types/options/keys are immutable, archived values remain read-only, and writes enter the audit log. Up to 200 definitions including archived fields. A required custom field is enforced when saving that supplemental form, not during the core registration workflow. Employee custom fields, tax configuration and editable invoice/receipt templates remain open.

## Organization profile increment

A headquarters-edited profile stores display name, tagline, contact email/phone, address and an HTTPS website with audit history. The display name reaches the authenticated workspace header without replacing the registered organization name. Correspondence language and financial-year start month are reference settings only. Browser locale still controls the UI default, and financial periods are not silently reopened/reclassified. Logo upload, branding themes, tax rules and editable print layouts remain open.

## Attendance correction increment

Initial backoffice attendance remains an atomic bulk entry. Once recorded, status/time/notes changes need a persisted correction and another user with attendance:approve permission. The request snapshots the attendance revision; database guards reject direct changes, self-review, repeat decisions and approval after a conflicting revision or session cancellation. Approval changes attendance, revision and absence-alert state atomically, with audit history. The current request form edits status/notes and preserves arrival/departure; the validated API supports time corrections. Review queues show the latest 100 requests in current branch scope. Dedicated teacher/family correction-request screens and configurable approval routing remain open. Approval does not send external messages or alter payroll snapshots.

## Course prerequisite increment

Course details configure up to 20 active direct prerequisites. Cycles, self-references and duplicate links are rejected; database guards enforce completed enrollment in every prerequisite before new active/waiting enrollment or reactivation/transfer. Existing enrollments are not retroactively removed when requirements change. Completion means a staff-recorded completed enrollment, not a passed exam or certificate. Archived prerequisite links remain visible until explicitly removed. Branch users cannot inspect prerequisite course details outside their scope. Course duplication does not copy prerequisite rules. The following package increment adds fixed-price bundle enrollment and draft billing; recurring subscriptions and seasonal validity remain open.

## Course package increment

Fixed-price, currency-snapshotted packages contain 2–10 active courses assigned to one branch. Enrollment selects one active group per course and creates all enrollments plus one draft invoice in one transaction. Group capacity, prerequisites and branch/student eligibility apply; a failure rolls back everything. Package terms and order snapshots are immutable; archive/restore controls new use. Up to 100 package definitions per organization. Invoice issue, receipts/refunds and enrollment withdrawal remain explicit independent workflows. Voiding a draft invoice does not silently withdraw enrolled students, and a student cannot buy the same package definition twice. This is an operational bundle, not a recurring subscription or payment gateway. Tax rules, seasonal validity and referral rewards remain open.

## Current release boundary

The original request remains larger than the merged core. No production or commercial-readiness sign-off is implied. Remaining work includes account recovery/verification and Google sign-in, approved external providers, production backup scheduling and restore drills, live deployment/load/security checks, tax and editable print-template settings, advances/loans, deeper historical cohort analytics, configurable rule coverage and the detailed workflow limits recorded above. The development branch and real CI tests are not proof of the production database state.

## Staff reminder rules increment

Three individually opt-in rules add lead follow-ups to the assigned permitted user, upcoming contract expiration to scoped HR users, and monthly low-stock notices to scoped inventory users. Headquarters configures the contract window from 1–90 days. Current permissions, status, preferences and branch scope are rechecked when storing the notification. The 100-recipient cap excludes prior event keys before limiting. This is in-app delivery only, not external messaging, an automatic purchasing system or the remaining low-attendance/upcoming-exam/retention/recurring-invoice automation scope. Stock checks require an existing balance, and contract alerts do not repeat for an unchanged end date. The separate Worker deployment remains an operator gate.
