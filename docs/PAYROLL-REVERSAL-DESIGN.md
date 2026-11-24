# Design proposal: auditable reversal of approved payroll

Status: proposal only. No code, migration or production change accompanies it. Nothing here chooses accounting policy; items marked OWNER need the owner's decision.

## Why

The original spec asks for auditable reversal or adjustment of finalized transactions. Today manual journals and invoices can be reversed (`/api/finance/journals/:id/reverse` and the invoice flow, both writing a new journal with `reverse_of`). Payroll journals are refused ("use the source workflow"), and no payroll source workflow exists yet. An approved payroll with a wrong figure therefore has no in-app correction.

## Principles

1. Never edit or delete the original journal, payroll snapshot or deduction. A correction is a new, linked, immutable record.
2. Reversal and write-off are different things and are separate workflows.
   - Reversal: undoes an approved payroll's accounting because the payroll itself was wrong. Loan balances return to what they were.
   - Write-off: the employer decides not to collect part of a loan. It changes what the employee owes and needs its own approval. It is out of scope here and not authorized.
3. Preparer, approver and reverser are three different people. The reverser cannot be the preparer or approver of the payroll, enforced by database triggers as in the existing payroll guards.
4. A reason is required. Each step writes an audit event.

## Proposed workflow (unpaid payroll)

1. A scoped finance user requests reversal with a reason. A request record snapshots the payroll revision, journal id and amounts.
2. A different user with approval permission decides. Approval is atomic in one batch:
   - post a reversal journal swapping every debit and credit of the original (payroll expense, payroll payable, each employee receivable), `reverse_of` = original, dated in an open period (OWNER: original date or reversal date; closed periods stay refused);
   - mark the payroll `reversed` through a separate immutable record (the original status history stays approved);
   - return each applied loan deduction to the loan balance through a linked release record, never by editing the deduction.
3. The month can then be recalculated as a new draft, as cancellation of drafts already allows.

## Paid payroll

The payout journal (cash or bank against payable) also needs reversing, and money has actually moved. Options:

- A. Block reversal once paid; require a separate recorded recovery of the overpayment (employee repays, as a recorded receivable). Safest and simplest.
- B. Allow reversal of both journals, with a distinct payout-reversal step by a fourth, independent payer role.
  Recommendation: build A first. OWNER decides B.

## Permission options (OWNER)

| Option | Who requests                     | Who approves                                                 | Notes                                                   |
| ------ | -------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| 1      | finance, payroll:prepare         | finance, payroll:approve, not the original approver          | Reuses existing permissions, lowest change              |
| 2      | finance                          | New permission payroll:reverse held only by owner/HQ manager | Strongest, adds a role grant                            |
| 3      | as 2, plus branch scope enforced | as 2                                                         | Same, but branch managers can reverse only their branch |

## Technical safety work (no production)

- Migration would be additive: reversal request/decision table, release records, triggers. Old backend on the new schema stays safe until the first reversal exists; after that the forward-fix path applies.
- Tests before any proposal to deploy: balanced reversal, double-reversal refused, self-review refused, closed-period refused, deduction release restores exact balance, paid payroll refused under option A, reversal of a payroll with several loans.
- Recovery: no shared-database restore. Rollback is forward-fix only (a compensating record), which this design already is.
