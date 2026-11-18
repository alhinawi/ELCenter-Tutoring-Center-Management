import type { Hono } from "hono";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { permit, scope, audit, type AppContext } from "./app";
import { assert } from "./security";
import { uid, now } from "./db";
import { date, amount, accounts, journal } from "./finance";
function access(c: AppContext, action = "view") {
  permit(c, "payroll");
  permit(c, "finance");
  permit(c, "finance", action);
}
async function today(c: AppContext) {
  const o = await c.env.DB.prepare(
    "SELECT currency,timezone FROM el_organizations WHERE id=?",
  )
    .bind(c.get("actor").org_id)
    .first<{ currency: string; timezone: string }>();
  return { ...o!, today: Temporal.Now.plainDateISO(o!.timezone).toString() };
}
async function loan(c: AppContext, id: string) {
  const row = await c.env.DB.prepare(
    "SELECT p.*,e.name employee_name,COALESCE((SELECT sum(amount) FROM el_employee_loan_recoveries r WHERE r.loan_id=p.id),0) recovered FROM el_employee_loans p JOIN el_employees e ON e.org_id=p.org_id AND e.id=p.employee_id WHERE p.id=? AND p.org_id=?",
  )
    .bind(id, c.get("actor").org_id)
    .first<Record<string, any>>();
  assert(row, 404, "Employee loan not found");
  scope(c, row.branch_id);
  return row;
}
const note = z.string().trim().min(1).max(500);
export function registerEmployeeLoans(app: Hono<any>) {
  app.get("/api/employee-loans/options", async (c: AppContext) => {
    access(c);
    const a = c.get("actor");
    const employees = (
      await c.env.DB.prepare(
        "SELECT id,name,code,branch_id,teacher_id FROM el_employees WHERE org_id=? AND (? IS NULL OR branch_id=?) AND status IN ('active','onboarding','on_leave') AND is_demo=0 ORDER BY name,id LIMIT 501",
      )
        .bind(a.org_id, a.branch_id, a.branch_id)
        .all()
    ).results;
    const accounts = (
      await c.env.DB.prepare(
        "SELECT id,code,name FROM el_accounts WHERE org_id=? AND kind='asset' AND active=1 AND system_key IS NULL ORDER BY code LIMIT 501",
      )
        .bind(a.org_id)
        .all()
    ).results;
    assert(
      employees.length <= 500 && accounts.length <= 500,
      400,
      "Loan options exceed 500 employees or accounts; narrow employee scope to a branch or contact finance",
    );
    return c.json({ employees, accounts, ...(await today(c)) });
  });
  app.get("/api/employee-loans", async (c: AppContext) => {
    access(c);
    const a = c.get("actor"),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(c.req.query("page") ?? "1");
    const data = (
      await c.env.DB.prepare(
        "SELECT p.*,e.name employee_name,COALESCE((SELECT sum(amount) FROM el_employee_loan_recoveries r WHERE r.loan_id=p.id),0) recovered FROM el_employee_loans p JOIN el_employees e ON e.id=p.employee_id AND e.org_id=p.org_id WHERE p.org_id=? AND (? IS NULL OR p.branch_id=?) ORDER BY p.created_at DESC,p.id DESC LIMIT 26 OFFSET ?",
      )
        .bind(a.org_id, a.branch_id, a.branch_id, (page - 1) * 25)
        .all()
    ).results;
    return c.json({
      data: data.slice(0, 25),
      page,
      has_more: data.length > 25,
    });
  });
  app.get("/api/employee-loans/:id", async (c: AppContext) => {
    access(c);
    const row = await loan(c, c.req.param("id")!);
    const recoveries = (
      await c.env.DB.prepare(
        "SELECT id,date,amount,method,reference,journal_id FROM el_employee_loan_recoveries WHERE org_id=? AND loan_id=? ORDER BY date,id LIMIT 501",
      )
        .bind(row.org_id, row.id)
        .all()
    ).results;
    assert(
      recoveries.length <= 500,
      400,
      "Recovery detail exceeds 500 records; use the account ledger for complete history",
    );
    return c.json({ data: row, recoveries });
  });
  app.post("/api/employee-loans", async (c: AppContext) => {
    access(c, "create");
    const a = c.get("actor"),
      d = z
        .object({
          employee_id: z.uuid(),
          kind: z.enum(["advance", "loan"]),
          principal: amount,
          receivable_account_id: z.uuid(),
          requested_on: date,
          due_on: date,
          reason: note,
        })
        .strict()
        .parse(await c.req.json()),
      o = await today(c);
    assert(
      d.due_on >= d.requested_on && d.requested_on <= o.today,
      400,
      "Check requested and due dates",
    );
    const e = await c.env.DB.prepare(
      "SELECT id,branch_id FROM el_employees WHERE org_id=? AND id=? AND is_demo=0 AND status IN ('active','onboarding','on_leave')",
    )
      .bind(a.org_id, d.employee_id)
      .first<{ id: string; branch_id: string }>();
    assert(e, 404, "Choose an active real employee");
    scope(c, e.branch_id);
    assert(
      await c.env.DB.prepare(
        "SELECT id FROM el_accounts WHERE org_id=? AND id=? AND kind='asset' AND active=1 AND system_key IS NULL",
      )
        .bind(a.org_id, d.receivable_account_id)
        .first(),
      400,
      "Choose a dedicated custom asset receivable account",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_employee_loans(id,org_id,branch_id,employee_id,kind,principal,receivable_account_id,requested_on,due_on,reason,currency,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        e.branch_id,
        e.id,
        d.kind,
        d.principal,
        d.receivable_account_id,
        d.requested_on,
        d.due_on,
        d.reason,
        o.currency,
        a.user_id,
        now(),
      ),
      audit(c, "employee_loan", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/employee-loans/:id/decision", async (c: AppContext) => {
    access(c, "approve");
    const p = await loan(c, c.req.param("id")!),
      a = c.get("actor"),
      d = z
        .object({
          decision: z.enum(["approved", "rejected", "cancelled"]),
          note,
        })
        .strict()
        .parse(await c.req.json());
    assert(
      (p.status === "draft" && d.decision !== "cancelled") ||
        (p.status === "approved" && d.decision === "cancelled"),
      409,
      "Employee loan transition is unavailable",
    );
    assert(
      a.user_id !== p.created_by,
      403,
      "A different finance user must decide",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_employee_loans SET status=?,approved_by=?,decision_note=?,decided_at=? WHERE id=? AND org_id=?",
      ).bind(
        d.decision,
        p.status === "approved" ? p.approved_by : a.user_id,
        d.note,
        now(),
        p.id,
        a.org_id,
      ),
      audit(c, "employee_loan", p.id, "decision", p, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/employee-loans/:id/disburse", async (c: AppContext) => {
    access(c, "approve");
    const p = await loan(c, c.req.param("id")!),
      a = c.get("actor"),
      d = z
        .object({ date, method: z.enum(["cash", "bank"]) })
        .strict()
        .parse(await c.req.json());
    if (p.status === "disbursed") {
      assert(
        p.disbursed_on === d.date && p.disbursed_method === d.method,
        409,
        "Employee loan already recorded with different terms",
      );
      return c.json({ ok: true, journal_id: p.journal_id, replayed: true });
    }
    assert(p.status === "approved", 409, "Approve this employee loan first");
    assert(
      a.user_id !== p.created_by && a.user_id !== p.approved_by,
      403,
      "Use a separate preparer approver and recorded disburser",
    );
    const o = await today(c);
    assert(
      d.date >= p.requested_on && d.date <= o.today,
      400,
      "Disbursement date must be from request date through today",
    );
    assert(
      p.currency === o.currency,
      409,
      "Organization currency changed; cancel and prepare a new loan",
    );
    const ac = await accounts(c),
      j = await journal(c, {
        branch: p.branch_id,
        date: d.date,
        reference: "EMP-LOAN-" + p.id,
        memo: "Recorded employee " + p.kind,
        source: "employee_loan",
        sourceId: p.id,
        lines: [
          { account: p.receivable_account_id, debit: p.principal, credit: 0 },
          { account: ac[d.method], debit: 0, credit: p.principal },
        ],
      });
    await c.env.DB.batch([
      ...j.statements,
      c.env.DB.prepare(
        "UPDATE el_employee_loans SET status='disbursed',disbursed_by=?,disbursed_on=?,disbursed_method=?,journal_id=? WHERE id=? AND org_id=?",
      ).bind(a.user_id, d.date, d.method, j.id, p.id, a.org_id),
      audit(c, "employee_loan", p.id, "record_disbursement", p, d),
    ]);
    return c.json({ ok: true, journal_id: j.id });
  });
  app.post("/api/employee-loans/:id/recoveries", async (c: AppContext) => {
    access(c, "create");
    const p = await loan(c, c.req.param("id")!),
      a = c.get("actor"),
      d = z
        .object({
          date,
          amount,
          method: z.enum(["cash", "bank"]),
          reference: note,
          request_key: z.uuid(),
        })
        .strict()
        .parse(await c.req.json());
    const existing = await c.env.DB.prepare(
      "SELECT * FROM el_employee_loan_recoveries WHERE org_id=? AND request_key=?",
    )
      .bind(a.org_id, d.request_key)
      .first<Record<string, any>>();
    if (existing) {
      assert(
        existing.loan_id === p.id &&
          existing.date === d.date &&
          existing.amount === d.amount &&
          existing.method === d.method &&
          existing.reference === d.reference,
        409,
        "Recovery request key already used with different terms",
      );
      return c.json({ id: existing.id, replayed: true });
    }
    assert(p.status === "disbursed", 409, "Record disbursement first");
    const o = await today(c);
    assert(
      p.currency === o.currency,
      409,
      "Currency changed; review recovery with finance before recording",
    );
    assert(
      d.amount <= p.principal - p.recovered &&
        d.date >= p.disbursed_on &&
        d.date <= o.today,
      400,
      "Check outstanding balance and recovery date",
    );
    const ac = await accounts(c),
      id = uid(),
      j = await journal(c, {
        branch: p.branch_id,
        date: d.date,
        reference: "EMP-RECOVERY-" + id,
        memo: d.reference,
        source: "employee_loan_recovery",
        sourceId: id,
        lines: [
          { account: ac[d.method], debit: d.amount, credit: 0 },
          { account: p.receivable_account_id, debit: 0, credit: d.amount },
        ],
      });
    await c.env.DB.batch([
      ...j.statements,
      c.env.DB.prepare(
        "INSERT INTO el_employee_loan_recoveries(id,org_id,loan_id,date,amount,method,reference,request_key,journal_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        p.id,
        d.date,
        d.amount,
        d.method,
        d.reference,
        d.request_key,
        j.id,
        a.user_id,
        now(),
      ),
      audit(c, "employee_loan", p.id, "record_recovery", null, {
        ...d,
        id,
        journal_id: j.id,
      }),
    ]);
    return c.json({ id }, 201);
  });
}
