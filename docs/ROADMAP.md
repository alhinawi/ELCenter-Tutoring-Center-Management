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
| 8     | Security hardening, automations, integrations, performance, testing, deployment | In progress   |

The original request includes extensive details within each phase. The implementation should preserve that scope rather than treating this table as permission to omit it. External payment processing, outbound notifications, Google authentication, object storage and scheduled infrastructure require separately configured provider capabilities. Free operation and no purchases remain binding constraints. Provider-dependent features must never claim success without a provider delivery result.

## Remaining depth within earlier phases

The core workflows above are not a claim that every detailed requirement is already delivered. Before final commercial-readiness sign-off, finish course packages/prerequisite rules, detailed teacher contract/availability management, attendance correction approvals and teacher attendance, enhanced academic reporting, document/photo attachments, keyboard-focus audits and print-specific layouts. Parent/student/teacher self-service access is owned by phase 6. External guardian delivery needs configured channels and must not be described as sent merely because an in-app alert was saved.

## Finance delivery notes

Phase 4 adds persisted invoice issue, partial receipt/refund, draft installment plans, approved expenses, supplier payables and partial settlements, balanced immutable double-entry journals with reversals, branch scopes, closed-period guards, cutoff-aware balance sheets, income/trial balance and cash/bank movement reports, cleared-line reconciliation, and six teacher compensation formulas with immutable calculation snapshots and separate preparer/approver/payer. Print views provide invoices/receipts and teacher payslips. These are operational records, not a payment gateway or a claim of statutory accounting compliance.

Remaining detailed finance scope before final sign-off: employee-linked compensation and attendance/leave/overtime deductions (requires phase 5 HR), advances/loan recovery, configurable revenue classifications/promotions and recurring subscriptions, accrual payroll approval entries and zero-payroll closure, richer cost-center dimensions beyond branches, independent accountant review, full ledger cursor pagination and statement export. Cash-flow output is a cash/bank movement breakdown by source, not a statutory operating/investing/financing cash-flow statement. Reconciliation matches selected statement-cleared ledger lines once; it does not connect to a bank or import bank statements. Invoice and receipt print views are not electronic tax invoices.

## People and admissions delivery notes

Phase 5 adds branch-scoped employee profiles, departments, contracts with explicit ISO workdays and overtime rates, staff attendance, shift overlap/leave guards, independent leave decisions, reviews/history, recruitment stages and one-time offer-to-hire. Employee payroll uses a full-month contract, complete recorded attendance, approved leave, explicit workdays, overtime, bonus/deduction reasons and an immutable calculation snapshot. Approval accrues wages to payroll payable, then a separate payer records settlement. Partial-month or ambiguous contracts are held for review, not guessed.

Admissions includes campaign attribution, assigned advisers, lead follow-ups and interaction logs, one-time student conversion, acquisition counts, branch coupons with issue-time limits, visits/appointments and ordered check-in/out. Personal inboxes, notification preferences, stored templates and branch announcements have stored/read/blocked logs. External email, SMS and WhatsApp remain blocked until a provider is configured; no messages are claimed sent.

Remaining detailed scope includes advances/loans, configurable paid-leave entitlements, recruitment/contract documents (phase 7), referral-reward accounting, promotional course packages, richer automated reception queues, external delivery providers and recurring notification automation (phase 8). Earlier phase details remain binding until the final verification pass.

## Portals and LMS delivery notes

Phase 6 introduces explicit, administrator-managed links between a login and one student, guardian or teacher profile. Self-linking and email-based identity inference are not allowed. These system roles cannot use generic backoffice APIs. Each portal and class operation checks the linked identity, organization, branch and enrollment/teacher assignment on the server. Unlinking revokes existing sessions.

Students and guardians can view permitted profiles, schedules, attendance, finalized results, issued invoices and recorded receipts/refunds. Guardians can switch between explicitly related children. Family absence, meeting and contact requests are stored for an independent administrator response, which enters the requester's own inbox. Invoice print/PDF uses the saved financial record, not a payment claim.

Teachers have assigned-class rosters with class-only performance aggregates, personal schedules and attendance recording, exam/question authoring, final grade review, lesson and assignment management, moderated class discussions and linked-family announcements. Leave requests require HR to bind the same active employee, teacher and login; the normal independent HR decision workflow applies. Salary statements show only approved/paid teacher payroll snapshots, not another teacher's figures or draft payroll.

The LMS stores published article/video/live/material links, one-time homework submissions, bounded grades/feedback, completed lessons and class discussions. Learners never receive question answer keys. Quizzes submit once, automatically grade supported question types and hold essays for teacher review. Submitted coursework is protected by database locks; published exams keep the earlier grading-rule locks. Demo lessons/materials are explicitly flagged. No shared privileged demo login is added.

Remaining detailed scope: secure PDF/file upload and support tickets are phase 7; payment gateway, conference-provider creation and external delivery remain phase 8/provider configuration. External HTTPS links are labeled resources, not hosted video or access-controlled third-party content. Protected application metadata does not make a third-party URL private. Completion is based on published lesson checks, not proof of video watch time or an accredited certificate. Quiz attempts currently have a start time and manual close, not timed/proctored exam sessions. Broader keyboard/focus, recovery and load testing remain part of the final security pass.

## Resource and service delivery notes

Phase 7 persists inventory catalogs/suppliers, nonnegative immutable movements, independently received purchase orders, independent branch stock and asset transfers, invoice-bound physical dispatch/one-time stock returns, assigned assets/maintenance, book/copy catalogs, first-in reservations, unique active loans and saved late penalties. Support has scoped requesters, internal notes, independent staff assignment, resolution times, immutable satisfaction and encrypted attachments. Documents use authenticated permission checks, AES-GCM encrypted bytes, immutable versions, search, expiry filters/in-view warnings and download audit. Teachers can share class attachments; families can read shared documents and borrowing history. Reports have branch/course/teacher/date filters, operational data, Excel/CSV and landscape PDF/print.

Free document storage is deliberately small: 128 KiB per PDF/PNG/JPEG version, 20 retained versions per document, 1000 document records per organization. Signature checks are not malware scanning. Downloaded files remain untrusted. A dedicated, stable DOCUMENT_ENCRYPTION_KEY must be stored securely by the deployment operator and included in protected recovery procedures. Missing/wrong keys fail closed. D1 storage and daily reads remain shared with other applications. This is not unlimited object storage.

Remaining detailed scope is still binding: scheduled reports and expiry notifications need phase 8 automation; current in-view expiry warnings are not background delivery. Inventory valuation is standard catalog cost, not FIFO or a perpetual inventory ledger. Purchase receipt changes stock but does not automatically create/settle a supplier payable; finance retains its separate approval and settlement workflow. Physical dispatch does not charge a payment gateway; returns never silently refund an invoice. Library penalties are records, not collected money. Cross-center analytics explicitly label current counts versus historical cohort retention, room booked minutes versus utilization capacity, and lesson progress versus certified completion. Final release must finish or clearly hold those unmet detailed requirements rather than claim commercial completeness.

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

Course details configure up to 20 active direct prerequisites. Cycles, self-references and duplicate links are rejected; database guards enforce completed enrollment in every prerequisite before new active/waiting enrollment or reactivation/transfer. Existing enrollments are not retroactively removed when requirements change. Completion means a staff-recorded completed enrollment, not a passed exam or certificate. Archived prerequisite links remain visible until explicitly removed. Branch users cannot inspect prerequisite course details outside their scope. Course duplication does not copy prerequisite rules. Course packages and bundled billing remain open.
