# Delivery plan and honest release scope

Each phase is a real pull request with tested server persistence and usable screens. A phase is not complete merely because its navigation label exists.

| Phase | Scope                                                                           | State         |
| ----- | ------------------------------------------------------------------------------- | ------------- |
| 1     | Foundation, authentication, organization, branches, users, RBAC, dashboard      | Merged, PR #1 |
| 2     | Students, guardians, teachers, courses, groups, classrooms, safe demo toggle    | Merged, PR #2 |
| 3     | Timetables, sessions, attendance, exams, performance                            | Merged, PR #3 |
| 4     | Invoices, payments, expenses, accounting, payroll                               | In review     |
| 5     | HR, CRM, notifications, marketing, reception                                    | Planned       |
| 6     | Student, guardian and teacher portals, LMS                                      | Planned       |
| 7     | Inventory, library, support, documents, reports                                 | Planned       |
| 8     | Security hardening, automations, integrations, performance, testing, deployment | Planned       |

The original request includes extensive details within each phase. The implementation should preserve that scope rather than treating this table as permission to omit it. External payment processing, outbound notifications, Google authentication, object storage and scheduled infrastructure require separately configured provider capabilities. Free operation and no purchases remain binding constraints. Provider-dependent features must never claim success without a provider delivery result.

## Remaining depth within earlier phases

The core workflows above are not a claim that every detailed requirement is already delivered. Before final commercial-readiness sign-off, finish course packages/prerequisite rules, detailed teacher contract/availability management, attendance correction approvals and teacher attendance, enhanced academic reporting, document/photo attachments, keyboard-focus audits and print-specific layouts. Parent/student/teacher self-service access is owned by phase 6. External guardian delivery needs configured channels and must not be described as sent merely because an in-app alert was saved.

## Finance delivery notes

Phase 4 adds persisted invoice issue, partial receipt/refund, draft installment plans, approved expenses, supplier payables and partial settlements, balanced immutable double-entry journals with reversals, branch scopes, closed-period guards, cutoff-aware balance sheets, income/trial balance and cash/bank movement reports, cleared-line reconciliation, and six teacher compensation formulas with immutable calculation snapshots and separate preparer/approver/payer. Print views provide invoices/receipts and teacher payslips. These are operational records, not a payment gateway or a claim of statutory accounting compliance.

Remaining detailed finance scope before final sign-off: employee-linked compensation and attendance/leave/overtime deductions (requires phase 5 HR), advances/loan recovery, configurable revenue classifications/promotions and recurring subscriptions, accrual payroll approval entries and zero-payroll closure, richer cost-center dimensions beyond branches, independent accountant review, full ledger cursor pagination and statement export. Cash-flow output is a cash/bank movement breakdown by source, not a statutory operating/investing/financing cash-flow statement. Reconciliation matches selected statement-cleared ledger lines once; it does not connect to a bank or import bank statements. Invoice and receipt print views are not electronic tax invoices.
