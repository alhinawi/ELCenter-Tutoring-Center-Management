import type { Hono } from "hono";
import { z } from "zod";
import { uid } from "./db";
import { permit, scope, audit, type AppContext } from "./app";
import { assert } from "./security";
import { entity, date, accounts, journal } from "./finance";
export function registerFinancePlans(app: Hono<any>) {
  app.post("/api/invoices/:id/coupon", async (c: AppContext) => {
    permit(c, "finance", "edit");
    const invoice = await entity(c, "invoices", c.req.param("id")!),
      d = z
        .object({ code: z.string().trim().min(1).max(30) })
        .parse(await c.req.json());
    assert(
      invoice.status === "draft",
      409,
      "Only draft invoices can use coupons",
    );
    const coupon = await c.env.DB.prepare(
      "SELECT * FROM el_coupons WHERE org_id=? AND branch_id=? AND code=? AND status='active' AND starts_on<=? AND ends_on>=?",
    )
      .bind(
        invoice.org_id,
        invoice.branch_id,
        d.code,
        invoice.date,
        invoice.date,
      )
      .first<Record<string, any>>();
    assert(coupon, 409, "Coupon unavailable for invoice date or branch");
    const gross = await c.env.DB.prepare(
      "SELECT sum(quantity*unit_price) gross FROM el_invoice_items WHERE invoice_id=?",
    )
      .bind(invoice.id)
      .first<{ gross: number }>();
    const discount =
        coupon.type === "percent"
          ? Math.round((gross!.gross * coupon.value) / 100)
          : coupon.value,
      total = gross!.gross - discount;
    assert(total > 0, 400, "Coupon must leave a positive invoice total");
    const related = await c.env.DB.prepare(
      "SELECT (SELECT count(*) FROM el_installments WHERE invoice_id=?) plans,(SELECT COALESCE(sum(amount),0) FROM el_invoice_teacher_shares WHERE invoice_id=?) allocated",
    )
      .bind(invoice.id, invoice.id)
      .first<{ plans: number; allocated: number }>();
    assert(
      !related!.plans && related!.allocated <= total,
      409,
      "Apply coupon before installment plan and adjust teacher allocations first",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_invoices SET coupon_id=?,discount=?,total=? WHERE id=? AND status='draft'",
      ).bind(coupon.id, discount, total, invoice.id),
      audit(c, "invoice", invoice.id, "apply_coupon", invoice, {
        coupon_id: coupon.id,
        discount,
        total,
      }),
    ]);
    return c.json({ ok: true, total, discount });
  });
  app.put("/api/invoices/:id/installments", async (c: AppContext) => {
    permit(c, "finance", "edit");
    const i = await entity(c, "invoices", c.req.param("id")!),
      d = z
        .object({
          installments: z
            .array(
              z.object({
                due_date: date,
                amount: z.number().int().positive().max(1000000000),
              }),
            )
            .min(1)
            .max(36),
        })
        .parse(await c.req.json());
    assert(i.status === "draft", 409, "Installments are locked after issue");
    assert(
      d.installments.every(
        (x) => x.due_date >= i.date && x.due_date <= i.due_date,
      ) && d.installments.reduce((n, x) => n + x.amount, 0) === i.total,
      400,
      "Installment dates and amounts must match the invoice",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM el_installments WHERE invoice_id=? AND org_id=?",
      ).bind(i.id, i.org_id),
      ...d.installments.map((x) =>
        c.env.DB.prepare(
          "INSERT INTO el_installments(id,org_id,invoice_id,due_date,amount,is_demo) VALUES(?,?,?,?,?,?)",
        ).bind(uid(), i.org_id, i.id, x.due_date, x.amount, i.is_demo),
      ),
      audit(c, "invoice", i.id, "set_installments", null, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/expenses/:id/settle", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const e = await entity(c, "expenses", c.req.param("id")!),
      d = z
        .object({
          date,
          amount: z.number().int().positive().max(1000000000),
          method: z.enum(["cash", "bank"]),
          reference: z.string().trim().max(200).default(""),
          idempotency_key: z.uuid(),
        })
        .parse(await c.req.json());
    const prior = await c.env.DB.prepare(
      "SELECT id,expense_id,amount FROM el_expense_payments WHERE org_id=? AND idempotency_key=?",
    )
      .bind(e.org_id, d.idempotency_key)
      .first<Record<string, any>>();
    if (prior) {
      assert(
        prior.expense_id === e.id && prior.amount === d.amount,
        409,
        "Idempotency key already used",
      );
      return c.json({ id: prior.id, replayed: true });
    }
    assert(
      e.status === "approved" && e.method === "payable",
      409,
      "Only approved payables can be settled",
    );
    assert(d.date >= e.date, 400, "Settlement cannot precede expense");
    const ac = await accounts(c),
      id = uid(),
      j = await journal(c, {
        branch: e.branch_id,
        date: d.date,
        reference: "BILLPAY-" + id,
        memo: d.reference || e.description,
        source: "expense_settlement",
        sourceId: id,
        lines: [
          { account: ac.payable, debit: d.amount, credit: 0 },
          {
            account: d.method === "cash" ? ac.cash : ac.bank,
            debit: 0,
            credit: d.amount,
          },
        ],
        demo: e.is_demo,
      });
    await c.env.DB.batch([
      ...j.statements,
      c.env.DB.prepare(
        "INSERT INTO el_expense_payments(id,org_id,branch_id,expense_id,date,amount,method,reference,idempotency_key,journal_id,created_by,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        e.org_id,
        e.branch_id,
        e.id,
        d.date,
        d.amount,
        d.method,
        d.reference,
        d.idempotency_key,
        j.id,
        c.get("actor").user_id,
        e.is_demo,
      ),
      audit(c, "expense", e.id, "settle_payable", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/finance/reconciliation", async (c: AppContext) => {
    permit(c, "finance");
    const a = c.get("actor"),
      branch = c.req.query("branch_id"),
      account = c.req.query("account_id");
    if (branch) scope(c, branch);
    const history = (
      await c.env.DB.prepare(
        "SELECT r.*,ac.name account_name,b.name branch_name FROM el_reconciliations r JOIN el_accounts ac ON ac.id=r.account_id JOIN el_branches b ON b.id=r.branch_id WHERE r.org_id=? AND (? IS NULL OR r.branch_id=?) ORDER BY r.statement_date DESC LIMIT 100",
      )
        .bind(a.org_id, a.branch_id, a.branch_id)
        .all()
    ).results;
    if (!branch || !account) return c.json({ history, data: [] });
    const ac = await c.env.DB.prepare(
      "SELECT id FROM el_accounts WHERE id=? AND org_id=? AND system_key IN ('cash','bank')",
    )
      .bind(account, a.org_id)
      .first();
    assert(ac, 400, "Choose a cash or bank account");
    const data = (
      await c.env.DB.prepare(
        "SELECT l.id,j.date,j.reference,l.debit,l.credit FROM el_journal_lines l JOIN el_journals j ON j.id=l.journal_id WHERE j.org_id=? AND j.branch_id=? AND j.status='posted' AND l.account_id=? AND NOT EXISTS(SELECT 1 FROM el_reconciliation_lines r WHERE r.line_id=l.id) ORDER BY j.date,l.id LIMIT 500",
      )
        .bind(a.org_id, branch, account)
        .all()
    ).results;
    return c.json({ data, history });
  });
  app.post("/api/finance/reconciliation", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const d = z
        .object({
          branch_id: z.uuid(),
          account_id: z.uuid(),
          statement_date: date,
          opening_balance: z.number().int(),
          closing_balance: z.number().int(),
          reference: z.string().trim().min(1).max(200),
          line_ids: z.array(z.uuid()).min(1).max(90),
        })
        .parse(await c.req.json()),
      a = c.get("actor");
    scope(c, d.branch_id);
    assert(
      new Set(d.line_ids).size === d.line_ids.length,
      400,
      "Duplicate statement line",
    );
    const rows = (
      await c.env.DB.prepare(
        `SELECT l.id,l.debit-l.credit movement,j.date FROM el_journal_lines l JOIN el_journals j ON j.id=l.journal_id JOIN el_accounts ac ON ac.id=l.account_id WHERE j.org_id=? AND j.branch_id=? AND l.account_id=? AND j.status='posted' AND ac.system_key IN ('cash','bank') AND l.id IN (${d.line_ids.map(() => "?").join(",")})`,
      )
        .bind(a.org_id, d.branch_id, d.account_id, ...d.line_ids)
        .all<{ id: string; movement: number; date: string }>()
    ).results;
    assert(
      rows.length === d.line_ids.length &&
        rows.every((x) => x.date <= d.statement_date),
      400,
      "Choose valid statement lines at or before statement date",
    );
    assert(
      d.opening_balance + rows.reduce((n, x) => n + x.movement, 0) ===
        d.closing_balance,
      409,
      "Statement does not balance with selected ledger lines",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_reconciliations(id,org_id,branch_id,account_id,statement_date,opening_balance,closing_balance,reference,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.branch_id,
        d.account_id,
        d.statement_date,
        d.opening_balance,
        d.closing_balance,
        d.reference,
        a.user_id,
      ),
      ...d.line_ids.map((line) =>
        c.env.DB.prepare(
          "INSERT INTO el_reconciliation_lines(id,org_id,reconciliation_id,line_id) VALUES(?,?,?,?)",
        ).bind(uid(), a.org_id, id, line),
      ),
      audit(c, "reconciliation", id, "finalize", null, d),
    ]);
    return c.json({ id }, 201);
  });
}
