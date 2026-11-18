import type { Hono } from "hono";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { assert } from "./security";
import { uid } from "./db";
import { permit, scope, audit, type AppContext } from "./app";
import { record } from "./academic";
import { journal, date } from "./finance";
const compensationSchema = z.object({
  teacher_id: z.uuid(),
  type: z.enum([
    "fixed",
    "hourly",
    "per_session",
    "per_student",
    "revenue_percent",
    "hybrid",
  ]),
  base: z.number().int().min(0).max(100000000),
  rate: z.number().int().min(0).max(100000000),
  percent: z.number().int().min(0).max(100),
});
async function accountIds(c: AppContext) {
  const rows = (
    await c.env.DB.prepare(
      "SELECT id,system_key FROM el_accounts WHERE org_id=? AND system_key IS NOT NULL",
    )
      .bind(c.get("actor").org_id)
      .all<{ id: string; system_key: string }>()
  ).results;
  const map = Object.fromEntries(rows.map((x) => [x.system_key, x.id]));
  assert(
    map.payroll_expense && map.payroll_payable && map.bank,
    409,
    "Initialize finance settings first",
  );
  return map;
}
async function payroll(c: AppContext, id: string) {
  const p = await c.env.DB.prepare(
    "SELECT * FROM el_payroll WHERE id=? AND org_id=?",
  )
    .bind(id, c.get("actor").org_id)
    .first<Record<string, any>>();
  assert(p, 404, "Payroll record not found");
  scope(c, p.branch_id);
  return p;
}
export function calculatePay(
  d: { type: string; base: number; rate: number; percent: number },
  stats: {
    minutes: number;
    sessions: number;
    students: number;
    revenue: number;
  },
) {
  switch (d.type) {
    case "fixed":
      return d.base;
    case "hourly":
      return Math.round((stats.minutes * d.rate) / 60);
    case "per_session":
      return stats.sessions * d.rate;
    case "per_student":
      return stats.students * d.rate;
    case "revenue_percent":
      return Math.round((stats.revenue * d.percent) / 100);
    case "hybrid":
      return (
        d.base +
        stats.sessions * d.rate +
        Math.round((stats.revenue * d.percent) / 100)
      );
    default:
      throw new Error("Invalid compensation type");
  }
}
export function registerPayroll(app: Hono<any>) {
  app.get("/api/payroll/compensation", async (c: AppContext) => {
    permit(c, "payroll");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT c.*,t.name teacher_name FROM el_compensation c JOIN el_teachers t ON t.id=c.teacher_id WHERE c.org_id=? AND (? IS NULL OR c.branch_id=?) ORDER BY t.name,c.created_at DESC",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/payroll/compensation", async (c: AppContext) => {
    permit(c, "payroll", "manage");
    const d = compensationSchema.parse(await c.req.json()),
      t = await record(c, "teachers", d.teacher_id),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_compensation SET status='inactive' WHERE org_id=? AND teacher_id=? AND status='active'",
      ).bind(t.org_id, t.id),
      c.env.DB.prepare(
        "INSERT INTO el_compensation(id,org_id,branch_id,teacher_id,type,base,rate,percent) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        t.org_id,
        t.branch_id,
        t.id,
        d.type,
        d.base,
        d.rate,
        d.percent,
      ),
      audit(c, "compensation", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/payroll", async (c: AppContext) => {
    permit(c, "payroll");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT p.*,t.name teacher_name FROM el_payroll p JOIN el_teachers t ON t.id=p.teacher_id WHERE p.org_id=? AND (? IS NULL OR p.branch_id=?) ORDER BY p.month DESC,t.name LIMIT 200",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/payroll", async (c: AppContext) => {
    permit(c, "payroll", "create");
    const d = z
      .object({
        teacher_id: z.uuid(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
        bonus: z.number().int().min(0).max(100000000).default(0),
        deduction: z.number().int().min(0).max(100000000).default(0),
        adjustment_reason: z.string().trim().max(500).default(""),
      })
      .parse(await c.req.json());
    if (d.bonus || d.deduction)
      assert(
        d.adjustment_reason.length > 0,
        400,
        "Record a reason for bonus or deduction",
      );
    const t = await record(c, "teachers", d.teacher_id),
      plan = await c.env.DB.prepare(
        "SELECT * FROM el_compensation WHERE org_id=? AND teacher_id=? AND status='active'",
      )
        .bind(t.org_id, t.id)
        .first<Record<string, any>>();
    assert(plan, 409, "Create an active compensation agreement first");
    let month;
    try {
      month = Temporal.PlainYearMonth.from(d.month);
    } catch {
      assert(false, 400, "Invalid payroll month");
    }
    const tz = (await c.env.DB.prepare(
      "SELECT timezone FROM el_organizations WHERE id=?",
    )
      .bind(t.org_id)
      .first<{ timezone: string }>())!.timezone;
    const from = month
        .toPlainDate({ day: 1 })
        .toZonedDateTime({ timeZone: tz, plainTime: "00:00" }),
      to = from.add({ months: 1 });
    const start = Number(from.epochMilliseconds) / 1000,
      end = Number(to.epochMilliseconds) / 1000;
    const sessions = await c.env.DB.prepare(
      "SELECT count(*) sessions,COALESCE(sum(ends_at-starts_at),0)/60 minutes FROM el_class_sessions WHERE org_id=? AND teacher_id=? AND status='completed' AND starts_at>=? AND starts_at<?",
    )
      .bind(t.org_id, t.id, start, end)
      .first<{ sessions: number; minutes: number }>();
    const learners = await c.env.DB.prepare(
      "SELECT count(DISTINCT en.student_id) students FROM el_enrollments en JOIN el_groups g ON g.id=en.group_id WHERE en.org_id=? AND g.teacher_id=? AND en.status<>'waiting' AND unixepoch(en.created_at)<? AND (en.status IN ('active','completed') OR unixepoch(en.updated_at)>=?)",
    )
      .bind(t.org_id, t.id, end, start)
      .first<{ students: number }>();
    const revenue = await c.env.DB.prepare(
      "SELECT COALESCE(round(sum((CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END)*1.0*sh.amount/i.total)),0) revenue FROM el_payments p JOIN el_invoices i ON i.id=p.invoice_id JOIN el_invoice_teacher_shares sh ON sh.invoice_id=i.id AND sh.teacher_id=? WHERE p.org_id=? AND p.date>=? AND p.date<?",
    )
      .bind(
        t.id,
        t.org_id,
        from.toPlainDate().toString(),
        to.toPlainDate().toString(),
      )
      .first<{ revenue: number }>();
    const stats = {
      sessions: sessions?.sessions ?? 0,
      minutes: sessions?.minutes ?? 0,
      students: learners?.students ?? 0,
      revenue: revenue?.revenue ?? 0,
    };
    const base = calculatePay(plan as any, stats),
      total = base + d.bonus - d.deduction;
    assert(
      total >= 0 && Number.isSafeInteger(total) && total <= 1000000000,
      400,
      "Payroll total is out of range",
    );
    const id = uid(),
      calculation = {
        agreement: {
          id: plan.id,
          type: plan.type,
          base: plan.base,
          rate: plan.rate,
          percent: plan.percent,
        },
        stats,
        rounding: "nearest whole currency unit",
        adjustment_reason: d.adjustment_reason,
      };
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_payroll(id,org_id,branch_id,teacher_id,month,compensation_id,calculation_json,base_amount,bonus,deduction,total,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        t.org_id,
        t.branch_id,
        t.id,
        d.month,
        plan.id,
        JSON.stringify(calculation),
        base,
        d.bonus,
        d.deduction,
        total,
        c.get("actor").user_id,
      ),
      audit(c, "payroll", id, "calculate", null, { ...d, total, calculation }),
    ]);
    return c.json({ id, total }, 201);
  });
  app.post("/api/payroll/:id/approve", async (c: AppContext) => {
    permit(c, "payroll", "approve");
    const p = await payroll(c, c.req.param("id")!),
      a = c.get("actor");
    assert(p.status === "draft", 409, "Payroll is not a draft");
    assert(
      p.created_by !== a.user_id,
      403,
      "A different user must approve payroll",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_payroll SET status='approved',approved_by=? WHERE id=? AND status='draft'",
      ).bind(a.user_id, p.id),
      audit(c, "payroll", p.id, "approve", p, { approved_by: a.user_id }),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/payroll/:id/pay", async (c: AppContext) => {
    permit(c, "finance", "approve");
    const p = await payroll(c, c.req.param("id")!),
      a = c.get("actor"),
      d = z
        .object({
          date,
          method: z.enum(["cash", "bank"]),
        })
        .parse(await c.req.json());
    assert(
      p.status === "approved",
      409,
      "Payroll must be approved before payment",
    );
    assert(
      a.user_id !== p.created_by && a.user_id !== p.approved_by,
      403,
      "Payment requires a finance user separate from preparer and approver",
    );
    assert(p.total > 0, 409, "Zero payroll needs no payment");
    const ac = await accountIds(c),
      j = await journal(c, {
        branch: p.branch_id,
        date: d.date,
        reference: "SAL-" + p.id.slice(0, 12),
        memo: `Payroll ${p.month}`,
        source: "payroll",
        sourceId: p.id,
        lines: [
          { account: ac.payroll_expense, debit: p.total, credit: 0 },
          {
            account: d.method === "cash" ? ac.cash : ac.bank,
            debit: 0,
            credit: p.total,
          },
        ],
      });
    await c.env.DB.batch([
      ...j.statements,
      c.env.DB.prepare(
        "UPDATE el_payroll SET status='paid',paid_by=?,journal_id=? WHERE id=? AND status='approved'",
      ).bind(a.user_id, j.id, p.id),
      audit(c, "payroll", p.id, "record_payment", p, d),
    ]);
    return c.json({ ok: true });
  });
}
