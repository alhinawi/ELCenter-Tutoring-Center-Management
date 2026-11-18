import type { Hono } from "hono";
import { readLedger } from "./ledger";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { uid, type Statement } from "./db";
import { assert } from "./security";
import { permit, scope, audit, type AppContext } from "./app";
import { record } from "./academic";
export const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((x) => {
      try {
        Temporal.PlainDate.from(x);
        return true;
      } catch {
        return false;
      }
    }),
  amount = z.number().int().min(1).max(1000000000),
  text = z.string().trim().min(1).max(500),
  optional = z.string().trim().max(500).default("");
const systemAccounts = [
  ["1000", "Cash", "asset", "cash"],
  ["1010", "Bank", "asset", "bank"],
  ["1100", "Accounts receivable", "asset", "receivable"],
  ["2000", "Accounts payable", "liability", "payable"],
  ["2100", "Payroll payable", "liability", "payroll_payable"],
  ["3000", "Opening equity", "equity", "equity"],
  ["4000", "Tuition revenue", "revenue", "revenue"],
  ["5000", "Operating expenses", "expense", "expense"],
  ["5100", "Payroll expense", "expense", "payroll_expense"],
] as const;
async function orgBranch(c: AppContext, id: string) {
  scope(c, id);
  const row = await c.env.DB.prepare(
    "SELECT id FROM el_branches WHERE id=? AND org_id=? AND status='active'",
  )
    .bind(id, c.get("actor").org_id)
    .first();
  assert(row, 400, "Choose an active branch");
}
export async function entity(c: AppContext, table: string, id: string) {
  const row = await c.env.DB.prepare(
    `SELECT * FROM el_${table} WHERE id=? AND org_id=?`,
  )
    .bind(id, c.get("actor").org_id)
    .first<Record<string, any>>();
  assert(row, 404, "Record not found");
  scope(c, row.branch_id);
  return row;
}
export async function accounts(c: AppContext) {
  const rows = (
    await c.env.DB.prepare(
      "SELECT id,system_key FROM el_accounts WHERE org_id=? AND system_key IS NOT NULL",
    )
      .bind(c.get("actor").org_id)
      .all<{ id: string; system_key: string }>()
  ).results;
  assert(
    rows.length === systemAccounts.length,
    409,
    "Initialize finance settings first",
  );
  return Object.fromEntries(rows.map((x) => [x.system_key, x.id]));
}
async function period(c: AppContext, value: string) {
  const rows = (
    await c.env.DB.prepare(
      "SELECT id FROM el_financial_periods WHERE org_id=? AND status='open' AND starts_on<=? AND ends_on>=?",
    )
      .bind(c.get("actor").org_id, value, value)
      .all<{ id: string }>()
  ).results;
  assert(
    rows.length === 1,
    409,
    "Choose a date within exactly one open financial period",
  );
  return rows[0].id;
}
export async function journal(
  c: AppContext,
  d: {
    id?: string;
    branch: string;
    date: string;
    reference: string;
    memo: string;
    source: string;
    sourceId: string;
    lines: { account: string; debit: number; credit: number }[];
    reverseOf?: string;
    demo?: number;
  },
) {
  assert(
    d.lines.length >= 2 && d.lines.length <= 80,
    400,
    "Journal needs 2 to 80 lines",
  );
  assert(
    d.lines.reduce((n, x) => n + x.debit - x.credit, 0) === 0,
    400,
    "Journal must balance",
  );
  const a = c.get("actor"),
    id = d.id ?? uid(),
    p = await period(c, d.date);
  return {
    id,
    statements: [
      c.env.DB.prepare(
        "INSERT INTO el_journals(id,org_id,branch_id,period_id,date,reference,memo,source_type,source_id,reverse_of,created_by,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.branch,
        p,
        d.date,
        d.reference,
        d.memo,
        d.source,
        d.sourceId,
        d.reverseOf ?? null,
        a.user_id,
        d.demo ?? 0,
      ),
      ...d.lines.map((x) =>
        c.env.DB.prepare(
          "INSERT INTO el_journal_lines(id,org_id,journal_id,account_id,debit,credit,is_demo) VALUES(?,?,?,?,?,?,?)",
        ).bind(uid(), a.org_id, id, x.account, x.debit, x.credit, d.demo ?? 0),
      ),
      c.env.DB.prepare(
        "UPDATE el_journals SET status='posted',posted_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(id),
    ],
  };
}
function netQuery() {
  return "COALESCE((SELECT sum(CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END) FROM el_payments p WHERE p.invoice_id=i.id),0)";
}
export function registerFinance(app: Hono<any>) {
  app.post("/api/settings/demo/finance", async (c: AppContext) => {
    permit(c, "organization", "manage");
    await seedFinanceDemo(c);
    return c.json({ ok: true });
  });
  app.post("/api/finance/initialize", async (c: AppContext) => {
    permit(c, "finance", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Organization-wide permission required");
    const d = z
      .object({ year: z.number().int().min(2020).max(2100) })
      .parse(await c.req.json());
    const statements = systemAccounts.map(([code, name, kind, key]) =>
      c.env.DB.prepare(
        "INSERT INTO el_accounts(id,org_id,code,name,kind,system_key) VALUES(?,?,?,?,?,?) ON CONFLICT(org_id,system_key) DO NOTHING",
      ).bind(uid(), a.org_id, code, name, kind, key),
    );
    const existing = await c.env.DB.prepare(
      "SELECT id FROM el_financial_periods WHERE org_id=? AND starts_on<=? AND ends_on>=?",
    )
      .bind(a.org_id, `${d.year}-12-31`, `${d.year}-01-01`)
      .first();
    if (!existing)
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO el_financial_periods(id,org_id,name,starts_on,ends_on) VALUES(?,?,?,?,?)",
        ).bind(
          uid(),
          a.org_id,
          String(d.year),
          `${d.year}-01-01`,
          `${d.year}-12-31`,
        ),
      );
    await c.env.DB.batch([
      ...statements,
      audit(c, "finance", a.org_id, "initialize", null, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/finance/options", async (c: AppContext) => {
    const a = c.get("actor");
    assert(
      a.permissions.includes("finance:view") ||
        a.permissions.includes("payroll:view"),
      403,
      "Financial access required",
    );
    const out: Record<string, unknown> = {};
    for (const table of [
      "branches",
      ...(a.permissions.includes("finance:view") ? ["students"] : []),
      ...(a.permissions.includes("payroll:view") ||
      a.permissions.includes("finance:edit")
        ? ["teachers"]
        : []),
    ]) {
      out[table] = (
        await c.env.DB.prepare(
          `SELECT id,name${table === "branches" ? "" : ",branch_id"} FROM el_${table} WHERE org_id=? AND (? IS NULL OR ${table === "branches" ? "id" : "branch_id"}=?) AND status='active' ORDER BY name LIMIT 500`,
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results;
    }
    return c.json(out);
  });
  app.get("/api/finance/settings", async (c: AppContext) => {
    permit(c, "finance");
    const a = c.get("actor");
    return c.json({
      accounts: (
        await c.env.DB.prepare(
          "SELECT * FROM el_accounts WHERE org_id=? ORDER BY code",
        )
          .bind(a.org_id)
          .all()
      ).results,
      periods: (
        await c.env.DB.prepare(
          "SELECT * FROM el_financial_periods WHERE org_id=? ORDER BY starts_on DESC",
        )
          .bind(a.org_id)
          .all()
      ).results,
    });
  });
  app.post("/api/finance/accounts", async (c: AppContext) => {
    permit(c, "finance", "manage");
    assert(
      !c.get("actor").branch_id,
      403,
      "Organization-wide permission required",
    );
    const d = z
        .object({
          code: z.string().regex(/^\d{3,10}$/),
          name: text,
          kind: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
        })
        .parse(await c.req.json()),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_accounts(id,org_id,code,name,kind) VALUES(?,?,?,?,?)",
      ).bind(id, c.get("actor").org_id, d.code, d.name, d.kind),
      audit(c, "account", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/finance/periods", async (c: AppContext) => {
    permit(c, "finance", "manage");
    assert(
      !c.get("actor").branch_id,
      403,
      "Organization-wide permission required",
    );
    const d = z
      .object({ name: text, starts_on: date, ends_on: date })
      .refine((d) => d.starts_on <= d.ends_on)
      .parse(await c.req.json());
    assert(
      !(await c.env.DB.prepare(
        "SELECT id FROM el_financial_periods WHERE org_id=? AND starts_on<=? AND ends_on>=?",
      )
        .bind(c.get("actor").org_id, d.ends_on, d.starts_on)
        .first()),
      409,
      "Financial periods cannot overlap",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_financial_periods(id,org_id,name,starts_on,ends_on) VALUES(?,?,?,?,?)",
      ).bind(id, c.get("actor").org_id, d.name, d.starts_on, d.ends_on),
      audit(c, "period", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/finance/periods/:id/close", async (c: AppContext) => {
    permit(c, "finance", "approve");
    assert(
      !c.get("actor").branch_id,
      403,
      "Organization-wide permission required",
    );
    const id = c.req.param("id")!;
    const before = await c.env.DB.prepare(
      "SELECT * FROM el_financial_periods WHERE id=? AND org_id=? AND status='open'",
    )
      .bind(id, c.get("actor").org_id)
      .first();
    assert(before, 409, "Open financial period not found");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_financial_periods SET status='closed' WHERE id=?",
      ).bind(id),
      audit(c, "period", id, "close", before, { status: "closed" }),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/invoices", async (c: AppContext) => {
    permit(c, "finance");
    const a = c.get("actor"),
      page = Math.max(1, Number(c.req.query("page")) || 1);
    const rows = await c.env.DB.prepare(
      `SELECT i.*,s.name student_name,${netQuery()} paid,i.total-${netQuery()} outstanding FROM el_invoices i JOIN el_students s ON s.id=i.student_id WHERE i.org_id=? AND (? IS NULL OR i.branch_id=?) ORDER BY i.created_at DESC,i.id LIMIT 30 OFFSET ?`,
    )
      .bind(a.org_id, a.branch_id, a.branch_id, (page - 1) * 30)
      .all();
    return c.json({ data: rows.results, page });
  });
  const invoiceSchema = z
    .object({
      student_id: z.uuid(),
      number: z.string().trim().min(1).max(40),
      date,
      due_date: date,
      discount: z.number().int().min(0).max(1000000000).default(0),
      items: z
        .array(
          z.object({
            description: text,
            quantity: z.number().int().min(1).max(10000),
            unit_price: z.number().int().min(0).max(1000000000),
          }),
        )
        .min(1)
        .max(40),
    })
    .refine((d) => d.due_date >= d.date, {
      message: "Due date precedes invoice date",
    });
  app.post("/api/invoices", async (c: AppContext) => {
    permit(c, "finance", "create");
    const d = invoiceSchema.parse(await c.req.json()),
      s = await record(c, "students", d.student_id);
    const total =
      d.items.reduce((n, x) => n + x.quantity * x.unit_price, 0) - d.discount;
    assert(
      total > 0 && Number.isSafeInteger(total) && total <= 1000000000,
      400,
      "Invoice total must be between 1 and 1,000,000,000",
    );
    const a = c.get("actor"),
      id = uid(),
      currency = (await c.env.DB.prepare(
        "SELECT currency FROM el_organizations WHERE id=?",
      )
        .bind(a.org_id)
        .first<{ currency: string }>())!.currency;
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_invoices(id,org_id,branch_id,student_id,number,date,due_date,currency,discount,total,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        s.branch_id,
        s.id,
        d.number,
        d.date,
        d.due_date,
        currency,
        d.discount,
        total,
        a.user_id,
      ),
      ...d.items.map((x) =>
        c.env.DB.prepare(
          "INSERT INTO el_invoice_items(id,org_id,invoice_id,description,quantity,unit_price) VALUES(?,?,?,?,?,?)",
        ).bind(uid(), a.org_id, id, x.description, x.quantity, x.unit_price),
      ),
      audit(c, "invoice", id, "create", null, { ...d, total }),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/invoices/:id", async (c: AppContext) => {
    permit(c, "finance");
    const i = await entity(c, "invoices", c.req.param("id")!),
      a = c.get("actor");
    const items = await c.env.DB.prepare(
      "SELECT * FROM el_invoice_items WHERE invoice_id=? AND org_id=?",
    )
      .bind(i.id, a.org_id)
      .all();
    const payments = await c.env.DB.prepare(
      "SELECT * FROM el_payments WHERE invoice_id=? AND org_id=? ORDER BY created_at,id",
    )
      .bind(i.id, a.org_id)
      .all<Record<string, any>>();
    const s = await c.env.DB.prepare(
      "SELECT name,code,address,phone FROM el_students WHERE id=? AND org_id=?",
    )
      .bind(i.student_id, a.org_id)
      .first();
    return c.json({
      data: i,
      installments: (
        await c.env.DB.prepare(
          "SELECT * FROM el_installments WHERE invoice_id=? AND org_id=? ORDER BY due_date,id",
        )
          .bind(i.id, i.org_id)
          .all()
      ).results,
      student: s,
      items: items.results,
      payments: payments.results,
      teacher_shares: (
        await c.env.DB.prepare(
          "SELECT s.*,t.name teacher_name FROM el_invoice_teacher_shares s JOIN el_teachers t ON t.id=s.teacher_id WHERE s.invoice_id=? AND s.org_id=?",
        )
          .bind(i.id, i.org_id)
          .all()
      ).results,
      paid: payments.results.reduce(
        (n, p) => n + (p.kind === "receipt" ? p.amount : -p.amount),
        0,
      ),
    });
  });
  app.post("/api/invoices/:id/teacher-shares", async (c: AppContext) => {
    permit(c, "finance", "edit");
    const i = await entity(c, "invoices", c.req.param("id")!),
      d = z
        .object({
          shares: z.array(z.object({ teacher_id: z.uuid(), amount })).max(20),
        })
        .parse(await c.req.json());
    assert(
      i.status === "draft",
      409,
      "Invoice allocations are locked after issue",
    );
    assert(
      new Set(d.shares.map((x) => x.teacher_id)).size === d.shares.length,
      400,
      "Duplicate teacher",
    );
    assert(
      d.shares.reduce((n, x) => n + x.amount, 0) <= i.total,
      400,
      "Teacher allocations exceed invoice total",
    );
    for (const share of d.shares) {
      const teacher = await record(c, "teachers", share.teacher_id);
      assert(
        teacher.branch_id === i.branch_id ||
          (await c.env.DB.prepare(
            "SELECT teacher_id FROM el_teacher_branches WHERE teacher_id=? AND branch_id=?",
          )
            .bind(teacher.id, i.branch_id)
            .first()),
        400,
        "Teacher is not assigned to invoice branch",
      );
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM el_invoice_teacher_shares WHERE invoice_id=? AND org_id=?",
      ).bind(i.id, i.org_id),
      ...d.shares.map((x) =>
        c.env.DB.prepare(
          "INSERT INTO el_invoice_teacher_shares(id,org_id,invoice_id,teacher_id,amount) VALUES(?,?,?,?,?)",
        ).bind(uid(), i.org_id, i.id, x.teacher_id, x.amount),
      ),
      audit(c, "invoice", i.id, "allocate_teacher_revenue", null, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/invoices/:id/issue", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const i = await entity(c, "invoices", c.req.param("id")!);
    assert(i.status === "draft", 409, "Only draft invoices can be issued");
    const ac = await accounts(c),
      j = await journal(c, {
        branch: i.branch_id,
        date: i.date,
        reference: "INV-" + i.number,
        memo: "Invoice " + i.number,
        source: "invoice",
        sourceId: i.id,
        lines: [
          { account: ac.receivable, debit: i.total, credit: 0 },
          { account: ac.revenue, debit: 0, credit: i.total },
        ],
        demo: i.is_demo,
      });
    await c.env.DB.batch([
      ...j.statements,
      c.env.DB.prepare(
        "UPDATE el_invoices SET status='issued',journal_id=? WHERE id=? AND status='draft'",
      ).bind(j.id, i.id),
      audit(c, "invoice", i.id, "issue", i, { journal_id: j.id }),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/invoices/:id/payments", async (c: AppContext) => {
    permit(c, "finance", "create");
    const d = z
        .object({
          date,
          amount,
          method: z.enum(["cash", "bank", "electronic"]),
          reference: optional,
          idempotency_key: z.uuid(),
        })
        .parse(await c.req.json()),
      i = await entity(c, "invoices", c.req.param("id")!);
    assert(i.status === "issued", 409, "Invoice is not issued");
    const existing = await c.env.DB.prepare(
      "SELECT id,invoice_id,amount FROM el_payments WHERE org_id=? AND idempotency_key=?",
    )
      .bind(c.get("actor").org_id, d.idempotency_key)
      .first<Record<string, any>>();
    if (existing) {
      assert(
        existing.invoice_id === i.id && existing.amount === d.amount,
        409,
        "Idempotency key was used for another payment",
      );
      return c.json({ id: existing.id, replayed: true });
    }
    assert(d.date >= i.date, 400, "Payment cannot precede the invoice");
    const ac = await accounts(c),
      id = uid(),
      j = await journal(c, {
        branch: i.branch_id,
        date: d.date,
        reference: "PAY-" + id.slice(0, 12),
        memo: "Receipt for " + i.number,
        source: "payment",
        sourceId: id,
        lines: [
          {
            account: d.method === "cash" ? ac.cash : ac.bank,
            debit: d.amount,
            credit: 0,
          },
          { account: ac.receivable, debit: 0, credit: d.amount },
        ],
        demo: i.is_demo,
      });
    await c.env.DB.batch([
      ...j.statements,
      c.env.DB.prepare(
        "INSERT INTO el_payments(id,org_id,branch_id,invoice_id,date,amount,method,reference,idempotency_key,journal_id,created_by,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        i.org_id,
        i.branch_id,
        i.id,
        d.date,
        d.amount,
        d.method,
        d.reference,
        d.idempotency_key,
        j.id,
        c.get("actor").user_id,
        i.is_demo,
      ),
      audit(c, "payment", id, "receipt", null, { ...d, invoice_id: i.id }),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/payments/:id/refund", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const p = await entity(c, "payments", c.req.param("id")!),
      d = z
        .object({ date, amount, reason: text, idempotency_key: z.uuid() })
        .parse(await c.req.json());
    assert(p.kind === "receipt", 400, "Only original receipts can be refunded");
    assert(d.date >= p.date, 400, "Refund cannot precede payment");
    const existing = await c.env.DB.prepare(
      "SELECT id,refund_of,amount FROM el_payments WHERE org_id=? AND idempotency_key=?",
    )
      .bind(p.org_id, d.idempotency_key)
      .first<Record<string, any>>();
    if (existing) {
      assert(
        existing.refund_of === p.id && existing.amount === d.amount,
        409,
        "Idempotency key already used",
      );
      return c.json({ id: existing.id, replayed: true });
    }
    const ac = await accounts(c),
      id = uid(),
      j = await journal(c, {
        branch: p.branch_id,
        date: d.date,
        reference: "REF-" + id.slice(0, 12),
        memo: d.reason,
        source: "refund",
        sourceId: id,
        lines: [
          { account: ac.receivable, debit: d.amount, credit: 0 },
          {
            account: p.method === "cash" ? ac.cash : ac.bank,
            debit: 0,
            credit: d.amount,
          },
        ],
        demo: p.is_demo,
      });
    await c.env.DB.batch([
      ...j.statements,
      c.env.DB.prepare(
        "INSERT INTO el_payments(id,org_id,branch_id,invoice_id,date,amount,method,reference,idempotency_key,kind,refund_of,reason,journal_id,created_by,is_demo) VALUES(?,?,?,?,?,?,?,?,?,'refund',?,?,?,?,?)",
      ).bind(
        id,
        p.org_id,
        p.branch_id,
        p.invoice_id,
        d.date,
        d.amount,
        p.method,
        "Refund " + p.id,
        d.idempotency_key,
        p.id,
        d.reason,
        j.id,
        c.get("actor").user_id,
        p.is_demo,
      ),
      audit(c, "refund", id, "create", null, { ...d, refund_of: p.id }),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/invoices/:id/void", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const i = await entity(c, "invoices", c.req.param("id")!),
      d = z.object({ date, reason: text }).parse(await c.req.json());
    assert(i.status === "issued", 409, "Only issued invoices can be voided");
    assert(d.date >= i.date, 400, "Reversal cannot precede invoice");
    const ac = await accounts(c),
      j = await journal(c, {
        branch: i.branch_id,
        date: d.date,
        reference: "VOID-" + i.number,
        memo: d.reason,
        source: "invoice_void",
        sourceId: i.id,
        reverseOf: i.journal_id,
        lines: [
          { account: ac.revenue, debit: i.total, credit: 0 },
          { account: ac.receivable, debit: 0, credit: i.total },
        ],
        demo: i.is_demo,
      });
    await c.env.DB.batch([
      ...j.statements,
      c.env.DB.prepare("UPDATE el_invoices SET status='void' WHERE id=?").bind(
        i.id,
      ),
      audit(c, "invoice", i.id, "void", i, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/expenses", async (c: AppContext) => {
    permit(c, "finance");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT e.*,CASE WHEN e.method='payable' AND e.status='approved' THEN e.amount-COALESCE((SELECT sum(amount) FROM el_expense_payments p WHERE p.expense_id=e.id),0) ELSE 0 END outstanding FROM el_expenses e WHERE e.org_id=? AND (? IS NULL OR e.branch_id=?) ORDER BY e.created_at DESC LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/expenses", async (c: AppContext) => {
    permit(c, "finance", "create");
    const d = z
      .object({
        branch_id: z.uuid(),
        date,
        category: text,
        description: text,
        amount,
        method: z.enum(["cash", "bank", "payable"]),
      })
      .parse(await c.req.json());
    await orgBranch(c, d.branch_id);
    const id = uid(),
      a = c.get("actor");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_expenses(id,org_id,branch_id,date,category,description,amount,method,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.branch_id,
        d.date,
        d.category,
        d.description,
        d.amount,
        d.method,
        a.user_id,
      ),
      audit(c, "expense", id, "request", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/expenses/:id/decision", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const before = await entity(c, "expenses", c.req.param("id")!),
      d = z
        .object({ decision: z.enum(["approved", "rejected"]) })
        .parse(await c.req.json()),
      a = c.get("actor");
    assert(before.status === "pending", 409, "Expense is already finalized");
    assert(
      before.created_by !== a.user_id,
      403,
      "A different user must review the expense",
    );
    let j: { id: string; statements: Statement[] } | null = null;
    if (d.decision === "approved") {
      const ac = await accounts(c);
      j = await journal(c, {
        branch: before.branch_id,
        date: before.date,
        reference: "EXP-" + before.id.slice(0, 12),
        memo: before.description,
        source: "expense",
        sourceId: before.id,
        lines: [
          { account: ac.expense, debit: before.amount, credit: 0 },
          {
            account:
              before.method === "payable"
                ? ac.payable
                : before.method === "cash"
                  ? ac.cash
                  : ac.bank,
            debit: 0,
            credit: before.amount,
          },
        ],
        demo: before.is_demo,
      });
    }
    await c.env.DB.batch([
      ...(j?.statements ?? []),
      c.env.DB.prepare(
        "UPDATE el_expenses SET status=?,approved_by=?,journal_id=? WHERE id=?",
      ).bind(d.decision, a.user_id, j?.id ?? null, before.id),
      audit(c, "expense", before.id, d.decision, before, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/finance/ledger", readLedger);
  app.post("/api/finance/journals", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const d = z
      .object({
        branch_id: z.uuid(),
        date,
        reference: z.string().min(1).max(40),
        memo: text,
        lines: z
          .array(
            z
              .object({
                account: z.uuid(),
                debit: z.number().int().min(0).max(1000000000),
                credit: z.number().int().min(0).max(1000000000),
              })
              .refine(
                (x) =>
                  (x.debit > 0 && x.credit === 0) ||
                  (x.credit > 0 && x.debit === 0),
              ),
          )
          .min(2)
          .max(80),
      })
      .parse(await c.req.json());
    await orgBranch(c, d.branch_id);
    const valid = (
      await c.env.DB.prepare(
        "SELECT id FROM el_accounts WHERE org_id=? AND active=1",
      )
        .bind(c.get("actor").org_id)
        .all<{ id: string }>()
    ).results;
    assert(
      d.lines.every((x) => valid.some((v) => v.id === x.account)),
      400,
      "Account not in this organization",
    );
    const id = uid(),
      j = await journal(c, {
        id,
        branch: d.branch_id,
        date: d.date,
        reference: d.reference,
        memo: d.memo,
        source: "manual",
        sourceId: id,
        lines: d.lines,
      });
    await c.env.DB.batch([
      ...j.statements,
      audit(c, "journal", id, "post", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/finance/journals/:id/reverse", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const before = await entity(c, "journals", c.req.param("id")!),
      d = z.object({ date, reason: text }).parse(await c.req.json());
    assert(
      before.source_type === "manual",
      409,
      "Use the source workflow to reverse invoices, payments, expenses or payroll",
    );
    assert(d.date >= before.date, 400, "Reversal cannot precede original");
    const lines = (
      await c.env.DB.prepare(
        "SELECT account_id account,credit debit,debit credit FROM el_journal_lines WHERE journal_id=? AND org_id=?",
      )
        .bind(before.id, before.org_id)
        .all<{ account: string; debit: number; credit: number }>()
    ).results;
    const j = await journal(c, {
      branch: before.branch_id,
      date: d.date,
      reference: "REV-" + before.id.slice(0, 12),
      memo: d.reason,
      source: "reversal",
      sourceId: before.id,
      reverseOf: before.id,
      lines,
      demo: before.is_demo,
    });
    await c.env.DB.batch([
      ...j.statements,
      audit(c, "journal", before.id, "reverse", null, d),
    ]);
    return c.json({ id: j.id }, 201);
  });
  app.get("/api/finance/reports", async (c: AppContext) => {
    permit(c, "finance");
    const a = c.get("actor"),
      from = c.req.query("from") ?? "2020-01-01",
      to = c.req.query("to") ?? "2100-12-31";
    date.parse(from);
    date.parse(to);
    assert(from <= to, 400, "Invalid date range");
    const rows = (
      await c.env.DB.prepare(
        "SELECT ac.id,ac.code,ac.name,ac.kind,COALESCE(sum(CASE WHEN j.id IS NOT NULL THEN l.debit ELSE 0 END),0) debit,COALESCE(sum(CASE WHEN j.id IS NOT NULL THEN l.credit ELSE 0 END),0) credit FROM el_accounts ac LEFT JOIN el_journal_lines l ON l.account_id=ac.id LEFT JOIN el_journals j ON j.id=l.journal_id AND j.status='posted' AND (? IS NULL OR j.branch_id=?) AND j.date>=? AND j.date<=? WHERE ac.org_id=? GROUP BY ac.id ORDER BY ac.code",
      )
        .bind(a.branch_id, a.branch_id, from, to, a.org_id)
        .all<Record<string, any>>()
    ).results;
    const revenue = rows
        .filter((x) => x.kind === "revenue")
        .reduce((n, x) => n + x.credit - x.debit, 0),
      expense = rows
        .filter((x) => x.kind === "expense")
        .reduce((n, x) => n + x.debit - x.credit, 0);
    const balances = (
      await c.env.DB.prepare(
        "SELECT ac.id,ac.code,ac.name,ac.kind,COALESCE(sum(CASE WHEN j.id IS NOT NULL THEN l.debit-l.credit ELSE 0 END),0) balance FROM el_accounts ac LEFT JOIN el_journal_lines l ON l.account_id=ac.id LEFT JOIN el_journals j ON j.id=l.journal_id AND j.status='posted' AND (? IS NULL OR j.branch_id=?) AND j.date<=? WHERE ac.org_id=? GROUP BY ac.id ORDER BY ac.code",
      )
        .bind(a.branch_id, a.branch_id, to, a.org_id)
        .all<Record<string, any>>()
    ).results;
    const totalKind = (kind: string) =>
        balances
          .filter((x) => x.kind === kind)
          .reduce((n, x) => n + x.balance, 0),
      assets = totalKind("asset"),
      liabilities = -totalKind("liability"),
      equity = -totalKind("equity"),
      retained_earnings = -totalKind("revenue") - totalKind("expense");
    const cash = (
      await c.env.DB.prepare(
        "SELECT j.source_type,COALESCE(sum(CASE WHEN j.date<? THEN l.debit-l.credit ELSE 0 END),0) opening,COALESCE(sum(CASE WHEN j.date>=? THEN l.debit-l.credit ELSE 0 END),0) movement FROM el_journal_lines l JOIN el_accounts ac ON ac.id=l.account_id AND ac.system_key IN ('cash','bank') JOIN el_journals j ON j.id=l.journal_id AND j.status='posted' WHERE j.org_id=? AND (? IS NULL OR j.branch_id=?) AND j.date<=? GROUP BY j.source_type",
      )
        .bind(from, from, a.org_id, a.branch_id, a.branch_id, to)
        .all<Record<string, any>>()
    ).results;
    const cash_opening = cash.reduce((n, x) => n + x.opening, 0),
      cash_movement = cash.reduce((n, x) => n + x.movement, 0);
    const outstanding =
      balances.find((x) => x.id === rows.find((x) => x.code === "1100")?.id)
        ?.balance ?? 0;
    return c.json({
      trial_balance: rows,
      revenue,
      expenses: expense,
      profit: revenue - expense,
      outstanding,
      balance_sheet: {
        as_of: to,
        accounts: balances.filter((x) =>
          ["asset", "liability", "equity"].includes(x.kind),
        ),
        assets,
        liabilities,
        equity,
        retained_earnings,
        balanced: assets === liabilities + equity + retained_earnings,
      },
      cash_flow: {
        from,
        to,
        opening: cash_opening,
        movement: cash_movement,
        closing: cash_opening + cash_movement,
        sources: cash.map((x) => ({
          source: x.source_type,
          movement: x.movement,
        })),
      },
      from,
      to,
      balanced: rows.reduce((n, x) => n + x.debit - x.credit, 0) === 0,
    });
  });
}
export async function seedFinanceDemo(c: AppContext) {
  const a = c.get("actor"),
    db = c.env.DB;
  assert(!a.branch_id, 403, "Organization-wide permission required");
  assert(
    (
      await db
        .prepare("SELECT demo_enabled FROM el_organizations WHERE id=?")
        .bind(a.org_id)
        .first<{ demo_enabled: number }>()
    )?.demo_enabled,
    409,
    "Enable demo mode first",
  );
  if (
    await db
      .prepare(
        "SELECT id FROM el_invoices WHERE org_id=? AND is_demo=1 LIMIT 1",
      )
      .bind(a.org_id)
      .first()
  )
    return;
  const s = await db
    .prepare("SELECT * FROM el_students WHERE org_id=? AND is_demo=1 LIMIT 1")
    .bind(a.org_id)
    .first<Record<string, any>>();
  assert(s, 409, "Populate academic demo data first");
  const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    year = today.slice(0, 4);
  const existing = await db
    .prepare("SELECT id FROM el_accounts WHERE org_id=? LIMIT 1")
    .bind(a.org_id)
    .first();
  if (!existing) {
    await db.batch(
      systemAccounts.map(([code, name, kind, key]) =>
        db
          .prepare(
            "INSERT INTO el_accounts(id,org_id,code,name,kind,system_key,is_demo) VALUES(?,?,?,?,?,?,1)",
          )
          .bind(uid(), a.org_id, code, name, kind, key),
      ),
    );
  }
  const financialPeriod = await db
    .prepare(
      "SELECT id,status FROM el_financial_periods WHERE org_id=? AND starts_on<=? AND ends_on>=?",
    )
    .bind(a.org_id, today, today)
    .first<{ id: string; status: string }>();
  assert(
    !financialPeriod || financialPeriod.status === "open",
    409,
    "Current financial period is closed",
  );
  if (!financialPeriod)
    await db
      .prepare(
        "INSERT INTO el_financial_periods(id,org_id,name,starts_on,ends_on,is_demo) VALUES(?,?,?,?,?,1)",
      )
      .bind(uid(), a.org_id, "Demo " + year, year + "-01-01", year + "-12-31")
      .run();
  const ac = await accounts(c),
    invoice = uid(),
    payment = uid(),
    journalId = uid(),
    pJournal = uid(),
    number = "DEMO-" + invoice.slice(0, 6),
    j = await journal(c, {
      id: journalId,
      branch: s.branch_id,
      date: today,
      reference: "INV-" + number,
      memo: "Fictional tuition invoice",
      source: "invoice",
      sourceId: invoice,
      lines: [
        { account: ac.receivable, debit: 1200, credit: 0 },
        { account: ac.revenue, debit: 0, credit: 1200 },
      ],
      demo: 1,
    }),
    p = await journal(c, {
      id: pJournal,
      branch: s.branch_id,
      date: today,
      reference: "PAY-" + payment.slice(0, 12),
      memo: "Fictional receipt",
      source: "payment",
      sourceId: payment,
      lines: [
        { account: ac.cash, debit: 700, credit: 0 },
        { account: ac.receivable, debit: 0, credit: 700 },
      ],
      demo: 1,
    });
  await db.batch([
    db
      .prepare(
        "INSERT INTO el_invoices(id,org_id,branch_id,student_id,number,date,due_date,total,created_by,is_demo) VALUES(?,?,?,?,?,?,?,?,?,1)",
      )
      .bind(
        invoice,
        a.org_id,
        s.branch_id,
        s.id,
        number,
        today,
        year + "-12-31",
        1200,
        a.user_id,
      ),
    db
      .prepare(
        "INSERT INTO el_invoice_items(id,org_id,invoice_id,description,quantity,unit_price,is_demo) VALUES(?,?,?,?,1,1200,1)",
      )
      .bind(
        uid(),
        a.org_id,
        invoice,
        "English Foundations · fictional tuition",
      ),
    ...j.statements,
    db
      .prepare("UPDATE el_invoices SET status='issued',journal_id=? WHERE id=?")
      .bind(journalId, invoice),
    ...p.statements,
    db
      .prepare(
        "INSERT INTO el_payments(id,org_id,branch_id,invoice_id,date,amount,method,reference,idempotency_key,journal_id,created_by,is_demo) VALUES(?,?,?,?,?,700,?,?,?,?,?,1)",
      )
      .bind(
        payment,
        a.org_id,
        s.branch_id,
        invoice,
        today,
        "cash",
        "Fictional demo receipt",
        uid(),
        pJournal,
        a.user_id,
      ),
    db
      .prepare(
        "INSERT INTO el_expenses(id,org_id,branch_id,date,category,description,amount,method,created_by,is_demo) VALUES(?,?,?,?,?,?,180,?,?,1)",
      )
      .bind(
        uid(),
        a.org_id,
        s.branch_id,
        today,
        "Supplies",
        "Fictional classroom materials",
        "cash",
        a.user_id,
      ),
    audit(c, "demo", a.org_id, "seed_finance", null, { fictional: true }),
  ]);
}
