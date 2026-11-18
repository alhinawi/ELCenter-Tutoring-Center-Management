# Delivery plan and honest release scope

Each phase is a real pull request with tested server persistence and usable screens. A phase is not complete merely because its navigation label exists.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Foundation, authentication, organization, branches, users, RBAC, dashboard | Implemented, validation underway |
| 2 | Students, guardians, teachers, courses, groups, classrooms | Next |
| 3 | Timetables, sessions, attendance, exams, performance | Planned |
| 4 | Invoices, payments, expenses, accounting, payroll | Planned |
| 5 | HR, CRM, notifications, marketing, reception | Planned |
| 6 | Student, guardian and teacher portals, LMS | Planned |
| 7 | Inventory, library, support, documents, reports | Planned |
| 8 | Security hardening, automations, integrations, performance, testing, deployment | Planned |

The original request includes extensive details within each phase. The implementation should preserve that scope rather than treating this table as permission to omit it. External payment processing, outbound notifications, Google authentication, object storage and scheduled infrastructure require separately configured provider capabilities. Free operation and no purchases remain binding constraints. Provider-dependent features must never claim success without a provider delivery result.
