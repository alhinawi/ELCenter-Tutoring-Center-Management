# Deployment requirements: employee loan payroll deductions (migrations 0036, 0037)

Status: proposal for the owner and deployer to review. Nothing here has been run, and no production write pause is authorized by this document.

## What changes

- 0036: new el_employee_loan_deductions table, new guard triggers, and a replacement of the loan recovery guard (recoveries now also subtract reserved deductions).
- 0037: adds released_at/released_by to deductions, a new el_staff_payroll_cancellations table, replacement of the staff payroll, recovery and deduction triggers.
- Backend: payroll preparation takes loan deductions, approval posts a multi-line accrual, new POST /api/staff-payroll/:id/cancel.
- All new objects use the el_ prefix. No Sherkty table is touched. Existing rows are not rewritten.

## Compatibility rules

1. Apply 0036 then 0037 on the same release as the backend. The 0037 backend queries released_at and fails on an older schema.
2. Old backend on new schema is safe only while no deduction exists: it never writes deductions, and the stricter recovery guard only refuses over-balance recoveries. Once any deduction exists, an old backend would approve that payroll without the receivable credit, so do not roll the backend back after the first deduction without the data steps below.
3. Existing package-enrollment write guard (0031) is unrelated.

## Before applying (deployer)

- Take and verify a D1 backup/export of the shared database. Confirm the actual mechanism, retention and restore time with the Cloudflare account owner; this has not been drilled. Record the backup identifier.
- Confirm el_migrations shows 0035 applied and 0036/0037 not applied.
- Confirm remaining D1 storage and row budget (shared with Sherkty) using the existing quota procedure.
- CI must be green on the exact release SHA.

## Apply

- Apply 0036, 0037 in order, then deploy the matching backend. Brief pause of employee payroll and loan writes is advisable but needs the owner's explicit approval and there is no application toggle; the window is small because the migrations only create objects and replace triggers.
- Stop on any error. Do not continue to the backend.

## Verify after applying

- el_migrations lists 0036 and 0037.
- Tables el_employee_loan_deductions and el_staff_payroll_cancellations exist and are empty.
- Triggers el_employee_loan_recovery_guard, el_employee_loan_deduction_insert/update, el_staff_payroll_guard exist.
- Existing employee payroll count, loan count and journal count unchanged versus the pre-apply numbers.
- Smoke test with fictional data in a non-production organization only: loan, disbursement, payroll with a deduction, cancel, new payroll, approval, recovery cap. Do not create production financial records for testing.

## Rollback

- Before any production deduction exists: redeploy the previous backend. Schema objects can remain (additive).
- After deductions exist: do not roll back the backend. Fix forward, or restore the pre-apply backup, which discards every write since the backup and needs the owner's approval.
- Never delete rows from el_employee_loan_deductions or journals by hand. They are immutable by design.

## Still open

Independent accountant review of the accrual treatment, legal review of wage deductions, any write-off or correction policy, a restore drill, load and security review. None is decided here.
