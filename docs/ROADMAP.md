# Delivery plan and honest release scope

Each phase is a real pull request with tested server persistence and usable screens. A phase is not complete merely because its navigation label exists.

| Phase | Scope                                                                           | State         |
| ----- | ------------------------------------------------------------------------------- | ------------- |
| 1     | Foundation, authentication, organization, branches, users, RBAC, dashboard      | Merged, PR #1 |
| 2     | Students, guardians, teachers, courses, groups, classrooms, safe demo toggle    | Merged, PR #2 |
| 3     | Timetables, sessions, attendance, exams, performance                            | Merged, PR #3 |
| 4     | Invoices, payments, expenses, accounting, payroll                               | Merged, PR #4 |
| 5     | HR, CRM, notifications, marketing, reception                                    | Merged, PR #5 |
| 6     | Student, guardian and teacher portals, LMS                                      | In review     |
| 7     | Inventory, library, support, documents, reports                                 | Planned       |
| 8     | Security hardening, automations, integrations, performance, testing, deployment | Planned       |

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
